namespace Tesorero.Domain;

public enum Role
{
    Owner,
    Approver,
    Auditor,
}

public enum Category
{
    Supplier,
    Contractor,
    Payroll,
    Software,
    Operations,
    Marketing,
}

public enum BillStatus
{
    Open,
    Scheduled,
    Paid,
    Cancelled,
}

public enum BillSource
{
    Manual,
    AiExtracted,
}

public enum BillFlag
{
    PaymentDetailsMismatch,
    SuspiciousInstructions,
}

public enum PaymentStatus
{
    PendingApproval,
    Approved,
    Blocked,
    Rejected,
    AwaitingDeposit,
    Processing,
    Settled,
    Refunded,
    Failed,
}

public enum PolicyOutcome
{
    Allow,
    RequireApproval,
    Block,
}

public enum ExecutionMode
{
    Simulation,
    Live,
}

public enum AgentTrigger
{
    Scheduled,
    Manual,

    /// <summary>Simulates a compromised agent that tries to pay every bill. Evaluated by policy only; no payments are created.</summary>
    RedTeamDrill,
}

public enum AgentRunStatus
{
    Running,
    Completed,
    Failed,
}

public enum ActorType
{
    User,
    Agent,
    System,
}

/// <summary>Treasury contract created from the app with a one-time key (ADR-0007).</summary>
public enum TreasurySetupStatus
{
    AwaitingFunds,
    Deploying,
    Ready,
    Failed,
}

/// <summary>A funding of the treasury through NEAR Intents (any chain → USDC on NEAR).</summary>
public enum FundingStatus
{
    PendingDeposit,
    Processing,
    Success,
    Refunded,
    Failed,
    Expired,
}
