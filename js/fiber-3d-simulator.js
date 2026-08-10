/**
 * Fiber Optics 3D Interactive Anatomy — workspace controller.
 * Layers: Outer Jacket → Loose Tubes → 12-color fiber strands.
 * Components: Cable, FDT, Splitter, OLT.
 */
(function () {
  'use strict';

  var FIBER_COLORS = [
    { name: 'Blue', hex: '#2563eb' },
    { name: 'Orange', hex: '#f97316' },
    { name: 'Green', hex: '#22c55e' },
    { name: 'Brown', hex: '#a16207' },
    { name: 'Slate', hex: '#64748b' },
    { name: 'White', hex: '#f8fafc' },
    { name: 'Red', hex: '#ef4444' },
    { name: 'Black', hex: '#1e293b' },
    { name: 'Yellow', hex: '#eab308' },
    { name: 'Violet', hex: '#8b5cf6' },
    { name: 'Rose', hex: '#fb7185' },
    { name: 'Aqua', hex: '#22d3ee' },
  ];

  var COMPONENTS = {
    cable: {
      id: 'cable',
      title: 'Fiber Cable Anatomy',
      desc: 'Interactive dissection of a loose-tube outdoor cable — peel from the outer jacket inward to the 12-color fiber strands.',
      icon: '🧬',
    },
    fdt: {
      id: 'fdt',
      title: 'FDT Cabinet',
      desc: 'Fiber Distribution Terminal anatomy: feeder ports, distribution trays, and splitter mounting bays.',
      icon: '📦',
    },
    splitter: {
      id: 'splitter',
      title: 'Optical Splitter',
      desc: 'Passive PLC splitter body with input fiber and fan-out outputs for last-mile distribution.',
      icon: '🔀',
    },
    olt: {
      id: 'olt',
      title: 'OLT Line Card',
      desc: 'Optical Line Terminal shelf anatomy — PON ports, uplink cages, and service indicators.',
      icon: '🖥️',
    },
  };

  var LAYERS = [
    { id: 'jacket', label: '1 · Outer Jacket', color: '#111827' },
    { id: 'tubes', label: '2 · Loose Tubes', color: '#f59e0b' },
    { id: 'fibers', label: '3 · 12-Color Strands', color: '#22d3ee' },
  ];

  var state = {
    component: 'cable',
    layerIndex: 0,
    scene: null,
    camera: null,
    renderer: null,
    root: null,
    meshes: { jacket: null, tubes: [], fibers: [], props: [] },
    raf: 0,
    drag: null,
  };

  function $(id) { return document.getElementById(id); }

  function setStatus(msg) {
    var el = $('f3d-status');
    if (el) el.textContent = msg || '';
  }

  function renderInspector() {
    var card = $('f3d-inspector-card');
    var stack = $('f3d-layer-stack');
    var fibers = $('f3d-fiber-grid');
    if (!card || !stack) return;

    var comp = COMPONENTS[state.component] || COMPONENTS.cable;
    card.innerHTML =
      '<h2>' + comp.title + '</h2>' +
      '<p>' + comp.desc + '</p>';

    stack.innerHTML = '';
    LAYERS.forEach(function (layer, idx) {
      var row = document.createElement('div');
      row.className = 'f3d-layer-row' + (idx === state.layerIndex ? ' is-active' : '');
      row.innerHTML =
        '<span class="f3d-swatch" style="background:' + layer.color + '"></span>' +
        '<span>' + layer.label + '</span>';
      stack.appendChild(row);
    });

    if (fibers) {
      fibers.innerHTML = '';
      FIBER_COLORS.forEach(function (f, i) {
        var chip = document.createElement('div');
        chip.className = 'f3d-fiber-chip';
        chip.innerHTML =
          '<span class="f3d-swatch" style="background:' + f.hex + '"></span>' +
          '<span>' + (i + 1) + ' · ' + f.name + '</span>';
        fibers.appendChild(chip);
      });
      fibers.hidden = state.component !== 'cable' || state.layerIndex < 2;
    }
  }

  function syncLayerButtons() {
    document.querySelectorAll('[data-f3d-layer]').forEach(function (btn) {
      var idx = parseInt(btn.getAttribute('data-f3d-layer'), 10);
      btn.classList.toggle('is-active', idx === state.layerIndex);
    });
  }

  function syncComponentButtons() {
    document.querySelectorAll('[data-f3d-component]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-f3d-component') === state.component);
    });
  }

  function clearGroup(arr) {
    (arr || []).forEach(function (m) {
      if (!m) return;
      if (m.parent) m.parent.remove(m);
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        if (Array.isArray(m.material)) m.material.forEach(function (mat) { mat.dispose(); });
        else m.material.dispose();
      }
    });
  }

  function rebuildSceneContent() {
    if (!state.root || typeof THREE === 'undefined') return;

    clearGroup([state.meshes.jacket].concat(state.meshes.tubes, state.meshes.fibers, state.meshes.props));
    state.meshes = { jacket: null, tubes: [], fibers: [], props: [] };

    if (state.component === 'cable') buildCableAnatomy();
    else if (state.component === 'fdt') buildFdtAnatomy();
    else if (state.component === 'splitter') buildSplitterAnatomy();
    else buildOltAnatomy();

    applyLayerVisibility();
  }

  function buildCableAnatomy() {
    var jacketMat = new THREE.MeshStandardMaterial({
      color: 0x1f2937,
      roughness: 0.72,
      metalness: 0.08,
    });
    var jacket = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 4.2, 48), jacketMat);
    jacket.rotation.z = Math.PI / 2;
    state.root.add(jacket);
    state.meshes.jacket = jacket;

    var tubeCount = 6;
    var i;
    for (i = 0; i < tubeCount; i++) {
      var angle = (i / tubeCount) * Math.PI * 2;
      var tube = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.28, 3.6, 24),
        new THREE.MeshStandardMaterial({
          color: i % 2 === 0 ? 0xf59e0b : 0xfbbf24,
          roughness: 0.55,
          metalness: 0.05,
        })
      );
      tube.rotation.z = Math.PI / 2;
      tube.position.set(0, Math.cos(angle) * 0.55, Math.sin(angle) * 0.55);
      state.root.add(tube);
      state.meshes.tubes.push(tube);
    }

    FIBER_COLORS.forEach(function (f, idx) {
      var a = (idx / FIBER_COLORS.length) * Math.PI * 2;
      var fiber = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.07, 3.2, 12),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(f.hex),
          roughness: 0.35,
          metalness: 0.2,
          emissive: new THREE.Color(f.hex),
          emissiveIntensity: 0.12,
        })
      );
      fiber.rotation.z = Math.PI / 2;
      fiber.position.set(0, Math.cos(a) * 0.22, Math.sin(a) * 0.22);
      state.root.add(fiber);
      state.meshes.fibers.push(fiber);
    });
  }

  function buildFdtAnatomy() {
    var body = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 3.2, 1.2),
      new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.55, metalness: 0.25 })
    );
    state.root.add(body);
    state.meshes.props.push(body);

    var door = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 3.0, 0.08),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.45, metalness: 0.2 })
    );
    door.position.set(0, 0, 0.7);
    state.root.add(door);
    state.meshes.jacket = door;

    var tray;
    for (var i = 0; i < 4; i++) {
      tray = new THREE.Mesh(
        new THREE.BoxGeometry(1.8, 0.12, 0.7),
        new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6 })
      );
      tray.position.set(0, 1.0 - i * 0.55, 0.05);
      state.root.add(tray);
      state.meshes.tubes.push(tray);
    }

    FIBER_COLORS.slice(0, 8).forEach(function (f, idx) {
      var port = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 0.35, 12),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(f.hex), roughness: 0.4 })
      );
      port.rotation.x = Math.PI / 2;
      port.position.set(-0.7 + (idx % 4) * 0.45, -1.2, 0.35 + Math.floor(idx / 4) * 0.25);
      state.root.add(port);
      state.meshes.fibers.push(port);
    });
  }

  function buildSplitterAnatomy() {
    var housing = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.7, 1.1),
      new THREE.MeshStandardMaterial({ color: 0x4c1d95, roughness: 0.5, metalness: 0.2 })
    );
    state.root.add(housing);
    state.meshes.jacket = housing;

    var input = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 1.2, 12),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35 })
    );
    input.rotation.z = Math.PI / 2;
    input.position.set(-1.7, 0, 0);
    state.root.add(input);
    state.meshes.tubes.push(input);

    for (var i = 0; i < 8; i++) {
      var out = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 1.4, 10),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(FIBER_COLORS[i].hex),
          roughness: 0.4,
        })
      );
      out.rotation.z = Math.PI / 2;
      out.position.set(1.7, (i - 3.5) * 0.12, 0);
      state.root.add(out);
      state.meshes.fibers.push(out);
    }
  }

  function buildOltAnatomy() {
    var chassis = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 1.4, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.55, metalness: 0.35 })
    );
    state.root.add(chassis);
    state.meshes.jacket = chassis;

    var face = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 1.15, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.45, metalness: 0.3 })
    );
    face.position.z = 1.15;
    state.root.add(face);
    state.meshes.tubes.push(face);

    for (var i = 0; i < 12; i++) {
      var led = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.16, 0.05),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(FIBER_COLORS[i].hex),
          emissive: new THREE.Color(FIBER_COLORS[i].hex),
          emissiveIntensity: 0.45,
          roughness: 0.3,
        })
      );
      led.position.set(-1.4 + (i % 6) * 0.48, 0.25 - Math.floor(i / 6) * 0.45, 1.2);
      state.root.add(led);
      state.meshes.fibers.push(led);
    }
  }

  function applyLayerVisibility() {
    var idx = state.layerIndex;
    if (state.meshes.jacket) {
      state.meshes.jacket.visible = idx === 0;
      if (state.component === 'cable' && state.meshes.jacket.material) {
        state.meshes.jacket.material.transparent = idx > 0;
        state.meshes.jacket.material.opacity = idx === 0 ? 1 : 0.18;
        state.meshes.jacket.visible = true;
      }
    }
    state.meshes.tubes.forEach(function (m) {
      if (!m) return;
      m.visible = idx >= 1;
    });
    state.meshes.fibers.forEach(function (m) {
      if (!m) return;
      m.visible = idx >= 2;
    });
    state.meshes.props.forEach(function (m) {
      if (!m) return;
      m.visible = true;
    });

    /* Explode layers slightly for readability */
    var explode = idx * 0.22;
    state.meshes.tubes.forEach(function (m, i) {
      if (!m || state.component !== 'cable') return;
      var angle = (i / Math.max(state.meshes.tubes.length, 1)) * Math.PI * 2;
      m.position.y = Math.cos(angle) * (0.55 + explode);
      m.position.z = Math.sin(angle) * (0.55 + explode);
    });
    state.meshes.fibers.forEach(function (m, i) {
      if (!m || state.component !== 'cable') return;
      var angle = (i / Math.max(state.meshes.fibers.length, 1)) * Math.PI * 2;
      m.position.y = Math.cos(angle) * (0.22 + explode * 0.7);
      m.position.z = Math.sin(angle) * (0.22 + explode * 0.7);
    });
  }

  function setLayer(idx) {
    state.layerIndex = Math.max(0, Math.min(LAYERS.length - 1, idx));
    applyLayerVisibility();
    syncLayerButtons();
    renderInspector();
    setStatus(LAYERS[state.layerIndex].label + ' · ' + (COMPONENTS[state.component].title));
  }

  function setComponent(id) {
    if (!COMPONENTS[id]) return;
    state.component = id;
    state.layerIndex = 0;
    rebuildSceneContent();
    syncComponentButtons();
    syncLayerButtons();
    renderInspector();
    setStatus(COMPONENTS[id].title + ' ready — drag to orbit');
  }

  function initThree() {
    var host = $('f3d-canvas-host');
    if (!host || typeof THREE === 'undefined') {
      setStatus('3D engine unavailable');
      return;
    }

    var w = host.clientWidth || 800;
    var h = host.clientHeight || 500;

    state.scene = new THREE.Scene();
    state.scene.background = new THREE.Color(0x070b12);

    state.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
    state.camera.position.set(4.2, 2.2, 4.8);
    state.camera.lookAt(0, 0, 0);

    state.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    state.renderer.setSize(w, h, false);
    host.appendChild(state.renderer.domElement);

    var amb = new THREE.AmbientLight(0x9fb4d9, 0.55);
    state.scene.add(amb);
    var key = new THREE.DirectionalLight(0xffffff, 1.05);
    key.position.set(4, 6, 3);
    state.scene.add(key);
    var fill = new THREE.DirectionalLight(0x00e5ff, 0.35);
    fill.position.set(-3, 2, -2);
    state.scene.add(fill);

    var grid = new THREE.GridHelper(12, 24, 0x164e63, 0x0f172a);
    grid.position.y = -1.8;
    state.scene.add(grid);

    state.root = new THREE.Group();
    state.scene.add(state.root);

    rebuildSceneContent();
    bindOrbit(host);
    animate();
    window.addEventListener('resize', onResize);
  }

  function bindOrbit(host) {
    host.addEventListener('pointerdown', function (e) {
      state.drag = { x: e.clientX, y: e.clientY };
      host.setPointerCapture(e.pointerId);
    });
    host.addEventListener('pointermove', function (e) {
      if (!state.drag || !state.root) return;
      var dx = e.clientX - state.drag.x;
      var dy = e.clientY - state.drag.y;
      state.drag = { x: e.clientX, y: e.clientY };
      state.root.rotation.y += dx * 0.01;
      state.root.rotation.x += dy * 0.008;
      state.root.rotation.x = Math.max(-1.1, Math.min(1.1, state.root.rotation.x));
    });
    host.addEventListener('pointerup', function () { state.drag = null; });
    host.addEventListener('pointerleave', function () { state.drag = null; });
    host.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (!state.camera) return;
      var z = state.camera.position.z + (e.deltaY > 0 ? 0.35 : -0.35);
      state.camera.position.z = Math.max(2.8, Math.min(9, z));
    }, { passive: false });
  }

  function onResize() {
    var host = $('f3d-canvas-host');
    if (!host || !state.camera || !state.renderer) return;
    var w = host.clientWidth || 1;
    var h = host.clientHeight || 1;
    state.camera.aspect = w / h;
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(w, h, false);
  }

  function animate() {
    state.raf = requestAnimationFrame(animate);
    if (state.root && !state.drag) state.root.rotation.y += 0.0035;
    if (state.renderer && state.scene && state.camera) {
      state.renderer.render(state.scene, state.camera);
    }
  }

  function bindUi() {
    document.querySelectorAll('[data-f3d-component]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setComponent(btn.getAttribute('data-f3d-component'));
      });
    });
    document.querySelectorAll('[data-f3d-layer]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setLayer(parseInt(btn.getAttribute('data-f3d-layer'), 10) || 0);
      });
    });
    var peel = $('f3d-peel-next');
    if (peel) {
      peel.addEventListener('click', function () {
        setLayer(state.layerIndex >= LAYERS.length - 1 ? 0 : state.layerIndex + 1);
      });
    }
  }

  function boot() {
    bindUi();
    syncComponentButtons();
    syncLayerButtons();
    renderInspector();
    initThree();
    setStatus('Fiber Optics 3D Anatomy ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
