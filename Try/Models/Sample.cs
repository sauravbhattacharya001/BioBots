using System;
using System.Collections.Generic;

namespace BioBots.Models
{
    /// <summary>
    /// Represents a biological sample tracked through the bioprinting workflow.
    /// Covers creation, storage, processing, quality checks, and disposal.
    /// </summary>
    public class Sample
    {
        /// <summary>Unique sample identifier (e.g. "SPL-20260326-001").</summary>
        public string SampleId { get; set; }

        /// <summary>Human-readable label for the sample.</summary>
        public string Label { get; set; }

        /// <summary>Type of sample: Bioink, Tissue, Scaffold, CellSuspension, Hydrogel, Other.</summary>
        public string SampleType { get; set; }

        /// <summary>Current status: Created, Stored, InProcess, Printed, QCPassed, QCFailed, Disposed.</summary>
        public string Status { get; set; }

        /// <summary>ISO-8601 creation timestamp.</summary>
        public DateTime CreatedAt { get; set; }

        /// <summary>ISO-8601 last-updated timestamp.</summary>
        public DateTime UpdatedAt { get; set; }

        /// <summary>Storage location (e.g. "Freezer-A, Shelf 3, Slot 12").</summary>
        public string StorageLocation { get; set; }

        /// <summary>Required storage temperature in °C.</summary>
        public double? StorageTemperatureC { get; set; }

        /// <summary>Volume or mass remaining (with unit, e.g. "2.5 mL").</summary>
        public string Quantity { get; set; }

        /// <summary>Passage number for cell-based samples.</summary>
        public int? PassageNumber { get; set; }

        /// <summary>Cell viability percentage (0-100) from last QC check.</summary>
        public double? ViabilityPercent { get; set; }

        /// <summary>Serial number of the BioBot printer used (if printed).</summary>
        public int? PrinterSerial { get; set; }

        /// <summary>Operator / researcher email.</summary>
        public string OperatorEmail { get; set; }

        /// <summary>ISO-8601 expiration date.</summary>
        public DateTime? ExpiresAt { get; set; }

        /// <summary>Free-form notes.</summary>
        public string Notes { get; set; }

        /// <summary>Audit trail of status transitions.</summary>
        public List<SampleEvent> Events { get; set; } = new List<SampleEvent>();
    }

    /// <summary>
    /// An immutable event in a sample's lifecycle.
    /// </summary>
    public class SampleEvent
    {
        public DateTime Timestamp { get; set; }
        public string FromStatus { get; set; }
        public string ToStatus { get; set; }
        public string PerformedBy { get; set; }
        public string Comment { get; set; }
    }
}
