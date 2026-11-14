using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Tesorero.Application.Abstractions;
using Tesorero.Application.Common;
using Tesorero.Application.Contracts;
using Tesorero.Domain;

namespace Tesorero.Application.Services;

public sealed partial class DashboardService(IAppDbContext db, ITreasuryChain chain, TreasuryService treasuryRefresh, IMemoryCache cache, TimeProvider clock, ILogger<DashboardService> logger)
{
    public async Task<DashboardDto> GetAsync(CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var policy = await db.Policies.SingleAsync(ct);
        var settings = await db.Settings.SingleAsync(ct);
        var spend = await Spend.ComputeAsync(db, now, ct);

        TreasurySnapshot? snapshot = null;
        if (settings.TreasuryAccountId is { } account)
        {
            snapshot = await db.TreasurySnapshots.Where(s => s.AccountId == account)
                .OrderByDescending(s => s.CapturedAt).FirstOrDefaultAsync(ct);

            // Balances move with every payment and funding: refresh a snapshot older than a minute (once a minute at most).
            if ((snapshot is null || clock.GetUtcNow() - snapshot.CapturedAt > TimeSpan.FromMinutes(1))
                && cache.TryGetValue("treasury-refresh:" + account, out _) is false)
            {
                cache.Set("treasury-refresh:" + account, true, TimeSpan.FromMinutes(1));
                if (await treasuryRefresh.RefreshAsync(ct))
                {
                    snapshot = await db.TreasurySnapshots.Where(s => s.AccountId == account)
                        .OrderByDescending(s => s.CapturedAt).FirstOrDefaultAsync(ct);
                }
            }
        }

        var onChain = settings.TreasuryAccountId is { } contract ? await OnChainAsync(contract, ct) : null;
        var treasury = new TreasuryDto(settings.TreasuryAccountId is not null, settings.TreasuryAccountId, "mainnet",
            snapshot?.UsdcBalance, snapshot?.NearBalance, snapshot?.CapturedAt, onChain);

        var budgets = Enum.GetValues<Category>()
            .Where(c => policy.CategoryBudgets.ContainsKey(c) || spend.MonthByCategory.ContainsKey(c))
            .Select(c => new CategoryBudgetDto(c, spend.MonthByCategory.GetValueOrDefault(c), policy.CategoryBudgets.GetValueOrDefault(c)))
            .ToList();

        var upcoming = await db.Bills.Include(b => b.Payee)
            .Where(b => b.Status == BillStatus.Open || b.Status == BillStatus.Scheduled)
            .OrderBy(b => b.DueDate).Take(5).ToListAsync(ct);

        var recent = await db.Payments.Include(p => p.Bill).Include(p => p.Payee)
            .OrderByDescending(p => p.CreatedAt).Take(5).ToListAsync(ct);

        var lastRun = await db.AgentRuns.OrderByDescending(r => r.StartedAt).FirstOrDefaultAsync(ct);
        var pending = await db.Payments.CountAsync(p => p.Status == PaymentStatus.PendingApproval, ct);

        return new DashboardDto(
            treasury,
            new SpendDto(spend.Today, policy.DailyLimitUsd, spend.Month, policy.MonthlyLimitUsd),
            budgets,
            pending,
            upcoming.Select(b => b.ToDto()).ToList(),
            recent.Select(p => p.ToDto()).ToList(),
            lastRun?.ToSummaryDto(),
            settings.ExecutionMode,
            policy.AgentEnabled);
    }

    /// <summary>Reads the treasury contract's guard (cached briefly to spare the public RPC). Null if not a Tesorero contract.</summary>
    private async Task<OnChainGuardDto?> OnChainAsync(string contract, CancellationToken ct)
    {
        var key = "onchain-guard:" + contract;
        if (cache.TryGetValue(key, out OnChainGuardDto? cached))
        {
            return cached;
        }

        OnChainGuardDto? guard = null;
        try
        {
            if (await chain.GetConfigAsync(contract, ct) is { } c)
            {
                guard = new OnChainGuardDto(contract, c.AgentId, Usdc(c.MaxPerPayment), Usdc(c.DailyLimit), Usdc(c.SpentToday), Usdc(c.RemainingToday), c.Paused);
            }
        }
        catch (ExternalServiceException ex)
        {
            LogGuardFailed(logger, ex, contract);
        }

        cache.Set(key, guard, TimeSpan.FromSeconds(15));
        return guard;
    }

    internal static decimal Usdc(UInt128 baseUnits) => (decimal)baseUnits / 1_000_000m;

    [LoggerMessage(Level = LogLevel.Warning, Message = "Could not read the on-chain guard of {Contract}")]
    private static partial void LogGuardFailed(ILogger logger, Exception ex, string contract);
}

public sealed partial class TreasuryService(IAppDbContext db, INearRpcClient rpc, TimeProvider clock, ILogger<TreasuryService> logger)
{
    public async Task<bool> RefreshAsync(CancellationToken ct)
    {
        var settings = await db.Settings.SingleAsync(ct);
        if (settings.TreasuryAccountId is not { } account)
        {
            return false;
        }

        try
        {
            var balances = await rpc.GetBalancesAsync(account, ct);
            db.TreasurySnapshots.Add(new TreasurySnapshot
            {
                AccountId = account, UsdcBalance = balances.Usdc, NearBalance = balances.Near, CapturedAt = clock.GetUtcNow(),
            });

            var cutoff = clock.GetUtcNow().AddDays(-7);
            var old = await db.TreasurySnapshots.Where(s => s.CapturedAt < cutoff).ToListAsync(ct);
            db.TreasurySnapshots.RemoveRange(old);
            await db.SaveChangesAsync(ct);
            return true;
        }
        catch (ExternalServiceException ex)
        {
            LogRefreshFailed(logger, ex, account);
            return false;
        }
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Treasury refresh failed for {Account}")]
    private static partial void LogRefreshFailed(ILogger logger, Exception ex, string account);
}
