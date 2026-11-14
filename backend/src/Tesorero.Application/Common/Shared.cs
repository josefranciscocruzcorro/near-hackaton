using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Tesorero.Application.Abstractions;
using Tesorero.Domain;

namespace Tesorero.Application.Common;

/// <summary>Who performed an action (for the append-only audit log).</summary>
public sealed record Actor(string Name, ActorType Type)
{
    public static readonly Actor Agent = new("Tesorero agent", ActorType.Agent);
    public static readonly Actor System = new("system", ActorType.System);
    public static Actor User(string email) => new(email, ActorType.User);
}

public sealed class AiOptions
{
    public const string Section = "Ai";
    public string BaseUrl { get; set; } = "https://api.deepseek.com";
    public string ApiKey { get; set; } = string.Empty;
    public string ExtractionModel { get; set; } = "deepseek-flash";
    public string PlannerModel { get; set; } = "deepseek-v4-pro";
    public int TimeoutSeconds { get; set; } = 90;
}

public sealed class IntentsOptions
{
    public const string Section = "Intents";
    public string BaseUrl { get; set; } = "https://1click.chaindefuser.com";
    public string? Jwt { get; set; }

    /// <summary>USDC on NEAR (native, Circle). The treasury's base asset.</summary>
    public string OriginAssetId { get; set; } = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
    public int OriginDecimals { get; set; } = 6;

    /// <summary>Used as refund address for dry quotes when no treasury account is configured.</summary>
    public string DefaultRefundAccount { get; set; } = "intents.near";
    public int SlippageBps { get; set; } = 100;
    public int QuoteTtlMinutes { get; set; } = 30;
}

public sealed class NearOptions
{
    public const string Section = "Near";
    public string RpcUrl { get; set; } = "https://free.rpc.fastnear.com";
    public string UsdcContract { get; set; } = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

    /// <summary>Agent account (defaults to the implicit account of the key). Secrets come from the environment only.</summary>
    public string? AgentAccountId { get; set; }

    /// <summary>ed25519 secret key of the agent (NEAR format). Never logged, never returned by the API.</summary>
    public string? AgentPrivateKey { get; set; }

    public ulong PayGasTgas { get; set; } = 100;
    public string ExplorerTxUrl { get; set; } = "https://nearblocks.io/txns/";
}

internal static class Audit
{
    public static void Record(this IAppDbContext db, TimeProvider clock, Actor actor, string action, string entityType, object? entityId, string summary) =>
        db.AuditEvents.Add(new AuditEvent
        {
            At = clock.GetUtcNow(),
            Actor = actor.Name,
            ActorType = actor.Type,
            Action = action,
            EntityType = entityType,
            EntityId = entityId?.ToString(),
            Summary = summary.Length > 1000 ? summary[..1000] : summary,
        });
}

/// <summary>Committed spend windows used by both the policy engine and the dashboard.</summary>
public sealed record SpendSnapshot(decimal Today, decimal Month, IReadOnlyDictionary<Category, decimal> MonthByCategory);

internal static class Spend
{
    public static async Task<SpendSnapshot> ComputeAsync(IAppDbContext db, DateTimeOffset now, CancellationToken ct)
    {
        var dayStart = new DateTimeOffset(now.UtcDateTime.Date, TimeSpan.Zero);
        var monthStart = new DateTimeOffset(now.Year, now.Month, 1, 0, 0, 0, TimeSpan.Zero);
        var committed = Payment.CommittedStatuses.ToList();

        var rows = await db.Payments
            .Where(p => committed.Contains(p.Status) && p.CreatedAt >= monthStart)
            .Select(p => new { p.AmountUsd, p.CreatedAt, p.Category })
            .ToListAsync(ct);

        var byCategory = rows.GroupBy(r => r.Category).ToDictionary(g => g.Key, g => g.Sum(r => r.AmountUsd));
        return new SpendSnapshot(
            rows.Where(r => r.CreatedAt >= dayStart).Sum(r => r.AmountUsd),
            rows.Sum(r => r.AmountUsd),
            byCategory);
    }
}

public static partial class AddressRules
{
    private static readonly HashSet<string> EvmChains =
        new(["eth", "base", "arb", "op", "pol", "bsc", "gnosis", "avax", "bera", "monad", "xlayer", "plasma", "scroll", "linea"], StringComparer.OrdinalIgnoreCase);

    /// <summary>Basic format validation per chain, to catch typos before money moves.</summary>
    public static bool IsValid(string chain, string address)
    {
        if (string.IsNullOrWhiteSpace(address) || address.Length > 128 || address.Any(char.IsWhiteSpace))
        {
            return false;
        }

        if (EvmChains.Contains(chain))
        {
            return Evm().IsMatch(address);
        }

        return chain.ToLowerInvariant() switch
        {
            "near" => NearAccount().IsMatch(address),
            "sol" => Base58().IsMatch(address) && address.Length is >= 32 and <= 44,
            "btc" => Btc().IsMatch(address),
            _ => true,
        };
    }

    [GeneratedRegex("^0x[0-9a-fA-F]{40}$")]
    private static partial Regex Evm();

    [GeneratedRegex(@"^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$")]
    public static partial Regex NearAccount();

    [GeneratedRegex("^[1-9A-HJ-NP-Za-km-z]+$")]
    private static partial Regex Base58();

    [GeneratedRegex("^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$")]
    private static partial Regex Btc();
}

public sealed class TenancyOptions
{
    public const string Section = "Tenancy";

    /// <summary>Apex domain of the landing; tenants live at &lt;slug&gt;.BaseDomain.</summary>
    public string BaseDomain { get; set; } = "tesorero.gesco.ec";

    /// <summary>Tenant used for hosts outside BaseDomain (localhost, near.gesco.ec).</summary>
    public string DefaultSlug { get; set; } = Domain.Tenant.DemoSlug;

    public string Scheme { get; set; } = "https";

    /// <summary>Base64 of 32 random bytes. Encrypts tenant agent keys. Only in the server .env.</summary>
    public string KeyEncryptionKey { get; set; } = string.Empty;

    /// <summary>Optional public port for local development (e.g. 4173); empty in production.</summary>
    public string? PublicPort { get; set; }

    private string Port => string.IsNullOrWhiteSpace(PublicPort) ? string.Empty : ":" + PublicPort.Trim();

    public string LandingUrl => $"{Scheme}://{BaseDomain}{Port}";

    public string TenantUrl(string slug) => $"{Scheme}://{slug}.{BaseDomain}{Port}";
}

public sealed class EmailOptions
{
    public const string Section = "Email";
    public string Host { get; set; } = string.Empty;
    public int Port { get; set; } = 465;
    public bool UseTls { get; set; } = true;
    public string User { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
    public string From { get; set; } = string.Empty;
    public string FromName { get; set; } = "Tesorero";

    /// <summary>Development only: without SMTP, also save each e-mail as JSON in this folder.</summary>
    public string PickupDirectory { get; set; } = string.Empty;
}

/// <summary>Scoped holder of the request's (or job's) tenant. Set once by the tenant middleware or the job runner.</summary>
public sealed class TenantContext : ITenantContext
{
    public Domain.Tenant? Tenant { get; private set; }

    public bool IsLanding { get; private set; }

    public void Set(Domain.Tenant tenant)
    {
        ArgumentNullException.ThrowIfNull(tenant);
        Tenant = tenant;
        IsLanding = false;
    }

    public void SetLanding()
    {
        Tenant = null;
        IsLanding = true;
    }
}
