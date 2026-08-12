/**
 * FTTH Network & Patch Panel Lab — workspace shell
 * Empty modular stage: 2D layout canvas + 3D grid.
 * Tools register via FtthLab.registerTool(...) when added one-by-one.
 */
(function (global) {
  'use strict';

  var state = {
    viewMode: '2d', /* 2d | 3d */
    scene: null,
    camera: null,
    renderer: null,
    root: null,
    grid: null,
    raycaster: null,
    pointer: null,
    raf: 0,
    tools: {},
    booted: false,
    pendingTools: [],
    /* 2D canvas zoom (mouse wheel) */
    zoom2d: 1,
    pan2dX: 0,
    pan2dY: 0,
  };

  var ZOOM_MIN = 0.2;
  var ZOOM_MAX = 2.75;
  var ZOOM_STEP = 0.08;
  var WORLD_SIZE = 20000; /* virtually infinite workspace */

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(msg) {
    var el = $('lab-status');
    if (el) el.textContent = msg || '';
  }

  /* ─── Public tool registry (plug-and-play) ─── */

  function mountTool(id, tool) {
    if (typeof tool.mount !== 'function') return;
    try {
      tool.mount({
        viewMode: state.viewMode,
        host2d: document.getElementById('lab-2d-mount'),
        host3d: state.root,
        scene: state.scene,
        camera: state.camera,
        renderer: state.renderer,
        getViewMode: function () { return state.viewMode; },
      });
    } catch (err) {
      console.warn('[FtthLab] tool mount failed:', id, err);
    }
  }

  function registerTool(id, tool) {
    if (!id || !tool) return;
    if (!state.booted) {
      state.pendingTools.push({ id: id, tool: tool });
      return;
    }
    state.tools[id] = tool;
    mountTool(id, tool);
    setStatus('Tool registered: ' + id);
  }

  function flushPendingTools() {
    var queue = state.pendingTools.splice(0);
    queue.forEach(function (item) {
      state.tools[item.id] = item.tool;
      mountTool(item.id, item.tool);
    });
  }

  function notifyTools(eventName, payload) {
    Object.keys(state.tools).forEach(function (id) {
      var tool = state.tools[id];
      if (tool && typeof tool[eventName] === 'function') {
        try {
          tool[eventName](payload);
        } catch (err) {
          console.warn('[FtthLab] tool event failed:', id, eventName, err);
        }
      }
    });
  }

  function collectPickables() {
    var list = [];
    Object.keys(state.tools).forEach(function (id) {
      var tool = state.tools[id];
      if (tool && typeof tool.getPickables === 'function') {
        list = list.concat(tool.getPickables() || []);
      }
    });
    return list;
  }

  /* ─── View mode ─── */

  function setViewMode(mode) {
    state.viewMode = mode === '3d' ? '3d' : '2d';
    var app = $('lab-app');
    if (app) {
      app.classList.toggle('lab-app--2d', state.viewMode === '2d');
      app.classList.toggle('lab-app--3d', state.viewMode === '3d');
    }
    document.querySelectorAll('[data-lab-view]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-lab-view') === state.viewMode);
    });
    var host2d = $('lab-canvas-2d');
    var host3d = $('lab-canvas-3d');
    if (host2d) host2d.hidden = state.viewMode !== '2d';
    if (host3d) host3d.hidden = state.viewMode !== '3d';

    notifyTools('onViewChange', { viewMode: state.viewMode });
    onResize();
    applyZoom2d();
  }

  /* ─── 2D mouse-wheel zoom ─── */

  var transformSettleTimer = null;

  function clampZoom(z) {
    return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  }

  /** Promote world layer only while transforming; settle clears will-change for sharp paint. */
  function markWorldTransforming() {
    var world = $('lab-2d-world');
    if (world) world.classList.add('is-transforming');
    if (transformSettleTimer) clearTimeout(transformSettleTimer);
    transformSettleTimer = setTimeout(function () {
      transformSettleTimer = null;
      var w = $('lab-2d-world');
      if (w) w.classList.remove('is-transforming');
    }, 180);
  }

  function applyZoom2d() {
    var world = $('lab-2d-world');
    if (world) {
      world.style.width = WORLD_SIZE + 'px';
      world.style.height = WORLD_SIZE + 'px';
      world.style.transform =
        'translate3d(' + state.pan2dX + 'px, ' + state.pan2dY + 'px, 0) scale(' + state.zoom2d + ')';
    }
    var chip = $('lab-hud-zoom');
    if (chip) chip.textContent = 'Zoom ' + Math.round(state.zoom2d * 100) + '%';
  }

  function zoom2dAt(clientX, clientY, nextZoom) {
    var stage = $('lab-canvas-2d');
    if (!stage) {
      state.zoom2d = clampZoom(nextZoom);
      markWorldTransforming();
      applyZoom2d();
      return;
    }
    var rect = stage.getBoundingClientRect();
    var mx = clientX - rect.left;
    var my = clientY - rect.top;
    var prev = state.zoom2d;
    var next = clampZoom(nextZoom);
    if (next === prev) return;
    /* Keep point under cursor stable while scaling */
    state.pan2dX = mx - ((mx - state.pan2dX) * (next / prev));
    state.pan2dY = my - ((my - state.pan2dY) * (next / prev));
    state.zoom2d = next;
    markWorldTransforming();
    applyZoom2d();
  }

  function onStageWheel(e) {
    if (state.viewMode !== '2d') return;
    e.preventDefault();
    var dir = e.deltaY > 0 ? -1 : 1;
    zoom2dAt(e.clientX, e.clientY, state.zoom2d + dir * ZOOM_STEP);
  }

  function centerWorldInView() {
    var stage = $('lab-canvas-2d');
    if (!stage) return;
    var z = state.zoom2d || 1;
    state.pan2dX = (stage.clientWidth / 2) - (WORLD_SIZE / 2) * z;
    state.pan2dY = (stage.clientHeight / 2) - (WORLD_SIZE / 2) * z;
    applyZoom2d();
  }

  function isCanvasPanTarget(target) {
    if (!target || !target.closest) return true;
    if (target.closest('[data-lab-resize]')) return false;
    if (target.closest('[data-lab-chassis-drag]')) return false;
    if (target.closest('.lab-fx-slot')) return false;
    if (target.closest('.lab-fx-port')) return false;
    if (target.closest('.lab-fx-chassis-frame')) return false;
    if (target.closest('.lab-cas-cassette') || target.closest('.lab-spl-node')) return false;
    if (target.closest('.lab-pcord')) return false;
    if (target.closest('.lab-pigtail')) return false;
    if (target.closest('.lab-cpl') || target.closest('.lab-cpl-port')) return false;
    if (target.closest('.lab-vfl')) return false;
    if (target.closest('.lab-toolbox') || target.closest('.lab-tool')) return false;
    return true;
  }

  function bindPan2d(stage) {
    if (!stage || stage.dataset.panBound === '1') return;
    stage.dataset.panBound = '1';
    var pan = null;
    var panMoved = false;

    stage.addEventListener('pointerdown', function (e) {
      if (state.viewMode !== '2d') return;
      var middle = e.button === 1;
      var leftEmpty = e.button === 0 && isCanvasPanTarget(e.target);
      if (!middle && !leftEmpty) return;
      if (middle) e.preventDefault();
      panMoved = false;
      pan = {
        x: e.clientX,
        y: e.clientY,
        panX: state.pan2dX,
        panY: state.pan2dY,
        pointerId: e.pointerId,
      };
      stage.classList.add('is-panning');
      markWorldTransforming();
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });

    stage.addEventListener('pointermove', function (e) {
      if (!pan) return;
      if (Math.abs(e.clientX - pan.x) > 3 || Math.abs(e.clientY - pan.y) > 3) {
        panMoved = true;
      }
      state.pan2dX = pan.panX + (e.clientX - pan.x);
      state.pan2dY = pan.panY + (e.clientY - pan.y);
      markWorldTransforming();
      applyZoom2d();
    });

    function endPan() {
      if (!pan) return;
      pan = null;
      stage.classList.remove('is-panning');
      markWorldTransforming();
    }

    stage.addEventListener('pointerup', endPan);
    stage.addEventListener('pointercancel', endPan);
    stage.addEventListener('lostpointercapture', endPan);

    /* Empty workspace click clears toolbox arm + selection (not after a pan drag) */
    stage.addEventListener('click', function (e) {
      if (state.viewMode !== '2d') return;
      if (panMoved) {
        panMoved = false;
        return;
      }
      if (!isCanvasPanTarget(e.target)) return;
      clearWorkspaceSelection();
    });

    /* Prevent middle-click autoscroll */
    stage.addEventListener('auxclick', function (e) {
      if (e.button === 1) e.preventDefault();
    });
  }

  function bindZoom2d() {
    var stage = $('lab-canvas-2d');
    if (!stage || stage.dataset.zoomBound === '1') return;
    stage.dataset.zoomBound = '1';
    stage.addEventListener('wheel', onStageWheel, { passive: false });
    bindPan2d(stage);
    centerWorldInView();
  }

  function undo() {
    if (timelineIndex < 0) {
      setStatus('Nothing to undo');
      return false;
    }
    var toolId = timeline[timelineIndex];
    var tool = state.tools[toolId];
    var ok = false;
    if (tool && typeof tool.undo === 'function') {
      try { ok = !!tool.undo(); } catch (err) {
        console.warn('[FtthLab] undo failed:', toolId, err);
      }
    }
    if (ok) {
      timelineIndex -= 1;
      updateHistoryUi();
      setStatus('Undo');
    } else {
      setStatus('Nothing to undo');
    }
    return ok;
  }

  function redo() {
    if (timelineIndex >= timeline.length - 1) {
      setStatus('Nothing to redo');
      return false;
    }
    var next = timelineIndex + 1;
    var toolId = timeline[next];
    var tool = state.tools[toolId];
    var ok = false;
    if (tool && typeof tool.redo === 'function') {
      try { ok = !!tool.redo(); } catch (err) {
        console.warn('[FtthLab] redo failed:', toolId, err);
      }
    }
    if (ok) {
      timelineIndex = next;
      updateHistoryUi();
      setStatus('Redo');
    } else {
      setStatus('Nothing to redo');
    }
    return ok;
  }

  var timeline = [];
  var timelineIndex = -1;
  var selectionOwner = null;

  function recordHistory(toolId) {
    if (!toolId) return;
    timeline = timeline.slice(0, timelineIndex + 1);
    timeline.push(toolId);
    timelineIndex = timeline.length - 1;
    updateHistoryUi();
  }

  function updateHistoryUi() {
    var undoBtn = $('lab-btn-undo');
    var redoBtn = $('lab-btn-redo');
    if (undoBtn) undoBtn.disabled = timelineIndex < 0;
    if (redoBtn) redoBtn.disabled = timelineIndex < 0 || timelineIndex >= timeline.length - 1;
  }

  function setSelectionOwner(toolId) {
    selectionOwner = toolId || null;
  }

  var activeToolboxTool = null;

  /**
   * Enforce a single toolbox active highlight across all rail categories
   * (Active Equipment / Splitters / Fiber Jumpers / Adapters / Test Equipment).
   * Pass null to strip every sidebar tool highlight.
   */
  function claimToolboxTool(toolId) {
    activeToolboxTool = toolId || null;
    document.querySelectorAll('.lab-rail .lab-tool.is-selected').forEach(function (el) {
      el.classList.remove('is-selected');
    });
    notifyTools('onToolboxClaim', { toolId: activeToolboxTool });
  }

  function getActiveToolboxTool() {
    return activeToolboxTool;
  }

  function resetInspectorIdle() {
    var card = $('lab-inspector-card');
    var detail = $('lab-inspector-detail');
    if (card) {
      card.innerHTML =
        '<h2>No selection</h2>' +
        '<p>Select equipment on the canvas, or drag an item from the toolbox.</p>';
    }
    if (detail) {
      detail.hidden = true;
      detail.innerHTML = '';
    }
  }

  /** ESC: clear workspace selection, disarm tools, reset active UI states. */
  function clearWorkspaceSelection() {
    if (global.FtthLab) global.FtthLab._patchPending = null;
    notifyTools('cancelPatch');
    notifyTools('clearSelection');
    claimToolboxTool(null);
    selectionOwner = null;
    resetInspectorIdle();
    setStatus('Selection cleared');
  }

  function deleteSelected() {
    if (selectionOwner && state.tools[selectionOwner] &&
        typeof state.tools[selectionOwner].deleteSelected === 'function') {
      try {
        if (state.tools[selectionOwner].deleteSelected()) {
          setStatus('Deleted');
          return true;
        }
      } catch (err) {
        console.warn('[FtthLab] deleteSelected failed:', selectionOwner, err);
      }
    }
    var ids = Object.keys(state.tools);
    for (var i = ids.length - 1; i >= 0; i--) {
      var tool = state.tools[ids[i]];
      if (tool && typeof tool.deleteSelected === 'function') {
        try {
          if (tool.deleteSelected()) {
            setStatus('Deleted');
            return true;
          }
        } catch (err) {
          console.warn('[FtthLab] deleteSelected failed:', ids[i], err);
        }
      }
    }
    setStatus('Nothing selected to delete');
    return false;
  }

  function isTypingTarget(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  /* ─── 3D empty grid stage ─── */

  function initThree() {
    var host = $('lab-canvas-3d');
    if (!host || typeof THREE === 'undefined') {
      setStatus('3D engine unavailable — 2D stage still active');
      return;
    }

    var w = host.clientWidth || 800;
    var h = host.clientHeight || 500;

    state.scene = new THREE.Scene();
    state.scene.background = new THREE.Color(0x070b12);

    state.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 200);
    state.camera.position.set(5.5, 3.2, 6.5);
    state.camera.lookAt(0, 1.0, 0);

    state.renderer = new THREE.WebGLRenderer({ antialias: true });
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    state.renderer.setSize(w, h, false);
    host.appendChild(state.renderer.domElement);

    state.raycaster = new THREE.Raycaster();
    state.pointer = new THREE.Vector2();

    state.scene.add(new THREE.AmbientLight(0xb8c4d6, 0.55));
    var key = new THREE.DirectionalLight(0xffffff, 0.95);
    key.position.set(5, 8, 4);
    state.scene.add(key);
    var fill = new THREE.DirectionalLight(0x38bdf8, 0.25);
    fill.position.set(-4, 3, -2);
    state.scene.add(fill);

    var grid = new THREE.GridHelper(20, 40, 0x164e63, 0x0f172a);
    state.scene.add(grid);
    state.grid = grid;

    state.root = new THREE.Group();
    state.root.name = 'lab-tool-root';
    state.scene.add(state.root);

    var drag = null;
    host.addEventListener('pointerdown', function (e) {
      drag = { x: e.clientX, y: e.clientY, moved: false };
      try { host.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    host.addEventListener('pointermove', function (e) {
      if (!drag || !state.root) return;
      var dx = e.clientX - drag.x;
      var dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (drag.moved) {
        state.root.rotation.y += dx * 0.01;
        state.root.rotation.x += dy * 0.008;
        state.root.rotation.x = Math.max(-1.0, Math.min(1.0, state.root.rotation.x));
      }
    });
    host.addEventListener('pointerup', function (e) {
      if (!drag) return;
      var wasClick = !drag.moved;
      drag = null;
      if (wasClick) handleStageClick(e);
    });
    host.addEventListener('pointerleave', function () { drag = null; });
    host.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (!state.camera) return;
      var z = state.camera.position.z + (e.deltaY > 0 ? 0.4 : -0.4);
      state.camera.position.z = Math.max(3.5, Math.min(16, z));
      state.camera.position.x = state.camera.position.z * 0.75;
      state.camera.position.y = 1.2 + state.camera.position.z * 0.35;
      state.camera.lookAt(0, 1.0, 0);
    }, { passive: false });

    animate();
    window.addEventListener('resize', onResize);
  }

  function handleStageClick(e) {
    if (state.viewMode !== '3d' || !state.raycaster || !state.camera || !state.renderer) return;
    var host = $('lab-canvas-3d');
    if (!host) return;
    var rect = host.getBoundingClientRect();
    state.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    state.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    state.raycaster.setFromCamera(state.pointer, state.camera);
    var targets = collectPickables();
    var hits = state.raycaster.intersectObjects(targets, false);
    if (!hits.length) return;
    notifyTools('onStageClick', {
      object: hits[0].object,
      userData: hits[0].object.userData,
      point: hits[0].point,
    });
  }

  function onResize() {
    var host = $('lab-canvas-3d');
    if (!host || !state.camera || !state.renderer || state.viewMode !== '3d') return;
    var w = host.clientWidth || 1;
    var h = host.clientHeight || 1;
    state.camera.aspect = w / h;
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(w, h, false);
  }

  function animate() {
    state.raf = requestAnimationFrame(animate);
    if (state.renderer && state.scene && state.camera && state.viewMode === '3d') {
      state.renderer.render(state.scene, state.camera);
    }
  }

  function bindUi() {
    document.querySelectorAll('[data-lab-view]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setViewMode(btn.getAttribute('data-lab-view'));
      });
    });

    var undoBtn = $('lab-btn-undo');
    var redoBtn = $('lab-btn-redo');
    var deleteBtn = $('lab-btn-delete');
    if (undoBtn) undoBtn.addEventListener('click', undo);
    if (redoBtn) redoBtn.addEventListener('click', redo);
    if (deleteBtn) deleteBtn.addEventListener('click', function () { deleteSelected(); });

    /* Capture-phase on window: works without focusing a field; blocks browser Undo/Redo */
    if (!bindUi._keysBound) {
      bindUi._keysBound = true;
      window.addEventListener('keydown', function (e) {
        var ctrl = e.ctrlKey || e.metaKey;
        var code = e.code || '';
        var key = e.key || '';
        var keyLower = key.toLowerCase();
        var isZ = code === 'KeyZ' || keyLower === 'z';
        var isY = code === 'KeyY' || keyLower === 'y';

        if (ctrl && isZ && !e.shiftKey && !e.altKey) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          undo();
          return;
        }
        if (ctrl && !e.altKey && (isY || (isZ && e.shiftKey))) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          redo();
          return;
        }

        if (isTypingTarget(e.target)) return;

        if (key === 'Escape') {
          e.preventDefault();
          clearWorkspaceSelection();
          return;
        }
        if (key === 'Delete' || key === 'Backspace') {
          e.preventDefault();
          deleteSelected();
        }
      }, true);
    }

    bindZoom2d();
    bindWorkspaceDnD();
    updateHistoryUi();
  }

  function boot() {
    bindUi();
    initThree();
    state.booted = true;
    flushPendingTools();
    setViewMode('2d');
    setStatus('FTTH Lab ready · Ctrl+Z / Ctrl+Y · Del delete · Esc clear · scroll to zoom');
  }

  function showAlert(msg, kind) {
    var host = $('lab-alert');
    if (!host) {
      host = document.createElement('div');
      host.id = 'lab-alert';
      host.className = 'lab-alert';
      host.setAttribute('role', 'alert');
      var stage = document.querySelector('.lab-stage-wrap') || document.body;
      stage.appendChild(host);
    }
    host.className = 'lab-alert' + (kind === 'warn' ? ' lab-alert--warn' : '');
    host.innerHTML =
      '<strong>Physical incompatibility</strong>' +
      '<p>' + (msg || '') + '</p>' +
      '<button type="button" class="lab-alert__close" aria-label="Dismiss">×</button>';
    host.hidden = false;
    var close = host.querySelector('.lab-alert__close');
    if (close) {
      close.onclick = function () { host.hidden = true; };
    }
    clearTimeout(showAlert._t);
    showAlert._t = setTimeout(function () {
      if (host) host.hidden = true;
    }, 7000);
    setStatus(msg);
  }

  function setBudget(text) {
    var chip = $('lab-hud-budget');
    if (chip) chip.textContent = text || 'Power budget · —';
  }

  function refreshPowerBudget() {
    var loss = 0;
    var mismatches = 0;
    Object.keys(state.tools).forEach(function (id) {
      var tool = state.tools[id];
      if (tool && typeof tool.getNetworkLossDb === 'function') {
        try {
          loss += Number(tool.getNetworkLossDb()) || 0;
        } catch (err) { /* ignore */ }
      }
      if (tool && typeof tool.getMismatchCount === 'function') {
        try {
          mismatches += Number(tool.getMismatchCount()) || 0;
        } catch (err2) { /* ignore */ }
      }
    });
    loss = Math.round(loss * 100) / 100;
    var text;
    if (loss <= 0) {
      text = 'Power budget · no active fiber path';
    } else if (mismatches > 0) {
      text = 'Power budget · Total Signal Loss ' + loss.toFixed(2) +
        ' dB · ' + mismatches + ' polish mismatch warning' + (mismatches > 1 ? 's' : '');
    } else {
      text = 'Power budget · Total Signal Loss ' + loss.toFixed(2) + ' dB';
    }
    setBudget(text);
    return loss;
  }

  /* ─── Shared HTML5 drag session (toolbox → workspace) ─── */

  var activeDrag = null;

  function beginDrag(payload) {
    activeDrag = payload && typeof payload === 'object' ? payload : null;
  }

  function endDrag() {
    activeDrag = null;
  }

  function getActiveDrag() {
    return activeDrag;
  }

  function clientToWorld2d(clientX, clientY) {
    var stage = $('lab-canvas-2d');
    if (!stage) return { x: 0, y: 0 };
    var rect = stage.getBoundingClientRect();
    var z = state.zoom2d || 1;
    return {
      x: (clientX - rect.left - state.pan2dX) / z,
      y: (clientY - rect.top - state.pan2dY) / z,
    };
  }

  function clearStageDropHighlight() {
    ['lab-canvas-2d', 'lab-2d-mount', 'lab-canvas-3d'].forEach(function (id) {
      var el = $(id);
      if (el) el.classList.remove('is-drop-target');
    });
  }

  /** Allow drops anywhere on the 2D stage while a toolbox drag is active */
  function bindWorkspaceDnD() {
    var stage = $('lab-canvas-2d');
    var world = $('lab-2d-world');
    var mount = $('lab-2d-mount');
    var canvas3d = $('lab-canvas-3d');

    function onDragOver(e) {
      if (!activeDrag) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      if (stage && state.viewMode === '2d') stage.classList.add('is-drop-target');
      if (canvas3d && state.viewMode === '3d') canvas3d.classList.add('is-drop-target');
    }

    function onDragLeave(e) {
      var zone = e.currentTarget;
      if (!zone) return;
      var related = e.relatedTarget;
      if (related && zone.contains(related)) return;
      zone.classList.remove('is-drop-target');
    }

    function onDrop(e) {
      if (!activeDrag) return;
      e.preventDefault();
      clearStageDropHighlight();
      /* Tools handle placement via their own drop listeners + getActiveDrag() */
    }

    [stage, world, mount, canvas3d].forEach(function (el) {
      if (!el || el.dataset.labWorkspaceDnd === '1') return;
      el.dataset.labWorkspaceDnd = '1';
      el.addEventListener('dragover', onDragOver);
      el.addEventListener('dragleave', onDragLeave);
      el.addEventListener('drop', onDrop);
    });
  }

  var api = {
    registerTool: registerTool,
    setViewMode: setViewMode,
    getViewMode: function () { return state.viewMode; },
    getRoot3d: function () { return state.root; },
    getMount2d: function () { return document.getElementById('lab-2d-mount'); },
    getCamera: function () { return state.camera; },
    getRenderer: function () { return state.renderer; },
    setStatus: setStatus,
    undo: undo,
    redo: redo,
    getZoom2d: function () { return state.zoom2d; },
    getPan2d: function () { return { x: state.pan2dX, y: state.pan2dY }; },
    getWorldSize: function () { return WORLD_SIZE; },
    centerWorldInView: centerWorldInView,
    showAlert: showAlert,
    setBudget: setBudget,
    refreshPowerBudget: refreshPowerBudget,
    notifyLayoutChange: function (payload) { notifyTools('onLayoutChange', payload); },
    beginDrag: beginDrag,
    endDrag: endDrag,
    getActiveDrag: getActiveDrag,
    clientToWorld2d: clientToWorld2d,
    clearStageDropHighlight: clearStageDropHighlight,
    recordHistory: recordHistory,
    updateHistoryUi: updateHistoryUi,
    deleteSelected: deleteSelected,
    setSelectionOwner: setSelectionOwner,
    claimToolboxTool: claimToolboxTool,
    getActiveToolboxTool: getActiveToolboxTool,
    clearWorkspaceSelection: clearWorkspaceSelection,
    resetInspectorIdle: resetInspectorIdle,
    tryPatchPort: null,
    _patchPending: null,
    /* Optical / VFL laser — tools fill these in on mount */
    getFiberLaserGraph: function () { return { pcords: [], pigtails: [] }; },
    applyFiberLaserGlow: function () {},
    getSplitterLaserModels: function () { return []; },
    refreshVflLaser: null,
    refreshSplitterPorts: null,
  };

  global.FtthLab = api;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : this);
