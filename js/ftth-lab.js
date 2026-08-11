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
  };

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

    var modeChip = $('lab-hud-mode');
    if (modeChip) {
      modeChip.textContent = state.viewMode === '2d'
        ? '2D Layout · FX-16 OLT'
        : '3D Workspace · FX-16 OLT';
    }

    notifyTools('onViewChange', { viewMode: state.viewMode });
    onResize();
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
  }

  function boot() {
    bindUi();
    initThree();
    state.booted = true;
    flushPendingTools();
    setViewMode('2d');
    setStatus('FTTH Lab ready · blank workspace · assemble from library');
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
  };

  global.FtthLab = api;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : this);
