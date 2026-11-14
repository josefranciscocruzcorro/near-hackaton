using System.Reflection;
using System.Text;
using Microsoft.AspNetCore.Http.HttpResults;
using Tesorero.Api.Infrastructure;
using Tesorero.Application.Contracts;
using Tesorero.Application.Services;
using Tesorero.Domain;

namespace Tesorero.Api.Endpoints;

/// <summary>HTTP surface. Mirrors docs/api/CONTRACT.md.</summary>
public static class Endpoints
{
    public static void MapTesoreroApi(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api");

        api.MapPost("/auth/login", async Task<Results<Ok<LoginResponse>, UnauthorizedHttpResult>> (LoginRequest req, AuthService auth, TokenIssuer issuer, CancellationToken ct) =>
        {
            var user = await auth.ValidateAsync(req.Email ?? string.Empty, req.Password ?? string.Empty, ct);
            if (user is null)
            {
                return TypedResults.Unauthorized();
            }

            var (token, expires) = issuer.Issue(user);
            return TypedResults.Ok(new LoginResponse(token, expires, user.ToDto()));
        }).AllowAnonymous().RequireRateLimiting("login");

        api.MapGet("/version", () => TypedResults.Ok(AppVersion.Current)).AllowAnonymous();

        // Instance info + first-run setup (public).
        api.MapGet("/instance", (InstanceService s, CancellationToken ct) => s.GetAsync(ct)).AllowAnonymous();
        // Public signup on the landing (ADR-0006). The tenant middleware only lets these through on the apex domain.
        api.MapGet("/signup/slug", (string? value, SignupService s, CancellationToken ct) => s.CheckSlugAsync(value, ct))
            .AllowAnonymous().RequireRateLimiting("signup-check");
        api.MapGet("/signup/near", (string? accountId, SignupService s, CancellationToken ct) => s.CheckNearAsync(accountId, ct))
            .AllowAnonymous().RequireRateLimiting("signup-check");
        api.MapPost("/signup", async (SignupRequest req, SignupService s, CancellationToken ct) =>
            TypedResults.Accepted((string?)null, await s.SignupAsync(req, ct))).AllowAnonymous().RequireRateLimiting("signup");
        api.MapPost("/signup/verify", (VerifyRequest req, SignupService s, CancellationToken ct) => s.VerifyAsync(req.Token, ct))
            .AllowAnonymous().RequireRateLimiting("signup");

        api.MapPost("/setup", async (SetupRequest req, InstanceService s, TokenIssuer issuer, CancellationToken ct) =>
        {
            var owner = await s.SetupAsync(req, ct);
            var (token, expires) = issuer.Issue(owner);
            return TypedResults.Created("/api/auth/me", new LoginResponse(token, expires, owner.ToDto()));
        }).AllowAnonymous().RequireRateLimiting("login");

        var secured = api.MapGroup(string.Empty).RequireAuthorization();

        secured.MapGet("/auth/me", async Task<Results<Ok<UserDto>, UnauthorizedHttpResult>> (System.Security.Claims.ClaimsPrincipal principal, Tesorero.Application.Abstractions.IAppDbContext db, CancellationToken ct) =>
        {
            var user = await db.Users.FindAsync([principal.UserId()], ct);
            return user is null ? TypedResults.Unauthorized() : TypedResults.Ok(user.ToDto());
        });

        secured.MapPost("/auth/change-password", async (ChangePasswordRequest req, UserService s, System.Security.Claims.ClaimsPrincipal u, CancellationToken ct) =>
        {
            await s.ChangeOwnPasswordAsync(u.UserId(), req, ct);
            return TypedResults.NoContent();
        }).RequireRateLimiting("login");

        // Users (Owner)
        secured.MapGet("/users", (UserService s, CancellationToken ct) => s.ListAsync(ct)).RequireAuthorization(Policies.Manage);
        secured.MapPost("/users", async (CreateUserRequest req, UserService s, System.Security.Claims.ClaimsPrincipal u, CancellationToken ct) =>
        {
            var user = await s.CreateAsync(req, u.ToActor(), ct);
            return TypedResults.Created($"/api/users/{user.Id}", user);
        }).RequireAuthorization(Policies.Manage);
        secured.MapPut("/users/{id:guid}", (Guid id, UpdateUserRequest req, UserService s, System.Security.Claims.ClaimsPrincipal u, CancellationToken ct) =>
            s.UpdateAsync(id, req, u.ToActor(), u.UserId(), ct)).RequireAuthorization(Policies.Manage);
        secured.MapPut("/users/{id:guid}/password", async (Guid id, ResetPasswordRequest req, UserService s, System.Security.Claims.ClaimsPrincipal u, CancellationToken ct) =>
        {
            await s.ResetPasswordAsync(id, req, u.ToActor(), ct);
            return TypedResults.NoContent();
        }).RequireAuthorization(Policies.Manage);

        // Public demo only
        secured.MapPost("/demo/reset", async Task<Results<NoContent, NotFound>> (Tesorero.Application.Abstractions.ITenantContext tenant,
            Tesorero.Infrastructure.Persistence.DataSeeder seeder, Tesorero.Application.Abstractions.IAppDbContext db, TimeProvider clock, System.Security.Claims.ClaimsPrincipal u, CancellationToken ct) =>
        {
            if (!tenant.IsDemo)
            {
                return TypedResults.NotFound();
            }

            await seeder.ResetDemoAsync(ct);
            db.AuditEvents.Add(new AuditEvent
            {
                At = clock.GetUtcNow(), Actor = u.ToActor().Name, ActorType = ActorType.User, Action = "demo.reset",
                EntityType = "Organization", Summary = "Demo data was reset.",
            });
            await db.SaveChangesAsync(ct);
            return TypedResults.NoContent();
        }).RequireAuthorization(Policies.Manage);

        secured.MapGet("/dashboard", (DashboardService s, CancellationToken ct) => s.GetAsync(ct));
        secured.MapGet("/tokens", (TokenCatalogService s, CancellationToken ct) => s.ListAsync(ct));

        // Payees
        secured.MapGet("/payees", (PayeeService s, CancellationToken ct) => s.ListAsync(ct));
        secured.MapPost("/payees", async (PayeeInput input, PayeeService s, System.Security.Claims.ClaimsPrincipal u, CancellationToken ct) =>
        {
            var payee = await s.CreateAsync(input, u.ToActor(), ct);
            return TypedResults.Created($"/api/payees/{payee.Id}", payee);
        }).RequireAuthorization(Policies.Manage);
        secured.MapPut("/payees/{id:guid}", (Guid id, PayeeInput input, PayeeService s, System.Security.Claims.ClaimsPrincipal u, CancellationToken ct) =>
            s.UpdateAsync(id, input, u.ToActor(), ct)).RequireAuthorization(Policies.Manage);
        secured.MapDelete("/payees/{id:guid}", async (Guid id, PayeeService s, System.Security.Claims.ClaimsPrincipal u, CancellationToken ct) =>
        {
            await s.ArchiveAsync(id, u.ToActor(), ct);
            return TypedResults.NoContent();
        }).RequireAuthorization(Policies.Manage);

        // Bills
        secured.MapGet("/bills", (BillStatus? status, BillService s, CancellationToken ct) => s.ListAsync(status, ct));
        secured.MapGet("/bills/{id:guid}", (Guid id, BillService s, CancellationToken ct) => s.GetAsync(id, ct));
        secured.MapPost("/bills/extract", (ExtractRequest req, BillExtractionService s, System.Security.Claims.ClaimsPrincipal u, CancellationToken ct) =>
            s.ExtractAsync(req.Text, u.ToActor(), ct)).RequireAuthorization(Policies.Operate).RequireRateLimiting("ai");
        secured.MapPost("/bills", async (BillInput input, BillService s, System.Security.Claims.ClaimsPrincipal u, CancellationToken ct) =>
        {
            var bill = await s.CreateAsync(input, u.ToActor(), ct);
            return TypedResults.Created($"/api/bills/{bill.Id}", bill);
        }).RequireAuthorization(Policies.Operate);
        secured.MapPut("/bills/{id:guid}", (Guid id, BillInput input, BillService s, System.Security.Claims.ClaimsPrincipal u, CancellationToken ct) =>
            s.UpdateAsync(id, input, u.ToActor(), ct)).RequireAuthorization(Policies.Operate);
        secured.MapPost("/bills/{id:guid}/cancel", (Guid id, BillService s, System.Security.Claims.ClaimsPrincipal u, CancellationToken ct) =>
            s.CancelAsync(id, u.ToActor(), ct)).RequireAuthorization(Policies.Manage);

        // On-chain treasury: creation, funding and movements (ADR-0007)
        secured.MapGet("/treasury", (TreasuryVaultService s, CancellationToken ct) => s.OverviewAsync(ct));
        secured.MapPost("/treasury/setup", async (TreasurySetupInput input, TreasuryVaultService s, System.Security.Claims.ClaimsPrincipal u, CancellationToken ct) =>
        {
            var dto = await s.CreateSetupAsync(input, u.ToActor(), ct);
            return Results.Created("/api/treasury", dto);
        }).RequireAuthorization(Policies.Manage);
        secured.MapPost("/treasury/setup/deploy", (TreasuryVaultService s, System.Security.Claims.ClaimsPrincipal u, CancellationToken ct) =>
            s.DeployAsync(u.ToActor(), ct)).RequireAuthorization(Policies.Manage);
        secured.MapDelete("/treasury/setup", async (TreasuryVaultService s, System.Security.Claims.ClaimsPrincipal u, CancellationToken ct) =>
        {
            await s.CancelSetupAsync(u.ToActor(), ct);
            return Results.NoContent();
        }).RequireAuthorization(Policies.Manage);
        secured.MapGet("/treasury/funding-options", (TreasuryFundingService s, CancellationToken ct) => s.OptionsAsync(ct));
        secured.MapGet("/treasury/fundings", (TreasuryFundingService s, CancellationToken ct) => s.ListAsync(ct));
        secured.MapPost("/treasury/fundings", async (FundingInput input, TreasuryFundingService s, System.Security.Claims.ClaimsPrincipal u, CancellationToken ct) =>
        {
            var dto = await s.CreateAsync(input, u.ToActor(), ct);
            return Results.Created("/api/treasury/fundings", dto);
        }).RequireAuthorization(Policies.Manage);
        secured.MapGet("/treasury/movements", (TreasuryFundingService s, CancellationToken ct) => s.MovementsAsync(ct));
        secured.MapPost("/treasury/freeze", (TreasuryVaultService s, System.Security.Claims.ClaimsPrincipal u, CancellationToken ct) =>
            s.FreezeAsync(u.ToActor(), ct)).RequireAuthorization(Policies.Manage);
        secured.MapPost("/payments/stop", (PolicyService s, System.Security.Claims.ClaimsPrincipal u, CancellationToken ct) =>
            s.SetPaymentsEnabledAsync(false, u.ToActor(), ct)).RequireAuthorization(Policies.Manage);
        secured.MapPost("/payments/resume", (PolicyService s, System.Security.Claims.ClaimsPrincipal u, CancellationToken ct) =>
            s.SetPaymentsEnabledAsync(true, u.ToActor(), ct)).RequireAuthorization(Policies.Manage);

        // Policy & settings
        secured.MapGet("/policy", (PolicyService s, CancellationToken ct) => s.GetAsync(ct));
        secured.MapPut("/policy", (PolicyInput input, PolicyService s, System.Security.Claims.ClaimsPrincipal u, CancellationToken ct) =>
            s.UpdateAsync(input, u.ToActor(), ct)).RequireAuthorization(Policies.Manage);
        secured.MapGet("/settings", (SettingsService s, CancellationToken ct) => s.GetAsync(ct));
        secured.MapPut("/settings", (SettingsInput input, SettingsService s, System.Security.Claims.ClaimsPrincipal u, CancellationToken ct) =>
            s.UpdateAsync(input, u.ToActor(), ct)).RequireAuthorization(Policies.Manage);

        // Agent
        secured.MapPost("/agent/runs", async (AgentRunRequest? req, AgentService s, System.Security.Claims.ClaimsPrincipal u, HttpRequest http, CancellationToken ct) =>
        {
            var trigger = req?.Mode == AgentRunMode.RedTeamDrill ? AgentTrigger.RedTeamDrill : AgentTrigger.Manual;
            var run = await s.StartAsync(trigger, u.ToActor(), ct, AgentService.Lang(http.Headers.AcceptLanguage.ToString()));
            return TypedResults.Accepted($"/api/agent/runs/{run.Id}", run);
        }).RequireAuthorization(Policies.Manage).RequireRateLimiting("ai");
        secured.MapGet("/agent/runs", (AgentService s, CancellationToken ct) => s.ListAsync(ct));
        secured.MapGet("/agent/runs/{id:guid}", (Guid id, AgentService s, CancellationToken ct) => s.GetAsync(id, ct));

        // Payments
        secured.MapGet("/payments", (PaymentStatus? status, PaymentService s, CancellationToken ct) => s.ListAsync(status, ct));
        secured.MapGet("/payments/export.csv", async (PaymentService s, TimeProvider clock, CancellationToken ct) =>
        {
            var csv = await s.ExportCsvAsync(ct);
            var name = $"tesorero-payments-{clock.GetUtcNow():yyyyMMdd}.csv";
            return TypedResults.File(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(csv)).ToArray(), "text/csv; charset=utf-8", name);
        });
        secured.MapGet("/payments/{id:guid}", (Guid id, PaymentService s, CancellationToken ct) => s.GetAsync(id, ct));
        secured.MapPost("/payments/{id:guid}/approve", (Guid id, DecisionRequest? req, PaymentService s, System.Security.Claims.ClaimsPrincipal u, CancellationToken ct) =>
            s.ApproveAsync(id, req?.Note, u.ToActor(), ct)).RequireAuthorization(Policies.Operate);
        secured.MapPost("/payments/{id:guid}/reject", (Guid id, DecisionRequest req, PaymentService s, System.Security.Claims.ClaimsPrincipal u, CancellationToken ct) =>
            s.RejectAsync(id, req.Note, u.ToActor(), ct)).RequireAuthorization(Policies.Operate);
        secured.MapPost("/payments/{id:guid}/deposit", (Guid id, DepositRequest req, PaymentService s, System.Security.Claims.ClaimsPrincipal u, CancellationToken ct) =>
            s.SubmitDepositAsync(id, req.TxHash, u.ToActor(), ct)).RequireAuthorization(Policies.Manage);

        // Audit
        secured.MapGet("/audit", (int? take, AuditService s, CancellationToken ct) => s.ListAsync(take ?? 100, ct));
    }
}

public static class AppVersion
{
    public static readonly VersionDto Current = new(
        Environment.GetEnvironmentVariable("APP_VERSION")
            ?? typeof(AppVersion).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "dev",
        Environment.GetEnvironmentVariable("APP_COMMIT") ?? "local",
        Environment.GetEnvironmentVariable("APP_BUILT_AT") ?? "local");
}
