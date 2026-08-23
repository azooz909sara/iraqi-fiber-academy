/**
 * Fusion Splicer Lab — Fiber cleaver tool registration.
 * Toolbox drag/drop + canvas placement (same pattern as CFS-3 Stripper / SC Coupler).
 */
(function (global) {
  'use strict';

  var HISTORY_MAX = 40;
  var DRAG_THRESHOLD_PX = 3;

  var CLEAVER_W = (global.FiberCleaver && FiberCleaver.BASE_W) || 480;
  var CLEAVER_H = (global.FiberCleaver && FiberCleaver.BASE_H) || 340;

  var layer = null;
  var cleavers = [];
  var seq = 0;
  var selection = { kind: 'none', id: null };
  var selectedTool = null;
  var dragLib = null;
  var history = [];
  var historyIndex = -1;
  var historyLocked = false;

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

  function assemblyMarkup() {
    if (global.FiberCleaver && typeof FiberCleaver.assemblyMarkup === 'function') {
      return FiberCleaver.assemblyMarkup();
    }
    return '<div class="fiber-cleaver" data-cleaver-root="1"></div>';
  }

  function syncCleaverWidget(node, c) {
    var root = node.querySelector('[data-cleaver-root]') || node.querySelector('.fiber-cleaver');
    if (!root || !global.FiberCleaver || typeof FiberCleaver.applyState !== 'function') return;
    FiberCleaver.applyState(root, { clamped: !!(c && c.clamped) });
  }

  function findCleaver(id) {
    for (var i = 0; i < cleavers.length; i++) {
      if (cleavers[i].id === id) return cleavers[i];
    }
    return null;
  }

  function captureSnapshot() {
    return { cleavers: cloneJson(cleavers), seq: seq };
  }

  function applySnapshot(snap) {
    if (!snap) return;
    historyLocked = true;
    cleavers = cloneJson(snap.cleavers) || [];
    seq = snap.seq || 0;
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
      FtthLab.recordHistory('fiber-cleaver');
    }
  }

  function undo() {
    if (historyIndex <= 0) return false;
    historyIndex -= 1;
    applySnapshot(history[historyIndex]);
    setStatus('Undo · Fiber Cleaver');
    return true;
  }

  function redo() {
    if (historyIndex >= history.length - 1) return false;
    historyIndex += 1;
    applySnapshot(history[historyIndex]);
    setStatus('Redo · Fiber Cleaver');
    return true;
  }

  function ensureLayer() {
    if (layer && layer.parentNode) return layer;
    var mount = document.getElementById('lab-2d-mount');
    if (!mount) return null;
    layer = document.createElement('div');
    layer.className = 'lab-cleaver-layer';
    layer.setAttribute('data-lab-cleaver-layer', '1');
    mount.appendChild(layer);
    return layer;
  }

  function cleaverMarkup(c) {
    var selected = selection.id === c.id ? ' is-selected' : '';
    return (
      '<div class="lab-cleaver' + selected + '" data-cleaver-node="' + c.id + '" ' +
      'style="left:' + Math.round(c.x - CLEAVER_W / 2) + 'px;top:' +
      Math.round(c.y - CLEAVER_H / 2) + 'px;width:' + CLEAVER_W + 'px;height:' + CLEAVER_H + 'px" ' +
      'title="Fiber Cleaver · precision cleave">' +
      '<div class="lab-cleaver__body">' + assemblyMarkup() + '</div>' +
      '<button type="button" class="lab-cleaver__hit" aria-label="Fiber Cleaver"></button>' +
      '</div>'
    );
  }

  function rebuildLayer() {
    var host = ensureLayer();
    if (!host) return;
    var html = '';
    cleavers.forEach(function (c) { html += cleaverMarkup(c); });
    host.innerHTML = html;
    host.querySelectorAll('[data-cleaver-node]').forEach(function (node) {
      var id = node.getAttribute('data-cleaver-node');
      syncCleaverWidget(node, findCleaver(id));
    });
    bindLayerEvents(host);
  }

  function updateCleaverPosition(c, node) {
    if (!node) node = layer && layer.querySelector('[data-cleaver-node="' + c.id + '"]');
    if (!node) return;
    node.style.left = Math.round(c.x - CLEAVER_W / 2) + 'px';
    node.style.top = Math.round(c.y - CLEAVER_H / 2) + 'px';
  }

  function placeCleaver(x, y) {
    seq += 1;
    var item = {
      id: 'clv-' + seq,
      x: typeof x === 'number' ? Math.round(x) : 0,
      y: typeof y === 'number' ? Math.round(y) : 0,
      clamped: false,
    };
    cleavers.push(item);
    selection = { kind: 'cleaver', id: item.id };
    if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
      FtthLab.setSelectionOwner('fiber-cleaver');
    }
    rebuildLayer();
    pushHistory();
    updateInspector();
    setStatus('Fiber Cleaver placed · align bare fiber in V-groove');
    return item;
  }

  function removeCleaver(id) {
    cleavers = cleavers.filter(function (c) { return c.id !== id; });
    if (selection.id === id) selection = { kind: 'none', id: null };
    rebuildLayer();
    updateInspector();
    pushHistory();
    setStatus('Fiber Cleaver removed');
  }

  function selectCleaver(id, opts) {
    selection = { kind: 'cleaver', id: id };
    if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
      FtthLab.setSelectionOwner('fiber-cleaver');
    }
    updateInspector();
    if (!(opts && opts.skipRebuild)) rebuildLayer();
  }

  function isClientOnCleaverHit(node, clientX, clientY) {
    if (!node) return false;
    var hit = node.querySelector('.lab-cleaver__hit');
    if (!hit) return false;
    var r = hit.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  function startCleaverDrag(e, c, node) {
    var zoom = getZoom() || 1;
    var sx = e.clientX;
    var sy = e.clientY;
    var ox = c.x;
    var oy = c.y;
    var moved = false;
    node.classList.add('is-dragging');
    document.body.classList.add('lab-cleaver-dragging');
    try { node.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }

    function onMove(ev) {
      var dx = (ev.clientX - sx) / zoom;
      var dy = (ev.clientY - sy) / zoom;
      if (!moved && (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX)) {
        moved = true;
      }
      c.x = Math.round(ox + dx);
      c.y = Math.round(oy + dy);
      updateCleaverPosition(c, node);
    }

    function onUp(ev) {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      try { node.releasePointerCapture(ev.pointerId); } catch (err2) { /* ignore */ }
      node.classList.remove('is-dragging');
      document.body.classList.remove('lab-cleaver-dragging');
      if (selection.id === c.id) node.classList.add('is-selected');
      if (!moved) {
        var root = node.querySelector('[data-cleaver-root]') || node.querySelector('.fiber-cleaver');
        if (root && global.FiberCleaver && typeof FiberCleaver.toggleClamp === 'function') {
          c.clamped = FiberCleaver.toggleClamp(root);
          pushHistory();
          setStatus(c.clamped ? 'Fiber Cleaver clamped' : 'Fiber Cleaver open');
        }
      } else {
        pushHistory();
      }
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function bindLayerEvents(host) {
    host.querySelectorAll('[data-cleaver-node]').forEach(function (node) {
      var hit = node.querySelector('.lab-cleaver__hit') || node;

      hit.addEventListener('click', function (e) {
        if (!isClientOnCleaverHit(node, e.clientX, e.clientY)) return;
        e.stopPropagation();
        selectCleaver(node.getAttribute('data-cleaver-node'), { skipRebuild: true });
        host.querySelectorAll('.lab-cleaver.is-selected').forEach(function (el) {
          if (el !== node) el.classList.remove('is-selected');
        });
        node.classList.add('is-selected');
      });

      hit.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        if (!isClientOnCleaverHit(node, e.clientX, e.clientY)) return;
        e.preventDefault();
        e.stopPropagation();
        var id = node.getAttribute('data-cleaver-node');
        var c = findCleaver(id);
        if (!c) return;
        selectCleaver(id, { skipRebuild: true });
        host.querySelectorAll('.lab-cleaver.is-selected').forEach(function (el) {
          if (el !== node) el.classList.remove('is-selected');
        });
        node.classList.add('is-selected');
        startCleaverDrag(e, c, node);
      });
    });
  }

  function updateInspector() {
    var card = document.getElementById('lab-inspector-card');
    var detail = document.getElementById('lab-inspector-detail');
    if (!card) return;
    if (selection.kind !== 'cleaver' || !selection.id) return;

    var c = findCleaver(selection.id);
    if (!c) {
      selection = { kind: 'none', id: null };
      return;
    }

    card.innerHTML =
      '<h2>Fiber Cleaver</h2>' +
      '<p>Precision cleaver · seat bare fiber in the V-groove channel.</p>';

    if (!detail) return;
    detail.hidden = false;
    detail.innerHTML =
      '<div class="lab-cleaver-config">' +
      '<p class="lab-inspector__label">Position</p>' +
      '<p class="lab-pcord-attach">X ' + c.x + ' · Y ' + c.y + '</p>' +
      '<p class="lab-pcord-attach">Arm · ' + (c.clamped ? 'CLAMPED' : 'OPEN') + '</p>' +
      '<button type="button" class="lab-eject-btn" data-remove-cleaver="' + c.id +
      '">Remove Cleaver</button>' +
      '</div>';

    var rm = detail.querySelector('[data-remove-cleaver]');
    if (rm) {
      rm.addEventListener('click', function () {
        removeCleaver(c.id);
      });
    }
  }

  function renderToolbox() {
    var host = document.getElementById('lab-cleaver-tree');
    if (!host) return;
    host.innerHTML =
      '<div class="lab-toolbox" role="list">' +
      '<div class="tool-item lab-tool lab-tool--cleaver' +
      (selectedTool === 'cleaver' ? ' is-selected' : '') +
      '" data-tool="cleaver" data-lab-tool="cleaver" draggable="true" ' +
      'role="listitem" tabindex="0" title="Fiber Cleaver">' +
      '<span class="lab-tool__mark lab-tool__mark--cleaver" aria-hidden="true"></span>' +
      '<span class="lab-tool__copy">' +
      '<strong>Fiber Cleaver</strong>' +
      '<span>Precision cleave · V-groove</span>' +
      '</span>' +
      '</div>' +
      '</div>';
    bindToolbox(host);
  }

  function bindToolbox(host) {
    var btn = host.querySelector('[data-tool="cleaver"]');
    if (!btn) return;

    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('fiber-cleaver');
      }
      selectedTool = 'cleaver';
      renderToolbox();
      setStatus('Fiber Cleaver · drag onto workspace');
    });

    btn.addEventListener('dragstart', function (ev) {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('fiber-cleaver');
      }
      selectedTool = 'cleaver';
      dragLib = { kind: 'cleaver' };
      if (global.FtthLab && FtthLab.beginDrag) FtthLab.beginDrag({ kind: 'cleaver' });
      try {
        ev.dataTransfer.setData('text/plain', 'lab:cleaver');
        ev.dataTransfer.setData('text/lab-drag', 'cleaver');
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
      if (!el || el.dataset.cleaverDrop === '1') return;
      el.dataset.cleaverDrop = '1';

      el.addEventListener('dragover', function (ev) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        if (!((dragLib && dragLib.kind === 'cleaver') || (active && active.kind === 'cleaver'))) {
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
        if (kind !== 'cleaver') return;
        ev.preventDefault();
        ev.stopPropagation();
        dragLib = null;
        if (global.FtthLab && FtthLab.endDrag) FtthLab.endDrag();
        var pt = clientToWorld(ev.clientX, ev.clientY);
        placeCleaver(Math.round(pt.x), Math.round(pt.y));
        selectedTool = null;
        renderToolbox();
      });

      el.addEventListener('click', function (ev) {
        if (selectedTool !== 'cleaver') return;
        var active = global.FtthLab && FtthLab.getActiveToolboxTool && FtthLab.getActiveToolboxTool();
        if (active !== 'fiber-cleaver') return;
        if (!isStagePlacementTarget(ev.target)) return;
        ev.stopPropagation();
        var pt = clientToWorld(ev.clientX, ev.clientY);
        placeCleaver(Math.round(pt.x), Math.round(pt.y));
        selectedTool = null;
        renderToolbox();
      }, true);
    });
  }

  function deleteSelected() {
    if (selection.kind === 'cleaver' && selection.id) {
      removeCleaver(selection.id);
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
    if (id === 'fiber-cleaver') return;
    selectedTool = null;
    renderToolbox();
  }

  function mount() {
    renderToolbox();
    bindStageDrop();
    ensureLayer();
    rebuildLayer();
    pushHistory();
  }

  var tool = {
    id: 'fiber-cleaver',
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
      applySnapshot({ cleavers: [], seq: 0 });
    },
  };

  function tryRegister() {
    if (global.FtthLab && typeof FtthLab.registerTool === 'function') {
      FtthLab.registerTool('fiber-cleaver', tool);
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
