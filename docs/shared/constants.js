/**
 * BioBots Shared Constants
 *
 * Centralized metric definitions, labels, and colors used across
 * all dashboard pages. Single source of truth — add new metrics here.
 */

/** All queryable metric keys. */
const METRICS = [
    'livePercent', 'deadPercent', 'elasticity',
    'cl_duration', 'cl_intensity',
    'extruder1', 'extruder2',
    'layerHeight', 'layerNum'
];

/** Human-readable labels for each metric. */
const metricLabels = {
    livePercent:  'Live Cell %',
    deadPercent:  'Dead Cell %',
    elasticity:   'Elasticity (kPa)',
    cl_duration:  'CL Duration (ms)',
    cl_intensity: 'CL Intensity (%)',
    extruder1:    'Extruder 1 Pressure',
    extruder2:    'Extruder 2 Pressure',
    layerHeight:  'Layer Height (mm)',
    layerNum:     'Layer Count'
};

/** Chart colors for each metric (Tailwind-inspired palette). */
const metricColors = {
    livePercent:  '#4ade80',
    deadPercent:  '#f87171',
    elasticity:   '#38bdf8',
    cl_duration:  '#fbbf24',
    cl_intensity: '#fb923c',
    extruder1:    '#a78bfa',
    extruder2:    '#c084fc',
    layerHeight:  '#2dd4bf',
    layerNum:     '#f472b6'
};

/**
 * Extended metric descriptors with accessor, unit, and directionality.
 * Used by compare.html, quality.html, and other pages that need
 * richer metadata than just labels/colors.
 */
const METRIC_DESCRIPTORS = [
    { key: 'livePercent',  label: 'Live Cell %',  unit: '%',   higherBetter: true,  get: p => p.print_data.livePercent },
    { key: 'deadPercent',  label: 'Dead Cell %',  unit: '%',   higherBetter: false, get: p => p.print_data.deadPercent },
    { key: 'elasticity',   label: 'Elasticity',   unit: 'kPa', higherBetter: true,  get: p => p.print_data.elasticity },
    { key: 'cl_duration',  label: 'CL Duration',  unit: 'ms',  higherBetter: null,  get: p => p.print_info.crosslinking.cl_duration },
    { key: 'cl_intensity', label: 'CL Intensity', unit: '%',   higherBetter: null,  get: p => p.print_info.crosslinking.cl_intensity },
    { key: 'extruder1',    label: 'Extruder 1',   unit: '',    higherBetter: null,  get: p => p.print_info.pressure.extruder1 },
    { key: 'extruder2',    label: 'Extruder 2',   unit: '',    higherBetter: null,  get: p => p.print_info.pressure.extruder2 },
    { key: 'layerHeight',  label: 'Layer Height', unit: 'mm',  higherBetter: null,  get: p => p.print_info.resolution.layerHeight },
    { key: 'layerNum',     label: 'Layer Count',  unit: '',    higherBetter: true,  get: p => p.print_info.resolution.layerNum },
    { key: 'wellplate',    label: 'Wellplate',    unit: '',    higherBetter: null,  get: p => p.print_info.wellplate },
];
