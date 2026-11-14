namespace Tesorero.Application.Common;

public sealed class NotFoundException(string entity, object id)
    : Exception($"{entity} '{id}' was not found.");

/// <summary>Input failed validation. Maps to HTTP 400 with per-field errors.</summary>
public sealed class ValidationFailedException(IDictionary<string, string[]> errors)
    : Exception("One or more fields are invalid.")
{
    public IDictionary<string, string[]> Errors { get; } = errors;

    public static ValidationFailedException For(string field, string message) =>
        new(new Dictionary<string, string[]> { [field] = [message] });
}

/// <summary>The request is valid but conflicts with the current state. Maps to HTTP 409.</summary>
public sealed class ConflictException(string message) : Exception(message);

/// <summary>The caller is not allowed to do this, independently of their role. Maps to HTTP 403.</summary>
public sealed class ForbiddenException(string message) : Exception(message);

/// <summary>Small fluent validator to keep services readable.</summary>
public sealed class Validator
{
    private readonly Dictionary<string, List<string>> _errors = [];

    public Validator Require(bool condition, string field, string message)
    {
        if (!condition)
        {
            if (!_errors.TryGetValue(field, out var list))
            {
                list = [];
                _errors[field] = list;
            }

            list.Add(message);
        }

        return this;
    }

    public void ThrowIfInvalid()
    {
        if (_errors.Count > 0)
        {
            throw new ValidationFailedException(_errors.ToDictionary(e => e.Key, e => e.Value.ToArray()));
        }
    }
}
