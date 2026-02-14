using System.Net;
using System.Net.Http;
using System.Web.Http.Filters;

namespace BioBots.Filters
{
    /// <summary>
    /// Global exception filter that catches unhandled exceptions and returns
    /// a consistent JSON error response instead of the default HTML error page.
    /// </summary>
    public class GlobalExceptionFilter : ExceptionFilterAttribute
    {
        public override void OnException(HttpActionExecutedContext context)
        {
            var statusCode = HttpStatusCode.InternalServerError;

            if (context.Exception is System.IO.FileNotFoundException)
                statusCode = HttpStatusCode.NotFound;
            else if (context.Exception is System.ArgumentException)
                statusCode = HttpStatusCode.BadRequest;

            context.Response = context.Request.CreateErrorResponse(
                statusCode,
                context.Exception.Message);
        }
    }
}
