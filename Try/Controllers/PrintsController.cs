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
        // Lock object to synchronize cache invalidation checks.
        private static readonly object _cacheLock = new object();

        // Cached print data and the file timestamp at the time of caching.
        // When the file's LastWriteTimeUtc changes, the cache is refreshed.
        // This replaces the old Lazy<T> approach so that edits to
        // bioprint-data.json are picked up without an app restart. (fixes #6)
        private static Print[] _cachedPrints;
        private static DateTime _cachedFileTimestamp = DateTime.MinValue;

        Print[] prints;

        public PrintsController() : base()
        {
            prints = GetPrints();
        }

        /// <summary>
        /// Returns the cached print data, reloading from disk only when the
        /// data file has been modified since the last read. The file's
        /// <see cref="File.GetLastWriteTimeUtc"/> is checked on every request
        /// (cheap metadata I/O), but the expensive JSON parse only happens
        /// when the timestamp differs. Thread-safe via double-checked locking.
        /// </summary>
        private static Print[] GetPrints()
        {
            string path = ConfigurationManager.AppSettings["DataFilePath"]
                ?? @"bioprint-data.json";

            // Guard: skip the timestamp fast-path when the file is missing so
            // LoadAndFilterPrints can throw a descriptive FileNotFoundException
            // instead of File.GetLastWriteTimeUtc returning DateTime.MinValue
            // or throwing a raw exception depending on the OS. (fixes #8)
            if (!File.Exists(path))
                return LoadAndFilterPrints(path);   // will throw with clear message

            DateTime lastWrite = File.GetLastWriteTimeUtc(path);

            // Fast path: timestamp unchanged, return cached data.
            if (_cachedPrints != null && lastWrite == _cachedFileTimestamp)
                return _cachedPrints;

            lock (_cacheLock)
            {
                // Re-check after acquiring the lock (double-checked locking).
                if (!File.Exists(path))
                    return LoadAndFilterPrints(path);

                lastWrite = File.GetLastWriteTimeUtc(path);
                if (_cachedPrints != null && lastWrite == _cachedFileTimestamp)
                    return _cachedPrints;

                Trace.TraceInformation(
                    "BioBots: Data file changed (was {0}, now {1}). Reloading...",
                    _cachedFileTimestamp, lastWrite);

                _cachedPrints = LoadAndFilterPrints(path);
                _cachedFileTimestamp = lastWrite;
                return _cachedPrints;
            }
        }

        /// <summary>
        /// Load print data from the JSON file, deserialize, and filter out
        /// records with missing required nested objects.
        /// </summary>
        private static Print[] LoadAndFilterPrints(string path)
        {
            if (!File.Exists(path))
            {
                throw new FileNotFoundException(
                    "Data file not found. Set 'DataFilePath' in appSettings or place bioprint-data.json in the application root.",
                    path);
            }

            // Use ReadAllText instead of ReadAllLines + Concat to avoid an
            // unnecessary intermediate string[] allocation.
            string jsonInput = File.ReadAllText(path);

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

            Trace.TraceInformation("BioBots: Loaded {0} valid print records (cached).", valid.Count);
            return valid.ToArray();
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
        /// Uses epsilon-based tolerance for equality to avoid IEEE 754 floating-point
        /// precision issues (e.g. 50.1 stored as 50.09999999999999). Fixes #7.
        /// Returns 404 if no valid records remain after null filtering.
        /// </summary>
        private const double Epsilon = 1e-9;

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
            if (arithmetic == "equal")   return Ok(prints.Count(p => Math.Abs(selector(p) - value) < Epsilon));

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
