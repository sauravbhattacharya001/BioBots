namespace BioBots.Models
{
    public class Print
    {
        public UserInfo user_info { get; set; }
        public PrintInfo print_info { get; set; }
        public PrintData print_data { get; set; }
    }

    public class UserInfo
    {
        /// <summary>
        /// Serial number of the customer's BioBot 1
        /// </summary>
        public int serial { get; set; }

        /// <summary>
        /// Customer's email address
        /// </summary>
        public string email { get; set; }
    }

    public class PrintInfo
    {
        public Files files { get; set; }
        public Pressure pressure { get; set; }
        public Crosslinking crosslinking { get; set; }
        public Resolution resolution { get; set; }

        /// <summary>
        /// Wellplate type used for the print.
        /// </summary>
        public int wellplate { get; set; }
    }

    public class Files
    {
        /// <summary>
        /// Filename of the input print GCODE file.
        /// </summary>
        public string input { get; set; }

        /// <summary>
        /// Filename of the post-processed print GCODE file.
        /// </summary>
        public string output { get; set; }
    }

    public class Pressure
    {
        /// <summary>
        /// Pressure of the first extruder at time of print.
        /// </summary>
        public double extruder1 { get; set; }

        /// <summary>
        /// Pressure of the second extruder at the time of print.
        /// </summary>
        public double extruder2 { get; set; }
    }

    public class Crosslinking
    {
        /// <summary>
        /// If photocrosslinking was used during this print.
        /// </summary>
        public bool cl_enabled { get; set; }

        /// <summary>
        /// Duration of photocrosslinking using during this print in ms.
        /// </summary>
        public int cl_duration { get; set; }

        /// <summary>
        /// Percent intensity of light used in photocrosslinking.
        /// </summary>
        public int cl_intensity { get; set; }
    }

    public class Resolution
    {
        /// <summary>
        /// Number of layers in this print.
        /// </summary>
        public int layerNum { get; set; }

        /// <summary>
        /// Height of each layer in mm.
        /// </summary>
        public double layerHeight { get; set; }
    }

    public class LivePercent
    {
        public string type { get; set; }
        public string description { get; set; }
    }

    public class PrintData
    {
        /// <summary>
        /// Percent of final print determined to be alive through live/dead imaging.
        /// </summary>
        public double livePercent { get; set; }

        /// <summary>
        /// Measure of final print structural rigidity measured in kPa.
        /// </summary>
        public double elasticity { get; set; }

        /// <summary>
        /// Percent of final print determined to be dead through live/dead imaging.
        /// </summary>
        public double deadPercent { get; set; }
    }
}