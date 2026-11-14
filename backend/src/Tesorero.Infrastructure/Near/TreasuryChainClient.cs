using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Tesorero.Application.Abstractions;
using Tesorero.Application.Common;

namespace Tesorero.Infrastructure.Near;

/// <summary>
/// Talks to the Tesorero treasury contract on NEAR mainnet: reads its guard state and, when an agent key
/// is configured, signs <c>pay</c>/<c>pause</c> transactions. All signing is serialised so nonces never collide.
/// </summary>
public sealed partial class TreasuryChainClient : ITreasuryChain
{
    private const string Service = "NEAR treasury";
    private static readonly SemaphoreSlim SigningLock = new(1, 1);

    private readonly HttpClient _http;
    private readonly NearOptions _options;
    private readonly ITenantContext _tenant;
    private readonly ISecretVault _vault;
    private readonly ILogger<TreasuryChainClient> _logger;

    public TreasuryChainClient(HttpClient http, IOptions<NearOptions> options, ITenantContext tenant, ISecretVault vault, ILogger<TreasuryChainClient> logger)
    {
        ArgumentNullException.ThrowIfNull(options);
        _http = http;
        _options = options.Value;
        _tenant = tenant;
        _vault = vault;
        _logger = logger;
    }

    /// <summary>Agent of the current tenant (ADR-0006); falls back to a server-wide key for single-tenant deployments.</summary>
    public string? AgentAccountId => _tenant.Tenant is { AgentKeyCiphertext: not null } t
        ? t.AgentAccountId
        : string.IsNullOrWhiteSpace(_options.AgentPrivateKey) || _tenant.IsDemo ? null
        : string.IsNullOrWhiteSpace(_options.AgentAccountId) ? NearKeyPair.Parse(_options.AgentPrivateKey).ImplicitAccountId : _options.AgentAccountId.Trim();

    /// <summary>Decrypted only for the duration of one signature.</summary>
    private NearKeyPair? AgentKey() => _tenant.Tenant is { AgentKeyCiphertext: { } cipher }
        ? NearKeyPair.Parse(_vault.Unprotect(cipher))
        : string.IsNullOrWhiteSpace(_options.AgentPrivateKey) || _tenant.IsDemo ? null : NearKeyPair.Parse(_options.AgentPrivateKey);

    public async Task<OnChainConfig?> GetConfigAsync(string contractId, CancellationToken cancellationToken)
    {
        var json = await ViewAsync(contractId, "get_config", new { }, cancellationToken);
        if (json is null || json.Value.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var c = json.Value;
        return new OnChainConfig(
            c.Str("owner_id", 100) ?? string.Empty,
            c.Str("agent_id", 100),
            c.Str("usdc_contract_id", 100) ?? string.Empty,
            U128(c, "max_per_payment"),
            U128(c, "daily_limit"),
            c.Bool("paused"),
            U128(c, "spent_today"),
            U128(c, "remaining_today"));
    }

    public async Task<OnChainPayment?> GetPaymentAsync(string contractId, string paymentId, CancellationToken cancellationToken)
    {
        var json = await ViewAsync(contractId, "get_payment", new { payment_id = paymentId }, cancellationToken);
        if (json is null || json.Value.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var p = json.Value;
        return new OnChainPayment(p.Str("payment_id", 64) ?? paymentId, p.Str("deposit_address", 100) ?? string.Empty, U128(p, "amount"), p.Str("status", 20) ?? "Unknown");
    }

    public Task<ChainTxResult> PayAsync(string contractId, string paymentId, string depositAddress, UInt128 amount, CancellationToken cancellationToken) =>
        CallAsync(contractId, "pay", new { payment_id = paymentId, deposit_address = depositAddress, amount = amount.ToString(CultureInfo.InvariantCulture) }, cancellationToken);

    public Task<ChainTxResult> PauseAsync(string contractId, CancellationToken cancellationToken) =>
        CallAsync(contractId, "pause", new { }, cancellationToken);

    private async Task<ChainTxResult> CallAsync(string contractId, string method, object args, CancellationToken ct)
    {
        var agentKey = AgentKey();
        var agentId = AgentAccountId;
        if (agentKey is null || agentId is null)
        {
            throw new ExternalServiceException(Service, "No agent key is configured for this organization.");
        }

        await SigningLock.WaitAsync(ct);
        try
        {
            for (var attempt = 1; ; attempt++)
            {
                var accessKey = await QueryAsync(new { request_type = "view_access_key", finality = "final", account_id = agentId, public_key = agentKey.PublicKeyText }, ct);
                var nonce = accessKey.TryGetProperty("nonce", out var n) && n.TryGetUInt64(out var value)
                    ? value + 1
                    : throw new ExternalServiceException(Service, "The agent access key was not found on-chain. Is the agent account funded?");
                var block = await RpcAsync("block", new { finality = "final" }, ct);
                var blockHash = Base58.Decode(block.GetProperty("header").GetProperty("hash").GetString()!);

                var tx = NearTransaction.Serialize(agentId, agentKey.PublicKey, nonce, contractId, blockHash,
                    [new FunctionCallAction(method, JsonSerializer.SerializeToUtf8Bytes(args), _options.PayGasTgas * 1_000_000_000_000UL, UInt128.Zero)]);
                var (hash, signed) = NearTransaction.Sign(tx, agentKey);

                try
                {
                    var outcome = await RpcAsync("send_tx", new { signed_tx_base64 = signed, wait_until = "EXECUTED_OPTIMISTIC" }, ct);
                    var error = FindFailure(outcome);
                    LogTx(_logger, method, contractId, hash, error ?? "ok");
                    return new ChainTxResult(hash, error is null, error);
                }
                catch (ExternalServiceException ex) when (attempt < 2 && ex.Message.Contains("nonce", StringComparison.OrdinalIgnoreCase))
                {
                    // Another signer raced us (e.g. the owner used the same key): fetch a fresh nonce once.
                }
            }
        }
        finally
        {
            SigningLock.Release();
        }
    }

    /// <summary>Returns a human-readable error if the transaction or any of its receipts failed.</summary>
    internal static string? FindFailure(JsonElement outcome)
    {
        if (outcome.TryGetProperty("status", out var status) && status.ValueKind == JsonValueKind.Object && status.TryGetProperty("Failure", out var failure))
        {
            return Readable(failure.GetRawText());
        }

        if (outcome.TryGetProperty("receipts_outcome", out var receipts) && receipts.ValueKind == JsonValueKind.Array)
        {
            foreach (var r in receipts.EnumerateArray())
            {
                if (r.TryGetProperty("outcome", out var o) && o.TryGetProperty("status", out var s)
                    && s.ValueKind == JsonValueKind.Object && s.TryGetProperty("Failure", out var f))
                {
                    return Readable(f.GetRawText());
                }
            }
        }

        return null;
    }

    private static string Readable(string failureJson)
    {
        var code = ContractError().Match(failureJson);
        if (code.Success)
        {
            return code.Value switch
            {
                "ERR_OVER_DAILY_LIMIT" => "The treasury contract refused: the on-chain daily limit would be exceeded.",
                "ERR_OVER_MAX_PER_PAYMENT" => "The treasury contract refused: above the on-chain per-payment maximum.",
                "ERR_PAUSED" => "The treasury contract is paused on-chain.",
                "ERR_NOT_AGENT" => "The treasury contract does not recognise this server as its agent.",
                "ERR_DUPLICATE_PAYMENT_ID" => "This payment was already submitted to the treasury contract.",
                "ERR_INSUFFICIENT_NEAR_FOR_STORAGE" => "The treasury contract needs more NEAR to register the deposit address.",
                _ => $"The treasury contract refused ({code.Value}).",
            };
        }

        return failureJson.Length > 300 ? failureJson[..300] : failureJson;
    }

    private async Task<JsonElement?> ViewAsync(string contractId, string method, object args, CancellationToken ct)
    {
        JsonElement result;
        try
        {
            result = await QueryAsync(new
            {
                request_type = "call_function",
                finality = "final",
                account_id = contractId,
                method_name = method,
                args_base64 = Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(args)),
            }, ct);
        }
        catch (ExternalServiceException ex) when (ex.Message.Contains("MethodNotFound", StringComparison.Ordinal)
                                                   || ex.Message.Contains("CodeDoesNotExist", StringComparison.Ordinal)
                                                   || ex.Message.Contains("does not exist", StringComparison.OrdinalIgnoreCase))
        {
            return null; // not a Tesorero treasury contract (e.g. a plain wallet account)
        }

        if (!result.TryGetProperty("result", out var bytes) || bytes.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        var raw = Encoding.UTF8.GetString(bytes.EnumerateArray().Select(b => b.GetByte()).ToArray());
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.ValueKind == JsonValueKind.Null ? null : doc.RootElement.Clone();
    }

    private async Task<JsonElement> QueryAsync(object parameters, CancellationToken ct)
    {
        var result = await RpcAsync("query", parameters, ct);
        if (result.TryGetProperty("error", out var callError))
        {
            throw new ExternalServiceException(Service, callError.GetRawText());
        }

        return result;
    }

    private async Task<JsonElement> RpcAsync(string method, object parameters, CancellationToken ct)
    {
        HttpResponseMessage response;
        try
        {
            response = await _http.PostAsJsonAsync(string.Empty, new { jsonrpc = "2.0", id = "tesorero", method, @params = parameters }, ct);
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
                    throw new ExternalServiceException(Service, error.GetRawText().Length > 400 ? error.GetRawText()[..400] : error.GetRawText());
                }

                return doc.RootElement.GetProperty("result").Clone();
            }
        }
    }

    private static UInt128 U128(JsonElement e, string name) =>
        UInt128.TryParse(e.Str(name, 40), NumberStyles.None, CultureInfo.InvariantCulture, out var v) ? v : UInt128.Zero;

    [GeneratedRegex("ERR_[A-Z_]+")]
    private static partial Regex ContractError();

    [LoggerMessage(Level = LogLevel.Information, Message = "NEAR {Method} on {Contract}: tx {Hash} → {Result}")]
    private static partial void LogTx(ILogger logger, string method, string contract, string hash, string result);
}
