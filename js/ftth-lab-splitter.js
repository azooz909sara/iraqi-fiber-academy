/**
 * Smart Splitter — horizontal PLC cassette modules
 * Per-port UPC/APC polish, live ratio/port config, optical loss budget.
 */
(function (global) {
  'use strict';

  var SPLITTER_SPECS = {
    '1x4':  { ratio: '1×4',  ins: 1, outs: 4,  lossDb: 7.7 },
    '1x8':  { ratio: '1×8',  ins: 1, outs: 8,  lossDb: 10.9 },
    '1x16': { ratio: '1×16', outs: 16, ins: 1, lossDb: 14.2 },
    '1x64': { ratio: '1×64', ins: 1, outs: 64, lossDb: 21.4 },
    '2x4':  { ratio: '2×4',  ins: 2, outs: 4,  lossDb: 7.7 },
  };

  var RATIO_ORDER = ['1x4', '1x8', '1x16', '1x64', '2x4'];

  var MISMATCH_MSG =
    'Mismatched connector polish: UPC/APC connection causes high back reflection and signal loss.';

  var ctx = null;
  var layer = null;
  var splitters = [];
  var connections = [];
  var seq = 0;
  var connSeq = 0;
  var selection = { kind: 'none', splitterId: null, linkId: null };
  var dragLib = null;
  var selectedTool = null;
  var history = [];
  var historyIndex = -1;
  var historyLocked = false;
  var HISTORY_MAX = 60;

  function setStatus(msg) {
    if (global.FtthLab && FtthLab.setStatus) FtthLab.setStatus(msg);
  }

  function getWorldSize() {
    return (global.FtthLab && FtthLab.getWorldSize) ? FtthLab.getWorldSize() : 20000;
  }

  function getZoom() {
    return (global.FtthLab && FtthLab.getZoom2d) ? FtthLab.getZoom2d() : 1;
  }

  function showAlert(msg) {
    if (global.FtthLab && FtthLab.showAlert) {
      FtthLab.showAlert(msg, 'warn');
      return;
    }
    setStatus(msg);
  }

  function findSplitter(id) {
    for (var i = 0; i < splitters.length; i++) {
      if (splitters[i].id === id) return splitters[i];
    }
    return null;
  }

  function makePorts(prefix, count, defaultPolish) {
    var list = [];
    var n = Math.max(1, Math.min(64, parseInt(count, 10) || 1));
    for (var i = 1; i <= n; i++) {
      list.push({ id: prefix + i, polish: defaultPolish || 'UPC' });
    }
    return list;
  }

  function buildPortsFromSpec(type) {
    var spec = SPLITTER_SPECS[type] || SPLITTER_SPECS['1x8'];
    return {
      inputs: makePorts('IN', spec.ins, 'UPC'),
      outputs: makePorts('OUT', spec.outs, 'UPC'),
    };
  }

  function getPort(s, portId) {
    if (!s) return null;
    var i;
    for (i = 0; i < s.inputs.length; i++) {
      if (s.inputs[i].id === portId) return s.inputs[i];
    }
    for (i = 0; i < s.outputs.length; i++) {
      if (s.outputs[i].id === portId) return s.outputs[i];
    }
    return null;
  }

  function getPortPolish(s, portId) {
    var p = getPort(s, portId);
    return p ? p.polish : 'UPC';
  }

  function lossFor(s) {
    var spec = SPLITTER_SPECS[s.type];
    return spec ? spec.lossDb : 0;
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value == null ? null : value));
  }

  function captureSnapshot() {
    return {
      splitters: cloneJson(splitters),
      connections: cloneJson(connections),
      seq: seq,
      connSeq: connSeq,
    };
  }

  function applySnapshot(snap) {
    if (!snap) return;
    historyLocked = true;
    splitters = cloneJson(snap.splitters) || [];
    connections = cloneJson(snap.connections) || [];
    seq = snap.seq || 0;
    connSeq = snap.connSeq || 0;
    selection = { kind: 'none', splitterId: null, linkId: null };
    if (global.FtthLab) FtthLab._patchPending = null;
    rebuildLayer();
    updateInspector();
    updateBudgetHud();
    historyLocked = false;
  }

  function pushHistory() {
    if (historyLocked) return;
    history = history.slice(0, historyIndex + 1);
    history.push(captureSnapshot());
    if (history.length > HISTORY_MAX) history.shift();
    historyIndex = history.length - 1;
    if (historyIndex > 0 && global.FtthLab && typeof FtthLab.recordHistory === 'function') {
      FtthLab.recordHistory('smart-splitter');
    }
  }

  function undo() {
    if (historyIndex <= 0) return false;
    historyIndex -= 1;
    applySnapshot(history[historyIndex]);
    setStatus('Undo · splitter');
    return true;
  }

  function redo() {
    if (historyIndex >= history.length - 1) return false;
    historyIndex += 1;
    applySnapshot(history[historyIndex]);
    setStatus('Redo · splitter');
    return true;
  }

  function findLinkAt(splitterId, portId) {
    for (var i = 0; i < connections.length; i++) {
      var c = connections[i];
      if ((c.fromId === splitterId && c.fromPort === portId) ||
          (c.toId === splitterId && c.toPort === portId)) {
        return c;
      }
    }
    return null;
  }

  function removeLink(linkId) {
    var before = connections.length;
    connections = connections.filter(function (c) { return c.id !== linkId; });
    if (connections.length === before) return false;
    if (selection.linkId === linkId) {
      selection = { kind: 'none', splitterId: null, linkId: null };
    }
    rebuildLayer();
    updateInspector();
    updateBudgetHud();
    pushHistory();
    setStatus('Patch link removed');
    return true;
  }

  function setBankPolish(id, bank, polish) {
    var s = findSplitter(id);
    if (!s) return;
    polish = polish === 'APC' ? 'APC' : 'UPC';
    var list = bank === 'out' ? s.outputs : s.inputs;
    list.forEach(function (p) {
      p.polish = polish;
    });
    /* Drop mismatched links on this bank */
    var valid = {};
    list.forEach(function (p) { valid[p.id] = true; });
    connections = connections.filter(function (c) {
      var portId = null;
      if (c.fromId === id && valid[c.fromPort]) portId = c.fromPort;
      if (c.toId === id && valid[c.toPort]) portId = c.toPort;
      if (!portId) return true;
      return c.cablePolish === polish;
    });
    rebuildLayer();
    updateInspector();
    updateBudgetHud();
    pushHistory();
    setStatus((bank === 'out' ? 'OUTPUT' : 'INPUT') + ' · all ' + polish);
  }

  function deleteSelected() {
    if (selection.kind === 'link' && selection.linkId) {
      return removeLink(selection.linkId);
    }
    if (selection.kind === 'splitter' && selection.splitterId) {
      removeSplitter(selection.splitterId);
      return true;
    }
    return false;
  }

  function defaultPos() {
    var w = getWorldSize();
    return {
      x: Math.round(w / 2 + 40 + splitters.length * 36),
      y: Math.round(w / 2 + 120 + (splitters.length % 4) * 70),
    };
  }

  function pruneDeadLinks(s) {
    var valid = {};
    s.inputs.forEach(function (p) { valid[p.id] = true; });
    s.outputs.forEach(function (p) { valid[p.id] = true; });
    connections = connections.filter(function (c) {
      if (c.fromId === s.id && !valid[c.fromPort]) return false;
      if (c.toId === s.id && !valid[c.toPort]) return false;
      return true;
    });
  }

  function placeSplitter(type, x, y) {
    if (!SPLITTER_SPECS[type]) type = '1x8';
    var spec = SPLITTER_SPECS[type];
    var ports = buildPortsFromSpec(type);
    seq += 1;
    var pos = (typeof x === 'number' && typeof y === 'number')
      ? { x: x, y: y }
      : defaultPos();
    var item = {
      id: 'spl-' + seq,
      type: type,
      x: pos.x,
      y: pos.y,
      inputs: ports.inputs,
      outputs: ports.outputs,
    };
    splitters.push(item);
    selectSplitter(item.id);
    rebuildLayer();
    updateBudgetHud();
    pushHistory();
    setStatus(spec.ratio + ' cassette placed · open config panel to customize ports');
    return item;
  }

  function removeSplitter(id) {
    connections = connections.filter(function (c) {
      return c.fromId !== id && c.toId !== id;
    });
    splitters = splitters.filter(function (s) { return s.id !== id; });
    if (selection.splitterId === id || selection.linkId) {
      selection = { kind: 'none', splitterId: null, linkId: null };
    }
    rebuildLayer();
    updateInspector();
    updateBudgetHud();
    pushHistory();
    setStatus('Splitter cassette removed');
  }

  function setRatio(id, type) {
    var s = findSplitter(id);
    if (!s || !SPLITTER_SPECS[type]) return;
    var ports = buildPortsFromSpec(type);
    s.type = type;
    s.inputs = ports.inputs;
    s.outputs = ports.outputs;
    pruneDeadLinks(s);
    rebuildLayer();
    updateInspector();
    updateBudgetHud();
    pushHistory();
    setStatus('Cassette ratio → ' + SPLITTER_SPECS[type].ratio);
  }

  function setInputCount(id, count) {
    var s = findSplitter(id);
    if (!s) return;
    count = Math.max(1, Math.min(8, parseInt(count, 10) || 1));
    var prev = {};
    s.inputs.forEach(function (p) { prev[p.id] = p.polish; });
    s.inputs = makePorts('IN', count, 'UPC').map(function (p) {
      if (prev[p.id]) p.polish = prev[p.id];
      return p;
    });
    pruneDeadLinks(s);
    rebuildLayer();
    updateInspector();
    updateBudgetHud();
    pushHistory();
  }

  function setOutputCount(id, count) {
    var s = findSplitter(id);
    if (!s) return;
    count = Math.max(1, Math.min(64, parseInt(count, 10) || 1));
    var prev = {};
    s.outputs.forEach(function (p) { prev[p.id] = p.polish; });
    s.outputs = makePorts('OUT', count, 'UPC').map(function (p) {
      if (prev[p.id]) p.polish = prev[p.id];
      return p;
    });
    pruneDeadLinks(s);
    rebuildLayer();
    updateInspector();
    updateBudgetHud();
    pushHistory();
  }

  function setPortPolish(id, portId, polish) {
    var s = findSplitter(id);
    var port = getPort(s, portId);
    if (!port) return;
    polish = polish === 'APC' ? 'APC' : 'UPC';
    port.polish = polish;
    /* Drop mismatched links on this port */
    connections = connections.filter(function (c) {
      var touches =
        (c.fromId === id && c.fromPort === portId) ||
        (c.toId === id && c.toPort === portId);
      if (!touches) return true;
      return c.cablePolish === polish;
    });
    rebuildLayer();
    updateInspector();
    updateBudgetHud();
    pushHistory();
    setStatus(portId + ' → ' + polish);
  }

  function polishOk(portPolish, cablePolish) {
    if (!portPolish || !cablePolish) return true;
    return String(portPolish).toUpperCase() === String(cablePolish).toUpperCase();
  }

  function portKey(splitterId, port) {
    return splitterId + ':' + port;
  }

  function isPortBusy(splitterId, port) {
    var key = portKey(splitterId, port);
    for (var i = 0; i < connections.length; i++) {
      var c = connections[i];
      if (portKey(c.fromId, c.fromPort) === key || portKey(c.toId, c.toPort) === key) {
        return true;
      }
    }
    return false;
  }

  function connectPorts(from, to, cablePolish) {
    if (!from || !to) return false;
    if (from.splitterId === to.splitterId && from.port === to.port) return false;

    var a = findSplitter(from.splitterId);
    var b = findSplitter(to.splitterId);
    if (!a || !b) return false;

    var pa = getPortPolish(a, from.port);
    var pb = getPortPolish(b, to.port);
    if (!polishOk(pa, cablePolish) || !polishOk(pb, cablePolish)) {
      showAlert(MISMATCH_MSG);
      setStatus('Patch blocked · UPC/APC mismatch');
      return false;
    }

    if (isPortBusy(from.splitterId, from.port) || isPortBusy(to.splitterId, to.port)) {
      setStatus('Port already patched — disconnect first');
      return false;
    }

    connSeq += 1;
    connections.push({
      id: 'lnk-' + connSeq,
      fromId: from.splitterId,
      fromPort: from.port,
      toId: to.splitterId,
      toPort: to.port,
      cablePolish: cablePolish,
    });

    rebuildLayer();
    updateInspector();
    updateBudgetHud();
    pushHistory();
    setStatus('Patch OK · ' + cablePolish + ' · loss budget updated');
    return true;
  }

  function onPatchPort(portDesc) {
    if (!portDesc) return false;

    var cablePolish = portDesc.polish === 'APC' ? 'APC' : 'UPC';

    if (!global.FtthLab || !FtthLab._patchPending) {
      /* Start patch from splitter ports only (OLT alone keeps normal select) */
      if (portDesc.owner === 'olt') return false;
      FtthLab._patchPending = { cablePolish: cablePolish, port: portDesc };
      setStatus('Patch ' + cablePolish + ' · click second matching port');
      return true;
    }

    var pending = FtthLab._patchPending;

    if (!polishOk(portDesc.polish, pending.cablePolish)) {
      showAlert(MISMATCH_MSG);
      setStatus('Patch blocked · ' + pending.cablePolish + ' ≠ ' + portDesc.polish);
      FtthLab._patchPending = null;
      return true;
    }

    var a = pending.port;
    var b = portDesc;
    var cable = pending.cablePolish;
    FtthLab._patchPending = null;

    if (a.owner === 'splitter' && b.owner === 'splitter') {
      connectPorts(
        { splitterId: a.splitterId, port: a.port },
        { splitterId: b.splitterId, port: b.port },
        cable
      );
      return true;
    }

    if ((a.owner === 'olt' && b.owner === 'splitter') ||
        (a.owner === 'splitter' && b.owner === 'olt')) {
      var spl = a.owner === 'splitter' ? a : b;
      var olt = a.owner === 'olt' ? a : b;
      var s = findSplitter(spl.splitterId);
      if (!s) return true;
      if (isPortBusy(spl.splitterId, spl.port)) {
        setStatus('Splitter port already patched');
        return true;
      }
      connSeq += 1;
      connections.push({
        id: 'lnk-' + connSeq,
        fromId: spl.splitterId,
        fromPort: spl.port,
        toId: 'olt',
        toPort: olt.label || ('LT' + olt.slot + '/P' + olt.oltPort),
        cablePolish: cable,
        oltMeta: { slot: olt.slot, port: olt.oltPort },
      });
      rebuildLayer();
      updateInspector();
      updateBudgetHud();
      pushHistory();
      setStatus('OLT ↔ Splitter patch · ' + cable);
      return true;
    }

    setStatus('Unsupported patch endpoints');
    return true;
  }

  function totalNetworkLoss() {
    var sum = 0;
    var seen = {};
    connections.forEach(function (c) {
      [c.fromId, c.toId].forEach(function (id) {
        if (id === 'olt' || seen[id]) return;
        var s = findSplitter(id);
        if (!s) return;
        seen[id] = true;
        sum += lossFor(s);
      });
    });
    return Math.round(sum * 10) / 10;
  }

  function updateBudgetHud() {
    var chip = document.getElementById('lab-hud-budget');
    var loss = totalNetworkLoss();
    var text = loss > 0
      ? 'Power budget · Total Signal Loss ' + loss.toFixed(1) + ' dB'
      : 'Power budget · no active splitter links';
    if (chip) chip.textContent = text;
    if (global.FtthLab && FtthLab.setBudget) FtthLab.setBudget(text);
  }

  function hasLink(s) {
    return connections.some(function (c) {
      return c.fromId === s.id || c.toId === s.id;
    });
  }

  /* ─── Toolbox — single Splitter tool ─── */

  var DEFAULT_SPLITTER = '1x8';

  function renderToolbox() {
    var host = document.getElementById('lab-splitter-tree');
    if (!host) return;

    host.innerHTML =
      '<div class="lab-toolbox" role="list">' +
      '<button type="button" class="lab-tool lab-tool--spl' +
      (selectedTool === 'splitter' ? ' is-selected' : '') +
      '" draggable="true" data-lab-tool="splitter" role="listitem">' +
      '<span class="lab-tool__mark lab-tool__mark--splitter" aria-hidden="true"></span>' +
      '<span class="lab-tool__copy">' +
      '<strong>Splitter</strong>' +
      '<span>Configure on workspace</span>' +
      '</span>' +
      '</button>' +
      '</div>';

    bindToolbox(host);
  }

  function bindToolbox(host) {
    var btn = host.querySelector('[data-lab-tool="splitter"]');
    if (!btn) return;

    btn.addEventListener('click', function () {
      selectedTool = 'splitter';
      if (global.FtthLab) FtthLab._patchPending = null;
      renderToolbox();
      setStatus('Splitter · drag onto workspace · configure in properties panel');
    });

    btn.addEventListener('dragstart', function (e) {
      selectedTool = 'splitter';
      dragLib = { type: DEFAULT_SPLITTER };
      if (global.FtthLab && typeof FtthLab.beginDrag === 'function') {
        FtthLab.beginDrag({ kind: 'splitter', type: DEFAULT_SPLITTER });
      }
      try {
        e.dataTransfer.setData('text/plain', 'lab:splitter:' + DEFAULT_SPLITTER);
        e.dataTransfer.setData('text/lab-drag', 'splitter');
        e.dataTransfer.setData('text/lab-splitter', DEFAULT_SPLITTER);
        e.dataTransfer.effectAllowed = 'copy';
      } catch (err) { /* ignore */ }
      btn.classList.add('is-dragging', 'is-selected');
    });

    btn.addEventListener('dragend', function () {
      dragLib = null;
      if (global.FtthLab && typeof FtthLab.endDrag === 'function') {
        FtthLab.endDrag();
      }
      if (global.FtthLab && typeof FtthLab.clearStageDropHighlight === 'function') {
        FtthLab.clearStageDropHighlight();
      }
      btn.classList.remove('is-dragging');
      renderToolbox();
    });
  }

  function bindStageDrop() {
    var stage = document.getElementById('lab-canvas-2d');
    var mount = document.getElementById('lab-2d-mount');
    var world = document.getElementById('lab-2d-world');
    [stage, mount, world].forEach(function (el) {
      if (!el || el.dataset.splitterDrop === '1') return;
      el.dataset.splitterDrop = '1';
      el.addEventListener('dragover', function (e) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        var isSpl = (dragLib && dragLib.type) || (active && active.kind === 'splitter');
        if (!isSpl) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      });
      el.addEventListener('drop', function (e) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        var type = (e.dataTransfer && e.dataTransfer.getData('text/lab-splitter')) ||
          (dragLib && dragLib.type) ||
          (active && active.type) ||
          DEFAULT_SPLITTER;
        if (!SPLITTER_SPECS[type]) type = DEFAULT_SPLITTER;
        var kind = (e.dataTransfer && e.dataTransfer.getData('text/lab-drag')) ||
          (active && active.kind) ||
          (dragLib ? 'splitter' : '');
        if (kind !== 'splitter') return;
        e.preventDefault();
        e.stopPropagation();

        var wx = 0;
        var wy = 0;
        if (global.FtthLab && typeof FtthLab.clientToWorld2d === 'function') {
          var pt = FtthLab.clientToWorld2d(e.clientX, e.clientY);
          wx = pt.x;
          wy = pt.y;
        } else {
          var stageEl = document.getElementById('lab-canvas-2d');
          var worldEl = document.getElementById('lab-2d-world');
          if (stageEl && worldEl) {
            var rect = stageEl.getBoundingClientRect();
            var zoom = getZoom();
            var panX = 0;
            var panY = 0;
            if (global.FtthLab && typeof FtthLab.getPan2d === 'function') {
              var pan = FtthLab.getPan2d();
              panX = pan.x;
              panY = pan.y;
            }
            wx = (e.clientX - rect.left - panX) / zoom;
            wy = (e.clientY - rect.top - panY) / zoom;
          }
        }
        placeSplitter(type, Math.round(wx - 140), Math.round(wy - 36));
        dragLib = null;
        if (global.FtthLab && typeof FtthLab.endDrag === 'function') {
          FtthLab.endDrag();
        }
        if (global.FtthLab && typeof FtthLab.clearStageDropHighlight === 'function') {
          FtthLab.clearStageDropHighlight();
        }
      });
    });
  }

  /* ─── Cassette render ─── */

  function ensureLayer() {
    var mount = (ctx && ctx.host2d) || document.getElementById('lab-2d-mount');
    if (!mount) return null;
    if (!layer || !layer.parentNode) {
      layer = document.createElement('div');
      layer.className = 'lab-splitter-layer';
      layer.setAttribute('data-lab-splitter-layer', '1');
      mount.appendChild(layer);
    }
    return layer;
  }

  function outsPerRow(count) {
    if (count <= 4) return count;
    if (count <= 8) return 4;
    if (count <= 16) return 8;
    if (count <= 32) return 8;
    return 8;
  }

  function renderPortBtn(s, port, kind) {
    var busy = isPortBusy(s.id, port.id);
    var polishClass = port.polish === 'APC' ? 'is-apc' : 'is-upc';
    var num = port.id.replace(/^IN|^OUT/, '');
    return (
      '<button type="button" class="lab-cas-port ' + polishClass +
      (busy ? ' is-linked' : '') +
      '" data-spl-id="' + s.id + '" data-spl-port="' + port.id + '" ' +
      'title="' + port.id + ' · ' + port.polish + '" data-port-kind="' + kind + '">' +
      '<i></i><span>' + num + '</span>' +
      '</button>'
    );
  }

  function rebuildLayer() {
    var host = ensureLayer();
    if (!host) return;

    var html = '';
    splitters.forEach(function (s) {
      var spec = SPLITTER_SPECS[s.type] || { ratio: s.type, lossDb: 0 };
      var selected = selection.splitterId === s.id ? ' is-selected' : '';
      var linked = hasLink(s);
      var perRow = outsPerRow(s.outputs.length);

      var inHtml = s.inputs.map(function (p) {
        return renderPortBtn(s, p, 'in');
      }).join('');

      var outHtml = '';
      for (var i = 0; i < s.outputs.length; i++) {
        if (i % perRow === 0) outHtml += '<div class="lab-cas-port-row">';
        outHtml += renderPortBtn(s, s.outputs[i], 'out');
        if (i % perRow === perRow - 1 || i === s.outputs.length - 1) {
          outHtml += '</div>';
        }
      }

      html +=
        '<div class="lab-cas-cassette' + selected + '" data-spl-node="' + s.id + '" ' +
        'style="left:' + Math.round(s.x) + 'px;top:' + Math.round(s.y) + 'px">' +
        '<div class="lab-cas-flange lab-cas-flange--l" aria-hidden="true">' +
        '<span class="lab-cas-screw"></span><span class="lab-cas-screw"></span>' +
        '</div>' +
        '<div class="lab-cas-body">' +
        '<div class="lab-cas-drag" data-spl-drag="' + s.id + '">' +
        '<strong>PLC SPLITTER</strong>' +
        '<span>' + spec.ratio + '</span>' +
        '</div>' +
        '<div class="lab-cas-face">' +
        '<div class="lab-cas-bank lab-cas-bank--in">' +
        '<span class="lab-cas-bank__lbl">IN</span>' +
        '<div class="lab-cas-port-row">' + inHtml + '</div>' +
        '</div>' +
        '<div class="lab-cas-mid" aria-hidden="true"></div>' +
        '<div class="lab-cas-bank lab-cas-bank--out">' +
        '<span class="lab-cas-bank__lbl">OUT</span>' +
        '<div class="lab-cas-outs">' + outHtml + '</div>' +
        '</div>' +
        '</div>' +
        '<div class="lab-cas-loss' + (linked ? '' : ' is-idle') + '">' +
        (linked
          ? 'Total Signal Loss <strong>' + lossFor(s).toFixed(1) + ' dB</strong>'
          : 'Rated loss ' + lossFor(s).toFixed(1) + ' dB') +
        '</div>' +
        '</div>' +
        '<div class="lab-cas-flange lab-cas-flange--r" aria-hidden="true">' +
        '<span class="lab-cas-screw"></span><span class="lab-cas-screw"></span>' +
        '</div>' +
        '</div>';
    });

    host.innerHTML = html;
    bindLayerEvents(host);
  }

  function bindLayerEvents(host) {
    host.querySelectorAll('[data-spl-drag]').forEach(function (grip) {
      grip.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        var id = grip.getAttribute('data-spl-drag');
        var s = findSplitter(id);
        if (!s) return;
        selectSplitter(id);
        var zoom = getZoom();
        var sx = e.clientX;
        var sy = e.clientY;
        var ox = s.x;
        var oy = s.y;
        var moved = false;

        function onMove(ev) {
          moved = true;
          s.x = ox + (ev.clientX - sx) / zoom;
          s.y = oy + (ev.clientY - sy) / zoom;
          var node = host.querySelector('[data-spl-node="' + id + '"]');
          if (node) {
            node.style.left = Math.round(s.x) + 'px';
            node.style.top = Math.round(s.y) + 'px';
          }
        }
        function onUp() {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          if (moved) pushHistory();
        }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    });

    host.querySelectorAll('[data-spl-node]').forEach(function (node) {
      node.addEventListener('click', function (e) {
        if (e.target.closest('.lab-cas-port')) return;
        selectSplitter(node.getAttribute('data-spl-node'));
      });
    });

    host.querySelectorAll('.lab-cas-port').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var id = btn.getAttribute('data-spl-id');
        var portId = btn.getAttribute('data-spl-port');
        var s = findSplitter(id);
        if (!s) return;

        /* Linked port + no pending patch → select link for Delete */
        var pending = global.FtthLab && FtthLab._patchPending;
        if (!pending && isPortBusy(id, portId)) {
          var link = findLinkAt(id, portId);
          if (link) {
            selectLink(link);
            return;
          }
        }

        selectSplitter(id);
        var polish = getPortPolish(s, portId);

        onPatchPort({
          owner: 'splitter',
          polish: polish,
          label: s.type + ' ' + portId,
          splitterId: id,
          port: portId,
        });
      });
    });
  }

  function selectSplitter(id) {
    selection = { kind: 'splitter', splitterId: id, linkId: null };
    if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
      FtthLab.setSelectionOwner('smart-splitter');
    }
    updateInspector();
    rebuildLayer();
  }

  function selectLink(link) {
    if (!link) return;
    selection = {
      kind: 'link',
      linkId: link.id,
      splitterId: link.fromId !== 'olt' ? link.fromId : link.toId,
    };
    if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
      FtthLab.setSelectionOwner('smart-splitter');
    }
    updateInspector();
    rebuildLayer();
    setStatus('Link selected · Delete / Backspace to remove');
  }

  function portConfigRows(s, list, kind) {
    return list.map(function (p) {
      return (
        '<div class="lab-cas-cfg-port">' +
        '<span>' + p.id + '</span>' +
        '<div class="lab-polish-toggle lab-polish-toggle--mini" role="group">' +
        '<button type="button" class="lab-polish-btn is-upc' +
        (p.polish === 'UPC' ? ' is-active' : '') +
        '" data-cfg-polish="' + s.id + ':' + p.id + ':UPC">UPC</button>' +
        '<button type="button" class="lab-polish-btn is-apc' +
        (p.polish === 'APC' ? ' is-active' : '') +
        '" data-cfg-polish="' + s.id + ':' + p.id + ':APC">APC</button>' +
        '</div></div>'
      );
    }).join('');
  }

  function bankBulkHtml(s, bank) {
    return (
      '<div class="lab-cas-bulk" role="group" aria-label="' +
      (bank === 'out' ? 'Output' : 'Input') + ' bulk polish">' +
      '<button type="button" class="lab-cas-bulk__btn is-upc" data-cfg-bank="' +
      s.id + ':' + bank + ':UPC">All UPC</button>' +
      '<button type="button" class="lab-cas-bulk__btn is-apc" data-cfg-bank="' +
      s.id + ':' + bank + ':APC">All APC</button>' +
      '</div>'
    );
  }

  function updateInspector() {
    var card = document.getElementById('lab-inspector-card');
    var detail = document.getElementById('lab-inspector-detail');
    if (!card) return;

    if (selection.kind === 'link' && selection.linkId) {
      var link = null;
      for (var i = 0; i < connections.length; i++) {
        if (connections[i].id === selection.linkId) { link = connections[i]; break; }
      }
      if (!link) {
        selection = { kind: 'none', splitterId: null, linkId: null };
        return;
      }
      card.innerHTML =
        '<h2>Patch Link</h2>' +
        '<p>' + link.fromPort + ' → ' + link.toPort + ' · ' + link.cablePolish +
        '. Press Delete to remove.</p>';
      if (detail) {
        detail.hidden = false;
        detail.innerHTML =
          '<div class="lab-spl-sheet">' +
          '<div><span>Polish</span><strong>' + link.cablePolish + '</strong></div>' +
          '<div><span>From</span><strong>' + link.fromId + ' / ' + link.fromPort + '</strong></div>' +
          '<div><span>To</span><strong>' + link.toId + ' / ' + link.toPort + '</strong></div>' +
          '</div>' +
          '<button type="button" class="lab-eject-btn" data-remove-link="' + link.id +
          '">Delete Link</button>';
        var rmLink = detail.querySelector('[data-remove-link]');
        if (rmLink) {
          rmLink.addEventListener('click', function () {
            removeLink(link.id);
          });
        }
      }
      return;
    }

    if (selection.kind !== 'splitter' || !selection.splitterId) return;
    var s = findSplitter(selection.splitterId);
    if (!s) return;
    var spec = SPLITTER_SPECS[s.type] || { ratio: s.type, lossDb: 0 };

    card.innerHTML =
      '<h2>Splitter · ' + spec.ratio + '</h2>' +
      '<p>Configure ratio and per-port APC/UPC polish. The cassette updates live on the workspace.</p>';

    if (!detail) return;

    var ratioOpts = RATIO_ORDER.map(function (key) {
      return '<option value="' + key + '"' +
        (s.type === key ? ' selected' : '') + '>' +
        SPLITTER_SPECS[key].ratio + '</option>';
    }).join('');

    detail.hidden = false;
    detail.innerHTML =
      '<div class="lab-cas-config">' +
      '<label class="lab-cas-field">' +
      '<span>Splitter ratio</span>' +
      '<select data-cfg-ratio="' + s.id + '">' + ratioOpts + '</select>' +
      '</label>' +
      '<label class="lab-cas-field">' +
      '<span>Input ports</span>' +
      '<input type="number" min="1" max="8" value="' + s.inputs.length +
      '" data-cfg-ins="' + s.id + '" />' +
      '</label>' +
      '<div class="lab-cas-cfg-list">' +
      '<p class="lab-inspector__label" style="margin:0 0 0.35rem">INPUT</p>' +
      bankBulkHtml(s, 'in') +
      portConfigRows(s, s.inputs, 'in') +
      '</div>' +
      '<label class="lab-cas-field">' +
      '<span>Output ports</span>' +
      '<input type="number" min="1" max="64" value="' + s.outputs.length +
      '" data-cfg-outs="' + s.id + '" />' +
      '</label>' +
      '<div class="lab-cas-cfg-list">' +
      '<p class="lab-inspector__label" style="margin:0 0 0.35rem">OUTPUT</p>' +
      bankBulkHtml(s, 'out') +
      portConfigRows(s, s.outputs, 'out') +
      '</div>' +
      '<div class="lab-spl-sheet">' +
      '<div><span>Rated loss</span><strong>' + lossFor(s).toFixed(1) + ' dB</strong></div>' +
      '<div><span>Layout</span><strong>' + s.inputs.length + ' × ' + s.outputs.length + '</strong></div>' +
      '</div>' +
      '<button type="button" class="lab-eject-btn" data-remove-spl="' + s.id +
      '">Remove Cassette</button>' +
      '</div>';

    var ratioEl = detail.querySelector('[data-cfg-ratio]');
    if (ratioEl) {
      ratioEl.addEventListener('change', function () {
        setRatio(s.id, ratioEl.value);
      });
    }
    var insEl = detail.querySelector('[data-cfg-ins]');
    if (insEl) {
      insEl.addEventListener('change', function () {
        setInputCount(s.id, insEl.value);
      });
    }
    var outsEl = detail.querySelector('[data-cfg-outs]');
    if (outsEl) {
      outsEl.addEventListener('change', function () {
        setOutputCount(s.id, outsEl.value);
      });
    }
    detail.querySelectorAll('[data-cfg-bank]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var parts = btn.getAttribute('data-cfg-bank').split(':');
        setBankPolish(parts[0], parts[1], parts[2]);
      });
    });
    detail.querySelectorAll('[data-cfg-polish]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var parts = btn.getAttribute('data-cfg-polish').split(':');
        setPortPolish(parts[0], parts[1], parts[2]);
      });
    });
    var rm = detail.querySelector('[data-remove-spl]');
    if (rm) {
      rm.addEventListener('click', function () {
        removeSplitter(s.id);
      });
    }
  }

  function onViewChange() {
    rebuildLayer();
  }

  function mount(api) {
    ctx = api || {};
    splitters = [];
    connections = [];
    seq = 0;
    connSeq = 0;
    history = [];
    historyIndex = -1;
    historyLocked = false;
    selection = { kind: 'none', splitterId: null, linkId: null };
    selectedTool = null;
    renderToolbox();
    bindStageDrop();
    ensureLayer();
    rebuildLayer();
    updateBudgetHud();
    pushHistory();

    if (global.FtthLab) {
      FtthLab.tryPatchPort = onPatchPort;
      FtthLab.getSplitterLoss = function (type) {
        return SPLITTER_SPECS[type] ? SPLITTER_SPECS[type].lossDb : null;
      };
    }
  }

  var tool = {
    id: 'smart-splitter',
    mount: mount,
    onViewChange: onViewChange,
    placeSplitter: placeSplitter,
    onPatchPort: onPatchPort,
    undo: undo,
    redo: redo,
    deleteSelected: deleteSelected,
  };

  function tryRegister() {
    if (global.FtthLab && typeof FtthLab.registerTool === 'function') {
      FtthLab.registerTool('smart-splitter', tool);
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
