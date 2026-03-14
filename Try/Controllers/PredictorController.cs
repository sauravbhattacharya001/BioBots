using System;
using System.Collections.Generic;
using System.Configuration;
using System.IO;
using System.Linq;
using System.Web.Http;
using Newtonsoft.Json;
using BioBots.Models;

namespace BioBots.Controllers
{
    /// <summary>
    /// Print Outcome Predictor — predicts bioprint outcomes (livePercent, deadPercent,
    /// elasticity) based on K-Nearest Neighbors lookup against the historical dataset.
    /// Users provide planned print parameters and get predicted results plus confidence
    /// intervals based on the nearest matching prints.
    /// </summary>
    public class PredictorController : ApiController
    {
        /// <summary>
        /// Input parameters for prediction. All fields are optional — only provided
        /// fields are used in the distance calculation.
        /// </summary>
        public class PredictionRequest
        {
            public double? Extruder1 { get; set; }
            public double? Extruder2 { get; set; }
            public bool? ClEnabled { get; set; }
            public int? ClDuration { get; set; }
            public int? ClIntensity { get; set; }
            public int? LayerNum { get; set; }
            public double? LayerHeight { get; set; }
            public int? Wellplate { get; set; }
            public int? K { get; set; }
        }

        /// <summary>
        /// Predicted outcome with confidence intervals.
        /// </summary>
        public class PredictionResult
        {
            public PredictedOutcome Predicted { get; set; }
            public ConfidenceInterval Confidence { get; set; }
            public int NeighborsUsed { get; set; }
            public double AverageDistance { get; set; }
            public List<NeighborSummary> NearestNeighbors { get; set; }
        }

        public class PredictedOutcome
        {
            public double LivePercent { get; set; }
            public double DeadPercent { get; set; }
            public double Elasticity { get; set; }
        }

        public class ConfidenceInterval
        {
            public Range LivePercent { get; set; }
            public Range DeadPercent { get; set; }
            public Range Elasticity { get; set; }
        }

        public class Range
        {
            public double Low { get; set; }
            public double High { get; set; }
        }

        public class NeighborSummary
        {
            public double Distance { get; set; }
            public double LivePercent { get; set; }
            public double DeadPercent { get; set; }
            public double Elasticity { get; set; }
            public double Extruder1 { get; set; }
            public double Extruder2 { get; set; }
            public int LayerNum { get; set; }
            public double LayerHeight { get; set; }
        }

        private Print[] LoadPrints()
        {
            string path = ConfigurationManager.AppSettings["DataFilePath"]
                ?? @"bioprint-data.json";

            if (!File.Exists(path))
                return new Print[0];

            var serializer = new JsonSerializer();
            using (var reader = File.OpenText(path))
            using (var jsonReader = new JsonTextReader(reader) { CloseInput = true })
            {
                var allPrints = serializer.Deserialize<Print[]>(jsonReader);
                if (allPrints == null) return new Print[0];

                return allPrints.Where(p =>
                    p.user_info != null && p.print_info != null && p.print_data != null
                    && p.print_info.crosslinking != null && p.print_info.pressure != null
                    && p.print_info.resolution != null).ToArray();
            }
        }

        /// <summary>
        /// Compute ranges (min/max) for each parameter across the dataset,
        /// used for normalization in distance calculation.
        /// </summary>
        private Dictionary<string, double[]> ComputeRanges(Print[] prints)
        {
            var ranges = new Dictionary<string, double[]>();
            if (prints.Length == 0) return ranges;

            double ext1Min = double.MaxValue, ext1Max = double.MinValue;
            double ext2Min = double.MaxValue, ext2Max = double.MinValue;
            double durMin = double.MaxValue, durMax = double.MinValue;
            double intMin = double.MaxValue, intMax = double.MinValue;
            double lnMin = double.MaxValue, lnMax = double.MinValue;
            double lhMin = double.MaxValue, lhMax = double.MinValue;
            double wpMin = double.MaxValue, wpMax = double.MinValue;

            foreach (var p in prints)
            {
                void Update(ref double min, ref double max, double val) { if (val < min) min = val; if (val > max) max = val; }
                Update(ref ext1Min, ref ext1Max, p.print_info.pressure.extruder1);
                Update(ref ext2Min, ref ext2Max, p.print_info.pressure.extruder2);
                Update(ref durMin, ref durMax, p.print_info.crosslinking.cl_duration);
                Update(ref intMin, ref intMax, p.print_info.crosslinking.cl_intensity);
                Update(ref lnMin, ref lnMax, p.print_info.resolution.layerNum);
                Update(ref lhMin, ref lhMax, p.print_info.resolution.layerHeight);
                Update(ref wpMin, ref wpMax, p.print_info.wellplate);
            }

            ranges["extruder1"] = new[] { ext1Min, ext1Max };
            ranges["extruder2"] = new[] { ext2Min, ext2Max };
            ranges["cl_duration"] = new[] { durMin, durMax };
            ranges["cl_intensity"] = new[] { intMin, intMax };
            ranges["layerNum"] = new[] { lnMin, lnMax };
            ranges["layerHeight"] = new[] { lhMin, lhMax };
            ranges["wellplate"] = new[] { wpMin, wpMax };

            return ranges;
        }

        /// <summary>
        /// Compute normalized Euclidean distance between a query and a print record.
        /// Only dimensions with provided query values contribute to the distance.
        /// </summary>
        private double ComputeDistance(PredictionRequest query, Print print, Dictionary<string, double[]> ranges)
        {
            double sumSq = 0;
            int dims = 0;

            void AddDim(double queryVal, double printVal, string key)
            {
                var r = ranges[key];
                double span = r[1] - r[0];
                if (span < 1e-15) return; // skip zero-variance dimensions
                double norm = (queryVal - printVal) / span;
                sumSq += norm * norm;
                dims++;
            }

            if (query.Extruder1.HasValue)
                AddDim(query.Extruder1.Value, print.print_info.pressure.extruder1, "extruder1");
            if (query.Extruder2.HasValue)
                AddDim(query.Extruder2.Value, print.print_info.pressure.extruder2, "extruder2");
            if (query.ClDuration.HasValue)
                AddDim(query.ClDuration.Value, print.print_info.crosslinking.cl_duration, "cl_duration");
            if (query.ClIntensity.HasValue)
                AddDim(query.ClIntensity.Value, print.print_info.crosslinking.cl_intensity, "cl_intensity");
            if (query.LayerNum.HasValue)
                AddDim(query.LayerNum.Value, print.print_info.resolution.layerNum, "layerNum");
            if (query.LayerHeight.HasValue)
                AddDim(query.LayerHeight.Value, print.print_info.resolution.layerHeight, "layerHeight");
            if (query.Wellplate.HasValue)
                AddDim(query.Wellplate.Value, print.print_info.wellplate, "wellplate");

            // Handle crosslinking enabled filter: if specified, add penalty for mismatch
            if (query.ClEnabled.HasValue)
            {
                bool printCl = print.print_info.crosslinking.cl_enabled;
                if (query.ClEnabled.Value != printCl)
                {
                    sumSq += 1.0; // maximum normalized distance for boolean mismatch
                    dims++;
                }
            }

            return dims > 0 ? Math.Sqrt(sumSq / dims) : 0;
        }

        /// <summary>
        /// POST api/predictor/predict
        /// 
        /// Predicts bioprint outcomes based on K-Nearest Neighbors.
        /// Accepts print parameters and returns predicted livePercent,
        /// deadPercent, and elasticity with confidence intervals.
        /// 
        /// K defaults to 5 (adjustable 1-50). Distance-weighted averaging
        /// gives closer neighbors more influence on predictions.
        /// </summary>
        [Route("api/predictor/predict")]
        [HttpPost]
        public IHttpActionResult Predict([FromBody] PredictionRequest request)
        {
            if (request == null)
                return BadRequest("Request body is required. Provide at least one print parameter.");

            // Check that at least one parameter is provided
            bool hasParam = request.Extruder1.HasValue || request.Extruder2.HasValue
                || request.ClEnabled.HasValue || request.ClDuration.HasValue
                || request.ClIntensity.HasValue || request.LayerNum.HasValue
                || request.LayerHeight.HasValue || request.Wellplate.HasValue;

            if (!hasParam)
                return BadRequest("Provide at least one print parameter (extruder1, extruder2, clEnabled, clDuration, clIntensity, layerNum, layerHeight, wellplate).");

            int k = request.K ?? 5;
            if (k < 1 || k > 50)
                return BadRequest("K must be between 1 and 50.");

            var prints = LoadPrints();
            if (prints.Length == 0)
                return NotFound();

            k = Math.Min(k, prints.Length);
            var ranges = ComputeRanges(prints);

            // Compute distances for all prints
            var distances = new List<Tuple<double, Print>>(prints.Length);
            foreach (var p in prints)
            {
                double dist = ComputeDistance(request, p, ranges);
                distances.Add(Tuple.Create(dist, p));
            }

            // Sort by distance and take K nearest
            distances.Sort((a, b) => a.Item1.CompareTo(b.Item1));
            var neighbors = distances.Take(k).ToList();

            // Distance-weighted average (inverse distance weighting)
            // If distance is 0, that neighbor gets weight = 1, others get 1/distance
            double totalWeight = 0;
            double wLive = 0, wDead = 0, wElasticity = 0;
            var neighborSummaries = new List<NeighborSummary>();

            foreach (var n in neighbors)
            {
                double weight = n.Item1 < 1e-10 ? 1000.0 : 1.0 / n.Item1;
                totalWeight += weight;
                wLive += weight * n.Item2.print_data.livePercent;
                wDead += weight * n.Item2.print_data.deadPercent;
                wElasticity += weight * n.Item2.print_data.elasticity;

                neighborSummaries.Add(new NeighborSummary
                {
                    Distance = Math.Round(n.Item1, 6),
                    LivePercent = n.Item2.print_data.livePercent,
                    DeadPercent = n.Item2.print_data.deadPercent,
                    Elasticity = n.Item2.print_data.elasticity,
                    Extruder1 = n.Item2.print_info.pressure.extruder1,
                    Extruder2 = n.Item2.print_info.pressure.extruder2,
                    LayerNum = n.Item2.print_info.resolution.layerNum,
                    LayerHeight = n.Item2.print_info.resolution.layerHeight
                });
            }

            // Compute confidence intervals (min/max of neighbors)
            var livePcts = neighbors.Select(n => n.Item2.print_data.livePercent).ToList();
            var deadPcts = neighbors.Select(n => n.Item2.print_data.deadPercent).ToList();
            var elasticities = neighbors.Select(n => n.Item2.print_data.elasticity).ToList();

            var result = new PredictionResult
            {
                Predicted = new PredictedOutcome
                {
                    LivePercent = Math.Round(wLive / totalWeight, 2),
                    DeadPercent = Math.Round(wDead / totalWeight, 2),
                    Elasticity = Math.Round(wElasticity / totalWeight, 2)
                },
                Confidence = new ConfidenceInterval
                {
                    LivePercent = new Range { Low = Math.Round(livePcts.Min(), 2), High = Math.Round(livePcts.Max(), 2) },
                    DeadPercent = new Range { Low = Math.Round(deadPcts.Min(), 2), High = Math.Round(deadPcts.Max(), 2) },
                    Elasticity = new Range { Low = Math.Round(elasticities.Min(), 2), High = Math.Round(elasticities.Max(), 2) }
                },
                NeighborsUsed = k,
                AverageDistance = Math.Round(neighbors.Average(n => n.Item1), 6),
                NearestNeighbors = neighborSummaries
            };

            return Ok(result);
        }

        /// <summary>
        /// GET api/predictor/ranges
        /// 
        /// Returns the min/max ranges for all input parameters.
        /// Used by the UI to set slider bounds and validate inputs.
        /// </summary>
        [Route("api/predictor/ranges")]
        [HttpGet]
        public IHttpActionResult GetRanges()
        {
            var prints = LoadPrints();
            if (prints.Length == 0)
                return NotFound();

            var ranges = ComputeRanges(prints);
            var result = new Dictionary<string, object>();
            result["recordCount"] = prints.Length;

            foreach (var kvp in ranges)
            {
                result[kvp.Key] = new { min = Math.Round(kvp.Value[0], 4), max = Math.Round(kvp.Value[1], 4) };
            }

            return Ok(result);
        }
    }
}
