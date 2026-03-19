using System.Web;
using System.Web.Http;

namespace Try
{
    public class WebApiApplication : System.Web.HttpApplication
    {
        protected void Application_Start()
        {
            GlobalConfiguration.Configure(WebApiConfig.Register);
        }

        /// <summary>
        /// Strip server fingerprinting headers from every response.
        /// Removes X-AspNet-Version, X-AspNetMvc-Version, and Server headers
        /// that reveal framework/version info to potential attackers.
        /// </summary>
        protected void Application_PreSendRequestHeaders()
        {
            if (HttpContext.Current != null)
            {
                HttpContext.Current.Response.Headers.Remove("X-AspNet-Version");
                HttpContext.Current.Response.Headers.Remove("X-AspNetMvc-Version");
                HttpContext.Current.Response.Headers.Remove("Server");
            }
        }
    }
}
