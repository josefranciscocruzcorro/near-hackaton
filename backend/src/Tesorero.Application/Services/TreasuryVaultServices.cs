using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Tesorero.Application.Abstractions;
using Tesorero.Application.Common;
using Tesorero.Application.Contracts;
using Tesorero.Domain;

namespace Tesorero.Application.Services;

/// <summary>
/// The organization's on-chain treasury (ADR-0007): overview with live checks, and its creation from the app
/// with a one-time deploy key that deletes itself once the audited contract is initialized.
/// </summary>
public sealed partial class TreasuryVaultService(
    IAppDbContext db,
    ITenantContext tenant,
    ITreasuryChain chain,
    INearRpcClient rpc,
    INearAccounts accounts,
    ITreasuryCode code,
    IAgentKeyFactory keys,
    ISecretVault vault,
    IOptions<NearOptions> nearOptions,
    IMemoryCache cache,
    TimeProvider clock,
    ILogger<TreasuryVaultService> logger)
{
    public const decimal RequiredNear = 2.5m;
    public const decimal MinimumNear = 2.2m;
    public const decimal AgentGasNear = 0.3m;
    public const decimal AgentGasTopUpBelow = 0.2m;
    public const decimal AgentGasOk = 0.05m;
    private const string EmptyCodeHash = "11111111111111111111111111111111";
    private const string Skipped = "-";
    private static readonly UInt128 Yocto = UInt128.Parse("1000000000000000000000000", CultureInfo.InvariantCulture);
    private static readonly UInt128 UsdcStorageDeposit = UInt128.Parse("1250000000000000000000", CultureInfo.InvariantCulture);
    private const ulong Tgas = 1_000_000_000_000UL;

    public async Task<TreasuryOverviewDto> OverviewAsync(CancellationToken ct)
    {
        var settings = await db.Settings.SingleAsync(ct);
        var setup = await LatestSetupAsync(ct);
        var account = settings.TreasuryAccountId;
        var agent = chain.AgentAccountId;

        var live = await cache.GetOrCreateAsync($"treasury-live:{tenant.TenantId}:{account}:{agent}", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(15);
            return await ReadLiveAsync(account, agent, ct);
        }) ?? new LiveTreasury(null, null, [], null);

        var setupDto = setup is null ? null : await ToDtoAsync(setup, ct);
        var owner = live.Config?.OwnerId ?? setup?.OwnerAccountId;
        var checks = live.Checks.ToList();
        if (checks.Count > 0)
        {
            // With less than the minimum reserve the policy engine blocks every payment: never call that "ready".
            var reserve = (await db.Policies.SingleAsync(ct)).MinReserveUsd;
            checks.Add(new TreasuryCheckDto("reserveCovered", live.Balances?.TreasuryUsdc is { } usdc && usdc >= reserve));
        }

        return new TreasuryOverviewDto(account, owner, agent, nearOptions.Value.UsdcContract, settings.ExecutionMode, tenant.IsDemo,
            setupDto, live.Balances, live.Guard, checks, checks.Count > 0 && checks.All(c => c.Ok), tenant.Tenant?.NearAccountId);
    }

    public async Task<TreasurySetupDto> CreateSetupAsync(TreasurySetupInput input, Actor actor, CancellationToken ct)
    {
        GuardWrites();
        var owner = (input.OwnerAccountId ?? string.Empty).Trim().ToLowerInvariant();
        new Validator()
            .Require(owner.Length is >= 2 and <= 64 && AddressRules.NearAccount().IsMatch(owner), "ownerAccountId", "Must be a valid NEAR account id (e.g. yourname.near).")
            .Require(input.MaxPerPayment > 0, "maxPerPayment", "Must be greater than 0.")
            .Require(input.DailyLimit > 0 && input.DailyLimit <= 1_000_000, "dailyLimit", "Must be greater than 0 and at most 1,000,000.")
            .Require(input.MaxPerPayment <= input.DailyLimit, "maxPerPayment", "Cannot be greater than the daily limit.")
            .ThrowIfInvalid();

        if (chain.AgentAccountId is null)
        {
            throw new ConflictException("This organization has no agent account, so it cannot use an automatic treasury.");
        }

        var exists = true;
        try
        {
            exists = await rpc.AccountExistsAsync(owner, ct);
        }
        catch (ExternalServiceException)
        {
            // Checked again on-chain by `new` (owner_id must be a valid account id); do not block on a flaky RPC.
        }

        new Validator().Require(exists, "ownerAccountId", "This account does not exist on NEAR mainnet.").ThrowIfInvalid();

        var setup = await LatestSetupAsync(ct);
        if (setup is { Status: TreasurySetupStatus.Ready or TreasurySetupStatus.Deploying })
        {
            throw new ConflictException(setup.Status == TreasurySetupStatus.Ready
                ? "This organization already has a treasury."
                : "The treasury is being created right now.");
        }

        if (setup is { Status: TreasurySetupStatus.Failed, DeployTxHash: not null })
        {
            throw new ConflictException("The contract is already deployed: retry the creation instead of changing it.");
        }

        var now = clock.GetUtcNow();
        if (setup is null)
        {
            var (accountId, secret) = keys.Generate();
            setup = new TreasurySetup
            {
                OwnerAccountId = owner,
                AccountId = accountId,
                DeployKeyCiphertext = vault.Protect(secret),
                CreatedAt = now,
            };
            db.TreasurySetups.Add(setup);
        }

        setup.OwnerAccountId = owner;
        setup.MaxPerPaymentUsd = input.MaxPerPayment;
        setup.DailyLimitUsd = input.DailyLimit;
        setup.Status = TreasurySetupStatus.AwaitingFunds;
        setup.LastError = null;
        setup.UpdatedAt = now;
        db.Record(clock, actor, "treasury.setup.prepared", "TreasurySetup", setup.Id,
            $"Treasury prepared at {setup.AccountId}: owner {owner}, on-chain limits {input.MaxPerPayment:N2} per payment / {input.DailyLimit:N2} per day. Waiting for {RequiredNear} NEAR.");
        await db.SaveChangesAsync(ct);
        return await ToDtoAsync(setup, ct);
    }

    /// <summary>Emergency: pauses the treasury contract on-chain (signed by the agent). Only the owner's wallet can unpause it.</summary>
    public async Task<TreasuryOverviewDto> FreezeAsync(Actor actor, CancellationToken ct)
    {
        GuardWrites();
        var settings = await db.Settings.SingleAsync(ct);
        var agent = chain.AgentAccountId;
        OnChainConfig? config = null;
        if (settings.TreasuryAccountId is { } contract)
        {
            config = await chain.GetConfigAsync(contract, ct);
        }

        if (settings.TreasuryAccountId is not { } treasury || config is null || agent is null || config.AgentId != agent)
        {
            throw new ConflictException("There is no verified treasury to freeze.");
        }

        if (!config.Paused)
        {
            var tx = await chain.PauseAsync(treasury, ct);
            if (!tx.Success)
            {
                throw new ExternalServiceException("NEAR", tx.Error ?? "The treasury could not be paused.");
            }

            db.Record(clock, actor, "treasury.frozen", "Treasury", treasury,
                $"Treasury contract paused on-chain by {actor.Name} (tx {tx.TxHash}). Only the owner's wallet can unpause it.");
            await db.SaveChangesAsync(ct);

            // Reads use final blocks: wait (briefly) until the pause is visible so the owner never sees "not paused" afterwards.
            for (var i = 0; i < 10 && await chain.GetConfigAsync(treasury, ct) is { Paused: false }; i++)
            {
                await Task.Delay(TimeSpan.FromSeconds(1), ct);
            }
        }

        cache.Remove($"treasury-live:{tenant.TenantId}:{treasury}:{agent}");
        cache.Remove("onchain-guard:" + treasury);
        return await OverviewAsync(ct);
    }

    public async Task CancelSetupAsync(Actor actor, CancellationToken ct)
    {
        GuardWrites();
        var setup = await LatestSetupAsync(ct) ?? throw new NotFoundException("TreasurySetup", "latest");
        if (setup.Status != TreasurySetupStatus.AwaitingFunds)
        {
            throw new ConflictException("Only a treasury that is still waiting for NEAR can be discarded.");
        }

        var state = await accounts.GetAsync(setup.AccountId, ct);
        if (state is { NearBalance: > 0 })
        {
            throw new ConflictException("NEAR already arrived at this address: create the treasury instead of discarding it.");
        }

        db.TreasurySetups.Remove(setup);
        db.Record(clock, actor, "treasury.setup.discarded", "TreasurySetup", setup.Id, $"Discarded the unfunded treasury {setup.AccountId}.");
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Runs the idempotent creation steps; on failure the setup is left <c>Failed</c> and can be retried.</summary>
    public async Task<TreasurySetupDto> DeployAsync(Actor actor, CancellationToken ct)
    {
        GuardWrites();
        var setup = await LatestSetupAsync(ct) ?? throw new NotFoundException("TreasurySetup", "latest");
        if (setup.Status == TreasurySetupStatus.Ready)
        {
            return await ToDtoAsync(setup, ct);
        }

        if (setup.Status == TreasurySetupStatus.Deploying && clock.GetUtcNow() - setup.UpdatedAt < TimeSpan.FromMinutes(3))
        {
            throw new ConflictException("The treasury is being created right now.");
        }

        var agent = chain.AgentAccountId ?? throw new ConflictException("This organization has no agent account.");
        var secret = setup.DeployKeyCiphertext is { } cipher
            ? vault.Unprotect(cipher)
            : throw new ConflictException("The one-time key of this treasury no longer exists.");

        var state = await accounts.GetAsync(setup.AccountId, ct);
        if (setup.DeployTxHash is null && (state?.NearBalance ?? 0) < MinimumNear)
        {
            throw new ValidationFailedException(new Dictionary<string, string[]>
            {
                ["funds"] = [$"Send at least {MinimumNear.ToString(CultureInfo.InvariantCulture)} NEAR to {setup.AccountId} first (received {(state?.NearBalance ?? 0).ToString(CultureInfo.InvariantCulture)})."],
            });
        }

        setup.Status = TreasurySetupStatus.Deploying;
        setup.LastError = null;
        setup.UpdatedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(ct);

        var account = setup.AccountId;
        var usdc = nearOptions.Value.UsdcContract;
        try
        {
            // 1. Code + init (skips what is already on-chain, so a retry resumes).
            state = await accounts.GetAsync(account, ct) ?? throw new ExternalServiceException("NEAR", "The treasury account does not exist yet.");
            if (state.CodeHash != code.Sha256Base58)
            {
                if (state.CodeHash != EmptyCodeHash)
                {
                    throw new ExternalServiceException("NEAR", "This account already holds other code; refusing to overwrite it.");
                }

                setup.DeployTxHash = await accounts.SendAsync(account, secret, account,
                    [new ChainDeploy(code.Wasm), new ChainCall("new", InitArgs(setup, agent, usdc), 30 * Tgas, UInt128.Zero)], ct);
            }
            else if (await chain.GetConfigAsync(account, ct) is null)
            {
                setup.DeployTxHash = await accounts.SendAsync(account, secret, account,
                    [new ChainCall("new", InitArgs(setup, agent, usdc), 30 * Tgas, UInt128.Zero)], ct);
            }
            else
            {
                setup.DeployTxHash ??= Skipped;
            }

            await StepDoneAsync(setup, actor, "deploy", ct);

            // 2. Register the contract in USDC so it can receive and send it.
            setup.RegisterTxHash = await accounts.IsUsdcRegisteredAsync(account, ct)
                ? setup.RegisterTxHash ?? Skipped
                : await accounts.SendAsync(account, secret, usdc,
                    [new ChainCall("storage_deposit", JsonSerializer.Serialize(new { account_id = account, registration_only = true }), 30 * Tgas, UsdcStorageDeposit)], ct);
            await StepDoneAsync(setup, actor, "register", ct);

            // 3. Gas for the agent (it only ever needs NEAR for fees).
            var agentState = await accounts.GetAsync(agent, ct);
            setup.AgentGasTxHash = (agentState?.NearBalance ?? 0) >= AgentGasTopUpBelow
                ? setup.AgentGasTxHash ?? Skipped
                : await accounts.SendAsync(account, secret, agent, [new ChainTransfer(Near(AgentGasNear))], ct);
            await StepDoneAsync(setup, actor, "agentGas", ct);

            // 4. Verify before locking: the code is the audited wasm and the config is exactly what the owner chose.
            state = await accounts.GetAsync(account, ct);
            var config = await chain.GetConfigAsync(account, ct);
            var problems = new List<string>();
            if (state?.CodeHash != code.Sha256Base58)
            {
                problems.Add("code hash");
            }

            if (config is null)
            {
                problems.Add("config");
            }
            else
            {
                if (config.OwnerId != setup.OwnerAccountId)
                {
                    problems.Add("owner");
                }

                if (config.AgentId != agent)
                {
                    problems.Add("agent");
                }

                if (config.UsdcContractId != usdc)
                {
                    problems.Add("USDC contract");
                }

                if (config.MaxPerPayment != Usdc(setup.MaxPerPaymentUsd) || config.DailyLimit != Usdc(setup.DailyLimitUsd))
                {
                    problems.Add("limits");
                }
            }

            if (problems.Count > 0)
            {
                throw new ExternalServiceException("NEAR", $"Verification failed ({string.Join(", ", problems)}); the treasury was not locked.");
            }

            // 5. Lock: delete the one-time key. From now on nobody can redeploy or drain the contract.
            if (state!.AccessKeys > 0)
            {
                setup.LockTxHash = await accounts.SendAsync(account, secret, account, [new ChainDeleteKey(accounts.PublicKeyOf(secret))], ct);
            }
            else
            {
                setup.LockTxHash ??= Skipped;
            }

            setup.DeployKeyCiphertext = null;
            setup.Status = TreasurySetupStatus.Ready;
            setup.CompletedAt = clock.GetUtcNow();
            setup.UpdatedAt = setup.CompletedAt.Value;
            var settings = await db.Settings.SingleAsync(ct);
            settings.TreasuryAccountId = account;

            // The app's rules follow the on-chain limits the owner chose, so both layers agree.
            var policy = await db.Policies.SingleAsync(ct);
            policy.MaxPerPaymentUsd = setup.MaxPerPaymentUsd;
            policy.DailyLimitUsd = setup.DailyLimitUsd;
            policy.ApprovalThresholdUsd = Math.Min(policy.ApprovalThresholdUsd, setup.MaxPerPaymentUsd);
            policy.MonthlyLimitUsd = Math.Max(policy.MonthlyLimitUsd, setup.DailyLimitUsd);
            policy.Version++;
            policy.UpdatedAt = clock.GetUtcNow();
            policy.UpdatedBy = "system";
            db.Record(clock, Actor.System, "policy.updated", "Policy", policy.Id,
                $"Policy v{policy.Version}: limits aligned with the treasury contract ({setup.MaxPerPaymentUsd:N2} per payment, {setup.DailyLimitUsd:N2} per day).");
            db.Record(clock, actor, "treasury.setup.ready", "TreasurySetup", setup.Id,
                $"Treasury {account} created and locked: code {code.Sha256Hex[..12]}…, owner {setup.OwnerAccountId}, agent {agent}. It is now the organization's treasury account.");
            await db.SaveChangesAsync(ct);
            cache.Remove($"treasury-live:{tenant.TenantId}:{account}:{agent}");
        }
        catch (ExternalServiceException ex)
        {
            LogDeployFailed(logger, ex, account);
            setup.Status = TreasurySetupStatus.Failed;
            setup.LastError = ex.Message.Length > 900 ? ex.Message[..900] : ex.Message;
            setup.UpdatedAt = clock.GetUtcNow();
            db.Record(clock, actor, "treasury.setup.failed", "TreasurySetup", setup.Id, $"Treasury creation stopped: {setup.LastError}");
            await db.SaveChangesAsync(CancellationToken.None);
        }

        return await ToDtoAsync(setup, ct);
    }

    private void GuardWrites()
    {
        if (tenant.IsDemo)
        {
            throw new ForbiddenException("The public demo never moves real money.");
        }
    }

    private async Task StepDoneAsync(TreasurySetup setup, Actor actor, string step, CancellationToken ct)
    {
        setup.UpdatedAt = clock.GetUtcNow();
        var hash = step switch
        {
            "deploy" => setup.DeployTxHash,
            "register" => setup.RegisterTxHash,
            "agentGas" => setup.AgentGasTxHash,
            _ => null,
        };
        if (hash is not null && hash != Skipped)
        {
            db.Record(clock, actor, $"treasury.setup.{step}", "TreasurySetup", setup.Id, $"Treasury creation step '{step}' confirmed on NEAR (tx {hash}).");
        }

        await db.SaveChangesAsync(ct);
    }

    private static string InitArgs(TreasurySetup setup, string agent, string usdc) => JsonSerializer.Serialize(new
    {
        owner_id = setup.OwnerAccountId,
        usdc_contract_id = usdc,
        agent_id = agent,
        max_per_payment = Usdc(setup.MaxPerPaymentUsd).ToString(CultureInfo.InvariantCulture),
        daily_limit = Usdc(setup.DailyLimitUsd).ToString(CultureInfo.InvariantCulture),
    });

    internal static UInt128 Usdc(decimal usd) => (UInt128)decimal.Round(usd * 1_000_000m, 0, MidpointRounding.ToZero);

    private static UInt128 Near(decimal near) => (UInt128)decimal.Round(near * 1_000_000m, 0) * (Yocto / 1_000_000UL);

    private Task<TreasurySetup?> LatestSetupAsync(CancellationToken ct) =>
        db.TreasurySetups.OrderByDescending(s => s.CreatedAt).FirstOrDefaultAsync(ct);

    private async Task<TreasurySetupDto> ToDtoAsync(TreasurySetup s, CancellationToken ct)
    {
        decimal? received = null;
        if (s.Status is TreasurySetupStatus.AwaitingFunds or TreasurySetupStatus.Failed)
        {
            try
            {
                received = (await accounts.GetAsync(s.AccountId, ct))?.NearBalance ?? 0m;
            }
            catch (ExternalServiceException ex)
            {
                LogReadFailed(logger, ex, s.AccountId);
            }
        }

        var hashes = new[] { ("deploy", s.DeployTxHash), ("register", s.RegisterTxHash), ("agentGas", s.AgentGasTxHash), ("lock", s.LockTxHash) };
        var failedAt = s.Status == TreasurySetupStatus.Failed ? Array.FindIndex(hashes, h => h.Item2 is null) : -1;
        var steps = hashes.Select((h, i) => new TreasurySetupStepDto(
            h.Item1,
            h.Item2 is not null || s.Status == TreasurySetupStatus.Ready ? "done" : i == failedAt ? "failed" : "pending",
            h.Item2 is null or Skipped ? null : h.Item2)).ToList();
        return new TreasurySetupDto(s.Id, s.Status, s.OwnerAccountId, s.MaxPerPaymentUsd, s.DailyLimitUsd, s.AccountId,
            RequiredNear, MinimumNear, received, code.Sha256Hex, steps, s.LastError, s.CreatedAt, s.CompletedAt);
    }

    private sealed record LiveTreasury(TreasuryBalancesDto? Balances, OnChainGuardDto? Guard, IReadOnlyList<TreasuryCheckDto> Checks, OnChainConfig? Config);

    private async Task<LiveTreasury> ReadLiveAsync(string? account, string? agent, CancellationToken ct)
    {
        if (account is null)
        {
            return new LiveTreasury(null, null, [], null);
        }

        decimal? usdcBalance = null, nearBalance = null, agentNear = null;
        OnChainConfig? config = null;
        NearAccountState? state = null;
        bool? registered = null;
        try
        {
            var balances = await rpc.GetBalancesAsync(account, ct);
            usdcBalance = balances.Usdc;
            nearBalance = balances.Near;
            config = await chain.GetConfigAsync(account, ct);
            state = await accounts.GetAsync(account, ct);
            registered = await accounts.IsUsdcRegisteredAsync(account, ct);
            if (agent is not null)
            {
                agentNear = (await accounts.GetAsync(agent, ct))?.NearBalance ?? 0m;
            }
        }
        catch (ExternalServiceException ex)
        {
            LogReadFailed(logger, ex, account);
        }

        var guard = config is null ? null : new OnChainGuardDto(account, config.AgentId, DashboardService.Usdc(config.MaxPerPayment), DashboardService.Usdc(config.DailyLimit),
            DashboardService.Usdc(config.SpentToday), DashboardService.Usdc(config.RemainingToday), config.Paused);
        var checks = new List<TreasuryCheckDto>
        {
            new("contract", config is not null),
            new("agent", config is not null && agent is not null && config.AgentId == agent),
            new("locked", state is { AccessKeys: 0 }),
            new("usdcRegistered", registered == true),
            new("agentGas", agentNear >= AgentGasOk),
            new("funded", usdcBalance > 0),
            new("notPaused", config is { Paused: false }),
        };
        return new LiveTreasury(new TreasuryBalancesDto(usdcBalance, nearBalance, agentNear, clock.GetUtcNow()), guard, checks, config);
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Treasury creation failed for {Account}")]
    private static partial void LogDeployFailed(ILogger logger, Exception ex, string account);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Could not read treasury state for {Account}")]
    private static partial void LogReadFailed(ILogger logger, Exception ex, string account);
}

/// <summary>Funding from another chain or an exchange through NEAR Intents, and the on-chain movements (ADR-0007).</summary>
public sealed partial class TreasuryFundingService(
    IAppDbContext db,
    ITenantContext tenant,
    ITreasuryChain chain,
    IIntentsClient intents,
    INearIndexer indexer,
    TokenCatalogService tokens,
    IOptions<NearOptions> nearOptions,
    IMemoryCache cache,
    TimeProvider clock,
    ILogger<TreasuryFundingService> logger)
{
    private static readonly string[] ChainOrder = ["bsc", "eth", "tron", "sol", "arb", "base", "pol", "op", "avax", "near", "ton", "aptos", "sui", "gnosis", "stellar"];

    private static readonly Dictionary<string, string> ChainNames = new(StringComparer.OrdinalIgnoreCase)
    {
        ["bsc"] = "BNB Smart Chain (BEP20)",
        ["eth"] = "Ethereum (ERC20)",
        ["tron"] = "Tron (TRC20)",
        ["sol"] = "Solana (SPL)",
        ["arb"] = "Arbitrum One",
        ["base"] = "Base",
        ["pol"] = "Polygon PoS",
        ["op"] = "Optimism",
        ["avax"] = "Avalanche C-Chain",
        ["near"] = "NEAR",
        ["ton"] = "TON",
        ["aptos"] = "Aptos",
        ["sui"] = "Sui",
        ["gnosis"] = "Gnosis",
        ["stellar"] = "Stellar",
    };

    public static string ChainName(string chain) => ChainNames.TryGetValue(chain, out var name) ? name : chain.ToUpperInvariant();

    public async Task<FundingOptionsDto> OptionsAsync(CancellationToken ct)
    {
        var usdcAsset = "nep141:" + nearOptions.Value.UsdcContract;
        var all = await tokens.ListAsync(ct);
        var assets = all
            .Where(t => t.Symbol is "USDT" or "USDC" && t.AssetId != usdcAsset && ChainNames.ContainsKey(t.Blockchain))
            .GroupBy(t => (t.Symbol, t.Blockchain))
            .Select(g => g.OrderBy(t => t.AssetId.Length).First())
            .OrderBy(t => Array.IndexOf(ChainOrder, t.Blockchain) is var i && i < 0 ? 99 : i)
            .ThenBy(t => t.Symbol == "USDT" ? 0 : 1)
            .Select(t => new FundingAssetDto(t.AssetId, t.Symbol, t.Blockchain, ChainName(t.Blockchain), t.Decimals))
            .ToList();
        return new FundingOptionsDto(assets);
    }

    public async Task<FundingDto> CreateAsync(FundingInput input, Actor actor, CancellationToken ct)
    {
        if (tenant.IsDemo)
        {
            throw new ForbiddenException("The public demo never moves real money.");
        }

        var refund = (input.RefundAddress ?? string.Empty).Trim();
        new Validator()
            .Require(input.Amount > 0, "amount", "Must be greater than 0.")
            .Require(refund.Length is > 0 and <= 200, "refundAddress", "Enter the address where the money should return if the conversion fails.")
            .Require(!string.IsNullOrWhiteSpace(input.OriginAssetId), "originAssetId", "Choose the coin and network you will send.")
            .ThrowIfInvalid();

        var settings = await db.Settings.SingleAsync(ct);
        var treasury = settings.TreasuryAccountId;
        OnChainConfig? config = null;
        if (treasury is not null)
        {
            try
            {
                config = await chain.GetConfigAsync(treasury, ct);
            }
            catch (ExternalServiceException)
            {
                // treated as not ready below
            }
        }

        if (treasury is null || config is null || (chain.AgentAccountId is { } agent && config.AgentId != agent))
        {
            throw new ConflictException("Create your treasury first: funds can only be sent to a verified Tesorero treasury.");
        }

        var token = (await OptionsAsync(ct)).Assets.FirstOrDefault(a => a.AssetId == input.OriginAssetId);
        new Validator().Require(token is not null, "originAssetId", "This coin or network is not supported.").ThrowIfInvalid();

        var baseUnits = decimal.Round(input.Amount * Pow10(token!.Decimals), 0, MidpointRounding.ToZero);
        IntentsQuote quote;
        try
        {
            quote = await intents.QuoteAsync(new IntentsQuoteRequest(
                Dry: false,
                OriginAsset: token.AssetId,
                DestinationAsset: "nep141:" + nearOptions.Value.UsdcContract,
                AmountIn: baseUnits.ToString("0", CultureInfo.InvariantCulture),
                Recipient: treasury,
                RefundTo: refund,
                Deadline: clock.GetUtcNow().AddHours(1)), ct);
        }
        catch (ExternalServiceException ex)
        {
            var message = Clean(ex.Message);
            var field = message.Contains("refund", StringComparison.OrdinalIgnoreCase) ? "refundAddress"
                : message.Contains("amount", StringComparison.OrdinalIgnoreCase) || message.Contains("minimum", StringComparison.OrdinalIgnoreCase) || message.Contains("limit", StringComparison.OrdinalIgnoreCase) ? "amount"
                : "funding";
            throw new ValidationFailedException(new Dictionary<string, string[]> { [field] = [message] });
        }

        if (string.IsNullOrWhiteSpace(quote.DepositAddress))
        {
            throw new ExternalServiceException("NEAR Intents", "The quote did not include a deposit address.");
        }

        var now = clock.GetUtcNow();
        var funding = new TreasuryFunding
        {
            OriginAssetId = token.AssetId,
            Symbol = token.Symbol,
            Chain = token.Chain,
            AmountIn = input.Amount,
            ExpectedUsdc = decimal.TryParse(quote.AmountOutFormatted, NumberStyles.Float, CultureInfo.InvariantCulture, out var usdcOut) ? decimal.Round(usdcOut, 6) : 0m,
            DepositAddress = quote.DepositAddress,
            DepositMemo = quote.DepositMemo,
            Deadline = quote.Deadline ?? now.AddHours(1),
            RefundAddress = refund,
            TreasuryAccountId = treasury,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.TreasuryFundings.Add(funding);
        db.Record(clock, actor, "treasury.funding.created", "TreasuryFunding", funding.Id,
            $"Funding requested: {input.Amount} {token.Symbol} on {ChainName(token.Chain)} → ~{funding.ExpectedUsdc:N2} USDC into {treasury}. Deposit address {funding.DepositAddress}.");
        await db.SaveChangesAsync(ct);
        return ToDto(funding);
    }

    public async Task<IReadOnlyList<FundingDto>> ListAsync(CancellationToken ct)
    {
        var list = await db.TreasuryFundings.OrderByDescending(f => f.CreatedAt).Take(20).ToListAsync(ct);
        var now = clock.GetUtcNow();
        var changed = false;
        foreach (var f in list.Where(f => f.Status is FundingStatus.PendingDeposit or FundingStatus.Processing
                                          && (f.CheckedAt is null || now - f.CheckedAt > TimeSpan.FromSeconds(15))))
        {
            try
            {
                var status = await intents.GetStatusAsync(f.DepositAddress, ct);
                var next = status.Status switch
                {
                    "SUCCESS" => FundingStatus.Success,
                    "REFUNDED" => FundingStatus.Refunded,
                    "FAILED" => FundingStatus.Failed,
                    "PROCESSING" or "KNOWN_DEPOSIT_TX" or "INCOMPLETE_DEPOSIT" => FundingStatus.Processing,
                    _ => now > f.Deadline.AddMinutes(10) ? FundingStatus.Expired : FundingStatus.PendingDeposit,
                };
                f.CheckedAt = now;
                f.DestinationTxHash = status.DestinationTxHash ?? f.DestinationTxHash;
                if (next != f.Status)
                {
                    db.Record(clock, Actor.System, "treasury.funding." + next.ToString().ToLowerInvariant(), "TreasuryFunding", f.Id,
                        $"Funding of {f.AmountIn} {f.Symbol} on {ChainName(f.Chain)}: {next}.");
                    f.Status = next;
                    f.UpdatedAt = now;
                }

                changed = true;
            }
            catch (ExternalServiceException ex)
            {
                LogStatusFailed(logger, ex, f.DepositAddress);
            }
        }

        if (changed)
        {
            await db.SaveChangesAsync(ct);
        }

        return list.Select(ToDto).ToList();
    }

    public async Task<MovementsDto> MovementsAsync(CancellationToken ct)
    {
        var settings = await db.Settings.SingleAsync(ct);
        if (settings.TreasuryAccountId is not { } account)
        {
            return new MovementsDto(null, [], 0, null);
        }

        IReadOnlyList<IndexedTransfer> transfers;
        try
        {
            transfers = await cache.GetOrCreateAsync($"treasury-movements:{account}", async entry =>
            {
                entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(60);
                return await indexer.GetTransfersAsync(account, ct);
            }) ?? [];
        }
        catch (ExternalServiceException ex)
        {
            LogIndexerFailed(logger, ex, account);
            return new MovementsDto(account, [], 0, "The public NEAR indexer did not answer. Try again in a minute.");
        }

        var payments = await db.Payments.Where(p => p.OnChainTxHash != null)
            .Select(p => new { p.Id, p.OnChainTxHash, Reference = p.Bill!.Reference })
            .ToListAsync(ct);
        var byHash = payments.GroupBy(p => p.OnChainTxHash!).ToDictionary(g => g.Key, g => g.First());
        var setupHashes = (await db.TreasurySetups.Where(s => s.AccountId == account).ToListAsync(ct))
            .SelectMany(s => new[] { s.DeployTxHash, s.RegisterTxHash, s.AgentGasTxHash, s.LockTxHash })
            .Where(h => h is not null)
            .ToHashSet();
        var usdcContract = nearOptions.Value.UsdcContract;

        var items = transfers.Select(t =>
        {
            var isUsdc = t.TokenContract == usdcContract;
            var asset = isUsdc ? "USDC" : t.Asset;
            if (byHash.TryGetValue(t.TxHash, out var p))
            {
                return new MovementDto(t.TxHash, t.At, t.Incoming ? "in" : "out", asset, t.Amount, t.Counterparty, "payment", p.Id.ToString(), p.Reference, false);
            }

            if (setupHashes.Contains(t.TxHash))
            {
                return new MovementDto(t.TxHash, t.At, t.Incoming ? "in" : "out", asset, t.Amount, t.Counterparty, "setup", null, null, false);
            }

            if (t.Incoming)
            {
                return new MovementDto(t.TxHash, t.At, "in", asset, t.Amount, t.Counterparty, "funding", null, null, false);
            }

            // Money left the treasury and Tesorero did not send it: alert.
            return new MovementDto(t.TxHash, t.At, "out", asset, t.Amount, t.Counterparty, "other", null, null, true);
        }).ToList();
        return new MovementsDto(account, items, items.Count(i => i.Flagged), null);
    }

    private static FundingDto ToDto(TreasuryFunding f) => new(f.Id, f.OriginAssetId, f.Symbol, f.Chain, ChainName(f.Chain), f.AmountIn, f.ExpectedUsdc,
        f.DepositAddress, f.DepositMemo, f.Deadline, f.RefundAddress, f.Status, f.CreatedAt, f.UpdatedAt);

    private static string Clean(string message)
    {
        var m = message.StartsWith("NEAR Intents: ", StringComparison.Ordinal) ? message["NEAR Intents: ".Length..] : message;
        var http = m.LastIndexOf(" (HTTP ", StringComparison.Ordinal);
        return http > 0 ? m[..http] : m;
    }

    private static decimal Pow10(int n)
    {
        var r = 1m;
        for (var i = 0; i < n; i++)
        {
            r *= 10m;
        }

        return r;
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Funding status check failed for {DepositAddress}")]
    private static partial void LogStatusFailed(ILogger logger, Exception ex, string depositAddress);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Movements lookup failed for {Account}")]
    private static partial void LogIndexerFailed(ILogger logger, Exception ex, string account);
}
