using System.Net;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Tesorero.Application.Abstractions;
using Tesorero.Application.Common;
using Tesorero.Application.Contracts;
using Tesorero.Domain;

namespace Tesorero.Application.Services;

/// <summary>Creates the server-side NEAR agent key of a new tenant (implemented in Infrastructure).</summary>
public interface IAgentKeyFactory
{
    (string AccountId, string SecretKey) Generate();
}

/// <summary>
/// Public signup on the landing (ADR-0006): e-mail verification + NEAR account existence, then the tenant is
/// created and the one-time setup link is e-mailed. Nothing is created before the e-mail is verified.
/// </summary>
public sealed partial class SignupService(
    IAppDbContext db,
    INearRpcClient rpc,
    IEmailSender email,
    ISecretVault vault,
    IAgentKeyFactory agentKeys,
    IOptions<TenancyOptions> tenancy,
    TimeProvider clock,
    ILogger<SignupService> logger)
{
    public static readonly IReadOnlySet<string> Reserved = new HashSet<string>(StringComparer.Ordinal)
    {
        "www", "demo", "api", "app", "admin", "mail", "smtp", "static", "media", "assets", "near", "tesorero",
        "status", "docs", "help", "support", "billing", "auth", "login", "signup", "setup",
    };

    public static readonly TimeSpan VerificationTtl = TimeSpan.FromHours(24);
    public static readonly TimeSpan SetupTtl = TimeSpan.FromDays(7);

    public static string NormalizeSlug(string? value) => (value ?? string.Empty).Trim().ToLowerInvariant();

    public async Task<SlugCheckDto> CheckSlugAsync(string? value, CancellationToken ct)
    {
        var slug = NormalizeSlug(value);
        if (!SlugRule().IsMatch(slug))
        {
            return new SlugCheckDto(slug, false, "invalid");
        }

        if (Reserved.Contains(slug))
        {
            return new SlugCheckDto(slug, false, "reserved");
        }

        return await db.Tenants.AnyAsync(t => t.Slug == slug, ct)
            ? new SlugCheckDto(slug, false, "taken")
            : new SlugCheckDto(slug, true, null);
    }

    public async Task<NearCheckDto> CheckNearAsync(string? accountId, CancellationToken ct)
    {
        var id = (accountId ?? string.Empty).Trim().ToLowerInvariant();
        if (id.Length is < 2 or > 64 || !AddressRules.NearAccount().IsMatch(id))
        {
            return new NearCheckDto(id, false, false);
        }

        return new NearCheckDto(id, await rpc.AccountExistsAsync(id, ct), true);
    }

    public async Task<SignupAccepted> SignupAsync(SignupRequest req, CancellationToken ct)
    {
        var mail = (req.Email ?? string.Empty).Trim().ToLowerInvariant();
        if (!string.IsNullOrEmpty(req.Website))
        {
            // Honeypot filled in: answer like a success, create and send nothing.
            LogHoneypot(logger);
            return new SignupAccepted(mail);
        }

        var lang = req.Language is "es" ? "es" : "en";
        new Validator()
            .Require(!string.IsNullOrWhiteSpace(req.OrganizationName) && req.OrganizationName.Trim().Length <= 80, "organizationName", "Organization name is required (max 80).")
            .Require(!string.IsNullOrWhiteSpace(req.OwnerName) && req.OwnerName.Trim().Length <= 80, "ownerName", "Your name is required (max 80).")
            .Require(Passwords.IsEmail(mail), "email", "Enter a valid e-mail.")
            .Require(req.AcceptTerms, "acceptTerms", "Please accept to continue.")
            .ThrowIfInvalid();

        var slug = await CheckSlugAsync(req.Slug, ct);
        if (!slug.Available)
        {
            throw ValidationFailedException.For("slug", slug.Reason switch
            {
                "taken" => "This subdomain is already taken.",
                "reserved" => "This subdomain is reserved.",
                _ => "Use 3–30 lowercase letters, numbers or hyphens.",
            });
        }

        var near = await CheckNearAsync(req.NearAccountId, ct);
        if (!near.Valid || !near.Exists)
        {
            throw ValidationFailedException.For("nearAccountId", near.Valid
                ? "This account does not exist on NEAR mainnet."
                : "Enter a NEAR account id, e.g. yourname.near.");
        }

        // One pending signup per e-mail: a new request replaces the previous unverified one.
        var previous = await db.PendingSignups.Where(p => p.Email == mail && p.VerifiedAt == null).ToListAsync(ct);
        db.PendingSignups.RemoveRange(previous);

        var token = Tokens.New();
        var now = clock.GetUtcNow();
        db.PendingSignups.Add(new PendingSignup
        {
            TokenHash = Tokens.Hash(token),
            OrganizationName = req.OrganizationName.Trim(),
            Slug = slug.Slug,
            OwnerName = req.OwnerName.Trim(),
            Email = mail,
            NearAccountId = near.AccountId,
            Language = lang,
            CreatedAt = now,
            ExpiresAt = now + VerificationTtl,
        });
        await db.SaveChangesAsync(ct);

        var link = $"{tenancy.Value.LandingUrl}/verify?token={Uri.EscapeDataString(token)}";
        await email.SendAsync(Emails.Verify(lang, mail, req.OwnerName.Trim(), req.OrganizationName.Trim(), link), ct);
        return new SignupAccepted(mail);
    }

    public async Task<VerifyResultDto> VerifyAsync(string? token, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            throw ValidationFailedException.For("token", "This verification link is not valid.");
        }

        var hash = Tokens.Hash(token.Trim());
        var pending = await db.PendingSignups.FirstOrDefaultAsync(p => p.TokenHash == hash, ct)
            ?? throw ValidationFailedException.For("token", "This verification link is not valid. Sign up again.");
        if (pending.VerifiedAt is not null)
        {
            throw new ConflictException("This e-mail is already verified. Check your inbox for the setup link of your organization.");
        }

        var now = clock.GetUtcNow();
        if (pending.ExpiresAt < now)
        {
            throw ValidationFailedException.For("token", "This verification link expired. Sign up again.");
        }

        if (await db.Tenants.AnyAsync(t => t.Slug == pending.Slug, ct))
        {
            throw new ConflictException($"The subdomain {pending.Slug} was taken in the meantime. Sign up again with another one.");
        }

        if (!await rpc.AccountExistsAsync(pending.NearAccountId, ct))
        {
            throw new ConflictException($"The NEAR account {pending.NearAccountId} no longer exists on mainnet.");
        }

        var setupToken = Tokens.New();
        var (agentAccount, agentSecret) = agentKeys.Generate();
        var tenant = new Tenant
        {
            Slug = pending.Slug,
            Name = pending.OrganizationName,
            OwnerEmail = pending.Email,
            NearAccountId = pending.NearAccountId,
            Language = pending.Language,
            SetupTokenHash = Tokens.Hash(setupToken),
            SetupTokenExpiresAt = now + SetupTtl,
            AgentAccountId = agentAccount,
            AgentKeyCiphertext = vault.Protect(agentSecret),
            CreatedAt = now,
        };
        db.Tenants.Add(tenant);
        db.Policies.Add(TreasuryPolicy.Conservative(tenant.Id, now));
        db.Settings.Add(new OrganizationSettings { TenantId = tenant.Id, OrganizationName = tenant.Name, ExecutionMode = ExecutionMode.Simulation });
        db.AuditEvents.Add(new AuditEvent
        {
            TenantId = tenant.Id, At = now, Actor = pending.Email, ActorType = ActorType.User, Action = "tenant.created",
            EntityType = "Organization", EntityId = tenant.Id.ToString(),
            Summary = $"{tenant.Name} created at {tenant.Slug}.{tenancy.Value.BaseDomain} after e-mail verification; NEAR account {tenant.NearAccountId}.",
        });
        pending.VerifiedAt = now;
        pending.TenantId = tenant.Id;
        await db.SaveChangesAsync(ct);

        var tenantUrl = tenancy.Value.TenantUrl(tenant.Slug);
        var setupLink = $"{tenantUrl}/setup?token={Uri.EscapeDataString(setupToken)}";
        await email.SendAsync(Emails.Setup(pending.Language, pending.Email, pending.OwnerName, tenant.Name, tenantUrl, setupLink), ct);
        return new VerifyResultDto(tenant.Name, tenant.Slug, tenantUrl, pending.Email);
    }

    [GeneratedRegex("^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$")]
    private static partial Regex SlugRule();

    [LoggerMessage(Level = LogLevel.Warning, Message = "Signup honeypot was filled in; request ignored")]
    private static partial void LogHoneypot(ILogger logger);
}

/// <summary>Bilingual transactional e-mails (inline styles: e-mail clients ignore stylesheets).</summary>
public static class Emails
{
    private static string E(string s) => WebUtility.HtmlEncode(s);

    private static string Layout(string title, string bodyHtml, string button, string link, string footer) => $"""
        <div style="background:#f5f5f4;padding:32px 16px;font-family:Segoe UI,Arial,sans-serif;color:#1c1917">
          <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e7e5e4;border-radius:12px;padding:32px">
            <div style="font-weight:700;font-size:20px;margin-bottom:24px"><span style="display:inline-block;background:#0e9f6e;color:#fff;border-radius:8px;padding:2px 9px;margin-right:8px">T</span>Tesorero</div>
            <h1 style="font-size:22px;margin:0 0 16px">{E(title)}</h1>
            {bodyHtml}
            <p style="margin:28px 0"><a href="{E(link)}" style="background:#047857;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block">{E(button)}</a></p>
            <p style="font-size:12px;color:#78716c;word-break:break-all">{E(link)}</p>
            <p style="font-size:12px;color:#78716c;margin-top:24px">{E(footer)}</p>
          </div>
        </div>
        """;

    public static EmailMessage Verify(string lang, string to, string name, string organization, string link)
    {
        var es = lang == "es";
        var title = es ? "Confirma tu email" : "Confirm your e-mail";
        var body = es
            ? $"<p>Hola {E(name)}:</p><p>Recibimos una solicitud para crear <b>{E(organization)}</b> en Tesorero. Confirma que este email es tuyo para crear tu organización. El enlace vence en 24 horas.</p>"
            : $"<p>Hi {E(name)},</p><p>We received a request to create <b>{E(organization)}</b> on Tesorero. Confirm this e-mail is yours to create your organization. The link expires in 24 hours.</p>";
        var footer = es ? "Si no fuiste tú, ignora este mensaje: no se creará nada." : "If this wasn't you, ignore this message: nothing will be created.";
        var html = Layout(title, body, es ? "Confirmar email" : "Confirm e-mail", link, footer);
        var text = $"{title}\n\n{organization}\n\n{link}\n\n{footer}";
        return new EmailMessage(to, es ? "Tesorero · Confirma tu email" : "Tesorero · Confirm your e-mail", html, text);
    }

    public static EmailMessage Setup(string lang, string to, string name, string organization, string tenantUrl, string link)
    {
        var es = lang == "es";
        var title = es ? "Tu tesorería está lista" : "Your treasury is ready";
        var body = es
            ? $"<p>Hola {E(name)}:</p><p>Verificamos tu email y tu cuenta NEAR. <b>{E(organization)}</b> ya tiene su espacio en <a href=\"{E(tenantUrl)}\">{E(tenantUrl)}</a>.</p><p>Abre el enlace para crear tu cuenta de dueño o dueña con este mismo email. Es de un solo uso y vence en 7 días.</p>"
            : $"<p>Hi {E(name)},</p><p>We verified your e-mail and your NEAR account. <b>{E(organization)}</b> now lives at <a href=\"{E(tenantUrl)}\">{E(tenantUrl)}</a>.</p><p>Open the link to create your Owner account with this same e-mail. It works once and expires in 7 days.</p>";
        var footer = es ? "No compartas este enlace: quien lo use primero administrará la organización." : "Don't share this link: whoever uses it first becomes the organization's Owner.";
        var html = Layout(title, body, es ? "Configurar mi organización" : "Set up my organization", link, footer);
        var text = $"{title}\n\n{organization}: {tenantUrl}\n\n{link}\n\n{footer}";
        return new EmailMessage(to, es ? "Tesorero · Configura tu organización" : "Tesorero · Set up your organization", html, text);
    }
}
