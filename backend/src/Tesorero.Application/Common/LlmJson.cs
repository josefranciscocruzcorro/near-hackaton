using System.Globalization;
using System.Text.Json;

namespace Tesorero.Application.Common;

/// <summary>Defensive helpers for reading model output. Models are untrusted producers.</summary>
public static class LlmJson
{
    public static JsonDocument Parse(string content)
    {
        var text = content.Trim();
        if (text.StartsWith("```", StringComparison.Ordinal))
        {
            var firstNewLine = text.IndexOf('\n', StringComparison.Ordinal);
            var lastFence = text.LastIndexOf("```", StringComparison.Ordinal);
            if (firstNewLine > 0 && lastFence > firstNewLine)
            {
                text = text[(firstNewLine + 1)..lastFence];
            }
        }

        var start = text.IndexOf('{', StringComparison.Ordinal);
        var end = text.LastIndexOf('}');
        if (start < 0 || end <= start)
        {
            throw new JsonException("The model did not return a JSON object.");
        }

        return JsonDocument.Parse(text[start..(end + 1)]);
    }

    public static string? Str(this JsonElement e, string name, int maxLength = 500)
    {
        if (e.ValueKind != JsonValueKind.Object || !e.TryGetProperty(name, out var v))
        {
            return null;
        }

        var s = v.ValueKind switch
        {
            JsonValueKind.String => v.GetString(),
            JsonValueKind.Number => v.GetRawText(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => null,
        };
        if (string.IsNullOrWhiteSpace(s))
        {
            return null;
        }

        s = s.Trim();
        return s.Length > maxLength ? s[..maxLength] : s;
    }

    public static decimal? Dec(this JsonElement e, string name)
    {
        if (e.ValueKind != JsonValueKind.Object || !e.TryGetProperty(name, out var v))
        {
            return null;
        }

        if (v.ValueKind == JsonValueKind.Number && v.TryGetDecimal(out var d))
        {
            return d;
        }

        if (v.ValueKind == JsonValueKind.String)
        {
            var cleaned = new string((v.GetString() ?? string.Empty).Where(c => char.IsDigit(c) || c is '.' or '-').ToArray());
            if (decimal.TryParse(cleaned, NumberStyles.Number, CultureInfo.InvariantCulture, out d))
            {
                return d;
            }
        }

        return null;
    }

    public static bool Bool(this JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v)
        && (v.ValueKind == JsonValueKind.True
            || (v.ValueKind == JsonValueKind.String && string.Equals(v.GetString(), "true", StringComparison.OrdinalIgnoreCase)));

    public static DateOnly? Date(this JsonElement e, string name) =>
        DateOnly.TryParseExact(e.Str(name, 20), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;

    public static TEnum? Enum<TEnum>(this JsonElement e, string name)
        where TEnum : struct, Enum =>
        System.Enum.TryParse<TEnum>(e.Str(name, 40), ignoreCase: true, out var value) && System.Enum.IsDefined(value) ? value : null;
}
