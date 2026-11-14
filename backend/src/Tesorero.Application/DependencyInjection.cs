using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Tesorero.Application.Services;
using Tesorero.Domain;

namespace Tesorero.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton<IPasswordHasher<User>, PasswordHasher<User>>();
        services.AddScoped<AuthService>();
        services.AddScoped<TokenCatalogService>();
        services.AddScoped<PayeeService>();
        services.AddScoped<BillService>();
        services.AddScoped<BillExtractionService>();
        services.AddScoped<PolicyService>();
        services.AddScoped<SettingsService>();
        services.AddScoped<AuditService>();
        services.AddScoped<AgentService>();
        services.AddScoped<PaymentService>();
        services.AddScoped<DashboardService>();
        services.AddScoped<TreasuryService>();
        services.AddScoped<TreasuryVaultService>();
        services.AddScoped<TreasuryFundingService>();
        services.AddScoped<InstanceService>();
        services.AddScoped<UserService>();
        services.AddScoped<SignupService>();
        return services;
    }
}
