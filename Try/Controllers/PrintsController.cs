using System;
using System.Configuration;
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
            string path = ConfigurationManager.AppSettings["DataFilePath"]
                ?? @"bioprint-data.json";
            if (!File.Exists(path))
            {
                throw new FileNotFoundException(
                    "Data file not found. Set 'DataFilePath' in appSettings or place bioprint-data.json in the application root.",
                    path);
            }
            string[] lines = File.ReadAllLines(path);
            string jsonInput = String.Concat(lines);

            JavaScriptSerializer jsonSerializer = new JavaScriptSerializer();
            jsonSerializer.MaxJsonLength = int.MaxValue;
            prints = jsonSerializer.Deserialize<Print[]>(jsonInput);
        }

        /// <summary>
        /// Attempts to parse a string as an integer. Returns a BadRequest result on failure.
        /// </summary>
        private bool TryParseInt(string value, out int result, out IHttpActionResult error)
        {
            error = null;
            if (int.TryParse(value, out result))
                return true;
            error = BadRequest($"Invalid numeric parameter: '{value}'. Expected an integer.");
            return false;
        }

        /// <summary>
        /// Attempts to parse a string as a double. Returns a BadRequest result on failure.
        /// </summary>
        private bool TryParseDouble(string value, out double result, out IHttpActionResult error)
        {
            error = null;
            if (double.TryParse(value, out result))
                return true;
            error = BadRequest($"Invalid numeric parameter: '{value}'. Expected a number.");
            return false;
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
        public IHttpActionResult GetPrintFromSerial(string arithmetic, string param)
        {
            if (param == "Maximum")
                return Ok(prints.Max((p) => p.user_info.serial));
            if (param == "Minimum")
                return Ok(prints.Min((p) => p.user_info.serial));
            if (param == "Average")
                return Ok(prints.Average((p) => p.user_info.serial));

            int value;
            IHttpActionResult error;
            if (!TryParseInt(param, out value, out error))
                return error;

            if (arithmetic == "greater")
                return Ok(prints.Count((p) => p.user_info.serial > value));
            if (arithmetic == "lesser")
                return Ok(prints.Count((p) => p.user_info.serial < value));
            if (arithmetic == "equal")
                return Ok(prints.Count((p) => p.user_info.serial == value));

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
                return Ok(prints.Max((p) => p.print_data.deadPercent));
            if (param == "Minimum")
                return Ok(prints.Min((p) => p.print_data.deadPercent));
            if (param == "Average")
                return Ok(prints.Average((p) => p.print_data.deadPercent));

            int value;
            IHttpActionResult error;
            if (!TryParseInt(param, out value, out error))
                return error;

            if (arithmetic == "greater")
                return Ok(prints.Count((p) => p.print_data.deadPercent > value));
            if (arithmetic == "lesser")
                return Ok(prints.Count((p) => p.print_data.deadPercent < value));
            if (arithmetic == "equal")
                return Ok(prints.Count((p) => p.print_data.deadPercent == value));

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
                return Ok(prints.Max((p) => p.print_data.livePercent));
            if (param == "Minimum")
                return Ok(prints.Min((p) => p.print_data.livePercent));
            if (param == "Average")
                return Ok(prints.Average((p) => p.print_data.livePercent));

            double value;
            IHttpActionResult error;
            if (!TryParseDouble(param, out value, out error))
                return error;

            if (arithmetic == "greater")
                return Ok(prints.Count((p) => p.print_data.livePercent > value));
            if (arithmetic == "lesser")
                return Ok(prints.Count((p) => p.print_data.livePercent < value));
            if (arithmetic == "equal")
                return Ok(prints.Count((p) => p.print_data.livePercent == value));

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
                return Ok(prints.Max((p) => p.print_data.elasticity));
            if (param == "Minimum")
                return Ok(prints.Min((p) => p.print_data.elasticity));
            if (param == "Average")
                return Ok(prints.Average((p) => p.print_data.elasticity));

            double value;
            IHttpActionResult error;
            if (!TryParseDouble(param, out value, out error))
                return error;

            if (arithmetic == "greater")
                return Ok(prints.Count((p) => p.print_data.elasticity > value));
            if (arithmetic == "lesser")
                return Ok(prints.Count((p) => p.print_data.elasticity < value));
            if (arithmetic == "equal")
                return Ok(prints.Count((p) => p.print_data.elasticity == value));

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
                return Ok(prints.Max((p) => p.print_info.crosslinking.cl_duration));
            if (param == "Minimum")
                return Ok(prints.Min((p) => p.print_info.crosslinking.cl_duration));
            if (param == "Average")
                return Ok(prints.Average((p) => p.print_info.crosslinking.cl_duration));

            int value;
            IHttpActionResult error;
            if (!TryParseInt(param, out value, out error))
                return error;

            if (arithmetic == "greater")
                return Ok(prints.Count((p) => p.print_info.crosslinking.cl_duration > value));
            if (arithmetic == "lesser")
                return Ok(prints.Count((p) => p.print_info.crosslinking.cl_duration < value));
            if (arithmetic == "equal")
                return Ok(prints.Count((p) => p.print_info.crosslinking.cl_duration == value));

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
                return Ok(prints.Max((p) => p.print_info.crosslinking.cl_intensity));
            if (param == "Minimum")
                return Ok(prints.Min((p) => p.print_info.crosslinking.cl_intensity));
            if (param == "Average")
                return Ok(prints.Average((p) => p.print_info.crosslinking.cl_intensity));

            int value;
            IHttpActionResult error;
            if (!TryParseInt(param, out value, out error))
                return error;

            if (arithmetic == "greater")
                return Ok(prints.Count((p) => p.print_info.crosslinking.cl_intensity > value));
            if (arithmetic == "lesser")
                return Ok(prints.Count((p) => p.print_info.crosslinking.cl_intensity < value));
            if (arithmetic == "equal")
                return Ok(prints.Count((p) => p.print_info.crosslinking.cl_intensity == value));

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
                return Ok(prints.Max((p) => p.print_info.pressure.extruder1));
            if (param == "Minimum")
                return Ok(prints.Min((p) => p.print_info.pressure.extruder1));
            if (param == "Average")
                return Ok(prints.Average((p) => p.print_info.pressure.extruder1));

            double value;
            IHttpActionResult error;
            if (!TryParseDouble(param, out value, out error))
                return error;

            if (arithmetic == "greater")
                return Ok(prints.Count((p) => p.print_info.pressure.extruder1 > value));
            if (arithmetic == "lesser")
                return Ok(prints.Count((p) => p.print_info.pressure.extruder1 < value));
            if (arithmetic == "equal")
                return Ok(prints.Count((p) => p.print_info.pressure.extruder1 == value));

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
                return Ok(prints.Max((p) => p.print_info.pressure.extruder2));
            if (param == "Minimum")
                return Ok(prints.Min((p) => p.print_info.pressure.extruder2));
            if (param == "Average")
                return Ok(prints.Average((p) => p.print_info.pressure.extruder2));

            double value;
            IHttpActionResult error;
            if (!TryParseDouble(param, out value, out error))
                return error;

            if (arithmetic == "greater")
                return Ok(prints.Count((p) => p.print_info.pressure.extruder2 > value));
            if (arithmetic == "lesser")
                return Ok(prints.Count((p) => p.print_info.pressure.extruder2 < value));
            if (arithmetic == "equal")
                return Ok(prints.Count((p) => p.print_info.pressure.extruder2 == value));

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
                return Ok(prints.Max((p) => p.print_info.resolution.layerHeight));
            if (param == "Minimum")
                return Ok(prints.Min((p) => p.print_info.resolution.layerHeight));
            if (param == "Average")
                return Ok(prints.Average((p) => p.print_info.resolution.layerHeight));

            double value;
            IHttpActionResult error;
            if (!TryParseDouble(param, out value, out error))
                return error;

            if (arithmetic == "greater")
                return Ok(prints.Count((p) => p.print_info.resolution.layerHeight > value));
            if (arithmetic == "lesser")
                return Ok(prints.Count((p) => p.print_info.resolution.layerHeight < value));
            if (arithmetic == "equal")
                return Ok(prints.Count((p) => p.print_info.resolution.layerHeight == value));

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
                return Ok(prints.Max((p) => p.print_info.resolution.layerNum));
            if (param == "Minimum")
                return Ok(prints.Min((p) => p.print_info.resolution.layerNum));
            if (param == "Average")
                return Ok(prints.Average((p) => p.print_info.resolution.layerNum));

            int value;
            IHttpActionResult error;
            if (!TryParseInt(param, out value, out error))
                return error;

            if (arithmetic == "greater")
                return Ok(prints.Count((p) => p.print_info.resolution.layerNum > value));
            if (arithmetic == "lesser")
                return Ok(prints.Count((p) => p.print_info.resolution.layerNum < value));
            if (arithmetic == "equal")
                return Ok(prints.Count((p) => p.print_info.resolution.layerNum == value));

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
                int value;
                IHttpActionResult error;
                if (!TryParseInt(param, out value, out error))
                    return error;
                return Ok(prints.Count((p) => p.print_info.wellplate == value));
            }

            return NotFound();
        }
    }
}
