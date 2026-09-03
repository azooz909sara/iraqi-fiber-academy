/**
 * Admin helpers — FTTH lab preview messaging (parent → site-preview iframe).
 */
(function () {
  'use strict';

  function postSplicerTravelToPreview(value) {
    var frame = document.getElementById('site-preview-frame');
    if (!frame || !frame.contentWindow) return;
    frame.contentWindow.postMessage({
      type: 'UPDATE_SPLICER_TRAVEL',
      value: parseInt(value, 10),
    }, '*');
  }

  function bindSplicerTravelSlider() {
    document.addEventListener('input', function (e) {
      var input = e.target;
      if (!input || input.id !== 'config-splicer-travel') return;
      postSplicerTravelToPreview(input.value);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindSplicerTravelSlider);
  } else {
    bindSplicerTravelSlider();
  }
})();
