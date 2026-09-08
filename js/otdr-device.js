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
  var connectionAnimTimers = {};
  var connectionValidationTimers = {};
  var acquisitionTimers = {};

  var currentOtdrTestState = {
    configFile: '',
    durationSec: 20,
    laser: '1550 nm',
    distanceUnit: 'meter',
    launchCable: 'No',
    alarms: 'Yes',
  };

  function parseDurationFromConfig(configFile) {
    if (!configFile) return 20;
    var match = configFile.match(/(\d+)s/i);
    if (match) return parseInt(match[1], 10) || 20;
    return 20;
  }

  function syncConfigToTestState(configFile) {
    if (!configFile) return;
    currentOtdrTestState.configFile = configFile;
    currentOtdrTestState.durationSec = parseDurationFromConfig(configFile);
  }

  function getAcquisitionDurationMs() {
    return (currentOtdrTestState.durationSec || 20) * 1000;
  }

  function laserDataValueFromState() {
    var m = (currentOtdrTestState.laser || '').match(/(\d+)/);
    return m ? m[1] : '1550';
  }

  function launchCableDataValue() {
    return (currentOtdrTestState.launchCable || 'No').toLowerCase() === 'yes' ? 'yes' : 'no';
  }

  function alarmsDataValue() {
    return (currentOtdrTestState.alarms || 'Yes').toLowerCase() === 'yes' ? 'yes' : 'no';
  }

  function resetTestStateToDefaults() {
    currentOtdrTestState.laser = '1550 nm';
    currentOtdrTestState.distanceUnit = 'meter';
    currentOtdrTestState.launchCable = 'No';
    currentOtdrTestState.alarms = 'Yes';
  }

  function setSetupRowValue(deviceNode, rowKey, dataValue) {
    var row = deviceNode.querySelector('[data-sts-row="' + rowKey + '"]');
    if (!row) return;
    row.querySelectorAll('.sts-opt:not(.sts-opt--default)').forEach(function (opt) {
      var match = opt.getAttribute('data-value') === dataValue;
      opt.classList.toggle('is-active', match);
      opt.classList.toggle('selected', match);
    });
  }

  function syncSetupRowToTestState(row, opt) {
    if (!row || !opt) return;
    var rowKey = row.getAttribute('data-sts-row');
    var val = opt.getAttribute('data-value');
    if (rowKey === 'laser') currentOtdrTestState.laser = val + ' nm';
    else if (rowKey === 'distance') currentOtdrTestState.distanceUnit = val || 'meter';
    else if (rowKey === 'launch-cable') {
      currentOtdrTestState.launchCable = val === 'yes' ? 'Yes' : 'No';
    } else if (rowKey === 'alarms') {
      currentOtdrTestState.alarms = val === 'yes' ? 'Yes' : 'No';
    }
  }

  function readSetupSelectionsFromDevice(deviceNode) {
    if (!deviceNode) return;
    var laserOpt = deviceNode.querySelector('[data-sts-row="laser"] .sts-opt.is-active');
    if (laserOpt) currentOtdrTestState.laser = laserOpt.getAttribute('data-value') + ' nm';
    var distOpt = deviceNode.querySelector('[data-sts-row="distance"] .sts-opt.is-active');
    if (distOpt) currentOtdrTestState.distanceUnit = distOpt.getAttribute('data-value') || 'meter';
    var lcOpt = deviceNode.querySelector('[data-sts-row="launch-cable"] .sts-opt.is-active');
    if (lcOpt) currentOtdrTestState.launchCable = lcOpt.getAttribute('data-value') === 'yes' ? 'Yes' : 'No';
    var alarmOpt = deviceNode.querySelector('[data-sts-row="alarms"] .sts-opt.is-active:not(.sts-opt--default)');
    if (alarmOpt) {
      currentOtdrTestState.alarms = alarmOpt.getAttribute('data-value') === 'yes' ? 'Yes' : 'No';
    }
    var configLabel = deviceNode.querySelector('.sts-config-name');
    if (configLabel && configLabel.textContent.trim()) {
      syncConfigToTestState(configLabel.textContent.trim());
    }
  }

  function applyTestStateToSetupUI(deviceNode) {
    if (!deviceNode) return;
    setSetupRowValue(deviceNode, 'laser', laserDataValueFromState());
    setSetupRowValue(deviceNode, 'distance', currentOtdrTestState.distanceUnit || 'meter');
    setSetupRowValue(deviceNode, 'launch-cable', launchCableDataValue());
    setSetupRowValue(deviceNode, 'alarms', alarmsDataValue());
    if (currentOtdrTestState.configFile) {
      updateSetupConfigLabel(deviceNode, currentOtdrTestState.configFile);
    }
  }

  function getDistanceDisplayScale() {
    var unit = currentOtdrTestState.distanceUnit || 'meter';
    if (unit === 'km') return { factor: 0.001, label: 'km', decimals: 3 };
    if (unit === 'feet') return { factor: 3.28084, label: 'ft', decimals: 1 };
    if (unit === 'kfeet') return { factor: 3.28084 / 1000, label: 'kft', decimals: 3 };
    if (unit === 'miles') return { factor: 0.000621371, label: 'mi', decimals: 3 };
    return { factor: 1, label: 'm', decimals: 3 };
  }

  function formatTraceDistance(meters, digits) {
    if (meters == null || !isFinite(meters)) return '—';
    var scale = getDistanceDisplayScale();
    var val = meters * scale.factor;
    var d = typeof digits === 'number' ? digits : scale.decimals;
    return val.toFixed(d);
  }

  function updateAcquisitionTimerUI(deviceNode) {
    if (!deviceNode) return;
    var dur = currentOtdrTestState.durationSec || 20;
    var timerRight = deviceNode.querySelector('.acq-timer-right');
    if (timerRight) timerRight.textContent = formatAcqTimer(dur, dur);
  }

  function updateTraceUIFromTestState(deviceNode) {
    if (!deviceNode) return;
    var scale = getDistanceDisplayScale();
    var distTh = deviceNode.querySelector('.trace-event-table thead th:nth-child(2)');
    if (distTh) distTh.textContent = 'Distance ' + scale.label;
    var secTh = deviceNode.querySelector('.trace-event-table thead th:nth-child(6)');
    if (secTh) secTh.textContent = 'Section ' + scale.label;
    var lambdaVal = deviceNode.querySelector('.trace-summary-lambda-val');
    if (lambdaVal) {
      lambdaVal.textContent = (currentOtdrTestState.laser || '1550 nm').replace(/\s+/g, '');
    }
  }

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
      '.otdr-btn, .otdr-dpad__btn, .otdr-dpad__center, .otdr-power-btn, .app-btn, .otdr-screen, .otdr-os-home, .otdr-smart-test-app, .otdr-smart-test-setup, .otdr-smart-test-running, .st-list-item, .st-btn, .sts-opt, .sts-action-btn, .sidebar-btn, .running-tabs-header .tab, .zoom-in-btn, .zoom-out-btn, .cursor-a-btn, .otdr-trace-canvas, .trace-graph-area, .trace-resizer, .trace-summary-bar, .otdr-error-popup'
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

  function buildSmartTestRunningMarkup(deviceId) {
    var canvasId = deviceId + '-otdr-trace-canvas';
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
      '<span class="tab active" data-running-tab="smartlink" role="button" tabindex="0">SmartLink</span>' +
      '<span class="tab" data-running-tab="trace" role="button" tabindex="0">Trace</span>' +
      '<span class="tab" data-running-tab="table" role="button" tabindex="0">Table</span>' +
      '</div>' +
      '<div class="tabs-right">' +
      '<span class="event-line-text">Event line</span>' +
      '<div class="toggle-switch active" role="switch" aria-checked="true">' +
      '<div class="toggle-circle"></div></div>' +
      '<span class="info-text">Info</span>' +
      '</div></div>' +
      '<div class="running-viewport smartlink-view" data-running-panel="smartlink">' +
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
      '</div></div></div></div></div>' +
      '<div class="trace-view-container" hidden data-running-panel="trace">' +
      '<div class="trace-linear-view" aria-label="Event line">' +
      '<div class="trace-linear-track">' +
      '<span class="trace-linear-icon trace-linear-icon--start" data-trace-icon="start" title="Source">⚡</span>' +
      '<span class="trace-linear-icon trace-linear-icon--splice" data-trace-icon="splice" title="Splice">◇</span>' +
      '<span class="trace-linear-icon trace-linear-icon--end" data-trace-icon="end" title="End">▲</span>' +
      '</div></div>' +
      '<div class="trace-graph-area">' +
      '<canvas class="otdr-trace-canvas" id="' + canvasId + '" width="600" height="300" aria-label="OTDR trace graph"></canvas>' +
      '<div class="trace-floating-controls">' +
      '<button type="button" class="zoom-in-btn" aria-label="Zoom in">+</button>' +
      '<button type="button" class="zoom-out-btn" aria-label="Zoom out">-</button>' +
      '<button type="button" class="cursor-a-btn is-active" aria-label="Cursor A">A</button>' +
      '</div></div>' +
      '<div class="trace-resizer" role="separator" aria-label="Resize graph and table">' +
      '<div class="purple-scroll-indicator"></div></div>' +
      '<div class="trace-summary-bar">' +
      '<div class="trace-summary-item trace-summary-evts"><strong>Nm Evts :</strong> ' +
      '<span class="trace-summary-evts-val">3</span></div>' +
      '<div class="trace-summary-item trace-summary-orl"><strong>ORL enlace :</strong> ' +
      '<span class="trace-summary-orl-val">40.84 dB</span></div>' +
      '<div class="trace-summary-item trace-summary-lambda"><strong>λ: <span class="trace-summary-lambda-val">1625nm</span></strong></div>' +
      '<div class="trace-summary-icons"><span aria-hidden="true">📍</span> ' +
      '<span aria-hidden="true">📌</span> <span aria-hidden="true">↻</span></div>' +
      '</div>' +
      '<div class="trace-event-table-wrap">' +
      '<table class="trace-event-table">' +
      '<thead><tr>' +
      '<th>Event</th><th>Distance m</th><th>Loss dB</th><th>Reflect. dB</th>' +
      '<th>Section Att. dB</th><th>Section m</th><th>T. Loss dB</th>' +
      '</tr></thead>' +
      '<tbody class="trace-event-tbody"></tbody>' +
      '</table></div>' +
      '</div></div>' +
      '<div class="running-sidebar">' +
      '<div class="sidebar-btn sidebar-btn-start" role="button" tabindex="0">' +
      '<span class="btn-text">START</span>' +
      '<span class="btn-icon btn-icon-play" aria-hidden="true">▶️</span></div>' +
      '<div class="sidebar-btn" role="button" tabindex="0">' +
      '<span class="btn-text">Tiempo<br>Real</span>' +
      '<span class="btn-icon" aria-hidden="true">⏱️</span></div>' +
      '<div class="sidebar-btn" role="button" tabindex="0">' +
      '<span class="btn-text">Config.</span>' +
      '<span class="btn-icon" aria-hidden="true">⚙️</span></div>' +
      '<div class="sidebar-btn" role="button" tabindex="0">' +
      '<span class="btn-text">Explorador<br>Archivos</span>' +
      '<span class="btn-icon" aria-hidden="true">📁</span></div>' +
      '<div class="sidebar-btn" role="button" tabindex="0">' +
      '<span class="btn-text">Reportes</span>' +
      '<span class="btn-icon" aria-hidden="true">📄</span></div>' +
      '<div class="sidebar-btn" role="button" tabindex="0">' +
      '<span class="btn-text">Análisis</span>' +
      '<span class="btn-icon" aria-hidden="true">📐</span></div>' +
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

  function formatAcqTimer(seconds, maxSeconds) {
    var max = typeof maxSeconds === 'number' ? maxSeconds : (currentOtdrTestState.durationSec || 20);
    var total = Math.max(0, Math.min(max, Math.floor(seconds)));
    var ss = total < 10 ? '0' + total : String(total);
    return '00:' + ss;
  }

  var TRACE_MAX_M = 2000;
  var TRACE_DB_MIN = -30;
  var TRACE_DB_MAX = 15;
  var TRACE_Y_TICKS = [15, 10, 5, 0, -5, -10, -15, -30];
  var TRACE_X_TICKS = [500, 1000, 1500, 2000];
  var TRACE_LINE_COLOR = '#302060';
  var TRACE_GRID_COLOR = '#e0e0e0';
  var TRACE_ZOOM_FACTOR_IN = 1.2;
  var TRACE_ZOOM_FACTOR_OUT = 0.8;
  var TRACE_ZOOM_MIN = 0.35;
  var TRACE_ZOOM_MAX = 5;
  var TRACE_GRAPH_COLLAPSE_THRESHOLD = 60;
  var TRACE_DEFAULT_GRAPH_HEIGHT = '65%';

  var DEFAULT_TRACE_EVENTS = [
    {
      eventNum: 1,
      event: '1',
      type: 'start',
      label: 'Source',
      distance: 0.000,
      loss: null,
      reflect: -42.5,
      sectionAtt: null,
      sectionM: null,
      totalLoss: 0.00,
      linearPos: 0.02,
    },
    {
      eventNum: 2,
      event: '2',
      type: 'splice',
      label: 'Splice',
      distance: 484.090,
      loss: 0.12,
      reflect: null,
      sectionAtt: 0.35,
      sectionM: 484.090,
      totalLoss: 0.47,
      linearPos: 0.242,
    },
    {
      eventNum: 3,
      event: '3',
      type: 'reflective',
      label: 'Connector',
      distance: 2000.000,
      loss: null,
      reflect: -14.8,
      sectionAtt: 0.28,
      sectionM: 1515.910,
      totalLoss: 0.75,
      linearPos: 0.98,
    },
  ];

  function getDefaultTraceEvents() {
    return JSON.parse(JSON.stringify(DEFAULT_TRACE_EVENTS));
  }

  function formatTraceCell(value, digits) {
    if (value == null || value === '') return '—';
    if (typeof value === 'number' && isFinite(value)) {
      return typeof digits === 'number' ? value.toFixed(digits) : String(value);
    }
    return String(value);
  }

  function getTraceViewport(deviceId) {
    var d = findDevice(deviceId);
    if (!d) {
      return {
        zoomX: 1, zoomY: 1, offsetX: 0, offsetY: 0,
        isDragging: false, selectedEventIndex: 0, activeCursor: 'A',
      };
    }
    if (!d.traceViewport) {
      d.traceViewport = {
        zoomX: 1,
        zoomY: 1,
        offsetX: 0,
        offsetY: 0,
        isDragging: false,
        selectedEventIndex: 0,
        activeCursor: 'A',
      };
    }
    return d.traceViewport;
  }

  function resetTraceViewport(deviceId) {
    var d = findDevice(deviceId);
    if (!d) return;
    d.traceViewport = {
      zoomX: 1,
      zoomY: 1,
      offsetX: 0,
      offsetY: 0,
      isDragging: false,
      selectedEventIndex: 0,
      activeCursor: 'A',
    };
  }

  function traceEventIconSvg(type) {
    var c = 'currentColor';
    if (type === 'splice') {
      return (
        '<svg class="trace-ev-icon" viewBox="0 0 32 14" aria-hidden="true">' +
        '<line x1="1" y1="7" x2="10" y2="7" stroke="' + c + '" stroke-width="1.6"/>' +
        '<rect x="10" y="3.5" width="12" height="7" fill="none" stroke="' + c + '" stroke-width="1.6"/>' +
        '<line x1="22" y1="7" x2="31" y2="7" stroke="' + c + '" stroke-width="1.6"/>' +
        '</svg>'
      );
    }
    if (type === 'reflective') {
      return (
        '<svg class="trace-ev-icon" viewBox="0 0 32 14" aria-hidden="true">' +
        '<line x1="1" y1="7" x2="8" y2="7" stroke="' + c + '" stroke-width="1.6"/>' +
        '<rect x="8" y="2.5" width="16" height="9" fill="none" stroke="' + c + '" stroke-width="1.6"/>' +
        '<line x1="16" y1="2.5" x2="16" y2="11.5" stroke="' + c + '" stroke-width="1.4"/>' +
        '<line x1="24" y1="7" x2="31" y2="7" stroke="' + c + '" stroke-width="1.6"/>' +
        '</svg>'
      );
    }
    if (type === 'end') {
      return (
        '<svg class="trace-ev-icon" viewBox="0 0 32 14" aria-hidden="true">' +
        '<line x1="1" y1="7" x2="18" y2="7" stroke="' + c + '" stroke-width="1.6"/>' +
        '<rect x="18" y="2" width="6" height="10" fill="' + c + '"/>' +
        '<rect x="24" y="3.5" width="3" height="7" fill="' + c + '"/>' +
        '<rect x="27" y="4.5" width="2" height="5" fill="' + c + '"/>' +
        '</svg>'
      );
    }
    /* start / OTDR connector — line ending in filled block */
    return (
      '<svg class="trace-ev-icon" viewBox="0 0 32 14" aria-hidden="true">' +
      '<line x1="1" y1="7" x2="12" y2="7" stroke="' + c + '" stroke-width="1.6"/>' +
      '<rect x="12" y="3" width="10" height="8" fill="' + c + '"/>' +
      '<line x1="22" y1="7" x2="31" y2="7" stroke="' + c + '" stroke-width="1.6"/>' +
      '</svg>'
    );
  }

  function populateTraceEventTable(deviceNode, eventsData, selectedIndex) {
    var tbody = deviceNode && deviceNode.querySelector('.trace-event-tbody');
    if (!tbody) return;
    eventsData = eventsData || getDefaultTraceEvents();
    var deviceId = deviceNode.getAttribute('data-otdr-node');
    var vp = getTraceViewport(deviceId);
    if (typeof selectedIndex === 'number') {
      vp.selectedEventIndex = selectedIndex;
    }
    var sel = vp.selectedEventIndex != null ? vp.selectedEventIndex : 0;
    var html = '';
    var i;
    for (i = 0; i < eventsData.length; i++) {
      var ev = eventsData[i];
      var num = ev.eventNum != null ? ev.eventNum : (i + 1);
      var icon = traceEventIconSvg(ev.type);
      var rowCls = i === sel ? ' class="selected"' : '';
      html +=
        '<tr' + rowCls + ' data-trace-event-row="' + i + '">' +
        '<td class="trace-event-cell">' +
        '<span class="trace-ev-num">' + num + '</span>' +
        icon +
        '</td>' +
        '<td>' + formatTraceDistance(ev.distance) + '</td>' +
        '<td>' + formatTraceCell(ev.loss, 2) + '</td>' +
        '<td>' + formatTraceCell(ev.reflect, 1) + '</td>' +
        '<td>' + formatTraceCell(ev.sectionAtt, 2) + '</td>' +
        '<td>' + formatTraceDistance(ev.sectionM) + '</td>' +
        '<td>' + formatTraceCell(ev.totalLoss, 2) + '</td></tr>';
    }
    tbody.innerHTML = html;
    updateTraceSummaryBar(deviceNode, eventsData);
    updateTraceUIFromTestState(deviceNode);
  }

  function updateTraceSummaryBar(deviceNode, eventsData) {
    if (!deviceNode) return;
    eventsData = eventsData || getDefaultTraceEvents();
    var evtsVal = deviceNode.querySelector('.trace-summary-evts-val');
    if (evtsVal) evtsVal.textContent = String(eventsData.length);
  }

  function applyDefaultTraceSplitLayout(deviceNode) {
    if (!deviceNode) return;
    var container = deviceNode.querySelector('.trace-view-container');
    var graphArea = container && container.querySelector('.trace-graph-area');
    var tableWrap = container && container.querySelector('.trace-event-table-wrap');
    if (!container || !graphArea || !tableWrap) return;

    setTraceGraphCollapsed(graphArea, container, false);

    graphArea.style.flex = '0 0 auto';
    graphArea.style.height = TRACE_DEFAULT_GRAPH_HEIGHT;
    graphArea.style.maxHeight = 'calc(100% - 72px)';
    tableWrap.style.flex = '1 1 auto';
    tableWrap.style.minHeight = '48px';
    tableWrap.style.height = 'auto';
    tableWrap.style.overflowY = 'auto';
  }

  function resetTraceGraphLayout(deviceNode) {
    if (!deviceNode) return;
    var container = deviceNode.querySelector('.trace-view-container');
    var graphArea = container && container.querySelector('.trace-graph-area');
    if (!graphArea || !container) return;
    graphArea.style.height = '';
    graphArea.style.maxHeight = '';
    graphArea.style.flex = '';
    setTraceGraphCollapsed(graphArea, container, false);
  }

  function setTraceGraphCollapsed(graphArea, container, collapsed) {
    if (!graphArea || !container) return;
    graphArea.classList.toggle('is-graph-collapsed', collapsed);
    container.classList.toggle('is-graph-collapsed', collapsed);
    if (collapsed) {
      graphArea.style.flex = '0 0 0';
      graphArea.style.height = '0px';
      graphArea.style.minHeight = '0';
      graphArea.style.display = '';
    } else {
      graphArea.style.flex = '0 0 auto';
      graphArea.style.minHeight = '0';
      graphArea.style.display = '';
    }
  }

  function applyTraceGraphHeight(graphArea, tableWrap, heightPx, container) {
    if (!graphArea || !tableWrap || !container) return;
    if (heightPx < TRACE_GRAPH_COLLAPSE_THRESHOLD) {
      setTraceGraphCollapsed(graphArea, container, true);
      return;
    }
    setTraceGraphCollapsed(graphArea, container, false);
    graphArea.style.height = heightPx + 'px';
    tableWrap.style.flex = '1 1 auto';
    tableWrap.style.minHeight = '0';
  }

  function resolveTraceGraphHeight(container, linearHeight, pointerY, isCollapsed) {
    var containerRect = container.getBoundingClientRect();
    var containerTotalHeight = containerRect.height;
    var calculatedHeight = pointerY - containerRect.top - linearHeight;
    var maxHeight = Math.max(TRACE_GRAPH_COLLAPSE_THRESHOLD, containerTotalHeight - 100);

    if (isCollapsed) {
      if (calculatedHeight <= TRACE_GRAPH_COLLAPSE_THRESHOLD) return 0;
      return Math.min(calculatedHeight, maxHeight);
    }

    if (calculatedHeight < TRACE_GRAPH_COLLAPSE_THRESHOLD) return 0;
    return Math.min(calculatedHeight, maxHeight);
  }

  function bindTraceResizer(host) {
    host.querySelectorAll('.trace-resizer').forEach(function (resizer) {
      if (resizer.dataset.traceResizerBound === '1') return;
      resizer.dataset.traceResizerBound = '1';

      function beginResize(e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        var container = resizer.closest('.trace-view-container');
        if (!container) return;
        var graphArea = container.querySelector('.trace-graph-area');
        var tableWrap = container.querySelector('.trace-event-table-wrap');
        if (!graphArea || !tableWrap) return;

        var linearView = container.querySelector('.trace-linear-view');
        var linearHeight = linearView ? linearView.offsetHeight : 0;
        var deviceNode = container.closest('[data-otdr-node]');
        var deviceId = deviceNode ? deviceNode.getAttribute('data-otdr-node') : null;
        var activePointerId = e.pointerId;

        function pointerClientY(ev) {
          return ev.clientY;
        }

        function onMove(ev) {
          if (ev.pointerId !== activePointerId) return;
          ev.preventDefault();
          var isCollapsed = graphArea.classList.contains('is-graph-collapsed');
          var nextHeight = resolveTraceGraphHeight(
            container,
            linearHeight,
            pointerClientY(ev),
            isCollapsed
          );
          if (nextHeight === 0) {
            setTraceGraphCollapsed(graphArea, container, true);
            return;
          }
          applyTraceGraphHeight(graphArea, tableWrap, nextHeight, container);
        }

        function onEnd(ev) {
          if (ev.pointerId !== activePointerId) return;
          resizer.removeEventListener('pointermove', onMove);
          resizer.removeEventListener('pointerup', onEnd);
          resizer.removeEventListener('pointercancel', onEnd);
          document.body.classList.remove('trace-resizing');
          if (resizer.releasePointerCapture) {
            try { resizer.releasePointerCapture(activePointerId); } catch (err) { /* ignore */ }
          }
          if (deviceId && deviceNode && !graphArea.classList.contains('is-graph-collapsed')) {
            renderTraceForDevice(deviceId, deviceNode);
          }
        }

        document.body.classList.add('trace-resizing');
        if (resizer.setPointerCapture) {
          try { resizer.setPointerCapture(activePointerId); } catch (err) { /* ignore */ }
        }
        onMove(e);
        resizer.addEventListener('pointermove', onMove);
        resizer.addEventListener('pointerup', onEnd);
        resizer.addEventListener('pointercancel', onEnd);
      }

      resizer.addEventListener('pointerdown', beginResize);

      resizer.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
      });

      resizer.addEventListener('touchstart', function (e) {
        e.stopPropagation();
      }, { passive: false });
    });
  }

  function bindTraceEventTableRows(host) {
    host.querySelectorAll('.trace-event-tbody').forEach(function (tbody) {
      if (tbody.dataset.traceRowBound === '1') return;
      tbody.dataset.traceRowBound = '1';
      tbody.addEventListener('click', function (e) {
        var row = e.target.closest('[data-trace-event-row]');
        if (!row) return;
        e.stopPropagation();
        var deviceNode = tbody.closest('[data-otdr-node]');
        if (!deviceNode) return;
        var deviceId = deviceNode.getAttribute('data-otdr-node');
        var idx = parseInt(row.getAttribute('data-trace-event-row'), 10);
        var d = findDevice(deviceId);
        var events = (d && d.traceEvents) ? d.traceEvents : getDefaultTraceEvents();
        populateTraceEventTable(deviceNode, events, idx);
      });
    });
  }

  function positionTraceLinearIcons(deviceNode, eventsData) {
    if (!deviceNode) return;
    eventsData = eventsData || getDefaultTraceEvents();
    eventsData.forEach(function (ev) {
      if (!ev.type) return;
      var iconType = ev.type === 'start' || ev.type === 'connector' ? 'start'
        : ev.type === 'reflective' ? 'end' : ev.type;
      var icon = deviceNode.querySelector('[data-trace-icon="' + iconType + '"]');
      if (!icon) return;
      var pos = typeof ev.linearPos === 'number'
        ? ev.linearPos
        : (typeof ev.distance === 'number' ? ev.distance / TRACE_MAX_M : 0);
      icon.style.left = (Math.max(0, Math.min(1, pos)) * 100) + '%';
    });
  }

  function buildTracePolyline(events) {
    events = events || getDefaultTraceEvents();
    var spliceM = 484.09;
    var endM = 2000;
    var i;
    for (i = 0; i < events.length; i++) {
      if (events[i].type === 'splice' && typeof events[i].distance === 'number') {
        spliceM = events[i].distance;
      }
      if (events[i].type === 'end' || events[i].type === 'reflective') {
        if (typeof events[i].distance === 'number') endM = events[i].distance;
      }
    }
    return [
      { m: 0, db: 14 },
      { m: 0, db: 0 },
      { m: spliceM * 0.85, db: -0.2 },
      { m: spliceM, db: -0.2 },
      { m: spliceM + 3, db: -0.55 },
      { m: endM * 0.92, db: -1.1 },
      { m: endM * 0.96, db: -1.2 },
      { m: endM * 0.985, db: 12 },
      { m: endM, db: -8 },
      { m: endM, db: -6 },
    ];
  }

  function deterministicNoise(i, seed) {
    var x = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  function prepareTraceCanvas(canvas) {
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var cssW = rect.width;
    var cssH = rect.height;
    if (!cssW || !cssH) return null;
    var bufW = Math.max(1, Math.round(cssW * dpr));
    var bufH = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== bufW || canvas.height !== bufH) {
      canvas.width = bufW;
      canvas.height = bufH;
    }
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    return { ctx: ctx, w: cssW, h: cssH, dpr: dpr };
  }

  function fitCanvasToDisplay(canvas) {
    return prepareTraceCanvas(canvas);
  }

  /**
   * Draw OTDR trace — fixed axes/grid, transformed trace line + event markers.
   * @param {string} canvasId
   * @param {Array|null} eventsData
   * @param {{zoomX?: number, zoomY?: number, offsetX?: number, offsetY?: number}} [viewport]
   */
  function drawOTDRTrace(canvasId, eventsData, viewport) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    var prepared = prepareTraceCanvas(canvas);
    if (!prepared) return;
    var ctx = prepared.ctx;
    viewport = viewport || { zoomX: 1, zoomY: 1, offsetX: 0, offsetY: 0 };
    var zoomX = viewport.zoomX != null ? viewport.zoomX : 1;
    var zoomY = viewport.zoomY != null ? viewport.zoomY : 1;
    var offsetX = viewport.offsetX || 0;
    var offsetY = viewport.offsetY || 0;

    var w = prepared.w;
    var h = prepared.h;
    var padL = Math.round(w * 0.1);
    var padR = Math.round(w * 0.06);
    var padT = Math.round(h * 0.1);
    var padB = Math.round(h * 0.16);
    var plotW = w - padL - padR;
    var plotH = h - padT - padB;
    var events = eventsData || getDefaultTraceEvents();
    var labelSize = Math.max(8, Math.round(h * 0.042));
    var distScale = getDistanceDisplayScale();
    var gi;
    var ti;

    function metersToX(m) {
      return (m / TRACE_MAX_M) * plotW;
    }
    function dbToY(db) {
      var norm = (TRACE_DB_MAX - db) / (TRACE_DB_MAX - TRACE_DB_MIN);
      return norm * plotH;
    }

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = TRACE_GRID_COLOR;
    ctx.lineWidth = 1;
    for (gi = 0; gi < TRACE_X_TICKS.length; gi++) {
      var xg = padL + metersToX(TRACE_X_TICKS[gi]);
      ctx.beginPath();
      ctx.moveTo(xg, padT);
      ctx.lineTo(xg, padT + plotH);
      ctx.stroke();
    }
    for (gi = 0; gi < TRACE_Y_TICKS.length; gi++) {
      var yg = padT + dbToY(TRACE_Y_TICKS[gi]);
      ctx.beginPath();
      ctx.moveTo(padL, yg);
      ctx.lineTo(padL + plotW, yg);
      ctx.stroke();
    }

    ctx.strokeStyle = '#666666';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + plotH);
    ctx.lineTo(padL + plotW, padT + plotH);
    ctx.stroke();

    ctx.fillStyle = '#333333';
    ctx.font = labelSize + 'px Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (ti = 0; ti < TRACE_Y_TICKS.length; ti++) {
      ctx.fillText(String(TRACE_Y_TICKS[ti]), padL - 5, padT + dbToY(TRACE_Y_TICKS[ti]));
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.font = 'bold ' + labelSize + 'px Arial, sans-serif';
    ctx.fillText('dB', padL - 2, padT - 3);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = labelSize + 'px Arial, sans-serif';
    for (ti = 0; ti < TRACE_X_TICKS.length; ti++) {
      var xm = TRACE_X_TICKS[ti];
      ctx.fillText(formatTraceDistance(xm), padL + metersToX(xm), padT + plotH + 4);
    }
    ctx.textAlign = 'right';
    ctx.fillText(distScale.label, padL + plotW + 2, padT + plotH + 4);

    ctx.save();
    ctx.translate(padL + offsetX, padT + offsetY);
    ctx.scale(zoomX, zoomY);

    var polyline = buildTracePolyline(events);
    ctx.strokeStyle = TRACE_LINE_COLOR;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (var pi = 0; pi < polyline.length; pi++) {
      var px = metersToX(polyline[pi].m);
      var py = dbToY(polyline[pi].db);
      if (pi === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    var endM = TRACE_MAX_M;
    events.forEach(function (ev) {
      if (ev.type === 'end' || ev.type === 'reflective') {
        if (typeof ev.distance === 'number') endM = ev.distance;
      }
    });
    var noiseStartX = metersToX(endM * 0.992);
    var noiseY = dbToY(-6);
    var noiseEndX = plotW;
    ctx.strokeStyle = TRACE_LINE_COLOR;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(noiseStartX, noiseY);
    var ns;
    for (ns = 1; ns <= 40; ns++) {
      noiseStartX += (noiseEndX - metersToX(endM * 0.992)) / 40;
      noiseY += (deterministicNoise(ns, 7) - 0.5) * 4;
      ctx.lineTo(noiseStartX, noiseY);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    events.forEach(function (ev) {
      if (typeof ev.distance !== 'number') return;
      var mx = metersToX(ev.distance);
      ctx.strokeStyle = 'rgba(48, 32, 96, 0.22)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(mx, 0);
      ctx.lineTo(mx, plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      var evNum = ev.eventNum != null ? ev.eventNum : 1;
      var markerY = dbToY(0) + 14;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = TRACE_LINE_COLOR;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(mx, markerY, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = TRACE_LINE_COLOR;
      ctx.font = 'bold 9px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(evNum), mx, markerY);
    });

    ctx.restore();
  }

  function renderTraceForDevice(deviceId, deviceNode) {
    if (!deviceNode) deviceNode = document.getElementById(deviceId);
    if (!deviceId) return;
    var d = findDevice(deviceId);
    var events = (d && d.traceEvents) ? d.traceEvents : getDefaultTraceEvents();
    var vp = getTraceViewport(deviceId);
    if (deviceNode) {
      var graphArea = deviceNode.querySelector('.trace-graph-area');
      ensureTraceFloatingControls(graphArea);
      enforceTraceFloatingControlStyles(deviceNode);
    }
    drawOTDRTrace(deviceId + '-otdr-trace-canvas', events, vp);
  }

  function bindTraceCanvasInteractions(host) {
    host.querySelectorAll('.otdr-trace-canvas').forEach(function (canvas) {
      if (canvas.dataset.traceBound === '1') return;
      canvas.dataset.traceBound = '1';

      var lastX = 0;
      var lastY = 0;

      canvas.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        var deviceNode = canvas.closest('[data-otdr-node]');
        if (!deviceNode) return;
        var deviceId = deviceNode.getAttribute('data-otdr-node');
        var vp = getTraceViewport(deviceId);
        vp.isDragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        canvas.classList.add('is-panning');
      });

      canvas.addEventListener('mousemove', function (e) {
        var deviceNode = canvas.closest('[data-otdr-node]');
        if (!deviceNode) return;
        var deviceId = deviceNode.getAttribute('data-otdr-node');
        var vp = getTraceViewport(deviceId);
        if (!vp.isDragging) return;
        e.preventDefault();
        e.stopPropagation();
        var deltaX = e.clientX - lastX;
        var deltaY = e.clientY - lastY;
        vp.offsetX += deltaX;
        vp.offsetY += deltaY;
        lastX = e.clientX;
        lastY = e.clientY;
        renderTraceForDevice(deviceId, deviceNode);
      });

      function endPan() {
        var deviceNode = canvas.closest('[data-otdr-node]');
        if (!deviceNode) return;
        var deviceId = deviceNode.getAttribute('data-otdr-node');
        var vp = getTraceViewport(deviceId);
        if (!vp.isDragging) return;
        vp.isDragging = false;
        canvas.classList.remove('is-panning');
      }

      canvas.addEventListener('mouseup', endPan);
      canvas.addEventListener('mouseleave', endPan);

      canvas.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.stopPropagation();
      });
    });
  }

  function switchRunningTab(deviceNode, tabName) {
    if (!deviceNode) return;
    var tabs = deviceNode.querySelectorAll('.tabs-left .tab[data-running-tab]');
    var i;
    for (i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-running-tab') === tabName);
    }
    var smartlink = deviceNode.querySelector('[data-running-panel="smartlink"]');
    var trace = deviceNode.querySelector('.trace-view-container');
    if (tabName === 'smartlink') {
      if (smartlink) smartlink.hidden = false;
      if (trace) {
        trace.hidden = true;
        trace.classList.remove('is-table-only');
      }
    } else {
      if (smartlink) smartlink.hidden = true;
      if (trace) {
        trace.hidden = false;
        trace.classList.toggle('is-table-only', tabName === 'table');
      }
      if (tabName === 'trace') {
        var deviceId = deviceNode.getAttribute('data-otdr-node');
        var d = findDevice(deviceId);
        var events = (d && d.traceEvents) ? d.traceEvents : getDefaultTraceEvents();
        applyDefaultTraceSplitLayout(deviceNode);
        enforceTraceFloatingControlStyles(deviceNode);
        renderTraceForDevice(deviceId, deviceNode);
      }
    }
    var deviceId = deviceNode.getAttribute('data-otdr-node');
    var d = findDevice(deviceId);
    if (d) d.runningTab = tabName;
  }

  function finishAcquisitionAndShowTrace(deviceId, deviceNode) {
    var d = findDevice(deviceId);
    if (d) {
      d.acquisitionActive = false;
      d.acquisitionComplete = true;
      d.traceEvents = getDefaultTraceEvents();
      d.runningTab = 'trace';
      resetTraceViewport(deviceId);
    }
    if (!deviceNode) return;

    stopAcquisitionProgress(deviceId);

    var acqInd = deviceNode.querySelector('.acquisition-indicator');
    if (acqInd) acqInd.hidden = true;
    var smartlink = deviceNode.querySelector('[data-running-panel="smartlink"]');
    if (smartlink) smartlink.hidden = true;
    var viewportBottom = deviceNode.querySelector('.viewport-bottom');
    if (viewportBottom) viewportBottom.hidden = true;
    var connInd = deviceNode.querySelector('.connection-indicator');
    if (connInd) connInd.hidden = true;

    var events = (d && d.traceEvents) ? d.traceEvents : getDefaultTraceEvents();
    populateTraceEventTable(deviceNode, events);
    positionTraceLinearIcons(deviceNode, events);
    updateTraceUIFromTestState(deviceNode);

    var tabs = deviceNode.querySelectorAll('.tabs-left .tab[data-running-tab]');
    var ti;
    for (ti = 0; ti < tabs.length; ti++) {
      var tabName = tabs[ti].getAttribute('data-running-tab');
      tabs[ti].classList.toggle('active', tabName === 'trace');
    }
    var trace = deviceNode.querySelector('.trace-view-container');
    if (trace) {
      trace.hidden = false;
      trace.classList.remove('is-table-only');
    }

    applyDefaultTraceSplitLayout(deviceNode);
    enforceTraceFloatingControlStyles(deviceNode);
    renderTraceForDevice(deviceId, deviceNode);

    requestAnimationFrame(function () {
      applyDefaultTraceSplitLayout(deviceNode);
      enforceTraceFloatingControlStyles(deviceNode);
      renderTraceForDevice(deviceId, deviceNode);
      requestAnimationFrame(function () {
        applyDefaultTraceSplitLayout(deviceNode);
        enforceTraceFloatingControlStyles(deviceNode);
        renderTraceForDevice(deviceId, deviceNode);
      });
    });

    setStatus('SMART TEST · trace acquired');
  }

  function resetTraceViewUI(deviceNode) {
    if (!deviceNode) return;
    resetTraceGraphLayout(deviceNode);
    switchRunningTab(deviceNode, 'smartlink');
    var trace = deviceNode.querySelector('.trace-view-container');
    if (trace) trace.hidden = true;
    var smartlink = deviceNode.querySelector('[data-running-panel="smartlink"]');
    if (smartlink) smartlink.hidden = false;
    var viewportBottom = deviceNode.querySelector('.viewport-bottom');
    if (viewportBottom) viewportBottom.hidden = false;
    var tbody = deviceNode.querySelector('.trace-event-tbody');
    if (tbody) tbody.innerHTML = '';
    var deviceId = deviceNode.getAttribute('data-otdr-node');
    var d = findDevice(deviceId);
    if (d) {
      d.acquisitionComplete = false;
      d.traceEvents = null;
      d.runningTab = 'smartlink';
      resetTraceViewport(deviceId);
    }
  }

  function resetAcquisitionUI(deviceNode) {
    if (!deviceNode) return;
    var fill = deviceNode.querySelector('.acq-progress-fill');
    var pctEl = deviceNode.querySelector('.acq-progress-pct');
    var timerLeft = deviceNode.querySelector('.acq-timer-left');
    if (fill) fill.style.width = '0%';
    if (pctEl) pctEl.textContent = '0%';
    if (timerLeft) timerLeft.textContent = '00:00';
    updateAcquisitionTimerUI(deviceNode);
  }

  function resetRunningViewportUI(deviceNode) {
    if (!deviceNode) return;
    var connInd = deviceNode.querySelector('.connection-indicator');
    var acqInd = deviceNode.querySelector('.acquisition-indicator');
    if (connInd) connInd.hidden = false;
    if (acqInd) acqInd.hidden = true;
    resetAcquisitionUI(deviceNode);
    resetTraceViewUI(deviceNode);
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
    updateAcquisitionTimerUI(deviceNode);
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
    var durationMs = getAcquisitionDurationMs();
    var durationSec = currentOtdrTestState.durationSec || 20;
    acquisitionTimers[deviceId] = setInterval(function () {
      var elapsed = Date.now() - started;
      var pct = Math.min(100, (elapsed / durationMs) * 100);
      var elapsedSec = elapsed / 1000;
      fill.style.width = pct + '%';
      if (pctEl) pctEl.textContent = Math.round(pct) + '%';
      if (timerLeft) timerLeft.textContent = formatAcqTimer(elapsedSec, durationSec);
      if (pct >= 100) {
        fill.style.width = '100%';
        if (pctEl) pctEl.textContent = '100%';
        if (timerLeft) timerLeft.textContent = formatAcqTimer(durationSec, durationSec);
        stopAcquisitionProgress(deviceId);
        finishAcquisitionAndShowTrace(deviceId, deviceNode);
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
    if (d && d.acquisitionComplete) {
      hideErrorPopup(deviceNode);
      var connInd = deviceNode.querySelector('.connection-indicator');
      var acqInd = deviceNode.querySelector('.acquisition-indicator');
      if (connInd) connInd.hidden = true;
      if (acqInd) acqInd.hidden = true;
      var smartlink = deviceNode.querySelector('[data-running-panel="smartlink"]');
      if (smartlink) smartlink.hidden = true;
      var viewportBottom = deviceNode.querySelector('.viewport-bottom');
      if (viewportBottom) viewportBottom.hidden = true;
      var events = d.traceEvents || getDefaultTraceEvents();
      populateTraceEventTable(deviceNode, events);
      positionTraceLinearIcons(deviceNode, events);
      switchRunningTab(deviceNode, d.runningTab || 'trace');
      applyDefaultTraceSplitLayout(deviceNode);
      renderTraceForDevice(deviceId, deviceNode);
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
    if (opts.selectedConfig) {
      d.selectedConfig = opts.selectedConfig;
      syncConfigToTestState(opts.selectedConfig);
    }
    if (opts.connectionError !== undefined) d.connectionError = !!opts.connectionError;
    if (!layer) return;
    var node = layer.querySelector('[data-otdr-node="' + deviceId + '"]');
    if (!node) return;
    var screen = node.querySelector('.otdr-screen');
    if (!screen) return;
    applyDeviceScreenClasses(screen, d.screen);
    if (d.screen === 'smart-test-setup' && d.selectedConfig) {
      updateSetupConfigLabel(node, d.selectedConfig);
      applyTestStateToSetupUI(node);
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
      buildSmartTestRunningMarkup(deviceId) +
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

  function ensureTraceFloatingControls(graphArea) {
    if (!graphArea) return;
    var wrap = graphArea.querySelector('.trace-floating-controls');
    if (wrap) return;
    wrap = document.createElement('div');
    wrap.className = 'trace-floating-controls';
    wrap.innerHTML =
      '<button type="button" class="zoom-in-btn" aria-label="Zoom in">+</button>' +
      '<button type="button" class="zoom-out-btn" aria-label="Zoom out">-</button>' +
      '<button type="button" class="cursor-a-btn is-active" aria-label="Cursor A">A</button>';
    graphArea.appendChild(wrap);
  }

  function enforceTraceFloatingControlStyles(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('.trace-graph-area').forEach(function (graphArea) {
      ensureTraceFloatingControls(graphArea);
      graphArea.style.position = 'relative';
      var wrap = graphArea.querySelector('.trace-floating-controls');
      if (!wrap) return;
      wrap.style.position = 'absolute';
      wrap.style.top = '12px';
      wrap.style.right = '20px';
      wrap.style.display = 'flex';
      wrap.style.alignItems = 'center';
      wrap.style.gap = '4px';
      wrap.style.zIndex = '100';
      wrap.querySelectorAll('button').forEach(function (btn) {
        btn.style.width = '28px';
        btn.style.height = '28px';
        btn.style.borderRadius = '50%';
        btn.style.backgroundColor = 'rgba(245, 245, 245, 0.85)';
        btn.style.color = '#302060';
        btn.style.border = '1px solid rgba(0, 0, 0, 0.2)';
        btn.style.fontSize = '16px';
        btn.style.fontWeight = 'bold';
        btn.style.display = 'flex';
        btn.style.justifyContent = 'center';
        btn.style.alignItems = 'center';
        btn.style.cursor = 'pointer';
        btn.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.15)';
        btn.style.padding = '0';
        btn.style.margin = '0';
        btn.style.marginLeft = btn.classList.contains('cursor-a-btn') ? '12px' : '0';
      });
    });
  }

  function bindTraceFloatingControls(host) {
    host.querySelectorAll('.trace-graph-area').forEach(function (graphArea) {
      if (graphArea.dataset.otdrFloatBound === '1') return;
      graphArea.dataset.otdrFloatBound = '1';
      graphArea.addEventListener('click', function (e) {
        var zoomIn = e.target.closest('.zoom-in-btn');
        var zoomOut = e.target.closest('.zoom-out-btn');
        var cursorA = e.target.closest('.cursor-a-btn');
        if (!zoomIn && !zoomOut && !cursorA) return;
        e.stopPropagation();
        var deviceNode = graphArea.closest('[data-otdr-node]');
        if (!deviceNode) return;
        var deviceId = deviceNode.getAttribute('data-otdr-node');
        var vp = getTraceViewport(deviceId);
        if (zoomIn) {
          vp.zoomX *= TRACE_ZOOM_FACTOR_IN;
          vp.zoomY *= TRACE_ZOOM_FACTOR_IN;
          vp.zoomX = Math.max(TRACE_ZOOM_MIN, Math.min(TRACE_ZOOM_MAX, vp.zoomX));
          vp.zoomY = Math.max(TRACE_ZOOM_MIN, Math.min(TRACE_ZOOM_MAX, vp.zoomY));
          renderTraceForDevice(deviceId, deviceNode);
          return;
        }
        if (zoomOut) {
          vp.zoomX *= TRACE_ZOOM_FACTOR_OUT;
          vp.zoomY *= TRACE_ZOOM_FACTOR_OUT;
          vp.zoomX = Math.max(TRACE_ZOOM_MIN, Math.min(TRACE_ZOOM_MAX, vp.zoomX));
          vp.zoomY = Math.max(TRACE_ZOOM_MIN, Math.min(TRACE_ZOOM_MAX, vp.zoomY));
          renderTraceForDevice(deviceId, deviceNode);
          return;
        }
        if (cursorA) {
          vp.activeCursor = 'A';
          var wrap = graphArea.querySelector('.trace-floating-controls');
          if (wrap) {
            wrap.querySelectorAll('.cursor-a-btn').forEach(function (b) {
              b.classList.remove('is-active');
            });
          }
          cursorA.classList.add('is-active');
        }
      });
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
        syncConfigToTestState(item.textContent.trim());
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
        syncConfigToTestState(configName);
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
        readSetupSelectionsFromDevice(deviceNode);
        if (d) {
          d.connectionError = false;
          d.acquisitionActive = false;
          d.acquisitionComplete = false;
          d.traceEvents = null;
          d.runningTab = 'smartlink';
          resetTraceViewport(deviceId);
        }
        refreshPortOccupancy(deviceNode);
        setDeviceScreen(deviceId, 'smart-test-running');
        updateAcquisitionTimerUI(deviceNode);
        setStatus('SMART TEST running · SmartLink · ' + (currentOtdrTestState.configFile || 'test'));
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

    host.querySelectorAll('.tabs-left .tab[data-running-tab]').forEach(function (tab) {
      if (tab.dataset.otdrScreenBound === '1') return;
      tab.dataset.otdrScreenBound = '1';
      tab.addEventListener('click', function (e) {
        e.stopPropagation();
        var deviceNode = tab.closest('[data-otdr-node]');
        if (!deviceNode) return;
        var tabName = tab.getAttribute('data-running-tab');
        if (!tabName) return;
        switchRunningTab(deviceNode, tabName);
      });
    });

    bindTraceFloatingControls(host);
    bindTraceCanvasInteractions(host);
    bindTraceEventTableRows(host);
    bindTraceResizer(host);

    host.querySelectorAll('.running-tabs-header .tab:not([data-running-tab])').forEach(function (tab) {
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
        syncSetupRowToTestState(row, opt);
      });
    });

    host.querySelectorAll('[data-sts-action="default"]').forEach(function (btn) {
      if (btn.dataset.otdrScreenBound === '1') return;
      btn.dataset.otdrScreenBound = '1';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var deviceNode = btn.closest('[data-otdr-node]');
        if (!deviceNode) return;
        resetTestStateToDefaults();
        applyTestStateToSetupUI(deviceNode);
      });
    });

    enforceTraceFloatingControlStyles(host);
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
      if (d.screen === 'smart-test-setup') {
        if (d.selectedConfig) syncConfigToTestState(d.selectedConfig);
        applyTestStateToSetupUI(el);
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
    drawOTDRTrace: drawOTDRTrace,
    renderTraceForDevice: renderTraceForDevice,
    getDefaultTraceEvents: getDefaultTraceEvents,
    getTestState: function () {
      return JSON.parse(JSON.stringify(currentOtdrTestState));
    },
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
