/**
 * Admin helpers — FTTH fusion splicer clamp limits via shared localStorage bridge.
 */
(function () {
  'use strict';

  var CLAMP_FORWARD_ID = 'config-clamp-forward';
  var CLAMP_BACKWARD_ID = 'config-clamp-backward';
  var FSM_FORWARD_KEY = 'fsm_forward_limit';
  var FSM_BACKWARD_KEY = 'fsm_backward_limit';

  function persistForwardLimit(value) {
    try {
      localStorage.setItem(FSM_FORWARD_KEY, String(value));
    } catch (err) { /* ignore */ }
  }

  function persistBackwardLimit(value) {
    try {
      localStorage.setItem(FSM_BACKWARD_KEY, String(value));
    } catch (err) { /* ignore */ }
  }

  function bindClampStorageBridge() {
    var forwardInput = document.getElementById(CLAMP_FORWARD_ID);
    var backwardInput = document.getElementById(CLAMP_BACKWARD_ID);

    if (forwardInput && !forwardInput.dataset.fsmStorageBound) {
      forwardInput.dataset.fsmStorageBound = '1';
      forwardInput.addEventListener('input', function (e) {
        persistForwardLimit(e.target.value);
      });
      persistForwardLimit(forwardInput.value);
    }

    if (backwardInput && !backwardInput.dataset.fsmStorageBound) {
      backwardInput.dataset.fsmStorageBound = '1';
      backwardInput.addEventListener('input', function (e) {
        persistBackwardLimit(e.target.value);
      });
      persistBackwardLimit(backwardInput.value);
    }
  }

  function bindClampLimitPipeline() {
    document.addEventListener('ifa:clamp-limit-fields-ready', bindClampStorageBridge);

    if (window.FtthLabSettings && FtthLabSettings.EVENTS && FtthLabSettings.EVENTS.saved) {
      document.addEventListener(FtthLabSettings.EVENTS.saved, bindClampStorageBridge);
    }

    bindClampStorageBridge();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindClampLimitPipeline);
  } else {
    bindClampLimitPipeline();
  }
})();
