'use strict';

/**
 * Shared utility functions for BioBots simulation modules.
 *
 * Thin re-export layer — delegates to the canonical shared modules
 * (docs/shared/validation and docs/shared/stats) to eliminate
 * duplicate implementations while preserving the existing public API
 * consumed by 17+ simulation scripts.
 */

var validation = require('../../docs/shared/validation');
var stats      = require('../../docs/shared/stats');

module.exports = {
  // Validation (canonical: docs/shared/validation)
  clamp:               validation.clamp,
  validatePositive:    validation.validatePositive,
  validateNonNegative: validation.validateNonNegative,
  round:               validation.round,

  // Statistics (canonical: docs/shared/stats)
  mean:       stats.mean,
  stddev:     stats.stddev,
  median:     stats.median,
  percentile: stats.percentile,
};
