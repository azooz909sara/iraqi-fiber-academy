/**
 * Visual Fault Locator (VFL) — laser pen for continuity / fault location.
 * Tip docks on patch-cord ends, pigtail connectors, or SC coupler ports;
 * when powered, injects a visible red glow along continuous fiber paths.
 */
(function (global) {
  'use strict';

  var VFL_W = 28;
  var VFL_H = 78;
  /* Center of exposed 2.5 mm SC adapter ferrule — plug target for Patch Cord / Pigtail */
  var PORT_LOCAL_X = 14;
  var PORT_LOCAL_Y = 9;
  var HISTORY_MAX = 60;

  var ctx = null;
  var layer = null;
  var devices = [];
  var seq = 0;
  var selection = { kind: 'none', id: null };
  var dragLib = null;
  var selectedTool = null;
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
      FtthLab.setSelectionOwner('vfl');
    }
  }

  function cloneJson(v) {
    return JSON.parse(JSON.stringify(v == null ? null : v));
  }

  function findDevice(id) {
    for (var i = 0; i < devices.length; i++) {
      if (devices[i].id === id) return devices[i];
    }
    return null;
  }

  function dist2(ax, ay, bx, by) {
    var dx = ax - bx;
    var dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function portWorld(d) {
    return { x: d.x + PORT_LOCAL_X, y: d.y + PORT_LOCAL_Y };
  }

  function getVflPortWorld(vflId) {
    var d = findDevice(vflId);
    if (!d) return null;
    var pw = portWorld(d);
    return { x: pw.x, y: pw.y, rot: 180 };
  }

  /** What is currently seated in this VFL's open SC adapter (from fiber graph). */
  function syncPortPlugState(d) {
    if (!d) return;
    d.plugged = null;
    var graph = null;
    if (global.FtthLab && typeof FtthLab.getFiberLaserGraph === 'function') {
      graph = FtthLab.getFiberLaserGraph();
    }
    graph = graph || { pcords: [], pigtails: [] };
    var i;
    var end;
    var att;
    for (i = 0; i < (graph.pcords || []).length; i++) {
      var c = graph.pcords[i];
      ['A', 'B'].forEach(function (e) {
        if (d.plugged) return;
        att = e === 'A' ? c.sideA : c.sideB;
        if (att && att.owner === 'vfl' && att.vflId === d.id) {
          d.plugged = {
            kind: 'pcord',
            id: c.id,
            end: e,
            label: 'SC Patch Cord · End ' + e,
          };
        }
      });
    }
    for (i = 0; i < (graph.pigtails || []).length; i++) {
      var p = graph.pigtails[i];
      if (d.plugged) break;
      att = p.connector;
      if (att && att.owner === 'vfl' && att.vflId === d.id) {
        d.plugged = {
          kind: 'pigtail',
          id: p.id,
          end: 'A',
          label: 'SC Pigtail · Connector',
        };
      }
    }
  }

  function normalizeMode(v) {
    var s = String(v || '').toUpperCase();
    if (s === 'CW' || s === 'ON' || s === '1' || s === 'TRUE' || s === 'CONTINUOUS') return 'CW';
    if (s === 'GLINT' || s === 'PULSE' || s === 'FLASH' || s === 'BLINK') return 'GLINT';
    return 'OFF';
  }

  function modeLabel(mode) {
    mode = normalizeMode(mode);
    if (mode === 'CW') return 'CW · Continuous';
    if (mode === 'GLINT') return 'GLINT · Pulsing';
    return 'OFF';
  }

  function isLaserOn(d) {
    return normalizeMode(d && d.mode) !== 'OFF';
  }

  /** Effective emit mode across all active VFLs with a plugged fiber (GLINT wins over CW). */
  function activeEmitMode() {
    var mode = 'OFF';
    devices.forEach(function (d) {
      if (!isLaserOn(d)) return;
      syncPortPlugState(d);
      if (!d.plugged) return;
      var m = normalizeMode(d.mode);
      if (m === 'GLINT') mode = 'GLINT';
      else if (m === 'CW' && mode !== 'GLINT') mode = 'CW';
    });
    return mode;
  }

  function migrateDevice(d) {
    if (!d) return d;
    if (!d.mode && typeof d.power === 'boolean') d.mode = d.power ? 'CW' : 'OFF';
    d.mode = normalizeMode(d.mode);
    delete d.power;
    delete d.attached;
    if (!('plugged' in d)) d.plugged = null;
    return d;
  }

  function captureSnapshot() {
    return { devices: cloneJson(devices), seq: seq };
  }

  function applySnapshot(snap) {
    if (!snap) return;
    historyLocked = true;
    devices = (cloneJson(snap.devices) || []).map(migrateDevice);
    seq = snap.seq || 0;
    selection = { kind: 'none', id: null };
    rebuildLayer();
    updateInspector();
    refreshLaserGlow();
    historyLocked = false;
  }

  function pushHistory() {
    if (historyLocked) return;
    history = history.slice(0, historyIndex + 1);
    history.push(captureSnapshot());
    if (history.length > HISTORY_MAX) history.shift();
    historyIndex = history.length - 1;
    if (historyIndex > 0 && global.FtthLab && typeof FtthLab.recordHistory === 'function') {
      FtthLab.recordHistory('vfl');
    }
  }

  function undo() {
    if (historyIndex <= 0) return false;
    historyIndex -= 1;
    applySnapshot(history[historyIndex]);
    setStatus('Undo · VFL');
    return true;
  }

  function redo() {
    if (historyIndex >= history.length - 1) return false;
    historyIndex += 1;
    applySnapshot(history[historyIndex]);
    setStatus('Redo · VFL');
    return true;
  }

  function defaultPos() {
    var w = getWorldSize();
    return {
      x: Math.round(w / 2 + 140 + devices.length * 24),
      y: Math.round(w / 2 + 280 + (devices.length % 3) * 36),
    };
  }

  function placeVfl(x, y) {
    seq += 1;
    var pos = (typeof x === 'number' && typeof y === 'number')
      ? { x: x, y: y }
      : defaultPos();
    var item = {
      id: 'vfl-' + seq,
      x: pos.x,
      y: pos.y,
      mode: 'OFF',
      plugged: null,
    };
    devices.push(item);
    selectVfl(item.id);
    rebuildLayer();
    pushHistory();
    refreshLaserGlow();
    setStatus('VFL placed · plug Patch Cord or SC Pigtail into central SC port · set CW or GLINT');
    return item;
  }

  function removeVfl(id) {
    devices = devices.filter(function (d) { return d.id !== id; });
    if (selection.id === id) selection = { kind: 'none', id: null };
    rebuildLayer();
    updateInspector();
    pushHistory();
    refreshLaserGlow();
    setStatus('VFL removed');
  }

  function selectVfl(id) {
    selection = { kind: 'vfl', id: id };
    claimSelection();
    updateInspector();
    rebuildLayer();
  }

  function setMode(id, mode) {
    var d = findDevice(id);
    if (!d) return;
    d.mode = normalizeMode(mode);
    rebuildLayer();
    updateInspector();
    pushHistory();
    refreshLaserGlow();
    setStatus('VFL · ' + modeLabel(d.mode) + ' · 650 nm · 10 mW');
  }

  /* ─── Laser propagation (emit from central SC adapter when fiber is plugged) ─── */

  function collectLaserTargets() {
    var pcords = {};
    var pigtails = {};
    var couplers = {};

    function markPcord(id) {
      if (!id || pcords[id]) return;
      pcords[id] = true;
    }
    function markPigtail(id) {
      if (!id || pigtails[id]) return;
      pigtails[id] = true;
    }
    function markCoupler(id) {
      if (!id || couplers[id]) return;
      couplers[id] = true;
    }

    var graph = null;
    if (global.FtthLab && typeof FtthLab.getFiberLaserGraph === 'function') {
      graph = FtthLab.getFiberLaserGraph();
    }
    graph = graph || { pcords: [], pigtails: [] };

    function fibersOnCouplerPort(cplId, port) {
      var list = [];
      (graph.pcords || []).forEach(function (c) {
        ['A', 'B'].forEach(function (end) {
          var att = end === 'A' ? c.sideA : c.sideB;
          if (att && att.owner === 'coupler' && att.couplerId === cplId &&
              String(att.port) === String(port)) {
            list.push({ kind: 'pcord', id: c.id, end: end });
          }
        });
      });
      (graph.pigtails || []).forEach(function (p) {
        var att = p.connector;
        if (att && att.owner === 'coupler' && att.couplerId === cplId &&
            String(att.port) === String(port)) {
          list.push({ kind: 'pigtail', id: p.id, end: 'A' });
        }
      });
      return list;
    }

    function injectPcord(id, fromEnd) {
      markPcord(id);
      var c = null;
      for (var i = 0; i < (graph.pcords || []).length; i++) {
        if (graph.pcords[i].id === id) { c = graph.pcords[i]; break; }
      }
      if (!c) return;
      var other = fromEnd === 'A' ? 'B' : 'A';
      var att = other === 'A' ? c.sideA : c.sideB;
      if (att && att.owner === 'coupler') {
        walkCoupler(att.couplerId, att.port);
      }
    }

    function injectPigtail(id) {
      markPigtail(id);
      var p = null;
      for (var i = 0; i < (graph.pigtails || []).length; i++) {
        if (graph.pigtails[i].id === id) { p = graph.pigtails[i]; break; }
      }
      if (!p || !p.connector) return;
      if (p.connector.owner === 'coupler') {
        walkCoupler(p.connector.couplerId, p.connector.port);
      }
    }

    function walkCoupler(cplId, entryPort) {
      if (!cplId || couplers[cplId + ':' + entryPort]) return;
      markCoupler(cplId);
      couplers[cplId + ':' + entryPort] = true;
      var other = entryPort === 'B' || entryPort === 'b' ? 'A' : 'B';
      /* Through-path: entry face → opposite face */
      fibersOnCouplerPort(cplId, other).forEach(function (f) {
        if (f.kind === 'pcord') injectPcord(f.id, f.end);
        else injectPigtail(f.id);
      });
      /* Also glow anything still on the entry face (VFL / dual plugs) */
      fibersOnCouplerPort(cplId, entryPort).forEach(function (f) {
        if (f.kind === 'pcord') markPcord(f.id);
        else markPigtail(f.id);
      });
    }

    devices.forEach(function (d) {
      if (!isLaserOn(d)) return;
      (graph.pcords || []).forEach(function (c) {
        ['A', 'B'].forEach(function (end) {
          var att = end === 'A' ? c.sideA : c.sideB;
          if (att && att.owner === 'vfl' && att.vflId === d.id) {
            injectPcord(c.id, end);
          }
        });
      });
      (graph.pigtails || []).forEach(function (p) {
        var att = p.connector;
        if (att && att.owner === 'vfl' && att.vflId === d.id) {
          injectPigtail(p.id);
        }
      });
    });

    return {
      mode: activeEmitMode(),
      pcords: Object.keys(pcords),
      pigtails: Object.keys(pigtails),
      couplers: Object.keys(couplers).reduce(function (acc, key) {
        var id = key.indexOf(':') >= 0 ? key.split(':')[0] : key;
        if (id && acc.indexOf(id) < 0) acc.push(id);
        return acc;
      }, []),
    };
  }

  function setFiberGlowClass(el, on, mode) {
    if (!el) return;
    el.classList.remove('is-vfl-glow', 'is-vfl-glow--cw', 'is-vfl-glow--glint');
    if (!on || !mode || mode === 'OFF') return;
    el.classList.add('is-vfl-glow');
    el.classList.add(mode === 'GLINT' ? 'is-vfl-glow--glint' : 'is-vfl-glow--cw');
  }

  function refreshLaserGlow() {
    var targets = collectLaserTargets();
    var cplMap = {};
    (targets.couplers || []).forEach(function (id) { cplMap[id] = true; });
    targets.couplers = Object.keys(cplMap);
    targets.mode = targets.mode || 'OFF';

    if (global.FtthLab) {
      FtthLab._vflGlow = targets;
    }
    if (global.FtthLab && typeof FtthLab.applyFiberLaserGlow === 'function') {
      FtthLab.applyFiberLaserGlow(targets);
    } else {
      applyDomGlow(targets);
    }
    document.querySelectorAll('.lab-cpl').forEach(function (el) {
      var id = el.getAttribute('data-cpl-node');
      setFiberGlowClass(el, !!(id && cplMap[id]), targets.mode);
    });
  }

  function applyDomGlow(targets) {
    var mode = (targets && targets.mode) || 'OFF';
    var pc = {};
    var pt = {};
    (targets.pcords || []).forEach(function (id) { pc[id] = true; });
    (targets.pigtails || []).forEach(function (id) { pt[id] = true; });
    document.querySelectorAll('[data-pcord-fiber]').forEach(function (el) {
      setFiberGlowClass(el, !!pc[el.getAttribute('data-pcord-fiber')], mode);
    });
    document.querySelectorAll('[data-pt-fiber]').forEach(function (el) {
      setFiberGlowClass(el, !!pt[el.getAttribute('data-pt-fiber')], mode);
    });
  }

  /* ─── Render ─── */

  function ensureLayer() {
    if (layer && layer.parentNode) return layer;
    var mount = document.getElementById('lab-2d-mount');
    if (!mount) return null;
    layer = document.createElement('div');
    layer.className = 'lab-vfl-layer';
    layer.setAttribute('data-lab-vfl-layer', '1');
    mount.appendChild(layer);
    return layer;
  }

  function deviceMarkup(d) {
    syncPortPlugState(d);
    var mode = normalizeMode(d.mode);
    var selected = selection.id === d.id ? ' is-selected' : '';
    var modeClass = ' is-mode-' + mode.toLowerCase();
    var plugged = d.plugged ? ' is-plugged' : '';
    var laserOn = mode !== 'OFF';
    var switchPos = mode === 'CW' ? '14%' : (mode === 'GLINT' ? '86%' : '50%');
    return (
      '<div class="lab-vfl' + selected + modeClass + plugged + '" data-vfl-node="' + d.id + '" ' +
      'style="left:' + Math.round(d.x) + 'px;top:' + Math.round(d.y) + 'px" ' +
      'title="Visual Fault Locator · 10 mW · 650 nm">' +
      '<div class="lab-vfl__head" aria-hidden="true">' +
      '<svg class="lab-vfl__flanges" viewBox="0 0 28 18" width="28" height="18" focusable="false">' +
      '<defs>' +
      '<linearGradient id="vfl-ear-' + d.id + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#1a1a1a"/>' +
      '<stop offset="100%" stop-color="#0a0a0a"/>' +
      '</linearGradient>' +
      '</defs>' +
      '<path fill="url(#vfl-ear-' + d.id + ')" d="' +
      'M0 18 L0 11 Q0 5 3 4 L5 3 Q7 1 9 4 L9 9 Q9 13 7 15 L5 17 Q2 18 0 18 Z' +
      '"/>' +
      '<path fill="url(#vfl-ear-' + d.id + ')" d="' +
      'M28 18 L28 11 Q28 5 25 4 L23 3 Q21 1 19 4 L19 9 Q19 13 21 15 L23 17 Q26 18 28 18 Z' +
      '"/>' +
      '<path fill="none" stroke="#262626" stroke-width="0.4" d="M3 12h3M3 14h3M3 16h3"/>' +
      '<path fill="none" stroke="#262626" stroke-width="0.4" d="M25 12h-3M25 14h-3M25 16h-3"/>' +
      '<ellipse cx="23" cy="3.2" rx="1.1" ry="0.7" fill="#f97316"/>' +
      '</svg>' +
      '<button type="button" class="lab-vfl-port' + (laserOn ? ' is-emitting' : '') +
      (d.plugged ? ' is-plugged' : '') + '" data-vfl-port="' + d.id + '" ' +
      'title="SC optical port · plug Patch Cord or SC Pigtail" ' +
      'aria-label="VFL SC optical port">' +
      '<span class="lab-vfl-port__thread" aria-hidden="true"></span>' +
      '<span class="lab-vfl-port__ferrule" aria-hidden="true"></span>' +
      '<span class="lab-vfl-port__bore" aria-hidden="true"></span>' +
      '</button>' +
      '</div>' +
      '<div class="lab-vfl__body" data-vfl-drag="' + d.id + '">' +
      '<span class="lab-vfl__label">FAULT LOCATOR</span>' +
      '<span class="lab-vfl__caution" aria-hidden="true">CAUTION · LASER</span>' +
      '<span class="lab-vfl__ring" aria-hidden="true"></span>' +
      '<span class="lab-vfl__switch-row" aria-hidden="true">' +
      '<span class="lab-vfl__modes"><b>CW</b><b>OFF</b><b>GLINT</b></span>' +
      '<span class="lab-vfl__track"><i class="lab-vfl__slider" style="top:' + switchPos + '"></i></span>' +
      '</span>' +
      '<span class="lab-vfl__grip" aria-hidden="true"></span>' +
      '</div>' +
      (laserOn
        ? '<span class="lab-vfl__beam' + (mode === 'GLINT' ? ' is-glint' : '') +
          '" aria-hidden="true"></span>'
        : '') +
      '</div>'
    );
  }

  function rebuildLayer() {
    var host = ensureLayer();
    if (!host) return;
    var html = '';
    devices.forEach(function (d) { html += deviceMarkup(d); });
    host.innerHTML = html;
    bindLayerEvents(host);
    refreshLaserGlow();
  }

  function bindLayerEvents(host) {
    host.querySelectorAll('[data-vfl-node]').forEach(function (node) {
      node.addEventListener('click', function (e) {
        if (e.target.closest('[data-vfl-port]')) return;
        e.stopPropagation();
        selectVfl(node.getAttribute('data-vfl-node'));
      });
    });

    host.querySelectorAll('[data-vfl-port]').forEach(function (port) {
      port.addEventListener('click', function (e) {
        e.stopPropagation();
        selectVfl(port.getAttribute('data-vfl-port'));
      });
    });

    host.querySelectorAll('[data-vfl-drag]').forEach(function (grip) {
      grip.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        var id = grip.getAttribute('data-vfl-drag');
        var d = findDevice(id);
        if (!d) return;
        selectVfl(id);
        var zoom = getZoom() || 1;
        var sx = e.clientX;
        var sy = e.clientY;
        var ox = d.x;
        var oy = d.y;
        var moved = false;
        nodeDragClass(id, true);

        function onMove(ev) {
          moved = true;
          d.x = Math.round(ox + (ev.clientX - sx) / zoom);
          d.y = Math.round(oy + (ev.clientY - sy) / zoom);
          var el = layer && layer.querySelector('[data-vfl-node="' + id + '"]');
          if (el) {
            el.style.left = d.x + 'px';
            el.style.top = d.y + 'px';
          }
        }
        function onUp() {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          nodeDragClass(id, false);
          if (moved) {
            rebuildLayer();
            pushHistory();
            if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
              FtthLab.notifyLayoutChange({ source: 'vfl', vflId: id });
            }
          }
        }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    });
  }

  function nodeDragClass(id, on) {
    var el = layer && layer.querySelector('[data-vfl-node="' + id + '"]');
    if (el) el.classList.toggle('is-dragging', !!on);
  }

  /* ─── Toolbox ─── */

  function renderToolbox() {
    var host = document.getElementById('lab-vfl-tree');
    if (!host) return;
    host.innerHTML =
      '<div class="lab-toolbox" role="list">' +
      '<button type="button" class="lab-tool lab-tool--vfl' +
      (selectedTool === 'vfl' ? ' is-selected' : '') +
      '" draggable="true" data-lab-tool="vfl" role="listitem">' +
      '<span class="lab-tool__mark lab-tool__mark--vfl" aria-hidden="true"></span>' +
      '<span class="lab-tool__copy">' +
      '<strong>Visual Fault Locator</strong>' +
      '<span>10 mW · 650 nm laser</span>' +
      '</span>' +
      '</button>' +
      '</div>';
    bindToolbox(host);
  }

  function bindToolbox(host) {
    var btn = host.querySelector('[data-lab-tool="vfl"]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('vfl');
      }
      selectedTool = 'vfl';
      renderToolbox();
      setStatus('VFL · drag onto canvas · plug fiber into SC port · CW or GLINT');
    });
    btn.addEventListener('dragstart', function (e) {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('vfl');
      }
      selectedTool = 'vfl';
      dragLib = { kind: 'vfl' };
      if (global.FtthLab && FtthLab.beginDrag) FtthLab.beginDrag({ kind: 'vfl' });
      try {
        e.dataTransfer.setData('text/plain', 'lab:vfl');
        e.dataTransfer.setData('text/lab-drag', 'vfl');
        e.dataTransfer.effectAllowed = 'copy';
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

  function bindStageDrop() {
    var stage = document.getElementById('lab-canvas-2d');
    var mount = document.getElementById('lab-2d-mount');
    var world = document.getElementById('lab-2d-world');
    [stage, mount, world].forEach(function (el) {
      if (!el || el.dataset.vflDrop === '1') return;
      el.dataset.vflDrop = '1';
      el.addEventListener('dragover', function (e) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        if (!((dragLib && dragLib.kind === 'vfl') || (active && active.kind === 'vfl'))) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      });
      el.addEventListener('drop', function (e) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        var kind = (e.dataTransfer && e.dataTransfer.getData('text/lab-drag')) ||
          (active && active.kind) || (dragLib && dragLib.kind) || '';
        if (kind !== 'vfl') return;
        e.preventDefault();
        e.stopPropagation();
        dragLib = null;
        if (global.FtthLab && FtthLab.endDrag) FtthLab.endDrag();
        selectedTool = 'vfl';
        var pt = clientToWorld(e.clientX, e.clientY);
        placeVfl(Math.round(pt.x - VFL_W / 2), Math.round(pt.y - VFL_H / 2));
      });
    });
  }

  function updateInspector() {
    var card = document.getElementById('lab-inspector-card');
    var detail = document.getElementById('lab-inspector-detail');
    if (!card) return;
    if (selection.kind !== 'vfl' || !selection.id) return;
    var d = findDevice(selection.id);
    if (!d) return;

    var mode = normalizeMode(d.mode);
    var glow = collectLaserTargets();
    var pathCount = (glow.pcords || []).length + (glow.pigtails || []).length;
    var laserOn = mode !== 'OFF';

    card.innerHTML =
      '<h2>Visual Fault Locator</h2>' +
      '<p>10 mW · 650 nm · plug SC Patch Cord or Pigtail into the open central adapter.</p>';

    if (!detail) return;
    detail.hidden = false;
    detail.innerHTML =
      '<div class="lab-vfl-config">' +
      '<p class="lab-inspector__label">Laser mode</p>' +
      '<div class="lab-vfl-mode-toggle" role="group" aria-label="VFL laser mode">' +
      '<button type="button" class="lab-vfl-mode-btn' + (mode === 'CW' ? ' is-active' : '') +
      '" data-vfl-mode="' + d.id + ':CW">CW</button>' +
      '<button type="button" class="lab-vfl-mode-btn' + (mode === 'OFF' ? ' is-active' : '') +
      '" data-vfl-mode="' + d.id + ':OFF">OFF</button>' +
      '<button type="button" class="lab-vfl-mode-btn' + (mode === 'GLINT' ? ' is-active' : '') +
      '" data-vfl-mode="' + d.id + ':GLINT">GLINT</button>' +
      '</div>' +
      '<p class="lab-vfl-mode-hint">' +
      (mode === 'CW'
        ? 'Continuous wave · steady red glow along the fiber'
        : mode === 'GLINT'
          ? 'Pulsing glint · flashing red for fault tracing'
          : 'Laser off · no emission') +
      '</p>' +
      (laserOn
        ? '<div class="lab-vfl-preview' + (mode === 'GLINT' ? ' is-glint' : '') +
          '" aria-hidden="true">' +
          '<span class="lab-vfl-preview__beam"></span>' +
          '<span>' + (mode === 'GLINT' ? 'Pulsing red laser' : 'Steady red laser') +
          ' on fiber</span>' +
          '</div>'
        : '') +
      '<p class="lab-pcord-attach">' +
      (d.plugged
        ? 'Port ← ' + d.plugged.label
        : 'Port · open · drag SC connector onto central adapter') +
      '</p>' +
      '<div class="lab-spl-sheet">' +
      '<div><span>Power</span><strong>10 mW</strong></div>' +
      '<div><span>λ</span><strong>650 nm</strong></div>' +
      '<div><span>Mode</span><strong class="' +
      (laserOn ? 'lab-vfl-on-text' : '') + '">' + modeLabel(mode) + '</strong></div>' +
      '<div><span>Lit paths</span><strong>' +
      (laserOn && d.plugged ? pathCount : '—') +
      '</strong></div>' +
      '</div>' +
      '<button type="button" class="lab-eject-btn" data-remove-vfl="' + d.id +
      '">Remove VFL</button>' +
      '</div>';

    detail.querySelectorAll('[data-vfl-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var parts = btn.getAttribute('data-vfl-mode').split(':');
        setMode(parts[0], parts[1]);
      });
    });
    var rm = detail.querySelector('[data-remove-vfl]');
    if (rm) {
      rm.addEventListener('click', function () {
        removeVfl(d.id);
        if (global.FtthLab && typeof FtthLab.resetInspectorIdle === 'function') {
          FtthLab.resetInspectorIdle();
        }
      });
    }
  }

  function onLayoutChange() {
    if (!layer) return;
    devices.forEach(function (d) {
      var el = layer.querySelector('[data-vfl-node="' + d.id + '"]');
      if (el) {
        el.style.left = d.x + 'px';
        el.style.top = d.y + 'px';
      }
    });
    refreshLaserGlow();
  }

  function deleteSelected() {
    if (selection.kind === 'vfl' && selection.id) {
      removeVfl(selection.id);
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

  function cancelPatch() {}

  function onToolboxClaim(payload) {
    var id = payload && payload.toolId;
    if (id === 'vfl') return;
    if (selectedTool) {
      selectedTool = null;
      renderToolbox();
    }
  }

  function onViewChange() {
    rebuildLayer();
  }

  function mount(api) {
    ctx = api || {};
    devices = [];
    seq = 0;
    history = [];
    historyIndex = -1;
    historyLocked = false;
    selection = { kind: 'none', id: null };
    selectedTool = null;
    dragLib = null;
    renderToolbox();
    bindStageDrop();
    ensureLayer();
    rebuildLayer();
    pushHistory();

    if (global.FtthLab) {
      FtthLab.refreshVflLaser = refreshLaserGlow;
      FtthLab.getVflPortWorld = getVflPortWorld;
    }
  }

  var tool = {
    id: 'vfl',
    mount: mount,
    onViewChange: onViewChange,
    onLayoutChange: onLayoutChange,
    undo: undo,
    redo: redo,
    deleteSelected: deleteSelected,
    clearSelection: clearSelection,
    cancelPatch: cancelPatch,
    onToolboxClaim: onToolboxClaim,
  };

  function tryRegister() {
    if (global.FtthLab && typeof FtthLab.registerTool === 'function') {
      FtthLab.registerTool('vfl', tool);
      return true;
    }
    return false;
  }

  if (!tryRegister()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', tryRegister);
    } else {
      setTimeout(tryRegister, 0);
    }
  }
})(typeof window !== 'undefined' ? window : this);
