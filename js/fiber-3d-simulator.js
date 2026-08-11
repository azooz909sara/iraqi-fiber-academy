/**
 * Fiber Optics 3D/2D Interactive Anatomy
 * Hierarchical click-to-peel: Jacket → Loose Tubes → 6 strands / tube
 * Capacities: 12F / 24F / 36F / 48F with exact tube & strand color maps.
 */
(function () {
  'use strict';

  var COLOR = {
    Blue: { name: 'Blue', hex: '#2563eb' },
    Orange: { name: 'Orange', hex: '#f97316' },
    Green: { name: 'Green', hex: '#22c55e' },
    Brown: { name: 'Brown', hex: '#a16207' },
    Slate: { name: 'Slate/Grey', hex: '#64748b' },
    White: { name: 'White', hex: '#f8fafc' },
    Red: { name: 'Red', hex: '#ef4444' },
    Black: { name: 'Black', hex: '#1e293b' },
  };

  var STRAND_ORDER = ['Blue', 'Orange', 'Green', 'Brown', 'Slate', 'White'];

  var CABLE_SPECS = {
    12: {
      capacity: 12,
      label: '12F',
      tubes: ['Blue', 'Orange'],
    },
    24: {
      capacity: 24,
      label: '24F',
      tubes: ['Blue', 'Orange', 'Green', 'Brown'],
    },
    36: {
      capacity: 36,
      label: '36F',
      tubes: ['Blue', 'Orange', 'Green', 'Brown', 'Slate', 'White'],
    },
    48: {
      capacity: 48,
      label: '48F',
      tubes: ['Blue', 'Orange', 'Green', 'Brown', 'Slate', 'White', 'Red', 'Black'],
    },
  };

  var COMPONENTS = {
    cable: {
      id: 'cable',
      title: 'Fiber Cable Anatomy',
      desc: 'Click the jacket to peel tubes, then click a tube to reveal its 6 standard-color strands.',
    },
    fdt: {
      id: 'fdt',
      title: 'FDT Cabinet',
      desc: 'Fiber Distribution Terminal anatomy: trays, ports, and splitter bays.',
    },
    splitter: {
      id: 'splitter',
      title: 'Optical Splitter',
      desc: 'Passive PLC splitter with input and fan-out outputs.',
    },
    olt: {
      id: 'olt',
      title: 'OLT Line Card',
      desc: 'Optical Line Terminal shelf with PON ports and indicators.',
    },
  };

  var state = {
    component: 'cable',
    capacity: 12,
    peelState: 0, /* 0 jacket, 1 tubes, 2 strands */
    selectedTube: null,
    viewMode: '3d', /* 3d | 2d */
    autoRotate: true,
    scene: null,
    camera: null,
    renderer: null,
    root: null,
    raycaster: null,
    pointer: null,
    jacketMesh: null,
    coreMesh: null,
    tubeGroups: [],
    tubeMeshes: [],
    strandMeshes: [],
    propMeshes: [],
    drag: null,
    raf: 0,
  };

  /* Concentric cable layout (axis along +X after cylinder rotate) */
  var CABLE_3D = {
    jacketR: 1.05,
    jacketLen: 4.4,
    jacketOpenLen: 2.15,
    coreR: 0.2,
    bufferR: 0.3,
    coreLen: 4.55,
    tubeR: 0.175,
    tubeLen: 3.85,
    strandR: 0.028,
    strandLen: 3.35,
    ringClosed: 0.56,
    ringOpen: 0.64,
    ringExpand: 0.72,
  };

  function $(id) { return document.getElementById(id); }

  function getSpec() {
    return CABLE_SPECS[state.capacity] || CABLE_SPECS[12];
  }

  function colorOf(key) {
    return COLOR[key] || COLOR.Blue;
  }

  function setStatus(msg) {
    var el = $('f3d-status');
    if (el) el.textContent = msg || '';
  }

  function clearMeshList(list) {
    (list || []).forEach(function (m) {
      if (!m) return;
      if (m.parent) m.parent.remove(m);
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        if (Array.isArray(m.material)) m.material.forEach(function (mat) { mat.dispose(); });
        else m.material.dispose();
      }
    });
  }

  function disposeCableMeshes() {
    (state.tubeGroups || []).forEach(function (group) {
      while (group.children.length) {
        var ch = group.children[0];
        group.remove(ch);
        if (ch.geometry) ch.geometry.dispose();
        if (ch.material) {
          if (Array.isArray(ch.material)) ch.material.forEach(function (m) { m.dispose(); });
          else ch.material.dispose();
        }
      }
      if (group.parent) group.parent.remove(group);
    });
    state.tubeGroups = [];
    state.tubeMeshes = [];
    state.strandMeshes = [];
    clearMeshList([state.jacketMesh].concat(state.propMeshes));
    state.jacketMesh = null;
    state.coreMesh = null;
    state.propMeshes = [];
  }

  /* ─── Inspector / 2D technical layout ─── */

  function renderInspector() {
    var card = $('f3d-inspector-card');
    var stack = $('f3d-layer-stack');
    var fibers = $('f3d-fiber-grid');
    if (!card || !stack) return;

    var comp = COMPONENTS[state.component] || COMPONENTS.cable;
    var spec = getSpec();

    if (state.component === 'cable') {
      var peelLabel = state.peelState === 0
        ? 'State 1 · Full cable (outer jacket)'
        : state.peelState === 1
          ? 'State 2 · Loose tubes (' + spec.tubes.length + ' × 6F)'
          : 'State 3 · Tube ' + (state.selectedTube + 1) + ' strands';
      card.innerHTML =
        '<h2>' + spec.label + ' Cable Anatomy</h2>' +
        '<p>' + comp.desc + '</p>' +
        '<p class="f3d-inspector__state">' + peelLabel + '</p>';
    } else {
      card.innerHTML = '<h2>' + comp.title + '</h2><p>' + comp.desc + '</p>';
    }

    stack.innerHTML = '';
    if (state.component === 'cable') {
      spec.tubes.forEach(function (tubeKey, idx) {
        var c = colorOf(tubeKey);
        var row = document.createElement('button');
        row.type = 'button';
        row.className = 'f3d-layer-row f3d-layer-row--btn' +
          (state.peelState >= 1 && state.selectedTube === idx ? ' is-active' : '') +
          (state.peelState === 0 ? ' is-dim' : '');
        row.innerHTML =
          '<span class="f3d-swatch" style="background:' + c.hex + '"></span>' +
          '<span>Tube ' + (idx + 1) + ' · ' + c.name + ' · 6 strands</span>';
        row.addEventListener('click', function () {
          if (state.peelState === 0) peelToTubes();
          openTubeStrands(idx);
        });
        stack.appendChild(row);
      });
    }

    if (fibers) {
      fibers.innerHTML = '';
      if (state.component === 'cable' && state.peelState === 2 && state.selectedTube != null) {
        var tubeKey = spec.tubes[state.selectedTube];
        STRAND_ORDER.forEach(function (key, i) {
          var c = colorOf(key);
          var chip = document.createElement('div');
          chip.className = 'f3d-fiber-chip';
          chip.innerHTML =
            '<span class="f3d-swatch" style="background:' + c.hex + '"></span>' +
            '<span>' + (i + 1) + ' · ' + c.name + '</span>';
          fibers.appendChild(chip);
        });
        fibers.hidden = false;
        var cap = $('f3d-fiber-caption');
        if (cap) {
          cap.hidden = false;
          cap.textContent = 'Tube ' + (state.selectedTube + 1) + ' (' + colorOf(tubeKey).name + ') · 6 strands';
        }
      } else {
        fibers.hidden = true;
        var capEl = $('f3d-fiber-caption');
        if (capEl) capEl.hidden = true;
      }
    }

    render2dLayout();
  }

  function render2dLayout() {
    var host = $('f3d-2d-host');
    if (!host) return;
    if (state.viewMode !== '2d' || state.component !== 'cable') {
      host.innerHTML = state.viewMode === '2d'
        ? '<p class="f3d-2d-empty">2D technical layout is available for Fiber Cable. Select a cable capacity (12F–48F).</p>'
        : '';
      return;
    }

    var spec = getSpec();
    var tubeCount = spec.tubes.length;
    var step = state.peelState === 0 ? 1 : state.peelState === 1 ? 2 : 3;
    var html = '<div class="f3d-2d-sheet" data-f3d-2d-step="' + step + '">';

    html += '<div class="f3d-2d-steps" aria-label="Dissection steps">' +
      '<span class="f3d-2d-step' + (step === 1 ? ' is-current' : step > 1 ? ' is-done' : '') + '">1 · Jacket</span>' +
      '<span class="f3d-2d-step' + (step === 2 ? ' is-current' : step > 2 ? ' is-done' : '') + '">2 · Tubes</span>' +
      '<span class="f3d-2d-step' + (step === 3 ? ' is-current' : '') + '">3 · Strands</span>' +
      '</div>';

    html += '<div class="f3d-2d-title">' + spec.label + ' Technical Layout</div>';
    html += '<p class="f3d-2d-subtitle">Layer-by-layer · ' + tubeCount +
      ' tubes × 6 strands · left → right</p>';

    /* Schematic stage: Jacket | Tube ribbon | (optional strand detail below) */
    html += '<div class="f3d-schematic" style="--tube-count:' + tubeCount + '">';

    if (state.peelState === 0) {
      /* Layer 1 only — solid closed jacket */
      html += '<button type="button" class="f3d-schematic__row f3d-schematic__row--closed" ' +
        'data-f3d-2d-peel="jacket" title="Click jacket to expose loose tubes" ' +
        'aria-label="' + spec.label + ' outer jacket — click to peel">' +
        '<span class="f3d-layer-jacket">' +
        '<span class="f3d-layer-jacket__label">' + spec.label + '</span>' +
        '</span>' +
        '<span class="f3d-schematic__hint">Click jacket → expose tubes</span>' +
        '</button>';
    } else {
      /* Layer 1 + Layer 2 — jacket flush to tube ribbon stack */
      html += '<div class="f3d-schematic__row f3d-schematic__row--tubes" aria-label="Jacket and loose tubes">';
      html += '<div class="f3d-layer-jacket f3d-layer-jacket--open" title="Outer jacket">' +
        '<span class="f3d-layer-jacket__label">' + spec.label + '</span>' +
        '</div>';
      html += '<div class="f3d-tube-ribbon" role="list">';
      spec.tubes.forEach(function (tubeKey, ti) {
        var tc = colorOf(tubeKey);
        var sel = state.peelState === 2 && state.selectedTube === ti;
        html += '<button type="button" class="f3d-tube-bar' + (sel ? ' is-selected' : '') + '" ' +
          'role="listitem" data-f3d-2d-tube="' + ti + '" ' +
          'style="--tube-color:' + tc.hex + '" ' +
          'title="Tube ' + (ti + 1) + ' · ' + tc.name + ' — click for 6 strands" ' +
          'aria-pressed="' + (sel ? 'true' : 'false') + '">' +
          '<span class="f3d-tube-bar__fill"></span>' +
          '<span class="f3d-tube-bar__name">T' + (ti + 1) + ' ' + tc.name + '</span>' +
          '</button>';
      });
      html += '</div></div>';

      /* Layer 3 — selected tube expanded below with parallel strand lines */
      if (state.peelState === 2 && state.selectedTube != null) {
        var tk = spec.tubes[state.selectedTube];
        var tcSel = colorOf(tk);
        html += '<div class="f3d-schematic__row f3d-schematic__row--strands" ' +
          'aria-label="Tube ' + (state.selectedTube + 1) + ' fiber strands">' +
          '<div class="f3d-layer-tube" style="--tube-color:' + tcSel.hex + '">' +
          '<span class="f3d-layer-tube__label">T' + (state.selectedTube + 1) + '</span>' +
          '</div>' +
          '<div class="f3d-strand-ribbon" role="list">';
        STRAND_ORDER.forEach(function (sk, si) {
          var sc = colorOf(sk);
          html += '<div class="f3d-strand-line" role="listitem" ' +
            'style="--strand-color:' + sc.hex + '" title="F' + (si + 1) + ' · ' + sc.name + '">' +
            '<span class="f3d-strand-line__fill"></span>' +
            '</div>';
        });
        html += '</div>' +
          '<div class="f3d-strand-legend">';
        STRAND_ORDER.forEach(function (sk, si) {
          var sc = colorOf(sk);
          html += '<span class="f3d-strand-legend__item">' +
            '<i style="background:' + sc.hex + '"></i>F' + (si + 1) + ' ' + sc.name + '</span>';
        });
        html += '</div></div>';
      } else {
        html += '<p class="f3d-schematic__hint f3d-schematic__hint--below">Click a tube bar → 6 strands</p>';
      }
    }

    html += '</div>'; /* .f3d-schematic */

    if (state.peelState > 0) {
      html += '<button type="button" class="f3d-2d-reset" data-f3d-2d-reset="1">← Reset to Full Jacket</button>';
    }

    html += '</div>';
    host.innerHTML = html;

    var peelBtn = host.querySelector('[data-f3d-2d-peel="jacket"]');
    if (peelBtn) peelBtn.addEventListener('click', peelToTubes);
    host.querySelectorAll('[data-f3d-2d-tube]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openTubeStrands(parseInt(btn.getAttribute('data-f3d-2d-tube'), 10));
      });
    });
    var reset = host.querySelector('[data-f3d-2d-reset]');
    if (reset) reset.addEventListener('click', resetPeel);
  }

  /* ─── Peel state machine ─── */

  function resetPeel() {
    state.peelState = 0;
    state.selectedTube = null;
    applyPeelVisibility();
    renderInspector();
    setStatus(getSpec().label + ' · Full cable jacket — click to peel tubes');
  }

  function peelToTubes() {
    if (state.component !== 'cable') return;
    state.peelState = 1;
    state.selectedTube = null;
    applyPeelVisibility();
    renderInspector();
    setStatus(getSpec().label + ' · Loose tubes exposed — click a tube for 6 strands');
  }

  function openTubeStrands(tubeIndex) {
    if (state.component !== 'cable') return;
    var spec = getSpec();
    if (tubeIndex < 0 || tubeIndex >= spec.tubes.length) return;
    state.peelState = 2;
    state.selectedTube = tubeIndex;
    applyPeelVisibility();
    renderInspector();
    var t = colorOf(spec.tubes[tubeIndex]);
    setStatus(getSpec().label + ' · Tube ' + (tubeIndex + 1) + ' (' + t.name + ') · 6 strands');
  }

  function applyPeelVisibility() {
    if (state.component !== 'cable') return;
    var peel = state.peelState;
    var cfg = CABLE_3D;
    var n = Math.max(getSpec().tubes.length, 1);

    /* Layer 1 — full jacket vs cutaway stub (tubes emerge past edge) */
    if (state.jacketMesh) {
      state.jacketMesh.visible = true;
      state.jacketMesh.material.transparent = false;
      state.jacketMesh.material.opacity = 1;
      if (peel === 0) {
        state.jacketMesh.scale.set(1, 1, 1);
        state.jacketMesh.position.x = 0;
      } else {
        var openScale = cfg.jacketOpenLen / cfg.jacketLen;
        state.jacketMesh.scale.set(1, openScale, 1);
        state.jacketMesh.position.x = -(cfg.jacketLen - cfg.jacketOpenLen) / 2;
      }
    }

    /* Central strength member visible once jacket is peeled */
    state.propMeshes.forEach(function (m) {
      if (!m) return;
      if (m.userData && (m.userData.kind === 'core' || m.userData.kind === 'coreBuffer')) {
        m.visible = peel >= 1;
        if (peel >= 1) {
          m.position.x = 0.2;
        } else {
          m.position.x = 0;
        }
      }
    });

    var ringR = peel === 0 ? cfg.ringClosed : peel === 1 ? cfg.ringOpen : cfg.ringExpand;
    var tubeShiftX = peel === 0 ? 0 : peel === 1 ? 0.45 : 0.55;

    (state.tubeGroups || []).forEach(function (group, i) {
      if (!group) return;
      var angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      group.visible = peel >= 1;
      group.position.set(
        tubeShiftX,
        Math.cos(angle) * ringR,
        Math.sin(angle) * ringR
      );

      var tube = state.tubeMeshes[i];
      var selected = peel === 2 && state.selectedTube === i;
      if (tube && tube.material) {
        tube.visible = peel >= 1;
        tube.material.transparent = peel === 2;
        tube.material.opacity = peel === 2 ? (selected ? 0.55 : 0.28) : 1;
        tube.scale.set(selected ? 1.08 : 1, selected ? 1.05 : 1, selected ? 1.08 : 1);
      }
    });

    /* Layer 3 — 6 strands emerge from selected tube, slight radial fan */
    state.strandMeshes.forEach(function (fiber) {
      if (!fiber) return;
      var tid = fiber.userData.tubeIndex;
      var show = peel === 2 && state.selectedTube === tid;
      fiber.visible = show;
      if (!show) return;
      var a = fiber.userData.localA;
      var baseR = fiber.userData.localR || 0.075;
      var fanR = baseR * 1.55;
      fiber.position.set(0.85, Math.cos(a) * fanR, Math.sin(a) * fanR);
      fiber.scale.set(1, 1.35, 1);
    });
  }

  /* ─── 3D builders ─── */

  function rebuildSceneContent() {
    if (!state.root || typeof THREE === 'undefined') return;
    disposeCableMeshes();

    if (state.component === 'cable') buildCableAnatomy();
    else if (state.component === 'fdt') buildFdtAnatomy();
    else if (state.component === 'splitter') buildSplitterAnatomy();
    else buildOltAnatomy();

    applyPeelVisibility();
  }

  function buildCableAnatomy() {
    var cfg = CABLE_3D;
    var spec = getSpec();
    var n = spec.tubes.length;

    /* Central FRP / steel strength member */
    var core = new THREE.Mesh(
      new THREE.CylinderGeometry(cfg.coreR, cfg.coreR, cfg.coreLen, 28),
      new THREE.MeshStandardMaterial({
        color: 0xc5ccd6,
        roughness: 0.32,
        metalness: 0.62,
      })
    );
    core.rotation.z = Math.PI / 2;
    core.userData = { kind: 'core' };
    core.visible = false;
    state.root.add(core);
    state.coreMesh = core;
    state.propMeshes.push(core);

    /* Coating around strength member */
    var buffer = new THREE.Mesh(
      new THREE.CylinderGeometry(cfg.bufferR, cfg.bufferR, cfg.coreLen - 0.12, 28),
      new THREE.MeshStandardMaterial({
        color: 0x6b7280,
        roughness: 0.72,
        metalness: 0.12,
      })
    );
    buffer.rotation.z = Math.PI / 2;
    buffer.userData = { kind: 'coreBuffer' };
    buffer.visible = false;
    state.root.add(buffer);
    state.propMeshes.push(buffer);

    /* Outer black jacket */
    var jacket = new THREE.Mesh(
      new THREE.CylinderGeometry(cfg.jacketR, cfg.jacketR, cfg.jacketLen, 56),
      new THREE.MeshStandardMaterial({
        color: 0x141414,
        roughness: 0.88,
        metalness: 0.04,
      })
    );
    jacket.rotation.z = Math.PI / 2;
    jacket.userData = { kind: 'jacket', baseLen: cfg.jacketLen };
    state.root.add(jacket);
    state.jacketMesh = jacket;

    /* Loose tubes in a symmetric ring; each holds 6 strands */
    spec.tubes.forEach(function (tubeKey, i) {
      var angle = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
      var group = new THREE.Group();
      group.position.set(
        0,
        Math.cos(angle) * cfg.ringClosed,
        Math.sin(angle) * cfg.ringClosed
      );
      group.userData = { kind: 'tubeGroup', tubeIndex: i };
      group.visible = false;

      var c = colorOf(tubeKey);
      var tube = new THREE.Mesh(
        new THREE.CylinderGeometry(cfg.tubeR, cfg.tubeR, cfg.tubeLen, 22),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(c.hex),
          roughness: 0.42,
          metalness: 0.1,
          transparent: true,
          opacity: 1,
        })
      );
      tube.rotation.z = Math.PI / 2;
      tube.userData = { kind: 'tube', tubeIndex: i, tubeColor: tubeKey };
      group.add(tube);
      state.tubeMeshes.push(tube);

      STRAND_ORDER.forEach(function (strandKey, si) {
        var sc = colorOf(strandKey);
        var a = (si / 6) * Math.PI * 2 - Math.PI / 2;
        var localR = 0.075;
        var fiber = new THREE.Mesh(
          new THREE.CylinderGeometry(cfg.strandR, cfg.strandR, cfg.strandLen, 10),
          new THREE.MeshStandardMaterial({
            color: new THREE.Color(sc.hex),
            roughness: 0.28,
            metalness: 0.22,
            emissive: new THREE.Color(sc.hex),
            emissiveIntensity: strandKey === 'Black' || strandKey === 'Slate' ? 0.04 : 0.12,
          })
        );
        fiber.rotation.z = Math.PI / 2;
        fiber.position.set(0, Math.cos(a) * localR, Math.sin(a) * localR);
        fiber.visible = false;
        fiber.userData = {
          kind: 'strand',
          tubeIndex: i,
          strandIndex: si,
          strandColor: strandKey,
          localA: a,
          localR: localR,
        };
        group.add(fiber);
        state.strandMeshes.push(fiber);
      });

      state.root.add(group);
      state.tubeGroups.push(group);
    });
  }

  function buildFdtAnatomy() {
    var body = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 3.2, 1.2),
      new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.55, metalness: 0.25 })
    );
    state.root.add(body);
    state.propMeshes.push(body);
    state.jacketMesh = body;
    state.peelState = 0;
  }

  function buildSplitterAnatomy() {
    var housing = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.7, 1.1),
      new THREE.MeshStandardMaterial({ color: 0x4c1d95, roughness: 0.5, metalness: 0.2 })
    );
    state.root.add(housing);
    state.jacketMesh = housing;
    state.propMeshes.push(housing);
    state.peelState = 0;
  }

  function buildOltAnatomy() {
    var chassis = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 1.4, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.55, metalness: 0.35 })
    );
    state.root.add(chassis);
    state.jacketMesh = chassis;
    state.propMeshes.push(chassis);
    state.peelState = 0;
  }

  /* ─── View controls ─── */

  function setViewMode(mode) {
    state.viewMode = mode === '2d' ? '2d' : '3d';
    var app = $('f3d-app');
    if (app) {
      app.classList.toggle('f3d-app--2d', state.viewMode === '2d');
      app.classList.toggle('f3d-app--3d', state.viewMode === '3d');
    }
    document.querySelectorAll('[data-f3d-view]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-f3d-view') === state.viewMode);
    });
    var host3d = $('f3d-canvas-host');
    var host2d = $('f3d-2d-host');
    if (host3d) host3d.hidden = state.viewMode !== '3d';
    if (host2d) host2d.hidden = state.viewMode !== '2d';
    renderInspector();
    setStatus(state.viewMode === '2d' ? '2D technical layout' : '3D dissection view');
    onResize();
  }

  function setAutoRotate(on) {
    state.autoRotate = !!on;
    var btn = $('f3d-auto-rotate');
    if (btn) {
      btn.classList.toggle('is-active', state.autoRotate);
      btn.setAttribute('aria-pressed', state.autoRotate ? 'true' : 'false');
      btn.textContent = state.autoRotate ? 'Auto-Rotate: On' : 'Auto-Rotate: Off';
    }
  }

  function setCapacity(cap) {
    var n = parseInt(cap, 10);
    if (!CABLE_SPECS[n]) return;
    state.capacity = n;
    state.component = 'cable';
    state.peelState = 0;
    state.selectedTube = null;
    syncComponentButtons();
    rebuildSceneContent();
    renderInspector();
    setStatus(getSpec().label + ' selected · click jacket to peel');
  }

  function setComponent(id) {
    if (!COMPONENTS[id]) return;
    state.component = id;
    state.peelState = 0;
    state.selectedTube = null;
    syncComponentButtons();
    rebuildSceneContent();
    renderInspector();
    setStatus(COMPONENTS[id].title);
  }

  function syncComponentButtons() {
    document.querySelectorAll('[data-f3d-component]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-f3d-component') === state.component);
    });
    document.querySelectorAll('[data-f3d-capacity]').forEach(function (btn) {
      var cap = parseInt(btn.getAttribute('data-f3d-capacity'), 10);
      btn.classList.toggle('is-active', state.component === 'cable' && cap === state.capacity);
    });
  }

  /* ─── Picking ─── */

  function onStagePointerDown(e) {
    if (state.viewMode !== '3d' || !state.renderer) return;
    state.drag = {
      x: e.clientX,
      y: e.clientY,
      moved: false,
      pointerId: e.pointerId,
    };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }

  function onStagePointerMove(e) {
    if (!state.drag || !state.root) return;
    var dx = e.clientX - state.drag.x;
    var dy = e.clientY - state.drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) state.drag.moved = true;
    state.drag.x = e.clientX;
    state.drag.y = e.clientY;
    if (state.drag.moved) {
      state.root.rotation.y += dx * 0.01;
      state.root.rotation.x += dy * 0.008;
      state.root.rotation.x = Math.max(-1.1, Math.min(1.1, state.root.rotation.x));
    }
  }

  function onStagePointerUp(e) {
    if (!state.drag) return;
    var wasClick = !state.drag.moved;
    state.drag = null;
    if (wasClick) handleStageClick(e);
  }

  function handleStageClick(e) {
    if (state.component !== 'cable' || !state.renderer || !state.camera || !state.raycaster) return;
    var host = $('f3d-canvas-host');
    if (!host) return;
    var rect = host.getBoundingClientRect();
    state.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    state.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    state.raycaster.setFromCamera(state.pointer, state.camera);

    var targets = [];
    if (state.peelState === 0 && state.jacketMesh) targets.push(state.jacketMesh);
    if (state.peelState >= 1) targets = targets.concat(state.tubeMeshes);
    if (state.peelState === 2) targets = targets.concat(state.strandMeshes.filter(function (m) { return m.visible; }));

    var hits = state.raycaster.intersectObjects(targets, false);
    if (!hits.length) return;
    var hit = hits[0].object;
    var kind = hit.userData && hit.userData.kind;
    if (kind === 'jacket' || (state.peelState === 0 && hit === state.jacketMesh)) {
      peelToTubes();
      return;
    }
    if (kind === 'tube') {
      openTubeStrands(hit.userData.tubeIndex);
    }
  }

  /* ─── Three.js lifecycle ─── */

  function initThree() {
    var host = $('f3d-canvas-host');
    if (!host || typeof THREE === 'undefined') {
      setStatus('3D engine unavailable');
      return;
    }

    var w = host.clientWidth || 800;
    var h = host.clientHeight || 500;

    state.scene = new THREE.Scene();
    state.scene.background = new THREE.Color(0x000000);
    state.camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100);
    state.camera.position.set(5.2, 2.6, 4.4);
    state.camera.lookAt(0.3, 0, 0);

    state.renderer = new THREE.WebGLRenderer({ antialias: true });
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    state.renderer.setSize(w, h, false);
    host.appendChild(state.renderer.domElement);

    state.raycaster = new THREE.Raycaster();
    state.pointer = new THREE.Vector2();

    state.scene.add(new THREE.AmbientLight(0xb8c4d6, 0.48));
    var key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(5, 7, 4);
    state.scene.add(key);
    var rim = new THREE.DirectionalLight(0xffffff, 0.45);
    rim.position.set(-4, 2, -3);
    state.scene.add(rim);
    var fill = new THREE.DirectionalLight(0x94a3b8, 0.35);
    fill.position.set(1, -2, 5);
    state.scene.add(fill);

    state.root = new THREE.Group();
    state.root.rotation.set(0.35, -0.85, 0.15);
    state.scene.add(state.root);

    rebuildSceneContent();

    host.addEventListener('pointerdown', onStagePointerDown);
    host.addEventListener('pointermove', onStagePointerMove);
    host.addEventListener('pointerup', onStagePointerUp);
    host.addEventListener('pointerleave', function () { state.drag = null; });
    host.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (!state.camera) return;
      var z = state.camera.position.z + (e.deltaY > 0 ? 0.35 : -0.35);
      state.camera.position.z = Math.max(2.8, Math.min(9, z));
    }, { passive: false });

    animate();
    window.addEventListener('resize', onResize);
  }

  function onResize() {
    var host = $('f3d-canvas-host');
    if (!host || !state.camera || !state.renderer || state.viewMode !== '3d') return;
    var w = host.clientWidth || 1;
    var h = host.clientHeight || 1;
    state.camera.aspect = w / h;
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(w, h, false);
  }

  function animate() {
    state.raf = requestAnimationFrame(animate);
    if (state.root && state.autoRotate && !state.drag && state.viewMode === '3d') {
      state.root.rotation.y += 0.0035;
    }
    if (state.renderer && state.scene && state.camera && state.viewMode === '3d') {
      state.renderer.render(state.scene, state.camera);
    }
  }

  function bindUi() {
    document.querySelectorAll('[data-f3d-component]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setComponent(btn.getAttribute('data-f3d-component'));
      });
    });
    document.querySelectorAll('[data-f3d-capacity]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setCapacity(btn.getAttribute('data-f3d-capacity'));
      });
    });
    document.querySelectorAll('[data-f3d-view]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setViewMode(btn.getAttribute('data-f3d-view'));
      });
    });
    var rot = $('f3d-auto-rotate');
    if (rot) {
      rot.addEventListener('click', function () {
        setAutoRotate(!state.autoRotate);
      });
    }
    var reset = $('f3d-reset-peel');
    if (reset) reset.addEventListener('click', resetPeel);
  }

  function boot() {
    bindUi();
    syncComponentButtons();
    setAutoRotate(true);
    setViewMode('3d');
    setCapacity(12);
    initThree();
    setStatus('12F ready · click jacket to peel tubes');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
