/**
 * VIAVI SmartOTDR — modular physical device component.
 * Toolbox drag-drop + chassis markup on #lab-2d-mount; ports expose fixed bounding boxes for magnetic snap.
 */
(function (global) {
  'use strict';

  var TOOL_ID = 'otdr-machine';
  var TOOL_CATEGORY = 'TESTING EQUIPMENT';
  var DEVICE_NAT_W = 400;
  var DEVICE_NAT_H = 462;
  var VIAVI_FIT = 0.5454545455;
  var OLS_PORT_DESIGN_W = 54;
  var OLS_PORT_DESIGN_H = 46;
  var OPM_PORT_DESIGN_W = 48;
  var OPM_PORT_DESIGN_H = 34;
  var PORT_PROTRUDE = Math.round(OLS_PORT_DESIGN_H * VIAVI_FIT);

  /** Scaled snap footprints — match OLS/OLP on canvas (5×7 grid @ --opm-fit). */
  var PORT_WIDTH = Math.round(OLS_PORT_DESIGN_W * VIAVI_FIT);
  var PORT_HEIGHT = Math.round(OLS_PORT_DESIGN_H * VIAVI_FIT);
  var VFL_PORT_WIDTH = Math.round(OPM_PORT_DESIGN_W * VIAVI_FIT);
  var VFL_PORT_HEIGHT = Math.round(OPM_PORT_DESIGN_H * VIAVI_FIT);

  /** Exact inner DOM cloned from ftth-lab-opm.js SC adapter (OLP-38). */
  var OLP_PORT_INNER =
    '<span class="viavi__adapter-base" aria-hidden="true"></span>' +
    '<span class="viavi__adapter-knurl" aria-hidden="true"></span>' +
    '<span class="viavi__adapter-bore" aria-hidden="true"></span>';

  /** Exact inner DOM cloned from ftth-lab-ols.js metallic SC adapter. */
  var OLS_PORT_INNER =
    '<span class="lab-ols__well" aria-hidden="true"></span>' +
    '<span class="lab-ols__sc" aria-hidden="true">' +
    '<span class="lab-ols__sc-block">' +
    '<span class="lab-ols__sc-crown">' +
    '<span class="lab-ols__adapter-slot lab-ols__adapter-knurl" data-ols-dock-slot="1"></span>' +
    '</span>' +
    '<span class="lab-ols__sc-face"></span>' +
    '<span class="lab-ols__sc-side"></span>' +
    '<span class="lab-ols__sc-notch"></span>' +
    '</span>' +
    '<span class="lab-ols__sc-flange">' +
    '<span class="lab-ols__sc-step"></span>' +
    '<span class="lab-ols__sc-plate">' +
    '<i class="lab-ols__sc-screw lab-ols__sc-screw--l"></i>' +
    '<i class="lab-ols__sc-screw lab-ols__sc-screw--r"></i>' +
    '</span>' +
    '</span>' +
    '</span>';

  function buildOlsStylePortMarkup(id, portType, label) {
    return (
      '<div class="protruding-port protruding-port--optical protruding-port--' + portType + ' device-port"' +
      ' id="' + id + '" data-port-type="' + portType + '" data-port-id="' + id + '"' +
      ' style="width:' + PORT_WIDTH + 'px;height:' + PORT_HEIGHT + 'px"' +
      ' role="button" tabindex="0" aria-label="' + label + ' port">' +
      '<div class="viavi__port lab-ols-port lab-ols-port--metal lab-otdr-port" data-ols-port="' + id + '"' +
      ' data-otdr-port="' + id + '" data-ols-connector="SC" title="SC metallic adapter · ' + label + '">' +
      OLS_PORT_INNER +
      '</div></div>'
    );
  }

  function buildVflPortMarkup(id) {
    return (
      '<div class="protruding-port protruding-port--vfl protruding-port--opm device-port"' +
      ' id="' + id + '" data-port-type="vfl" data-port-id="' + id + '"' +
      ' data-polish-universal="true"' +
      ' style="width:' + VFL_PORT_WIDTH + 'px;height:' + VFL_PORT_HEIGHT + 'px"' +
      ' role="button" tabindex="0" aria-label="VFL port">' +
      '<div class="viavi__port lab-opm-port lab-otdr-port" data-opm-port="' + id + '"' +
      ' data-otdr-port="' + id + '" data-opm-connector="SC" data-polish-universal="true"' +
      ' title="SC optical adapter · VFL (universal PC/APC)">' +
      OLP_PORT_INNER +
      '</div></div>'
    );
  }

  function buildProtrudingPortsMarkup(deviceId) {
    return (
      '<div class="otdr-protruding-ports" aria-label="Protruding test ports (north-facing)">' +
      buildVflPortMarkup(deviceId + '-port-vfl') +
      buildOlsStylePortMarkup(deviceId + '-port-apc', 'apc', 'APC') +
      buildOlsStylePortMarkup(deviceId + '-port-apc-live', 'apc-live', 'APC LIVE') +
      '</div>'
    );
  }

  var devices = [];
  var seq = 0;
  var selectedTool = null;
  var dragLib = null;

  var SCREEN_APPS = [
    { label: 'EXPLORER', icon: '📁' },
    { label: 'Settings', icon: '⚙', selected: true },
    { label: 'CONNECTIVITY', icon: '📶' },
    { label: 'SmartAccess', icon: '🔑' },
    { label: 'STRATASYNC', icon: '☁' },
    { label: 'ADD OPTIONS', icon: '+' },
  ];

  var TOOLBOX_ICON_SVG =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">' +
    '<rect x="3" y="3" width="18" height="18" rx="2" ry="2" stroke="currentColor" fill="none" stroke-width="2"/>' +
    '<path d="M3 15h4l3-6 4 10 3-4h4" stroke="currentColor" fill="none" stroke-width="2" stroke-linejoin="round"/>' +
    '</svg>';

  function setStatus(msg) {
    if (global.FtthLab && typeof FtthLab.setStatus === 'function') {
      FtthLab.setStatus(msg);
    }
  }

  function clientToWorld(clientX, clientY) {
    if (global.FtthLab && typeof FtthLab.clientToWorld2d === 'function') {
      return FtthLab.clientToWorld2d(clientX, clientY);
    }
    return { x: 0, y: 0 };
  }

  function isOtdrLabPage() {
    return !!(document.body && document.body.classList.contains('otdr-lab-page'));
  }

  function buildScreenAppsMarkup() {
    return SCREEN_APPS.map(function (app) {
      return (
        '<div class="otdr-screen__app' + (app.selected ? ' is-selected' : '') + '">' +
        '<span class="otdr-screen__app-icon" aria-hidden="true">' + app.icon + '</span>' +
        '<span class="otdr-screen__app-label">' + app.label + '</span>' +
        '</div>'
      );
    }).join('');
  }

  function buildPortLabelsMarkup() {
    return (
      '<div class="otdr-port-labels">' +
      '<span class="label-vfl">' +
      '<span class="label-vfl__warn" aria-hidden="true">⚠</span>' +
      '<span class="label-vfl__text">VFL</span>' +
      '</span>' +
      '<span class="label-apc">APC</span>' +
      '<span class="label-live">APC LIVE</span>' +
      '</div>'
    );
  }

  function buildDeviceMarkup(deviceId) {
    return (
      '<div class="lab-otdr-device" id="' + deviceId + '" data-otdr-device="1"' +
      ' data-otdr-id="' + deviceId + '" role="img" aria-label="VIAVI SmartOTDR">' +
      buildProtrudingPortsMarkup(deviceId) +
      '<div class="otdr-device-shell">' +
      '<div class="otdr-body">' +
      buildPortLabelsMarkup() +
      '<div class="otdr-brand-bar">' +
      '<span class="otdr-viavi-logo" aria-label="VIAVI">VIAVI</span>' +
      '<span class="otdr-model-name">SmartOTDR</span>' +
      '</div>' +
      '<div class="otdr-screen" id="' + deviceId + '-display" role="region" aria-label="SmartOTDR touchscreen">' +
      '<div class="otdr-screen__status-bar">' +
      '<span class="otdr-screen__status-icons">' +
      '<svg class="otdr-screen__home-icon" viewBox="0 0 16 16" aria-hidden="true">' +
      '<path fill="currentColor" d="M8 2L2 7.5V14h4v-4h4v4h4V7.5L8 2z"/>' +
      '</svg>' +
      '<span aria-hidden="true">📶 🔋</span>' +
      '</span>' +
      '<span class="otdr-screen__clock">14:57 20/11/2021</span>' +
      '</div>' +
      '<div class="otdr-screen__grid">' + buildScreenAppsMarkup() + '</div>' +
      '</div>' +
      '<div class="otdr-controls" aria-label="Physical controls">' +
      '<div class="otdr-controls__row">' +
      '<div class="otdr-led-group" aria-label="Power indicators">' +
      '<span class="otdr-led"><span class="otdr-led__dot"></span>Charge</span>' +
      '<span class="otdr-led is-on"><span class="otdr-led__dot"></span>On</span>' +
      '</div>' +
      '<div class="otdr-btn-grid">' +
      '<button type="button" class="otdr-btn" data-otdr-btn="file">FILE</button>' +
      '<button type="button" class="otdr-btn" data-otdr-btn="setup">SETUP</button>' +
      '<button type="button" class="otdr-btn" data-otdr-btn="home">HOME</button>' +
      '<button type="button" class="otdr-btn" data-otdr-btn="cancel">CANCEL</button>' +
      '</div>' +
      '<nav class="otdr-dpad" aria-label="Navigation pad">' +
      '<div class="otdr-dpad__ring" aria-hidden="true"></div>' +
      '<button type="button" class="otdr-dpad__btn otdr-dpad__btn--up" data-otdr-dpad="up" aria-label="Up">▲</button>' +
      '<button type="button" class="otdr-dpad__btn otdr-dpad__btn--down" data-otdr-dpad="down" aria-label="Down">▼</button>' +
      '<button type="button" class="otdr-dpad__btn otdr-dpad__btn--left" data-otdr-dpad="left" aria-label="Left">◀</button>' +
      '<button type="button" class="otdr-dpad__btn otdr-dpad__btn--right" data-otdr-dpad="right" aria-label="Right">▶</button>' +
      '<button type="button" class="otdr-dpad__center" data-otdr-dpad="select" aria-label="Select"></button>' +
      '</nav>' +
      '<div class="otdr-controls__right">' +
      '<span class="otdr-led"><span class="otdr-led__dot"></span>Testing</span>' +
      '<button type="button" class="otdr-btn otdr-btn--start" data-otdr-btn="start-stop">START/STOP</button>' +
      '<button type="button" class="otdr-btn otdr-btn--results" data-otdr-btn="results">RESULTS</button>' +
      '<div class="otdr-power-section">' +
      '<button type="button" class="otdr-power-btn" data-otdr-btn="power" aria-label="Power on off">ON<br>OFF</button>' +
      '<span class="otdr-speaker" aria-hidden="true"></span>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  function ensureLayer() {
    var mount = document.getElementById('lab-2d-mount');
    if (!mount) return null;
    var layer = mount.querySelector('.lab-otdr-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'lab-otdr-layer';
      layer.setAttribute('data-lab-otdr-layer', '1');
      mount.appendChild(layer);
    }
    return layer;
  }

  function rebuildLayer() {
    var layer = ensureLayer();
    if (!layer) return;
    layer.innerHTML = '';
    devices.forEach(function (d) {
      var wrapper = document.createElement('div');
      wrapper.innerHTML = buildDeviceMarkup(d.id);
      var el = wrapper.firstElementChild;
      if (!el) return;
      el.style.left = d.x + 'px';
      el.style.top = d.y + 'px';
      layer.appendChild(el);
    });
  }

  function placeOTDR(x, y) {
    seq += 1;
    var device = {
      id: 'otdr-machine-' + seq,
      x: Math.round(x - DEVICE_NAT_W / 2),
      y: Math.round(y - DEVICE_NAT_H / 2),
    };
    devices.push(device);
    rebuildLayer();
    setStatus('SmartOTDR placed · APC / APC LIVE ports ready');
    return device;
  }

  function renderToolbox() {
    var host = document.getElementById('lab-otdr-tree');
    if (!host) return;
    host.innerHTML =
      '<div class="lab-toolbox" role="list">' +
      '<button type="button" class="lab-tool lab-tool--otdr' +
      (selectedTool === TOOL_ID ? ' is-selected' : '') +
      '" draggable="true" data-lab-tool="' + TOOL_ID + '" data-tool-type="' + TOOL_ID +
      '" data-lab-category="' + TOOL_CATEGORY + '" role="listitem">' +
      '<span class="lab-tool__mark lab-tool__mark--otdr" aria-hidden="true">' + TOOLBOX_ICON_SVG + '</span>' +
      '<span class="lab-tool__copy">' +
      '<strong>VIAVI SmartOTDR</strong>' +
      '<span>Drag onto workspace</span>' +
      '</span>' +
      '</button>' +
      '</div>';
    bindToolbox(host);
  }

  function bindToolbox(host) {
    var btn = host.querySelector('[data-tool-type="' + TOOL_ID + '"]');
    if (!btn) return;

    btn.addEventListener('click', function () {
      if (global.FtthLab && typeof FtthLab.armDragOnlyToolboxTool === 'function') {
        FtthLab.armDragOnlyToolboxTool(TOOL_ID, 'SmartOTDR · drag onto workspace to place');
      } else if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool(TOOL_ID);
      }
      selectedTool = TOOL_ID;
      renderToolbox();
      setStatus('SmartOTDR · drag onto workspace');
    });

    btn.addEventListener('dragstart', function (ev) {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool(TOOL_ID);
      }
      selectedTool = TOOL_ID;
      dragLib = { kind: TOOL_ID };
      if (global.FtthLab && FtthLab.beginDrag) {
        FtthLab.beginDrag({ kind: TOOL_ID });
      }
      try {
        ev.dataTransfer.setData('text/plain', 'lab:' + TOOL_ID);
        ev.dataTransfer.setData('text/lab-drag', TOOL_ID);
        ev.dataTransfer.effectAllowed = 'copy';
      } catch (err) { /* ignore */ }
      btn.classList.add('is-dragging', 'is-selected');
    });

    btn.addEventListener('dragend', function () {
      dragLib = null;
      if (global.FtthLab && FtthLab.endDrag) FtthLab.endDrag();
      if (global.FtthLab && FtthLab.clearStageDropHighlight) FtthLab.clearStageDropHighlight();
      btn.classList.remove('is-dragging');
      renderToolbox();
    });
  }

  function isStagePlacementTarget(target) {
    if (!target) return false;
    return target.id === 'lab-canvas-2d' ||
      target.id === 'lab-2d-mount' ||
      target.id === 'lab-2d-world';
  }

  function bindStageDrop() {
    var stage = document.getElementById('lab-canvas-2d');
    var mount = document.getElementById('lab-2d-mount');
    var world = document.getElementById('lab-2d-world');
    [stage, mount, world].forEach(function (el) {
      if (!el || el.dataset.otdrDropBound === '1') return;
      el.dataset.otdrDropBound = '1';

      el.addEventListener('dragover', function (ev) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        if (!((dragLib && dragLib.kind === TOOL_ID) || (active && active.kind === TOOL_ID))) {
          return;
        }
        ev.preventDefault();
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
      });

      el.addEventListener('drop', function (ev) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        var kind =
          (ev.dataTransfer && ev.dataTransfer.getData('text/lab-drag')) ||
          (active && active.kind) ||
          (dragLib && dragLib.kind) ||
          '';
        if (kind !== TOOL_ID) return;
        ev.preventDefault();
        ev.stopPropagation();
        dragLib = null;
        if (global.FtthLab && FtthLab.endDrag) FtthLab.endDrag();
        var pt = clientToWorld(ev.clientX, ev.clientY);
        placeOTDR(pt.x, pt.y);
        selectedTool = null;
        renderToolbox();
      });

      el.addEventListener('click', function (ev) {
        if (selectedTool !== TOOL_ID) return;
        var active = global.FtthLab && FtthLab.getActiveToolboxTool && FtthLab.getActiveToolboxTool();
        if (active !== TOOL_ID) return;
        if (!isStagePlacementTarget(ev.target)) return;
        ev.stopPropagation();
        var pt = clientToWorld(ev.clientX, ev.clientY);
        placeOTDR(pt.x, pt.y);
        selectedTool = null;
        renderToolbox();
      }, true);
    });
  }

  function onToolboxClaim(payload) {
    var id = payload && payload.toolId;
    if (id === TOOL_ID) return;
    selectedTool = null;
    renderToolbox();
  }

  function clearSelection() {
    selectedTool = null;
    renderToolbox();
  }

  function mount() {
    if (!isOtdrLabPage()) return;
    renderToolbox();
    bindStageDrop();
    ensureLayer();
    rebuildLayer();
  }

  /**
   * @param {{ mount?: HTMLElement, left?: number, top?: number }} [options]
   * @returns {HTMLElement|null}
   */
  function initOTDRMachine(options) {
    options = options || {};
    var x = typeof options.left === 'number' ? options.left + DEVICE_NAT_W / 2 : 320;
    var y = typeof options.top === 'number' ? options.top + DEVICE_NAT_H / 2 : 300;
    var device = placeOTDR(x, y);
    if (options.mount) {
      var el = document.getElementById(device.id);
      if (el && options.mount !== document.getElementById('lab-2d-mount')) {
        options.mount.appendChild(el);
      }
    }
    return document.getElementById(device.id);
  }

  var tool = {
    id: TOOL_ID,
    category: TOOL_CATEGORY,
    mount: mount,
    clearSelection: clearSelection,
    onToolboxClaim: onToolboxClaim,
    placeOTDR: placeOTDR,
    exportProjectState: function () {
      return JSON.parse(JSON.stringify({ devices: devices, seq: seq }));
    },
    importProjectState: function (snap) {
      devices = (snap && snap.devices) ? JSON.parse(JSON.stringify(snap.devices)) : [];
      seq = (snap && snap.seq) || 0;
      rebuildLayer();
    },
    resetProjectState: function () {
      devices = [];
      seq = 0;
      rebuildLayer();
    },
  };

  function tryRegister() {
    if (!isOtdrLabPage()) return false;
    if (global.FtthLab && typeof FtthLab.registerTool === 'function') {
      FtthLab.registerTool(TOOL_ID, tool);
      return true;
    }
    return false;
  }

  global.OTDRDevice = {
    init: initOTDRMachine,
    place: placeOTDR,
    VIAVI_FIT: VIAVI_FIT,
    PORT_WIDTH: PORT_WIDTH,
    PORT_HEIGHT: PORT_HEIGHT,
    PORT_PROTRUDE: PORT_PROTRUDE,
    TOOL_ID: TOOL_ID,
  };
  global.initOTDRMachine = initOTDRMachine;

  if (!tryRegister()) {
    document.addEventListener('DOMContentLoaded', function () {
      if (!tryRegister()) {
        var n = 0;
        var t = setInterval(function () {
          if (tryRegister() || ++n > 40) clearInterval(t);
        }, 50);
      }
    });
  }
})(typeof window !== 'undefined' ? window : this);
