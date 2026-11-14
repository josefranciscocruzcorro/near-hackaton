using Hangfire;
using Hangfire.PostgreSql;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Tesorero.Application.Abstractions;
using Tesorero.Application.Common;
using Tesorero.Infrastructure.External;
using Tesorero.Infrastructure.Jobs;
using Tesorero.Infrastructure.Near;
using Tesorero.Infrastructure.Persistence;
using Tesorero.Infrastructure.Tenancy;
using Tesorero.Application.Services;

namespace Tesorero.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<AiOptions>(configuration.GetSection(AiOptions.Section));
        services.Configure<IntentsOptions>(configuration.GetSection(IntentsOptions.Section));
        services.Configure<NearOptions>(configuration.GetSection(NearOptions.Section));
        services.Configure<SeedOptions>(configuration.GetSection(SeedOptions.Section));
        services.Configure<TenancyOptions>(configuration.GetSection(TenancyOptions.Section));
        services.Configure<EmailOptions>(configuration.GetSection(EmailOptions.Section));
        services.AddScoped<TenantContext>();
        services.AddScoped<ITenantContext>(sp => sp.GetRequiredService<TenantContext>());
        services.AddSingleton<ISecretVault, AesGcmVault>();
        services.AddSingleton<IAgentKeyFactory, AgentKeyFactory>();
        // Real delivery. With Hangfire (AddHangfireStorage) requests queue e-mails instead of sending inline.
        if (string.IsNullOrWhiteSpace(configuration["Email:Host"]))
        {
            services.AddSingleton<IEmailSender, LogEmailSender>();
        }
        else
        {
            services.AddSingleton<IEmailSender, SmtpEmailSender>();
        }

        services.AddSingleton(sp => new EmailTransport(string.IsNullOrWhiteSpace(configuration["Email:Host"])
            ? ActivatorUtilities.CreateInstance<LogEmailSender>(sp)
            : ActivatorUtilities.CreateInstance<SmtpEmailSender>(sp)));
        services.AddTransient<EmailJob>();

        services.AddMemoryCache();

        // App traffic goes through PgBouncer (transaction pooling).
        var appConnection = configuration.GetConnectionString("Default")
            ?? throw new InvalidOperationException("ConnectionStrings:Default is required.");
        services.AddDbContext<AppDbContext>(o => o.UseNpgsql(appConnection, npgsql => npgsql.EnableRetryOnFailure(3)));
        services.AddScoped<IAppDbContext>(sp => sp.GetRequiredService<AppDbContext>());
        services.AddScoped<DataSeeder>();

        services.AddHttpClient<ILlmClient, DeepSeekClient>((sp, http) =>
        {
            var o = sp.GetRequiredService<IOptions<AiOptions>>().Value;
            http.BaseAddress = new Uri(o.BaseUrl.TrimEnd('/') + "/");
            http.Timeout = TimeSpan.FromSeconds(o.TimeoutSeconds);
        });
        services.AddHttpClient<IIntentsClient, OneClickIntentsClient>((sp, http) =>
        {
            http.BaseAddress = new Uri(sp.GetRequiredService<IOptions<IntentsOptions>>().Value.BaseUrl.TrimEnd('/') + "/");
            http.Timeout = TimeSpan.FromSeconds(30);
        });
        services.AddHttpClient<INearRpcClient, NearRpcClient>((sp, http) =>
        {
            http.BaseAddress = new Uri(sp.GetRequiredService<IOptions<NearOptions>>().Value.RpcUrl);
            http.Timeout = TimeSpan.FromSeconds(20);
        });

        services.AddHttpClient<ITreasuryChain, TreasuryChainClient>((sp, http) =>
        {
            http.BaseAddress = new Uri(sp.GetRequiredService<IOptions<NearOptions>>().Value.RpcUrl);
            http.Timeout = TimeSpan.FromSeconds(60);
        });

        // Treasury created from the app with a one-time key (ADR-0007): deploying a 161 KB contract and waiting for FINAL takes a while.
        services.AddSingleton<ITreasuryCode, EmbeddedTreasuryCode>();
        services.AddHttpClient<INearAccounts, NearAccountsClient>((sp, http) =>
        {
            http.BaseAddress = new Uri(sp.GetRequiredService<IOptions<NearOptions>>().Value.RpcUrl);
            http.Timeout = TimeSpan.FromSeconds(90);
        });
        services.AddHttpClient<INearIndexer, NearBlocksIndexer>(http =>
        {
            http.BaseAddress = new Uri("https://api.nearblocks.io/v1/");
            http.Timeout = TimeSpan.FromSeconds(20);
            http.DefaultRequestHeaders.UserAgent.ParseAdd("Tesorero/1.0");
            http.DefaultRequestHeaders.Accept.ParseAdd("application/json");
        });

        services.AddScoped<TesoreroJobs>();
        services.AddScoped<IJobScheduler, HangfireJobScheduler>();
        return services;
    }

    /// <summary>
    /// Hangfire storage uses a DIRECT Postgres connection: its distributed locks need session state,
    /// which PgBouncer's transaction pooling does not keep (ADR-0001).
    /// </summary>
    public static IServiceCollection AddHangfireStorage(this IServiceCollection services, IConfiguration configuration)
    {
        var connection = configuration.GetConnectionString("Hangfire")
            ?? throw new InvalidOperationException("ConnectionStrings:Hangfire is required.");
        services.AddHangfire(cfg => cfg
            .SetDataCompatibilityLevel(CompatibilityLevel.Version_180)
            .UseSimpleAssemblyNameTypeSerializer()
            .UseRecommendedSerializerSettings()
            .UsePostgreSqlStorage(o => o.UseNpgsqlConnection(connection), new PostgreSqlStorageOptions
            {
                SchemaName = "hangfire",
                PrepareSchemaIfNecessary = true,
                QueuePollInterval = TimeSpan.FromSeconds(2),
            }));
        services.Replace(ServiceDescriptor.Singleton<IEmailSender, QueuedEmailSender>());
        return services;
    }

    public static void RegisterRecurringJobs(IRecurringJobManager jobs)
    {
        ArgumentNullException.ThrowIfNull(jobs);
        var utc = new RecurringJobOptions { TimeZone = TimeZoneInfo.Utc };
        jobs.AddOrUpdate<TesoreroJobs>(TesoreroJobs.DailyAgentJobId, j => j.ScheduledAgentAsync(CancellationToken.None), "0 14 * * *", utc);
        jobs.AddOrUpdate<TesoreroJobs>(TesoreroJobs.PollJobId, j => j.PollPaymentsAsync(CancellationToken.None), Cron.Minutely(), utc);
        jobs.AddOrUpdate<TesoreroJobs>(TesoreroJobs.TreasuryJobId, j => j.RefreshTreasuryAsync(CancellationToken.None), "*/10 * * * *", utc);
        jobs.AddOrUpdate<TesoreroJobs>(TesoreroJobs.TokensJobId, j => j.RefreshTokensAsync(CancellationToken.None), Cron.Hourly(), utc);
    }
}
