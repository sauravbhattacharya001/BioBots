var uri = 'api/prints';

function formatItem(item) {

    var retVal = 'Email: ' + item.user_info.email;
    retVal = retVal + 'Serial: ' + item.user_info.serial;
    return retVal;
}

function runMethod(func) {

    var property = $('#property option:selected').val();
    var arithmetic = $('#arithmetic option:selected').val();
    var value = $('#param').val();

    if (func == undefined)
        param = $('#param').val();
    else
        param = func;

    $.getJSON(uri + '/' + property + '/' + arithmetic + '/' + param)
      .done(function (data) {
          $('#print').text(data);
      })

      .fail(function (jqXHR, textStatus, err) {
          $('#print').text('Error: ' + err);
      });
}