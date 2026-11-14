using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Tesorero.Application.Abstractions;

namespace Tesorero.Infrastructure.Near;

/// <summary>The audited treasury wasm embedded in this assembly (ADR-0007).</summary>
public sealed class EmbeddedTreasuryCode : ITreasuryCode
{
    /// <summary>Reference build (docs/guides/MAINNET.md); a different file means a tampered or stale build.</summary>
    public const string ExpectedSha256 = "24710670636342b3cc617e9c66d1a39f260350c38ff36c3ee7d8d08dc07b0a19";

    public EmbeddedTreasuryCode()
    {
        using var stream = typeof(EmbeddedTreasuryCode).Assembly.GetManifestResourceStream("Tesorero.TreasuryContract.wasm")
            ?? throw new InvalidOperationException("The treasury contract wasm is not embedded in the build.");
        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        Wasm = buffer.ToArray();
        var hash = SHA256.HashData(Wasm);
        Sha256Hex = Convert.ToHexStringLower(hash);
        Sha256Base58 = Base58.Encode(hash);
        if (Sha256Hex != ExpectedSha256)
        {
            throw new InvalidOperationException($"Embedded treasury wasm has sha256 {Sha256Hex}, expected {ExpectedSha256}.");
        }
    }

    public byte[] Wasm { get; }

    public string Sha256Hex { get; }

    public string Sha256Base58 { get; }
}

/// <summary>Raw NEAR RPC account operations used to create a treasury with a one-time key (ADR-0007).</summary>
public sealed partial class NearAccountsClient(HttpClient http, Microsoft.Extensions.Options.IOptions<Application.Common.NearOptions> options, ILogger<NearAccountsClient> logger) : INearAccounts
{
    private const string Service = "NEAR";

    public async Task<NearAccountState?> GetAsync(string accountId, CancellationToken cancellationToken)
    {
        var account = await QueryOrNullAsync(new { request_type = "view_account", finality = "final", account_id = accountId }, cancellationToken);
        if (account is null)
        {
            return null;
        }

        var a = account.Value;
        var near = NearAmount.FromYocto(a.GetProperty("amount").GetString()) ?? 0m;
        var keys = await QueryOrNullAsync(new { request_type = "view_access_key_list", finality = "final", account_id = accountId }, cancellationToken);
        var count = keys is { } k && k.TryGetProperty("keys", out var list) && list.ValueKind == JsonValueKind.Array ? list.GetArrayLength() : 0;
        return new NearAccountState(near, a.GetProperty("code_hash").GetString() ?? string.Empty, count);
    }

    public async Task<bool> IsUsdcRegisteredAsync(string accountId, CancellationToken cancellationToken)
    {
        var result = await QueryOrNullAsync(new
        {
            request_type = "call_function",
            finality = "final",
            account_id = options.Value.UsdcContract,
            method_name = "storage_balance_of",
            args_base64 = Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(new { account_id = accountId })),
        }, cancellationToken);
        if (result is not { } r || !r.TryGetProperty("result", out var bytes) || bytes.ValueKind != JsonValueKind.Array)
        {
            return false;
        }

        var raw = Encoding.UTF8.GetString(bytes.EnumerateArray().Select(b => b.GetByte()).ToArray()).Trim();
        return raw.Length > 0 && raw != "null";
    }

    public string PublicKeyOf(string secretKey) => NearKeyPair.Parse(secretKey).PublicKeyText;

    public async Task<string> SendAsync(string signerId, string secretKey, string receiverId, IReadOnlyList<ChainAction> actions, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actions);
        var key = NearKeyPair.Parse(secretKey);
        var accessKey = await QueryOrNullAsync(new { request_type = "view_access_key", finality = "final", account_id = signerId, public_key = key.PublicKeyText }, cancellationToken)
            ?? throw new ExternalServiceException(Service, $"The key for {signerId} is not on-chain (has the account received NEAR?).");
        var nonce = accessKey.TryGetProperty("nonce", out var n) && n.TryGetUInt64(out var value)
            ? value + 1
            : throw new ExternalServiceException(Service, "Could not read the access key nonce.");
        var block = await RpcAsync("block", new { finality = "final" }, cancellationToken);
        var blockHash = Base58.Decode(block.GetProperty("header").GetProperty("hash").GetString()!);

        var wire = actions.Select<ChainAction, NearAction>(a => a switch
        {
            ChainCall c => new FunctionCallAction(c.Method, Encoding.UTF8.GetBytes(c.ArgsJson), c.Gas, c.Deposit),
            ChainDeploy d => new DeployContractAction(d.Code),
            ChainTransfer t => new TransferAction(t.Yocto),
            ChainDeleteKey d => new DeleteKeyAction(Base58.Decode(d.PublicKey.Replace("ed25519:", string.Empty, StringComparison.Ordinal))),
            _ => throw new ArgumentException($"Unsupported action {a.GetType().Name}.", nameof(actions)),
        }).ToList();
        var tx = NearTransaction.Serialize(signerId, key.PublicKey, nonce, receiverId, blockHash, wire);
        var (hash, signed) = NearTransaction.Sign(tx, key);

        var outcome = await RpcAsync("send_tx", new { signed_tx_base64 = signed, wait_until = "FINAL" }, cancellationToken);
        var failure = TreasuryChainClient.FindFailure(outcome);
        LogSent(logger, signerId, receiverId, hash, failure ?? "ok");
        if (failure is not null)
        {
            throw new ExternalServiceException(Service, $"Transaction {hash} failed: {failure}");
        }

        return hash;
    }

    private async Task<JsonElement?> QueryOrNullAsync(object parameters, CancellationToken ct)
    {
        try
        {
            var result = await RpcAsync("query", parameters, ct);
            if (result.TryGetProperty("error", out var callError))
            {
                var text = callError.GetRawText();
                if (IsMissing(text))
                {
                    return null;
                }

                throw new ExternalServiceException(Service, text.Length > 300 ? text[..300] : text);
            }

            return result;
        }
        catch (ExternalServiceException ex) when (IsMissing(ex.Message))
        {
            return null;
        }
    }

    private static bool IsMissing(string text) =>
        text.Contains("UNKNOWN_ACCOUNT", StringComparison.Ordinal)
        || text.Contains("UNKNOWN_ACCESS_KEY", StringComparison.Ordinal)
        || text.Contains("does not exist", StringComparison.OrdinalIgnoreCase)
        || text.Contains("CodeDoesNotExist", StringComparison.Ordinal)
        || text.Contains("MethodNotFound", StringComparison.Ordinal);

    private async Task<JsonElement> RpcAsync(string method, object parameters, CancellationToken ct)
    {
        HttpResponseMessage response;
        try
        {
            response = await http.PostAsJsonAsync(string.Empty, new { jsonrpc = "2.0", id = "tesorero", method, @params = parameters }, ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            throw new ExternalServiceException(Service, "The NEAR RPC did not respond.", ex);
        }

        using (response)
        {
            var text = await response.Content.ReadAsStringAsync(ct);
            JsonDocument doc;
            try
            {
                doc = JsonDocument.Parse(text);
            }
            catch (JsonException ex)
            {
                throw new ExternalServiceException(Service, $"Unreadable RPC response (HTTP {(int)response.StatusCode}).", ex);
            }

            using (doc)
            {
                if (doc.RootElement.TryGetProperty("error", out var error))
                {
                    var raw = error.GetRawText();
                    throw new ExternalServiceException(Service, raw.Length > 400 ? raw[..400] : raw);
                }

                return doc.RootElement.GetProperty("result").Clone();
            }
        }
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "NEAR tx {Signer} → {Receiver}: {Hash} ({Result})")]
    private static partial void LogSent(ILogger logger, string signer, string receiver, string hash, string result);
}
