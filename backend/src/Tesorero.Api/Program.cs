using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Hangfire;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Tesorero.Api.Endpoints;
using Tesorero.Api.Infrastructure;
using Tesorero.Application;
using Tesorero.Domain;
using Tesorero.Infrastructure;
using Tesorero.Infrastructure.Persistence;

// `dotnet Tesorero.Api.dll generate-agent-key` prints a fresh NEAR agent key as .env lines and exits.
// Run it ON THE SERVER so the private key never leaves it (see docs/guides/MAINNET.md).
if (args is ["generate-agent-key", ..])
{
    var key = Tesorero.Infrastructure.Near.NearKeyPair.Generate();
    Console.WriteLine($"NEAR_AGENT_ACCOUNT_ID={key.ImplicitAccountId}");
    Console.WriteLine($"NEAR_AGENT_PRIVATE_KEY={key.SecretKeyText}");
    return;
}

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;
var hangfireEnabled = config.GetValue("Hangfire:Enabled", true);

builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
    o.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.Never;
});
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<ProblemExceptionHandler>();
builder.Services.AddHealthChecks().AddCheck<DatabaseHealthCheck>("database");

builder.Services.AddApplication();
builder.Services.AddInfrastructure(config);
if (hangfireEnabled)
{
    builder.Services.AddHangfireStorage(config);
    builder.Services.AddHangfireServer(o =>
    {
        o.WorkerCount = 4;
        o.ServerName = "tesorero";
    });
}

builder.Services.Configure<JwtOptions>(config.GetSection(JwtOptions.Section));
builder.Services.AddSingleton<TokenIssuer>();
var jwt = config.GetSection(JwtOptions.Section).Get<JwtOptions>() ?? new JwtOptions();
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o =>
{
    o.MapInboundClaims = false;
    o.TokenValidationParameters = new TokenValidationParameters
    {
        ValidIssuer = jwt.Issuer,
        ValidAudience = jwt.Audience,
        IssuerSigningKey = jwt.Key(),
        RoleClaimType = System.Security.Claims.ClaimTypes.Role,
        NameClaimType = "name",
        ClockSkew = TimeSpan.FromMinutes(1),
    };
    o.Events = new JwtBearerEvents
    {
        // A token stops working as soon as its user is deactivated or changes role.
        OnTokenValidated = async ctx =>
        {
            var users = ctx.HttpContext.RequestServices.GetRequiredService<Tesorero.Application.Services.UserService>();
            var current = ctx.HttpContext.RequestServices.GetRequiredService<Tesorero.Application.Abstractions.ITenantContext>();
            var principal = ctx.Principal!;
            // A session belongs to one organization: its token is useless on any other subdomain.
            if (current.Tenant is null || principal.FindFirst(TenantClaims.Name)?.Value != current.Tenant.Id.ToString())
            {
                ctx.Fail("Token belongs to another organization.");
                return;
            }

            if (!await users.IsStillValidAsync(principal.UserId(), principal.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value, ctx.HttpContext.RequestAborted))
            {
                ctx.Fail("User is no longer active with this role.");
            }
        },
    };
});
builder.Services.AddAuthorizationBuilder()
    .AddPolicy(Policies.Manage, p => p.RequireRole(nameof(Role.Owner)))
    .AddPolicy(Policies.Operate, p => p.RequireRole(nameof(Role.Owner), nameof(Role.Approver)));

var loginPerMinute = config.GetValue("RateLimits:LoginPerMinute", 10);
var aiPerMinute = config.GetValue("RateLimits:AiPerMinute", 20);
var signupPer10Minutes = config.GetValue("RateLimits:SignupPer10Minutes", 5);
var signupChecksPerMinute = config.GetValue("RateLimits:SignupChecksPerMinute", 60);
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("login", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = loginPerMinute, Window = TimeSpan.FromMinutes(1) }));
    o.AddPolicy("signup", ctx => RateLimitPartition.GetFixedWindowLimiter(
        "signup:" + (ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown"),
        _ => new FixedWindowRateLimiterOptions { PermitLimit = signupPer10Minutes, Window = TimeSpan.FromMinutes(10) }));
    o.AddPolicy("signup-check", ctx => RateLimitPartition.GetFixedWindowLimiter(
        "check:" + (ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown"),
        _ => new FixedWindowRateLimiterOptions { PermitLimit = signupChecksPerMinute, Window = TimeSpan.FromMinutes(1) }));
    o.AddPolicy("ai", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.User.Identity?.Name ?? ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = aiPerMinute, Window = TimeSpan.FromMinutes(1) }));
});

// Nothing persists protected payloads (sessions are JWTs); only the local Hangfire dashboard's
// antiforgery uses Data Protection, so its key ring lives in a writable temp folder of the container.
builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(Path.GetTempPath(), "tesorero-dataprotection")));
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.KnownIPNetworks.Clear();
    o.KnownProxies.Clear();
});
builder.Services.AddOpenApi();

var app = builder.Build();

app.UseForwardedHeaders();
app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseMiddleware<TenantResolutionMiddleware>();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

if (config.GetValue("Database:MigrateOnStartup", true))
{
    // Migrations take session-level advisory locks: run them on a DIRECT connection, not through PgBouncer.
    var migrationConnection = config.GetConnectionString("Migrations") ?? config.GetConnectionString("Hangfire") ?? config.GetConnectionString("Default");
    await using (var migrator = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(migrationConnection).Options, new Tesorero.Application.Common.TenantContext()))
    {
        await migrator.Database.MigrateAsync();
    }

    await using var scope = app.Services.CreateAsyncScope();
    await scope.ServiceProvider.GetRequiredService<DataSeeder>().SeedAsync(CancellationToken.None);
}

if (hangfireEnabled)
{
    // Dashboard is local-only (default filter): reach it through an SSH tunnel.
    app.UseHangfireDashboard("/hangfire");
    Tesorero.Infrastructure.DependencyInjection.RegisterRecurringJobs(app.Services.GetRequiredService<IRecurringJobManager>());
}

app.MapOpenApi();
app.MapHealthChecks("/health");
app.MapTesoreroApi();

await app.RunAsync();

/// <summary>Entry point marker for integration tests.</summary>
public partial class Program;
