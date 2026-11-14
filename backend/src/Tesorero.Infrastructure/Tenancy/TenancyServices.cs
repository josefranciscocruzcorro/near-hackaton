using System.Security.Cryptography;
using System.Text;
using Hangfire;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MimeKit;
using Tesorero.Application.Abstractions;
using Tesorero.Application.Common;
using Tesorero.Application.Services;
using Tesorero.Infrastructure.Near;

namespace Tesorero.Infrastructure.Tenancy;

/// <summary>AES-256-GCM with the server's master key (Tenancy:KeyEncryptionKey). Format: v1.base64(nonce|tag|cipher).</summary>
public sealed class AesGcmVault : ISecretVault
{
    private readonly byte[]? _key;

    public AesGcmVault(IOptions<TenancyOptions> options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var raw = options.Value.KeyEncryptionKey;
        if (!string.IsNullOrWhiteSpace(raw))
        {
            _key = Convert.FromBase64String(raw.Trim());
            if (_key.Length != 32)
            {
                throw new InvalidOperationException("Tenancy:KeyEncryptionKey must be 32 bytes (base64).");
            }
        }
    }

    private byte[] Key => _key ?? throw new InvalidOperationException("Tenancy:KeyEncryptionKey is not configured.");

    public string Protect(string plaintext)
    {
        ArgumentNullException.ThrowIfNull(plaintext);
        var nonce = RandomNumberGenerator.GetBytes(12);
        var data = Encoding.UTF8.GetBytes(plaintext);
        var cipher = new byte[data.Length];
        var tag = new byte[16];
        using var aes = new AesGcm(Key, 16);
        aes.Encrypt(nonce, data, cipher, tag);
        return "v1." + Convert.ToBase64String([.. nonce, .. tag, .. cipher]);
    }

    public string Unprotect(string ciphertext)
    {
        ArgumentNullException.ThrowIfNull(ciphertext);
        if (!ciphertext.StartsWith("v1.", StringComparison.Ordinal))
        {
            throw new CryptographicException("Unknown secret format.");
        }

        var all = Convert.FromBase64String(ciphertext[3..]);
        var plain = new byte[all.Length - 28];
        using var aes = new AesGcm(Key, 16);
        aes.Decrypt(all.AsSpan(0, 12), all.AsSpan(28), all.AsSpan(12, 16), plain);
        return Encoding.UTF8.GetString(plain);
    }
}

public sealed class AgentKeyFactory : IAgentKeyFactory
{
    public (string AccountId, string SecretKey) Generate()
    {
        var key = NearKeyPair.Generate();
        return (key.ImplicitAccountId, key.SecretKeyText);
    }
}

/// <summary>SMTP via MailKit (implicit TLS on 465, STARTTLS otherwise).</summary>
public sealed partial class SmtpEmailSender(IOptions<EmailOptions> options, ILogger<SmtpEmailSender> logger) : IEmailSender
{
    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(message);
        var o = options.Value;
        var mime = new MimeMessage();
        mime.From.Add(new MailboxAddress(o.FromName, string.IsNullOrWhiteSpace(o.From) ? o.User : o.From));
        mime.To.Add(MailboxAddress.Parse(message.To));
        mime.Subject = message.Subject;
        mime.Body = new BodyBuilder { HtmlBody = message.Html, TextBody = message.Text }.ToMessageBody();

        // A mail server that never answers must fail fast (the job retries), not hang the worker for minutes.
        using var client = new SmtpClient { Timeout = (int)TimeSpan.FromSeconds(20).TotalMilliseconds };
        try
        {
            var security = o.Port == 465 ? SecureSocketOptions.SslOnConnect : o.UseTls ? SecureSocketOptions.StartTls : SecureSocketOptions.Auto;
            await client.ConnectAsync(o.Host, o.Port, security, cancellationToken);
            if (!string.IsNullOrEmpty(o.User))
            {
                await client.AuthenticateAsync(o.User, o.Password, cancellationToken);
            }

            await client.SendAsync(new MailKit.SendRequest(mime), cancellationToken);
            await client.DisconnectAsync(true, cancellationToken);
            LogSent(logger, message.Subject);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            LogFailed(logger, ex);
            throw new ExternalServiceException("E-mail", "We could not send the e-mail right now. Please try again in a few minutes.", ex);
        }
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "E-mail sent: {Subject}")]
    private static partial void LogSent(ILogger logger, string subject);

    [LoggerMessage(Level = LogLevel.Error, Message = "E-mail delivery failed")]
    private static partial void LogFailed(ILogger logger, Exception ex);
}

/// <summary>Development fallback when no SMTP host is configured: the e-mail (with its links) goes to the log.</summary>
/// <summary>
/// Without SMTP (development, tests, demo recordings) e-mails are logged. With Email:PickupDirectory they are
/// also saved there as JSON (to, subject, html, text) so tools can open the exact message a user would get.
/// </summary>
public sealed partial class LogEmailSender(ILogger<LogEmailSender> logger, IOptions<EmailOptions> options, TimeProvider clock) : IEmailSender
{
    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(message);
        LogEmail(logger, message.To, message.Subject, message.Text);

        var folder = options.Value.PickupDirectory;
        if (string.IsNullOrWhiteSpace(folder))
        {
            return;
        }

        Directory.CreateDirectory(folder);
        var safeTo = new string(message.To.Select(c => char.IsLetterOrDigit(c) || c is '.' or '-' or '@' ? c : '_').ToArray());
        var file = Path.Combine(folder, $"{clock.GetUtcNow():yyyyMMddHHmmssfff}-{Guid.NewGuid():N}-{safeTo}.json");
        await File.WriteAllTextAsync(file, System.Text.Json.JsonSerializer.Serialize(new { message.To, message.Subject, message.Html, message.Text }), cancellationToken);
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "SMTP not configured. E-mail to {To} — {Subject}\n{Text}")]
    private static partial void LogEmail(ILogger logger, string to, string subject, string text);
}

/// <summary>The transport that really delivers (SMTP, or the log without SMTP). Only the e-mail job uses it.</summary>
public sealed class EmailTransport(IEmailSender sender)
{
    public Task SendAsync(EmailMessage message, CancellationToken cancellationToken) => sender.SendAsync(message, cancellationToken);
}

/// <summary>
/// Requests never wait for the mail server: the message is queued in Hangfire and delivered by
/// <see cref="EmailJob"/>, which retries with back-off while SMTP is down. A signup always answers at once.
/// </summary>
public sealed class QueuedEmailSender(IBackgroundJobClient jobs) : IEmailSender
{
    public Task SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(message);
        jobs.Enqueue<EmailJob>(j => j.SendAsync(message, CancellationToken.None));
        return Task.CompletedTask;
    }
}

public sealed class EmailJob(EmailTransport transport)
{
    [AutomaticRetry(Attempts = 10)]
    public Task SendAsync(EmailMessage message, CancellationToken cancellationToken) => transport.SendAsync(message, cancellationToken);
}
