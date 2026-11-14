using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using Tesorero.Application.Abstractions;
using Tesorero.Application.Common;
using Tesorero.Domain;

namespace Tesorero.Infrastructure.Persistence;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options, ITenantContext tenant) : DbContext(options), IAppDbContext
{
    /// <summary>Evaluated per query by the global filters: rows of other tenants are invisible.</summary>
    public Guid CurrentTenantId => tenant.Tenant?.Id ?? Guid.Empty;

    public DbSet<User> Users => Set<User>();
    public DbSet<Payee> Payees => Set<Payee>();
    public DbSet<Bill> Bills => Set<Bill>();
    public DbSet<BillExtraction> BillExtractions => Set<BillExtraction>();
    public DbSet<TreasuryPolicy> Policies => Set<TreasuryPolicy>();
    public DbSet<OrganizationSettings> Settings => Set<OrganizationSettings>();
    public DbSet<TreasurySnapshot> TreasurySnapshots => Set<TreasurySnapshot>();
    public DbSet<TokenInfo> Tokens => Set<TokenInfo>();
    public DbSet<AgentRun> AgentRuns => Set<AgentRun>();
    public DbSet<Payment> Payments => Set<Payment>();
    public DbSet<AuditEvent> AuditEvents => Set<AuditEvent>();
    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<PendingSignup> PendingSignups => Set<PendingSignup>();
    public DbSet<TreasurySetup> TreasurySetups => Set<TreasurySetup>();
    public DbSet<TreasuryFunding> TreasuryFundings => Set<TreasuryFunding>();

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        StampTenant();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        StampTenant();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    /// <summary>New tenant-owned rows get the current tenant; writing them without a tenant is a bug and fails loudly.</summary>
    private void StampTenant()
    {
        foreach (var entry in ChangeTracker.Entries<ITenantOwned>())
        {
            if (entry.State == EntityState.Added && entry.Entity.TenantId == Guid.Empty)
            {
                entry.Entity.TenantId = tenant.Tenant?.Id ?? throw new InvalidOperationException($"Cannot save {entry.Entity.GetType().Name} without a tenant.");
            }
            else if (entry.State is EntityState.Modified or EntityState.Deleted && tenant.Tenant is { } t && entry.Entity.TenantId != t.Id)
            {
                throw new InvalidOperationException("Cross-tenant write blocked.");
            }
        }
    }

    protected override void ConfigureConventions(ModelConfigurationBuilder b)
    {
        b.Properties<Role>().HaveConversion<string>().HaveMaxLength(20);
        b.Properties<Category>().HaveConversion<string>().HaveMaxLength(20);
        b.Properties<BillStatus>().HaveConversion<string>().HaveMaxLength(20);
        b.Properties<BillSource>().HaveConversion<string>().HaveMaxLength(20);
        b.Properties<PaymentStatus>().HaveConversion<string>().HaveMaxLength(20);
        b.Properties<PolicyOutcome>().HaveConversion<string>().HaveMaxLength(20);
        b.Properties<ExecutionMode>().HaveConversion<string>().HaveMaxLength(20);
        b.Properties<AgentTrigger>().HaveConversion<string>().HaveMaxLength(20);
        b.Properties<AgentRunStatus>().HaveConversion<string>().HaveMaxLength(20);
        b.Properties<ActorType>().HaveConversion<string>().HaveMaxLength(20);
        b.Properties<decimal>().HavePrecision(18, 2);
        b.Properties<string>().HaveMaxLength(500);
    }

    protected override void OnModelCreating(ModelBuilder m)
    {
        m.Entity<Tenant>(e =>
        {
            e.ToTable("tenants");
            e.HasIndex(x => x.Slug).IsUnique();
            e.Property(x => x.Slug).HasMaxLength(30);
            e.Property(x => x.Name).HasMaxLength(80);
            e.Property(x => x.OwnerEmail).HasMaxLength(160);
            e.Property(x => x.NearAccountId).HasMaxLength(64);
            e.Property(x => x.SetupTokenHash).HasMaxLength(64);
            e.Property(x => x.AgentAccountId).HasMaxLength(64);
            e.Property(x => x.AgentKeyCiphertext).HasMaxLength(400);
        });

        m.Entity<PendingSignup>(e =>
        {
            e.ToTable("pending_signups");
            e.HasIndex(x => x.TokenHash).IsUnique();
            e.HasIndex(x => x.Email);
            e.Property(x => x.TokenHash).HasMaxLength(64);
            e.Property(x => x.Slug).HasMaxLength(30);
            e.Property(x => x.Email).HasMaxLength(160);
            e.Property(x => x.NearAccountId).HasMaxLength(64);
            e.Property(x => x.Language).HasMaxLength(5);
        });

        Owned<User>(m);
        Owned<Payee>(m);
        Owned<Bill>(m);
        Owned<BillExtraction>(m);
        Owned<TreasuryPolicy>(m);
        Owned<OrganizationSettings>(m);
        Owned<TreasurySnapshot>(m);
        Owned<AgentRun>(m);
        Owned<Payment>(m);
        Owned<AuditEvent>(m);
        Owned<TreasurySetup>(m);
        Owned<TreasuryFunding>(m);

        m.Entity<User>(e =>
        {
            e.ToTable("users");
            e.HasIndex(x => new { x.TenantId, x.Email }).IsUnique();
            e.Property(x => x.Email).HasMaxLength(160);
            e.Property(x => x.PasswordHash).HasMaxLength(300);
        });

        m.Entity<Payee>(e =>
        {
            e.ToTable("payees");
            e.Property(x => x.DestinationAssetId).HasMaxLength(200);
            e.Property(x => x.RecipientAddress).HasMaxLength(128);
            e.Ignore(x => x.TrustedSince);
        });

        m.Entity<Bill>(e =>
        {
            e.ToTable("bills");
            e.HasOne(x => x.Payee).WithMany().HasForeignKey(x => x.PayeeId).OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x => new { x.Status, x.DueDate });
            e.Property(x => x.Flags).HasConversion(JsonConverter<List<BillFlag>>(), JsonComparer<List<BillFlag>>()).HasColumnType("jsonb");
            e.Property(x => x.CreatedBy).HasMaxLength(160);
        });

        m.Entity<BillExtraction>(e =>
        {
            e.ToTable("bill_extractions");
            e.Property(x => x.SourceText).HasMaxLength(12_000);
            e.Property(x => x.ResultJson).HasColumnType("jsonb");
            e.Property(x => x.Flags).HasConversion(JsonConverter<List<BillFlag>>(), JsonComparer<List<BillFlag>>()).HasColumnType("jsonb");
        });

        m.Entity<TreasuryPolicy>(e =>
        {
            e.ToTable("treasury_policy");
            e.Property(x => x.CategoryBudgets)
                .HasConversion(JsonConverter<Dictionary<Category, decimal>>(), JsonComparer<Dictionary<Category, decimal>>())
                .HasColumnType("jsonb");
        });

        m.Entity<OrganizationSettings>(e => e.ToTable("organization_settings"));

        m.Entity<TreasurySnapshot>(e =>
        {
            e.ToTable("treasury_snapshots");
            e.Property(x => x.UsdcBalance).HasPrecision(28, 6);
            e.Property(x => x.NearBalance).HasPrecision(38, 8);
            e.HasIndex(x => new { x.AccountId, x.CapturedAt });
        });

        m.Entity<TokenInfo>(e =>
        {
            e.ToTable("tokens");
            e.HasKey(x => x.AssetId);
            e.Property(x => x.AssetId).HasMaxLength(200);
            e.Property(x => x.PriceUsd).HasPrecision(28, 10);
        });

        m.Entity<AgentRun>(e =>
        {
            e.ToTable("agent_runs");
            e.HasIndex(x => x.StartedAt);
            e.Property(x => x.Summary).HasMaxLength(2000);
            e.Property(x => x.Error).HasMaxLength(2000);
            e.Property(x => x.Decisions).HasConversion(JsonConverter<List<AgentDecision>>(), JsonComparer<List<AgentDecision>>()).HasColumnType("jsonb");
        });

        m.Entity<Payment>(e =>
        {
            e.ToTable("payments");
            e.HasOne(x => x.Bill).WithMany().HasForeignKey(x => x.BillId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.Payee).WithMany().HasForeignKey(x => x.PayeeId).OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x => x.Status);
            e.HasIndex(x => x.BillId);
            e.HasIndex(x => x.CreatedAt);
            e.Property(x => x.OriginAssetId).HasMaxLength(200);
            e.Property(x => x.DestinationAssetId).HasMaxLength(200);
            e.Property(x => x.Recipient).HasMaxLength(128);
            e.Property(x => x.LastError).HasMaxLength(1000);
            e.Property(x => x.PolicyReasons).HasConversion(JsonConverter<List<PolicyReason>>(), JsonComparer<List<PolicyReason>>()).HasColumnType("jsonb");
            e.Property(x => x.Quote).HasConversion(NullableJsonConverter<PaymentQuote>(), JsonComparer<PaymentQuote?>()).HasColumnType("jsonb");
        });

        m.Entity<AuditEvent>(e =>
        {
            e.ToTable("audit_events");
            e.HasIndex(x => x.At);
            e.Property(x => x.Summary).HasMaxLength(1000);
        });

        m.Entity<TreasurySetup>(e =>
        {
            e.ToTable("treasury_setups");
            e.HasIndex(x => x.CreatedAt);
            e.Property(x => x.OwnerAccountId).HasMaxLength(64);
            e.Property(x => x.AccountId).HasMaxLength(64);
            e.Property(x => x.LastError).HasMaxLength(1000);
            e.Property(x => x.MaxPerPaymentUsd).HasPrecision(18, 6);
            e.Property(x => x.DailyLimitUsd).HasPrecision(18, 6);
        });

        m.Entity<TreasuryFunding>(e =>
        {
            e.ToTable("treasury_fundings");
            e.HasIndex(x => x.CreatedAt);
            e.HasIndex(x => x.DepositAddress);
            e.Property(x => x.OriginAssetId).HasMaxLength(200);
            e.Property(x => x.DepositAddress).HasMaxLength(200);
            e.Property(x => x.DepositMemo).HasMaxLength(200);
            e.Property(x => x.RefundAddress).HasMaxLength(200);
            e.Property(x => x.TreasuryAccountId).HasMaxLength(64);
            e.Property(x => x.AmountIn).HasPrecision(38, 18);
            e.Property(x => x.ExpectedUsdc).HasPrecision(18, 6);
        });
    }

    private void Owned<T>(ModelBuilder m)
        where T : class, ITenantOwned
    {
        m.Entity<T>().HasIndex(x => x.TenantId);
        m.Entity<T>().HasQueryFilter(x => x.TenantId == CurrentTenantId);
    }

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static ValueConverter<T, string> JsonConverter<T>()
        where T : new() =>
        new(v => JsonSerializer.Serialize(v, Json), v => JsonSerializer.Deserialize<T>(v, Json) ?? new T());

    private static ValueConverter<T?, string?> NullableJsonConverter<T>()
        where T : class =>
        new(v => v == null ? null : JsonSerializer.Serialize(v, Json), v => v == null ? null : JsonSerializer.Deserialize<T>(v, Json));

    private static ValueComparer<T> JsonComparer<T>() =>
        new(
            (a, b) => JsonSerializer.Serialize(a, Json) == JsonSerializer.Serialize(b, Json),
            v => JsonSerializer.Serialize(v, Json).GetHashCode(StringComparison.Ordinal),
            v => JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(v, Json), Json)!);
}

/// <summary>Used by `dotnet ef` at design time only.</summary>
public sealed class DesignTimeFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql("Host=localhost;Database=tesorero_design;Username=postgres;Password=postgres")
            .Options, new TenantContext());
}
