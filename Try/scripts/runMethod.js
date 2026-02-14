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

    var encodedParam = encodeURIComponent(param);

    // Disable buttons and show loading state to prevent duplicate requests
    setButtonsEnabled(false);
    $('#print').text('Loading...');

    $.getJSON(uri + '/' + property + '/' + arithmetic + '/' + encodedParam)
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
