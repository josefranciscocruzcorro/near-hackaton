namespace Tesorero.Domain;

/// <summary>Rows that belong to one organization. EF Core filters and stamps them by the request's tenant (ADR-0006).</summary>
public interface ITenantOwned
{
    Guid TenantId { get; set; }
}

/// <summary>An organization, reached at <c>&lt;Slug&gt;.tesorero.gesco.ec</c>.</summary>
public sealed class Tenant
{
    public static readonly Guid DemoId = new("00000000-0000-0000-0000-00000000de30");
    public const string DemoSlug = "demo";

    public Guid Id { get; set; } = Guid.NewGuid();
    public required string Slug { get; set; }
    public required string Name { get; set; }
    public bool IsDemo { get; set; }

    /// <summary>E-mail verified at signup; the first Owner must use it.</summary>
    public string? OwnerEmail { get; set; }
    public string? NearAccountId { get; set; }

    /// <summary>Language chosen at signup ("en"/"es"): default UI language and language of scheduled agent runs.</summary>
    public string? Language { get; set; }

    /// <summary>SHA-256 (hex) of the one-time setup token, cleared once the first Owner exists.</summary>
    public string? SetupTokenHash { get; set; }
    public DateTimeOffset? SetupTokenExpiresAt { get; set; }

    /// <summary>Server-generated NEAR agent account; its key is stored encrypted (AES-256-GCM) and never exposed.</summary>
    public string? AgentAccountId { get; set; }
    public string? AgentKeyCiphertext { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>A signup waiting for its e-mail to be verified. No tenant exists until then.</summary>
public sealed class PendingSignup
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public required string TokenHash { get; set; }
    public required string OrganizationName { get; set; }
    public required string Slug { get; set; }
    public required string OwnerName { get; set; }
    public required string Email { get; set; }
    public required string NearAccountId { get; set; }
    public string Language { get; set; } = "en";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? VerifiedAt { get; set; }
    public Guid? TenantId { get; set; }
}

public sealed class User : ITenantOwned
{
    public Guid TenantId { get; set; }

    public Guid Id { get; set; } = Guid.NewGuid();
    public required string Email { get; set; }
    public required string Name { get; set; }
    public Role Role { get; set; }
    public string PasswordHash { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class Payee : ITenantOwned
{
    public Guid TenantId { get; set; }

    public Guid Id { get; set; } = Guid.NewGuid();
    public required string Name { get; set; }
    public string? Email { get; set; }
    public Category Category { get; set; }
    public required string DestinationAssetId { get; set; }
    public required string DestinationSymbol { get; set; }
    public required string DestinationChain { get; set; }
    public required string RecipientAddress { get; set; }
    public bool IsAllowlisted { get; set; }
    public string? Notes { get; set; }
    public bool IsArchived { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? AddressChangedAt { get; set; }

    /// <summary>
    /// Updates where money goes. Any change resets the trust clock (cool-down policy).
    /// </summary>
    public void SetDestination(string assetId, string symbol, string chain, string recipientAddress, DateTimeOffset now)
    {
        var changed = !string.Equals(DestinationAssetId, assetId, StringComparison.Ordinal)
            || !string.Equals(RecipientAddress, recipientAddress, StringComparison.Ordinal);
        DestinationAssetId = assetId;
        DestinationSymbol = symbol;
        DestinationChain = chain;
        RecipientAddress = recipientAddress;
        if (changed)
        {
            AddressChangedAt = now;
        }
    }

    /// <summary>The moment since which this payee's destination has been stable.</summary>
    public DateTimeOffset TrustedSince => AddressChangedAt is { } changed && changed > CreatedAt ? changed : CreatedAt;
}

public sealed class Bill : ITenantOwned
{
    public Guid TenantId { get; set; }

    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid PayeeId { get; set; }
    public Payee? Payee { get; set; }
    public required string Reference { get; set; }
    public required string Description { get; set; }
    public decimal AmountUsd { get; set; }
    public DateOnly DueDate { get; set; }
    public Category Category { get; set; }
    public BillStatus Status { get; set; } = BillStatus.Open;
    public BillSource Source { get; set; } = BillSource.Manual;
    public List<BillFlag> Flags { get; set; } = [];
    public Guid? ExtractionId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public required string CreatedBy { get; set; }
}

public sealed class BillExtraction : ITenantOwned
{
    public Guid TenantId { get; set; }

    public Guid Id { get; set; } = Guid.NewGuid();
    public required string SourceText { get; set; }
    public required string ResultJson { get; set; }
    public List<BillFlag> Flags { get; set; } = [];
    public Guid? MatchedPayeeId { get; set; }
    public string? Model { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public required string CreatedBy { get; set; }
}

public sealed class TreasuryPolicy : ITenantOwned
{
    public Guid TenantId { get; set; }

    public Guid Id { get; set; } = Guid.NewGuid();
    public bool AgentEnabled { get; set; } = true;
    public decimal MaxPerPaymentUsd { get; set; }
    public decimal ApprovalThresholdUsd { get; set; }
    public decimal DailyLimitUsd { get; set; }
    public decimal MonthlyLimitUsd { get; set; }
    public decimal MinReserveUsd { get; set; }
    public bool RequireAllowlistedPayee { get; set; } = true;
    public int NewPayeeCooldownHours { get; set; }
    public int PlanningHorizonDays { get; set; }
    public Dictionary<Category, decimal> CategoryBudgets { get; set; } = [];
    public int Version { get; set; } = 1;
    public DateTimeOffset UpdatedAt { get; set; }
    public string UpdatedBy { get; set; } = "system";

    /// <summary>Starting guardrails for a real organization: small limits until the owner raises them.</summary>
    public static TreasuryPolicy Conservative(Guid tenantId, DateTimeOffset now) => new()
    {
        TenantId = tenantId,
        AgentEnabled = true,
        MaxPerPaymentUsd = 500,
        ApprovalThresholdUsd = 100,
        DailyLimitUsd = 1000,
        MonthlyLimitUsd = 5000,
        MinReserveUsd = 0,
        RequireAllowlistedPayee = true,
        NewPayeeCooldownHours = 48,
        PlanningHorizonDays = 7,
        CategoryBudgets = new()
        {
            [Category.Supplier] = 2000, [Category.Contractor] = 2000, [Category.Payroll] = 3000,
            [Category.Software] = 500, [Category.Operations] = 1000, [Category.Marketing] = 500,
        },
        UpdatedAt = now,
    };
}

public sealed class OrganizationSettings : ITenantOwned
{
    public Guid TenantId { get; set; }

    public Guid Id { get; set; } = Guid.NewGuid();
    public required string OrganizationName { get; set; }
    public string? TreasuryAccountId { get; set; }
    public ExecutionMode ExecutionMode { get; set; } = ExecutionMode.Simulation;
}

public sealed class TreasurySnapshot : ITenantOwned
{
    public Guid TenantId { get; set; }

    public Guid Id { get; set; } = Guid.NewGuid();
    public required string AccountId { get; set; }
    public decimal? UsdcBalance { get; set; }
    public decimal? NearBalance { get; set; }
    public DateTimeOffset CapturedAt { get; set; }
}

public sealed class TokenInfo
{
    public required string AssetId { get; set; }
    public required string Symbol { get; set; }
    public required string Blockchain { get; set; }
    public int Decimals { get; set; }
    public decimal? PriceUsd { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed record PolicyReason(string Code, string Message, string Severity);

public sealed class AgentDecision
{
    public Guid BillId { get; set; }
    public string BillReference { get; set; } = string.Empty;
    public string PayeeName { get; set; } = string.Empty;
    public decimal AmountUsd { get; set; }
    public bool PayNow { get; set; }
    public string AiReason { get; set; } = string.Empty;
    public Guid? PaymentId { get; set; }
    public PolicyOutcome? PolicyOutcome { get; set; }
    public List<PolicyReason> PolicyReasons { get; set; } = [];
}

public sealed class AgentRun : ITenantOwned
{
    public Guid TenantId { get; set; }

    public Guid Id { get; set; } = Guid.NewGuid();
    public AgentTrigger Trigger { get; set; }
    public AgentRunStatus Status { get; set; } = AgentRunStatus.Running;
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset? FinishedAt { get; set; }
    public string? Model { get; set; }
    public string? Summary { get; set; }
    public int PromptTokens { get; set; }
    public int CompletionTokens { get; set; }

    /// <summary>Language the AI writes its summary and reasons in ("en"/"es").</summary>
    public string? Language { get; set; }
    public string? Error { get; set; }
    public List<AgentDecision> Decisions { get; set; } = [];
}

public sealed class PaymentQuote
{
    public string AmountIn { get; set; } = string.Empty;
    public string AmountOut { get; set; } = string.Empty;
    public string AmountOutFormatted { get; set; } = string.Empty;
    public decimal? AmountOutUsd { get; set; }
    public string? DepositAddress { get; set; }
    public DateTimeOffset? Deadline { get; set; }
    public DateTimeOffset QuotedAt { get; set; }
}

public sealed class Payment : ITenantOwned
{
    public Guid TenantId { get; set; }

    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid BillId { get; set; }
    public Bill? Bill { get; set; }
    public Guid PayeeId { get; set; }
    public Payee? Payee { get; set; }
    public Guid? AgentRunId { get; set; }
    public decimal AmountUsd { get; set; }
    public Category Category { get; set; }
    public required string OriginAssetId { get; set; }
    public required string DestinationAssetId { get; set; }
    public required string DestinationSymbol { get; set; }
    public required string DestinationChain { get; set; }
    public required string Recipient { get; set; }
    public PaymentStatus Status { get; set; }
    public PolicyOutcome PolicyOutcome { get; set; }
    public List<PolicyReason> PolicyReasons { get; set; } = [];
    public string? AiReason { get; set; }
    public bool Simulation { get; set; } = true;
    public PaymentQuote? Quote { get; set; }
    public string? DepositTxHash { get; set; }

    /// <summary>NEAR transaction in which the agent called <c>treasury.pay</c> (autonomous Live mode).</summary>
    public string? OnChainTxHash { get; set; }
    public string? IntentStatus { get; set; }
    public string? DecidedBy { get; set; }
    public DateTimeOffset? DecidedAt { get; set; }
    public string? DecisionNote { get; set; }
    public string? LastError { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? SettledAt { get; set; }

    /// <summary>Statuses that commit treasury funds (count against limits and budgets).</summary>
    public static readonly IReadOnlyList<PaymentStatus> CommittedStatuses =
    [
        PaymentStatus.PendingApproval,
        PaymentStatus.Approved,
        PaymentStatus.AwaitingDeposit,
        PaymentStatus.Processing,
        PaymentStatus.Settled,
    ];

    /// <summary>Statuses that mean the bill is already handled and must not be proposed again.</summary>
    public static readonly IReadOnlyList<PaymentStatus> HandledStatuses =
    [
        PaymentStatus.PendingApproval,
        PaymentStatus.Approved,
        PaymentStatus.AwaitingDeposit,
        PaymentStatus.Processing,
        PaymentStatus.Settled,
        PaymentStatus.Rejected,
    ];
}

public sealed class AuditEvent : ITenantOwned
{
    public Guid TenantId { get; set; }

    public Guid Id { get; set; } = Guid.NewGuid();
    public DateTimeOffset At { get; set; }
    public required string Actor { get; set; }
    public ActorType ActorType { get; set; }
    public required string Action { get; set; }
    public required string EntityType { get; set; }
    public string? EntityId { get; set; }
    public required string Summary { get; set; }
}

/// <summary>
/// The app-driven creation of an organization's treasury contract (ADR-0007). The one-time deploy key is
/// encrypted while it exists and erased (in the database and on-chain) once the contract is locked.
/// </summary>
public sealed class TreasurySetup : ITenantOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public required string OwnerAccountId { get; set; }
    public decimal MaxPerPaymentUsd { get; set; }
    public decimal DailyLimitUsd { get; set; }

    /// <summary>Implicit account (64 hex) of the deploy key: becomes the treasury contract.</summary>
    public required string AccountId { get; set; }
    public string? DeployKeyCiphertext { get; set; }
    public TreasurySetupStatus Status { get; set; } = TreasurySetupStatus.AwaitingFunds;
    public string? DeployTxHash { get; set; }
    public string? RegisterTxHash { get; set; }
    public string? AgentGasTxHash { get; set; }
    public string? LockTxHash { get; set; }
    public string? LastError { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
}

/// <summary>Funding of the treasury from another chain or an exchange through NEAR Intents (ADR-0007).</summary>
public sealed class TreasuryFunding : ITenantOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public required string OriginAssetId { get; set; }
    public required string Symbol { get; set; }
    public required string Chain { get; set; }
    public decimal AmountIn { get; set; }
    public decimal ExpectedUsdc { get; set; }
    public required string DepositAddress { get; set; }
    public string? DepositMemo { get; set; }
    public DateTimeOffset Deadline { get; set; }
    public required string RefundAddress { get; set; }
    public required string TreasuryAccountId { get; set; }
    public FundingStatus Status { get; set; } = FundingStatus.PendingDeposit;
    public string? DestinationTxHash { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset? CheckedAt { get; set; }
}
