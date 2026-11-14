using System.Globalization;
using System.Text.Json;
using Tesorero.Application.Abstractions;

namespace Tesorero.Infrastructure.External;

/// <summary>
/// Public NearBlocks indexer (read-only): NEAR and fungible-token transfers of an account (ADR-0007).
/// The NEAR RPC only exposes current state, never history.
/// </summary>
public sealed class NearBlocksIndexer(HttpClient http) : INearIndexer
{
    private const string Service = "NearBlocks";

    public async Task<IReadOnlyList<IndexedTransfer>> GetTransfersAsync(string accountId, CancellationToken cancellationToken)
    {
        var id = Uri.EscapeDataString(accountId);
        var tokens = await GetAsync($"account/{id}/ft-txns?per_page=50", cancellationToken);
        var txns = await GetAsync($"account/{id}/txns-only?per_page=50", cancellationToken);
        var list = new List<IndexedTransfer>();

        foreach (var t in Items(tokens))
        {
            if (!t.TryGetProperty("ft", out var ft) || ft.ValueKind != JsonValueKind.Object
                || !decimal.TryParse(Str(t, "delta_amount"), NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var delta) || delta == 0)
            {
                continue;
            }

            var decimals = ft.TryGetProperty("decimals", out var d) && d.TryGetInt32(out var dec) ? dec : 0;
            var amount = Math.Abs(delta) / Pow10(decimals);
            list.Add(new IndexedTransfer(Str(t, "transaction_hash") ?? string.Empty, Time(t), delta > 0,
                Str(ft, "symbol") ?? Str(ft, "contract") ?? "?", Str(ft, "contract"), amount, Str(t, "involved_account_id")));
        }

        foreach (var t in Items(txns))
        {
            var deposit = 0m;
            if (t.TryGetProperty("actions", out var actions) && actions.ValueKind == JsonValueKind.Array)
            {
                foreach (var a in actions.EnumerateArray())
                {
                    if (a.TryGetProperty("deposit", out var dep) && Near.NearAmount.FromYocto(dep.GetRawText().Trim('"')) is { } near)
                    {
                        deposit += near;
                    }
                }
            }

            if (deposit <= 0)
            {
                continue;
            }

            var signer = Str(t, "signer_account_id") ?? Str(t, "predecessor_account_id");
            var receiver = Str(t, "receiver_account_id");
            var incoming = receiver == accountId && signer != accountId;
            var outgoing = signer == accountId;
            if (!incoming && !outgoing)
            {
                continue;
            }

            list.Add(new IndexedTransfer(Str(t, "transaction_hash") ?? string.Empty, Time(t), incoming, "NEAR", null,
                deposit, incoming ? signer : receiver));
        }

        return list.OrderByDescending(x => x.At).ToList();
    }

    private async Task<JsonDocument> GetAsync(string path, CancellationToken ct)
    {
        HttpResponseMessage response;
        try
        {
            response = await http.GetAsync(path, ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            throw new ExternalServiceException(Service, "The indexer did not respond.", ex);
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                throw new ExternalServiceException(Service, $"The indexer answered HTTP {(int)response.StatusCode}.");
            }

            try
            {
                return JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            }
            catch (JsonException ex)
            {
                throw new ExternalServiceException(Service, "Unreadable indexer response.", ex);
            }
        }
    }

    private static IEnumerable<JsonElement> Items(JsonDocument doc) =>
        doc.RootElement.TryGetProperty("txns", out var items) && items.ValueKind == JsonValueKind.Array ? items.EnumerateArray().ToList() : [];

    private static string? Str(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static DateTimeOffset Time(JsonElement t) =>
        decimal.TryParse(Str(t, "block_timestamp"), NumberStyles.None, CultureInfo.InvariantCulture, out var ns)
            ? DateTimeOffset.FromUnixTimeMilliseconds((long)(ns / 1_000_000m))
            : DateTimeOffset.MinValue;

    private static decimal Pow10(int n)
    {
        var r = 1m;
        for (var i = 0; i < n; i++)
        {
            r *= 10m;
        }

        return r;
    }
}
