/**
 * Fusion Splicer Lab — draggable canvas machine (iframe-hosted v6 UI).
 * Drop from toolbox onto the grid; drag via top handle; fibers render above chassis.
 */
(function (global) {
  'use strict';

  var MACHINE_SRC = 'fusion-splicer-machine.html';
  var TOOL_ID = 'fusion-splicer-machine';
  var HISTORY_MAX = 40;
  var DRAG_THRESHOLD_PX = 3;

  /** Native artboard size (matches #machineBody in fusion-splicer-machine.html). */
  var MACHINE_NAT_W = 720;
  var MACHINE_NAT_H = 820;
  /** Must match `.lab-fusion-machine { transform: scale(...) }` in ftth-lab.css */
  var MACHINE_VISUAL_SCALE = 0.32;
  var MACHINE_LOCAL_CX = MACHINE_NAT_W / 2;
  var MACHINE_LOCAL_CY = MACHINE_NAT_H / 2;

  var layer = null;
  var machines = [];
  var seq = 0;
  var selection = { kind: 'none', id: null };
  var selectedTool = null;
  var dragLib = null;
  var history = [];
  var historyIndex = -1;
  var historyLocked = false;
  var parentListeners = {};
  var bridges = {};
  var armedMachineId = null;
  var layerEventsBound = false;
  var outsideIsolationBound = false;
  var activeDrag = null;

  function setStatus(msg) {
    if (global.FtthLab && FtthLab.setStatus) FtthLab.setStatus(msg);
  }

  function getZoom() {
    return (global.FtthLab && FtthLab.getZoom2d && FtthLab.getZoom2d()) || 1;
  }

  function clientToWorld(clientX, clientY) {
    if (global.FtthLab && typeof FtthLab.clientToWorld2d === 'function') {
      return FtthLab.clientToWorld2d(clientX, clientY);
    }
    return { x: 0, y: 0 };
  }

  function cloneJson(v) {
    return JSON.parse(JSON.stringify(v == null ? null : v));
  }

  function findMachine(id) {
    for (var i = 0; i < machines.length; i++) {
      if (machines[i].id === id) return machines[i];
    }
    return null;
  }

  function getMachineNode(id) {
    return layer && layer.querySelector('[data-fusion-node="' + id + '"]');
  }

  function getMachineFrame(id) {
    var node = getMachineNode(id);
    return node ? node.querySelector('iframe') : null;
  }

  function postToMachine(id, msg) {
    var frame = getMachineFrame(id);
    if (!frame || !frame.contentWindow) return;
    try {
      frame.contentWindow.postMessage(msg, '*');
    } catch (err) { /* ignore */ }
  }

  function blurMachineFrame(id) {
    var frame = getMachineFrame(id);
    if (!frame) return;
    postToMachine(id, { source: 'fusion-splicer-host', type: 'setActive', active: false });
    try {
      if (frame.contentWindow && frame.contentWindow.document && frame.contentWindow.document.activeElement) {
        frame.contentWindow.document.activeElement.blur();
      }
      frame.blur();
    } catch (err2) { /* ignore */ }
  }

  function syncMachineDomState() {
    if (!layer) return;
    layer.querySelectorAll('[data-fusion-node]').forEach(function (node) {
      var id = node.getAttribute('data-fusion-node');
      node.classList.toggle('is-selected', selection.id === id);
      node.classList.toggle('is-armed', armedMachineId === id);
    });
  }

  function disarmMachine(id, opts) {
    opts = opts || {};
    if (!id) return;
    if (armedMachineId === id) armedMachineId = null;
    var node = getMachineNode(id);
    if (node) node.classList.remove('is-armed');
    if (opts.blur !== false) blurMachineFrame(id);
  }

  function armMachine(id) {
    if (!id || !findMachine(id)) return;
    if (armedMachineId && armedMachineId !== id) disarmMachine(armedMachineId);
    armedMachineId = id;
    var node = getMachineNode(id);
    if (node) node.classList.add('is-armed');
    postToMachine(id, { source: 'fusion-splicer-host', type: 'setActive', active: true });
    var frame = getMachineFrame(id);
    if (frame && frame.contentWindow) {
      try { frame.contentWindow.focus(); } catch (err) { /* ignore */ }
    }
  }

  function disarmAllMachines(opts) {
    opts = opts || {};
    var ids = machines.map(function (m) { return m.id; });
    ids.forEach(function (id) {
      disarmMachine(id, { blur: opts.blur !== false });
    });
    armedMachineId = null;
    if (layer) {
      layer.querySelectorAll('.lab-fusion-machine.is-armed').forEach(function (node) {
        node.classList.remove('is-armed');
      });
    }
  }

  function isPointerOnFusionMachine(target) {
    return !!(target && target.closest && target.closest('.lab-fusion-machine'));
  }

  function bindOutsideIsolation() {
    if (outsideIsolationBound) return;
    var mount = document.getElementById('lab-2d-mount');
    var stage = document.getElementById('lab-canvas-2d');
    if (!mount && !stage) return;
    outsideIsolationBound = true;

    function onOutsidePointerDown(e) {
      if (isPointerOnFusionMachine(e.target)) return;
      if (activeDrag) return;
      disarmAllMachines({ blur: true });
    }

    if (mount) mount.addEventListener('pointerdown', onOutsidePointerDown, true);
    if (stage) stage.addEventListener('pointerdown', onOutsidePointerDown, true);
    document.addEventListener('pointerdown', function (e) {
      if (e.target && e.target.closest && e.target.closest('.lab-rail')) {
        disarmAllMachines({ blur: true });
      }
    }, true);
  }

  function emitParent(evt, payload) {
    (parentListeners[evt] || []).forEach(function (fn) {
      try { fn(payload); } catch (err) { console.error(err); }
    });
    if (global.CustomEvent) {
      document.dispatchEvent(new CustomEvent('fusion-splicer:' + evt, { detail: payload }));
    }
  }

  function clearBridge(id) {
    var b = bridges[id];
    if (!b) return;
    (b.offs || []).forEach(function (off) {
      try { if (typeof off === 'function') off(); } catch (err) { /* ignore */ }
    });
    delete bridges[id];
    if (selection.id === id && global.FusionSplicerUI === b.api) {
      try { delete global.FusionSplicerUI; } catch (err2) {
        global.FusionSplicerUI = null;
      }
    }
  }

  function bridgeIframe(id, frame) {
    clearBridge(id);
    if (!frame || !frame.contentWindow) return;

    var win = frame.contentWindow;
    var api = win.FusionSplicerUI;
    if (!api) return;

    var offs = [];
    if (typeof api.on === 'function') {
      [
        'ready', 'power', 'ovenLid', 'clampSelect', 'clampNudge', 'clampConfirm',
        'clampLid', 'fiberPlaced', 'heatStart', 'heatComplete', 'alarm',
        'reset', 'spliceStart', 'spliceComplete', 'button'
      ].forEach(function (evt) {
        var off = api.on(evt, function (payload) {
          emitParent(evt, Object.assign({ machineId: id }, payload || {}));
        });
        if (typeof off === 'function') offs.push(off);
      });
    }

    bridges[id] = { api: api, offs: offs, frame: frame };
    if (selection.id === id) global.FusionSplicerUI = api;
    emitParent('ready', { machineId: id, empty: true, bridged: true });
  }

  function initMachineIframe(m, frame) {
    if (!frame || frame.dataset.fusionBound === '1') return;
    frame.dataset.fusionBound = '1';

    function onLoad() {
      var tries = 0;
      function tryBridge() {
        tries += 1;
        if (frame.contentWindow && frame.contentWindow.FusionSplicerUI) {
          bridgeIframe(m.id, frame);
          return;
        }
        if (tries < 24) setTimeout(tryBridge, 50);
      }
      tryBridge();
    }

    frame.addEventListener('load', onLoad);
    if (!frame.getAttribute('src') || frame.getAttribute('src') === 'about:blank') {
      frame.src = MACHINE_SRC;
    }
  }

  function ensureLayer() {
    if (layer && layer.parentNode) return layer;
    var mount = document.getElementById('lab-2d-mount');
    if (!mount) return null;
    layer = document.createElement('div');
    layer.className = 'lab-fusion-machine-layer';
    layer.setAttribute('data-lab-fusion-machine-layer', '1');
    mount.appendChild(layer);
    bindLayerEvents(layer);
    liftPigtailLayerAboveMachine();
    return layer;
  }

  function liftPigtailLayerAboveMachine() {
    var mount = document.getElementById('lab-2d-mount');
    if (!mount) return;
    var pigLayer = mount.querySelector('[data-lab-pigtail-layer]');
    if (pigLayer) mount.appendChild(pigLayer);
  }

  function machinePositionStyle(m) {
    return (
      'left:' + Math.round(m.x - MACHINE_LOCAL_CX) + 'px;' +
      'top:' + Math.round(m.y - MACHINE_LOCAL_CY) + 'px;' +
      'width:' + MACHINE_NAT_W + 'px;height:' + MACHINE_NAT_H + 'px'
    );
  }

  function createMachineNode(m) {
    var selected = selection.id === m.id ? ' is-selected' : '';
    var node = document.createElement('div');
    node.className = 'lab-fusion-machine' + selected;
    node.setAttribute('data-fusion-node', m.id);
    node.setAttribute('title', 'Fusion Splicer · drag to move · click to operate');
    node.style.cssText = machinePositionStyle(m);
    node.innerHTML =
      '<iframe class="lab-fusion-machine__frame" title="Fusion splicer machine" tabindex="-1" ' +
        'sandbox="allow-scripts allow-same-origin" loading="lazy"></iframe>' +
      '<button type="button" class="lab-fusion-machine__hit" aria-label="Fusion Splicer"></button>';
    initMachineIframe(m, node.querySelector('iframe'));
    return node;
  }

  function updateMachineNode(m, node) {
    if (!node) return;
    node.style.cssText = machinePositionStyle(m);
    node.classList.toggle('is-selected', selection.id === m.id);
  }

  function rebuildLayer() {
    var host = ensureLayer();
    if (!host) return;

    var existing = {};
    host.querySelectorAll('[data-fusion-node]').forEach(function (node) {
      existing[node.getAttribute('data-fusion-node')] = node;
    });

    var frag = document.createDocumentFragment();
    machines.forEach(function (m) {
      var node = existing[m.id];
      if (node) {
        updateMachineNode(m, node);
        delete existing[m.id];
      } else {
        node = createMachineNode(m);
      }
      frag.appendChild(node);
    });

    Object.keys(existing).forEach(function (id) {
      clearBridge(id);
      existing[id].remove();
    });

    host.innerHTML = '';
    host.appendChild(frag);
    syncMachineDomState();
    liftPigtailLayerAboveMachine();
  }

  function updateMachinePosition(m, node) {
    if (!node) node = layer && layer.querySelector('[data-fusion-node="' + m.id + '"]');
    if (!node) return;
    node.style.left = Math.round(m.x - MACHINE_LOCAL_CX) + 'px';
    node.style.top = Math.round(m.y - MACHINE_LOCAL_CY) + 'px';
  }

  function placeMachine(x, y) {
    seq += 1;
    var item = {
      id: 'fsm-' + seq,
      x: typeof x === 'number' ? Math.round(x) : 0,
      y: typeof y === 'number' ? Math.round(y) : 0,
    };
    machines.push(item);
    selection = { kind: 'fusion-machine', id: item.id };
    if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
      FtthLab.setSelectionOwner(TOOL_ID);
    }
    rebuildLayer();
    pushHistory();
    updateInspector();
    setStatus('Fusion Splicer placed · drag to move · click to operate controls');
    emitParent('placed', { machineId: item.id, x: item.x, y: item.y });
    return item;
  }

  function removeMachine(id) {
    disarmMachine(id);
    clearBridge(id);
    if (armedMachineId === id) armedMachineId = null;
    machines = machines.filter(function (m) { return m.id !== id; });
    if (selection.id === id) selection = { kind: 'none', id: null };
    rebuildLayer();
    updateInspector();
    pushHistory();
    setStatus('Fusion Splicer removed');
    emitParent('removed', { machineId: id });
  }

  function selectMachine(id, opts) {
    selection = { kind: 'fusion-machine', id: id };
    if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
      FtthLab.setSelectionOwner(TOOL_ID);
    }
    var b = bridges[id];
    if (b && b.api) global.FusionSplicerUI = b.api;
    updateInspector();
    if (!(opts && opts.skipRebuild)) syncMachineDomState();
  }

  function isClientOnMachineHit(node, clientX, clientY) {
    if (!node) return false;
    var id = node.getAttribute('data-fusion-node');
    if (armedMachineId === id) return false;
    var hit = node.querySelector('.lab-fusion-machine__hit');
    if (!hit) return false;
    var r = hit.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  function bindLayerEvents(host) {
    if (layerEventsBound || !host) return;
    layerEventsBound = true;

    host.addEventListener('pointerdown', function (e) {
      var hit = e.target.closest && e.target.closest('.lab-fusion-machine__hit');
      if (!hit) return;
      if (e.button !== 0) return;
      var node = hit.closest('[data-fusion-node]');
      if (!node || !isClientOnMachineHit(node, e.clientX, e.clientY)) return;
      e.preventDefault();
      e.stopPropagation();

      var id = node.getAttribute('data-fusion-node');
      var m = findMachine(id);
      if (!m) return;

      if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
        FtthLab.setSelectionOwner(TOOL_ID);
      }
      selection = { kind: 'fusion-machine', id: id };
      var b = bridges[id];
      if (b && b.api) global.FusionSplicerUI = b.api;
      syncMachineDomState();

      var zoom = getZoom() || 1;
      var sx = e.clientX;
      var sy = e.clientY;
      var ox = m.x;
      var oy = m.y;
      var moved = false;
      node.classList.add('is-dragging');
      document.body.classList.add('lab-fusion-machine-dragging');
      activeDrag = id;
      var pointerId = e.pointerId;
      try { hit.setPointerCapture(pointerId); } catch (err) { /* ignore */ }

      function onMove(ev) {
        var dx = (ev.clientX - sx) / zoom;
        var dy = (ev.clientY - sy) / zoom;
        if (!moved && (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX)) {
          moved = true;
          disarmAllMachines({ blur: true });
        }
        if (moved) {
          m.x = Math.round(ox + dx);
          m.y = Math.round(oy + dy);
          updateMachinePosition(m, node);
        }
      }

      function onUp() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        try { hit.releasePointerCapture(pointerId); } catch (err2) { /* ignore */ }
        node.classList.remove('is-dragging');
        document.body.classList.remove('lab-fusion-machine-dragging');
        activeDrag = null;
        if (moved) {
          pushHistory();
          syncMachineDomState();
        } else {
          armMachine(id);
        }
      }

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    }, true);
  }

  function updateInspector() {
    var card = document.getElementById('lab-inspector-card');
    var detail = document.getElementById('lab-inspector-detail');
    if (!card) return;
    if (selection.kind !== 'fusion-machine' || !selection.id) return;

    var m = findMachine(selection.id);
    if (!m) {
      selection = { kind: 'none', id: null };
      return;
    }

    card.innerHTML =
      '<h2>Fusion Splicer</h2>' +
      '<p>Industrial splice machine · clamps, heat oven, D-pad alignment.</p>';

    if (!detail) return;
    detail.hidden = false;
    detail.innerHTML =
      '<div class="lab-fusion-machine-config">' +
      '<p class="lab-inspector__label">Position</p>' +
      '<p class="lab-pcord-attach">X ' + m.x + ' · Y ' + m.y + '</p>' +
      '<p class="lab-pcord-attach">Drag to reposition · click once to operate controls.</p>' +
      '<button type="button" class="lab-eject-btn" data-remove-fusion="' + m.id +
      '">Remove Splicer</button>' +
      '</div>';

    var rm = detail.querySelector('[data-remove-fusion]');
    if (rm) {
      rm.addEventListener('click', function () {
        removeMachine(m.id);
      });
    }
  }

  function captureSnapshot() {
    return { machines: cloneJson(machines), seq: seq };
  }

  function applySnapshot(snap) {
    if (!snap) return;
    historyLocked = true;
    machines.forEach(function (m) { clearBridge(m.id); });
    machines = cloneJson(snap.machines) || [];
    seq = snap.seq || 0;
    armedMachineId = null;
    selection = { kind: 'none', id: null };
    rebuildLayer();
    updateInspector();
    historyLocked = false;
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

  function undo() {
    if (historyIndex <= 0) return false;
    historyIndex -= 1;
    applySnapshot(history[historyIndex]);
    setStatus('Undo · Fusion Splicer');
    return true;
  }

  function redo() {
    if (historyIndex >= history.length - 1) return false;
    historyIndex += 1;
    applySnapshot(history[historyIndex]);
    setStatus('Redo · Fusion Splicer');
    return true;
  }

  function renderToolbox() {
    var host = document.getElementById('lab-machine-tree');
    if (!host) return;
    host.innerHTML =
      '<div class="lab-toolbox" role="list">' +
      '<div class="tool-item lab-tool lab-tool--fusion-machine' +
      (selectedTool === 'fusion-machine' ? ' is-selected' : '') +
      '" data-tool="fusion-machine" data-lab-tool="fusion-splicer-machine" draggable="true" ' +
      'role="listitem" tabindex="0" title="Fusion Splicer">' +
      '<span class="lab-tool__mark lab-tool__mark--fusion-machine" aria-hidden="true">FS</span>' +
      '<span class="lab-tool__copy">' +
      '<strong>Fusion Splicer</strong>' +
      '<span>Machine UI · drag to grid</span>' +
      '</span>' +
      '</div>' +
      '</div>';
    bindToolbox(host);
  }

  function bindToolbox(host) {
    var btn = host.querySelector('[data-tool="fusion-machine"]');
    if (!btn) return;

    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool(TOOL_ID);
      }
      selectedTool = 'fusion-machine';
      renderToolbox();
      setStatus('Fusion Splicer · drag onto workspace');
    });

    btn.addEventListener('dragstart', function (ev) {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool(TOOL_ID);
      }
      selectedTool = 'fusion-machine';
      dragLib = { kind: 'fusion-machine' };
      if (global.FtthLab && FtthLab.beginDrag) FtthLab.beginDrag({ kind: 'fusion-machine' });
      try {
        ev.dataTransfer.setData('text/plain', 'lab:fusion-machine');
        ev.dataTransfer.setData('text/lab-drag', 'fusion-machine');
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
      if (!el || el.dataset.fusionMachineDrop === '1') return;
      el.dataset.fusionMachineDrop = '1';

      el.addEventListener('dragover', function (ev) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        if (!((dragLib && dragLib.kind === 'fusion-machine') ||
            (active && active.kind === 'fusion-machine'))) {
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
        if (kind !== 'fusion-machine') return;
        ev.preventDefault();
        ev.stopPropagation();
        dragLib = null;
        if (global.FtthLab && FtthLab.endDrag) FtthLab.endDrag();
        var pt = clientToWorld(ev.clientX, ev.clientY);
        placeMachine(Math.round(pt.x), Math.round(pt.y));
        selectedTool = null;
        renderToolbox();
      });

      el.addEventListener('click', function (ev) {
        if (selectedTool !== 'fusion-machine') return;
        var active = global.FtthLab && FtthLab.getActiveToolboxTool && FtthLab.getActiveToolboxTool();
        if (active !== TOOL_ID) return;
        if (!isStagePlacementTarget(ev.target)) return;
        ev.stopPropagation();
        var pt = clientToWorld(ev.clientX, ev.clientY);
        placeMachine(Math.round(pt.x), Math.round(pt.y));
        selectedTool = null;
        renderToolbox();
      }, true);
    });
  }

  function deleteSelected() {
    if (selection.kind === 'fusion-machine' && selection.id) {
      removeMachine(selection.id);
      return true;
    }
    return false;
  }

  function clearSelection() {
    selection = { kind: 'none', id: null };
    selectedTool = null;
    disarmAllMachines({ blur: true });
    renderToolbox();
    syncMachineDomState();
  }

  function onToolboxClaim(payload) {
    var id = payload && payload.toolId;
    if (id === TOOL_ID) return;
    selectedTool = null;
    disarmAllMachines({ blur: true });
    renderToolbox();
  }

  function on(evt, fn) {
    if (!parentListeners[evt]) parentListeners[evt] = [];
    parentListeners[evt].push(fn);
    return function off() {
      parentListeners[evt] = (parentListeners[evt] || []).filter(function (f) {
        return f !== fn;
      });
    };
  }

  function getUI(machineId) {
    var id = machineId || selection.id;
    if (!id) return null;
    return (bridges[id] && bridges[id].api) || null;
  }

  function listMachines() {
    return machines.map(function (m) {
      return { id: m.id, x: m.x, y: m.y };
    });
  }

  function mount() {
    renderToolbox();
    bindStageDrop();
    bindOutsideIsolation();
    ensureLayer();
    rebuildLayer();
    pushHistory();
    liftPigtailLayerAboveMachine();
  }

  var tool = {
    id: TOOL_ID,
    mount: mount,
    onToolboxClaim: onToolboxClaim,
    category: 'FUSION SPLICING',
    undo: undo,
    redo: redo,
    deleteSelected: deleteSelected,
    clearSelection: clearSelection,
    exportProjectState: captureSnapshot,
    importProjectState: applySnapshot,
    resetProjectState: function () {
      applySnapshot({ machines: [], seq: 0 });
    },
  };

  global.FusionSplicerMachine = {
    place: placeMachine,
    remove: removeMachine,
    list: listMachines,
    getUI: getUI,
    on: on,
    liftFibersAbove: liftPigtailLayerAboveMachine,
  };

  function tryRegister() {
    if (global.FtthLab && typeof FtthLab.registerTool === 'function') {
      FtthLab.registerTool(TOOL_ID, tool);
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
