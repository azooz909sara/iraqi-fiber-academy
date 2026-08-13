/**
 * Viavi OLS-35 Optical Laser Source — fixed 5×7 grid footprint (same as OLP-38).
 * Top SC adapter docks Patch Cord / Pigtail (cable exits straight up).
 * Laser ON injects CW / tone power into the optical graph.
 */
(function (global) {
  'use strict';

  var OLS_GRID = 24;
  var OLS_W = 5 * OLS_GRID; /* 120 */
  var OLS_H = 7 * OLS_GRID; /* 168 */
  var OLS_DESIGN_W = 220;
  var OLS_FIT = OLS_W / OLS_DESIGN_W;
  var HISTORY_MAX = 40;

  var WAVELENGTH_ORDER = [1310, 1550];
  var MOD_ORDER = ['CW', '270', '330', '1000', '2000'];
  var CW_DBM = -3;
  var MOD_DBM = -6;

  var ctx = null;
  var layer = null;
  var devices = [];
  var seq = 0;
  var selection = { kind: 'none', id: null };
  var selectedTool = null;
  var history = [];
  var historyIndex = -1;
  var historyLocked = false;
  var sessionStarted = Date.now();

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
      FtthLab.setSelectionOwner('ols');
    }
  }

  function findDevice(id) {
    for (var i = 0; i < devices.length; i++) {
      if (devices[i].id === id) return devices[i];
    }
    return null;
  }

  function defaultPos() {
    var c = (global.FtthLab && typeof FtthLab.getViewportCenterWorld === 'function')
      ? FtthLab.getViewportCenterWorld()
      : { x: getWorldSize() / 2, y: getWorldSize() / 2 };
    var n = devices.length;
    return {
      x: Math.round(c.x - OLS_W / 2 + (n % 3) * 28),
      y: Math.round(c.y - OLS_H / 2 + Math.floor(n / 3) * 24),
    };
  }

  function outputDbm(d) {
    if (!d || !d.poweredOn || !d.laserOn) return null;
    return d.modulation === 'CW' ? CW_DBM : MOD_DBM;
  }

  function modLabel(mod) {
    if (mod === 'CW') return 'CW';
    return String(mod) + ' Hz';
  }

  function formatClock() {
    var sec = Math.floor((Date.now() - sessionStarted) / 1000);
    var mm = String(Math.floor(sec / 60)).padStart(2, '0');
    var ss = String(sec % 60).padStart(2, '0');
    return mm + ':' + ss;
  }

  function getPortWorld(olsId) {
    var el = document.querySelector('.lab-ols-port[data-ols-port="' + olsId + '"]');
    if (!el) {
      var d = findDevice(olsId);
      if (!d) return null;
      return { x: d.x + OLS_W / 2, y: d.y + Math.round(12 * OLS_FIT), rot: 180 };
    }
    var knurl = el.querySelector('.viavi__adapter-knurl, .lab-ols__adapter-knurl') || el;
    var r = knurl.getBoundingClientRect();
    var pt = clientToWorld(r.left + r.width / 2, r.top + r.height * 0.35);
    return { x: pt.x, y: pt.y, rot: 180 };
  }

  function sideIsOls(side, olsId) {
    if (!side) return false;
    var att = side.attached || side;
    return !!(att && att.owner === 'ols' && att.olsId === olsId);
  }

  function isDockOccupied(olsId) {
    var graph = global.FtthLab && typeof FtthLab.getFiberLaserGraph === 'function'
      ? FtthLab.getFiberLaserGraph()
      : { pcords: [], pigtails: [] };
    var i;
    var pcords = graph.pcords || [];
    for (i = 0; i < pcords.length; i++) {
      var c = pcords[i];
      if (sideIsOls(c.sideA, olsId) || sideIsOls(c.sideB, olsId)) return true;
    }
    var pigtails = graph.pigtails || [];
    for (i = 0; i < pigtails.length; i++) {
      var p = pigtails[i];
      var conn = p.connector && (p.connector.attached || p.connector);
      if (conn && conn.owner === 'ols' && conn.olsId === olsId) return true;
    }
    return false;
  }

  function refreshDockState() {
    devices.forEach(function (d) {
      d.docked = isDockOccupied(d.id);
    });
    rebuildLayer();
    updateInspector();
    if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
      FtthLab.notifyLayoutChange({ source: 'ols' });
    }
  }

  function getOlsTxSources() {
    var out = [];
    devices.forEach(function (d) {
      if (!d.poweredOn || !d.laserOn) return;
      var tx = outputDbm(d);
      if (tx == null) return;
      out.push({
        key: 'ols:' + d.id,
        kind: 'ols',
        txDbm: tx,
        wavelengthNm: d.wavelength,
        modulation: d.modulation,
        label: 'OLS-35 · ' + d.wavelength + ' nm · ' + modLabel(d.modulation),
        olsId: d.id,
      });
    });
    return out;
  }

  function ensureLayer() {
    if (layer && layer.parentNode) return layer;
    var mount = document.getElementById('lab-2d-mount');
    if (!mount) return null;
    layer = document.createElement('div');
    layer.className = 'lab-ols-layer';
    layer.setAttribute('data-lab-ols-layer', '1');
    mount.appendChild(layer);
    bindKeypadDelegation(layer);
    return layer;
  }

  function screenMarkup(d) {
    if (!d.poweredOn) {
      return '<div class="viavi__lcd ols__lcd ols__lcd--off" aria-live="polite"></div>';
    }
    var power = outputDbm(d);
    var powerTxt = d.laserOn && power != null
      ? (power >= 0 ? '+' : '') + power.toFixed(2) + ' dBm'
      : 'LASER OFF';
    var band = d.autoLambda ? 'Auto-λ' : 'Single-λ';
    var clock = formatClock();
    return (
      '<div class="viavi__lcd ols__lcd" aria-live="polite">' +
      '<div class="viavi__lcd-top">' +
      '<span class="viavi__lcd-mode">' + band + '</span>' +
      '<span class="viavi__lcd-clock" aria-label="Session timer">' +
      '<svg class="viavi__lcd-clock-icon" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">' +
      '<circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.2"/>' +
      '<path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' +
      '</svg>' +
      '<span class="viavi__lcd-clock-val">' + clock + '</span>' +
      '<span class="ols__batt" aria-hidden="true">▮▮▮</span>' +
      '</span>' +
      '</div>' +
      '<div class="viavi__lcd-main' + (d.laserOn ? ' is-live' : ' is-idle') + '">' +
      '<span class="viavi__lcd-value ols__wl">' + d.wavelength + ' nm</span>' +
      '</div>' +
      '<div class="viavi__lcd-soft ols__lcd-soft">' +
      '<span class="viavi__soft-key">' + powerTxt + '</span>' +
      '<span class="viavi__soft-key">' + modLabel(d.modulation) + '</span>' +
      '<span class="viavi__soft-key">' + (d.laserOn ? 'TX ON' : 'TX OFF') + '</span>' +
      '</div>' +
      '</div>'
    );
  }

  function closestEl(start, sel) {
    var t = start;
    if (t && t.nodeType === 3) t = t.parentElement;
    return t && t.closest ? t.closest(sel) : null;
  }

  function isOlsKeyTarget(e) {
    return !!closestEl(e.target, '.lab-ols .viavi__key, .lab-ols .viavi__keys, .lab-ols .ols__pad, .lab-ols .ols__pwr, .lab-ols button');
  }

  function cycleWavelength(d) {
    if (!d.poweredOn) return;
    var ix = WAVELENGTH_ORDER.indexOf(d.wavelength);
    if (ix < 0) ix = 0;
    d.wavelength = WAVELENGTH_ORDER[(ix + 1) % WAVELENGTH_ORDER.length];
    rebuildLayer();
    updateInspector();
    pushHistory();
    notifyOptical();
    setStatus('OLS-35 · λ ' + d.wavelength + ' nm');
  }

  function cycleModulation(d) {
    if (!d.poweredOn) return;
    var ix = MOD_ORDER.indexOf(d.modulation);
    if (ix < 0) ix = 0;
    d.modulation = MOD_ORDER[(ix + 1) % MOD_ORDER.length];
    rebuildLayer();
    updateInspector();
    pushHistory();
    notifyOptical();
    setStatus('OLS-35 · ' + modLabel(d.modulation) + ' · ' +
      (d.modulation === 'CW' ? CW_DBM : MOD_DBM) + ' dBm');
  }

  function toggleLaser(d) {
    if (!d.poweredOn) {
      setStatus('OLS-35 powered off · press green power first');
      return;
    }
    d.laserOn = !d.laserOn;
    rebuildLayer();
    updateInspector();
    pushHistory();
    notifyOptical();
    setStatus(d.laserOn
      ? 'OLS-35 laser ON · ' + d.wavelength + ' nm · ' + (outputDbm(d)) + ' dBm'
      : 'OLS-35 laser OFF');
  }

  function toggleAutoLambda(d) {
    if (!d.poweredOn) return;
    d.autoLambda = !d.autoLambda;
    rebuildLayer();
    updateInspector();
    pushHistory();
    setStatus('OLS-35 · ' + (d.autoLambda ? 'Auto-λ' : 'Single-λ'));
  }

  function togglePower(d) {
    d.poweredOn = !d.poweredOn;
    if (!d.poweredOn) d.laserOn = false;
    rebuildLayer();
    updateInspector();
    pushHistory();
    notifyOptical();
    setStatus(d.poweredOn ? 'OLS-35 powered on' : 'OLS-35 powered off');
  }

  function notifyOptical() {
    if (global.FtthLab && typeof FtthLab.refreshOpmDocks === 'function') {
      FtthLab.refreshOpmDocks();
    }
    if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
      FtthLab.notifyLayoutChange({ source: 'ols' });
    }
    if (global.FtthLab && typeof FtthLab.refreshPowerBudget === 'function') {
      FtthLab.refreshPowerBudget();
    }
  }

  function handleOlsKey(btn) {
    if (!btn) return;
    var node = btn.closest('[data-ols-node]');
    var id = node && node.getAttribute('data-ols-node');
    var d = findDevice(id);
    if (!d) return;
    selectOls(id, { skipRebuild: true });
    if (btn.hasAttribute('data-ols-power')) {
      togglePower(d);
      return;
    }
    if (btn.hasAttribute('data-ols-wave-cycle')) {
      cycleWavelength(d);
      return;
    }
    if (btn.hasAttribute('data-ols-hz')) {
      cycleModulation(d);
      return;
    }
    if (btn.hasAttribute('data-ols-laser')) {
      toggleLaser(d);
      return;
    }
    if (btn.hasAttribute('data-ols-mode')) {
      toggleAutoLambda(d);
    }
  }

  function bindKeypadDelegation(host) {
    if (!host || host.dataset.olsKeypadBound === '1') return;
    host.dataset.olsKeypadBound = '1';

    host.addEventListener('pointerdown', function (e) {
      if (!isOlsKeyTarget(e)) return;
      e.stopPropagation();
    }, true);

    host.addEventListener('pointerup', function (e) {
      if (!isOlsKeyTarget(e)) return;
      e.stopPropagation();
    }, true);

    host.addEventListener('click', function (e) {
      var btn = closestEl(
        e.target,
        '[data-ols-wave-cycle], [data-ols-hz], [data-ols-mode], [data-ols-laser], [data-ols-power]'
      );
      if (!btn || !btn.closest('.lab-ols')) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      handleOlsKey(btn);
    }, true);
  }

  function gearIconSvg() {
    return (
      '<svg class="ols__btn-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
      '<path fill="currentColor" d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.55-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.83 14.52a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.43.34.68.22l2.39-.96c.5.39 1.04.7 1.63.94l.36 2.54c.05.24.26.42.5.42h3.84c.24 0 .45-.18.5-.42l.36-2.54c.59-.24 1.13-.55 1.63-.94l2.39.96c.25.1.54 0 .68-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/>' +
      '</svg>'
    );
  }

  function laserIconSvg() {
    /* Laser radiation burst + beam (matches OLS-35 ON/OFF legend) */
    return (
      '<svg class="ols__btn-icon ols__laser-icon" viewBox="0 0 24 24" width="16" height="14" aria-hidden="true">' +
      '<circle cx="8" cy="12" r="2.2" fill="currentColor"/>' +
      '<path fill="currentColor" d="M8 4.5l.7 2.4L11 8l-2.3 1.1L8 11.5l-.7-2.4L5 8l2.3-1.1L8 4.5zm0 9l.7 2.4L11 17l-2.3 1.1L8 20.5l-.7-2.4L5 17l2.3-1.1L8 13.5z"/>' +
      '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M11.5 12H21"/>' +
      '<path fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" d="M14 9.5l5.5 0M14 14.5l5.5 0"/>' +
      '</svg>'
    );
  }

  function powerIconSvg() {
    return (
      '<svg class="ols__pwr-icon" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">' +
      '<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" ' +
      'd="M12 3.5v8M7.2 6.2a7 7 0 1 0 9.6 0"/>' +
      '</svg>'
    );
  }

  function keypadMarkup(d) {
    var laserOn = d.laserOn ? ' is-on' : '';
    var powered = d.poweredOn ? ' is-powered' : '';
    return (
      '<div class="ols__pad">' +
      '<div class="ols__ridges" aria-hidden="true">' +
      '<span></span><span></span><span></span>' +
      '</div>' +
      '<div class="viavi__keys ols__keys" role="group" aria-label="OLS-35 keypad">' +
      '<button type="button" class="viavi__key ols__key ols__key--soft ols__key--lambda" ' +
      'data-ols-wave-cycle title="Wavelength" aria-label="Cycle wavelength">λ</button>' +
      '<button type="button" class="viavi__key ols__key ols__key--soft ols__key--neutral" ' +
      'disabled aria-label="Unused softkey" tabindex="-1"></button>' +
      '<button type="button" class="viavi__key ols__key ols__key--soft ols__key--hz" ' +
      'data-ols-hz title="Modulation / Hz" aria-label="Cycle modulation frequency">HZ</button>' +
      '<button type="button" class="viavi__key ols__key ols__key--large ols__key--mode" ' +
      'data-ols-mode title="MODE — Single-λ / Auto-λ" aria-label="Mode settings">' +
      '<span class="ols__key-stack">' + gearIconSvg() + '<span class="ols__key-label">MODE</span></span>' +
      '</button>' +
      '<button type="button" class="viavi__key ols__key ols__key--large ols__key--laser' + laserOn + '" ' +
      'data-ols-laser title="Laser ON/OFF" aria-label="Laser on or off" aria-pressed="' +
      (d.laserOn ? 'true' : 'false') + '">' +
      '<span class="ols__key-stack">' + laserIconSvg() + '<span class="ols__key-label">ON/OFF</span></span>' +
      '</button>' +
      '</div>' +
      '<button type="button" class="ols__pwr' + powered + '" data-ols-power ' +
      'title="Power" aria-label="Device power" aria-pressed="' +
      (d.poweredOn ? 'true' : 'false') + '">' + powerIconSvg() + '</button>' +
      '</div>'
    );
  }

  function rebuildLayer() {
    var host = ensureLayer();
    if (!host) return;

    var html = '';
    devices.forEach(function (d) {
      var sel = selection.kind === 'ols' && selection.id === d.id ? ' is-selected' : '';
      var laser = d.laserOn ? ' is-laser-on' : '';
      var powered = d.poweredOn ? ' is-powered' : ' is-powered-off';
      var docked = d.docked ? ' is-docked' : '';
      var portCls = 'viavi__port lab-ols-port' + (d.docked ? ' is-occupied' : '') +
        (d.laserOn ? ' is-emitting' : '');
      html +=
        '<div class="lab-ols lab-ols--viavi lab-ols--fixed' + sel + laser + powered + docked +
        '" data-ols-node="' + d.id + '" style="left:' + d.x + 'px;top:' + d.y + 'px">' +
        '<div class="viavi ols-viavi" data-laser="' + (d.laserOn ? '1' : '0') +
        '" data-powered="' + (d.poweredOn ? '1' : '0') +
        '" data-docked="' + (d.docked ? '1' : '0') + '">' +
        '<div class="viavi__bumper viavi__bumper--tl" aria-hidden="true"></div>' +
        '<div class="viavi__bumper viavi__bumper--tr" aria-hidden="true"></div>' +
        '<div class="viavi__bumper viavi__bumper--bl" aria-hidden="true"></div>' +
        '<div class="viavi__bumper viavi__bumper--br" aria-hidden="true"></div>' +
        '<div class="viavi__face" data-ols-drag="' + d.id + '">' +
        '<div class="' + portCls +
        '" data-ols-port="' + d.id + '" data-ols-connector="SC" title="SC optical adapter · dock patch/pigtail here">' +
        '<span class="viavi__adapter-base" aria-hidden="true"></span>' +
        '<span class="viavi__adapter-knurl lab-ols__adapter-knurl" aria-hidden="true"></span>' +
        '<span class="viavi__adapter-bore" aria-hidden="true"></span>' +
        '</div>' +
        '<div class="viavi__badge">VIAVI</div>' +
        screenMarkup(d) +
        keypadMarkup(d) +
        '<div class="viavi__model">OLS-35</div>' +
        '</div></div></div>';
    });
    host.innerHTML = html;
    bindLayerEvents(host);
  }

  function bindLayerEvents(host) {
    host.querySelectorAll('[data-ols-drag]').forEach(function (grip) {
      grip.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        if (isOlsKeyTarget(e)) return;
        if (closestEl(e.target, '.lab-ols-port, .viavi__lcd')) return;
        e.preventDefault();
        e.stopPropagation();
        var id = grip.getAttribute('data-ols-drag');
        var d = findDevice(id);
        if (!d) return;
        selectOls(id, { skipRebuild: true });
        var zoom = getZoom() || 1;
        var sx = e.clientX;
        var sy = e.clientY;
        var ox = d.x;
        var oy = d.y;
        var node = host.querySelector('[data-ols-node="' + id + '"]');
        if (node) node.classList.add('is-dragging', 'is-selected');

        function onMove(ev) {
          d.x = Math.round(ox + (ev.clientX - sx) / zoom);
          d.y = Math.round(oy + (ev.clientY - sy) / zoom);
          if (node) {
            node.style.left = d.x + 'px';
            node.style.top = d.y + 'px';
          }
          if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
            FtthLab.notifyLayoutChange({ source: 'ols', live: true, olsId: id });
          }
        }
        function onUp() {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          if (node) node.classList.remove('is-dragging');
          rebuildLayer();
          pushHistory();
          if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
            FtthLab.notifyLayoutChange({ source: 'ols', olsId: id });
          }
        }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    });
  }

  function placeOls(x, y) {
    seq += 1;
    var pos = (typeof x === 'number' && typeof y === 'number')
      ? { x: x, y: y }
      : defaultPos();
    var d = {
      id: 'ols-' + seq,
      x: pos.x,
      y: pos.y,
      wavelength: 1310,
      modulation: 'CW',
      laserOn: false,
      poweredOn: true,
      autoLambda: false,
      docked: false,
    };
    devices.push(d);
    selectOls(d.id);
    rebuildLayer();
    pushHistory();
    setStatus('Viavi OLS-35 placed · dock SC fiber · ON/OFF enables laser TX');
    return d;
  }

  function selectOls(id, opts) {
    opts = opts || {};
    selection = { kind: 'ols', id: id };
    claimSelection();
    renderToolbox();
    if (opts.skipRebuild) {
      if (layer) {
        layer.querySelectorAll('[data-ols-node]').forEach(function (n) {
          n.classList.toggle('is-selected', n.getAttribute('data-ols-node') === id);
        });
      }
    } else {
      rebuildLayer();
    }
    updateInspector();
  }

  function removeOls(id) {
    devices = devices.filter(function (d) { return d.id !== id; });
    if (selection.id === id) selection = { kind: 'none', id: null };
    rebuildLayer();
    updateInspector();
    pushHistory();
    notifyOptical();
  }

  function renderToolbox() {
    var host = document.getElementById('lab-ols-tree');
    if (!host) return;
    host.innerHTML =
      '<div class="lab-toolbox" role="list">' +
      '<button type="button" class="lab-tool lab-tool--ols' +
      (selectedTool === 'ols' ? ' is-selected' : '') +
      '" draggable="true" data-lab-tool="ols" role="listitem">' +
      '<span class="lab-tool__mark lab-tool__mark--ols" aria-hidden="true"></span>' +
      '<span class="lab-tool__copy">' +
      '<strong>Viavi OLS-35</strong>' +
      '<span>Laser source · SC dock</span>' +
      '</span>' +
      '</button>' +
      '</div>';
    bindToolbox(host);
  }

  function bindToolbox(host) {
    var btn = host.querySelector('[data-lab-tool="ols"]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('ols');
      }
      selectedTool = 'ols';
      renderToolbox();
      if (!devices.length) placeOls();
      else selectOls(devices[devices.length - 1].id);
    });
    btn.addEventListener('dragstart', function (e) {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('ols');
      }
      selectedTool = 'ols';
      if (global.FtthLab && FtthLab.beginDrag) {
        FtthLab.beginDrag({ kind: 'ols' });
      }
      try {
        e.dataTransfer.setData('text/plain', 'lab:ols');
        e.dataTransfer.setData('text/lab-drag', 'ols');
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
    if (!stage || stage.dataset.olsDropBound === '1') return;
    stage.dataset.olsDropBound = '1';
    stage.addEventListener('drop', function (e) {
      var drag = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
      if (!drag || drag.kind !== 'ols') return;
      e.preventDefault();
      var pt = clientToWorld(e.clientX, e.clientY);
      placeOls(Math.round(pt.x - OLS_W / 2), Math.round(pt.y - 24));
      if (global.FtthLab && FtthLab.endDrag) FtthLab.endDrag();
      selectedTool = 'ols';
      renderToolbox();
    });
  }

  function updateInspector() {
    var card = document.getElementById('lab-inspector-card');
    var detail = document.getElementById('lab-inspector-detail');
    if (!card || !detail) return;
    if (selection.kind !== 'ols' || !selection.id) {
      if (card.dataset.olsInspector === '1') {
        card.dataset.olsInspector = '';
        if (global.FtthLab && typeof FtthLab.resetInspectorIdle === 'function') {
          FtthLab.resetInspectorIdle();
        }
      }
      return;
    }
    var d = findDevice(selection.id);
    if (!d) return;
    card.dataset.olsInspector = '1';
    card.hidden = true;
    detail.hidden = false;
    var pwr = outputDbm(d);
    detail.innerHTML =
      '<div class="lab-inspector__card">' +
      '<h2>Viavi OLS-35</h2>' +
      '<p>Optical laser source · dock SC Patch/Pigtail · enable laser to inject light.</p>' +
      '<div class="lab-spl-sheet">' +
      '<div><span>Power</span><strong>' + (d.poweredOn ? 'ON' : 'OFF') + '</strong></div>' +
      '<div><span>Laser</span><strong>' + (d.laserOn ? 'ON' : 'OFF') + '</strong></div>' +
      '<div><span>λ</span><strong>' + d.wavelength + ' nm</strong></div>' +
      '<div><span>Hz</span><strong>' + modLabel(d.modulation) + '</strong></div>' +
      '<div><span>Output</span><strong>' +
      (pwr != null ? pwr.toFixed(2) + ' dBm' : '—') + '</strong></div>' +
      '<div><span>Dock</span><strong>' + (d.docked ? 'Occupied' : 'Open') + '</strong></div>' +
      '</div>' +
      '<button type="button" class="lab-eject-btn" data-remove-ols="' + d.id + '">Remove OLS-35</button>' +
      '</div>';
    var rm = detail.querySelector('[data-remove-ols]');
    if (rm) {
      rm.addEventListener('click', function () {
        removeOls(d.id);
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

  function onLayoutChange(payload) {
    if (payload && payload.source === 'ols' && payload.live) return;
    devices.forEach(function (d) {
      d.docked = isDockOccupied(d.id);
    });
    rebuildLayer();
  }

  function onLaunchRequest(payload) {
    if (!payload || payload.tool !== 'ols') return;
    selectedTool = 'ols';
    renderToolbox();
    if (!devices.length) placeOls();
    else selectOls(devices[0].id);
    if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
      FtthLab.claimToolboxTool('ols');
    }
  }

  function deleteSelected() {
    if (selection.kind === 'ols' && selection.id) {
      removeOls(selection.id);
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
    if (id === 'ols') return;
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
      FtthLab.getOlsPortWorld = getPortWorld;
      FtthLab.getOlsTxSources = getOlsTxSources;
      FtthLab.refreshOlsDocks = refreshDockState;
      FtthLab.getOlsDevices = function () {
        return devices.map(function (d) {
          return {
            id: d.id,
            x: d.x,
            y: d.y,
            wavelength: d.wavelength,
            modulation: d.modulation,
            laserOn: !!d.laserOn,
            poweredOn: d.poweredOn !== false,
            docked: !!d.docked,
            txDbm: outputDbm(d),
          };
        });
      };
      if (FtthLab._launchTool === 'ols') {
        onLaunchRequest({ tool: 'ols' });
      }
    }

    setInterval(function () {
      if (!layer) return;
      var t = formatClock();
      layer.querySelectorAll('.viavi__lcd-clock-val').forEach(function (el) {
        el.textContent = t;
      });
    }, 1000);
  }

  var tool = {
    id: 'ols',
    mount: mount,
    onLayoutChange: onLayoutChange,
    onLaunchRequest: onLaunchRequest,
    undo: function () {},
    redo: function () {},
    deleteSelected: deleteSelected,
    clearSelection: clearSelection,
    onToolboxClaim: onToolboxClaim,
    placeOls: placeOls,
  };

  function tryRegister() {
    if (global.FtthLab && typeof FtthLab.registerTool === 'function') {
      FtthLab.registerTool('ols', tool);
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
