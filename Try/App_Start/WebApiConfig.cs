using System;
using System.Collections.Generic;
using System.Linq;
using System.Web.Http;
using BioBots.Filters;

namespace Try
{
    public static class WebApiConfig
    {
        public static void Register(HttpConfiguration config)
        {
            // Web API configuration and services

            // Register global exception filter so unhandled exceptions
            // return JSON error responses instead of HTML error pages
            config.Filters.Add(new GlobalExceptionFilter());

            // Web API routes
            config.MapHttpAttributeRoutes();
        }
    }
}
