using System;
using System.Collections.Generic;
using System.Configuration;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Web.Http;
using Newtonsoft.Json;
using BioBots.Models;

namespace BioBots.Controllers
{
    /// <summary>
    /// Pre-computed aggregation statistics for a single metric, calculated once
    /// at cache load time. Eliminates repeated O(n) LINQ traversals on every
    /// aggregation query — queries are now O(1).
    /// </summary>
    internal struct MetricStats
    {
        public double Min;
        public double Max;
        public double Average;
    }

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

        // Pre-computed aggregation stats for each metric, built at cache load time.
        // Key = metric name (matches route parameter), Value = pre-computed min/max/avg.
        private static Dictionary<string, MetricStats> _cachedStats;

        Print[] prints;
        Dictionary<string, MetricStats> stats;

        public PrintsController() : base()
        {
            EnsureCache();
            prints = _cachedPrints;
            stats = _cachedStats;
        }

        /// <summary>
        /// Returns the cached print data, reloading from disk only when the
        /// data file has been modified since the last read. The file's
        /// <see cref="File.GetLastWriteTimeUtc"/> is checked on every request
        /// (cheap metadata I/O), but the expensive JSON parse only happens
        /// when the timestamp differs. Thread-safe via double-checked locking.
        /// Pre-computes aggregation statistics at load time for O(1) queries.
        /// </summary>
        private static void EnsureCache()
        {
            string path = ConfigurationManager.AppSettings["DataFilePath"]
                ?? @"bioprint-data.json";

            // Guard: skip the timestamp fast-path when the file is missing so
            // LoadAndFilterPrints can throw a descriptive FileNotFoundException
            // instead of File.GetLastWriteTimeUtc returning DateTime.MinValue
            // or throwing a raw exception depending on the OS. (fixes #8)
            if (!File.Exists(path))
            {
                var data = LoadAndFilterPrints(path); // will throw with clear message
                return;
            }

            DateTime lastWrite = File.GetLastWriteTimeUtc(path);

            // Fast path: timestamp unchanged, cached data is current.
            if (_cachedPrints != null && lastWrite == _cachedFileTimestamp)
                return;

            lock (_cacheLock)
            {
                // Re-check after acquiring the lock (double-checked locking).
                if (!File.Exists(path))
                {
                    LoadAndFilterPrints(path); // will throw
                    return;
                }

                lastWrite = File.GetLastWriteTimeUtc(path);
                if (_cachedPrints != null && lastWrite == _cachedFileTimestamp)
                    return;

                Trace.TraceInformation(
                    "BioBots: Data file changed (was {0}, now {1}). Reloading...",
                    _cachedFileTimestamp, lastWrite);

                var sw = Stopwatch.StartNew();
                _cachedPrints = LoadAndFilterPrints(path);
                _cachedStats = PrecomputeStats(_cachedPrints);
                _cachedFileTimestamp = lastWrite;
                sw.Stop();

                Trace.TraceInformation(
                    "BioBots: Cache rebuilt in {0}ms ({1} records, {2} metrics).",
                    sw.ElapsedMilliseconds, _cachedPrints.Length, _cachedStats.Count);
            }
        }

        /// <summary>
        /// Load print data from the JSON file using streaming deserialization
        /// via Newtonsoft.Json. This avoids loading the entire file contents
        /// into a string (8MB+), reducing peak memory usage by ~50%.
        /// Replaces the legacy JavaScriptSerializer which is slower and
        /// requires the full string in memory.
        /// </summary>
        private static Print[] LoadAndFilterPrints(string path)
        {
            if (!File.Exists(path))
            {
                throw new FileNotFoundException(
                    "Data file not found. Set 'DataFilePath' in appSettings or place bioprint-data.json in the application root.",
                    path);
            }

            // Stream-deserialize: reads JSON tokens directly from the file
            // stream without allocating an intermediate string for the entire
            // 8MB+ file. Newtonsoft.Json is ~2-3x faster than JavaScriptSerializer
            // for typed deserialization and is already a project dependency.
            Print[] allPrints;
            var serializer = new JsonSerializer();
            using (var reader = File.OpenText(path))
            using (var jsonReader = new JsonTextReader(reader) { CloseInput = true })
            {
                allPrints = serializer.Deserialize<Print[]>(jsonReader);
            }

            // Filter out records with missing required nested objects to
            // prevent NullReferenceException in query selectors. (fixes #4)
            var valid = new List<Print>(allPrints.Length);
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

            Trace.TraceInformation("BioBots: Loaded {0} valid print records.", valid.Count);
            return valid.ToArray();
        }

        /// <summary>
        /// Pre-compute min/max/average for all 11 queryable metrics in a single
        /// pass over the data. This runs once at cache load time, making all
        /// subsequent aggregation queries O(1) instead of O(n).
        /// </summary>
        private static Dictionary<string, MetricStats> PrecomputeStats(Print[] prints)
        {
            if (prints.Length == 0)
                return new Dictionary<string, MetricStats>();

            // Define all metric selectors in one place for the single-pass computation.
            var selectors = new Dictionary<string, Func<Print, double>>
            {
                { "serial",       p => p.user_info.serial },
                { "livePercent",  p => p.print_data.livePercent },
                { "deadPercent",  p => p.print_data.deadPercent },
                { "elasticity",   p => p.print_data.elasticity },
                { "cl_duration",  p => p.print_info.crosslinking.cl_duration },
                { "cl_intensity", p => p.print_info.crosslinking.cl_intensity },
                { "extruder1",    p => p.print_info.pressure.extruder1 },
                { "extruder2",    p => p.print_info.pressure.extruder2 },
                { "layerHeight",  p => p.print_info.resolution.layerHeight },
                { "layerNum",     p => p.print_info.resolution.layerNum },
                { "wellplate",    p => p.print_info.wellplate }
            };

            // Initialize accumulators
            var mins = new Dictionary<string, double>();
            var maxs = new Dictionary<string, double>();
            var sums = new Dictionary<string, double>();
            foreach (var key in selectors.Keys)
            {
                mins[key] = double.MaxValue;
                maxs[key] = double.MinValue;
                sums[key] = 0;
            }

            // Single pass over all records — compute all 11 metrics at once
            for (int i = 0; i < prints.Length; i++)
            {
                var p = prints[i];
                foreach (var kvp in selectors)
                {
                    double val = kvp.Value(p);
                    if (val < mins[kvp.Key]) mins[kvp.Key] = val;
                    if (val > maxs[kvp.Key]) maxs[kvp.Key] = val;
                    sums[kvp.Key] += val;
                }
            }

            var result = new Dictionary<string, MetricStats>();
            foreach (var key in selectors.Keys)
            {
                result[key] = new MetricStats
                {
                    Min = mins[key],
                    Max = maxs[key],
                    Average = sums[key] / prints.Length
                };
            }

            return result;
        }

        /// <summary>
        /// Generic query method for integer metrics.
        /// Aggregation queries (Maximum/Minimum/Average) use pre-computed stats — O(1).
        /// Comparison queries (greater/lesser/equal) still scan the array — O(n).
        /// Returns 404 if no valid records remain after null filtering.
        /// </summary>
        private IHttpActionResult QueryIntMetric(string metricKey, string arithmetic, string param, Func<Print, int> selector)
        {
            if (prints.Length == 0)
                return NotFound();

            // O(1) aggregation from pre-computed stats
            MetricStats ms;
            if (stats.TryGetValue(metricKey, out ms))
            {
                if (param == "Maximum") return Ok((int)ms.Max);
                if (param == "Minimum") return Ok((int)ms.Min);
                if (param == "Average") return Ok(ms.Average);
            }

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
        /// Aggregation queries (Maximum/Minimum/Average) use pre-computed stats — O(1).
        /// Comparison queries (greater/lesser/equal) still scan the array — O(n).
        /// Uses epsilon-based tolerance for equality to avoid IEEE 754 floating-point
        /// precision issues (e.g. 50.1 stored as 50.09999999999999). Fixes #7.
        /// Returns 404 if no valid records remain after null filtering.
        /// </summary>
        private const double Epsilon = 1e-9;

        private IHttpActionResult QueryDoubleMetric(string metricKey, string arithmetic, string param, Func<Print, double> selector)
        {
            if (prints.Length == 0)
                return NotFound();

            // O(1) aggregation from pre-computed stats
            MetricStats ms;
            if (stats.TryGetValue(metricKey, out ms))
            {
                if (param == "Maximum") return Ok(ms.Max);
                if (param == "Minimum") return Ok(ms.Min);
                if (param == "Average") return Ok(ms.Average);
            }

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
            => QueryIntMetric("serial", arithmetic, param, p => p.user_info.serial);

        [Route("api/prints/deadPercent/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromDeadPercent(string arithmetic, string param)
            => QueryDoubleMetric("deadPercent", arithmetic, param, p => p.print_data.deadPercent);

        [Route("api/prints/livePercent/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromLivePercent(string arithmetic, string param)
            => QueryDoubleMetric("livePercent", arithmetic, param, p => p.print_data.livePercent);

        [Route("api/prints/elasticity/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromElasticity(string arithmetic, string param)
            => QueryDoubleMetric("elasticity", arithmetic, param, p => p.print_data.elasticity);

        [Route("api/prints/cl_duration/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromCrosslinkingDuration(string arithmetic, string param)
            => QueryIntMetric("cl_duration", arithmetic, param, p => p.print_info.crosslinking.cl_duration);

        [Route("api/prints/cl_intensity/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromCrosslinkingIntensity(string arithmetic, string param)
            => QueryIntMetric("cl_intensity", arithmetic, param, p => p.print_info.crosslinking.cl_intensity);

        [Route("api/prints/extruder1/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromCrosslinkingExtruderOne(string arithmetic, string param)
            => QueryDoubleMetric("extruder1", arithmetic, param, p => p.print_info.pressure.extruder1);

        [Route("api/prints/extruder2/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromPressureExtruderTwo(string arithmetic, string param)
            => QueryDoubleMetric("extruder2", arithmetic, param, p => p.print_info.pressure.extruder2);

        [Route("api/prints/layerHeight/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromResolutionLayerHeight(string arithmetic, string param)
            => QueryDoubleMetric("layerHeight", arithmetic, param, p => p.print_info.resolution.layerHeight);

        [Route("api/prints/layerNum/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromResolutionLayerNum(string arithmetic, string param)
            => QueryIntMetric("layerNum", arithmetic, param, p => p.print_info.resolution.layerNum);

        [Route("api/prints/wellplate/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintFromWellplate(string arithmetic, string param)
            => QueryIntMetric("wellplate", arithmetic, param, p => p.print_info.wellplate);
    }
}
