using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Tesorero.Application.Common;
using Tesorero.Domain;

namespace Tesorero.Api.Infrastructure;

public sealed class JwtOptions
{
    public const string Section = "Jwt";
    public string Issuer { get; set; } = "tesorero";
    public string Audience { get; set; } = "tesorero-web";
    public string SigningKey { get; set; } = string.Empty;
    public int LifetimeHours { get; set; } = 12;

    public SymmetricSecurityKey Key()
    {
        if (Encoding.UTF8.GetByteCount(SigningKey) < 32)
        {
            throw new InvalidOperationException("Jwt:SigningKey must be at least 32 bytes.");
        }

        return new SymmetricSecurityKey(Encoding.UTF8.GetBytes(SigningKey));
    }
}

public static class Policies
{
    /// <summary>Owner only: payees, policy, settings, agent runs, deposits.</summary>
    public const string Manage = "manage";

    /// <summary>Owner or Approver: bills, AI intake, approvals.</summary>
    public const string Operate = "operate";
}

public static class TenantClaims
{
    public const string Name = "tid";
}

public sealed class TokenIssuer(Microsoft.Extensions.Options.IOptions<JwtOptions> options, TimeProvider clock)
{
    private const string TenantClaim = TenantClaims.Name;

    public (string Token, DateTimeOffset ExpiresAt) Issue(User user)
    {
        ArgumentNullException.ThrowIfNull(user);
        var o = options.Value;
        var expires = clock.GetUtcNow().AddHours(o.LifetimeHours);
        var token = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = o.Issuer,
            Audience = o.Audience,
            Expires = expires.UtcDateTime,
            Subject = new ClaimsIdentity(
            [
                new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
                new Claim(JwtRegisteredClaimNames.Email, user.Email),
                new Claim(JwtRegisteredClaimNames.Name, user.Name),
                new Claim(ClaimTypes.Role, user.Role.ToString()),
                new Claim(TenantClaim, user.TenantId.ToString()),
            ]),
            SigningCredentials = new SigningCredentials(o.Key(), SecurityAlgorithms.HmacSha256),
        });
        return (token, expires);
    }
}

public static class ClaimsExtensions
{
    public static Actor ToActor(this ClaimsPrincipal user) =>
        Actor.User(user.FindFirstValue(JwtRegisteredClaimNames.Email) ?? user.FindFirstValue(ClaimTypes.Email) ?? "unknown");

    public static Guid UserId(this ClaimsPrincipal user) =>
        Guid.TryParse(user.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? user.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : Guid.Empty;
}
