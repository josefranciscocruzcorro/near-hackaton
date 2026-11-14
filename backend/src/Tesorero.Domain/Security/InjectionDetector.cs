using System.Text.RegularExpressions;

namespace Tesorero.Domain.Security;

/// <summary>
/// Deterministic, model-independent screen for text that tries to steer an AI or to
/// pressure a change of payment details. It complements (never replaces) the LLM's own judgement.
/// </summary>
public static partial class InjectionDetector
{
    public static IReadOnlyList<string> Scan(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return [];
        }

        var hits = new List<string>();
        foreach (var (pattern, label) in Patterns)
        {
            if (pattern.IsMatch(text))
            {
                hits.Add(label);
            }
        }

        return hits;
    }

    private static readonly (Regex Pattern, string Label)[] Patterns =
    [
        (IgnoreInstructions(), "Asks to ignore previous instructions or rules"),
        (RoleMarker(), "Contains a fake system/assistant role marker"),
        (AddressedToAi(), "Addresses an AI, agent or model directly"),
        (ChangedPaymentDetails(), "Announces new or changed payment details"),
        (UrgencyPressure(), "Uses urgency or secrecy pressure"),
    ];

    [GeneratedRegex(@"\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(previous|prior|above|all|earlier|your|the)\b.{0,30}\b(instructions?|rules?|polic(y|ies)|limits?|prompts?)\b", RegexOptions.IgnoreCase | RegexOptions.Singleline, 200)]
    private static partial Regex IgnoreInstructions();

    [GeneratedRegex(@"(^|\n|\[|<)\s*(system|assistant|developer)\s*(:|\]|>)", RegexOptions.IgnoreCase, 200)]
    private static partial Regex RoleMarker();

    [GeneratedRegex(@"\b(dear|attention|note to|hey)\s+(ai|agent|assistant|model|llm|bot)\b|\b(as an?|you are an?)\s+(ai|agent|assistant|language model)\b", RegexOptions.IgnoreCase, 200)]
    private static partial Regex AddressedToAi();

    [GeneratedRegex(@"\b(new|updated|changed|different)\s+(bank|banking|payment|wallet|account|deposit)\s+(details|information|info|address|instructions)\b", RegexOptions.IgnoreCase, 200)]
    private static partial Regex ChangedPaymentDetails();

    [GeneratedRegex(@"\b(urgent(ly)?|immediately|right now|asap|do not (tell|inform|notify)|keep (this )?confidential|without (approval|review))\b", RegexOptions.IgnoreCase, 200)]
    private static partial Regex UrgencyPressure();
}
