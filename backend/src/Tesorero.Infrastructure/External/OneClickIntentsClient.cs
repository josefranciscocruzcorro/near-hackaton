using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Tesorero.Application.Abstractions;
using Tesorero.Application.Common;

namespace Tesorero.Infrastructure.External;

/// <summary>NEAR Intents 1Click API (https://docs.near-intents.org). There is no testnet: Simulation mode uses dry quotes.</summary>
public sealed class OneClickIntentsClient(HttpClient http, IOptions<IntentsOptions> options) : IIntentsClient
{
    private const string Service = "NEAR Intents";

    public async Task<IReadOnlyList<IntentsToken>> GetTokensAsync(CancellationToken cancellationToken)
    {
        using var doc = await SendAsync(new HttpRequestMessage(HttpMethod.Get, "v0/tokens"), cancellationToken);
        var list = new List<IntentsToken>();
        foreach (var t in doc.RootElement.EnumerateArray())
        {
            var assetId = t.Str("assetId", 200);
            var symbol = t.Str("symbol", 40);
            var chain = t.Str("blockchain", 40);
            if (assetId is null || symbol is null || chain is null)
            {
                continue;
            }

            var decimals = t.TryGetProperty("decimals", out var d) && d.TryGetInt32(out var dec) ? dec : 0;
            list.Add(new IntentsToken(assetId, symbol, chain, decimals, t.Dec("price")));
        }

        return list;
    }

    public async Task<IntentsQuote> QuoteAsync(IntentsQuoteRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var body = new Dictionary<string, object>
        {
            ["dry"] = request.Dry,
            ["swapType"] = "EXACT_INPUT",
            ["slippageTolerance"] = options.Value.SlippageBps,
            ["originAsset"] = request.OriginAsset,
            ["depositType"] = "ORIGIN_CHAIN",
            ["destinationAsset"] = request.DestinationAsset,
            ["amount"] = request.AmountIn,
            ["recipient"] = request.Recipient,
            ["recipientType"] = "DESTINATION_CHAIN",
            ["refundTo"] = request.RefundTo,
            ["refundType"] = "ORIGIN_CHAIN",
            ["deadline"] = request.Deadline.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture),
        };

        using var doc = await SendAsync(new HttpRequestMessage(HttpMethod.Post, "v0/quote") { Content = JsonContent.Create(body) }, cancellationToken);
        if (!doc.RootElement.TryGetProperty("quote", out var q))
        {
            throw new ExternalServiceException(Service, "The quote response had no quote.");
        }

        DateTimeOffset? deadline = DateTimeOffset.TryParse(q.Str("deadline", 40), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed)
            ? parsed
            : request.Deadline;
        return new IntentsQuote(
            q.Str("amountIn", 80) ?? request.AmountIn,
            q.Str("amountOut", 80) ?? "0",
            q.Str("amountOutFormatted", 80) ?? "0",
            q.Dec("amountOutUsd") is { } usd ? decimal.Round(usd, 2) : null,
            q.Str("depositAddress", 200),
            deadline,
            q.Str("depositMemo", 200));
    }

    public async Task SubmitDepositAsync(string depositAddress, string txHash, CancellationToken cancellationToken)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "v0/deposit/submit")
        {
            Content = JsonContent.Create(new { depositAddress, txHash }),
        };
        using var _ = await SendAsync(request, cancellationToken);
    }

    public async Task<IntentsStatus> GetStatusAsync(string depositAddress, CancellationToken cancellationToken)
    {
        using var doc = await SendAsync(
            new HttpRequestMessage(HttpMethod.Get, $"v0/status?depositAddress={Uri.EscapeDataString(depositAddress)}"), cancellationToken);
        var root = doc.RootElement;
        string? destinationTx = null;
        if (root.TryGetProperty("swapDetails", out var details)
            && details.TryGetProperty("destinationChainTxHashes", out var hashes)
            && hashes.ValueKind == JsonValueKind.Array
            && hashes.GetArrayLength() > 0)
        {
            destinationTx = hashes[0].Str("hash", 200);
        }

        return new IntentsStatus(root.Str("status", 40) ?? "UNKNOWN", destinationTx);
    }

    private async Task<JsonDocument> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        using (request)
        {
            if (options.Value.Jwt is { } jwt && jwt.Count(c => c == '.') == 2 && !jwt.Contains(' ', StringComparison.Ordinal))
            {
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", options.Value.Jwt);
            }

            HttpResponseMessage response;
            try
            {
                response = await http.SendAsync(request, ct);
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
            {
                throw new ExternalServiceException(Service, "The service did not respond.", ex);
            }

            using (response)
            {
                var text = await response.Content.ReadAsStringAsync(ct);
                if (!response.IsSuccessStatusCode)
                {
                    throw new ExternalServiceException(Service, ReadError(text, (int)response.StatusCode));
                }

                try
                {
                    return JsonDocument.Parse(text);
                }
                catch (JsonException ex)
                {
                    throw new ExternalServiceException(Service, "Unreadable response.", ex);
                }
            }
        }
    }

    private static string ReadError(string body, int status)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            var message = doc.RootElement.Str("message", 300);
            return message is null ? $"HTTP {status}" : $"{message} (HTTP {status})";
        }
        catch (JsonException)
        {
            return $"HTTP {status}";
        }
    }
}

/// <summary>Reads treasury balances from NEAR mainnet via public JSON-RPC.</summary>
public sealed class NearRpcClient(HttpClient http, IOptions<NearOptions> options) : INearRpcClient
{
    private const string Service = "NEAR RPC";

    public async Task<bool> AccountExistsAsync(string accountId, CancellationToken cancellationToken)
    {
        try
        {
            await QueryAsync(new { request_type = "view_account", finality = "final", account_id = accountId }, cancellationToken);
            return true;
        }
        catch (ExternalServiceException ex) when (ex.Message.Contains("UNKNOWN_ACCOUNT", StringComparison.OrdinalIgnoreCase)
                                                   || ex.Message.Contains("does not exist", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }
    }

    public async Task<TreasuryBalances> GetBalancesAsync(string accountId, CancellationToken cancellationToken)
    {
        var account = await QueryAsync(new
        {
            request_type = "view_account",
            finality = "final",
            account_id = accountId,
        }, cancellationToken);
        decimal? near = Near.NearAmount.FromYocto(account.Str("amount", 60));

        var args = Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(new { account_id = accountId }));
        var call = await QueryAsync(new
        {
            request_type = "call_function",
            finality = "final",
            account_id = options.Value.UsdcContract,
            method_name = "ft_balance_of",
            args_base64 = args,
        }, cancellationToken);

        decimal? usdc = null;
        if (call.TryGetProperty("result", out var bytes) && bytes.ValueKind == JsonValueKind.Array)
        {
            var raw = new string(bytes.EnumerateArray().Select(b => (char)b.GetByte()).ToArray()).Trim('"');
            if (decimal.TryParse(raw, NumberStyles.None, CultureInfo.InvariantCulture, out var units))
            {
                usdc = units / 1_000_000m;
            }
        }

        return new TreasuryBalances(usdc, near);
    }

    private async Task<JsonElement> QueryAsync(object parameters, CancellationToken ct)
    {
        HttpResponseMessage response;
        try
        {
            response = await http.PostAsJsonAsync(string.Empty, new { jsonrpc = "2.0", id = "tesorero", method = "query", @params = parameters }, ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            throw new ExternalServiceException(Service, "The RPC did not respond.", ex);
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                throw new ExternalServiceException(Service, $"HTTP {(int)response.StatusCode}");
            }

            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            if (doc.RootElement.TryGetProperty("error", out var error))
            {
                var raw = error.GetRawText();
                throw new ExternalServiceException(Service, raw.Length > 400 ? raw[..400] : raw);
            }

            if (!doc.RootElement.TryGetProperty("result", out var result))
            {
                throw new ExternalServiceException(Service, "No result.");
            }

            if (result.TryGetProperty("error", out var callError))
            {
                throw new ExternalServiceException(Service, callError.GetRawText());
            }

            return result.Clone();
        }
    }
}
