using System;
using System.Collections.Generic;
using System.Configuration;
using System.Diagnostics;
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
            var allPrints = jsonSerializer.Deserialize<Print[]>(jsonInput);

            // Filter out records with missing required nested objects to
            // prevent NullReferenceException in query selectors. (fixes #4)
            var valid = new List<Print>();
            for (int i = 0; i < allPrints.Length; i++)
            {
                var p = allPrints[i];
                if (p.user_info == null || p.print_info == null || p.print_data == null
                    || p.print_info.crosslinking == null || p.print_info.pressure == null
                    || p.print_info.resolution == null)
                {
                    Trace.TraceWarning(
                        "BioBots: Skipping record at index {0} — missing required nested object(s).", i);
                    continue;
                }
                valid.Add(p);
            }
            prints = valid.ToArray();
        }

        /// <summary>
        /// Generic query method for integer metrics.
        /// Handles Maximum, Minimum, Average aggregations and greater/lesser/equal comparisons.
        /// Returns 404 if no valid records remain after null filtering.
        /// </summary>
        private IHttpActionResult QueryIntMetric(string arithmetic, string param, Func<Print, int> selector)
        {
            if (prints.Length == 0)
                return NotFound();

            if (param == "Maximum") return Ok(prints.Max(selector));
            if (param == "Minimum") return Ok(prints.Min(selector));
            if (param == "Average") return Ok(prints.Average(selector));

            int value;
            if (!int.TryParse(param, out value))
                return BadRequest($"Invalid numeric parameter: '{param}'. Expected an integer.");

            if (arithmetic == "greater") return Ok(prints.Count(p => selector(p) > value));
            if (arithmetic == "lesser")  return Ok(prints.Count(p => selector(p) < value));
            if (arithmetic == "equal")   return Ok(prints.Count(p => selector(p) == value));

            return NotFound();
        }

        /// <summary>
        /// Generic query method for double metrics.
        /// Handles Maximum, Minimum, Average aggregations and greater/lesser/equal comparisons.
        /// Returns 404 if no valid records remain after null filtering.
        /// </summary>
        private IHttpActionResult QueryDoubleMetric(string arithmetic, string param, Func<Print, double> selector)
        {
            if (prints.Length == 0)
                return NotFound();

            if (param == "Maximum") return Ok(prints.Max(selector));
            if (param == "Minimum") return Ok(prints.Min(selector));
            if (param == "Average") return Ok(prints.Average(selector));

            double value;
            if (!double.TryParse(param, out value))
                return BadRequest($"Invalid numeric parameter: '{param}'. Expected a number.");

            if (arithmetic == "greater") return Ok(prints.Count(p => selector(p) > value));
            if (arithmetic == "lesser")  return Ok(prints.Count(p => selector(p) < value));
            if (arithmetic == "equal")   return Ok(prints.Count(p => selector(p) == value));

            return NotFound();
        }

        [Route("api/prints/serial/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromSerial(string arithmetic, string param)
            => QueryIntMetric(arithmetic, param, p => p.user_info.serial);

        [Route("api/prints/deadPercent/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromDeadPercent(string arithmetic, string param)
            => QueryDoubleMetric(arithmetic, param, p => p.print_data.deadPercent);

        [Route("api/prints/livePercent/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromLivePercent(string arithmetic, string param)
            => QueryDoubleMetric(arithmetic, param, p => p.print_data.livePercent);

        [Route("api/prints/elasticity/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromElasticity(string arithmetic, string param)
            => QueryDoubleMetric(arithmetic, param, p => p.print_data.elasticity);

        [Route("api/prints/cl_duration/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromCrosslinkingDuration(string arithmetic, string param)
            => QueryIntMetric(arithmetic, param, p => p.print_info.crosslinking.cl_duration);

        [Route("api/prints/cl_intensity/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromCrosslinkingIntensity(string arithmetic, string param)
            => QueryIntMetric(arithmetic, param, p => p.print_info.crosslinking.cl_intensity);

        [Route("api/prints/extruder1/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromCrosslinkingExtruderOne(string arithmetic, string param)
            => QueryDoubleMetric(arithmetic, param, p => p.print_info.pressure.extruder1);

        [Route("api/prints/extruder2/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromPressureExtruderTwo(string arithmetic, string param)
            => QueryDoubleMetric(arithmetic, param, p => p.print_info.pressure.extruder2);

        [Route("api/prints/layerHeight/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromResolutionLayerHeight(string arithmetic, string param)
            => QueryDoubleMetric(arithmetic, param, p => p.print_info.resolution.layerHeight);

        [Route("api/prints/layerNum/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromResolutionLayerNum(string arithmetic, string param)
            => QueryIntMetric(arithmetic, param, p => p.print_info.resolution.layerNum);

        [Route("api/prints/wellplate/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromWellplate(string arithmetic, string param)
            => QueryIntMetric(arithmetic, param, p => p.print_info.wellplate);
    }
}
