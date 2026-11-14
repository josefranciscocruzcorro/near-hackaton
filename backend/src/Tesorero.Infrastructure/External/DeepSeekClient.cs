using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;
using Tesorero.Application.Abstractions;
using Tesorero.Application.Common;

namespace Tesorero.Infrastructure.External;

/// <summary>DeepSeek chat completions (OpenAI-compatible) in JSON mode.</summary>
public sealed class DeepSeekClient(HttpClient http, IOptions<AiOptions> options) : ILlmClient
{
    public async Task<LlmResponse> CompleteJsonAsync(LlmRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var key = options.Value.ApiKey;
        if (string.IsNullOrWhiteSpace(key))
        {
            throw new ExternalServiceException("AI", "No AI API key is configured (DEEPSEEK_API_KEY).");
        }

        using var message = new HttpRequestMessage(HttpMethod.Post, "chat/completions")
        {
            Content = JsonContent.Create(new ChatRequest(
                request.Model,
                [new ChatMessage("system", request.SystemPrompt), new ChatMessage("user", request.UserPrompt)],
                new ResponseFormat("json_object"),
                request.Temperature,
                8000)),
        };
        message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);

        HttpResponseMessage response;
        try
        {
            response = await http.SendAsync(message, cancellationToken);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            throw new ExternalServiceException("AI", "The AI provider did not respond in time.", ex);
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                throw new ExternalServiceException("AI", $"The AI provider answered {(int)response.StatusCode}.");
            }

            var body = await response.Content.ReadFromJsonAsync<ChatResponse>(cancellationToken)
                ?? throw new ExternalServiceException("AI", "Empty answer from the AI provider.");
            var content = body.Choices is [var first, ..] ? first.Message?.Content : null;
            if (string.IsNullOrWhiteSpace(content))
            {
                throw new ExternalServiceException("AI", "The AI provider returned no content.");
            }

            return new LlmResponse(content, body.Model ?? request.Model, body.Usage?.PromptTokens ?? 0, body.Usage?.CompletionTokens ?? 0);
        }
    }

    private sealed record ChatRequest(
        [property: JsonPropertyName("model")] string Model,
        [property: JsonPropertyName("messages")] IReadOnlyList<ChatMessage> Messages,
        [property: JsonPropertyName("response_format")] ResponseFormat ResponseFormat,
        [property: JsonPropertyName("temperature")] double Temperature,
        [property: JsonPropertyName("max_tokens")] int MaxTokens);

    private sealed record ChatMessage(
        [property: JsonPropertyName("role")] string Role,
        [property: JsonPropertyName("content")] string Content);

    private sealed record ResponseFormat([property: JsonPropertyName("type")] string Type);

    private sealed record ChatResponse(
        [property: JsonPropertyName("model")] string? Model,
        [property: JsonPropertyName("choices")] IReadOnlyList<Choice>? Choices,
        [property: JsonPropertyName("usage")] Usage? Usage);

    private sealed record Choice([property: JsonPropertyName("message")] ChoiceMessage? Message);

    private sealed record ChoiceMessage([property: JsonPropertyName("content")] string? Content);

    private sealed record Usage(
        [property: JsonPropertyName("prompt_tokens")] int PromptTokens,
        [property: JsonPropertyName("completion_tokens")] int CompletionTokens);
}

internal static class JsonDefaults
{
    public static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
}
