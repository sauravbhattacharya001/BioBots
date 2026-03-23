'use strict';

var uri = 'api/prints';

/**
 * Validates that a value is a finite number.
 * @param {string} val - The value to validate.
 * @returns {boolean} True if the value is a valid finite number.
 */
function isNumeric(val) {
    return val !== '' && !isNaN(val) && isFinite(val);
}

/**
 * Set the enabled state of all action buttons.
 * @param {boolean} enabled - Whether buttons should be enabled.
 */
function setButtonsEnabled(enabled) {
    $('input[type="button"]').prop('disabled', !enabled);
}

function runMethod(func) {

    var property = $('#property option:selected').val();
    var arithmetic = $('#arithmetic option:selected').val();

    // Allowlist valid property and arithmetic values to prevent URL path injection.
    // Without this, a crafted <option> value could manipulate the API path.
    var VALID_PROPERTIES = [
        'pressure', 'speed', 'temperature', 'viability',
        'resolution', 'layerHeight', 'nozzleDiameter',
        'crosslinkingIntensity', 'crosslinkingDuration'
    ];
    var VALID_ARITHMETIC = [
        'greater', 'lesser', 'equal',
        'Maximum', 'Minimum', 'Average'
    ];

    if (VALID_PROPERTIES.indexOf(property) === -1) {
        $('#print').text('Invalid property selected.');
        return;
    }
    if (VALID_ARITHMETIC.indexOf(arithmetic) === -1) {
        $('#print').text('Invalid operation selected.');
        return;
    }

    var param;
    var isAggregation = (func !== undefined);
    if (isAggregation)
        param = func;
    else
        param = $('#param').val();

    // Only validate numeric input for comparison operations (greater/lesser/equal),
    // not for aggregation functions (Maximum, Minimum, Average)
    if (!isAggregation && !isNumeric(param)) {
        $('#print').text('Please enter a valid number.');
        return;
    }

    var encodedProperty = encodeURIComponent(property);
    var encodedArithmetic = encodeURIComponent(arithmetic);
    var encodedParam = encodeURIComponent(param);

    // Disable buttons and show loading state to prevent duplicate requests
    setButtonsEnabled(false);
    $('#print').text('Loading...');

    $.getJSON(uri + '/' + encodedProperty + '/' + encodedArithmetic + '/' + encodedParam)
      .done(function (data) {
          $('#print').text(data);
      })
      .fail(function (jqXHR, textStatus, err) {
          $('#print').text('Error: ' + err);
      })
      .always(function () {
          setButtonsEnabled(true);
      });
}

// CommonJS export for testing (no-op in browsers where `module` is undefined)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { isNumeric, setButtonsEnabled, runMethod, _uri: uri };
}
