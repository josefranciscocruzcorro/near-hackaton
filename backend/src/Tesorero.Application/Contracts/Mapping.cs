using Tesorero.Domain;

namespace Tesorero.Application.Contracts;

public static class Mapping
{
    public static UserDto ToDto(this User u) => new(u.Id, u.Email, u.Name, u.Role);

    public static UserAdminDto ToAdminDto(this User u) => new(u.Id, u.Email, u.Name, u.Role, u.IsActive, u.CreatedAt);

    public static PayeeDto ToDto(this Payee p) => new(
        p.Id, p.Name, p.Email, p.Category, p.DestinationAssetId, p.DestinationSymbol, p.DestinationChain,
        p.RecipientAddress, p.IsAllowlisted, p.Notes, p.CreatedAt, p.AddressChangedAt);

    public static BillDto ToDto(this Bill b) => new(
        b.Id, b.PayeeId, b.Payee?.Name ?? string.Empty, b.Reference, b.Description, b.AmountUsd, b.DueDate,
        b.Category, b.Status, b.Source, b.Flags, b.CreatedAt, b.CreatedBy);

    public static PolicyDto ToDto(this TreasuryPolicy p) => new(
        p.AgentEnabled, p.MaxPerPaymentUsd, p.ApprovalThresholdUsd, p.DailyLimitUsd, p.MonthlyLimitUsd,
        p.MinReserveUsd, p.RequireAllowlistedPayee, p.NewPayeeCooldownHours, p.PlanningHorizonDays,
        new Dictionary<Category, decimal>(p.CategoryBudgets), p.Version, p.UpdatedAt, p.UpdatedBy);

    public static PolicyReasonDto ToDto(this PolicyReason r) => new(r.Code, r.Message, r.Severity);

    public static AgentRunSummaryDto ToSummaryDto(this AgentRun r)
    {
        var (proposed, allowed, review, blocked) = Counts(r);
        return new AgentRunSummaryDto(r.Id, r.Trigger, r.Status, r.StartedAt, r.FinishedAt, r.Model, r.Summary,
            proposed, allowed, review, blocked);
    }

    public static AgentRunDto ToDto(this AgentRun r)
    {
        var (proposed, allowed, review, blocked) = Counts(r);
        return new AgentRunDto(r.Id, r.Trigger, r.Status, r.StartedAt, r.FinishedAt, r.Model, r.Summary,
            proposed, allowed, review, blocked, r.PromptTokens, r.CompletionTokens, r.Error,
            r.Decisions.Select(d => new AgentDecisionDto(d.BillId, d.BillReference, d.PayeeName, d.AmountUsd, d.PayNow,
                d.AiReason, d.PaymentId, d.PolicyOutcome, d.PolicyReasons.Select(x => x.ToDto()).ToList())).ToList());
    }

    private static (int Proposed, int Allowed, int Review, int Blocked) Counts(AgentRun r) => (
        r.Decisions.Count(d => d.PayNow),
        r.Decisions.Count(d => d.PolicyOutcome == PolicyOutcome.Allow),
        r.Decisions.Count(d => d.PolicyOutcome == PolicyOutcome.RequireApproval),
        r.Decisions.Count(d => d.PolicyOutcome == PolicyOutcome.Block));

    public static PaymentDto ToDto(this Payment p) => new(
        p.Id, p.BillId, p.Bill?.Reference ?? string.Empty, p.PayeeId, p.Payee?.Name ?? string.Empty, p.Category,
        p.AmountUsd, p.OriginAssetId, p.DestinationAssetId, p.DestinationSymbol, p.DestinationChain, p.Recipient,
        p.Status, p.PolicyOutcome, p.PolicyReasons.Select(r => r.ToDto()).ToList(), p.AiReason, p.Simulation,
        p.Quote is null ? null : new QuoteDto(p.Quote.AmountIn, p.Quote.AmountOut, p.Quote.AmountOutFormatted,
            p.Quote.AmountOutUsd, p.Quote.DepositAddress, p.Quote.Deadline, p.Quote.QuotedAt),
        p.DepositTxHash, p.IntentStatus, p.DecidedBy, p.DecidedAt, p.DecisionNote, p.CreatedAt, p.SettledAt,
        ExplorerUrl(p),
        p.OnChainTxHash,
        p.OnChainTxHash is { Length: > 0 } tx ? $"https://nearblocks.io/txns/{Uri.EscapeDataString(tx)}" : null,
        p.LastError);

    /// <summary>Public NEAR Intents explorer, searchable by deposit address.</summary>
    public static string? ExplorerUrl(Payment p) =>
        p.Quote?.DepositAddress is { Length: > 0 } address
            ? $"https://explorer.near-intents.org/transactions/{Uri.EscapeDataString(address)}"
            : null;

    public static AuditEventDto ToDto(this AuditEvent e) =>
        new(e.Id, e.At, e.Actor, e.ActorType, e.Action, e.EntityType, e.EntityId, e.Summary);
}
