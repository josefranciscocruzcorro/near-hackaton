using Microsoft.Extensions.Diagnostics.HealthChecks;
using Tesorero.Infrastructure.Persistence;

namespace Tesorero.Api.Infrastructure;

public sealed class DatabaseHealthCheck(AppDbContext db) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default) =>
        await db.Database.CanConnectAsync(cancellationToken)
            ? HealthCheckResult.Healthy()
            : HealthCheckResult.Unhealthy("Database unreachable.");
}
