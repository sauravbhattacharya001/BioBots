using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Web.Http.Filters;

namespace BioBots.Filters
{
    /// <summary>
    /// Global exception filter that catches unhandled exceptions and returns
    /// a consistent JSON error response instead of the default HTML error page.
    /// Internal exception details (stack traces, file paths) are logged
    /// server-side but never exposed to the client.
    /// </summary>
    public class GlobalExceptionFilter : ExceptionFilterAttribute
    {
        public override void OnException(HttpActionExecutedContext context)
        {
            var statusCode = HttpStatusCode.InternalServerError;
            string clientMessage;

            if (context.Exception is System.IO.FileNotFoundException)
            {
                statusCode = HttpStatusCode.NotFound;
                clientMessage = "The requested resource was not found.";
            }
            else if (context.Exception is System.ArgumentException)
            {
                statusCode = HttpStatusCode.BadRequest;
                clientMessage = "The request contained invalid parameters.";
            }
            else
            {
                clientMessage = "An internal server error occurred.";
            }

            // Log the full exception details server-side for debugging
            Trace.TraceError(
                "BioBots: Unhandled {0} in {1}: {2}",
                context.Exception.GetType().Name,
                context.ActionContext?.ActionDescriptor?.ActionName ?? "unknown",
                context.Exception.ToString());

            context.Response = context.Request.CreateErrorResponse(
                statusCode,
                clientMessage);
        }
    }
}
