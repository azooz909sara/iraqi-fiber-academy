/**
 * Optical Power Meter (OPM) — live dBm readings from FTTH lab topology.
 * Probes ports, connectors, and fiber paths; traces back to OLT TX sources.
 */
(function (global) {
  'use strict';

  var OPM_W = 118;
  var OPM_H = 72;
  var HISTORY_MAX = 40;

  var ctx = null;
  var layer = null;
  var devices = [];
  var seq = 0;
  var selection = { kind: 'none', id: null };
  var selectedTool = null;
  var probeMode = false;
  var lastReading = null;
  var lastProbeCoords = null;
  var history = [];
  var historyIndex = -1;
  var historyLocked = false;

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
      x: Math.round(w / 2 - 80 + devices.length * 36),
      y: Math.round(w / 2 + 120),
    };
  }

  function formatDbm(dBm) {
    if (dBm == null || !isFinite(dBm)) return '——.—';
    return (dBm >= 0 ? '+' : '') + dBm.toFixed(2);
  }

  function runProbe(clientX, clientY) {
    if (!global.FtthLab || typeof FtthLab.probeOpticalAt !== 'function') {
      return null;
    }
    var reading = FtthLab.probeOpticalAt(clientX, clientY);
    lastReading = reading;
    lastProbeCoords = { x: clientX, y: clientY };
    devices.forEach(function (d) {
      d.lastReading = reading;
      d.probeLabel = reading.label || '—';
    });
    rebuildLayer();
    updateInspector();
    if (reading && reading.source) {
      setStatus(
        'OPM · ' + formatDbm(reading.dBm) + ' dBm · ' +
        (reading.label || 'probe') + ' · loss ' + reading.lossDb.toFixed(2) + ' dB'
      );
    } else if (reading && reading.note) {
      setStatus('OPM · ' + reading.note);
    }
    return reading;
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

  function lcdMarkup(d) {
    var r = d.lastReading || lastReading;
    var dbm = r && r.dBm != null ? formatDbm(r.dBm) : '——.—';
    var sub = r && r.source
      ? '−' + (r.lossDb != null ? r.lossDb.toFixed(1) : '?') + ' dB'
      : (r && r.note ? 'no path' : 'probe');
    return (
      '<div class="lab-opm__lcd" aria-live="polite">' +
      '<span class="lab-opm__dbm">' + dbm + '</span>' +
      '<span class="lab-opm__unit">dBm</span>' +
      '<span class="lab-opm__sub">' + sub + '</span>' +
      '</div>'
    );
  }

  function rebuildLayer() {
    var host = ensureLayer();
    if (!host) return;

    var html = '';
    devices.forEach(function (d) {
      var sel = selection.kind === 'opm' && selection.id === d.id ? ' is-selected' : '';
      html +=
        '<div class="lab-opm' + sel + (probeMode ? ' is-probe-armed' : '') +
        '" data-opm-node="' + d.id + '" style="left:' + d.x + 'px;top:' + d.y + 'px">' +
        '<div class="lab-opm__body" data-opm-drag="' + d.id + '">' +
        '<span class="lab-opm__brand">OPM</span>' +
        lcdMarkup(d) +
        '<span class="lab-opm__lambda">λ 1490 nm · GPON</span>' +
        '</div>' +
        '<div class="lab-opm__probe-tip" title="Virtual probe port"></div>' +
        '</div>';
    });
    host.innerHTML = html;
    bindLayerEvents(host);
  }

  function bindLayerEvents(host) {
    host.querySelectorAll('[data-opm-drag]').forEach(function (grip) {
      grip.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
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
        }
        function onUp() {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          if (node) node.classList.remove('is-dragging');
          rebuildLayer();
          pushHistory();
        }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    });
  }

  function bindStageProbe() {
    var stage = document.getElementById('lab-canvas-2d');
    if (!stage || stage.dataset.opmProbeBound === '1') return;
    stage.dataset.opmProbeBound = '1';
    stage.addEventListener('pointerdown', function (e) {
      if (!probeMode || e.button !== 0) return;
      if (e.target.closest('.lab-opm, .lab-opm-layer, .lab-rail, .lab-inspector, .lab-header')) {
        return;
      }
      if (e.target.closest('[data-opm-drag]')) return;
      e.preventDefault();
      runProbe(e.clientX, e.clientY);
    }, true);
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
      lastReading: null,
      probeLabel: '—',
    };
    devices.push(d);
    selectOpm(d.id);
    probeMode = true;
    rebuildLayer();
    pushHistory();
    setStatus('OPM placed · click any port, connector, or fiber to measure dBm');
    return d;
  }

  function selectOpm(id) {
    selection = { kind: 'opm', id: id };
    claimSelection();
    probeMode = true;
    renderToolbox();
    document.body.classList.toggle('lab-opm-probing', probeMode);
    rebuildLayer();
    updateInspector();
  }

  function removeOpm(id) {
    devices = devices.filter(function (d) { return d.id !== id; });
    if (selection.id === id) selection = { kind: 'none', id: null };
    if (!devices.length) probeMode = false;
    document.body.classList.toggle('lab-opm-probing', probeMode);
    rebuildLayer();
    updateInspector();
    pushHistory();
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
      '<strong>Optical Power Meter</strong>' +
      '<span>Live dBm · topology probe</span>' +
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
      probeMode = true;
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
      placeOpm(Math.round(pt.x - OPM_W / 2), Math.round(pt.y - OPM_H / 2));
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

    var r = d.lastReading || lastReading;
    var pathHtml = '';
    if (r && r.path && r.path.length) {
      pathHtml = '<ol class="lab-opm-path">';
      r.path.forEach(function (node) {
        pathHtml += '<li>' + node + '</li>';
      });
      pathHtml += '</ol>';
    }

    detail.innerHTML =
      '<div class="lab-inspector__card lab-opm-inspector">' +
      '<h2>Optical Power Meter</h2>' +
      '<div class="lab-opm-inspector__lcd">' +
      '<span class="lab-opm-inspector__value">' + formatDbm(r && r.dBm) + '</span>' +
      '<span class="lab-opm-inspector__unit">dBm</span>' +
      '</div>' +
      '<p class="lab-opm-inspector__hint">' +
      (probeMode
        ? 'Probe armed — click a port, connector end, or fiber on the canvas.'
        : 'Enable probe mode to measure.') +
      '</p>' +
      '<div class="lab-spl-sheet">' +
      '<div><span>Probe</span><strong>' + (r && r.label ? r.label : '—') + '</strong></div>' +
      '<div><span>Path loss</span><strong>' +
      (r && r.lossDb != null ? r.lossDb.toFixed(2) + ' dB' : '—') +
      '</strong></div>' +
      '<div><span>Source</span><strong>' +
      (r && r.source ? r.source.label : '—') +
      '</strong></div>' +
      '<div><span>TX level</span><strong>' +
      (r && r.source ? '+' + r.source.txDbm.toFixed(1) + ' dBm' : '—') +
      '</strong></div>' +
      '</div>' +
      (pathHtml ? '<p class="lab-inspector__label">Optical path</p>' + pathHtml : '') +
      (r && r.note ? '<p class="lab-opm-note">' + r.note + '</p>' : '') +
      '<div class="lab-opm-inspector__actions">' +
      '<button type="button" class="lab-toggle-btn' + (probeMode ? ' is-active' : '') +
      '" data-opm-probe-toggle>' + (probeMode ? 'Probe ON' : 'Probe OFF') + '</button>' +
      '<button type="button" class="lab-eject-btn" data-remove-opm="' + d.id +
      '">Remove OPM</button>' +
      '</div>' +
      '</div>';

    var probeBtn = detail.querySelector('[data-opm-probe-toggle]');
    if (probeBtn) {
      probeBtn.addEventListener('click', function () {
        probeMode = !probeMode;
        document.body.classList.toggle('lab-opm-probing', probeMode);
        rebuildLayer();
        updateInspector();
      });
    }
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

  function refreshFromTopology() {
    if (lastProbeCoords && global.FtthLab && typeof FtthLab.probeOpticalAt === 'function') {
      var reading = FtthLab.probeOpticalAt(lastProbeCoords.x, lastProbeCoords.y);
      lastReading = reading;
      devices.forEach(function (d) {
        d.lastReading = reading;
        d.probeLabel = reading.label || '—';
      });
    }
    rebuildLayer();
    updateInspector();
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
    refreshFromTopology();
    if (global.FtthLab && typeof FtthLab.refreshPowerBudget === 'function') {
      FtthLab.refreshPowerBudget();
    }
  }

  function onLaunchRequest(payload) {
    if (!payload || payload.tool !== 'opm') return;
    selectedTool = 'opm';
    probeMode = true;
    renderToolbox();
    document.body.classList.toggle('lab-opm-probing', probeMode);
    if (!devices.length) {
      var w = getWorldSize();
      placeOpm(Math.round(w / 2 - 60), Math.round(w / 2 + 100));
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
    probeMode = false;
    document.body.classList.remove('lab-opm-probing');
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
    probeMode = false;
    lastReading = null;
    history = [];
    historyIndex = -1;
    renderToolbox();
    bindStageDrop();
    bindStageProbe();
    ensureLayer();
    rebuildLayer();

    if (global.FtthLab) {
      FtthLab.registerOpmRefresh(function () {
        refreshFromTopology();
        updateInspector();
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
    runProbe: runProbe,
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
