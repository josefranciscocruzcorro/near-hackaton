using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Tesorero.Domain;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Testcontainers.PostgreSql;
using Tesorero.Application.Abstractions;
using Tesorero.Application.Contracts;
using Tesorero.Application.Services;

namespace Tesorero.IntegrationTests.Infrastructure;

/// <summary>Public demo instance (seeded data, Live forbidden).</summary>
public sealed class TesoreroFactory : TesoreroFactoryBase
{
    protected override bool SeedDemoData => true;
    protected override bool DemoInstance => true;
}

/// <summary>A real (Live-capable) tenant that still has the sample data: the seeded tenant is flipped to non-demo.</summary>
public sealed class LiveInstanceFactory : TesoreroFactoryBase
{
    protected override bool SeedDemoData => true;
    protected override bool DemoInstance => false;

    protected override IHost CreateHost(IHostBuilder builder)
    {
        var host = base.CreateHost(builder);
        using var scope = host.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<Tesorero.Infrastructure.Persistence.AppDbContext>();
        db.Tenants.Where(t => t.Id == Tenant.DemoId).ExecuteUpdate(t => t.SetProperty(x => x.IsDemo, false));
        return host;
    }
}

/// <summary>A brand-new real instance: no users, first-run setup required.</summary>
public sealed class FreshInstanceFactory : TesoreroFactoryBase
{
    public const string SetupToken = "one-time-setup-token-for-tests";

    protected override bool SeedDemoData => false;
    protected override bool DemoInstance => false;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("Instance:SetupToken", SetupToken);
    }
}

/// <summary>Real API + real PostgreSQL (Testcontainers). Only third-party services are faked.</summary>
public abstract class TesoreroFactoryBase : WebApplicationFactory<Program>, IAsyncLifetime
{
    protected abstract bool SeedDemoData { get; }
    protected abstract bool DemoInstance { get; }

    private readonly PostgreSqlContainer _db = new PostgreSqlBuilder("postgres:17-alpine").Build();

    public FakeLlm Llm { get; } = new();
    public FakeIntents Intents { get; } = new();
    public RecordingJobs Jobs { get; } = new();
    public FakeEmails Emails { get; } = new();
    public const string BaseDomain = "tesorero.test";

    /// <summary>A client whose Host is <c>slug.tesorero.test</c> (or the landing apex when slug is null).</summary>
    public HttpClient ClientFor(string? slug)
    {
        var client = CreateClient();
        client.BaseAddress = new Uri($"http://{(slug is null ? BaseDomain : slug + "." + BaseDomain)}/");
        return client;
    }
    public FakeTreasuryChain Chain { get; } = new();
    public FakeNearAccounts Accounts { get; } = new();
    public FakeIndexer Indexer { get; } = new();

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    public async ValueTask InitializeAsync() => await _db.StartAsync();

    public new async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        await _db.DisposeAsync();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Default", _db.GetConnectionString());
        builder.UseSetting("ConnectionStrings:Hangfire", _db.GetConnectionString());
        builder.UseSetting("Jwt:SigningKey", "integration-tests-signing-key-0123456789-abcdef");
        builder.UseSetting("Hangfire:Enabled", "false");
        builder.UseSetting("Seed:Demo", SeedDemoData ? "true" : "false");
        builder.UseSetting("Instance:Demo", DemoInstance ? "true" : "false");
        builder.UseSetting("RateLimits:LoginPerMinute", "10000");
        builder.UseSetting("RateLimits:SignupPer10Minutes", "10000");
        builder.UseSetting("RateLimits:SignupChecksPerMinute", "10000");
        builder.UseSetting("Tenancy:BaseDomain", BaseDomain);
        builder.UseSetting("Tenancy:Scheme", "http");
        builder.UseSetting("Tenancy:KeyEncryptionKey", Convert.ToBase64String(Enumerable.Range(1, 32).Select(i => (byte)(i * 7)).ToArray()));
        builder.UseSetting("RateLimits:AiPerMinute", "10000");
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<ILlmClient>();
            services.RemoveAll<IIntentsClient>();
            services.RemoveAll<INearRpcClient>();
            services.RemoveAll<IJobScheduler>();
            services.RemoveAll<IEmailSender>();
            services.AddSingleton<IEmailSender>(Emails);
            services.RemoveAll<ITreasuryChain>();
            services.AddSingleton<ITreasuryChain>(Chain);
            Accounts.Chain = Chain;
            services.RemoveAll<INearAccounts>();
            services.AddSingleton<INearAccounts>(Accounts);
            services.RemoveAll<INearIndexer>();
            services.AddSingleton<INearIndexer>(Indexer);
            services.AddSingleton<ILlmClient>(Llm);
            services.AddSingleton<IIntentsClient>(Intents);
            services.AddSingleton<INearRpcClient>(new FakeRpc());
            services.AddScoped<IJobScheduler>(sp => new TenantJobs(Jobs, sp.GetRequiredService<ITenantContext>()));
        });
    }

    public async Task<HttpClient> ClientAsAsync(string role)
    {
        var client = CreateClient();
        var login = await client.PostAsJsonAsync("/api/auth/login", new { email = $"{role}@tesorero.demo", password = "Demo!2026" }, TestCancellation.Ct);
        login.EnsureSuccessStatusCode();
        var body = await login.Content.ReadFromJsonAsync<LoginResponse>(Json, TestCancellation.Ct);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", body!.Token);
        return client;
    }

    /// <summary>Runs queued background work the way Hangfire would: own scope per job, tenant set first.</summary>
    public async Task DrainJobsAsync()
    {
        while (Jobs.TryDequeue(out var job))
        {
            await using var scope = Services.CreateAsyncScope();
            await SetTenantAsync(scope.ServiceProvider, job.TenantId);
            if (job.Kind == "agent")
            {
                await scope.ServiceProvider.GetRequiredService<AgentService>().ExecuteAsync(job.Id, CancellationToken.None);
            }
            else
            {
                await scope.ServiceProvider.GetRequiredService<PaymentService>().ExecuteAsync(job.Id, CancellationToken.None);
            }
        }
    }

    private static async Task SetTenantAsync(IServiceProvider sp, Guid tenantId)
    {
        var db = sp.GetRequiredService<Tesorero.Infrastructure.Persistence.AppDbContext>();
        var tenant = await db.Tenants.AsNoTracking().FirstAsync(t => t.Id == tenantId);
        sp.GetRequiredService<ITenantContext>().Set(tenant);
    }

    /// <summary>Runs work in a scope bound to a tenant (the seeded demo tenant by default).</summary>
    public async Task<T> InScopeAsync<T>(Func<IServiceProvider, Task<T>> action, Guid? tenantId = null)
    {
        await using var scope = Services.CreateAsyncScope();
        await SetTenantAsync(scope.ServiceProvider, tenantId ?? Tenant.DemoId);
        return await action(scope.ServiceProvider);
    }
}

public sealed class FakeLlm : ILlmClient
{
    private readonly ConcurrentQueue<Func<LlmRequest, string>> _responses = new();
    public List<LlmRequest> Requests { get; } = [];

    public void Enqueue(Func<LlmRequest, string> respond) => _responses.Enqueue(respond);

    public void Enqueue(string json) => _responses.Enqueue(_ => json);

    public Task<LlmResponse> CompleteJsonAsync(LlmRequest request, CancellationToken cancellationToken)
    {
        Requests.Add(request);
        if (!_responses.TryDequeue(out var respond))
        {
            throw new ExternalServiceException("AI", "No scripted response.");
        }

        return Task.FromResult(new LlmResponse(respond(request), "fake-" + request.Model, 100, 50));
    }
}

public sealed class FakeIntents : IIntentsClient
{
    public List<IntentsQuoteRequest> Quotes { get; } = [];
    public Dictionary<string, string> Statuses { get; } = [];
    public bool FailQuotes { get; set; }

    public Task<IReadOnlyList<IntentsToken>> GetTokensAsync(CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<IntentsToken>>(
        [
            new("nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", "USDC", "base", 6, 1m),
            new("nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", "USDC", "sol", 6, 1m),
            new("nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", "USDC", "arb", 6, 1m),
            new("nep141:sol.omft.near", "SOL", "sol", 9, 150m),
            new("nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near", "USDT", "eth", 6, 1m),
            new("nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "USDC", "near", 6, 1m),
        ]);

    public Task<IntentsQuote> QuoteAsync(IntentsQuoteRequest request, CancellationToken cancellationToken)
    {
        Quotes.Add(request);
        if (FailQuotes)
        {
            throw new ExternalServiceException("NEAR Intents", "recipient is invalid (HTTP 400)");
        }

        var amountOut = (decimal.Parse(request.AmountIn, System.Globalization.CultureInfo.InvariantCulture) * 0.999m / 1_000_000m)
            .ToString("0.000000", System.Globalization.CultureInfo.InvariantCulture);
        return Task.FromResult(new IntentsQuote(request.AmountIn, amountOut.Replace(".", string.Empty, StringComparison.Ordinal), amountOut, null,
            request.Dry ? null : "deposit-" + Guid.NewGuid().ToString("N")[..12], request.Deadline));
    }

    public Task SubmitDepositAsync(string depositAddress, string txHash, CancellationToken cancellationToken) => Task.CompletedTask;

    public Task<IntentsStatus> GetStatusAsync(string depositAddress, CancellationToken cancellationToken) =>
        Task.FromResult(new IntentsStatus(Statuses.GetValueOrDefault(depositAddress, "PENDING_DEPOSIT"), null));
}

public sealed class FakeRpc : INearRpcClient
{
    public Task<TreasuryBalances> GetBalancesAsync(string accountId, CancellationToken cancellationToken) =>
        Task.FromResult(new TreasuryBalances(25_000m, 12.5m));

    /// <summary>Accounts starting with "missing" do not exist.</summary>
    public Task<bool> AccountExistsAsync(string accountId, CancellationToken cancellationToken) =>
        Task.FromResult(!accountId.StartsWith("missing", StringComparison.Ordinal));
}

public sealed class RecordingJobs
{
    private readonly ConcurrentQueue<(string Kind, Guid TenantId, Guid Id)> _queue = new();

    public void Enqueue(string kind, Guid tenantId, Guid id) => _queue.Enqueue((kind, tenantId, id));

    public bool TryDequeue(out (string Kind, Guid TenantId, Guid Id) job) => _queue.TryDequeue(out job);
}

/// <summary>Records jobs with the tenant of the request that enqueued them, like the Hangfire scheduler.</summary>
public sealed class TenantJobs(RecordingJobs jobs, ITenantContext tenant) : IJobScheduler
{
    public void EnqueueAgentRun(Guid runId) => jobs.Enqueue("agent", tenant.TenantId, runId);

    public void EnqueuePaymentExecution(Guid paymentId) => jobs.Enqueue("payment", tenant.TenantId, paymentId);
}

public sealed partial class FakeEmails : IEmailSender
{
    public ConcurrentQueue<EmailMessage> Sent { get; } = new();

    public Task SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        Sent.Enqueue(message);
        return Task.CompletedTask;
    }

    /// <summary>The first link in the last e-mail sent to <paramref name="to"/> whose path contains <paramref name="marker"/>.</summary>
    public string LinkFor(string to, string marker)
    {
        var mail = Sent.Last(m => m.To == to);
        return Link().Matches(mail.Text).Select(m => m.Value).FirstOrDefault(v => v.Contains(marker, StringComparison.Ordinal))
            ?? throw new InvalidOperationException($"No link with {marker} in: {mail.Text}");
    }

    [System.Text.RegularExpressions.GeneratedRegex(@"https?://\S+")]
    private static partial System.Text.RegularExpressions.Regex Link();
}

internal static class HttpExtensions
{
    public static async Task<T> ReadAsync<T>(this HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync(TestCancellation.Ct);
        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException($"{(int)response.StatusCode}: {text}");
        }

        return JsonSerializer.Deserialize<T>(text, TesoreroFactory.Json)!;
    }

    public static Task<HttpResponseMessage> PostJsonAsync<T>(this HttpClient client, string url, T body) =>
        client.PostAsJsonAsync(url, body, TesoreroFactory.Json, TestCancellation.Ct);

    public static Task<HttpResponseMessage> PutJsonAsync<T>(this HttpClient client, string url, T body) =>
        client.PutAsJsonAsync(url, body, TesoreroFactory.Json, TestCancellation.Ct);
}

public static class TestCancellation
{
    public static CancellationToken Ct => TestContext.Current.CancellationToken;
}

/// <summary>
/// In-memory stand-in for the NEAR treasury contract with the same rules as the real one
/// (agent only, pause, per-payment and daily limits, idempotent payment ids).
/// </summary>
public sealed class FakeTreasuryChain : ITreasuryChain
{
    private readonly Dictionary<string, OnChainPayment> _payments = [];
    private int _tx;

    public string? AgentAccountId { get; set; } = "agent-implicit-0001";
    public bool Paused { get; set; }
    public UInt128 MaxPerPayment { get; set; } = 1_000_000_000; // 1,000 USDC
    public UInt128 DailyLimit { get; set; } = 2_000_000_000;    // 2,000 USDC
    public UInt128 SpentToday { get; private set; }
    public bool FailTransfers { get; set; }
    public bool ThrowOnPay { get; set; }
    public int PayCalls { get; private set; }
    public IReadOnlyDictionary<string, OnChainPayment> Payments => _payments;

    /// <summary>Contracts initialized through <see cref="FakeNearAccounts"/>; other ids answer with the legacy default config.</summary>
    public ConcurrentDictionary<string, OnChainConfig> Contracts { get; } = new();

    /// <summary>Ids that are plain wallets (no Tesorero contract).</summary>
    public HashSet<string> Wallets { get; } = [];

    public Task<OnChainConfig?> GetConfigAsync(string contractId, CancellationToken cancellationToken) =>
        Task.FromResult<OnChainConfig?>(Wallets.Contains(contractId) ? null
            : Contracts.TryGetValue(contractId, out var c) ? c
            : new OnChainConfig("owner.near", AgentAccountId, "usdc.near", MaxPerPayment, DailyLimit, Paused, SpentToday,
                DailyLimit > SpentToday ? DailyLimit - SpentToday : UInt128.Zero));

    public Task<OnChainPayment?> GetPaymentAsync(string contractId, string paymentId, CancellationToken cancellationToken) =>
        Task.FromResult(_payments.GetValueOrDefault(paymentId));

    public Task<ChainTxResult> PayAsync(string contractId, string paymentId, string depositAddress, UInt128 amount, CancellationToken cancellationToken)
    {
        PayCalls++;
        if (ThrowOnPay)
        {
            throw new ExternalServiceException("NEAR treasury", "The NEAR RPC did not respond.");
        }

        var hash = $"tx{++_tx:D4}FakeHash";
        string? error = null;
        if (Paused) error = "The treasury contract is paused on-chain.";
        else if (_payments.ContainsKey(paymentId)) error = "This payment was already submitted to the treasury contract.";
        else if (amount > MaxPerPayment) error = "The treasury contract refused: above the on-chain per-payment maximum.";
        else if (SpentToday + amount > DailyLimit) error = "The treasury contract refused: the on-chain daily limit would be exceeded.";

        if (error is not null)
        {
            return Task.FromResult(new ChainTxResult(hash, false, error));
        }

        var status = FailTransfers ? "Failed" : "Done";
        _payments[paymentId] = new OnChainPayment(paymentId, depositAddress, amount, status);
        if (!FailTransfers)
        {
            SpentToday += amount;
        }

        return Task.FromResult(new ChainTxResult(hash, !FailTransfers, FailTransfers ? "ft_transfer failed" : null));
    }

    public Task<ChainTxResult> PauseAsync(string contractId, CancellationToken cancellationToken)
    {
        Paused = true;
        return Task.FromResult(new ChainTxResult($"tx{++_tx:D4}Pause", true, null));
    }
}

/// <summary>In-memory NEAR accounts: applies deploy/init/registration/transfer/delete-key like the chain would.</summary>
public sealed class FakeNearAccounts : INearAccounts
{
    public const string EmptyCode = "11111111111111111111111111111111";
    private readonly ConcurrentDictionary<string, (decimal Near, string Code, int Keys)> _accounts = new();
    private int _tx;

    public FakeTreasuryChain Chain { get; set; } = new();
    public string CodeHash { get; } = new Tesorero.Infrastructure.Near.EmbeddedTreasuryCode().Sha256Base58;
    public HashSet<string> UsdcRegistered { get; } = [];
    public List<(string Signer, string Receiver, IReadOnlyList<ChainAction> Actions)> Sent { get; } = [];

    /// <summary>Fails the next transaction that calls this method or carries this action kind ("deploy", "transfer", "deleteKey").</summary>
    public string? FailOn { get; set; }

    /// <summary>Sending NEAR to an implicit account creates it with its full-access key.</summary>
    public void Fund(string accountId, decimal near) =>
        _accounts.AddOrUpdate(accountId, (near, EmptyCode, 1), (_, a) => (a.Near + near, a.Code, Math.Max(a.Keys, 1)));

    public decimal BalanceOf(string accountId) => _accounts.TryGetValue(accountId, out var a) ? a.Near : 0;

    public Task<NearAccountState?> GetAsync(string accountId, CancellationToken cancellationToken) =>
        Task.FromResult(_accounts.TryGetValue(accountId, out var a) ? new NearAccountState(a.Near, a.Code, a.Keys) : null);

    public Task<bool> IsUsdcRegisteredAsync(string accountId, CancellationToken cancellationToken) => Task.FromResult(UsdcRegistered.Contains(accountId));

    public string PublicKeyOf(string secretKey) => "ed25519:" + secretKey[^8..];

    public Task<string> SendAsync(string signerId, string secretKey, string receiverId, IReadOnlyList<ChainAction> actions, CancellationToken cancellationToken)
    {
        if (!_accounts.TryGetValue(signerId, out var signer) || signer.Keys == 0)
        {
            throw new ExternalServiceException("NEAR", $"The key for {signerId} is not on-chain.");
        }

        foreach (var action in actions)
        {
            var kind = action switch { ChainCall c => c.Method, ChainDeploy => "deploy", ChainTransfer => "transfer", ChainDeleteKey => "deleteKey", _ => "?" };
            if (kind == FailOn)
            {
                FailOn = null;
                throw new ExternalServiceException("NEAR", $"Transaction failed: simulated failure at {kind}");
            }
        }

        Sent.Add((signerId, receiverId, actions));
        foreach (var action in actions)
        {
            switch (action)
            {
                case ChainDeploy:
                    _accounts[receiverId] = (_accounts[receiverId].Near - 1.62m, CodeHash, _accounts[receiverId].Keys);
                    break;
                case ChainCall { Method: "new" } c:
                    using (var doc = JsonDocument.Parse(c.ArgsJson))
                    {
                        var r = doc.RootElement;
                        var daily = UInt128.Parse(r.GetProperty("daily_limit").GetString()!, System.Globalization.CultureInfo.InvariantCulture);
                        Chain.Contracts[receiverId] = new OnChainConfig(r.GetProperty("owner_id").GetString()!, r.GetProperty("agent_id").GetString(),
                            r.GetProperty("usdc_contract_id").GetString()!, UInt128.Parse(r.GetProperty("max_per_payment").GetString()!, System.Globalization.CultureInfo.InvariantCulture),
                            daily, false, UInt128.Zero, daily);
                    }

                    break;
                case ChainCall { Method: "storage_deposit" } c:
                    using (var doc = JsonDocument.Parse(c.ArgsJson))
                    {
                        UsdcRegistered.Add(doc.RootElement.GetProperty("account_id").GetString()!);
                    }

                    _accounts[signerId] = (_accounts[signerId].Near - 0.00125m, _accounts[signerId].Code, _accounts[signerId].Keys);
                    break;
                case ChainTransfer t:
                    var amount = (decimal)t.Yocto / 1_000_000_000_000_000_000_000_000m;
                    _accounts[signerId] = (_accounts[signerId].Near - amount, _accounts[signerId].Code, _accounts[signerId].Keys);
                    _accounts.AddOrUpdate(receiverId, (amount, EmptyCode, 1), (_, a) => (a.Near + amount, a.Code, a.Keys));
                    break;
                case ChainDeleteKey:
                    _accounts[signerId] = (_accounts[signerId].Near, _accounts[signerId].Code, 0);
                    break;
            }
        }

        return Task.FromResult($"faketx{Interlocked.Increment(ref _tx):D3}");
    }
}

public sealed class FakeIndexer : INearIndexer
{
    public List<IndexedTransfer> Transfers { get; } = [];
    public bool Fail { get; set; }

    public Task<IReadOnlyList<IndexedTransfer>> GetTransfersAsync(string accountId, CancellationToken cancellationToken) =>
        Fail ? throw new ExternalServiceException("NearBlocks", "The indexer did not respond.")
             : Task.FromResult<IReadOnlyList<IndexedTransfer>>(Transfers.ToList());
}

