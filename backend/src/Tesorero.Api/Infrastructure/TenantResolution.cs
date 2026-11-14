using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Tesorero.Application.Abstractions;
using Tesorero.Application.Common;
using Tesorero.Infrastructure.Persistence;

namespace Tesorero.Api.Infrastructure;

/// <summary>
/// Resolves the tenant from the Host header (ADR-0006):
/// <c>tesorero.gesco.ec</c> → landing (only instance + signup APIs), <c>slug.tesorero.gesco.ec</c> → that tenant,
/// any other host → <c>Tenancy:DefaultSlug</c> (the demo), so single-domain deployments keep working.
/// </summary>
public sealed class TenantResolutionMiddleware(RequestDelegate next)
{
    private static readonly string[] LandingApis = ["/api/instance", "/api/signup", "/api/version"];

    public async Task InvokeAsync(HttpContext ctx, AppDbContext db, ITenantContext tenant, IOptions<TenancyOptions> options, IProblemDetailsService problems)
    {
        ArgumentNullException.ThrowIfNull(ctx);
        var path = ctx.Request.Path;
        if (!path.StartsWithSegments("/api"))
        {
            await next(ctx);
            return;
        }

        var host = ctx.Request.Host.Host.ToLowerInvariant();
        var baseDomain = options.Value.BaseDomain.ToLowerInvariant();
        if (host == baseDomain || host == "www." + baseDomain)
        {
            tenant.SetLanding();
            if (!LandingApis.Any(p => path.StartsWithSegments(p)))
            {
                await NotFoundAsync(ctx, problems, "Open your organization's address (yourname." + baseDomain + ") to use Tesorero.");
                return;
            }

            await next(ctx);
            return;
        }

        if (path.StartsWithSegments("/api/signup"))
        {
            await NotFoundAsync(ctx, problems, "Sign up at " + options.Value.LandingUrl + ".");
            return;
        }

        var slug = host.EndsWith("." + baseDomain, StringComparison.Ordinal) ? host[..^(baseDomain.Length + 1)] : options.Value.DefaultSlug;
        var found = slug.Contains('.', StringComparison.Ordinal)
            ? null
            : await db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Slug == slug, ctx.RequestAborted);
        if (found is null)
        {
            await NotFoundAsync(ctx, problems, "There is no organization at this address.");
            return;
        }

        tenant.Set(found);
        await next(ctx);
    }

    private static async Task NotFoundAsync(HttpContext ctx, IProblemDetailsService problems, string detail)
    {
        ctx.Response.StatusCode = StatusCodes.Status404NotFound;
        await problems.WriteAsync(new ProblemDetailsContext
        {
            HttpContext = ctx,
            ProblemDetails = new ProblemDetails { Status = 404, Title = "Not found", Detail = detail },
        });
    }
}
