/**
 * Viavi OLP-38 Optical Power Meter — dockable SC adapter on FTTH lab canvas.
 * Live dBm only when an SC Patch Cord / Pigtail is snapped into the metal port.
 */
(function (global) {
  'use strict';

  var OPM_W = 220;
  var OPM_H = 340;
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

  var WAVELENGTH_ORDER = [850, 980, 1310, 1490, 1550, 1625];
  var WAVELENGTH_HINT = {
    850: 'Legacy MM / VCSEL test band',
    980: 'EDFA pump · specialty sensing',
    1310: 'Upstream · ONU → OLT (GPON/EPON TX)',
    1490: 'Downstream · OLT → ONU (GPON primary)',
    1550: 'Long-haul SM · RF overlay / CATV',
    1625: 'Maintenance / OTDR band',
  };

  function resolveWavelengthNm() {
    if (global.PowerMeterTrainer && typeof PowerMeterTrainer.getWavelength === 'function') {
      var ext = Number(PowerMeterTrainer.getWavelength());
      if (isFinite(ext) && WAVELENGTH_ORDER.indexOf(ext) >= 0) {
        wavelengthNm = ext;
        return ext;
      }
    }
    if (global.FtthLab && typeof FtthLab.getOpmWavelength === 'function') {
      var wl = Number(FtthLab.getOpmWavelength());
      if (isFinite(wl) && WAVELENGTH_ORDER.indexOf(wl) >= 0) {
        wavelengthNm = wl;
        return wl;
      }
    }
    return wavelengthNm;
  }

  function resolveUnitMode() {
    if (global.PowerMeterTrainer && typeof PowerMeterTrainer.getUnit === 'function') {
      var u = PowerMeterTrainer.getUnit();
      if (u === 'mw' || u === 'dbm') {
        unitMode = u;
        return u;
      }
    }
    return unitMode;
  }

  function wavelengthHint(nm) {
    if (global.PowerMeterTrainer && typeof PowerMeterTrainer.getWavelengthHint === 'function') {
      return PowerMeterTrainer.getWavelengthHint(nm) || WAVELENGTH_HINT[nm] || '';
    }
    return WAVELENGTH_HINT[nm] || '';
  }

  function cycleLocalWavelength() {
    if (global.PowerMeterTrainer && typeof PowerMeterTrainer.cycleWavelength === 'function') {
      PowerMeterTrainer.cycleWavelength();
      return;
    }
    var ix = WAVELENGTH_ORDER.indexOf(resolveWavelengthNm());
    if (ix < 0) ix = WAVELENGTH_ORDER.indexOf(1490);
    wavelengthNm = WAVELENGTH_ORDER[(ix + 1) % WAVELENGTH_ORDER.length];
    if (global.FtthLab && typeof FtthLab.setOpmWavelength === 'function') {
      FtthLab.setOpmWavelength(wavelengthNm);
    } else {
      refreshDockReadings();
    }
    rebuildLayer();
  }

  function toggleLocalUnit() {
    if (global.PowerMeterTrainer && typeof PowerMeterTrainer.toggleUnit === 'function') {
      PowerMeterTrainer.toggleUnit();
      return;
    }
    unitMode = resolveUnitMode() === 'mw' ? 'dbm' : 'mw';
    rebuildLayer();
    lastBroadcast();
  }

  function toggleLocalStandard() {
    if (global.PowerMeterTrainer && typeof PowerMeterTrainer.toggleStandard === 'function') {
      PowerMeterTrainer.toggleStandard();
    }
  }

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
      return { x: d.x + OPM_W / 2, y: d.y + 12, rot: 0 };
    }
    var bore = el.querySelector('.viavi__adapter-knurl, .lab-opm__adapter-knurl') || el;
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
      if (c.sideA && c.sideA.attached && c.sideA.attached.owner === 'opm' && c.sideA.attached.opmId === opmId) return true;
      if (c.sideB && c.sideB.attached && c.sideB.attached.owner === 'opm' && c.sideB.attached.opmId === opmId) return true;
    }
    var pigtails = graph.pigtails || [];
    for (i = 0; i < pigtails.length; i++) {
      var p = pigtails[i];
      if (p.connector && p.connector.attached && p.connector.attached.owner === 'opm' && p.connector.attached.opmId === opmId) return true;
    }
    return false;
  }

  function isDockMismatch(opmId) {
    var graph = global.FtthLab && typeof FtthLab.getFiberLaserGraph === 'function'
      ? FtthLab.getFiberLaserGraph()
      : { pcords: [], pigtails: [] };
    var i;
    var pcords = graph.pcords || [];
    for (i = 0; i < pcords.length; i++) {
      var c = pcords[i];
      if (c.sideA && c.sideA.attached && c.sideA.attached.owner === 'opm' && c.sideA.attached.opmId === opmId && c.sideA.mismatch) return true;
      if (c.sideB && c.sideB.attached && c.sideB.attached.owner === 'opm' && c.sideB.attached.opmId === opmId && c.sideB.mismatch) return true;
    }
    var pigtails = graph.pigtails || [];
    for (i = 0; i < pigtails.length; i++) {
      var p = pigtails[i];
      if (p.connector && p.connector.attached && p.connector.attached.owner === 'opm' && p.connector.attached.opmId === opmId && p.connector.mismatch) return true;
    }
    return false;
  }

  function refreshDockReadings() {
    devices.forEach(function (d) {
      var occupied = isDockOccupied(d.id);
      d.docked = occupied;
      d.dockMismatch = occupied && isDockMismatch(d.id);
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
          d.lastReading.mismatch = d.dockMismatch;
        } else {
          d.lastReading = {
            dBm: reading && reading.dBm,
            lossDb: reading && reading.lossDb,
            source: reading && reading.source,
            label: 'SIGNAL LOW',
            path: (reading && reading.path) || [],
            note: (reading && reading.note) || 'No optical path to OLT',
            docked: true,
            mismatch: d.dockMismatch,
          };
        }
      }
    });
    lastBroadcast();
    rebuildLayer();
    updateInspector();
  }

  function lastBroadcast() {
    var primary = null;
    var i;
    for (i = devices.length - 1; i >= 0; i--) {
      if (devices[i].docked) {
        primary = devices[i];
        break;
      }
    }
    if (!primary) primary = devices.length ? devices[devices.length - 1] : null;
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
    bindKeypadDelegation(layer);
    return layer;
  }

  function softUnitLabel(mode) {
    return mode === 'mw' ? 'Pow. [W]' : 'dBm';
  }

  function screenMarkup(d) {
    var r = d.lastReading;
    var main;
    var unit = '';
    var mode = resolveUnitMode();
    var idle = !d.docked || !r || !isFinite(r.dBm) || !r.source;
    if (idle) {
      main = 'SIGNAL LOW';
    } else if (mode === 'mw') {
      main = formatMw(r.dBm) || '——.—';
    } else {
      main = formatDbm(r.dBm);
      unit = 'dBm';
    }
    var wl = resolveWavelengthNm();
    var softUnit = softUnitLabel(mode);
    return (
      '<div class="viavi__lcd" aria-live="polite">' +
      '<div class="viavi__lcd-top">' +
      '<span class="viavi__lcd-mode">Broadband / Expert</span>' +
      '<span class="viavi__lcd-clock" aria-label="Session timer">' +
      '<svg class="viavi__lcd-clock-icon" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">' +
      '<circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.2"/>' +
      '<path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' +
      '</svg>' +
      '<span class="viavi__lcd-clock-val">00:00</span>' +
      '</span>' +
      '</div>' +
      '<div class="viavi__lcd-main' + (idle ? ' is-idle' : ' is-live') + '">' +
      '<span class="viavi__lcd-value">' + main + '</span>' +
      (unit ? '<span class="viavi__lcd-unit">' + unit + '</span>' : '') +
      '</div>' +
      '<div class="viavi__lcd-soft">' +
      '<span class="viavi__soft-key viavi__lambda-chip">' + wl + ' nm</span>' +
      '<span class="viavi__soft-key viavi__soft-ref">Abs&gt;Ref</span>' +
      '<span class="viavi__soft-key viavi__soft-unit">' + softUnit + '</span>' +
      '</div>' +
      '</div>'
    );
  }

  function closestEl(start, sel) {
    var t = start;
    if (t && t.nodeType === 3) t = t.parentElement;
    return t && t.closest ? t.closest(sel) : null;
  }

  function isOpmKeyTarget(e) {
    return !!closestEl(e.target, '.lab-opm .viavi__key, .lab-opm .viavi__keys, .lab-opm button');
  }

  function handleOpmKey(btn) {
    if (!btn) return;
    if (btn.hasAttribute('data-opm-wave-cycle')) {
      cycleLocalWavelength();
      return;
    }
    if (btn.hasAttribute('data-opm-mode')) {
      toggleLocalUnit();
      return;
    }
    if (btn.hasAttribute('data-opm-std-cycle')) {
      toggleLocalStandard();
      return;
    }
    if (btn.hasAttribute('data-opm-save')) {
      if (global.PowerMeterTrainer && typeof PowerMeterTrainer.takeSnapshot === 'function') {
        PowerMeterTrainer.takeSnapshot();
      } else {
        setStatus('OLP-38 · SAVE');
      }
      return;
    }
    if (btn.hasAttribute('data-opm-ref')) {
      var trainerRef = document.getElementById('opm-btn-ref');
      if (trainerRef) trainerRef.click();
    }
  }

  function bindKeypadDelegation(host) {
    if (!host || host.dataset.opmKeypadBound === '1') return;
    host.dataset.opmKeypadBound = '1';

    host.addEventListener('pointerdown', function (e) {
      if (!isOpmKeyTarget(e)) return;
      e.stopPropagation();
    }, true);

    host.addEventListener('pointerup', function (e) {
      if (!isOpmKeyTarget(e)) return;
      e.stopPropagation();
    }, true);

    host.addEventListener('click', function (e) {
      var btn = closestEl(
        e.target,
        '[data-opm-wave-cycle], [data-opm-mode], [data-opm-save], [data-opm-std-cycle], [data-opm-ref], [data-opm-pwr]'
      );
      if (!btn || !btn.closest('.lab-opm')) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      handleOpmKey(btn);
    }, true);
  }

  function rebuildLayer() {
    var host = ensureLayer();
    if (!host) return;

    var html = '';
    devices.forEach(function (d) {
      var sel = selection.kind === 'opm' && selection.id === d.id ? ' is-selected' : '';
      var mismatch = d.dockMismatch ? ' is-mismatch' : '';
      var warn = d.docked && d.lastReading && !d.lastReading.source ? ' is-warning' : '';
      var portCls = 'viavi__port lab-opm-port' + (d.docked ? ' is-occupied' : '') + mismatch + warn;
      var dockedAttr = d.docked ? '1' : '0';
      var mismatchAttr = d.dockMismatch ? '1' : '0';
      var warnAttr = warn ? '1' : '0';
      html +=
        '<div class="lab-opm lab-opm--viavi' + sel + (d.docked ? ' is-docked' : '') +
        '" data-opm-node="' + d.id + '" style="left:' + d.x + 'px;top:' + d.y + 'px">' +
        '<div class="viavi" data-docked="' + dockedAttr +
        '" data-mismatch="' + mismatchAttr + '" data-warning="' + warnAttr + '">' +
        '<div class="viavi__bumper viavi__bumper--tl" aria-hidden="true"></div>' +
        '<div class="viavi__bumper viavi__bumper--tr" aria-hidden="true"></div>' +
        '<div class="viavi__bumper viavi__bumper--bl" aria-hidden="true"></div>' +
        '<div class="viavi__bumper viavi__bumper--br" aria-hidden="true"></div>' +
        '<div class="viavi__face" data-opm-drag="' + d.id + '">' +
        '<div class="' + portCls +
        '" data-opm-port="' + d.id + '" data-opm-connector="SC" title="SC optical adapter · dock patch/pigtail here">' +
        '<span class="viavi__adapter-base" aria-hidden="true"></span>' +
        '<span class="viavi__adapter-knurl" aria-hidden="true"></span>' +
        '<span class="viavi__adapter-bore" aria-hidden="true"></span>' +
        '</div>' +
        '<div class="viavi__badge">VIAVI</div>' +
        screenMarkup(d) +
        '<div class="viavi__keys">' +
        '<button type="button" class="viavi__key viavi__key--lambda" data-opm-wave-cycle title="Wavelength — cycle λ" aria-label="Cycle wavelength">λ</button>' +
        '<button type="button" class="viavi__key" data-opm-std-cycle title="Standard"></button>' +
        '<button type="button" class="viavi__key" data-opm-ref title="Set REF"></button>' +
        '<button type="button" class="viavi__key viavi__key--mode" data-opm-mode title="MODE — toggle dBm / mW" aria-label="Toggle dBm and mW">MODE</button>' +
        '<button type="button" class="viavi__key viavi__key--save" data-opm-save title="SAVE">SAVE</button>' +
        '<button type="button" class="viavi__key viavi__key--pwr" data-opm-pwr title="Power" aria-label="Power">⏻</button>' +
        '</div>' +
        '<div class="viavi__model">OLP-38</div>' +
        '</div></div></div>';
    });
    host.innerHTML = html;
    bindLayerEvents(host);
    if (global.PowerMeterTrainer && typeof PowerMeterTrainer.refreshViaviClocks === 'function') {
      PowerMeterTrainer.refreshViaviClocks();
    }
  }

  function bindLayerEvents(host) {
    host.querySelectorAll('[data-opm-drag]').forEach(function (grip) {
      grip.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        if (isOpmKeyTarget(e)) return;
        if (closestEl(e.target, '.lab-opm-port, .viavi__lcd')) return;
        e.preventDefault();
        e.stopPropagation();
        var id = grip.getAttribute('data-opm-drag');
        var d = findDevice(id);
        if (!d) return;
        selectOpm(id, { skipRebuild: true });
        var zoom = getZoom() || 1;
        var sx = e.clientX;
        var sy = e.clientY;
        var ox = d.x;
        var oy = d.y;
        var node = host.querySelector('[data-opm-node="' + id + '"]');
        if (node) node.classList.add('is-dragging', 'is-selected');

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

  function selectOpm(id, opts) {
    opts = opts || {};
    selection = { kind: 'opm', id: id };
    claimSelection();
    renderToolbox();
    if (opts.skipRebuild) {
      if (layer) {
        layer.querySelectorAll('[data-opm-node]').forEach(function (n) {
          n.classList.toggle('is-selected', n.getAttribute('data-opm-node') === id);
        });
      }
    } else {
      rebuildLayer();
    }
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
      (r && isFinite(r.dBm) ? formatDbm(r.dBm) + ' dBm' : (r && r.label === 'UNCONNECTED' ? 'SIGNAL LOW' : (r && r.label) || 'SIGNAL LOW')) +
      '</strong></div>' +
      '<div><span>λ</span><strong>' + resolveWavelengthNm() + ' nm</strong></div>' +
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
