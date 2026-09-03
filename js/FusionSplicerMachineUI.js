/**
 * FusionSplicerMachineUI — native DOM chassis (migrated from fusion-splicer-machine.html).
 * Markup + scoped controller; one instance per placed lab machine.
 */
window.clampForwardLimit = typeof window.clampForwardLimit === 'number' ? window.clampForwardLimit : 81;
window.clampBackwardLimit = typeof window.clampBackwardLimit === 'number' ? window.clampBackwardLimit : 0;

(function (global) {
  'use strict';

  var CLAMP_LIMITS_LIVE_KEY = 'ifa:splicer_clamp_limits_live';
  var FSM_FORWARD_STORAGE_KEY = 'fsm_forward_limit';
  var FSM_BACKWARD_STORAGE_KEY = 'fsm_backward_limit';
  var DEFAULT_CLAMP_FORWARD = 95;
  var DEFAULT_CLAMP_FORWARD_STORAGE_FALLBACK = 74;
  var DEFAULT_CLAMP_BACKWARD = 0;

  function parseClampLimitPx(value, fallback) {
    if (value == null || value === '') return fallback;
    var n = Number(value);
    if (!isFinite(n) || n < 0) return fallback;
    return Math.min(200, Math.round(n));
  }

  function applyClampLimits(forward, backward) {
    if (forward != null && isFinite(Number(forward))) {
      window.clampForwardLimit = parseClampLimitPx(forward, DEFAULT_CLAMP_FORWARD);
    }
    if (backward != null && isFinite(Number(backward))) {
      window.clampBackwardLimit = parseClampLimitPx(backward, DEFAULT_CLAMP_BACKWARD);
    }
  }

  function readLiveClampForwardPx() {
    var n = window.clampForwardLimit;
    if (typeof n === 'number' && isFinite(n)) return Math.max(0, Math.round(n));
    return DEFAULT_CLAMP_FORWARD;
  }

  function readLiveClampBackwardPx() {
    var n = window.clampBackwardLimit;
    if (typeof n === 'number' && isFinite(n)) return Math.max(0, Math.round(n));
    return DEFAULT_CLAMP_BACKWARD;
  }

  function readClampLimitsFromSettings() {
    if (global.FtthLabSettings && typeof FtthLabSettings.getSplicerClampLimits === 'function') {
      return FtthLabSettings.getSplicerClampLimits();
    }
    if (global.FtthLabSettings && typeof FtthLabSettings.getItem === 'function') {
      var item = FtthLabSettings.getItem('fusion-splicer-machine');
      var specs = item && item.specs ? item.specs : {};
      var forward = specs.splicerClampForwardPx != null
        ? specs.splicerClampForwardPx
        : (specs.splicerClampTravelPx != null ? specs.splicerClampTravelPx : null);
      var backward = specs.splicerClampBackwardPx != null ? specs.splicerClampBackwardPx : null;
      return {
        forward: forward != null ? forward : DEFAULT_CLAMP_FORWARD,
        backward: backward != null ? backward : DEFAULT_CLAMP_BACKWARD,
      };
    }
    return { forward: DEFAULT_CLAMP_FORWARD, backward: DEFAULT_CLAMP_BACKWARD };
  }

  function syncClampLimitsFromSettings() {
    var limits = readClampLimitsFromSettings();
    applyClampLimits(limits.forward, limits.backward);
  }

  function getClampForwardLimit() {
    return readLiveClampForwardPx();
  }

  function getClampBackwardLimit() {
    return readLiveClampBackwardPx();
  }

  function readStorageForwardLimitPx() {
    try {
      var raw = localStorage.getItem(FSM_FORWARD_STORAGE_KEY);
      if (raw === null || raw === '') return DEFAULT_CLAMP_FORWARD_STORAGE_FALLBACK;
      var n = parseInt(raw, 10);
      if (!isFinite(n) || n < 0) return DEFAULT_CLAMP_FORWARD_STORAGE_FALLBACK;
      return Math.min(200, n);
    } catch (e) {
      return DEFAULT_CLAMP_FORWARD_STORAGE_FALLBACK;
    }
  }

  function readStorageBackwardLimitPx() {
    try {
      var raw = localStorage.getItem(FSM_BACKWARD_STORAGE_KEY);
      if (raw === null || raw === '') return DEFAULT_CLAMP_BACKWARD;
      var n = parseInt(raw, 10);
      if (!isFinite(n) || n < 0) return DEFAULT_CLAMP_BACKWARD;
      return Math.min(200, n);
    } catch (e) {
      return DEFAULT_CLAMP_BACKWARD;
    }
  }

  function applyClampLimitsMessage(data) {
    if (!data || data.type !== 'UPDATE_CLAMP_LIMITS') return;
    if (data.forward != null && isFinite(Number(data.forward))) {
      window.clampForwardLimit = parseClampLimitPx(data.forward, readLiveClampForwardPx());
    }
    if (data.backward != null && isFinite(Number(data.backward))) {
      window.clampBackwardLimit = parseClampLimitPx(data.backward, readLiveClampBackwardPx());
    }
    try {
      localStorage.setItem(CLAMP_LIMITS_LIVE_KEY, JSON.stringify({
        type: 'UPDATE_CLAMP_LIMITS',
        forward: getClampForwardLimit(),
        backward: getClampBackwardLimit(),
        ts: Date.now(),
      }));
    } catch (err) { /* ignore */ }
  }

  function readClampLimitsFromLiveStorage() {
    try {
      var raw = localStorage.getItem(CLAMP_LIMITS_LIVE_KEY);
      if (!raw) return;
      applyClampLimitsMessage(JSON.parse(raw));
    } catch (err) { /* ignore */ }
  }

  function isLiveClampPreviewContext() {
    try {
      if (window.self !== window.top) return true;
      return new URLSearchParams(window.location.search).get('mode') === 'admin-preview';
    } catch (err) {
      return true;
    }
  }

  syncClampLimitsFromSettings();
  if (isLiveClampPreviewContext()) {
    readClampLimitsFromLiveStorage();
  }

  if (!global.__fsmClampLimitsMessageBound) {
    global.__fsmClampLimitsMessageBound = true;
    window.addEventListener('message', function (ev) {
      applyClampLimitsMessage(ev.data);
    });
    window.addEventListener('storage', function (ev) {
      if (ev.key !== CLAMP_LIMITS_LIVE_KEY || !ev.newValue) return;
      try {
        applyClampLimitsMessage(JSON.parse(ev.newValue));
      } catch (err) { /* ignore */ }
    });
    if (global.FtthLabSettings && FtthLabSettings.EVENTS && FtthLabSettings.EVENTS.saved) {
      document.addEventListener(FtthLabSettings.EVENTS.saved, syncClampLimitsFromSettings);
    }
  }

  function assemblyMarkup() {
    return "<div  class=\"fsm-toast\"></div>\r\n\r\n<div  class=\"fsm-machine-body\">\r\n\r\n  <!-- ===== HEAT OVEN MODULE (Sleeve Heater) ===== -->\r\n  <div  class=\"fsm-heat-oven-module\">\r\n    <div  class=\"fsm-heat-oven-housing\">\r\n      <div  class=\"fsm-heat-oven-step-left\"></div>\r\n      <div  class=\"fsm-heat-oven-step-right\"></div>\r\n      <div  class=\"fsm-heat-oven-channel\">\r\n        <div  class=\"fsm-heat-oven-plate\">\r\n          <div  data-oven-slot=\"1\" class=\"fsm-heat-oven-slot\"></div>\r\n        </div>\r\n        <div  class=\"fsm-heat-oven-glow\"></div>\r\n      </div>\r\n      <!-- Interactive lid over heating compartment -->\r\n      <div  role=\"button\" tabindex=\"0\" aria-label=\"Toggle heat oven lid\" class=\"fsm-heat-oven-lid\">\r\n        <div  class=\"fsm-heat-oven-lid-face\"></div>\r\n        <div  class=\"fsm-heat-oven-lid-handle\"></div>\r\n      </div>\r\n    </div>\r\n    <div  class=\"fsm-heat-oven-lid-btn\">LID</div>\r\n    <div  class=\"fsm-heat-oven-led\"></div>\r\n    <div  class=\"fsm-heat-oven-label\">HEAT OVEN</div>\r\n  </div>\r\n\r\n  <!-- ===== TOP SCREEN ===== -->\r\n  <div  class=\"fsm-screen-section\">\r\n    <div  class=\"fsm-screen-housing\">\r\n      <div class=\"status-bar\">\r\n        <div class=\"left-icons\">\r\n          <span class=\"mode-label fsm-mode-label\" >SM AUTO</span>\r\n          <div class=\"icon-signal\"><span></span><span></span><span></span><span></span></div>\r\n        </div>\r\n        <div class=\"right-icons\">\r\n          <div class=\"icon-battery\"></div>\r\n        </div>\r\n      </div>\r\n\r\n      <div class=\"camera-views\">\r\n        <div class=\"camera-panel fsm-cam-x\" >\r\n          <div class=\"camera-label\">X-AXIS</div>\r\n          <div class=\"alignment-overlay\">\r\n            <div class=\"val\"><span>X:</span> <span  class=\"fsm-x-val\">0.002</span> mm</div>\r\n          </div>\r\n          <canvas  class=\"fsm-canvas-x\"></canvas>\r\n        </div>\r\n        <div class=\"camera-panel fsm-cam-y\" >\r\n          <div class=\"camera-label\">Y-AXIS</div>\r\n          <div class=\"alignment-overlay\">\r\n            <div class=\"val\"><span>Y:</span> <span  class=\"fsm-y-val\">0.005</span> mm</div>\r\n          </div>\r\n          <canvas  class=\"fsm-canvas-y\"></canvas>\r\n        </div>\r\n      </div>\r\n\r\n      <div class=\"screen-info\">\r\n        <span class=\"splice-mode fsm-splice-mode\" >AUTO SPLICE</span>\r\n        <span class=\"status-text fsm-status-text\" >READY</span>\r\n        <span class=\"loss-est fsm-loss-est\" >EST.LOSS: 0.02 dB</span>\r\n      </div>\r\n    </div>\r\n  </div>\r\n\r\n  <!-- ===== FUSION CHAMBER ===== -->\r\n  <div  class=\"fsm-fusion-chamber\">\r\n    <div  class=\"fsm-chamber-label\">Fusion Chamber</div>\r\n    <div  class=\"fsm-chamber-panel\">\r\n\r\n      <!-- Chamber panel corner Phillips screws -->\r\n      <div class=\"phillips-screw screw-tl\"></div>\r\n      <div class=\"phillips-screw screw-tr\"></div>\r\n      <div class=\"phillips-screw screw-bl\"></div>\r\n      <div class=\"phillips-screw screw-br\"></div>\r\n\r\n      <!-- Clamp status indicators -->\r\n      <div class=\"clamp-indicator fsm-clamp-ind-l\" ></div>\r\n      <div class=\"clamp-indicator fsm-clamp-ind-r\" ></div>\r\n\r\n      <!-- D-pad movement indicator & clamp selector display -->\r\n      <div  class=\"fsm-move-indicator\">ALIGN MODE</div>\r\n      <div  class=\"fsm-offset-display\">X:+0.000 Y:+0.000</div>\r\n      <div  class=\"fsm-clamp-select-display\">SEL: L-CLAMP</div>\r\n\r\n      <!-- Recessed cavity -->\r\n      <div  class=\"fsm-chamber-cavity\">\r\n\r\n        <!-- Fiber entry ports -->\r\n        <div class=\"fiber-entry fsm-fiber-entry-left\" ></div>\r\n        <div class=\"fiber-entry fsm-fiber-entry-right\" ></div>\r\n\r\n        <!-- ========== LEFT CLAMP ========== -->\r\n        <div class=\"clamp-assembly fsm-clamp-assembly-l\" >\r\n          <div class=\"clamp-base\">\r\n            <div class=\"clamp-base-groove\">\r\n              <div class=\"clamp-base-groove-inner\"></div>\r\n              <div class=\"clamp-base-groove-cut\"></div>\r\n            </div>\r\n            <div class=\"hex-screw hs-l1\"></div>\r\n            <div class=\"hex-screw hs-l2\"></div>\r\n            <div class=\"hex-screw hs-l3\"></div>\r\n            <div class=\"hex-screw hs-l4\"></div>\r\n            <!-- External fiber mount points (empty until injected) -->\r\n            <div class=\"clamp-fiber fsm-clamp-fiber-l\"  data-fiber-slot=\"L\" hidden></div>\r\n            <div class=\"clamp-fiber-lock fsm-clamp-fiber-lock-l\"  data-fiber-lock=\"L\" hidden></div>\r\n          </div>\r\n          <div class=\"clamp-latch\"></div>\r\n          <div class=\"clamp-lid fsm-clamp-lid-l\" >\r\n            <div class=\"clamp-lid-exterior\">\r\n              <div class=\"ribbed-pad\">\r\n                <div class=\"rib\"></div><div class=\"rib\"></div><div class=\"rib\"></div>\r\n                <div class=\"rib\"></div><div class=\"rib\"></div><div class=\"rib\"></div>\r\n                <div class=\"rib\"></div><div class=\"rib\"></div>\r\n              </div>\r\n              <div class=\"lid-grip\">\r\n                <div class=\"grip-line\"></div><div class=\"grip-line\"></div>\r\n                <div class=\"grip-line\"></div><div class=\"grip-line\"></div>\r\n                <div class=\"grip-line\"></div>\r\n              </div>\r\n            </div>\r\n            <div class=\"clamp-lid-interior\">\r\n              <div class=\"inner-rubber-pad\"></div>\r\n            </div>\r\n          </div>\r\n          <div class=\"clamp-hinge-barrel\">\r\n            <div class=\"hinge-ring\" style=\"top:8px\"></div>\r\n            <div class=\"hinge-ring\" style=\"top:22px\"></div>\r\n            <div class=\"hinge-ring\" style=\"top:36px\"></div>\r\n            <div class=\"hinge-ring\" style=\"top:50px\"></div>\r\n            <div class=\"hinge-ring\" style=\"top:64px\"></div>\r\n            <div class=\"hinge-ring\" style=\"top:78px\"></div>\r\n            <div class=\"hinge-ring\" style=\"top:92px\"></div>\r\n            <div class=\"hinge-ring\" style=\"top:106px\"></div>\r\n            <div class=\"hinge-ring\" style=\"top:120px\"></div>\r\n            <div class=\"hinge-ring\" style=\"top:134px\"></div>\r\n            <div class=\"hinge-ring\" style=\"top:148px\"></div>\r\n            <div class=\"hinge-ring\" style=\"top:162px\"></div>\r\n            <div class=\"hinge-ring\" style=\"top:176px\"></div>\r\n          </div>\r\n          <div class=\"clamp-label\">L-CLAMP</div>\r\n        </div>\r\n\r\n        <!-- ========== CENTRAL ELECTRODE / V-GROOVE ZONE ========== -->\r\n        <div  class=\"fsm-alignment-stage\">\r\n          <div  class=\"fsm-alignment-crosshair\"></div>\r\n          <div class=\"electrode-label\">ARC ZONE</div>\r\n\r\n          <div  class=\"fsm-electrode-top\">\r\n            <div class=\"electrode-mount\"></div>\r\n            <div class=\"electrode-rod\"></div>\r\n            <div class=\"electrode-tip\"></div>\r\n          </div>\r\n\r\n          <div  class=\"fsm-electrode-bottom\">\r\n            <div class=\"electrode-tip-up\"></div>\r\n            <div class=\"electrode-rod-b\"></div>\r\n            <div class=\"electrode-mount-b\"></div>\r\n          </div>\r\n\r\n          <div  class=\"fsm-v-groove\">\r\n            <div class=\"v-groove-body\">\r\n              <div class=\"v-groove-channel\"></div>\r\n              <div class=\"v-groove-highlight\"></div>\r\n            </div>\r\n          </div>\r\n\r\n          <div  class=\"fsm-arc-glow\"></div>\r\n\r\n          <!-- Chamber fiber hooks (empty at boot; external scripts may reveal) -->\r\n          <div class=\"groove-fiber fsm-groove-fiber-l\"  data-groove-fiber=\"L\" hidden></div>\r\n          <div class=\"groove-fiber fsm-groove-fiber-r\"  data-groove-fiber=\"R\" hidden></div>\r\n          <div class=\"fiber-lock fsm-fiber-lock-l\"  data-fiber-lock-zone=\"L\" hidden></div>\r\n          <div class=\"fiber-lock fsm-fiber-lock-r\"  data-fiber-lock-zone=\"R\" hidden></div>\r\n        </div>\r\n\r\n        <!-- ========== RIGHT CLAMP ========== -->\r\n        <div class=\"clamp-assembly fsm-clamp-assembly-r\" >\r\n          <div class=\"clamp-base\">\r\n            <div class=\"clamp-base-groove\">\r\n              <div class=\"clamp-base-groove-inner\"></div>\r\n              <div class=\"clamp-base-groove-cut\"></div>\r\n            </div>\r\n            <div class=\"hex-screw hs-r1\"></div>\r\n            <div class=\"hex-screw hs-r2\"></div>\r\n            <div class=\"hex-screw hs-r3\"></div>\r\n            <div class=\"hex-screw hs-r4\"></div>\r\n            <div class=\"clamp-fiber fsm-clamp-fiber-r\"  data-fiber-slot=\"R\" hidden></div>\r\n            <div class=\"clamp-fiber-lock fsm-clamp-fiber-lock-r\"  data-fiber-lock=\"R\" hidden></div>\r\n          </div>\r\n          <div class=\"clamp-latch\"></div>\r\n          <div class=\"clamp-lid fsm-clamp-lid-r\" >\r\n            <div class=\"clamp-lid-exterior\">\r\n              <div class=\"ribbed-pad\">\r\n                <div class=\"rib\"></div><div class=\"rib\"></div><div class=\"rib\"></div>\r\n                <div class=\"rib\"></div><div class=\"rib\"></div><div class=\"rib\"></div>\r\n                <div class=\"rib\"></div><div class=\"rib\"></div>\r\n              </div>\r\n              <div class=\"lid-grip\">\r\n                <div class=\"grip-line\"></div><div class=\"grip-line\"></div>\r\n                <div class=\"grip-line\"></div><div class=\"grip-line\"></div>\r\n                <div class=\"grip-line\"></div>\r\n              </div>\r\n            </div>\r\n            <div class=\"clamp-lid-interior\">\r\n              <div class=\"inner-rubber-pad\"></div>\r\n            </div>\r\n          </div>\r\n          <div class=\"clamp-hinge-barrel\">\r\n            <div class=\"hinge-ring\" style=\"top:8px\"></div>\r\n            <div class=\"hinge-ring\" style=\"top:22px\"></div>\r\n            <div class=\"hinge-ring\" style=\"top:36px\"></div>\r\n            <div class=\"hinge-ring\" style=\"top:50px\"></div>\r\n            <div class=\"hinge-ring\" style=\"top:64px\"></div>\r\n            <div class=\"hinge-ring\" style=\"top:78px\"></div>\r\n            <div class=\"hinge-ring\" style=\"top:92px\"></div>\r\n            <div class=\"hinge-ring\" style=\"top:106px\"></div>\r\n            <div class=\"hinge-ring\" style=\"top:120px\"></div>\r\n            <div class=\"hinge-ring\" style=\"top:134px\"></div>\r\n            <div class=\"hinge-ring\" style=\"top:148px\"></div>\r\n            <div class=\"hinge-ring\" style=\"top:162px\"></div>\r\n            <div class=\"hinge-ring\" style=\"top:176px\"></div>\r\n          </div>\r\n          <div class=\"clamp-label\">R-CLAMP</div>\r\n        </div>\r\n\r\n      </div><!-- /chamberCavity -->\r\n\r\n    </div><!-- /chamberPanel -->\r\n\r\n    <!-- Sleeve UI reserved for external sleeve tool — machine boots empty -->\r\n    <div  hidden aria-hidden=\"true\" class=\"fsm-sleeve-indicator\">\r\n      <div  class=\"fsm-sleeve-icon\"></div>\r\n      <span  class=\"fsm-sleeve-text\">SLEEVE EMPTY</span>\r\n      <div  class=\"fsm-heat-bar\"><div  class=\"fsm-heat-bar-fill\"></div></div>\r\n    </div>\r\n  </div>\r\n\r\n  <!-- ===== BOTTOM CONTROL PANEL ===== -->\r\n  <div  class=\"fsm-control-panel\">\r\n    <div  class=\"fsm-power-section\">\r\n      <div  class=\"fsm-power-btn\">\r\n        <div  class=\"on fsm-power-led\"></div>\r\n        <svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" style=\"position:absolute;top:8px;left:50%;transform:translateX(-50%)\">\r\n          <path d=\"M12 2v8M6.34 7.34a8 8 0 1 0 11.32 0\" stroke=\"#888\" stroke-width=\"2.5\" fill=\"none\" stroke-linecap=\"round\"/>\r\n        </svg>\r\n      </div>\r\n      <span class=\"power-label\">POWER</span>\r\n      <div  class=\"fsm-status-leds\">\r\n        <div class=\"led green-on fsm-led-pwr\"  title=\"Power\"></div>\r\n        <div class=\"led fsm-led-arc\"  title=\"Arc\"></div>\r\n        <div class=\"led fsm-led-err\"  title=\"Error\"></div>\r\n      </div>\r\n    </div>\r\n\r\n    <div  class=\"fsm-dpad-section\">\r\n      <div  class=\"fsm-dpad\">\r\n        <!-- Up -->\r\n        <div class=\"dpad-btn fsm-dpad-up\" >\r\n          <svg class=\"arrow-icon\" viewBox=\"0 0 24 24\"><polygon points=\"12,4 20,16 4,16\"/></svg>\r\n        </div>\r\n        <!-- Left -->\r\n        <div class=\"dpad-btn fsm-dpad-left\" >\r\n          <svg class=\"arrow-icon\" viewBox=\"0 0 24 24\"><polygon points=\"4,12 16,4 16,20\"/></svg>\r\n        </div>\r\n        <!-- Center/OK -->\r\n        <div  class=\"fsm-dpad-center\">\r\n          <svg class=\"check-icon\" viewBox=\"0 0 24 24\"><polyline points=\"6,12 10,16 18,8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>\r\n        </div>\r\n        <!-- Right -->\r\n        <div class=\"dpad-btn fsm-dpad-right\" >\r\n          <svg class=\"arrow-icon\" viewBox=\"0 0 24 24\"><polygon points=\"20,12 8,4 8,20\"/></svg>\r\n        </div>\r\n        <!-- Down -->\r\n        <div class=\"dpad-btn fsm-dpad-down\" >\r\n          <svg class=\"arrow-icon\" viewBox=\"0 0 24 24\"><polygon points=\"12,20 4,8 20,8\"/></svg>\r\n        </div>\r\n      </div>\r\n      <div class=\"dpad-label\">Navigation</div>\r\n    </div>\r\n\r\n    <div  class=\"fsm-xo-section\">\r\n      <div class=\"xo-btn fsm-x-btn\" >✕</div>\r\n      <div class=\"xo-btn fsm-o-btn\" >○</div>\r\n    </div>\r\n\r\n    <div  class=\"fsm-func-section\">\r\n      <div class=\"func-btn fsm-heat-btn\" >HEAT</div>\r\n      <div class=\"func-btn fsm-alm-btn\" >ALM</div>\r\n      <div class=\"func-btn fsm-and-btn\" >AND</div>\r\n      <div class=\"func-btn fsm-reset-btn\" >RESET</div>\r\n      <div class=\"func-btn fsm-set-btn\" >SET</div>\r\n    </div>\r\n  </div>\r\n\r\n  <div  class=\"fsm-brand-plate\">FIBER OPTIC FUSION SPLICER — INDUSTRIAL SERIES</div>\r\n\r\n</div>";
  }

  var instances = {};

  function camelToKebab(name) {
    return name.replace(/([A-Z])/g, function (m) {
      return '-' + m.toLowerCase();
    });
  }

  function destroyInstance(root) {
    var inst = instances[root];
    if (!inst) return;
    if (inst.animFrame) cancelAnimationFrame(inst.animFrame);
    if (inst.toastTimer) clearTimeout(inst.toastTimer);
    if (inst.heatInterval) clearInterval(inst.heatInterval);
    if (inst.keyHandler) document.removeEventListener('keydown', inst.keyHandler);
    if (inst.resizeHandler) window.removeEventListener('resize', inst.resizeHandler);
    if (inst.resetMotorCompleteHandler) {
      document.removeEventListener('fusion-splicer:resetMotorComplete', inst.resetMotorCompleteHandler);
    }
    delete instances[root];
  }

  function mount(root, opts) {
    if (!root) return null;
    destroyInstance(root);
    opts = opts || {};

    var state = {
      powered: true,
      selectedClamp: 'L',
      clampsClosed: { L: true, R: true },
      ovenLidOpen: false,
      fiberPlaced: { L: false, R: false },
      alignment: { x: 0.0, y: 0.0 },
      stageOffset: { x: 0, y: 0 },
      clampOffset: { L: { x: 0, y: 0 }, R: { x: 0, y: 0 } },
      aligning: false,
      splicing: false,
      heating: false,
      heatProgress: 0,
      mode: 'SM AUTO',
      alarm: false,
      statusText: 'READY',
      moveTimer: null,
      heatInterval: null,
      active: false,
    };

    var CLAMP_BASE = { L: { left: 4, top: 18 }, R: { right: 4, top: 18 } };
    var PX_STEP = 1.5;
    var OFFSET_LIMIT = 30;
    var listeners = {};
    var canvases = [];
    var animFrame = null;
    var time = 0;
    var toastTimer;
    var boundMachineId = opts.machineId || null;

    function q(name) {
      return root.querySelector('.fsm-' + camelToKebab(name));
    }

    function showToast(msg, type) {
      var t = q('toast');
      if (!t) return;
      t.textContent = msg;
      t.className = 'fsm-toast show' + (type ? ' ' + type : '');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () {
        t.className = 'fsm-toast';
      }, 2500);
    }

    function requirePower() {
      if (!state.powered) {
        showToast('Power off', 'error');
        return false;
      }
      return true;
    }

    function on(evt, fn) {
      if (!listeners[evt]) listeners[evt] = [];
      listeners[evt].push(fn);
      return function off() {
        listeners[evt] = (listeners[evt] || []).filter(function (f) {
          return f !== fn;
        });
      };
    }

    function emit(evt, payload) {
      (listeners[evt] || []).forEach(function (fn) {
        try {
          fn(payload);
        } catch (err) {
          console.error(err);
        }
      });
      if (global.CustomEvent) {
        document.dispatchEvent(new CustomEvent('fusion-splicer:' + evt, { detail: payload }));
      }
    }

    function syncClampLidZ(assembly, lid, isOpen) {
      if (assembly) assembly.classList.toggle('lid-open', !!isOpen);
      if (lid) lid.classList.toggle('is-open', !!isOpen);
    }

    function togglePower() {
      state.powered = !state.powered;
      var led = q('powerLed');
      var ledPwr = q('ledPwr');
      if (state.powered) {
        if (led) led.classList.add('on');
        if (ledPwr) ledPwr.classList.add('green-on');
        showToast('System Powered ON', 'success');
      } else {
        if (led) led.classList.remove('on');
        if (ledPwr) ledPwr.classList.remove('green-on');
        var ledArc = q('ledArc');
        var ledErr = q('ledErr');
        if (ledArc) ledArc.classList.remove('orange-on');
        if (ledErr) ledErr.classList.remove('red-on');
        showToast('System Powered OFF', 'error');
      }
      emit('power', { powered: state.powered });
    }

    function setOvenLidOpen(open) {
      state.ovenLidOpen = !!open;
      var mod = q('heatOvenModule');
      if (mod) mod.classList.toggle('lid-open', state.ovenLidOpen);
      var btn = q('heatOvenLidBtn');
      if (btn) btn.textContent = state.ovenLidOpen ? 'OPEN' : 'LID';
      emit('ovenLid', { open: state.ovenLidOpen });
    }

    function toggleOvenLid() {
      if (!requirePower()) return;
      setOvenLidOpen(!state.ovenLidOpen);
      showToast(
        state.ovenLidOpen ? 'Heat oven lid OPEN' : 'Heat oven lid CLOSED',
        state.ovenLidOpen ? 'warning' : 'success'
      );
    }

    function selectClamp(side) {
      if (side !== 'L' && side !== 'R') return;
      var asmL = q('clampAssemblyL');
      var asmR = q('clampAssemblyR');
      if (asmL) asmL.classList.remove('selected');
      if (asmR) asmR.classList.remove('selected');
      state.selectedClamp = side;
      var asm = q('clampAssembly' + side);
      if (asm) asm.classList.add('selected');
      var label = side === 'L' ? 'L-CLAMP' : 'R-CLAMP';
      var disp = q('clampSelectDisplay');
      if (disp) {
        disp.textContent = 'SEL: ' + label;
        disp.style.color = 'var(--accent-blue)';
      }
      showToast('Selected: ' + label, '');
      emit('clampSelect', { side: side });
    }

    function applyClampTransform(side) {
      var off = state.clampOffset[side];
      var el = q('clampAssembly' + side);
      if (!el) return;
      if (side === 'L') {
        el.style.left = CLAMP_BASE.L.left + off.x + 'px';
        el.style.right = '';
        el.style.top = CLAMP_BASE.L.top + off.y + 'px';
      } else {
        el.style.right = CLAMP_BASE.R.right + off.x + 'px';
        el.style.left = '';
        el.style.top = CLAMP_BASE.R.top + off.y + 'px';
      }
    }

    function syncAlignmentFromClamps() {
      state.alignment.x =
        (Math.abs(state.clampOffset.L.x - state.clampOffset.R.x) / PX_STEP) * 0.001;
      state.alignment.y =
        (Math.abs(state.clampOffset.L.y - state.clampOffset.R.y) / PX_STEP) * 0.001;
      var xVal = q('xVal');
      var yVal = q('yVal');
      if (xVal) xVal.textContent = state.alignment.x.toFixed(3);
      if (yVal) yVal.textContent = state.alignment.y.toFixed(3);

      var cx = (state.clampOffset.L.x - state.clampOffset.R.x) * 0.25;
      var cy = (state.clampOffset.L.y + state.clampOffset.R.y) * 0.25;
      state.stageOffset.x = cx;
      state.stageOffset.y = cy;
      var stage = q('alignmentStage');
      if (stage) stage.style.transform = 'translate(' + cx + 'px, ' + cy + 'px)';
    }

    function nudgeSelectedClamp(dir) {
      var side = state.selectedClamp;
      var off = state.clampOffset[side];
      if (dir === 'UP') off.y = Math.max(-OFFSET_LIMIT, off.y - PX_STEP);
      if (dir === 'DOWN') off.y = Math.min(OFFSET_LIMIT, off.y + PX_STEP);
      if (dir === 'LEFT') off.x = Math.max(-OFFSET_LIMIT, off.x - PX_STEP);
      if (dir === 'RIGHT') off.x = Math.min(OFFSET_LIMIT, off.x + PX_STEP);
      applyClampTransform(side);
      syncAlignmentFromClamps();

      var moveInd = q('moveIndicator');
      var offsetDisp = q('offsetDisplay');
      if (moveInd) moveInd.classList.add('active');
      var xSign = off.x >= 0 ? '+' : '';
      var ySign = off.y >= 0 ? '+' : '';
      if (offsetDisp) {
        offsetDisp.textContent =
          (side === 'L' ? 'L' : 'R') +
          ': X:' +
          xSign +
          ((off.x / PX_STEP) * 0.001).toFixed(3) +
          ' Y:' +
          ySign +
          ((off.y / PX_STEP) * 0.001).toFixed(3);
        offsetDisp.classList.add('active');
      }

      clearTimeout(state.moveTimer);
      state.moveTimer = setTimeout(function () {
        if (moveInd) moveInd.classList.remove('active');
        if (offsetDisp) offsetDisp.classList.remove('active');
      }, 2000);

      emit('clampNudge', { side: side, offset: { x: off.x, y: off.y }, dir: dir });
    }

    function dpadPress(dir) {
      if (!requirePower()) return;
      if (dir === 'OK') {
        var label = state.selectedClamp === 'L' ? 'L-CLAMP' : 'R-CLAMP';
        showToast(label + ' Position Confirmed', 'success');
        emit('clampConfirm', { side: state.selectedClamp });
        return;
      }
      nudgeSelectedClamp(dir);
      showToast(
        'Align ' +
          state.selectedClamp +
          ': ' +
          dir +
          ' → ' +
          state.clampOffset[state.selectedClamp].x.toFixed(1) +
          ' / ' +
          state.clampOffset[state.selectedClamp].y.toFixed(1) +
          ' px',
        ''
      );
    }

    function setFiberPlaced(side, placed) {
      if (side !== 'L' && side !== 'R') return;
      state.fiberPlaced[side] = !!placed;
      var groove = q('grooveFiber' + side);
      var clampF = q('clampFiber' + side);
      var lock = q('fiberLock' + side);
      var clampLock = q('clampFiberLock' + side);
      [groove, clampF, lock, clampLock].forEach(function (el) {
        if (!el) return;
        el.hidden = !placed;
        el.classList.remove('visible', 'locked');
      });
      if (placed && !state.clampsClosed[side]) {
        if (groove) groove.classList.add('visible');
        if (clampF) clampF.classList.add('visible');
      }
      if (placed && state.clampsClosed[side]) {
        if (lock) lock.classList.add('locked');
        if (clampLock) clampLock.classList.add('locked');
      }
      emit('fiberPlaced', { side: side, placed: !!placed });
    }

    function clearAllFibers() {
      setFiberPlaced('L', false);
      setFiberPlaced('R', false);
      [
        'grooveFiberL',
        'grooveFiberR',
        'fiberLockL',
        'fiberLockR',
        'clampFiberL',
        'clampFiberR',
        'clampFiberLockL',
        'clampFiberLockR',
      ].forEach(function (name) {
        var el = q(name);
        if (!el) return;
        el.classList.remove('visible', 'locked');
        el.hidden = true;
      });
    }

    function toggleClampLid(side) {
      if (!requirePower()) return;
      if (side !== 'L' && side !== 'R') return;

      state.clampsClosed[side] = !state.clampsClosed[side];
      var assembly = q('clampAssembly' + side);
      var ind = q('clampInd' + side);
      var grooveFiber = q('grooveFiber' + side);
      var fiberLock = q('fiberLock' + side);
      var clampFiber = q('clampFiber' + side);
      var clampFiberLock = q('clampFiberLock' + side);
      var lid = q('clampLid' + side);
      var isOpen = !state.clampsClosed[side];

      syncClampLidZ(assembly, lid, isOpen);
      if (state.clampsClosed[side]) {
        if (ind) ind.classList.remove('open');
        if (grooveFiber) grooveFiber.classList.remove('visible');
        if (clampFiber) clampFiber.classList.remove('visible');
        if (state.fiberPlaced[side]) {
          if (fiberLock) fiberLock.classList.add('locked');
          if (clampFiberLock) clampFiberLock.classList.add('locked');
          showToast('Clamp ' + side + ' CLOSED — Fiber LOCKED', 'success');
        } else {
          showToast('Clamp ' + side + ' CLOSED', 'success');
        }
      } else {
        if (ind) ind.classList.add('open');
        if (fiberLock) fiberLock.classList.remove('locked');
        if (clampFiberLock) clampFiberLock.classList.remove('locked');
        if (state.fiberPlaced[side]) {
          if (grooveFiber) grooveFiber.classList.add('visible');
          if (clampFiber) clampFiber.classList.add('visible');
          showToast('Clamp ' + side + ' OPEN', 'warning');
        } else {
          showToast('Clamp ' + side + ' OPEN — empty (await fiber)', 'warning');
        }
      }
      emit('clampLid', { side: side, closed: state.clampsClosed[side] });
    }

    function xPress() {
      if (!requirePower()) return;
      showToast('Cancel / Back', 'warning');
      emit('button', { id: 'X' });
    }

    function oPress() {
      if (!requirePower()) return;
      showToast('Option / Menu', '');
      emit('button', { id: 'O' });
    }

    function heatPress() {
      if (!requirePower()) return;
      if (state.heating) return showToast('Heating already in progress', 'warning');
      if (!state.ovenLidOpen) return showToast('Open heat oven lid first', 'warning');

      state.heating = true;
      state.heatProgress = 0;
      showToast('HEAT: Sleeve shrink started', 'warning');
      var statusText = q('statusText');
      if (statusText) {
        statusText.textContent = 'HEATING';
        statusText.style.color = 'var(--accent-orange)';
      }
      var plate = q('heatOvenPlate');
      var slot = q('heatOvenSlot');
      var glow = q('heatOvenGlow');
      var led = q('heatOvenLed');
      if (plate) plate.classList.add('heating');
      if (slot) slot.classList.add('heating');
      if (glow) glow.classList.add('active');
      if (led) led.classList.add('on');

      var fill = q('heatBarFill');
      if (state.heatInterval) clearInterval(state.heatInterval);
      state.heatInterval = setInterval(function () {
        state.heatProgress += 2;
        if (fill) fill.style.width = state.heatProgress + '%';
        if (state.heatProgress >= 100) {
          clearInterval(state.heatInterval);
          state.heatInterval = null;
          state.heating = false;
          if (fill) fill.style.width = '0%';
          if (plate) plate.classList.remove('heating');
          if (slot) slot.classList.remove('heating');
          if (glow) glow.classList.remove('active');
          if (led) led.classList.remove('on');
          if (slot) slot.style.boxShadow = '';
          if (statusText) {
            statusText.textContent = 'READY';
            statusText.style.color = '';
          }
          showToast('HEAT: Complete', 'success');
          emit('heatComplete', {});
        }
      }, 60);
      emit('heatStart', {});
    }

    function almPress() {
      if (!requirePower()) return;
      state.alarm = !state.alarm;
      var led = q('ledErr');
      var statusText = q('statusText');
      if (state.alarm) {
        if (led) led.classList.add('red-on');
        showToast('ALARM: Error detected!', 'error');
        if (statusText) {
          statusText.textContent = 'ALARM';
          statusText.style.color = 'var(--accent-red)';
        }
      } else {
        if (led) led.classList.remove('red-on');
        showToast('ALARM: Cleared', 'success');
        if (statusText) {
          statusText.textContent = 'READY';
          statusText.style.color = '';
        }
      }
      emit('alarm', { on: state.alarm });
    }

    function andPress() {
      if (!requirePower()) return;
      showToast('AND: Additional function', '');
      emit('button', { id: 'AND' });
    }

    function applyMotorClampTranslation(leftPx, rightPx) {
      var leftAsm = q('clampAssemblyL');
      var rightAsm = q('clampAssemblyR');
      if (!leftAsm || !rightAsm) return false;
      leftAsm.classList.add('is-motor-aligning');
      rightAsm.classList.add('is-motor-aligning');
      void leftAsm.offsetWidth;
      leftAsm.style.transform = 'translateX(' + leftPx + 'px)';
      rightAsm.style.transform = 'translateX(' + rightPx + 'px)';
      return true;
    }

    function clearMotorClampTranslation() {
      ['L', 'R'].forEach(function (side) {
        var asm = q('clampAssembly' + side);
        if (!asm) return;
        asm.classList.remove('is-motor-aligning');
        asm.style.transform = '';
      });
    }

    function finishSystemReset() {
      state.alignment = { x: 0, y: 0 };
      state.stageOffset = { x: 0, y: 0 };
      state.clampOffset = { L: { x: 0, y: 0 }, R: { x: 0, y: 0 } };
      state.alarm = false;
      state.splicing = false;
      state.aligning = false;
      state.heating = false;
      state.heatProgress = 0;
      if (state.heatInterval) {
        clearInterval(state.heatInterval);
        state.heatInterval = null;
      }
      applyClampTransform('L');
      applyClampTransform('R');
      clearMotorClampTranslation();
      var stage = q('alignmentStage');
      if (stage) stage.style.transform = 'translate(0, 0)';
      var xVal = q('xVal');
      var yVal = q('yVal');
      if (xVal) xVal.textContent = '0.000';
      if (yVal) yVal.textContent = '0.000';
      var ledErr = q('ledErr');
      var ledArc = q('ledArc');
      var arcGlow = q('arcGlow');
      if (ledErr) ledErr.classList.remove('red-on');
      if (ledArc) ledArc.classList.remove('orange-on');
      if (arcGlow) arcGlow.classList.remove('active');
      var heatBarFill = q('heatBarFill');
      if (heatBarFill) heatBarFill.style.width = '0%';
      var statusText = q('statusText');
      if (statusText) {
        statusText.textContent = 'READY';
        statusText.style.color = '';
      }
      var lossEst = q('lossEst');
      if (lossEst) lossEst.textContent = 'EST.LOSS: —';
      var moveIndicator = q('moveIndicator');
      var offsetDisplay = q('offsetDisplay');
      if (moveIndicator) moveIndicator.classList.remove('active');
      if (offsetDisplay) offsetDisplay.classList.remove('active');
      var plate = q('heatOvenPlate');
      var slot = q('heatOvenSlot');
      var glow = q('heatOvenGlow');
      var ovenLed = q('heatOvenLed');
      if (plate) plate.classList.remove('heating');
      if (slot) {
        slot.classList.remove('heating');
        slot.style.boxShadow = '';
      }
      if (glow) glow.classList.remove('active');
      if (ovenLed) ovenLed.classList.remove('on');
      clearAllFibers();
      showToast('System RESET — empty chamber', 'warning');
      emit('reset', { machineId: boundMachineId });
    }

    function resetPress() {
      if (!requirePower()) return;
      var backwardLimit = readStorageBackwardLimitPx();
      console.log('RESET Clicked - Backward Limit from storage:', backwardLimit);
      window.clampBackwardLimit = backwardLimit;

      if (backwardLimit > 0) {
        applyMotorClampTranslation(-backwardLimit, backwardLimit);
        emit('reset', {
          machineId: boundMachineId,
          backward: backwardLimit,
          skipMotorTransform: true,
          deferCleanup: true,
        });
        return;
      }

      finishSystemReset();
    }

    function hasFibersForAlign() {
      if (state.fiberPlaced.L && state.fiberPlaced.R) return true;
      if (!boundMachineId || !global.FtthLab ||
          typeof FtthLab.getSplicerDockedPair !== 'function') {
        return false;
      }
      var pair = FtthLab.getSplicerDockedPair(boundMachineId);
      if (pair && pair.left && pair.right) {
        state.fiberPlaced.L = true;
        state.fiberPlaced.R = true;
        return true;
      }
      return false;
    }

    function finishAligning(success) {
      state.aligning = false;
      var statusText = q('statusText');
      if (!statusText) return;
      if (success) {
        statusText.textContent = 'ALIGNED';
        statusText.style.color = 'var(--accent-green, #4caf50)';
      } else {
        statusText.textContent = 'ALIGN FAILED';
        statusText.style.color = 'var(--accent-orange)';
      }
    }

    function setPress() {
      try {
        if (!requirePower()) return;
        if (!state.clampsClosed.L || !state.clampsClosed.R) {
          return showToast('Close both clamps first!', 'error');
        }
        if (!hasFibersForAlign()) {
          console.warn('Alignment: L/R pigtails not snapped or fiber not placed');
          return showToast('No fiber loaded — dock L/R pigtails first', 'warning');
        }
        if (state.splicing) return showToast('Splice already in progress', 'warning');
        if (state.aligning) return showToast('Motor alignment in progress', 'warning');

        state.aligning = true;
        var statusText = q('statusText');
        if (statusText) {
          statusText.textContent = 'ALIGNING';
          statusText.style.color = 'var(--accent-orange)';
        }
        showToast('SET: Motor alignment started', 'success');

        var forwardLimit = readStorageForwardLimitPx();
        console.log('SET Clicked - Forward Limit from storage:', forwardLimit);
        window.clampForwardLimit = forwardLimit;
        applyMotorClampTranslation(forwardLimit, -forwardLimit);

        emit('setPress', {
          machineId: boundMachineId,
          forward: forwardLimit,
          skipMotorTransform: true,
        });
      } catch (e) {
        console.error('Alignment Error:', e);
        finishAligning(false);
        showToast('Alignment failed — see console', 'error');
      }
    }

    function runArcSpliceSequence() {
      state.aligning = false;
      if (state.splicing) return;
      if (!state.clampsClosed.L || !state.clampsClosed.R) return;
      if (!state.fiberPlaced.L || !state.fiberPlaced.R) return;

      state.splicing = true;
      var ledArc = q('ledArc');
      var statusText = q('statusText');
      if (ledArc) ledArc.classList.add('orange-on');
      if (statusText) {
        statusText.textContent = 'SPLICING';
        statusText.style.color = 'var(--accent-blue)';
      }
      showToast('SET: Auto splice initiated', 'success');
      emit('spliceStart', {});

      var step = 0;
      var totalSteps = 45;
      var iv = setInterval(function () {
        step += 1;
        var progress = step / totalSteps;
        var decay = 1 - progress * 0.08;
        state.clampOffset.L.x *= decay;
        state.clampOffset.L.y *= decay;
        state.clampOffset.R.x *= decay;
        state.clampOffset.R.y *= decay;
        applyClampTransform('L');
        applyClampTransform('R');
        state.alignment.x = Math.max(0, state.alignment.x * (1 - progress * 0.5));
        state.alignment.y = Math.max(0, state.alignment.y * (1 - progress * 0.5));
        var xVal = q('xVal');
        var yVal = q('yVal');
        if (xVal) xVal.textContent = state.alignment.x.toFixed(3);
        if (yVal) yVal.textContent = state.alignment.y.toFixed(3);
        state.stageOffset.x *= 1 - progress * 0.08;
        state.stageOffset.y *= 1 - progress * 0.08;
        var stage = q('alignmentStage');
        if (stage) {
          stage.style.transform =
            'translate(' + state.stageOffset.x + 'px, ' + state.stageOffset.y + 'px)';
        }
        var arcGlow = q('arcGlow');
        if (progress > 0.6 && arcGlow) arcGlow.classList.add('active');
        if (step >= totalSteps) {
          clearInterval(iv);
          state.splicing = false;
          state.clampOffset = { L: { x: 0, y: 0 }, R: { x: 0, y: 0 } };
          state.stageOffset = { x: 0, y: 0 };
          state.alignment = { x: 0, y: 0 };
          applyClampTransform('L');
          applyClampTransform('R');
          if (stage) stage.style.transform = 'translate(0, 0)';
          if (xVal) xVal.textContent = '0.000';
          if (yVal) yVal.textContent = '0.000';
          if (statusText) {
            statusText.textContent = 'SPLICE OK';
            statusText.style.color = 'var(--accent-green)';
          }
          var lossEst = q('lossEst');
          if (lossEst) lossEst.textContent = 'EST.LOSS: 0.01 dB';
          showToast('Splice Complete — Loss: 0.01 dB', 'success');
          setTimeout(function () {
            if (ledArc) ledArc.classList.remove('orange-on');
            if (arcGlow) arcGlow.classList.remove('active');
          }, 3000);
          emit('spliceComplete', { lossDb: 0.01 });
        }
      }, 80);
    }

    function initCanvas(className, axis) {
      var canvas = root.querySelector('.' + className);
      if (!canvas || !canvas.parentElement) return null;
      var rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = rect.width * 2;
      canvas.height = rect.height * 2;
      return { canvas: canvas, ctx: canvas.getContext('2d'), axis: axis };
    }

    function drawCamera(ctx, w, h, axis, t) {
      ctx.fillStyle = '#060e1e';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(0,180,255,0.06)';
      ctx.lineWidth = 1;
      var gridSize = 30;
      var x;
      var y;
      for (x = 0; x < w; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (y = 0; y < h; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,200,0,0.25)';
      ctx.beginPath();
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w / 2, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      if (state.fiberPlaced.L || state.fiberPlaced.R) {
        var centerY = h / 2;
        var gap = state.splicing ? Math.max(0, 8 * (1 - (t % 100) / 40)) : 8;
        var fiberWidth = 12;
        if (state.fiberPlaced.L) {
          var leftEnd = w / 2 - gap + state.clampOffset.L.x * 0.5;
          var offLY = state.clampOffset.L.y * 0.3;
          ctx.fillStyle = 'rgba(255,213,79,0.85)';
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(
              10,
              centerY - fiberWidth / 2 + offLY,
              Math.max(2, leftEnd - 10),
              fiberWidth,
              fiberWidth / 2
            );
          } else {
            ctx.rect(10, centerY - fiberWidth / 2 + offLY, Math.max(2, leftEnd - 10), fiberWidth);
          }
          ctx.fill();
        }
        if (state.fiberPlaced.R) {
          var rightStart = w / 2 + gap - state.clampOffset.R.x * 0.5;
          var offRY = state.clampOffset.R.y * 0.3;
          ctx.fillStyle = 'rgba(255,213,79,0.85)';
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(
              rightStart,
              centerY - fiberWidth / 2 + offRY,
              Math.max(2, w - 10 - rightStart),
              fiberWidth,
              fiberWidth / 2
            );
          } else {
            ctx.rect(
              rightStart,
              centerY - fiberWidth / 2 + offRY,
              Math.max(2, w - 10 - rightStart),
              fiberWidth
            );
          }
          ctx.fill();
        }
      }

      var arcGlow = q('arcGlow');
      if (arcGlow && arcGlow.classList.contains('active')) {
        var glow = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, 40);
        glow.addColorStop(0, 'rgba(255,255,255,0.9)');
        glow.addColorStop(0.2, 'rgba(0,180,255,0.8)');
        glow.addColorStop(1, 'rgba(0,0,255,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(w / 2 - 50, h / 2 - 50, 100, 100);
      }

      ctx.fillStyle = 'rgba(0,180,255,0.15)';
      ctx.font = '24px Orbitron, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(axis + '-VIEW', w - 16, h - 12);

      var scanY = (t * 0.5) % h;
      ctx.fillStyle = 'rgba(0,180,255,0.06)';
      ctx.fillRect(0, scanY - 2, w, 4);
    }

    function animate() {
      time += 1;
      canvases.forEach(function (c) {
        drawCamera(c.ctx, c.canvas.width, c.canvas.height, c.axis, time);
      });
      animFrame = requestAnimationFrame(animate);
    }

    function onClampAssemblyClick(side, e) {
      e.stopPropagation();
      selectClamp(side);
      toggleClampLid(side);
    }

    function bindUi() {
      root.addEventListener('click', function (e) {
        var t = e.target;
        if (t.closest('.fsm-power-btn')) {
          e.stopPropagation();
          togglePower();
          return;
        }
        if (t.closest('.fsm-heat-oven-lid') || t.closest('.fsm-heat-oven-lid-btn')) {
          e.stopPropagation();
          toggleOvenLid();
          return;
        }
        if (t.closest('.fsm-clamp-assembly-l')) {
          onClampAssemblyClick('L', e);
          return;
        }
        if (t.closest('.fsm-clamp-assembly-r')) {
          onClampAssemblyClick('R', e);
          return;
        }
        if (t.closest('.fsm-dpad-up')) {
          e.stopPropagation();
          dpadPress('UP');
          return;
        }
        if (t.closest('.fsm-dpad-down')) {
          e.stopPropagation();
          dpadPress('DOWN');
          return;
        }
        if (t.closest('.fsm-dpad-left')) {
          e.stopPropagation();
          dpadPress('LEFT');
          return;
        }
        if (t.closest('.fsm-dpad-right')) {
          e.stopPropagation();
          dpadPress('RIGHT');
          return;
        }
        if (t.closest('.fsm-dpad-center')) {
          e.stopPropagation();
          dpadPress('OK');
          return;
        }
        if (t.closest('.fsm-x-btn')) {
          e.stopPropagation();
          xPress();
          return;
        }
        if (t.closest('.fsm-o-btn')) {
          e.stopPropagation();
          oPress();
          return;
        }
        if (t.closest('.fsm-heat-btn')) {
          e.stopPropagation();
          heatPress();
          return;
        }
        if (t.closest('.fsm-alm-btn')) {
          e.stopPropagation();
          almPress();
          return;
        }
        if (t.closest('.fsm-and-btn')) {
          e.stopPropagation();
          andPress();
          return;
        }
        if (t.closest('.fsm-reset-btn')) {
          e.stopPropagation();
          resetPress();
          return;
        }
        if (t.closest('.fsm-set-btn')) {
          e.stopPropagation();
          setPress();
        }
      });
    }

    function setActive(active) {
      state.active = !!active;
      if (!state.active) {
        try {
          if (document.activeElement && root.contains(document.activeElement)) {
            document.activeElement.blur();
          }
        } catch (err) {
          /* ignore */
        }
      }
    }

    var keyHandler = function (e) {
      if (!state.active) return;
      var key = e.key;
      if (key === 'ArrowUp') {
        e.preventDefault();
        dpadPress('UP');
      }
      if (key === 'ArrowDown') {
        e.preventDefault();
        dpadPress('DOWN');
      }
      if (key === 'ArrowLeft') {
        e.preventDefault();
        dpadPress('LEFT');
      }
      if (key === 'ArrowRight') {
        e.preventDefault();
        dpadPress('RIGHT');
      }
      if (key === 'Enter') {
        e.preventDefault();
        dpadPress('OK');
      }
      if (key === 'Tab') {
        e.preventDefault();
        selectClamp(state.selectedClamp === 'L' ? 'R' : 'L');
      }
      if (key === 'o' || key === 'O') {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          toggleOvenLid();
        }
      }
    };

    var resizeHandler = function () {
      canvases.length = 0;
      if (animFrame) cancelAnimationFrame(animFrame);
      var cx = initCanvas('fsm-canvas-x', 'X');
      var cy = initCanvas('fsm-canvas-y', 'Y');
      if (cx) canvases.push(cx);
      if (cy) canvases.push(cy);
      animate();
    };

    bindUi();
    document.addEventListener('keydown', keyHandler);
    window.addEventListener('resize', resizeHandler);

    selectClamp('L');
    clearAllFibers();
    setOvenLidOpen(false);
    var xVal = q('xVal');
    var yVal = q('yVal');
    var lossEst = q('lossEst');
    var statusText = q('statusText');
    if (xVal) xVal.textContent = '0.000';
    if (yVal) yVal.textContent = '0.000';
    if (lossEst) lossEst.textContent = 'EST.LOSS: —';
    if (statusText) statusText.textContent = 'READY';
    resizeHandler();
    emit('ready', { empty: true });

    var onResetMotorComplete = function (ev) {
      var d = ev.detail;
      if (!d || d.machineId !== boundMachineId) return;
      finishSystemReset();
    };
    document.addEventListener('fusion-splicer:resetMotorComplete', onResetMotorComplete);

    var api = {
      getState: function () {
        return JSON.parse(JSON.stringify(state));
      },
      on: on,
      showToast: showToast,
      togglePower: togglePower,
      selectClamp: selectClamp,
      toggleClampLid: toggleClampLid,
      toggleOvenLid: toggleOvenLid,
      setOvenLidOpen: setOvenLidOpen,
      dpadPress: dpadPress,
      nudgeSelectedClamp: nudgeSelectedClamp,
      setFiberPlaced: setFiberPlaced,
      clearAllFibers: clearAllFibers,
      placeFiber: function (side) {
        setFiberPlaced(side, true);
      },
      removeFiber: function (side) {
        setFiberPlaced(side, false);
      },
      heatPress: heatPress,
      almPress: almPress,
      andPress: andPress,
      resetPress: resetPress,
      setPress: setPress,
      finishAligning: finishAligning,
      runArcSpliceSequence: runArcSpliceSequence,
      xPress: xPress,
      oPress: oPress,
      setActive: setActive,
      root: root,
    };

    instances[root] = {
      api: api,
      animFrame: animFrame,
      toastTimer: toastTimer,
      heatInterval: state.heatInterval,
      keyHandler: keyHandler,
      resizeHandler: resizeHandler,
      resetMotorCompleteHandler: onResetMotorComplete,
    };

    return api;
  }


  global.FusionSplicerMachineUI = {
    assemblyMarkup: assemblyMarkup,
    mount: mount,
    destroy: destroyInstance,
    syncClampLimitsFromSettings: syncClampLimitsFromSettings,
    getClampForwardLimit: getClampForwardLimit,
    getClampBackwardLimit: getClampBackwardLimit,
    applyClampLimitsMessage: applyClampLimitsMessage,
  };
})(typeof window !== 'undefined' ? window : this);
