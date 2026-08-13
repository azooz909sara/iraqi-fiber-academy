/**
 * Viavi OLP-38 Optical Power Meter — dockable SC adapter on FTTH lab canvas.
 * Live dBm only when an SC Patch Cord / Pigtail is snapped into the metal port.
 */
(function (global) {
  'use strict';

  var OPM_W = 152;
  var OPM_H = 268;
  var HISTORY_MAX = 40;
  var DOCK_LOSS_DB = 0.15;

  var ctx = null;
  var layer = null;
  var devices = [];
  var seq = 0;
  var selection = { kind: 'none', id: null };
  var selectedTool = null;
  var history = [];
  var historyIndex = -1;
  var historyLocked = false;
  var wavelengthNm = 1490;
  var unitMode = 'dbm'; /* dbm | mw */

  function setStatus(msg) {
    if (global.FtthLab && FtthLab.setStatus) FtthLab.setStatus(msg);
  }

  function getZoom() {
    return (global.FtthLab && FtthLab.getZoom2d && FtthLab.getZoom2d()) || 1;
  }

  function getWorldSize() {
    return (global.FtthLab && FtthLab.getWorldSize && FtthLab.getWorldSize()) || 20000;
  }

  function clientToWorld(clientX, clientY) {
    if (global.FtthLab && typeof FtthLab.clientToWorld2d === 'function') {
      return FtthLab.clientToWorld2d(clientX, clientY);
    }
    return { x: 0, y: 0 };
  }

  function claimSelection() {
    if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
      FtthLab.setSelectionOwner('opm');
    }
  }

  function findDevice(id) {
    for (var i = 0; i < devices.length; i++) {
      if (devices[i].id === id) return devices[i];
    }
    return null;
  }

  function defaultPos() {
    var w = getWorldSize();
    return {
      x: Math.round(w / 2 + 80 + devices.length * 40),
      y: Math.round(w / 2 - 40),
    };
  }

  function formatDbm(dBm) {
    if (dBm == null || !isFinite(dBm)) return null;
    return (dBm >= 0 ? '+' : '') + dBm.toFixed(2);
  }

  function formatMw(dBm) {
    if (dBm == null || !isFinite(dBm)) return null;
    var mw = Math.pow(10, dBm / 10);
    if (mw >= 1) return mw.toFixed(3) + ' mW';
    if (mw >= 0.001) return (mw * 1000).toFixed(2) + ' µW';
    return (mw * 1e6).toFixed(1) + ' nW';
  }

  function getPortWorld(opmId) {
    var el = document.querySelector('.lab-opm-port[data-opm-port="' + opmId + '"]');
    if (!el) {
      var d = findDevice(opmId);
      if (!d) return null;
      return { x: d.x + OPM_W / 2, y: d.y + 18, rot: 0 };
    }
    var bore = el.querySelector('.lab-opm__adapter-knurl') || el;
    var r = bore.getBoundingClientRect();
    var pt = clientToWorld(r.left + r.width / 2, r.top + r.height * 0.35);
    return { x: pt.x, y: pt.y, rot: 0 };
  }

  function measureAtDock(opmId) {
    if (!global.FtthLab || typeof FtthLab.measureOpticalAtKey !== 'function') {
      return null;
    }
    var key = 'opm:' + opmId;
    var reading = FtthLab.measureOpticalAtKey(key);
    if (reading) {
      reading.docked = true;
      reading.opmId = opmId;
      reading.label = reading.label || 'Viavi OLP-38 dock';
    }
    return reading;
  }

  function isDockOccupied(opmId) {
    var graph = global.FtthLab && typeof FtthLab.getFiberLaserGraph === 'function'
      ? FtthLab.getFiberLaserGraph()
      : { pcords: [], pigtails: [] };
    var i;
    var pcords = graph.pcords || [];
    for (i = 0; i < pcords.length; i++) {
      var c = pcords[i];
      if (c.sideA && c.sideA.owner === 'opm' && c.sideA.opmId === opmId) return true;
      if (c.sideB && c.sideB.owner === 'opm' && c.sideB.opmId === opmId) return true;
    }
    var pigtails = graph.pigtails || [];
    for (i = 0; i < pigtails.length; i++) {
      var p = pigtails[i];
      if (p.connector && p.connector.owner === 'opm' && p.connector.opmId === opmId) return true;
    }
    return false;
  }

  function refreshDockReadings() {
    devices.forEach(function (d) {
      var occupied = isDockOccupied(d.id);
      d.docked = occupied;
      if (!occupied) {
        d.lastReading = {
          dBm: null,
          lossDb: null,
          source: null,
          label: 'UNCONNECTED',
          path: [],
          note: 'NO CABLE',
          docked: false,
        };
      } else {
        var reading = measureAtDock(d.id);
        if (reading && reading.source && isFinite(reading.dBm)) {
          d.lastReading = reading;
        } else {
          d.lastReading = {
            dBm: reading && reading.dBm,
            lossDb: reading && reading.lossDb,
            source: reading && reading.source,
            label: 'SIGNAL LOW',
            path: (reading && reading.path) || [],
            note: (reading && reading.note) || 'No optical path to OLT',
            docked: true,
          };
        }
      }
    });
    lastBroadcast();
    rebuildLayer();
    updateInspector();
  }

  function lastBroadcast() {
    var primary = devices.length ? devices[devices.length - 1] : null;
    var reading = primary && primary.lastReading;
    if (global.PowerMeterTrainer && typeof PowerMeterTrainer.applyDockReading === 'function') {
      PowerMeterTrainer.applyDockReading(reading, primary);
    }
    if (typeof global.dispatchEvent === 'function') {
      try {
        global.dispatchEvent(new CustomEvent('opm-dock-reading', {
          detail: { reading: reading, device: primary },
        }));
      } catch (err) { /* ignore */ }
    }
  }

  function ensureLayer() {
    if (layer && layer.parentNode) return layer;
    var mount = document.getElementById('lab-2d-mount');
    if (!mount) return null;
    layer = document.createElement('div');
    layer.className = 'lab-opm-layer';
    layer.setAttribute('data-lab-opm-layer', '1');
    mount.appendChild(layer);
    return layer;
  }

  function screenMarkup(d) {
    var r = d.lastReading;
    var docked = !!(d.docked && r && r.docked !== false && (r.source || r.note === 'No optical path to OLT' || r.label === 'SIGNAL LOW'));
    var main;
    var unit = '';
    if (!d.docked) {
      main = 'UNCONNECTED';
    } else if (!r || !isFinite(r.dBm) || !r.source) {
      main = 'SIGNAL LOW';
    } else if (unitMode === 'mw') {
      main = formatMw(r.dBm) || '——.—';
    } else {
      main = formatDbm(r.dBm);
      unit = 'dBm';
    }
    var softUnit = unitMode === 'mw' ? 'Pow. [W]' : 'dBm';
    return (
      '<div class="lab-opm__screen" aria-live="polite">' +
      '<div class="lab-opm__screen-top">' +
      '<span>Broadband / Expert</span>' +
      '<span class="lab-opm__batt" aria-hidden="true">▮▮▮</span>' +
      '</div>' +
      '<div class="lab-opm__screen-main' + (!d.docked ? ' is-idle' : '') + '">' +
      '<span class="lab-opm__screen-value">' + main + '</span>' +
      (unit ? '<span class="lab-opm__screen-unit">' + unit + '</span>' : '') +
      '</div>' +
      '<div class="lab-opm__softkeys">' +
      '<span>' + wavelengthNm + ' nm</span>' +
      '<span>Abs&gt;Ref</span>' +
      '<span>' + softUnit + '</span>' +
      '</div>' +
      '</div>'
    );
  }

  function rebuildLayer() {
    var host = ensureLayer();
    if (!host) return;

    var html = '';
    devices.forEach(function (d) {
      var sel = selection.kind === 'opm' && selection.id === d.id ? ' is-selected' : '';
      var docked = d.docked ? ' is-docked' : '';
      html +=
        '<div class="lab-opm lab-opm--viavi' + sel + docked +
        '" data-opm-node="' + d.id + '" style="left:' + d.x + 'px;top:' + d.y + 'px">' +
        '<div class="lab-opm__bumper lab-opm__bumper--tl" aria-hidden="true"></div>' +
        '<div class="lab-opm__bumper lab-opm__bumper--tr" aria-hidden="true"></div>' +
        '<div class="lab-opm__bumper lab-opm__bumper--bl" aria-hidden="true"></div>' +
        '<div class="lab-opm__bumper lab-opm__bumper--br" aria-hidden="true"></div>' +
        '<div class="lab-opm-port' + (d.docked ? ' is-occupied' : '') +
        '" data-opm-port="' + d.id + '" data-opm-connector="SC" title="SC optical adapter · dock patch/pigtail here">' +
        '<span class="lab-opm__adapter-base" aria-hidden="true"></span>' +
        '<span class="lab-opm__adapter-knurl" aria-hidden="true"></span>' +
        '<span class="lab-opm__adapter-bore" aria-hidden="true"></span>' +
        '</div>' +
        '<div class="lab-opm__body" data-opm-drag="' + d.id + '">' +
        '<div class="lab-opm__badge">VIAVI</div>' +
        screenMarkup(d) +
        '<div class="lab-opm__keypad">' +
        '<button type="button" class="lab-opm__key" data-opm-soft="1" tabindex="-1"></button>' +
        '<button type="button" class="lab-opm__key" data-opm-soft="2" tabindex="-1"></button>' +
        '<button type="button" class="lab-opm__key" data-opm-soft="3" tabindex="-1"></button>' +
        '<button type="button" class="lab-opm__key lab-opm__key--mode" data-opm-mode title="MODE">MODE</button>' +
        '<button type="button" class="lab-opm__key lab-opm__key--save" data-opm-save title="SAVE">SAVE</button>' +
        '<button type="button" class="lab-opm__key lab-opm__key--pwr" data-opm-pwr title="Power" aria-label="Power">⏻</button>' +
        '</div>' +
        '<div class="lab-opm__model">OLP-38</div>' +
        '</div>' +
        '</div>';
    });
    host.innerHTML = html;
    bindLayerEvents(host);
  }

  function bindLayerEvents(host) {
    host.querySelectorAll('[data-opm-drag]').forEach(function (grip) {
      grip.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        if (e.target.closest('.lab-opm-port, .lab-opm__keypad')) return;
        e.preventDefault();
        e.stopPropagation();
        var id = grip.getAttribute('data-opm-drag');
        var d = findDevice(id);
        if (!d) return;
        selectOpm(id);
        var zoom = getZoom() || 1;
        var sx = e.clientX;
        var sy = e.clientY;
        var ox = d.x;
        var oy = d.y;
        var node = host.querySelector('[data-opm-node="' + id + '"]');
        if (node) node.classList.add('is-dragging');

        function onMove(ev) {
          d.x = Math.round(ox + (ev.clientX - sx) / zoom);
          d.y = Math.round(oy + (ev.clientY - sy) / zoom);
          if (node) {
            node.style.left = d.x + 'px';
            node.style.top = d.y + 'px';
          }
          if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
            FtthLab.notifyLayoutChange({ source: 'opm', live: true, opmId: id });
          }
        }
        function onUp() {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          if (node) node.classList.remove('is-dragging');
          rebuildLayer();
          pushHistory();
          if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
            FtthLab.notifyLayoutChange({ source: 'opm', opmId: id });
          }
        }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    });

    host.querySelectorAll('[data-opm-mode]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        unitMode = unitMode === 'dbm' ? 'mw' : 'dbm';
        rebuildLayer();
        lastBroadcast();
      });
    });

    host.querySelectorAll('[data-opm-save]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (global.PowerMeterTrainer && typeof PowerMeterTrainer.takeSnapshot === 'function') {
          PowerMeterTrainer.takeSnapshot();
        } else {
          setStatus('OLP-38 · SAVE');
        }
      });
    });
  }

  function placeOpm(x, y) {
    seq += 1;
    var pos = (typeof x === 'number' && typeof y === 'number')
      ? { x: x, y: y }
      : defaultPos();
    var d = {
      id: 'opm-' + seq,
      x: pos.x,
      y: pos.y,
      docked: false,
      lastReading: {
        dBm: null,
        lossDb: null,
        source: null,
        label: 'UNCONNECTED',
        path: [],
        note: 'NO CABLE',
        docked: false,
      },
    };
    devices.push(d);
    selectOpm(d.id);
    rebuildLayer();
    pushHistory();
    lastBroadcast();
    setStatus('Viavi OLP-38 placed · dock an SC Patch Cord or Pigtail into the top adapter');
    return d;
  }

  function selectOpm(id) {
    selection = { kind: 'opm', id: id };
    claimSelection();
    renderToolbox();
    rebuildLayer();
    updateInspector();
  }

  function removeOpm(id) {
    devices = devices.filter(function (d) { return d.id !== id; });
    if (selection.id === id) selection = { kind: 'none', id: null };
    rebuildLayer();
    updateInspector();
    pushHistory();
    lastBroadcast();
  }

  function renderToolbox() {
    var host = document.getElementById('lab-opm-tree');
    if (!host) return;
    host.innerHTML =
      '<div class="lab-toolbox" role="list">' +
      '<button type="button" class="lab-tool lab-tool--opm' +
      (selectedTool === 'opm' ? ' is-selected' : '') +
      '" draggable="true" data-lab-tool="opm" role="listitem">' +
      '<span class="lab-tool__mark lab-tool__mark--opm" aria-hidden="true"></span>' +
      '<span class="lab-tool__copy">' +
      '<strong>Viavi OLP-38</strong>' +
      '<span>SC dock · live dBm</span>' +
      '</span>' +
      '</button>' +
      '</div>';
    bindToolbox(host);
  }

  function bindToolbox(host) {
    var btn = host.querySelector('[data-lab-tool="opm"]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('opm');
      }
      selectedTool = 'opm';
      renderToolbox();
      if (!devices.length) placeOpm();
      else selectOpm(devices[devices.length - 1].id);
    });
    btn.addEventListener('dragstart', function (e) {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('opm');
      }
      selectedTool = 'opm';
      if (global.FtthLab && FtthLab.beginDrag) {
        FtthLab.beginDrag({ kind: 'opm' });
      }
      try {
        e.dataTransfer.setData('text/plain', 'lab:opm');
        e.dataTransfer.setData('text/lab-drag', 'opm');
        e.dataTransfer.effectAllowed = 'copy';
      } catch (err) { /* ignore */ }
      btn.classList.add('is-dragging', 'is-selected');
    });
    btn.addEventListener('dragend', function () {
      btn.classList.remove('is-dragging');
      if (global.FtthLab && FtthLab.endDrag) FtthLab.endDrag();
    });
  }

  function bindStageDrop() {
    var stage = document.getElementById('lab-canvas-2d');
    if (!stage || stage.dataset.opmDropBound === '1') return;
    stage.dataset.opmDropBound = '1';
    stage.addEventListener('drop', function (e) {
      var drag = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
      if (!drag || drag.kind !== 'opm') return;
      e.preventDefault();
      var pt = clientToWorld(e.clientX, e.clientY);
      placeOpm(Math.round(pt.x - OPM_W / 2), Math.round(pt.y - 24));
      if (global.FtthLab && FtthLab.endDrag) FtthLab.endDrag();
      selectedTool = 'opm';
      renderToolbox();
    });
  }

  function updateInspector() {
    var card = document.getElementById('lab-inspector-card');
    var detail = document.getElementById('lab-inspector-detail');
    if (!card || !detail) return;
    if (selection.kind !== 'opm' || !selection.id) {
      if (card.dataset.opmInspector === '1') {
        card.dataset.opmInspector = '';
        if (global.FtthLab && typeof FtthLab.resetInspectorIdle === 'function') {
          FtthLab.resetInspectorIdle();
        }
      }
      return;
    }
    var d = findDevice(selection.id);
    if (!d) return;
    card.dataset.opmInspector = '1';
    card.hidden = true;
    detail.hidden = false;
    var r = d.lastReading;
    detail.innerHTML =
      '<div class="lab-inspector__card">' +
      '<h2>Viavi OLP-38</h2>' +
      '<p>Dock an <strong>SC</strong> Patch Cord or Pigtail into the metal adapter on top.</p>' +
      '<div class="lab-spl-sheet">' +
      '<div><span>Dock</span><strong>' + (d.docked ? 'Occupied' : 'Open') + '</strong></div>' +
      '<div><span>Reading</span><strong>' +
      (r && isFinite(r.dBm) ? formatDbm(r.dBm) + ' dBm' : (r && r.label) || 'UNCONNECTED') +
      '</strong></div>' +
      '<div><span>λ</span><strong>' + wavelengthNm + ' nm</strong></div>' +
      '</div>' +
      '<button type="button" class="lab-eject-btn" data-remove-opm="' + d.id + '">Remove OLP-38</button>' +
      '</div>';
    var rm = detail.querySelector('[data-remove-opm]');
    if (rm) {
      rm.addEventListener('click', function () {
        removeOpm(d.id);
        if (global.FtthLab && typeof FtthLab.resetInspectorIdle === 'function') {
          FtthLab.resetInspectorIdle();
        }
      });
    }
  }

  function pushHistory() {
    if (historyLocked) return;
    history = history.slice(0, historyIndex + 1);
    history.push(JSON.parse(JSON.stringify({
      devices: devices,
      seq: seq,
      selection: selection,
    })));
    if (history.length > HISTORY_MAX) history.shift();
    historyIndex = history.length - 1;
    if (global.FtthLab && FtthLab.recordHistory) FtthLab.recordHistory();
  }

  function onLayoutChange() {
    refreshDockReadings();
  }

  function onLaunchRequest(payload) {
    if (!payload || payload.tool !== 'opm') return;
    selectedTool = 'opm';
    renderToolbox();
    if (!devices.length) {
      var w = getWorldSize();
      placeOpm(Math.round(w / 2 + 40), Math.round(w / 2 - 20));
    } else {
      selectOpm(devices[0].id);
    }
    if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
      FtthLab.claimToolboxTool('opm');
    }
  }

  function deleteSelected() {
    if (selection.kind === 'opm' && selection.id) {
      removeOpm(selection.id);
      return true;
    }
    return false;
  }

  function clearSelection() {
    selection = { kind: 'none', id: null };
    selectedTool = null;
    renderToolbox();
    rebuildLayer();
  }

  function onToolboxClaim(payload) {
    var id = payload && payload.toolId;
    if (id === 'opm') return;
    if (selectedTool) {
      selectedTool = null;
      renderToolbox();
    }
  }

  function mount(api) {
    ctx = api || {};
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
      FtthLab.getOpmPortWorld = getPortWorld;
      FtthLab.refreshOpmDocks = refreshDockReadings;
      FtthLab.getOpmDevices = function () {
        return devices.map(function (d) {
          return {
            id: d.id,
            x: d.x,
            y: d.y,
            docked: !!d.docked,
            reading: d.lastReading,
          };
        });
      };
      FtthLab.registerOpmRefresh(function () {
        refreshDockReadings();
      });
      if (FtthLab._launchTool === 'opm') {
        onLaunchRequest({ tool: 'opm' });
      }
    }
  }

  var tool = {
    id: 'opm',
    mount: mount,
    onLayoutChange: onLayoutChange,
    onLaunchRequest: onLaunchRequest,
    undo: function () {},
    redo: function () {},
    deleteSelected: deleteSelected,
    clearSelection: clearSelection,
    onToolboxClaim: onToolboxClaim,
    placeOpm: placeOpm,
    refreshDockReadings: refreshDockReadings,
  };

  function tryRegister() {
    if (global.FtthLab && typeof FtthLab.registerTool === 'function') {
      FtthLab.registerTool('opm', tool);
      return true;
    }
    return false;
  }

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
