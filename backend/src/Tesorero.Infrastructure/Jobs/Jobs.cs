using Hangfire;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Tesorero.Application.Abstractions;
using Tesorero.Application.Common;
using Tesorero.Application.Services;
using Tesorero.Domain;
using Tesorero.Infrastructure.Persistence;

namespace Tesorero.Infrastructure.Jobs;

/// <summary>
/// Hangfire entry points (ADR-0006). Every job runs for exactly one tenant, in its own DI scope with the
/// tenant context set before any tenant data is touched. Recurring jobs fan out over the active tenants.
/// </summary>
public sealed partial class TesoreroJobs(IServiceScopeFactory scopes, ILogger<TesoreroJobs> logger)
{
    public const string DailyAgentJobId = "agent-daily-run";
    public const string PollJobId = "payments-status-poll";
    public const string TreasuryJobId = "treasury-balance-refresh";
    public const string TokensJobId = "intents-token-catalog";

    [AutomaticRetry(Attempts = 0)]
    [DisableConcurrentExecution(timeoutInSeconds: 300)]
    public Task RunAgentAsync(Guid tenantId, Guid runId, CancellationToken ct) =>
        InTenantAsync(tenantId, sp => sp.GetRequiredService<AgentService>().ExecuteAsync(runId, ct));

    [AutomaticRetry(Attempts = 2)]
    public Task ExecutePaymentAsync(Guid tenantId, Guid paymentId, CancellationToken ct) =>
        InTenantAsync(tenantId, sp => sp.GetRequiredService<PaymentService>().ExecuteAsync(paymentId, ct));

    [AutomaticRetry(Attempts = 0)]
    public Task ScheduledAgentAsync(CancellationToken ct) => ForEachTenantAsync(async sp =>
    {
        try
        {
            await sp.GetRequiredService<AgentService>().StartAsync(AgentTrigger.Scheduled, Actor.System, ct);
        }
        catch (ConflictException)
        {
            // A run is already in progress for this tenant; the next schedule will pick up.
        }
    }, ct);

    [AutomaticRetry(Attempts = 0)]
    [DisableConcurrentExecution(timeoutInSeconds: 120)]
    public Task PollPaymentsAsync(CancellationToken ct) =>
        ForEachTenantAsync(sp => sp.GetRequiredService<PaymentService>().PollAsync(ct), ct);

    [AutomaticRetry(Attempts = 0)]
    public Task RefreshTreasuryAsync(CancellationToken ct) =>
        ForEachTenantAsync(sp => sp.GetRequiredService<TreasuryService>().RefreshAsync(ct), ct);

    [AutomaticRetry(Attempts = 1)]
    public async Task RefreshTokensAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<TokenCatalogService>().RefreshAsync(ct);
    }

    private async Task InTenantAsync(Guid tenantId, Func<IServiceProvider, Task> action)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var tenant = await db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId);
        if (tenant is null)
        {
            LogMissingTenant(logger, tenantId);
            return;
        }

        scope.ServiceProvider.GetRequiredService<ITenantContext>().Set(tenant);
        await action(scope.ServiceProvider);
    }

    /// <summary>Runs the action once per set-up tenant; one tenant failing never stops the others.</summary>
    private async Task ForEachTenantAsync(Func<IServiceProvider, Task> action, CancellationToken ct)
    {
        List<Guid> ids;
        await using (var scope = scopes.CreateAsyncScope())
        {
            ids = await scope.ServiceProvider.GetRequiredService<AppDbContext>().Tenants
                .Where(t => t.SetupTokenHash == null).Select(t => t.Id).ToListAsync(ct);
        }

        foreach (var id in ids)
        {
            try
            {
                await InTenantAsync(id, action);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                LogTenantJobFailed(logger, ex, id);
            }
        }
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Job skipped: tenant {TenantId} no longer exists")]
    private static partial void LogMissingTenant(ILogger logger, Guid tenantId);

    [LoggerMessage(Level = LogLevel.Error, Message = "Recurring job failed for tenant {TenantId}")]
    private static partial void LogTenantJobFailed(ILogger logger, Exception ex, Guid tenantId);
}

public sealed class HangfireJobScheduler(IBackgroundJobClient client, ITenantContext tenant) : IJobScheduler
{
    public void EnqueueAgentRun(Guid runId)
    {
        var tenantId = tenant.TenantId;
        client.Enqueue<TesoreroJobs>(j => j.RunAgentAsync(tenantId, runId, CancellationToken.None));
    }

    public void EnqueuePaymentExecution(Guid paymentId)
    {
        var tenantId = tenant.TenantId;
        client.Enqueue<TesoreroJobs>(j => j.ExecutePaymentAsync(tenantId, paymentId, CancellationToken.None));
    }
}
