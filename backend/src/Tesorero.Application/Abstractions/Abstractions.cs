using Microsoft.EntityFrameworkCore;
using Tesorero.Domain;

namespace Tesorero.Application.Abstractions;

public interface IAppDbContext
{
    DbSet<User> Users { get; }
    DbSet<Payee> Payees { get; }
    DbSet<Bill> Bills { get; }
    DbSet<BillExtraction> BillExtractions { get; }
    DbSet<TreasuryPolicy> Policies { get; }
    DbSet<OrganizationSettings> Settings { get; }
    DbSet<TreasurySnapshot> TreasurySnapshots { get; }
    DbSet<TokenInfo> Tokens { get; }
    DbSet<AgentRun> AgentRuns { get; }
    DbSet<Payment> Payments { get; }
    DbSet<AuditEvent> AuditEvents { get; }
    DbSet<Tenant> Tenants { get; }
    DbSet<PendingSignup> PendingSignups { get; }
    DbSet<TreasurySetup> TreasurySetups { get; }
    DbSet<TreasuryFunding> TreasuryFundings { get; }

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}

// ---------- LLM ----------
public sealed record LlmRequest(string Model, string SystemPrompt, string UserPrompt, double Temperature = 0.1);

public sealed record LlmResponse(string Content, string Model, int PromptTokens, int CompletionTokens);

public interface ILlmClient
{
    /// <summary>Returns a JSON object (as text) produced by the model.</summary>
    Task<LlmResponse> CompleteJsonAsync(LlmRequest request, CancellationToken cancellationToken);
}

// ---------- NEAR Intents (1Click) ----------
public sealed record IntentsToken(string AssetId, string Symbol, string Blockchain, int Decimals, decimal? PriceUsd);

public sealed record IntentsQuoteRequest(
    bool Dry,
    string OriginAsset,
    string DestinationAsset,
    string AmountIn,
    string Recipient,
    string RefundTo,
    DateTimeOffset Deadline);

public sealed record IntentsQuote(
    string AmountIn,
    string AmountOut,
    string AmountOutFormatted,
    decimal? AmountOutUsd,
    string? DepositAddress,
    DateTimeOffset? Deadline,
    string? DepositMemo = null);

public sealed record IntentsStatus(string Status, string? DestinationTxHash);

public interface IIntentsClient
{
    Task<IReadOnlyList<IntentsToken>> GetTokensAsync(CancellationToken cancellationToken);
    Task<IntentsQuote> QuoteAsync(IntentsQuoteRequest request, CancellationToken cancellationToken);
    Task SubmitDepositAsync(string depositAddress, string txHash, CancellationToken cancellationToken);
    Task<IntentsStatus> GetStatusAsync(string depositAddress, CancellationToken cancellationToken);
}

/// <summary>Raised when an external provider rejects or fails a request.</summary>
public sealed class ExternalServiceException(string service, string message, Exception? inner = null)
    : Exception($"{service}: {message}", inner)
{
    public string Service { get; } = service;
}

// ---------- NEAR RPC ----------
public sealed record TreasuryBalances(decimal? Usdc, decimal? Near);

public interface INearRpcClient
{
    Task<TreasuryBalances> GetBalancesAsync(string accountId, CancellationToken cancellationToken);

    /// <summary>True if the account exists on NEAR mainnet (view_account succeeds).</summary>
    Task<bool> AccountExistsAsync(string accountId, CancellationToken cancellationToken);
}

// ---------- Background jobs ----------
public interface IJobScheduler
{
    void EnqueueAgentRun(Guid runId);
    void EnqueuePaymentExecution(Guid paymentId);
}

// ---------- Treasury smart contract on NEAR (ADR-0005) ----------
/// <summary>Raw on-chain guard state. Amounts in USDC base units (6 decimals).</summary>
public sealed record OnChainConfig(
    string OwnerId,
    string? AgentId,
    string UsdcContractId,
    UInt128 MaxPerPayment,
    UInt128 DailyLimit,
    bool Paused,
    UInt128 SpentToday,
    UInt128 RemainingToday);

public sealed record OnChainPayment(string PaymentId, string DepositAddress, UInt128 Amount, string Status);

/// <summary>Outcome of a transaction signed by the agent key.</summary>
public sealed record ChainTxResult(string TxHash, bool Success, string? Error);

public interface ITreasuryChain
{
    /// <summary>The agent account whose key the server holds, or null when Live runs in manual mode.</summary>
    string? AgentAccountId { get; }

    Task<OnChainConfig?> GetConfigAsync(string contractId, CancellationToken cancellationToken);

    Task<OnChainPayment?> GetPaymentAsync(string contractId, string paymentId, CancellationToken cancellationToken);

    Task<ChainTxResult> PayAsync(string contractId, string paymentId, string depositAddress, UInt128 amount, CancellationToken cancellationToken);

    Task<ChainTxResult> PauseAsync(string contractId, CancellationToken cancellationToken);
}

// ---------- Multitenancy (ADR-0006) ----------
/// <summary>The organization the current request (or background job) acts for.</summary>
public interface ITenantContext
{
    Tenant? Tenant { get; }

    /// <summary>True on the public landing (apex domain): no tenant data is reachable.</summary>
    bool IsLanding { get; }

    Guid TenantId => Tenant?.Id ?? throw new InvalidOperationException("No tenant for this request.");

    bool IsDemo => Tenant?.IsDemo ?? false;

    void Set(Tenant tenant);

    void SetLanding();
}

/// <summary>Encrypts tenant secrets (agent keys) with the server's master key.</summary>
public interface ISecretVault
{
    string Protect(string plaintext);
    string Unprotect(string ciphertext);
}

public sealed record EmailMessage(string To, string Subject, string Html, string Text);

public interface IEmailSender
{
    Task SendAsync(EmailMessage message, CancellationToken cancellationToken);
}

// ---------- Treasury provisioning and monitoring (ADR-0007) ----------

/// <summary>An action of a NEAR transaction, independent of the wire format.</summary>
public abstract record ChainAction;

public sealed record ChainCall(string Method, string ArgsJson, ulong Gas, UInt128 Deposit) : ChainAction;

public sealed record ChainDeploy(byte[] Code) : ChainAction;

public sealed record ChainTransfer(UInt128 Yocto) : ChainAction;

/// <summary>Deletes the access key <paramref name="PublicKey"/> ("ed25519:…") from the signer account.</summary>
public sealed record ChainDeleteKey(string PublicKey) : ChainAction;

/// <summary>On-chain state of an account. <paramref name="CodeHash"/> is base58; "11111111111111111111111111111111" means no code.</summary>
public sealed record NearAccountState(decimal NearBalance, string CodeHash, int AccessKeys);

/// <summary>Raw account operations for creating a treasury with a one-time key (ADR-0007).</summary>
public interface INearAccounts
{
    /// <summary>Null when the account does not exist (e.g. an implicit account that never received NEAR).</summary>
    Task<NearAccountState?> GetAsync(string accountId, CancellationToken cancellationToken);

    Task<bool> IsUsdcRegisteredAsync(string accountId, CancellationToken cancellationToken);

    /// <summary>Signs with <paramref name="secretKey"/> as <paramref name="signerId"/> and waits for execution. Returns the tx hash; throws on rejection or failure.</summary>
    Task<string> SendAsync(string signerId, string secretKey, string receiverId, IReadOnlyList<ChainAction> actions, CancellationToken cancellationToken);

    string PublicKeyOf(string secretKey);
}

/// <summary>The audited treasury contract wasm shipped with the server.</summary>
public interface ITreasuryCode
{
    byte[] Wasm { get; }

    /// <summary>sha256 of the wasm, lowercase hex (what the app shows).</summary>
    string Sha256Hex { get; }

    /// <summary>The same hash in base58 (what <c>view_account.code_hash</c> returns).</summary>
    string Sha256Base58 { get; }
}

/// <summary>One NEAR or fungible-token transfer touching an account, from a public indexer.</summary>
public sealed record IndexedTransfer(string TxHash, DateTimeOffset At, bool Incoming, string Asset, string? TokenContract, decimal Amount, string? Counterparty);

public interface INearIndexer
{
    Task<IReadOnlyList<IndexedTransfer>> GetTransfersAsync(string accountId, CancellationToken cancellationToken);
}

