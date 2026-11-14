using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Tesorero.Application.Abstractions;
using Tesorero.Application.Common;

namespace Tesorero.Api.Infrastructure;

/// <summary>Maps application exceptions to RFC 7807 problem details.</summary>
public sealed partial class ProblemExceptionHandler(IProblemDetailsService problems, ILogger<ProblemExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(httpContext);
        ProblemDetails problem = exception switch
        {
            ValidationFailedException v => new ValidationProblemDetails(v.Errors) { Status = 400, Title = "Some fields need attention." },
            NotFoundException => new ProblemDetails { Status = 404, Title = "Not found", Detail = exception.Message },
            ConflictException => new ProblemDetails { Status = 409, Title = "Not allowed right now", Detail = exception.Message },
            ForbiddenException => new ProblemDetails { Status = 403, Title = "Not allowed", Detail = exception.Message },
            ExternalServiceException => new ProblemDetails { Status = 502, Title = "An external service failed", Detail = exception.Message },
            BadHttpRequestException => new ProblemDetails { Status = 400, Title = "Malformed request", Detail = "The request body could not be read." },
            _ => new ProblemDetails { Status = 500, Title = "Unexpected error", Detail = "Something went wrong. It has been logged." },
        };

        if (problem.Status >= 500)
        {
            LogUnhandled(logger, exception, httpContext.Request.Path);
        }

        httpContext.Response.StatusCode = problem.Status ?? 500;
        return await problems.TryWriteAsync(new ProblemDetailsContext { HttpContext = httpContext, ProblemDetails = problem, Exception = exception });
    }

    [LoggerMessage(Level = LogLevel.Error, Message = "Request {Path} failed")]
    private static partial void LogUnhandled(ILogger logger, Exception ex, PathString path);
}
