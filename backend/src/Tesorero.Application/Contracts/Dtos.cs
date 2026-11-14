using Tesorero.Domain;

namespace Tesorero.Application.Contracts;

// Shapes mirror docs/api/CONTRACT.md one-to-one. Change the contract first.

public sealed record UserDto(Guid Id, string Email, string Name, Role Role);

public sealed record LoginRequest(string Email, string Password);

public sealed record LoginResponse(string Token, DateTimeOffset ExpiresAt, UserDto User);

public sealed record TokenDto(string AssetId, string Symbol, string Blockchain, int Decimals, decimal? PriceUsd);

public sealed record PayeeInput(
    string Name,
    string? Email,
    Category Category,
    string DestinationAssetId,
    string RecipientAddress,
    bool IsAllowlisted,
    string? Notes);

public sealed record PayeeDto(
    Guid Id,
    string Name,
    string? Email,
    Category Category,
    string DestinationAssetId,
    string DestinationSymbol,
    string DestinationChain,
    string RecipientAddress,
    bool IsAllowlisted,
    string? Notes,
    DateTimeOffset CreatedAt,
    DateTimeOffset? AddressChangedAt);

public sealed record BillInput(
    Guid PayeeId,
    string Reference,
    string Description,
    decimal AmountUsd,
    DateOnly DueDate,
    Category Category,
    Guid? ExtractionId);

public sealed record BillDto(
    Guid Id,
    Guid PayeeId,
    string PayeeName,
    string Reference,
    string Description,
    decimal AmountUsd,
    DateOnly DueDate,
    Category Category,
    BillStatus Status,
    BillSource Source,
    IReadOnlyList<BillFlag> Flags,
    DateTimeOffset CreatedAt,
    string CreatedBy);

public sealed record ExtractRequest(string Text);

public sealed record PaymentInstructionsDto(string? Chain, string? Token, string? Address);

public sealed record ExtractedFieldsDto(
    string? PayeeName,
    decimal? AmountUsd,
    string? Currency,
    DateOnly? DueDate,
    string? Reference,
    string? Description,
    Category? Category,
    PaymentInstructionsDto? PaymentInstructions);

public sealed record WarningDto(string Code, string Message);

public sealed record ExtractionDto(
    Guid ExtractionId,
    ExtractedFieldsDto Fields,
    Guid? MatchedPayeeId,
    IReadOnlyList<BillFlag> Flags,
    IReadOnlyList<WarningDto> Warnings);

public sealed record PolicyInput(
    bool AgentEnabled,
    decimal MaxPerPaymentUsd,
    decimal ApprovalThresholdUsd,
    decimal DailyLimitUsd,
    decimal MonthlyLimitUsd,
    decimal MinReserveUsd,
    bool RequireAllowlistedPayee,
    int NewPayeeCooldownHours,
    int PlanningHorizonDays,
    Dictionary<Category, decimal> CategoryBudgets);

public sealed record PolicyDto(
    bool AgentEnabled,
    decimal MaxPerPaymentUsd,
    decimal ApprovalThresholdUsd,
    decimal DailyLimitUsd,
    decimal MonthlyLimitUsd,
    decimal MinReserveUsd,
    bool RequireAllowlistedPayee,
    int NewPayeeCooldownHours,
    int PlanningHorizonDays,
    Dictionary<Category, decimal> CategoryBudgets,
    int Version,
    DateTimeOffset UpdatedAt,
    string UpdatedBy);

public sealed record PolicyReasonDto(string Code, string Message, string Severity);

public sealed record AgentDecisionDto(
    Guid BillId,
    string BillReference,
    string PayeeName,
    decimal AmountUsd,
    bool PayNow,
    string AiReason,
    Guid? PaymentId,
    PolicyOutcome? PolicyOutcome,
    IReadOnlyList<PolicyReasonDto> PolicyReasons);

public sealed record AgentRunSummaryDto(
    Guid Id,
    AgentTrigger Trigger,
    AgentRunStatus Status,
    DateTimeOffset StartedAt,
    DateTimeOffset? FinishedAt,
    string? Model,
    string? Summary,
    int Proposed,
    int Allowed,
    int NeedsApproval,
    int Blocked);

public sealed record AgentRunDto(
    Guid Id,
    AgentTrigger Trigger,
    AgentRunStatus Status,
    DateTimeOffset StartedAt,
    DateTimeOffset? FinishedAt,
    string? Model,
    string? Summary,
    int Proposed,
    int Allowed,
    int NeedsApproval,
    int Blocked,
    int PromptTokens,
    int CompletionTokens,
    string? Error,
    IReadOnlyList<AgentDecisionDto> Decisions);

public sealed record QuoteDto(
    string AmountIn,
    string AmountOut,
    string AmountOutFormatted,
    decimal? AmountOutUsd,
    string? DepositAddress,
    DateTimeOffset? Deadline,
    DateTimeOffset QuotedAt);

public sealed record PaymentDto(
    Guid Id,
    Guid BillId,
    string BillReference,
    Guid PayeeId,
    string PayeeName,
    Category Category,
    decimal AmountUsd,
    string OriginAssetId,
    string DestinationAssetId,
    string DestinationSymbol,
    string DestinationChain,
    string Recipient,
    PaymentStatus Status,
    PolicyOutcome PolicyOutcome,
    IReadOnlyList<PolicyReasonDto> PolicyReasons,
    string? AiReason,
    bool Simulation,
    QuoteDto? Quote,
    string? DepositTxHash,
    string? IntentStatus,
    string? DecidedBy,
    DateTimeOffset? DecidedAt,
    string? DecisionNote,
    DateTimeOffset CreatedAt,
    DateTimeOffset? SettledAt,
    string? ExplorerUrl,
    string? OnChainTxHash,
    string? OnChainTxUrl,
    string? LastError);

public sealed record DecisionRequest(string? Note);

public enum AgentRunMode
{
    Plan,
    RedTeamDrill,
}

public sealed record AgentRunRequest(AgentRunMode? Mode);

public sealed record DepositRequest(string TxHash);

public sealed record TreasuryDto(
    bool Configured,
    string? AccountId,
    string Network,
    decimal? UsdcBalance,
    decimal? NearBalance,
    DateTimeOffset? UpdatedAt,
    OnChainGuardDto? OnChain);

public sealed record OnChainGuardDto(
    string ContractId,
    string? AgentId,
    decimal MaxPerPayment,
    decimal DailyLimit,
    decimal SpentToday,
    decimal RemainingToday,
    bool Paused);

public sealed record SpendDto(decimal Today, decimal DailyLimit, decimal Month, decimal MonthlyLimit);

public sealed record CategoryBudgetDto(Category Category, decimal Spent, decimal Budget);

public sealed record DashboardDto(
    TreasuryDto Treasury,
    SpendDto Spend,
    IReadOnlyList<CategoryBudgetDto> CategoryBudgets,
    int PendingApprovals,
    IReadOnlyList<BillDto> UpcomingBills,
    IReadOnlyList<PaymentDto> RecentPayments,
    AgentRunSummaryDto? LastAgentRun,
    ExecutionMode ExecutionMode,
    bool AgentEnabled);

public sealed record AuditEventDto(
    Guid Id,
    DateTimeOffset At,
    string Actor,
    ActorType ActorType,
    string Action,
    string EntityType,
    string? EntityId,
    string Summary);

public sealed record SettingsDto(string OrganizationName, string? TreasuryAccountId, ExecutionMode ExecutionMode, string Network, bool Demo, string? AgentAccountId, TreasuryBalanceDto? TreasuryBalance = null);

/// <summary>Latest balances read from NEAR mainnet for the treasury account (refreshed on every settings save).</summary>
public sealed record TreasuryBalanceDto(decimal? Usdc, decimal? Near, DateTimeOffset CapturedAt);

public sealed record InstanceDto(
    string Kind,
    bool Demo,
    bool NeedsSetup,
    bool SetupTokenRequired,
    string? OrganizationName,
    string? TenantSlug,
    string BaseDomain,
    string DemoUrl,
    string LandingUrl,
    string? Language = null);

public sealed record SignupRequest(
    string OrganizationName,
    string Slug,
    string OwnerName,
    string Email,
    string NearAccountId,
    string? Language,
    bool AcceptTerms,
    string? Website);

public sealed record SignupAccepted(string Email);

public sealed record SlugCheckDto(string Slug, bool Available, string? Reason);

public sealed record NearCheckDto(string AccountId, bool Exists, bool Valid);

public sealed record VerifyRequest(string Token);

public sealed record VerifyResultDto(string OrganizationName, string Slug, string TenantUrl, string Email);

public sealed record SetupRequest(string OrganizationName, string OwnerName, string Email, string Password, string? SetupToken);

public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);

public sealed record UserAdminDto(Guid Id, string Email, string Name, Role Role, bool IsActive, DateTimeOffset CreatedAt);

public sealed record CreateUserRequest(string Email, string Name, Role Role, string Password);

public sealed record UpdateUserRequest(string Name, Role Role, bool IsActive);

public sealed record ResetPasswordRequest(string NewPassword);

public sealed record SettingsInput(string OrganizationName, string? TreasuryAccountId, ExecutionMode ExecutionMode);

public sealed record VersionDto(string Version, string Commit, string BuiltAt);

// ---------- Treasury on-chain (ADR-0007) ----------

public sealed record TreasuryOverviewDto(
    string? TreasuryAccountId,
    string? OwnerAccountId,
    string? AgentAccountId,
    string UsdcContractId,
    ExecutionMode ExecutionMode,
    bool Demo,
    TreasurySetupDto? Setup,
    TreasuryBalancesDto? Balances,
    OnChainGuardDto? OnChain,
    IReadOnlyList<TreasuryCheckDto> Checks,
    bool ReadyForLive,
    string? SuggestedOwnerAccountId = null);

public sealed record TreasuryBalancesDto(decimal? TreasuryUsdc, decimal? TreasuryNear, decimal? AgentNear, DateTimeOffset ReadAt);

public sealed record TreasuryCheckDto(string Id, bool Ok);

public sealed record TreasurySetupInput(string? OwnerAccountId, decimal MaxPerPayment, decimal DailyLimit);

public sealed record TreasurySetupStepDto(string Id, string Status, string? TxHash);

public sealed record TreasurySetupDto(
    Guid Id,
    TreasurySetupStatus Status,
    string OwnerAccountId,
    decimal MaxPerPayment,
    decimal DailyLimit,
    string AccountId,
    decimal RequiredNear,
    decimal MinimumNear,
    decimal? ReceivedNear,
    string CodeHash,
    IReadOnlyList<TreasurySetupStepDto> Steps,
    string? LastError,
    DateTimeOffset CreatedAt,
    DateTimeOffset? CompletedAt);

public sealed record FundingAssetDto(string AssetId, string Symbol, string Chain, string ChainName, int Decimals);

public sealed record FundingOptionsDto(IReadOnlyList<FundingAssetDto> Assets);

public sealed record FundingInput(string? OriginAssetId, decimal Amount, string? RefundAddress);

public sealed record FundingDto(
    Guid Id,
    string OriginAssetId,
    string Symbol,
    string Chain,
    string ChainName,
    decimal AmountIn,
    decimal ExpectedUsdc,
    string DepositAddress,
    string? DepositMemo,
    DateTimeOffset Deadline,
    string RefundAddress,
    FundingStatus Status,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record MovementDto(
    string TxHash,
    DateTimeOffset At,
    string Direction,
    string Asset,
    decimal Amount,
    string? Counterparty,
    string Kind,
    string? PaymentId,
    string? Reference,
    bool Flagged);

public sealed record MovementsDto(string? AccountId, IReadOnlyList<MovementDto> Items, int Alerts, string? Error);
