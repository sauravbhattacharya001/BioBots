using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Web.Http;
using BioBots.Models;

namespace BioBots.Controllers
{
    /// <summary>
    /// LIMS-lite sample tracking for bioprinting workflows.
    /// Tracks biological samples from creation through storage, processing,
    /// quality control, and disposal with a full audit trail.
    ///
    /// Routes:
    ///   GET    api/samples              — list all samples (optional ?status=X&amp;type=Y&amp;expired=true)
    ///   GET    api/samples/{id}         — get sample by ID
    ///   POST   api/samples              — create a new sample
    ///   PUT    api/samples/{id}         — update sample fields
    ///   POST   api/samples/{id}/transition — transition sample status
    ///   GET    api/samples/{id}/events  — get audit trail
    ///   GET    api/samples/stats        — summary statistics
    ///   DELETE api/samples/{id}         — remove sample record
    /// </summary>
    [RoutePrefix("api/samples")]
    public class SampleTrackingController : ApiController
    {
        /// <summary>Maximum number of samples that can be tracked in-memory.
        /// Prevents unbounded growth from automated/malicious callers.</summary>
        private const int MaxSamples = 10000;

        /// <summary>Maximum string length for free-text fields (Label, Notes,
        /// StorageLocation, etc.) to prevent memory abuse.</summary>
        private const int MaxFieldLength = 2000;

        /// <summary>Maximum length for short identifier fields (OperatorEmail,
        /// Quantity, SampleType).</summary>
        private const int MaxShortFieldLength = 200;

        private static readonly ConcurrentDictionary<string, Sample> _samples
            = new ConcurrentDictionary<string, Sample>(StringComparer.OrdinalIgnoreCase);

        private static readonly HashSet<string> ValidStatuses = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "Created", "Stored", "InProcess", "Printed", "QCPassed", "QCFailed", "Disposed"
        };

        private static readonly HashSet<string> ValidTypes = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "Bioink", "Tissue", "Scaffold", "CellSuspension", "Hydrogel", "Other"
        };

        // Valid status transitions (from → allowed destinations)
        private static readonly Dictionary<string, HashSet<string>> Transitions =
            new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase)
            {
                { "Created",    new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Stored", "InProcess", "Disposed" } },
                { "Stored",     new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "InProcess", "Disposed" } },
                { "InProcess",  new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Printed", "Stored", "Disposed" } },
                { "Printed",    new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "QCPassed", "QCFailed", "Disposed" } },
                { "QCPassed",   new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Stored", "Disposed" } },
                { "QCFailed",   new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "InProcess", "Disposed" } },
                { "Disposed",   new HashSet<string>(StringComparer.OrdinalIgnoreCase) },
            };

        private static int _counter = 0;

        /// <summary>
        /// Truncate a string to a maximum length, returning null if the input
        /// is null or whitespace-only.
        /// </summary>
        private static string ClampString(string value, int maxLen)
        {
            if (string.IsNullOrWhiteSpace(value)) return null;
            value = value.Trim();
            return value.Length > maxLen ? value.Substring(0, maxLen) : value;
        }

        /// <summary>
        /// Validate that free-text input fields are within length limits.
        /// Returns an error message if validation fails, or null if OK.
        /// </summary>
        private static string ValidateInputLengths(Sample sample)
        {
            if (sample.Label != null && sample.Label.Length > MaxFieldLength)
                return $"Label must be at most {MaxFieldLength} characters.";
            if (sample.Notes != null && sample.Notes.Length > MaxFieldLength)
                return $"Notes must be at most {MaxFieldLength} characters.";
            if (sample.StorageLocation != null && sample.StorageLocation.Length > MaxFieldLength)
                return $"StorageLocation must be at most {MaxFieldLength} characters.";
            if (sample.OperatorEmail != null && sample.OperatorEmail.Length > MaxShortFieldLength)
                return $"OperatorEmail must be at most {MaxShortFieldLength} characters.";
            if (sample.Quantity != null && sample.Quantity.Length > MaxShortFieldLength)
                return $"Quantity must be at most {MaxShortFieldLength} characters.";
            if (sample.SampleType != null && sample.SampleType.Length > MaxShortFieldLength)
                return $"SampleType must be at most {MaxShortFieldLength} characters.";
            return null;
        }

        private static string GenerateId()
        {
            var seq = System.Threading.Interlocked.Increment(ref _counter);
            return $"SPL-{DateTime.UtcNow:yyyyMMdd}-{seq:D4}";
        }

        /// <summary>
        /// GET api/samples?status=X&amp;type=Y&amp;expired=true
        /// Lists all samples with optional filters.
        /// </summary>
        [Route("")]
        [HttpGet]
        public IHttpActionResult GetAll(string status = null, string type = null, bool expired = false)
        {
            var query = _samples.Values.AsEnumerable();

            if (!string.IsNullOrEmpty(status))
                query = query.Where(s => s.Status.Equals(status, StringComparison.OrdinalIgnoreCase));
            if (!string.IsNullOrEmpty(type))
                query = query.Where(s => s.SampleType.Equals(type, StringComparison.OrdinalIgnoreCase));
            if (expired)
                query = query.Where(s => s.ExpiresAt.HasValue && s.ExpiresAt.Value < DateTime.UtcNow);

            return Ok(query.OrderByDescending(s => s.UpdatedAt).ToList());
        }

        /// <summary>
        /// GET api/samples/stats — summary statistics across all tracked samples.
        /// </summary>
        [Route("stats")]
        [HttpGet]
        public IHttpActionResult GetStats()
        {
            var all = _samples.Values.ToList();
            var stats = new
            {
                Total = all.Count,
                ByStatus = all.GroupBy(s => s.Status, StringComparer.OrdinalIgnoreCase)
                              .ToDictionary(g => g.Key, g => g.Count()),
                ByType = all.GroupBy(s => s.SampleType, StringComparer.OrdinalIgnoreCase)
                            .ToDictionary(g => g.Key, g => g.Count()),
                ExpiredCount = all.Count(s => s.ExpiresAt.HasValue && s.ExpiresAt.Value < DateTime.UtcNow),
                AverageViability = all.Where(s => s.ViabilityPercent.HasValue)
                                     .Select(s => s.ViabilityPercent.Value)
                                     .DefaultIfEmpty(0)
                                     .Average()
            };
            return Ok(stats);
        }

        /// <summary>
        /// GET api/samples/{id}
        /// </summary>
        [Route("{id}")]
        [HttpGet]
        public IHttpActionResult Get(string id)
        {
            Sample sample;
            if (!_samples.TryGetValue(id, out sample))
                return NotFound();
            return Ok(sample);
        }

        /// <summary>
        /// POST api/samples — create a new sample.
        /// Required: Label, SampleType. Optional: everything else.
        /// </summary>
        [Route("")]
        [HttpPost]
        public IHttpActionResult Create([FromBody] Sample sample)
        {
            if (sample == null || string.IsNullOrWhiteSpace(sample.Label))
                return BadRequest("Label is required.");

            if (string.IsNullOrWhiteSpace(sample.SampleType) || !ValidTypes.Contains(sample.SampleType))
                return BadRequest($"SampleType must be one of: {string.Join(", ", ValidTypes)}");

            // Enforce input field length limits
            var lengthError = ValidateInputLengths(sample);
            if (lengthError != null)
                return BadRequest(lengthError);

            // Enforce maximum sample capacity to prevent memory exhaustion
            if (_samples.Count >= MaxSamples)
                return Content(System.Net.HttpStatusCode.ServiceUnavailable,
                    new { Error = $"Sample limit ({MaxSamples}) reached. Dispose old samples before creating new ones." });

            sample.SampleId = GenerateId();
            sample.Status = "Created";
            sample.CreatedAt = DateTime.UtcNow;
            sample.UpdatedAt = DateTime.UtcNow;
            sample.Events = new List<SampleEvent>
            {
                new SampleEvent
                {
                    Timestamp = DateTime.UtcNow,
                    FromStatus = null,
                    ToStatus = "Created",
                    PerformedBy = sample.OperatorEmail ?? "system",
                    Comment = "Sample registered"
                }
            };

            _samples[sample.SampleId] = sample;
            return Created($"api/samples/{sample.SampleId}", sample);
        }

        /// <summary>
        /// PUT api/samples/{id} — update mutable fields (not status; use /transition).
        /// </summary>
        [Route("{id}")]
        [HttpPut]
        public IHttpActionResult Update(string id, [FromBody] Sample updates)
        {
            Sample sample;
            if (!_samples.TryGetValue(id, out sample))
                return NotFound();

            if (updates == null)
                return BadRequest("Request body required.");

            // Enforce input field length limits on updates
            var lengthError = ValidateInputLengths(updates);
            if (lengthError != null)
                return BadRequest(lengthError);

            if (!string.IsNullOrWhiteSpace(updates.Label))
                sample.Label = updates.Label;
            if (!string.IsNullOrWhiteSpace(updates.StorageLocation))
                sample.StorageLocation = updates.StorageLocation;
            if (updates.StorageTemperatureC.HasValue)
                sample.StorageTemperatureC = updates.StorageTemperatureC;
            if (!string.IsNullOrWhiteSpace(updates.Quantity))
                sample.Quantity = updates.Quantity;
            if (updates.PassageNumber.HasValue)
                sample.PassageNumber = updates.PassageNumber;
            if (updates.ViabilityPercent.HasValue)
                sample.ViabilityPercent = updates.ViabilityPercent;
            if (updates.PrinterSerial.HasValue)
                sample.PrinterSerial = updates.PrinterSerial;
            if (!string.IsNullOrWhiteSpace(updates.OperatorEmail))
                sample.OperatorEmail = updates.OperatorEmail;
            if (updates.ExpiresAt.HasValue)
                sample.ExpiresAt = updates.ExpiresAt;
            if (!string.IsNullOrWhiteSpace(updates.Notes))
                sample.Notes = updates.Notes;

            sample.UpdatedAt = DateTime.UtcNow;
            return Ok(sample);
        }

        /// <summary>
        /// POST api/samples/{id}/transition — move sample to a new status.
        /// Body: { "ToStatus": "Stored", "PerformedBy": "user@lab.com", "Comment": "Moved to freezer" }
        /// </summary>
        [Route("{id}/transition")]
        [HttpPost]
        public IHttpActionResult Transition(string id, [FromBody] SampleEvent transition)
        {
            Sample sample;
            if (!_samples.TryGetValue(id, out sample))
                return NotFound();

            if (transition == null || string.IsNullOrWhiteSpace(transition.ToStatus))
                return BadRequest("ToStatus is required.");

            // Enforce length limits on transition metadata
            if (transition.PerformedBy != null && transition.PerformedBy.Length > MaxShortFieldLength)
                return BadRequest($"PerformedBy must be at most {MaxShortFieldLength} characters.");
            if (transition.Comment != null && transition.Comment.Length > MaxFieldLength)
                return BadRequest($"Comment must be at most {MaxFieldLength} characters.");

            if (!ValidStatuses.Contains(transition.ToStatus))
                return BadRequest($"Invalid status. Must be one of: {string.Join(", ", ValidStatuses)}");

            HashSet<string> allowed;
            if (!Transitions.TryGetValue(sample.Status, out allowed) || !allowed.Contains(transition.ToStatus))
                return BadRequest($"Cannot transition from '{sample.Status}' to '{transition.ToStatus}'.");

            var evt = new SampleEvent
            {
                Timestamp = DateTime.UtcNow,
                FromStatus = sample.Status,
                ToStatus = transition.ToStatus,
                PerformedBy = transition.PerformedBy ?? "system",
                Comment = transition.Comment
            };

            sample.Status = transition.ToStatus;
            sample.UpdatedAt = DateTime.UtcNow;
            sample.Events.Add(evt);

            return Ok(sample);
        }

        /// <summary>
        /// GET api/samples/{id}/events — full audit trail for a sample.
        /// </summary>
        [Route("{id}/events")]
        [HttpGet]
        public IHttpActionResult GetEvents(string id)
        {
            Sample sample;
            if (!_samples.TryGetValue(id, out sample))
                return NotFound();
            return Ok(sample.Events);
        }

        /// <summary>
        /// DELETE api/samples/{id} — remove a sample record entirely.
        /// </summary>
        [Route("{id}")]
        [HttpDelete]
        public IHttpActionResult Delete(string id)
        {
            Sample removed;
            if (!_samples.TryRemove(id, out removed))
                return NotFound();
            return Ok(new { Message = $"Sample {id} removed.", Sample = removed });
        }
    }
}
