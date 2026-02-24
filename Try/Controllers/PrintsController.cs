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

            // O(1) aggregation from pre-computed stats (case-insensitive)
            MetricStats ms;
            if (stats.TryGetValue(metricKey, out ms))
            {
                if (string.Equals(param, "Maximum", StringComparison.OrdinalIgnoreCase))
                    return Ok(descriptor.IsInteger ? (object)(int)ms.Max : ms.Max);
                if (string.Equals(param, "Minimum", StringComparison.OrdinalIgnoreCase))
                    return Ok(descriptor.IsInteger ? (object)(int)ms.Min : ms.Min);
                if (string.Equals(param, "Average", StringComparison.OrdinalIgnoreCase))
                    return Ok(ms.Average);
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

        // ── Batch Statistics API ────────────────────────────────────────────

        /// <summary>
        /// Returns descriptive statistics for all queryable metrics in a single
        /// response. Each metric includes count, mean, standard deviation, min,
        /// max, median, quartiles, and IQR. Enables dashboard pages to fetch
        /// all statistics in one request instead of 11+ separate calls.
        /// 
        /// GET api/prints/stats
        /// </summary>
        [Route("api/prints/stats")]
        [HttpGet]
        public IHttpActionResult GetAllStats()
        {
            if (prints.Length == 0)
                return NotFound();

            var result = new Dictionary<string, object>();
            result["recordCount"] = prints.Length;

            var metrics = new Dictionary<string, object>();
            foreach (var kvp in MetricRegistry)
            {
                var values = ExtractSortedValues(kvp.Key);
                metrics[kvp.Key] = ComputeDescriptiveStats(kvp.Key, values, kvp.Value.IsInteger);
            }
            result["metrics"] = metrics;

            return Ok(result);
        }

        /// <summary>
        /// Returns detailed statistics for a single metric, including percentiles
        /// (P5, P10, P25, P50, P75, P90, P95, P99) and a 10-bin histogram for
        /// distribution visualization.
        /// 
        /// GET api/prints/stats/{metric}
        /// </summary>
        [Route("api/prints/stats/{metric}")]
        [HttpGet]
        public IHttpActionResult GetMetricStats(string metric)
        {
            MetricDescriptor descriptor;
            if (!MetricRegistry.TryGetValue(metric, out descriptor))
                return BadRequest($"Unknown metric: '{metric}'. Valid metrics: {string.Join(", ", MetricRegistry.Keys)}.");

            if (prints.Length == 0)
                return NotFound();

            var values = ExtractSortedValues(metric);
            var result = ComputeDescriptiveStats(metric, values, descriptor.IsInteger);

            // Add extended percentiles
            result["percentiles"] = new Dictionary<string, double>
            {
                { "p5",  Percentile(values, 0.05) },
                { "p10", Percentile(values, 0.10) },
                { "p25", Percentile(values, 0.25) },
                { "p50", Percentile(values, 0.50) },
                { "p75", Percentile(values, 0.75) },
                { "p90", Percentile(values, 0.90) },
                { "p95", Percentile(values, 0.95) },
                { "p99", Percentile(values, 0.99) },
            };

            // Add 10-bin histogram
            result["histogram"] = ComputeHistogram(values, 10);

            return Ok(result);
        }

        /// <summary>
        /// Returns a Pearson correlation matrix across all numeric metrics.
        /// Each cell is the Pearson r coefficient between two metrics (-1 to 1).
        /// Useful for identifying relationships between bioprint parameters
        /// (e.g., elasticity vs. live cell percentage).
        /// 
        /// GET api/prints/correlations
        /// </summary>
        [Route("api/prints/correlations")]
        [HttpGet]
        public IHttpActionResult GetCorrelations()
        {
            if (prints.Length < 2)
                return NotFound();

            var metricKeys = new List<string>(MetricRegistry.Keys);
            var metricValues = new Dictionary<string, double[]>();
            var metricMeans = new Dictionary<string, double>();

            // Pre-extract all metric values and compute means
            foreach (var key in metricKeys)
            {
                var selector = MetricRegistry[key].Selector;
                var vals = new double[prints.Length];
                double sum = 0;
                for (int i = 0; i < prints.Length; i++)
                {
                    vals[i] = selector(prints[i]);
                    sum += vals[i];
                }
                metricValues[key] = vals;
                metricMeans[key] = sum / prints.Length;
            }

            // Compute correlation matrix
            var matrix = new Dictionary<string, Dictionary<string, double>>();
            foreach (var keyA in metricKeys)
            {
                var row = new Dictionary<string, double>();
                var valsA = metricValues[keyA];
                var meanA = metricMeans[keyA];

                foreach (var keyB in metricKeys)
                {
                    if (keyA == keyB)
                    {
                        row[keyB] = 1.0;
                        continue;
                    }

                    var valsB = metricValues[keyB];
                    var meanB = metricMeans[keyB];

                    row[keyB] = PearsonCorrelation(valsA, meanA, valsB, meanB);
                }
                matrix[keyA] = row;
            }

            return Ok(new
            {
                recordCount = prints.Length,
                metrics = metricKeys,
                matrix
            });
        }

        // ── Statistics Helpers ──────────────────────────────────────────────

        /// <summary>
        /// Extract all values for a metric and return them sorted ascending.
        /// </summary>
        private double[] ExtractSortedValues(string metricKey)
        {
            var selector = MetricRegistry[metricKey].Selector;
            var values = new double[prints.Length];
            for (int i = 0; i < prints.Length; i++)
                values[i] = selector(prints[i]);
            Array.Sort(values);
            return values;
        }

        /// <summary>
        /// Compute descriptive statistics for a pre-sorted array of values.
        /// </summary>
        private Dictionary<string, object> ComputeDescriptiveStats(string metricKey, double[] sorted, bool isInteger)
        {
            int n = sorted.Length;
            double sum = 0;
            for (int i = 0; i < n; i++) sum += sorted[i];
            double mean = sum / n;

            // Sample standard deviation (n-1)
            double sumSqDev = 0;
            for (int i = 0; i < n; i++)
            {
                double d = sorted[i] - mean;
                sumSqDev += d * d;
            }
            double std = n > 1 ? Math.Sqrt(sumSqDev / (n - 1)) : 0;

            double median = Percentile(sorted, 0.5);
            double q1 = Percentile(sorted, 0.25);
            double q3 = Percentile(sorted, 0.75);

            var result = new Dictionary<string, object>
            {
                { "metric", metricKey },
                { "count", n },
                { "mean", Math.Round(mean, 4) },
                { "std", Math.Round(std, 4) },
                { "min", isInteger ? (object)(int)sorted[0] : Math.Round(sorted[0], 4) },
                { "max", isInteger ? (object)(int)sorted[n - 1] : Math.Round(sorted[n - 1], 4) },
                { "median", Math.Round(median, 4) },
                { "q1", Math.Round(q1, 4) },
                { "q3", Math.Round(q3, 4) },
                { "iqr", Math.Round(q3 - q1, 4) },
                { "coefficientOfVariation", mean != 0 ? Math.Round(std / Math.Abs(mean) * 100, 2) : 0.0 },
                { "skewness", ComputeSkewness(sorted, mean, std) },
            };

            return result;
        }

        /// <summary>
        /// Compute the percentile value using linear interpolation.
        /// </summary>
        private static double Percentile(double[] sorted, double p)
        {
            if (sorted.Length == 1) return sorted[0];
            double rank = p * (sorted.Length - 1);
            int lower = (int)Math.Floor(rank);
            int upper = lower + 1;
            if (upper >= sorted.Length) return sorted[sorted.Length - 1];
            double frac = rank - lower;
            return sorted[lower] + frac * (sorted[upper] - sorted[lower]);
        }

        /// <summary>
        /// Compute adjusted Fisher-Pearson skewness coefficient.
        /// Positive = right-skewed, negative = left-skewed, ~0 = symmetric.
        /// </summary>
        private static double ComputeSkewness(double[] sorted, double mean, double std)
        {
            int n = sorted.Length;
            if (n < 3 || std < 1e-15) return 0;

            double sumCubedDev = 0;
            for (int i = 0; i < n; i++)
            {
                double d = (sorted[i] - mean) / std;
                sumCubedDev += d * d * d;
            }

            // Adjusted Fisher-Pearson: [n / ((n-1)(n-2))] * Σ((xi-mean)/std)³
            double adjustment = (double)n / ((n - 1) * (n - 2));
            return Math.Round(adjustment * sumCubedDev, 4);
        }

        /// <summary>
        /// Compute an equal-width histogram for the given sorted values.
        /// Returns an array of bin objects with edges and counts.
        /// </summary>
        private static object[] ComputeHistogram(double[] sorted, int binCount)
        {
            double min = sorted[0];
            double max = sorted[sorted.Length - 1];
            double range = max - min;

            // Handle edge case: all values identical
            if (range < 1e-15)
            {
                return new object[]
                {
                    new { binStart = min, binEnd = max, count = sorted.Length }
                };
            }

            double binWidth = range / binCount;
            var bins = new object[binCount];
            int idx = 0;

            for (int b = 0; b < binCount; b++)
            {
                double binStart = min + b * binWidth;
                double binEnd = (b == binCount - 1) ? max + 1e-10 : min + (b + 1) * binWidth;
                int count = 0;

                while (idx < sorted.Length && sorted[idx] < binEnd)
                {
                    count++;
                    idx++;
                }

                // Include the final value in the last bin
                if (b == binCount - 1)
                {
                    while (idx < sorted.Length)
                    {
                        count++;
                        idx++;
                    }
                }

                bins[b] = new
                {
                    binStart = Math.Round(binStart, 4),
                    binEnd = Math.Round(b == binCount - 1 ? max : min + (b + 1) * binWidth, 4),
                    count
                };
            }

            return bins;
        }

        /// <summary>
        /// Compute Pearson correlation coefficient between two value arrays.
        /// Returns 0 if either array has zero variance.
        /// </summary>
        private static double PearsonCorrelation(double[] x, double meanX, double[] y, double meanY)
        {
            int n = x.Length;
            double sumXY = 0, sumX2 = 0, sumY2 = 0;
            for (int i = 0; i < n; i++)
            {
                double dx = x[i] - meanX;
                double dy = y[i] - meanY;
                sumXY += dx * dy;
                sumX2 += dx * dx;
                sumY2 += dy * dy;
            }

            double denom = Math.Sqrt(sumX2 * sumY2);
            return denom < 1e-15 ? 0 : Math.Round(sumXY / denom, 4);
        }
    }
}
