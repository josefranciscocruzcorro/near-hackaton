using System.Net.Mail;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Tesorero.Application.Abstractions;
using Tesorero.Application.Common;
using Tesorero.Application.Contracts;
using Tesorero.Domain;

namespace Tesorero.Application.Services;

/// <summary>One-time secrets (signup and setup links): random, URL-safe, stored only as SHA-256.</summary>
public static class Tokens
{
    public static string New() => Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32))
        .Replace('+', '-').Replace('/', '_').TrimEnd('=');

    public static string Hash(string token) =>
        Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(token)));

    public static bool Matches(string? token, string hash) =>
        !string.IsNullOrEmpty(token)
        && System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
            System.Text.Encoding.ASCII.GetBytes(Hash(token)), System.Text.Encoding.ASCII.GetBytes(hash));
}

internal static class Passwords
{
    public const int MinLength = 12;

    public static Validator RequireStrong(this Validator v, string? password, string field) =>
        v.Require(password is { Length: >= MinLength and <= 128 }, field, $"Use at least {MinLength} characters (max 128).");

    public static bool IsEmail(string? value) =>
        !string.IsNullOrWhiteSpace(value) && value.Length <= 160 && MailAddress.TryCreate(value.Trim(), out var m) && m.Address == value.Trim();
}

/// <summary>Instance info for the current host and first-run setup of a tenant (ADR-0006).</summary>
public sealed class InstanceService(IAppDbContext db, IPasswordHasher<User> hasher, ITenantContext tenant, IOptions<TenancyOptions> tenancy, TimeProvider clock)
{
    public async Task<InstanceDto> GetAsync(CancellationToken ct)
    {
        var o = tenancy.Value;
        var demoUrl = o.TenantUrl(Tenant.DemoSlug);
        if (tenant.IsLanding || tenant.Tenant is null)
        {
            return new InstanceDto("landing", false, false, false, null, null, o.BaseDomain, demoUrl, o.LandingUrl);
        }

        var t = tenant.Tenant;
        var needsSetup = !await db.Users.AnyAsync(ct);
        return new InstanceDto("tenant", t.IsDemo, needsSetup, needsSetup && !t.IsDemo, t.Name, t.Slug, o.BaseDomain, demoUrl, o.LandingUrl, t.Language);
    }

    public async Task<User> SetupAsync(SetupRequest req, CancellationToken ct)
    {
        new Validator()
            .Require(!string.IsNullOrWhiteSpace(req.OrganizationName) && req.OrganizationName.Trim().Length <= 80, "organizationName", "Organization name is required (max 80).")
            .Require(!string.IsNullOrWhiteSpace(req.OwnerName) && req.OwnerName.Trim().Length <= 80, "ownerName", "Your name is required (max 80).")
            .Require(Passwords.IsEmail(req.Email), "email", "Enter a valid e-mail.")
            .RequireStrong(req.Password, "password")
            .ThrowIfInvalid();

        var current = tenant.Tenant ?? throw new ForbiddenException("Open the setup link of your organization.");
        var t = await db.Tenants.FirstAsync(x => x.Id == current.Id, ct);
        if (await db.Users.AnyAsync(ct))
        {
            throw new ConflictException("This organization is already set up. Sign in instead.");
        }

        if (t.IsDemo)
        {
            throw new ForbiddenException("The public demo cannot be set up.");
        }

        if (t.SetupTokenHash is null || t.SetupTokenExpiresAt < clock.GetUtcNow() || !Tokens.Matches(req.SetupToken, t.SetupTokenHash))
        {
            throw new ForbiddenException("This setup link is not valid or has expired. Use the link we e-mailed you.");
        }

        var email = req.Email.Trim().ToLowerInvariant();
        if (t.OwnerEmail is { } verified && !string.Equals(verified, email, StringComparison.OrdinalIgnoreCase))
        {
            throw ValidationFailedException.For("email", "Use the e-mail address you verified when you signed up.");
        }

        var owner = new User { Email = email, Name = req.OwnerName.Trim(), Role = Role.Owner, CreatedAt = clock.GetUtcNow() };
        owner.PasswordHash = hasher.HashPassword(owner, req.Password);
        db.Users.Add(owner);
        var settings = await db.Settings.SingleAsync(ct);
        settings.OrganizationName = req.OrganizationName.Trim();
        t.Name = settings.OrganizationName;
        t.SetupTokenHash = null;
        t.SetupTokenExpiresAt = null;
        db.Record(clock, Actor.User(owner.Email), "instance.setup", "Organization", t.Id, $"{t.Name} set up; first owner {owner.Email}.");
        await db.SaveChangesAsync(ct);
        return owner;
    }
}

public sealed class UserService(IAppDbContext db, IPasswordHasher<User> hasher, ITenantContext tenant, TimeProvider clock)
{
    /// <summary>The shared demo accounts must keep working for every visitor of the public demo.</summary>
    public const string DemoDomain = "@tesorero.demo";

    private void GuardDemoAccount(User user)
    {
        if (tenant.IsDemo && user.Email.EndsWith(DemoDomain, StringComparison.OrdinalIgnoreCase))
        {
            throw new ConflictException("The shared demo accounts are read-only on the public demo. Invite a new user to try this.");
        }
    }

    public async Task<IReadOnlyList<UserAdminDto>> ListAsync(CancellationToken ct) =>
        (await db.Users.OrderBy(u => u.Name).ToListAsync(ct)).Select(u => u.ToAdminDto()).ToList();

    public async Task<UserAdminDto> CreateAsync(CreateUserRequest req, Actor actor, CancellationToken ct)
    {
        new Validator()
            .Require(Passwords.IsEmail(req.Email), "email", "Enter a valid e-mail.")
            .Require(!string.IsNullOrWhiteSpace(req.Name) && req.Name.Trim().Length <= 80, "name", "Name is required (max 80).")
            .Require(Enum.IsDefined(req.Role), "role", "Unknown role.")
            .RequireStrong(req.Password, "password")
            .ThrowIfInvalid();

        var email = req.Email.Trim().ToLowerInvariant();
        if (await db.Users.AnyAsync(u => u.Email == email, ct))
        {
            throw new ConflictException("A user with this e-mail already exists.");
        }

        var user = new User { Email = email, Name = req.Name.Trim(), Role = req.Role, CreatedAt = clock.GetUtcNow() };
        user.PasswordHash = hasher.HashPassword(user, req.Password);
        db.Users.Add(user);
        db.Record(clock, actor, "user.created", "User", user.Id, $"Added {user.Email} as {user.Role}.");
        await db.SaveChangesAsync(ct);
        return user.ToAdminDto();
    }

    public async Task<UserAdminDto> UpdateAsync(Guid id, UpdateUserRequest req, Actor actor, Guid actorId, CancellationToken ct)
    {
        new Validator()
            .Require(!string.IsNullOrWhiteSpace(req.Name) && req.Name.Trim().Length <= 80, "name", "Name is required (max 80).")
            .Require(Enum.IsDefined(req.Role), "role", "Unknown role.")
            .ThrowIfInvalid();

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id, ct) ?? throw new NotFoundException("User", id);
        GuardDemoAccount(user);
        var losesOwnership = user.Role == Role.Owner && user.IsActive && (req.Role != Role.Owner || !req.IsActive);
        if (losesOwnership && id == actorId)
        {
            throw new ConflictException("You cannot remove your own Owner role or deactivate yourself. Ask another Owner.");
        }

        if (losesOwnership && !await db.Users.AnyAsync(u => u.Id != id && u.Role == Role.Owner && u.IsActive, ct))
        {
            throw new ConflictException("At least one active Owner must remain.");
        }

        var changes = new List<string>();
        if (user.Role != req.Role)
        {
            changes.Add($"role {user.Role} → {req.Role}");
        }

        if (user.IsActive != req.IsActive)
        {
            changes.Add(req.IsActive ? "re-activated" : "deactivated");
        }

        user.Name = req.Name.Trim();
        user.Role = req.Role;
        user.IsActive = req.IsActive;
        db.Record(clock, actor, "user.updated", "User", user.Id, $"Updated {user.Email}{(changes.Count > 0 ? ": " + string.Join(", ", changes) : string.Empty)}.");
        await db.SaveChangesAsync(ct);
        return user.ToAdminDto();
    }

    public async Task ResetPasswordAsync(Guid id, ResetPasswordRequest req, Actor actor, CancellationToken ct)
    {
        new Validator().RequireStrong(req.NewPassword, "newPassword").ThrowIfInvalid();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id, ct) ?? throw new NotFoundException("User", id);
        GuardDemoAccount(user);
        user.PasswordHash = hasher.HashPassword(user, req.NewPassword);
        db.Record(clock, actor, "user.password.reset", "User", user.Id, $"Password of {user.Email} was reset by an Owner.");
        await db.SaveChangesAsync(ct);
    }

    public async Task ChangeOwnPasswordAsync(Guid userId, ChangePasswordRequest req, CancellationToken ct)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct) ?? throw new NotFoundException("User", userId);
        GuardDemoAccount(user);
        var v = new Validator().RequireStrong(req.NewPassword, "newPassword");
        v.Require(hasher.VerifyHashedPassword(user, user.PasswordHash, req.CurrentPassword ?? string.Empty) != PasswordVerificationResult.Failed,
            "currentPassword", "The current password is not correct.");
        v.Require(req.NewPassword != req.CurrentPassword, "newPassword", "Choose a different password.");
        v.ThrowIfInvalid();

        user.PasswordHash = hasher.HashPassword(user, req.NewPassword);
        db.Record(clock, Actor.User(user.Email), "user.password.changed", "User", user.Id, $"{user.Email} changed their password.");
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Used on every authenticated request: the token is only valid while the user is active with the same role.</summary>
    public async Task<bool> IsStillValidAsync(Guid userId, string? role, CancellationToken ct) =>
        Enum.TryParse<Role>(role, out var expected)
        && await db.Users.AnyAsync(u => u.Id == userId && u.IsActive && u.Role == expected, ct);
}
