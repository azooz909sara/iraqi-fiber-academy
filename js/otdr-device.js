/**
 * VIAVI SmartOTDR — modular physical device component.
 * Toolbox drag-drop + chassis markup on #lab-2d-mount; ports expose fixed bounding boxes for magnetic snap.
 */
(function (global) {
  'use strict';

  var TOOL_ID = 'otdr-machine';
  var TOOL_CATEGORY = 'TESTING EQUIPMENT';
  var DEVICE_NAT_W = 400;
  var DEVICE_NAT_H = 500;
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
  var layer = null;
  var selection = { kind: 'none', id: null };
  var history = [];
  var historyIndex = -1;
  var HISTORY_MAX = 48;
  var historyLocked = false;
  var CONNECTION_BOX_COUNT = 8;
  var CONNECTION_STEP_MS = 1500;
  var CONNECTION_GREEN_FROM = 3;
  var CONNECTION_VALIDATION_DELAY_MS = 5000;
  var ACQUISITION_DURATION_MS = 20000;
  var connectionAnimTimers = {};
  var connectionValidationTimers = {};
  var acquisitionTimers = {};

  function resolveFiberAttachment(record) {
    if (!record) return null;
    if (record.attached && (record.attached.olsId || record.attached.opmId || record.attached.vflId)) {
      return record.attached;
    }
    if (record.olsId || record.opmId || record.vflId) return record;
    return null;
  }

  function attachmentMatchesPort(att, portId) {
    if (!att || !portId) return false;
    return att.olsId === portId || att.opmId === portId || att.vflId === portId;
  }

  function closestEl(node, selector) {
    return node && node.closest ? node.closest(selector) : null;
  }

  function claimSelection() {
    if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
      FtthLab.setSelectionOwner(TOOL_ID);
    }
  }

  function findDevice(id) {
    for (var i = 0; i < devices.length; i++) {
      if (devices[i].id === id) return devices[i];
    }
    return null;
  }

  function getZoom() {
    if (global.FtthLab && typeof FtthLab.getZoom2d === 'function') {
      return FtthLab.getZoom2d() || 1;
    }
    return 1;
  }

  function getWorldSize() {
    if (global.FtthLab && typeof FtthLab.getWorldSize2d === 'function') {
      return FtthLab.getWorldSize2d();
    }
    return 4096;
  }

  function defaultPos() {
    var c = (global.FtthLab && typeof FtthLab.getViewportCenterWorld === 'function')
      ? FtthLab.getViewportCenterWorld()
      : { x: getWorldSize() / 2, y: getWorldSize() / 2 };
    var n = devices.length;
    return {
      x: Math.round(c.x - DEVICE_NAT_W / 2 + (n % 3) * 28),
      y: Math.round(c.y - DEVICE_NAT_H / 2 + Math.floor(n / 3) * 24),
    };
  }

  function captureSnapshot() {
    return JSON.parse(JSON.stringify({ devices: devices, seq: seq, selection: selection }));
  }

  function applySnapshot(snap) {
    devices = (snap && snap.devices) ? JSON.parse(JSON.stringify(snap.devices)) : [];
    seq = (snap && snap.seq) || 0;
    selection = (snap && snap.selection) ? JSON.parse(JSON.stringify(snap.selection)) : { kind: 'none', id: null };
    rebuildLayer();
    updateInspector();
  }

  function pushHistory() {
    if (historyLocked) return;
    history = history.slice(0, historyIndex + 1);
    history.push(captureSnapshot());
    if (history.length > HISTORY_MAX) history.shift();
    historyIndex = history.length - 1;
    if (historyIndex > 0 && global.FtthLab && typeof FtthLab.recordHistory === 'function') {
      FtthLab.recordHistory(TOOL_ID);
    }
  }

  function isOtdrControlTarget(e) {
    return !!closestEl(
      e.target,
      '.otdr-btn, .otdr-dpad__btn, .otdr-dpad__center, .otdr-power-btn, .app-btn, .otdr-screen, .otdr-os-home, .otdr-smart-test-app, .otdr-smart-test-setup, .otdr-smart-test-running, .st-list-item, .st-btn, .sts-opt, .sts-action-btn, .sidebar-btn, .running-tabs-header .tab, .otdr-error-popup'
    );
  }

  function isOtdrPortTarget(e) {
    return !!closestEl(
      e.target,
      '.lab-otdr-port, .lab-ols-port, .lab-opm-port, .protruding-port, .device-port, .otdr-protruding-ports'
    );
  }

  function fiberGraph() {
    return (global.FtthLab && typeof FtthLab.getFiberLaserGraph === 'function')
      ? FtthLab.getFiberLaserGraph()
      : { pcords: [], pigtails: [] };
  }

  function isPortOccupied(portId) {
    if (!portId) return false;
    var graph = fiberGraph();
    var i;
    var pcords = graph.pcords || [];
    for (i = 0; i < pcords.length; i++) {
      var c = pcords[i];
      var sides = [c.sideA, c.sideB];
      for (var s = 0; s < sides.length; s++) {
        if (attachmentMatchesPort(resolveFiberAttachment(sides[s]), portId)) return true;
      }
    }
    var pigtails = graph.pigtails || [];
    for (i = 0; i < pigtails.length; i++) {
      if (attachmentMatchesPort(resolveFiberAttachment(pigtails[i].connector), portId)) return true;
    }
    return false;
  }

  function isApcPortConnected(deviceId) {
    var portId = deviceId + '-port-apc';
    if (isPortOccupied(portId)) return true;
    if (!layer) return false;
    var node = layer.querySelector('[data-otdr-node="' + deviceId + '"]');
    if (!node) return false;
    refreshPortOccupancy(node);
    var port = node.querySelector('[data-ols-port="' + portId + '"], [data-otdr-port="' + portId + '"]');
    if (port && port.classList.contains('is-occupied')) return true;
    var wrap = node.querySelector('[data-port-id="' + portId + '"]');
    if (wrap && wrap.classList.contains('is-occupied')) return true;
    return false;
  }

  function refreshPortOccupancy(root) {
    if (!root) return;
    root.querySelectorAll('.lab-otdr-port').forEach(function (port) {
      var id = port.getAttribute('data-ols-port') || port.getAttribute('data-opm-port');
      var occupied = isPortOccupied(id);
      port.classList.toggle('is-occupied', occupied);
      var wrap = port.closest('.protruding-port');
      if (wrap) wrap.classList.toggle('is-occupied', occupied);
    });
  }

  function updateInspector() {
    var card = document.getElementById('lab-inspector-card');
    var detail = document.getElementById('lab-inspector-detail');
    if (!card) return;
    if (selection.kind !== 'otdr' || !selection.id) {
      if (card.dataset.otdrInspector === '1') {
        card.dataset.otdrInspector = '';
        if (global.FtthLab && typeof FtthLab.resetInspectorIdle === 'function') {
          FtthLab.resetInspectorIdle();
        }
      }
      return;
    }
    var d = findDevice(selection.id);
    if (!d) return;
    card.dataset.otdrInspector = '1';
    card.hidden = false;
    card.innerHTML =
      '<h2>VIAVI SmartOTDR</h2>' +
      '<p>Position <strong>(' + d.x + ', ' + d.y + ')</strong> · VFL + APC + APC LIVE ports</p>' +
      '<p class="lab-inspector__hint">Drag chassis to move · Del to remove · plug SC pigtails into north ports</p>';
    if (detail) detail.hidden = true;
  }

  function selectOtdr(id, opts) {
    opts = opts || {};
    selection = { kind: 'otdr', id: id };
    claimSelection();
    renderToolbox();
    if (opts.skipRebuild) {
      if (layer) {
        layer.querySelectorAll('[data-otdr-node]').forEach(function (n) {
          n.classList.toggle('is-selected', n.getAttribute('data-otdr-node') === id);
        });
      }
    } else {
      rebuildLayer();
    }
    updateInspector();
  }

  function removeOtdr(id) {
    stopConnectionAnimation(id);
    stopAcquisitionProgress(id);
    stopConnectionValidationTimer(id);
    devices = devices.filter(function (d) { return d.id !== id; });
    if (selection.id === id) selection = { kind: 'none', id: null };
    rebuildLayer();
    updateInspector();
    pushHistory();
    setStatus('SmartOTDR removed');
  }

  function buildOsHomeMarkup() {
    return (
      '<div class="otdr-os-home">' +
      '<div class="os-top-bar">' +
      '<div class="bar-left">' +
      '<span class="home-icon" aria-hidden="true">🏠</span> Home' +
      '</div>' +
      '<div class="bar-right">' +
      '<span class="bt-icon" aria-hidden="true">⭐</span>' +
      '<span class="wifi-icon" aria-hidden="true">📶</span>' +
      '<span class="battery-icon" aria-hidden="true">🔋</span>' +
      '<span class="time-date">14:16 07/09/2026</span>' +
      '</div>' +
      '</div>' +
      '<div class="os-app-grid">' +
      '<div class="app-row">' +
      '<div class="app-btn" data-app="explorer" role="button" tabindex="0">' +
      '<div class="app-icon-box"><span class="icon" aria-hidden="true">📁</span></div>' +
      '<div class="app-label">EXPLORER</div></div>' +
      '<div class="app-btn is-selected" data-app="settings" role="button" tabindex="0">' +
      '<div class="app-icon-box"><span class="icon" aria-hidden="true">⚙️</span></div>' +
      '<div class="app-label text-green">Settings</div></div>' +
      '<div class="app-btn" data-app="connectivity" role="button" tabindex="0">' +
      '<div class="app-icon-box"><span class="icon" aria-hidden="true">🔌</span></div>' +
      '<div class="app-label">CONNECTIVITY</div></div>' +
      '<div class="app-btn" data-app="smart-access" role="button" tabindex="0">' +
      '<div class="app-label-box"><span class="icon" aria-hidden="true">📲</span></div>' +
      '<div class="app-label">SmartAccess</div></div>' +
      '<div class="app-btn" data-app="stratasync" role="button" tabindex="0">' +
      '<div class="app-icon-box"><span class="icon" aria-hidden="true">☁️</span></div>' +
      '<div class="app-label">STRATASYNC</div></div>' +
      '<div class="app-btn" data-app="add-options" role="button" tabindex="0">' +
      '<div class="app-icon-box"><span class="icon" aria-hidden="true">➕</span></div>' +
      '<div class="app-label">ADD OPTIONS</div></div>' +
      '</div>' +
      '<div class="app-row vfl-row">' +
      '<div class="app-btn" data-app="vfl" role="button" tabindex="0">' +
      '<div class="app-icon-box"><span class="icon" aria-hidden="true">🪄</span></div>' +
      '<div class="app-label">VFL</div></div>' +
      '</div>' +
      '<div class="app-row">' +
      '<div class="app-btn" data-app="expert-otdr" role="button" tabindex="0">' +
      '<div class="app-icon-box"><span class="icon" aria-hidden="true">📈</span></div>' +
      '<div class="app-label">EXPERT OTDR</div></div>' +
      '<div class="app-btn" data-app="smart-test" role="button" tabindex="0">' +
      '<div class="app-icon-box bg-yellow"><span class="icon" aria-hidden="true">⭐</span></div>' +
      '<div class="app-label">SMART TEST</div></div>' +
      '<div class="app-btn" data-app="ftth-otdr" role="button" tabindex="0">' +
      '<div class="app-icon-box"><span class="icon" aria-hidden="true">🏘️</span></div>' +
      '<div class="app-label">FTTH OTDR</div></div>' +
      '<div class="app-btn" data-app="source" role="button" tabindex="0">' +
      '<div class="app-icon-box"><span class="icon" aria-hidden="true">☀️</span></div>' +
      '<div class="app-label">SOURCE</div></div>' +
      '<div class="app-btn" data-app="powermeter" role="button" tabindex="0">' +
      '<div class="app-icon-box"><span class="icon" aria-hidden="true">📟</span></div>' +
      '<div class="app-label">POWERMETER</div></div>' +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  function buildSmartTestAppMarkup() {
    return (
      '<div class="otdr-smart-test-app" aria-label="SMART TEST configuration">' +
      '<div class="st-top-bar">' +
      '<div class="st-bar-icons">' +
      '<span aria-hidden="true">🪄 🔌 📶 🔋</span>' +
      '<span class="st-time">12:19 10/01/2023</span>' +
      '</div>' +
      '</div>' +
      '<div class="st-title-bar">Please select a user configuration file</div>' +
      '<div class="st-config-list">' +
      '<div class="st-list-item">CERTIFICATION_AutoTest_20s</div>' +
      '<div class="st-list-item">CERTIFICATION_SmartAcq_20s</div>' +
      '<div class="st-list-item selected">EXPRESS_AutoTest_5s</div>' +
      '<div class="st-list-item">JDSU_ShortReach_20km</div>' +
      '</div>' +
      '<div class="st-bottom-bar">' +
      '<div class="st-path">/disk/config/SMART_TEST</div>' +
      '<div class="st-actions">' +
      '<div class="st-btn st-btn-icon" role="button" tabindex="0">' +
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="white" aria-hidden="true">' +
      '<path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>' +
      '<path d="M12 9v4h-2l3 3 3-3h-2V9h-2z" fill="white" transform="rotate(180 12 13)"/>' +
      '</svg></div>' +
      '<div class="st-btn st-btn-text" role="button" tabindex="0">LOAD</div>' +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  function buildSmartTestSetupMarkup(configName) {
    var name = configName || 'CERTIFICATION_AutoTest_20s';
    return (
      '<div class="otdr-smart-test-setup" aria-label="SMART TEST setup">' +
      '<div class="sts-top-bar">' +
      '<div class="sts-bar-icons">' +
      '<span aria-hidden="true">🪄 📶 🔋</span>' +
      '<span class="sts-time">14:28 07/09/2026</span>' +
      '</div>' +
      '</div>' +
      '<div class="sts-settings setup-content">' +
      '<div class="sts-row setup-row" data-sts-row="laser">' +
      '<div class="sts-label setup-label">Laser</div>' +
      '<div class="sts-options setup-options">' +
      '<button type="button" class="sts-opt opt-btn" data-value="1310">1310 nm</button>' +
      '<button type="button" class="sts-opt opt-btn is-active selected" data-value="1550">1550 nm</button>' +
      '<span class="sts-live-note setup-live-note">1625 nm (LIVE)</span>' +
      '</div></div>' +
      '<div class="sts-row setup-row" data-sts-row="distance">' +
      '<div class="sts-label setup-label">Distance Unit</div>' +
      '<div class="sts-options setup-options">' +
      '<button type="button" class="sts-opt opt-btn" data-value="km">km</button>' +
      '<button type="button" class="sts-opt opt-btn" data-value="kfeet">kfeet</button>' +
      '<button type="button" class="sts-opt opt-btn" data-value="miles">miles</button>' +
      '<button type="button" class="sts-opt opt-btn is-active selected" data-value="meter">meter</button>' +
      '<button type="button" class="sts-opt opt-btn" data-value="feet">feet</button>' +
      '</div></div>' +
      '<div class="sts-row setup-row" data-sts-row="launch-cable">' +
      '<div class="sts-label setup-label">Launch Cable</div>' +
      '<div class="sts-options setup-options">' +
      '<button type="button" class="sts-opt opt-btn is-active selected" data-value="no">No</button>' +
      '<button type="button" class="sts-opt opt-btn" data-value="yes">Yes</button>' +
      '</div></div>' +
      '<div class="sts-row setup-row" data-sts-row="alarms">' +
      '<div class="sts-label setup-label">Alarms</div>' +
      '<div class="sts-options setup-options">' +
      '<button type="button" class="sts-opt opt-btn" data-value="no">No</button>' +
      '<button type="button" class="sts-opt opt-btn is-active selected" data-value="yes">Yes</button>' +
      '<button type="button" class="sts-opt opt-btn sts-opt--default setup-default-btn" data-sts-action="default">' +
      'Default<span class="sts-gear" aria-hidden="true">⚙️</span></button>' +
      '</div></div>' +
      '</div>' +
      '<div class="sts-bottom-bar">' +
      '<div class="sts-config-name">' + name + '</div>' +
      '<div class="sts-actions">' +
      '<button type="button" class="sts-action-btn" data-sts-action="configs">' +
      '<span class="sts-action-label">Configs.</span>' +
      '<span class="sts-action-icon" aria-hidden="true">📁</span></button>' +
      '<button type="button" class="sts-action-btn" data-sts-action="start-test">' +
      '<span class="sts-action-stack">START<br>TEST</span></button>' +
      '<button type="button" class="sts-action-btn" data-sts-action="real-time">' +
      '<span class="sts-action-stack">REAL<br>TIME</span></button>' +
      '<button type="button" class="sts-action-btn sts-action-btn--disabled" disabled data-sts-action="results">' +
      '<span class="sts-action-label">Results</span>' +
      '<span class="sts-action-icon" aria-hidden="true">📈</span></button>' +
      '</div></div>' +
      '</div>'
    );
  }

  function buildConnBoxesMarkup() {
    var html = '';
    var i;
    for (i = 0; i < CONNECTION_BOX_COUNT; i++) {
      html += '<div class="conn-box"></div>';
    }
    return html;
  }

  function buildSmartTestRunningMarkup() {
    return (
      '<div class="otdr-smart-test-running" aria-label="SMART TEST running">' +
      '<div class="str-top-bar">' +
      '<div class="str-bar-icons">' +
      '<span aria-hidden="true">🪄 📶 🔋</span>' +
      '<span class="str-time">14:46 07/09/2026</span>' +
      '</div></div>' +
      '<div class="running-workspace">' +
      '<div class="running-main-content">' +
      '<div class="running-tabs-header">' +
      '<div class="tabs-left">' +
      '<span class="tab active" role="button" tabindex="0">SmartLink</span>' +
      '<span class="tab" role="button" tabindex="0">Trace</span>' +
      '<span class="tab" role="button" tabindex="0">Table</span>' +
      '</div>' +
      '<div class="tabs-right">' +
      '<span class="event-line-text">Event line</span>' +
      '<div class="toggle-switch active" role="switch" aria-checked="true">' +
      '<div class="toggle-circle"></div></div>' +
      '<span class="info-text">Info</span>' +
      '</div></div>' +
      '<div class="running-viewport">' +
      '<div class="viewport-top"></div>' +
      '<div class="viewport-bottom">' +
      '<div class="connection-indicator">' +
      '<div class="conn-title">Connection</div>' +
      '<div class="conn-bar-container">' +
      '<span class="conn-label">Bad</span>' +
      '<div class="conn-boxes">' + buildConnBoxesMarkup() + '</div>' +
      '<span class="conn-label">Good</span>' +
      '</div></div>' +
      '<div class="acquisition-indicator" hidden>' +
      '<div class="acq-panel">' +
      '<div class="acq-title">Acquisition in progress ...</div>' +
      '<div class="acq-progress-row">' +
      '<span class="acq-timer acq-timer-left">00:00</span>' +
      '<div class="acq-progress-track">' +
      '<div class="acq-progress-fill">' +
      '<span class="acq-progress-pct">0%</span>' +
      '</div></div>' +
      '<span class="acq-timer acq-timer-right">00:20</span>' +
      '</div></div></div></div></div></div>' +
      '<div class="running-sidebar">' +
      '<div class="sidebar-btn btn-stop" data-sts-action="stop-test" role="button" tabindex="0">' +
      '<span class="btn-text">STOP</span>' +
      '<span class="red-square" aria-hidden="true"></span></div>' +
      '<div class="sidebar-btn empty"></div>' +
      '<div class="sidebar-btn">' +
      '<span class="btn-text">File<br>Explorer</span>' +
      '<span class="icon" aria-hidden="true">📁</span></div>' +
      '<div class="sidebar-btn empty"></div>' +
      '<div class="sidebar-btn empty"></div>' +
      '<div class="sidebar-btn empty"></div>' +
      '</div></div>' +
      '<div class="otdr-error-popup" hidden role="alertdialog" aria-labelledby="otdr-error-title">' +
      '<div class="otdr-error-modal">' +
      '<div class="otdr-error-body">' +
      '<span class="otdr-error-icon" aria-hidden="true">⚠️</span>' +
      '<div class="otdr-error-text">' +
      '<div class="otdr-error-code">FO-1128</div>' +
      '<div class="otdr-error-title" id="otdr-error-title">Connection to test instrument is bad</div>' +
      '<div class="otdr-error-desc">Check that the fiber is connected to the right test port first then inspect test port and patchcord fiber ends</div>' +
      '</div></div>' +
      '<div class="otdr-error-footer">Touch the popup window to close it</div>' +
      '</div></div></div>'
    );
  }

  function resetConnectionBoxes(container) {
    if (!container) return;
    container.querySelectorAll('.conn-box').forEach(function (box) {
      box.classList.remove('bg-orange', 'bg-green', 'bg-red');
    });
  }

  function showConnectionBadState(deviceNode) {
    var boxesContainer = deviceNode && deviceNode.querySelector('.conn-boxes');
    if (!boxesContainer) return;
    resetConnectionBoxes(boxesContainer);
    var boxes = boxesContainer.querySelectorAll('.conn-box');
    if (boxes[0]) boxes[0].classList.add('bg-orange');
  }

  function formatAcqTimer(seconds) {
    var total = Math.max(0, Math.min(20, Math.floor(seconds)));
    var ss = total < 10 ? '0' + total : String(total);
    return '00:' + ss;
  }

  function resetAcquisitionUI(deviceNode) {
    if (!deviceNode) return;
    var fill = deviceNode.querySelector('.acq-progress-fill');
    var pctEl = deviceNode.querySelector('.acq-progress-pct');
    var timerLeft = deviceNode.querySelector('.acq-timer-left');
    if (fill) fill.style.width = '0%';
    if (pctEl) pctEl.textContent = '0%';
    if (timerLeft) timerLeft.textContent = '00:00';
  }

  function resetRunningViewportUI(deviceNode) {
    if (!deviceNode) return;
    var connInd = deviceNode.querySelector('.connection-indicator');
    var acqInd = deviceNode.querySelector('.acquisition-indicator');
    if (connInd) connInd.hidden = false;
    if (acqInd) acqInd.hidden = true;
    resetAcquisitionUI(deviceNode);
  }

  function showConnectionErrorState(deviceId, deviceNode) {
    var d = findDevice(deviceId);
    if (d) {
      d.connectionError = true;
      d.acquisitionActive = false;
    }
    stopConnectionAnimation(deviceId);
    stopConnectionValidationTimer(deviceId);
    stopAcquisitionProgress(deviceId);
    resetRunningViewportUI(deviceNode);
    showConnectionBadState(deviceNode);
    showErrorPopup(deviceNode);
    setStatus('FO-1128 · Connection to test instrument is bad');
  }

  function showAcquisitionPhase(deviceId, deviceNode) {
    var d = findDevice(deviceId);
    if (d) {
      d.connectionError = false;
      d.acquisitionActive = true;
    }
    stopConnectionAnimation(deviceId);
    hideErrorPopup(deviceNode);
    var connInd = deviceNode.querySelector('.connection-indicator');
    var acqInd = deviceNode.querySelector('.acquisition-indicator');
    if (connInd) connInd.hidden = true;
    if (acqInd) acqInd.hidden = false;
    startAcquisitionProgress(deviceId, deviceNode);
    setStatus('SMART TEST · acquisition in progress');
  }

  function finishConnectionValidation(deviceId, deviceNode) {
    if (!deviceNode) return;
    refreshPortOccupancy(deviceNode);
    if (isApcPortConnected(deviceId)) {
      showAcquisitionPhase(deviceId, deviceNode);
    } else {
      showConnectionErrorState(deviceId, deviceNode);
    }
  }

  function stopConnectionValidationTimer(deviceId) {
    if (!connectionValidationTimers[deviceId]) return;
    clearTimeout(connectionValidationTimers[deviceId]);
    delete connectionValidationTimers[deviceId];
  }

  function scheduleConnectionValidation(deviceId, deviceNode) {
    stopConnectionValidationTimer(deviceId);
    connectionValidationTimers[deviceId] = setTimeout(function () {
      delete connectionValidationTimers[deviceId];
      finishConnectionValidation(deviceId, deviceNode);
    }, CONNECTION_VALIDATION_DELAY_MS);
  }

  function stopAcquisitionProgress(deviceId) {
    if (!acquisitionTimers[deviceId]) return;
    clearInterval(acquisitionTimers[deviceId]);
    delete acquisitionTimers[deviceId];
  }

  function startAcquisitionProgress(deviceId, deviceNode) {
    stopAcquisitionProgress(deviceId);
    if (!deviceNode) return;
    var fill = deviceNode.querySelector('.acq-progress-fill');
    var pctEl = deviceNode.querySelector('.acq-progress-pct');
    var timerLeft = deviceNode.querySelector('.acq-timer-left');
    if (!fill) return;
    resetAcquisitionUI(deviceNode);
    var started = Date.now();
    acquisitionTimers[deviceId] = setInterval(function () {
      var elapsed = Date.now() - started;
      var pct = Math.min(100, (elapsed / ACQUISITION_DURATION_MS) * 100);
      var elapsedSec = elapsed / 1000;
      fill.style.width = pct + '%';
      if (pctEl) pctEl.textContent = Math.round(pct) + '%';
      if (timerLeft) timerLeft.textContent = formatAcqTimer(elapsedSec);
      if (pct >= 100) {
        fill.style.width = '100%';
        if (pctEl) pctEl.textContent = '100%';
        if (timerLeft) timerLeft.textContent = '00:20';
        stopAcquisitionProgress(deviceId);
      }
    }, 120);
  }

  function showErrorPopup(deviceNode) {
    var popup = deviceNode && deviceNode.querySelector('.otdr-error-popup');
    if (popup) popup.hidden = false;
  }

  function hideErrorPopup(deviceNode) {
    var popup = deviceNode && deviceNode.querySelector('.otdr-error-popup');
    if (popup) popup.hidden = true;
  }

  function applyRunningConnectionState(deviceId, deviceNode) {
    stopConnectionAnimation(deviceId);
    stopConnectionValidationTimer(deviceId);
    stopAcquisitionProgress(deviceId);
    if (!deviceNode) return;
    var d = findDevice(deviceId);
    hideErrorPopup(deviceNode);
    var boxesContainer = deviceNode.querySelector('.conn-boxes');
    if (boxesContainer) resetConnectionBoxes(boxesContainer);
    if (d && d.connectionError) {
      resetRunningViewportUI(deviceNode);
      showConnectionBadState(deviceNode);
      showErrorPopup(deviceNode);
      return;
    }
    if (d && d.acquisitionActive) {
      showAcquisitionPhase(deviceId, deviceNode);
      return;
    }
    resetRunningViewportUI(deviceNode);
    runConnectionCheckAnimation(deviceId, deviceNode);
  }

  function stopConnectionAnimation(deviceId) {
    if (!connectionAnimTimers[deviceId]) return;
    if (connectionAnimTimers[deviceId].timer) {
      clearInterval(connectionAnimTimers[deviceId].timer);
    }
    delete connectionAnimTimers[deviceId];
    stopConnectionValidationTimer(deviceId);
  }

  function paintConnectionBoxes(boxesContainer, boxes, upToIndex) {
    resetConnectionBoxes(boxesContainer);
    var colorClass = upToIndex >= CONNECTION_GREEN_FROM ? 'bg-green' : 'bg-orange';
    var i;
    for (i = 0; i <= upToIndex; i++) {
      if (boxes[i]) boxes[i].classList.add(colorClass);
    }
  }

  function runConnectionCheckAnimation(deviceId, deviceNode) {
    stopConnectionAnimation(deviceId);
    var root = deviceNode || (layer && layer.querySelector('[data-otdr-node="' + deviceId + '"]'));
    if (!root) return;
    var boxesContainer = root.querySelector('.conn-boxes');
    if (!boxesContainer) return;
    var boxes = boxesContainer.querySelectorAll('.conn-box');
    if (!boxes.length) return;

    resetConnectionBoxes(boxesContainer);
    var index = 0;
    scheduleConnectionValidation(deviceId, root);

    function paintStep() {
      paintConnectionBoxes(boxesContainer, boxes, index);
      if (index >= boxes.length - 1) {
        if (connectionAnimTimers[deviceId] && connectionAnimTimers[deviceId].timer) {
          clearInterval(connectionAnimTimers[deviceId].timer);
          connectionAnimTimers[deviceId].timer = null;
        }
        return;
      }
      index += 1;
    }

    paintStep();
    var timer = setInterval(paintStep, CONNECTION_STEP_MS);
    connectionAnimTimers[deviceId] = { timer: timer };
  }

  function applyDeviceScreenClasses(screenEl, screenName) {
    screenEl.classList.remove('is-smart-test', 'is-smart-test-setup', 'is-smart-test-running');
    if (screenName === 'smart-test') screenEl.classList.add('is-smart-test');
    if (screenName === 'smart-test-setup') screenEl.classList.add('is-smart-test-setup');
    if (screenName === 'smart-test-running') screenEl.classList.add('is-smart-test-running');
  }

  function getSelectedConfigName(deviceNode) {
    var selected = deviceNode.querySelector('.st-list-item.selected');
    if (selected) return selected.textContent.trim();
    var first = deviceNode.querySelector('.st-list-item');
    return first ? first.textContent.trim() : 'CERTIFICATION_AutoTest_20s';
  }

  function updateSetupConfigLabel(deviceNode, name) {
    var label = deviceNode.querySelector('.sts-config-name');
    if (label) label.textContent = name;
  }

  function setDeviceScreen(deviceId, screenName, opts) {
    opts = opts || {};
    var d = findDevice(deviceId);
    if (!d) return;
    d.screen = screenName || 'home';
    if (opts.selectedConfig) d.selectedConfig = opts.selectedConfig;
    if (opts.connectionError !== undefined) d.connectionError = !!opts.connectionError;
    if (!layer) return;
    var node = layer.querySelector('[data-otdr-node="' + deviceId + '"]');
    if (!node) return;
    var screen = node.querySelector('.otdr-screen');
    if (!screen) return;
    applyDeviceScreenClasses(screen, d.screen);
    if (d.screen === 'smart-test-setup' && d.selectedConfig) {
      updateSetupConfigLabel(node, d.selectedConfig);
    }
    if (d.screen === 'smart-test-running') {
      applyRunningConnectionState(deviceId, node);
    } else {
      stopConnectionAnimation(deviceId);
      stopAcquisitionProgress(deviceId);
      d.connectionError = false;
      d.acquisitionActive = false;
      hideErrorPopup(node);
    }
  }

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

  function getScreenClass(screen) {
    if (screen === 'smart-test') return ' is-smart-test';
    if (screen === 'smart-test-setup') return ' is-smart-test-setup';
    if (screen === 'smart-test-running') return ' is-smart-test-running';
    return '';
  }

  function buildDeviceMarkup(deviceId, selected, screen, selectedConfig) {
    var sel = selected ? ' is-selected' : '';
    var activeScreen = getScreenClass(screen);
    var configName = selectedConfig || 'CERTIFICATION_AutoTest_20s';
    return (
      '<div class="lab-otdr lab-otdr--fixed lab-otdr-device lab-workspace-item' + sel +
      '" id="' + deviceId + '" data-otdr-device="1" data-otdr-node="' + deviceId + '"' +
      ' data-otdr-id="' + deviceId + '" role="img" aria-label="VIAVI SmartOTDR">' +
      buildProtrudingPortsMarkup(deviceId) +
      '<div class="otdr-device-shell" data-otdr-drag="' + deviceId + '">' +
      '<div class="otdr-body">' +
      buildPortLabelsMarkup() +
      '<div class="otdr-brand-bar">' +
      '<span class="otdr-viavi-logo" aria-label="VIAVI">VIAVI</span>' +
      '<span class="otdr-model-name">SmartOTDR</span>' +
      '</div>' +
      '<div class="otdr-screen' + activeScreen + '" id="' + deviceId + '-display" role="region" aria-label="SmartOTDR touchscreen">' +
      buildOsHomeMarkup() +
      buildSmartTestAppMarkup() +
      buildSmartTestSetupMarkup(configName) +
      buildSmartTestRunningMarkup() +
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
    layer = mount.querySelector('.lab-otdr-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'lab-otdr-layer';
      layer.setAttribute('data-lab-otdr-layer', '1');
      mount.appendChild(layer);
    }
    return layer;
  }

  function bindPortIsolation(host) {
    host.querySelectorAll('.protruding-port, .lab-otdr-port').forEach(function (port) {
      if (port.dataset.otdrPortIsoBound === '1') return;
      port.dataset.otdrPortIsoBound = '1';
      port.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.stopPropagation();
      }, true);
    });
  }

  function bindScreenNavigation(host) {
    host.querySelectorAll('.app-btn[data-app="smart-test"]').forEach(function (btn) {
      if (btn.dataset.otdrScreenBound === '1') return;
      btn.dataset.otdrScreenBound = '1';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var deviceNode = btn.closest('[data-otdr-node]');
        if (!deviceNode) return;
        setDeviceScreen(deviceNode.getAttribute('data-otdr-node'), 'smart-test');
        setStatus('SMART TEST · select configuration file');
      });
    });

    host.querySelectorAll('[data-otdr-btn="home"]').forEach(function (btn) {
      if (btn.dataset.otdrScreenBound === '1') return;
      btn.dataset.otdrScreenBound = '1';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var deviceNode = btn.closest('[data-otdr-node]');
        if (!deviceNode) return;
        setDeviceScreen(deviceNode.getAttribute('data-otdr-node'), 'home');
        setStatus('SmartOTDR home');
      });
    });

    host.querySelectorAll('.st-list-item').forEach(function (item) {
      if (item.dataset.otdrScreenBound === '1') return;
      item.dataset.otdrScreenBound = '1';
      item.addEventListener('click', function (e) {
        e.stopPropagation();
        var list = item.closest('.st-config-list');
        if (!list) return;
        list.querySelectorAll('.st-list-item').forEach(function (li) {
          li.classList.remove('selected');
        });
        item.classList.add('selected');
      });
    });

    host.querySelectorAll('.st-btn-text').forEach(function (btn) {
      if (btn.dataset.otdrScreenBound === '1') return;
      btn.dataset.otdrScreenBound = '1';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var deviceNode = btn.closest('[data-otdr-node]');
        if (!deviceNode) return;
        var deviceId = deviceNode.getAttribute('data-otdr-node');
        var configName = getSelectedConfigName(deviceNode);
        setDeviceScreen(deviceId, 'smart-test-setup', { selectedConfig: configName });
        setStatus('SMART TEST setup · ' + configName);
      });
    });

    host.querySelectorAll('[data-sts-action="configs"]').forEach(function (btn) {
      if (btn.dataset.otdrScreenBound === '1') return;
      btn.dataset.otdrScreenBound = '1';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var deviceNode = btn.closest('[data-otdr-node]');
        if (!deviceNode) return;
        setDeviceScreen(deviceNode.getAttribute('data-otdr-node'), 'smart-test');
        setStatus('SMART TEST · select configuration file');
      });
    });

    host.querySelectorAll('[data-sts-action="start-test"]').forEach(function (btn) {
      if (btn.dataset.otdrScreenBound === '1') return;
      btn.dataset.otdrScreenBound = '1';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var deviceNode = btn.closest('[data-otdr-node]');
        if (!deviceNode) return;
        var deviceId = deviceNode.getAttribute('data-otdr-node');
        var d = findDevice(deviceId);
        if (d) {
          d.connectionError = false;
          d.acquisitionActive = false;
        }
        refreshPortOccupancy(deviceNode);
        setDeviceScreen(deviceId, 'smart-test-running');
        setStatus('SMART TEST running · SmartLink');
      });
    });

    host.querySelectorAll('.otdr-error-popup').forEach(function (popup) {
      if (popup.dataset.otdrScreenBound === '1') return;
      popup.dataset.otdrScreenBound = '1';
      popup.addEventListener('click', function (e) {
        e.stopPropagation();
        popup.hidden = true;
      });
    });

    host.querySelectorAll('[data-sts-action="stop-test"]').forEach(function (btn) {
      if (btn.dataset.otdrScreenBound === '1') return;
      btn.dataset.otdrScreenBound = '1';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var deviceNode = btn.closest('[data-otdr-node]');
        if (!deviceNode) return;
        var deviceId = deviceNode.getAttribute('data-otdr-node');
        stopConnectionAnimation(deviceId);
        stopAcquisitionProgress(deviceId);
        var boxesContainer = deviceNode.querySelector('.conn-boxes');
        if (boxesContainer) resetConnectionBoxes(boxesContainer);
        resetRunningViewportUI(deviceNode);
        hideErrorPopup(deviceNode);
        setDeviceScreen(deviceId, 'smart-test-setup');
        setStatus('SMART TEST setup');
      });
    });

    host.querySelectorAll('.running-tabs-header .tab').forEach(function (tab) {
      if (tab.dataset.otdrScreenBound === '1') return;
      tab.dataset.otdrScreenBound = '1';
      tab.addEventListener('click', function (e) {
        e.stopPropagation();
        var header = tab.closest('.running-tabs-header');
        if (!header) return;
        header.querySelectorAll('.tab').forEach(function (t) {
          t.classList.remove('active');
        });
        tab.classList.add('active');
      });
    });

    host.querySelectorAll('.sts-row .sts-opt:not(.sts-opt--default)').forEach(function (opt) {
      if (opt.dataset.otdrScreenBound === '1') return;
      opt.dataset.otdrScreenBound = '1';
      opt.addEventListener('click', function (e) {
        e.stopPropagation();
        var row = opt.closest('.sts-row');
        if (!row) return;
        row.querySelectorAll('.sts-opt.is-active, .sts-opt.selected').forEach(function (activeOpt) {
          activeOpt.classList.remove('is-active', 'selected');
        });
        opt.classList.add('is-active', 'selected');
      });
    });
  }

  function bindLayerEvents(host) {
    bindPortIsolation(host);
    bindScreenNavigation(host);

    host.querySelectorAll('[data-otdr-node]').forEach(function (node) {
      node.addEventListener('click', function (e) {
        if (isOtdrPortTarget(e) || isOtdrControlTarget(e)) return;
        e.stopPropagation();
        selectOtdr(node.getAttribute('data-otdr-node'));
      });
    });

    host.querySelectorAll('[data-otdr-drag]').forEach(function (grip) {
      grip.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        if (isOtdrControlTarget(e) || isOtdrPortTarget(e)) return;
        e.preventDefault();
        e.stopPropagation();
        var id = grip.getAttribute('data-otdr-drag');
        var d = findDevice(id);
        if (!d) return;
        selectOtdr(id, { skipRebuild: true });
        var zoom = getZoom() || 1;
        var sx = e.clientX;
        var sy = e.clientY;
        var ox = d.x;
        var oy = d.y;
        var node = host.querySelector('[data-otdr-node="' + id + '"]');
        if (node) node.classList.add('is-dragging', 'is-selected');

        function onMove(ev) {
          d.x = Math.round(ox + (ev.clientX - sx) / zoom);
          d.y = Math.round(oy + (ev.clientY - sy) / zoom);
          if (node) {
            node.style.left = d.x + 'px';
            node.style.top = d.y + 'px';
          }
          if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
            FtthLab.notifyLayoutChange({ source: 'otdr', live: true, otdrId: id });
          }
        }

        function onUp() {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          if (node) node.classList.remove('is-dragging');
          rebuildLayer();
          pushHistory();
          updateInspector();
          if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
            FtthLab.notifyLayoutChange({ source: 'otdr', otdrId: id });
          }
        }

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    });
  }

  function rebuildLayer() {
    layer = ensureLayer();
    if (!layer) return;
    devices.forEach(function (d) {
      stopConnectionAnimation(d.id);
    });
    layer.innerHTML = '';
    devices.forEach(function (d) {
      var wrapper = document.createElement('div');
      var selected = selection.kind === 'otdr' && selection.id === d.id;
      wrapper.innerHTML = buildDeviceMarkup(d.id, selected, d.screen || 'home', d.selectedConfig);
      var el = wrapper.firstElementChild;
      if (!el) return;
      el.style.left = d.x + 'px';
      el.style.top = d.y + 'px';
      refreshPortOccupancy(el);
      layer.appendChild(el);
      if (d.screen === 'smart-test-running') {
        applyRunningConnectionState(d.id, el);
      }
    });
    bindLayerEvents(layer);
  }

  function placeOTDR(x, y) {
    seq += 1;
    var device = {
      id: 'otdr-machine-' + seq,
      x: Math.round(x - DEVICE_NAT_W / 2),
      y: Math.round(y - DEVICE_NAT_H / 2),
      screen: 'home',
    };
    devices.push(device);
    selectOtdr(device.id);
    rebuildLayer();
    pushHistory();
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

  function deleteSelected() {
    if (selection.kind === 'otdr' && selection.id) {
      removeOtdr(selection.id);
      return true;
    }
    return false;
  }

  function clearSelection() {
    selection = { kind: 'none', id: null };
    selectedTool = null;
    renderToolbox();
    rebuildLayer();
    updateInspector();
  }

  function onLayoutChange(payload) {
    if (payload && payload.source === 'otdr' && payload.live) return;
    if (!layer) return;
    layer.querySelectorAll('[data-otdr-node]').forEach(function (node) {
      refreshPortOccupancy(node);
    });
  }

  function isOtdrPortId(portId) {
    if (!portId) return false;
    var id = String(portId);
    return id.indexOf('otdr') >= 0 ||
      id.indexOf('port-apc') >= 0 ||
      id.indexOf('port-vfl') >= 0;
  }

  function otdrDeviceIdFromPortId(portId) {
    if (!portId) return null;
    var match = String(portId).match(/^(otdr-machine-\d+)/);
    return match ? match[1] : null;
  }

  /** World coordinates for a SmartOTDR north-facing test port (APC / APC LIVE / VFL). */
  function getOtdrPortWorld(portId) {
    if (!portId) return null;
    var el = document.querySelector(
      '.lab-otdr-port[data-ols-port="' + portId + '"],' +
      '.lab-otdr-port[data-opm-port="' + portId + '"],' +
      '[data-otdr-port="' + portId + '"]'
    );
    if (!el) {
      var wrap = document.getElementById(portId);
      if (wrap) el = wrap.querySelector('.lab-otdr-port') || wrap;
    }
    if (el) {
      var olsNode = el.closest && el.closest('.lab-ols-port[data-ols-port]');
      if (olsNode || (el.classList && el.classList.contains('lab-ols-port'))) {
        var olsEl = olsNode || el;
        var block = olsEl.querySelector('.lab-ols__sc-block');
        var target = block || olsEl.querySelector('.lab-ols__adapter-slot, .lab-ols__sc-block') || olsEl;
        var rect = target.getBoundingClientRect();
        var cx = rect.left + rect.width / 2;
        var cy = block
          ? rect.top + Math.max(6, Math.min(12, rect.height * 0.3))
          : rect.top + Math.max(2, rect.height * 0.35);
        var pt = clientToWorld(cx, cy);
        return { x: pt.x, y: pt.y, rot: 180, deepSeat: true };
      }
      var bore = el.querySelector('.viavi__adapter-knurl, .lab-opm__adapter-knurl') || el;
      var rOpm = bore.getBoundingClientRect();
      var ptOpm = clientToWorld(rOpm.left + rOpm.width / 2, rOpm.top + rOpm.height * 0.35);
      return { x: ptOpm.x, y: ptOpm.y, rot: 180 };
    }
    var deviceId = otdrDeviceIdFromPortId(portId);
    var d = deviceId ? findDevice(deviceId) : null;
    if (!d) return null;
    var chassisW = DEVICE_NAT_W;
    var portKind = String(portId).split('-').pop();
    var localX = chassisW * 0.5;
    if (portId.indexOf('port-vfl') >= 0) localX = chassisW * 0.22;
    else if (portId.indexOf('port-apc-live') >= 0) localX = chassisW * 0.78;
    else if (portId.indexOf('port-apc') >= 0) localX = chassisW * 0.58;
    return {
      x: d.x + localX,
      y: d.y + Math.round(PORT_PROTRUDE * 0.35),
      rot: 180,
      deepSeat: true,
      estimated: true,
      portKind: portKind,
    };
  }

  function refreshOtdrPorts() {
    if (!layer) return;
    layer.querySelectorAll('[data-otdr-node]').forEach(function (node) {
      refreshPortOccupancy(node);
    });
  }

  function undo() {
    if (historyIndex <= 0) return false;
    historyIndex -= 1;
    historyLocked = true;
    applySnapshot(history[historyIndex]);
    historyLocked = false;
    setStatus('Undo · SmartOTDR');
    return true;
  }

  function redo() {
    if (historyIndex >= history.length - 1) return false;
    historyIndex += 1;
    historyLocked = true;
    applySnapshot(history[historyIndex]);
    historyLocked = false;
    setStatus('Redo · SmartOTDR');
    return true;
  }

  function mount(api) {
    if (!isOtdrLabPage()) return;
    devices = [];
    seq = 0;
    selection = { kind: 'none', id: null };
    selectedTool = null;
    history = [];
    historyIndex = -1;
    renderToolbox();
    bindStageDrop();
    ensureLayer();
    rebuildLayer();

    if (global.FtthLab) {
      FtthLab.refreshOtdrPorts = refreshOtdrPorts;
      FtthLab.getOtdrPortWorld = getOtdrPortWorld;
      FtthLab.isOtdrPortId = isOtdrPortId;
    }
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
    onLayoutChange: onLayoutChange,
    undo: undo,
    redo: redo,
    deleteSelected: deleteSelected,
    clearSelection: clearSelection,
    onToolboxClaim: onToolboxClaim,
    placeOTDR: placeOTDR,
    exportProjectState: function () {
      return JSON.parse(JSON.stringify({ devices: devices, seq: seq, selection: selection }));
    },
    importProjectState: function (snap) {
      devices = (snap && snap.devices) ? JSON.parse(JSON.stringify(snap.devices)) : [];
      seq = (snap && snap.seq) || 0;
      selection = { kind: 'none', id: null };
      rebuildLayer();
      updateInspector();
      if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
        FtthLab.notifyLayoutChange({ source: 'otdr', otdrRestore: true });
      }
    },
    resetProjectState: function () {
      devices = [];
      seq = 0;
      selection = { kind: 'none', id: null };
      rebuildLayer();
      updateInspector();
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
    getPortWorld: getOtdrPortWorld,
    isOtdrPortId: isOtdrPortId,
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
