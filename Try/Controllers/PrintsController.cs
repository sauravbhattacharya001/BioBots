using System;
using System.IO;
using System.Linq;
using System.Web.Http;
using System.Web.Script.Serialization;
using BioBots.Models;

namespace BioBots.Controllers
{
    public class PrintsController : ApiController
    {
        Print[] prints;
        public PrintsController() : base()
        {
            string path = @"C:\Users\onlin\OneDrive\Documents\Visual Studio 2015\Projects\BioBots\bioprint-data.json";
            string[] lines= File.ReadAllLines(path);
            string jsonInput = String.Concat(lines);

            JavaScriptSerializer jsonSerializer = new JavaScriptSerializer();
            jsonSerializer.MaxJsonLength = int.MaxValue;
            prints = jsonSerializer.Deserialize<Print[]>(jsonInput);
        }

        /// <summary>
        /// This function receives URI info and parses them to conditionally call
        /// the corresponding method to get results to display.
        /// </summary>
        /// <param name="arithmetic">Metrics</param>
        /// <param name="param">optional value parameter</param>
        /// <returns></returns>
        [Route("api/prints/serial/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromSerial(string arithmetic, string  param)
        {
            if (param == "Maximum")
            {
                return Ok(prints.Max((p) => p.user_info.serial));
            }
            if (param == "Minimum")
            {
                return Ok(prints.Min((p) => p.user_info.serial));
            }
            if (param == "Average")
            {
                return Ok(prints.Average((p) => p.user_info.serial));
            }

            if (arithmetic == "greater")
            {
                return Ok(prints.Count((p) => p.user_info.serial > Convert.ToInt32(param)));
            }

            if (arithmetic == "lesser")
            {
                return Ok(prints.Count((p) => p.user_info.serial < Convert.ToInt32(param)));
            }

            if (arithmetic == "equal")
            {
                return Ok(prints.Count((p) => p.user_info.serial == Convert.ToInt32(param)));
            }

            return NotFound();
        }

        /// <summary>
        /// This function receives URI info and parses them to conditionally call
        /// the corresponding method to get results to display.
        /// </summary>
        /// <param name="arithmetic">Metrics</param>
        /// <param name="param">optional value parameter</param>
        /// <returns></returns>
        [Route("api/prints/deadPercent/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromDeadPercent(string arithmetic, string param)
        {
            if (param == "Maximum")
            {
                return Ok(prints.Max((p) => p.print_data.deadPercent));
            }
            if (param == "Minimum")
            {
                return Ok(prints.Min((p) => p.print_data.deadPercent));
            }
            if (param == "Average")
            {
                return Ok(prints.Average((p) => p.print_data.deadPercent));
            }

            if (arithmetic == "greater")
            {
                return Ok(prints.Count((p) => p.print_data.deadPercent > Convert.ToInt32(param)));
            }

            if (arithmetic == "lesser")
            {
                return Ok(prints.Count((p) => p.print_data.deadPercent < Convert.ToInt32(param)));
            }

            if (arithmetic == "equal")
            {
                return Ok(prints.Count((p) => p.print_data.deadPercent == Convert.ToInt32(param)));
            }

            return NotFound();
        }

        /// <summary>
        /// This function receives URI info and parses them to conditionally call
        /// the corresponding method to get results to display.
        /// </summary>
        /// <param name="arithmetic">Metrics</param>
        /// <param name="param">optional value parameter</param>
        /// <returns></returns>
        [Route("api/prints/livePercent/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromLivePercent(string arithmetic, string param)
        {
            if (param == "Maximum")
            {
                return Ok(prints.Max((p) => p.print_data.livePercent));
            }
            if (param == "Minimum")
            {
                return Ok(prints.Min((p) => p.print_data.livePercent));
            }
            if (param == "Average")
            {
                return Ok(prints.Average((p) => p.print_data.livePercent));
            }

            if (arithmetic == "greater")
            {
                return Ok(prints.Count((p) => p.print_data.livePercent > Convert.ToDouble(param)));
            }

            if (arithmetic == "lesser")
            {
                return Ok(prints.Count((p) => p.print_data.livePercent < Convert.ToDouble(param)));
            }

            if (arithmetic == "equal")
            {
                return Ok(prints.Count((p) => p.print_data.livePercent == Convert.ToDouble(param)));
            }

            return NotFound();
        }

        /// <summary>
        /// This function receives URI info and parses them to conditionally call
        /// the corresponding method to get results to display.
        /// </summary>
        /// <param name="arithmetic">Metrics</param>
        /// <param name="param">optional value parameter</param>
        /// <returns></returns>
        [Route("api/prints/elasticity/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromElasticity(string arithmetic, string param)
        {
            if (param == "Maximum")
            {
                return Ok(prints.Max((p) => p.print_data.elasticity));
            }
            if (param == "Minimum")
            {
                return Ok(prints.Min((p) => p.print_data.elasticity));
            }
            if (param == "Average")
            {
                return Ok(prints.Average((p) => p.print_data.elasticity));
            }

            if (arithmetic == "greater")
            {
                return Ok(prints.Count((p) => p.print_data.elasticity > Convert.ToDouble(param)));
            }

            if (arithmetic == "lesser")
            {
                return Ok(prints.Count((p) => p.print_data.elasticity < Convert.ToDouble(param)));
            }

            if (arithmetic == "equal")
            {
                return Ok(prints.Count((p) => p.print_data.elasticity == Convert.ToDouble(param)));
            }

            return NotFound();
        }

        /// <summary>
        /// This function receives URI info and parses them to conditionally call
        /// the corresponding method to get results to display.
        /// </summary>
        /// <param name="arithmetic">Metrics</param>
        /// <param name="param">optional value parameter</param>
        /// <returns></returns>
        [Route("api/prints/cl_duration/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromCrosslinkingDuration(string arithmetic, string param)
        {
            if (param == "Maximum")
            {
                return Ok(prints.Max((p) => p.print_info.crosslinking.cl_duration));
            }
            if (param == "Minimum")
            {
                return Ok(prints.Min((p) => p.print_info.crosslinking.cl_duration));
            }
            if (param == "Average")
            {
                return Ok(prints.Average((p) => p.print_info.crosslinking.cl_duration));
            }

            if (arithmetic == "greater")
            {
                return Ok(prints.Count((p) => p.print_info.crosslinking.cl_duration > Convert.ToInt32(param)));
            }

            if (arithmetic == "lesser")
            {
                return Ok(prints.Count((p) => p.print_info.crosslinking.cl_duration < Convert.ToInt32(param)));
            }

            if (arithmetic == "equal")
            {
                return Ok(prints.Count((p) => p.print_info.crosslinking.cl_duration == Convert.ToInt32(param)));
            }

            return NotFound();
        }

        /// <summary>
        /// This function receives URI info and parses them to conditionally call
        /// the corresponding method to get results to display.
        /// </summary>
        /// <param name="arithmetic">Metrics</param>
        /// <param name="param">optional value parameter</param>
        /// <returns></returns>
        [Route("api/prints/cl_intensity/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromCrosslinkingIntensity(string arithmetic, string param)
        {
            if (param == "Maximum")
            {
                return Ok(prints.Max((p) => p.print_info.crosslinking.cl_intensity));
            }
            if (param == "Minimum")
            {
                return Ok(prints.Min((p) => p.print_info.crosslinking.cl_intensity));
            }
            if (param == "Average")
            {
                return Ok(prints.Average((p) => p.print_info.crosslinking.cl_intensity));
            }

            if (arithmetic == "greater")
            {
                return Ok(prints.Count((p) => p.print_info.crosslinking.cl_intensity > Convert.ToInt32(param)));
            }

            if (arithmetic == "lesser")
            {
                return Ok(prints.Count((p) => p.print_info.crosslinking.cl_intensity < Convert.ToInt32(param)));
            }

            if (arithmetic == "equal")
            {
                return Ok(prints.Count((p) => p.print_info.crosslinking.cl_intensity == Convert.ToInt32(param)));
            }

            return NotFound();
        }

        /// <summary>
        /// This function receives URI info and parses them to conditionally call
        /// the corresponding method to get results to display.
        /// </summary>
        /// <param name="arithmetic">Metrics</param>
        /// <param name="param">optional value parameter</param>
        /// <returns></returns>
        [Route("api/prints/extruder1/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromCrosslinkingExtruderOne(string arithmetic, string param)
        {
            if (param == "Maximum")
            {
                return Ok(prints.Max((p) => p.print_info.pressure.extruder1));
            }
            if (param == "Minimum")
            {
                return Ok(prints.Min((p) => p.print_info.pressure.extruder1));
            }
            if (param == "Average")
            {
                return Ok(prints.Average((p) => p.print_info.pressure.extruder1));
            }

            if (arithmetic == "greater")
            {
                return Ok(prints.Count((p) => p.print_info.pressure.extruder1 > Convert.ToDouble(param)));
            }

            if (arithmetic == "lesser")
            {
                return Ok(prints.Count((p) => p.print_info.pressure.extruder1 < Convert.ToDouble(param)));
            }

            if (arithmetic == "equal")
            {
                return Ok(prints.Count((p) => p.print_info.pressure.extruder1 == Convert.ToDouble(param)));
            }

            return NotFound();
        }

        /// <summary>
        /// This function receives URI info and parses them to conditionally call
        /// the corresponding method to get results to display.
        /// </summary>
        /// <param name="arithmetic">Metrics</param>
        /// <param name="param">optional value parameter</param>
        /// <returns></returns>
        [Route("api/prints/extruder2/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromPressureExtruderTwo(string arithmetic, string param)
        {
            if (param == "Maximum")
            {
                return Ok(prints.Max((p) => p.print_info.pressure.extruder2));
            }
            if (param == "Minimum")
            {
                return Ok(prints.Min((p) => p.print_info.pressure.extruder2));
            }
            if (param == "Average")
            {
                return Ok(prints.Average((p) => p.print_info.pressure.extruder2));
            }

            if (arithmetic == "greater")
            {
                return Ok(prints.Count((p) => p.print_info.pressure.extruder2 > Convert.ToDouble(param)));
            }

            if (arithmetic == "lesser")
            {
                return Ok(prints.Count((p) => p.print_info.pressure.extruder2 < Convert.ToDouble(param)));
            }

            if (arithmetic == "equal")
            {
                return Ok(prints.Count((p) => p.print_info.pressure.extruder2 == Convert.ToDouble(param)));
            }

            return NotFound();
        }

        /// <summary>
        /// This function receives URI info and parses them to conditionally call
        /// the corresponding method to get results to display.
        /// </summary>
        /// <param name="arithmetic">Metrics</param>
        /// <param name="param">optional value parameter</param>
        /// <returns></returns>
        [Route("api/prints/layerHeight/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromResolutionLayerHeight(string arithmetic, string param)
        {
            if (param == "Maximum")
            {
                return Ok(prints.Max((p) => p.print_info.resolution.layerHeight));
            }
            if (param == "Minimum")
            {
                return Ok(prints.Min((p) => p.print_info.resolution.layerHeight));
            }
            if (param == "Average")
            {
                return Ok(prints.Average((p) => p.print_info.resolution.layerHeight));
            }

            if (arithmetic == "greater")
            {
                return Ok(prints.Count((p) => p.print_info.resolution.layerHeight > Convert.ToDouble(param)));
            }

            if (arithmetic == "lesser")
            {
                return Ok(prints.Count((p) => p.print_info.resolution.layerHeight < Convert.ToDouble(param)));
            }

            if (arithmetic == "equal")
            {
                return Ok(prints.Count((p) => p.print_info.resolution.layerHeight == Convert.ToDouble(param)));
            }

            return NotFound();
        }

        /// <summary>
        /// This function receives URI info and parses them to conditionally call
        /// the corresponding method to get results to display.
        /// </summary>
        /// <param name="arithmetic">Metrics</param>
        /// <param name="param">optional value parameter</param>
        /// <returns></returns>
        [Route("api/prints/layerNum/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromResolutionLayerNum(string arithmetic, string param)
        {
            if (param == "Maximum")
            {
                return Ok(prints.Max((p) => p.print_info.resolution.layerNum));
            }
            if (param == "Minimum")
            {
                return Ok(prints.Min((p) => p.print_info.resolution.layerNum));
            }
            if (param == "Average")
            {
                return Ok(prints.Average((p) => p.print_info.resolution.layerNum));
            }

            if (arithmetic == "greater")
            {
                return Ok(prints.Count((p) => p.print_info.resolution.layerNum > Convert.ToInt32(param)));
            }

            if (arithmetic == "lesser")
            {
                return Ok(prints.Count((p) => p.print_info.resolution.layerNum < Convert.ToInt32(param)));
            }

            if (arithmetic == "equal")
            {
                return Ok(prints.Count((p) => p.print_info.resolution.layerNum == Convert.ToInt32(param)));
            }

            return NotFound();
        }

        /// <summary>
        /// This function receives URI info and parses them to conditionally call
        /// the corresponding method to get results to display.
        /// </summary>
        /// <param name="arithmetic">Metrics</param>
        /// <param name="param">optional value parameter</param>
        /// <returns></returns>
        [Route("api/prints/wellplate/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromWellplate(string arithmetic, string param)
        {
            if (arithmetic == "equal")
            {
                return Ok(prints.Count((p) => p.print_info.wellplate == Convert.ToInt32(param)));
            }

            return NotFound();
        }
    }
}