using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Tesorero.Application.Abstractions;
using Tesorero.Application.Common;
using Tesorero.Application.Contracts;
using Tesorero.Domain;

namespace Tesorero.Application.Services;

public sealed partial class PaymentService(
    IAppDbContext db,
    IIntentsClient intents,
    ITreasuryChain chain,
    IJobScheduler jobs,
    IOptions<IntentsOptions> intentsOptions,
    TimeProvider clock,
    ILogger<PaymentService> logger)
{
    private IQueryable<Payment> Query => db.Payments.Include(p => p.Bill).Include(p => p.Payee);

    public async Task<IReadOnlyList<PaymentDto>> ListAsync(PaymentStatus? status, CancellationToken ct)
    {
        var q = Query;
        if (status is { } s)
        {
            q = q.Where(p => p.Status == s);
        }

        return (await q.OrderByDescending(p => p.CreatedAt).Take(500).ToListAsync(ct)).Select(p => p.ToDto()).ToList();
    }

    public async Task<PaymentDto> GetAsync(Guid id, CancellationToken ct) => (await LoadAsync(id, ct)).ToDto();

    public async Task<PaymentDto> ApproveAsync(Guid id, string? note, Actor actor, CancellationToken ct)
    {
        var p = await LoadAsync(id, ct);
        if (p.Status != PaymentStatus.PendingApproval)
        {
            throw new ConflictException($"Only payments waiting for approval can be approved (this one is {p.Status}).");
        }

        p.Status = PaymentStatus.Approved;
        p.DecidedBy = actor.Name;
        p.DecidedAt = clock.GetUtcNow();
        p.DecisionNote = Trim(note);
        db.Record(clock, actor, "payment.approved", "Payment", p.Id,
            $"Approved paying {p.Payee?.Name} ${p.AmountUsd:N2}.{(p.DecisionNote is null ? string.Empty : $" Note: {p.DecisionNote}")}");
        await db.SaveChangesAsync(ct);
        jobs.EnqueuePaymentExecution(p.Id);
        return p.ToDto();
    }

    public async Task<PaymentDto> RejectAsync(Guid id, string? note, Actor actor, CancellationToken ct)
    {
        var p = await LoadAsync(id, ct);
        new Validator().Require(!string.IsNullOrWhiteSpace(note), "note", "Say why you are rejecting this payment.").ThrowIfInvalid();
        if (p.Status != PaymentStatus.PendingApproval)
        {
            throw new ConflictException($"Only payments waiting for approval can be rejected (this one is {p.Status}).");
        }

        p.Status = PaymentStatus.Rejected;
        p.DecidedBy = actor.Name;
        p.DecidedAt = clock.GetUtcNow();
        p.DecisionNote = Trim(note);
        if (p.Bill is { Status: BillStatus.Scheduled } bill)
        {
            bill.Status = BillStatus.Open;
        }

        db.Record(clock, actor, "payment.rejected", "Payment", p.Id, $"Rejected paying {p.Payee?.Name} ${p.AmountUsd:N2}. Reason: {p.DecisionNote}");
        await db.SaveChangesAsync(ct);
        return p.ToDto();
    }

    public async Task<PaymentDto> SubmitDepositAsync(Guid id, string txHash, Actor actor, CancellationToken ct)
    {
        var p = await LoadAsync(id, ct);
        var hash = txHash?.Trim() ?? string.Empty;
        new Validator().Require(TxHash().IsMatch(hash), "txHash", "Paste the NEAR transaction hash of the USDC deposit.").ThrowIfInvalid();
        if (p.Status != PaymentStatus.AwaitingDeposit || p.Quote?.DepositAddress is null)
        {
            throw new ConflictException("This payment is not waiting for a deposit.");
        }

        await intents.SubmitDepositAsync(p.Quote.DepositAddress, hash, ct);
        p.DepositTxHash = hash;
        p.Status = PaymentStatus.Processing;
        p.IntentStatus = "KNOWN_DEPOSIT_TX";
        db.Record(clock, actor, "payment.deposit.submitted", "Payment", p.Id, $"Deposit {hash} submitted to NEAR Intents.");
        await db.SaveChangesAsync(ct);
        return p.ToDto();
    }

    /// <summary>Background job: quote the cross-chain transfer and settle (Simulation) or wait for the deposit (Live).</summary>
    public async Task ExecuteAsync(Guid id, CancellationToken ct)
    {
        var p = await Query.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null || p.Status != PaymentStatus.Approved)
        {
            return;
        }

        var settings = await db.Settings.SingleAsync(ct);
        var opts = intentsOptions.Value;
        var live = settings.ExecutionMode == ExecutionMode.Live;
        var now = clock.GetUtcNow();

        if (!(await db.Policies.SingleAsync(ct)).AgentEnabled)
        {
            Fail(p, "Payments are stopped. Nothing was sent; resume payments and run the agent again to pay this bill.");
            await db.SaveChangesAsync(ct);
            return;
        }

        if (live && settings.TreasuryAccountId is null)
        {
            Fail(p, "Live mode needs a treasury NEAR account.");
            await db.SaveChangesAsync(ct);
            return;
        }

        var amountIn = ToBaseUnits(p.AmountUsd, opts.OriginDecimals);
        try
        {
            var quote = await intents.QuoteAsync(new IntentsQuoteRequest(
                Dry: !live,
                OriginAsset: p.OriginAssetId,
                DestinationAsset: p.DestinationAssetId,
                AmountIn: amountIn,
                Recipient: p.Recipient,
                RefundTo: settings.TreasuryAccountId ?? opts.DefaultRefundAccount,
                Deadline: now.AddMinutes(opts.QuoteTtlMinutes)), ct);

            p.Quote = new PaymentQuote
            {
                AmountIn = quote.AmountIn,
                AmountOut = quote.AmountOut,
                AmountOutFormatted = quote.AmountOutFormatted,
                AmountOutUsd = quote.AmountOutUsd,
                DepositAddress = quote.DepositAddress,
                Deadline = quote.Deadline,
                QuotedAt = now,
            };
            p.Simulation = !live;

            if (live)
            {
                if (string.IsNullOrWhiteSpace(quote.DepositAddress))
                {
                    throw new ExternalServiceException("NEAR Intents", "The live quote did not include a deposit address.");
                }

                p.Status = PaymentStatus.AwaitingDeposit;
                p.IntentStatus = "PENDING_DEPOSIT";
                var autonomous = chain.AgentAccountId is not null;
                db.Record(clock, Actor.System, "payment.quoted", "Payment", p.Id,
                    $"Live quote: {p.AmountUsd:N2} USDC → {quote.AmountOutFormatted} {p.DestinationSymbol} on {p.DestinationChain}. "
                    + (autonomous ? "The agent will pay through the treasury contract." : "Waiting for the owner to sign the deposit."));

                // Persist the quote (and its deposit address) BEFORE money can move, so any later crash is recoverable by the status poller.
                await db.SaveChangesAsync(ct);
                if (autonomous)
                {
                    try
                    {
                        await PayOnChainAsync(p, settings.TreasuryAccountId!, quote.DepositAddress, ct);
                    }
                    catch (ExternalServiceException ex)
                    {
                        // The transaction may or may not have landed. Never fail (and re-open) the bill here:
                        // that could lead to paying twice. The poller reconciles from the deposit address.
                        LogQuoteFailed(logger, ex, p.Id);
                        p.LastError = $"Could not confirm the on-chain payment yet ({ex.Message}). Tesorero keeps checking NEAR Intents.";
                        db.Record(clock, Actor.System, "payment.onchain.unconfirmed", "Payment", p.Id, p.LastError);
                    }
                }
            }
            else
            {
                p.Status = PaymentStatus.Settled;
                p.IntentStatus = "SIMULATED";
                p.SettledAt = now;
                if (p.Bill is { } bill)
                {
                    bill.Status = BillStatus.Paid;
                }

                db.Record(clock, Actor.System, "payment.settled", "Payment", p.Id,
                    $"Simulated with a real NEAR Intents quote: {p.AmountUsd:N2} USDC → {quote.AmountOutFormatted} {p.DestinationSymbol} on {p.DestinationChain} to {p.Payee?.Name}.");
            }
        }
        catch (ExternalServiceException ex)
        {
            LogQuoteFailed(logger, ex, id);
            Fail(p, ex.Message);
        }

        await db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Autonomous Live payment: the agent key calls <c>treasury.pay</c>. The contract enforces the on-chain
    /// limits and rejects duplicate ids, so a retried job can never pay twice.
    /// </summary>
    private async Task PayOnChainAsync(Payment p, string treasury, string depositAddress, CancellationToken ct)
    {
        var paymentKey = p.Id.ToString("N");
        var existing = await chain.GetPaymentAsync(treasury, paymentKey, ct);
        if (existing is null)
        {
            var amount = UInt128.Parse(p.Quote!.AmountIn, CultureInfo.InvariantCulture);
            var tx = await chain.PayAsync(treasury, paymentKey, depositAddress, amount, ct);
            p.OnChainTxHash = tx.TxHash;
            existing = await chain.GetPaymentAsync(treasury, paymentKey, ct);
            if (!tx.Success && existing is null)
            {
                Fail(p, tx.Error ?? "The treasury contract rejected the payment.");
                return;
            }
        }

        if (existing is null || existing.Status == "Failed")
        {
            Fail(p, "The treasury contract could not transfer the USDC to NEAR Intents.");
            return;
        }

        if (existing.Status != "Done")
        {
            // Still pending on-chain: the poller will pick up the 1Click status from the deposit address.
            p.Status = PaymentStatus.Processing;
            return;
        }

        p.DepositTxHash = p.OnChainTxHash;
        p.Status = PaymentStatus.Processing;
        p.IntentStatus = "KNOWN_DEPOSIT_TX";
        if (p.OnChainTxHash is { } hash)
        {
            try
            {
                await intents.SubmitDepositAsync(depositAddress, hash, ct);
            }
            catch (ExternalServiceException ex)
            {
                // Optional speed-up only: 1Click detects the deposit on its own.
                LogQuoteFailed(logger, ex, p.Id);
            }
        }

        db.Record(clock, Actor.Agent, "payment.paid.onchain", "Payment", p.Id,
            $"Agent paid {p.AmountUsd:N2} USDC from the treasury contract to NEAR Intents (tx {p.OnChainTxHash}). Delivering {p.Quote?.AmountOutFormatted} {p.DestinationSymbol} on {p.DestinationChain}.");
    }

    /// <summary>Background job: follow live payments until NEAR Intents reports a final state.</summary>
    public async Task<int> PollAsync(CancellationToken ct)
    {
        var active = await Query
            .Where(p => p.Status == PaymentStatus.AwaitingDeposit || p.Status == PaymentStatus.Processing)
            .OrderBy(p => p.CreatedAt)
            .Take(50)
            .ToListAsync(ct);
        var now = clock.GetUtcNow();
        var changed = 0;

        foreach (var p in active)
        {
            if (p.Quote?.DepositAddress is not { } address)
            {
                continue;
            }

            IntentsStatus status;
            try
            {
                status = await intents.GetStatusAsync(address, ct);
            }
            catch (ExternalServiceException ex)
            {
                LogPollFailed(logger, ex, p.Id);
                continue;
            }

            if (status.Status == p.IntentStatus)
            {
                if (p.Status == PaymentStatus.AwaitingDeposit && p.Quote.Deadline is { } deadline && now > deadline.AddMinutes(10))
                {
                    Fail(p, "The quote expired before the deposit arrived.");
                    changed++;
                }

                continue;
            }

            p.IntentStatus = status.Status;
            changed++;
            switch (status.Status)
            {
                case "SUCCESS":
                    p.Status = PaymentStatus.Settled;
                    p.SettledAt = now;
                    if (p.Bill is { } bill)
                    {
                        bill.Status = BillStatus.Paid;
                    }

                    db.Record(clock, Actor.System, "payment.settled", "Payment", p.Id, $"NEAR Intents delivered {p.Quote.AmountOutFormatted} {p.DestinationSymbol} to {p.Payee?.Name}.");
                    break;
                case "REFUNDED":
                    p.Status = PaymentStatus.Refunded;
                    ReopenBill(p);
                    db.Record(clock, Actor.System, "payment.refunded", "Payment", p.Id, "NEAR Intents refunded the deposit to the treasury.");
                    break;
                case "FAILED":
                    Fail(p, "NEAR Intents reported the swap as failed.");
                    break;
                case "KNOWN_DEPOSIT_TX" or "PROCESSING" or "INCOMPLETE_DEPOSIT":
                    p.Status = PaymentStatus.Processing;
                    break;
                default:
                    break;
            }
        }

        if (changed > 0)
        {
            await db.SaveChangesAsync(ct);
        }

        return changed;
    }

    public async Task<string> ExportCsvAsync(CancellationToken ct)
    {
        var rows = await Query.OrderBy(p => p.CreatedAt).ToListAsync(ct);
        var sb = new StringBuilder();
        sb.AppendLine("payment_id,created_at_utc,settled_at_utc,status,simulation,payee,category,bill_reference,amount_usd,origin_asset,destination_symbol,destination_chain,recipient,amount_out,deposit_address,deposit_tx_hash,intent_status,policy_outcome,decided_by,decision_note");
        foreach (var p in rows)
        {
            string[] cells =
            [
                p.Id.ToString(),
                p.CreatedAt.UtcDateTime.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
                p.SettledAt?.UtcDateTime.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) ?? string.Empty,
                p.Status.ToString(),
                p.Simulation ? "yes" : "no",
                p.Payee?.Name ?? string.Empty,
                p.Category.ToString(),
                p.Bill?.Reference ?? string.Empty,
                p.AmountUsd.ToString("0.00", CultureInfo.InvariantCulture),
                p.OriginAssetId,
                p.DestinationSymbol,
                p.DestinationChain,
                p.Recipient,
                p.Quote?.AmountOutFormatted ?? string.Empty,
                p.Quote?.DepositAddress ?? string.Empty,
                p.DepositTxHash ?? string.Empty,
                p.IntentStatus ?? string.Empty,
                p.PolicyOutcome.ToString(),
                p.DecidedBy ?? string.Empty,
                p.DecisionNote ?? string.Empty,
            ];
            sb.AppendLine(string.Join(',', cells.Select(Csv)));
        }

        return sb.ToString();
    }

    internal static string ToBaseUnits(decimal amount, int decimals)
    {
        var scaled = decimal.Round(amount, Math.Min(decimals, 8), MidpointRounding.ToZero);
        var units = scaled * (decimal)Math.Pow(10, decimals);
        return decimal.Truncate(units).ToString("0", CultureInfo.InvariantCulture);
    }

    /// <summary>RFC 4180 escaping plus formula-injection guard for spreadsheet apps.</summary>
    internal static string Csv(string value)
    {
        if (value.Length > 0 && value[0] is '=' or '+' or '-' or '@')
        {
            value = "'" + value;
        }

        return value.IndexOfAny([',', '"', '\n', '\r']) >= 0 ? $"\"{value.Replace("\"", "\"\"", StringComparison.Ordinal)}\"" : value;
    }

    private void Fail(Payment p, string error)
    {
        p.Status = PaymentStatus.Failed;
        p.LastError = error;
        ReopenBill(p);
        db.Record(clock, Actor.System, "payment.failed", "Payment", p.Id, $"Payment to {p.Payee?.Name} failed: {error}");
    }

    private static void ReopenBill(Payment p)
    {
        if (p.Bill is { Status: BillStatus.Scheduled } bill)
        {
            bill.Status = BillStatus.Open;
        }
    }

    private async Task<Payment> LoadAsync(Guid id, CancellationToken ct) =>
        await Query.FirstOrDefaultAsync(p => p.Id == id, ct) ?? throw new NotFoundException("Payment", id);

    private static string? Trim(string? note) => string.IsNullOrWhiteSpace(note) ? null : note.Trim()[..Math.Min(note.Trim().Length, 500)];

    [GeneratedRegex("^[1-9A-HJ-NP-Za-km-z]{43,44}$")]
    private static partial Regex TxHash();

    [LoggerMessage(Level = LogLevel.Warning, Message = "Quote failed for payment {PaymentId}")]
    private static partial void LogQuoteFailed(ILogger logger, Exception ex, Guid paymentId);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Status poll failed for payment {PaymentId}")]
    private static partial void LogPollFailed(ILogger logger, Exception ex, Guid paymentId);
}
