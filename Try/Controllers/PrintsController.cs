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

    /// <summary>
    /// Describes a single queryable metric: its selector function and whether
    /// it should be treated as an integer (truncating aggregation results) or
    /// a double (using epsilon-based equality comparison).
    /// </summary>
    internal sealed class MetricDescriptor
    {
        public Func<Print, double> Selector { get; }
        public bool IsInteger { get; }

        public MetricDescriptor(Func<Print, double> selector, bool isInteger)
        {
            Selector = selector;
            IsInteger = isInteger;
        }
    }

    public class PrintsController : ApiController
    {
        // Lock object to synchronize cache invalidation checks.
        private static readonly object _cacheLock = new object();

        // Cached print data and the file timestamp at the time of caching.
        // When the file's LastWriteTimeUtc changes, the cache is refreshed.
        // This replaces the old Lazy<T> approach so that edits to
        // bioprint-data.json are picked up without an app restart. (fixes #6)
        // Volatile ensures cross-thread visibility without a full lock on the
        // fast path (double-checked locking pattern).
        private static volatile Print[] _cachedPrints;
        private static DateTime _cachedFileTimestamp = DateTime.MinValue;

        // Pre-computed aggregation stats for each metric, built at cache load time.
        // Key = metric name (matches route parameter), Value = pre-computed min/max/avg.
        private static Dictionary<string, MetricStats> _cachedStats;

        /// <summary>
        /// Registry of all queryable metrics. Maps the metric name (used in the
        /// URL route) to its selector and type. Adding a new metric is a one-line
        /// change here — no new endpoint method needed.
        /// </summary>
        private static readonly Dictionary<string, MetricDescriptor> MetricRegistry =
            new Dictionary<string, MetricDescriptor>
        {
            { "serial",       new MetricDescriptor(p => p.user_info.serial,                    isInteger: true)  },
            { "livePercent",  new MetricDescriptor(p => p.print_data.livePercent,              isInteger: false) },
            { "deadPercent",  new MetricDescriptor(p => p.print_data.deadPercent,              isInteger: false) },
            { "elasticity",   new MetricDescriptor(p => p.print_data.elasticity,               isInteger: false) },
            { "cl_duration",  new MetricDescriptor(p => p.print_info.crosslinking.cl_duration, isInteger: true)  },
            { "cl_intensity", new MetricDescriptor(p => p.print_info.crosslinking.cl_intensity,isInteger: true)  },
            { "extruder1",    new MetricDescriptor(p => p.print_info.pressure.extruder1,       isInteger: false) },
            { "extruder2",    new MetricDescriptor(p => p.print_info.pressure.extruder2,       isInteger: false) },
            { "layerHeight",  new MetricDescriptor(p => p.print_info.resolution.layerHeight,   isInteger: false) },
            { "layerNum",     new MetricDescriptor(p => p.print_info.resolution.layerNum,      isInteger: true)  },
            { "wellplate",    new MetricDescriptor(p => p.print_info.wellplate,                 isInteger: true)  },
        };

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

            // Guard against empty or malformed JSON files that deserialize to null
            if (allPrints == null || allPrints.Length == 0)
            {
                Trace.TraceWarning("BioBots: Data file '{0}' is empty or contains no valid JSON array.", path);
                return new Print[0];
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
        /// Pre-compute min/max/average for all queryable metrics in a single
        /// pass over the data. Uses the MetricRegistry as the single source of
        /// truth for selectors — no duplicate definitions needed.
        /// Runs once at cache load time, making all aggregation queries O(1).
        /// </summary>
        private static Dictionary<string, MetricStats> PrecomputeStats(Print[] prints)
        {
            if (prints.Length == 0)
                return new Dictionary<string, MetricStats>();

            // Initialize accumulators from the metric registry
            var mins = new Dictionary<string, double>();
            var maxs = new Dictionary<string, double>();
            var sums = new Dictionary<string, double>();
            foreach (var key in MetricRegistry.Keys)
            {
                mins[key] = double.MaxValue;
                maxs[key] = double.MinValue;
                sums[key] = 0;
            }

            // Single pass over all records — compute all metrics at once
            for (int i = 0; i < prints.Length; i++)
            {
                var p = prints[i];
                foreach (var kvp in MetricRegistry)
                {
                    double val = kvp.Value.Selector(p);
                    if (val < mins[kvp.Key]) mins[kvp.Key] = val;
                    if (val > maxs[kvp.Key]) maxs[kvp.Key] = val;
                    sums[kvp.Key] += val;
                }
            }

            var result = new Dictionary<string, MetricStats>();
            foreach (var key in MetricRegistry.Keys)
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
        /// Unified query method that handles both integer and double metrics via
        /// the MetricRegistry. Aggregation queries use pre-computed stats (O(1)).
        /// Comparison queries scan the array (O(n)). Integer metrics truncate
        /// aggregation results; double metrics use epsilon-based equality.
        /// Returns 404 if no valid records remain after null filtering.
        /// Returns 400 for unknown metrics or invalid operators/parameters.
        /// </summary>
        private static readonly HashSet<string> ValidArithmetic = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "greater", "lesser", "equal"
        };

        private const double Epsilon = 1e-9;

        private IHttpActionResult QueryMetric(string metricKey, string arithmetic, string param)
        {
            MetricDescriptor descriptor;
            if (!MetricRegistry.TryGetValue(metricKey, out descriptor))
                return BadRequest($"Unknown metric: '{metricKey}'. Valid metrics: {string.Join(", ", MetricRegistry.Keys)}.");

            if (prints.Length == 0)
                return NotFound();

            // O(1) aggregation from pre-computed stats
            MetricStats ms;
            if (stats.TryGetValue(metricKey, out ms))
            {
                if (param == "Maximum") return Ok(descriptor.IsInteger ? (object)(int)ms.Max : ms.Max);
                if (param == "Minimum") return Ok(descriptor.IsInteger ? (object)(int)ms.Min : ms.Min);
                if (param == "Average") return Ok(ms.Average);
            }

            // Validate arithmetic operator before attempting numeric parse
            if (!ValidArithmetic.Contains(arithmetic))
                return BadRequest($"Invalid comparison operator: '{arithmetic}'. Expected 'greater', 'lesser', or 'equal'.");

            double value;
            if (!double.TryParse(param, out value))
                return BadRequest($"Invalid numeric parameter: '{param}'. Expected a number.");

            var selector = descriptor.Selector;

            if (arithmetic == "greater") return Ok(prints.Count(p => selector(p) > value));
            if (arithmetic == "lesser")  return Ok(prints.Count(p => selector(p) < value));

            // Equality: integers use exact match, doubles use epsilon tolerance (fixes #7)
            if (arithmetic == "equal")
            {
                if (descriptor.IsInteger)
                    return Ok(prints.Count(p => (int)selector(p) == (int)value));
                else
                    return Ok(prints.Count(p => Math.Abs(selector(p) - value) < Epsilon));
            }

            return NotFound();
        }

        /// <summary>
        /// Single unified endpoint for all metric queries. The metric name is
        /// part of the route, validated against the MetricRegistry. This replaces
        /// 11 separate endpoint methods with identical signatures.
        /// 
        /// Examples:
        ///   GET api/prints/serial/greater/100
        ///   GET api/prints/livePercent/equal/Maximum
        ///   GET api/prints/elasticity/lesser/50.5
        /// </summary>
        [Route("api/prints/{metric}/{arithmetic}/{param}")]
        [HttpGet]
        public IHttpActionResult GetPrintMetric(string metric, string arithmetic, string param)
            => QueryMetric(metric, arithmetic, param);
    }
}
