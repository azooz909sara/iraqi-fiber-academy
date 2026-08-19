/**
 * Fusion Splicer Lab — CFS-3 fiber optic stripper.
 * Interactive jaw clamp, 2-stage peel drag, debris particles, clamp audio/haptic.
 */
(function (global) {
  'use strict';

  var IMG_NATURAL_W = 296;
  var IMG_NATURAL_H = 843;
  var IMG_LEFT_EDGE = 107;
  var IMG_RIGHT_EDGE = 167;
  var IMG_PIVOT_LEFT_X = 276.6;
  var IMG_PIVOT_LEFT_Y = 199.2;
  var IMG_PIVOT_RIGHT_X = 14.3;
  var IMG_PIVOT_RIGHT_Y = 193.1;
  var ASSEMBLED_NATURAL_W =
    (IMG_PIVOT_LEFT_X - IMG_LEFT_EDGE) + (IMG_RIGHT_EDGE - IMG_PIVOT_RIGHT_X);
  var STRIPPER_H = 239;
  var STRIPPER_W = Math.round(ASSEMBLED_NATURAL_W * STRIPPER_H / IMG_NATURAL_H);
  var PIVOT_X = STRIPPER_W / 2;
  var PIVOT_Y = ((IMG_PIVOT_LEFT_Y + IMG_PIVOT_RIGHT_Y) / 2) * STRIPPER_H / IMG_NATURAL_H;
  var JAW_CLOSED_DEG = 0;
  var JAW_OPEN_DEG = 12;
  var DRAG_THRESHOLD_PX = 3;
  var CLAMP_PROX_PX = 44;
  var PEEL_JACKET_PX = 42;
  var PEEL_BUFFER_PX = 26;
  var HISTORY_MAX = 40;

  var layer = null;
  var debrisLayer = null;
  var strippers = [];
  var particles = [];
  var particleRaf = null;
  var seq = 0;
  var selection = { kind: 'none', id: null };
  var dragLib = null;
  var selectedTool = null;
  var history = [];
  var historyIndex = -1;
  var historyLocked = false;
  var audioCtx = null;
  var stripperLeftImg = null;
  var stripperRightImg = null;
  var imagesReady = false;
  var imagesLoading = false;

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

  function findStripper(id) {
    for (var i = 0; i < strippers.length; i++) {
      if (strippers[i].id === id) return strippers[i];
    }
    return null;
  }

  function findStripTarget(clientX, clientY) {
    if (global.FtthLab && typeof FtthLab.findPigtailStripTarget === 'function') {
      return FtthLab.findPigtailStripTarget(clientX, clientY, CLAMP_PROX_PX);
    }
    return null;
  }

  function setStripPeel(pigtailId, peel) {
    if (global.FtthLab && typeof FtthLab.setPigtailStripPeel === 'function') {
      FtthLab.setPigtailStripPeel(pigtailId, peel);
    }
  }

  function commitStripStage(pigtailId) {
    if (global.FtthLab && typeof FtthLab.commitPigtailStripStage === 'function') {
      return FtthLab.commitPigtailStripStage(pigtailId);
    }
    return false;
  }

  function clearStripPeel(pigtailId) {
    if (global.FtthLab && typeof FtthLab.clearPigtailStripPeel === 'function') {
      FtthLab.clearPigtailStripPeel(pigtailId);
    }
  }

  function captureSnapshot() {
    return { strippers: JSON.parse(JSON.stringify(strippers)), seq: seq };
  }

  function applySnapshot(snap) {
    if (!snap) return;
    historyLocked = true;
    strippers = snap.strippers || [];
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
      FtthLab.recordHistory('cfs-stripper');
    }
  }

  function undo() {
    if (historyIndex <= 0) return false;
    historyIndex -= 1;
    applySnapshot(history[historyIndex]);
    setStatus('Undo · CFS-3 Stripper');
    return true;
  }

  function redo() {
    if (historyIndex >= history.length - 1) return false;
    historyIndex += 1;
    applySnapshot(history[historyIndex]);
    setStatus('Redo · CFS-3 Stripper');
    return true;
  }

  function playClampSnip() {
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var t = audioCtx.currentTime;
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(920, t);
      osc.frequency.exponentialRampToValueAtTime(180, t + 0.045);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.08, t + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.07);
    } catch (err) { /* ignore */ }
    try {
      if (navigator.vibrate) navigator.vibrate(14);
    } catch (err2) { /* ignore */ }
  }

  function ensureDebrisLayer() {
    if (debrisLayer && debrisLayer.parentNode) return debrisLayer;
    var mount = document.getElementById('lab-2d-mount');
    if (!mount) return null;
    debrisLayer = document.createElement('div');
    debrisLayer.className = 'lab-stripper-debris-layer';
    debrisLayer.setAttribute('data-lab-stripper-debris', '1');
    mount.appendChild(debrisLayer);
    return debrisLayer;
  }

  function ensureLayer() {
    if (layer && layer.parentNode) return layer;
    var mount = document.getElementById('lab-2d-mount');
    if (!mount) return null;
    layer = document.createElement('div');
    layer.className = 'lab-stripper-layer';
    layer.setAttribute('data-lab-stripper-layer', '1');
    mount.appendChild(layer);
    ensureDebrisLayer();
    return layer;
  }

  function spawnDebris(x, y, stage, peelUx, peelUy) {
    var host = ensureDebrisLayer();
    if (!host) return;
    var count = stage === 0 ? 7 : 5;
    var i;
    for (i = 0; i < count; i++) {
      var w = stage === 0 ? 5 + Math.random() * 9 : 2 + Math.random() * 4;
      var h = stage === 0 ? 3 + Math.random() * 5 : 1.5 + Math.random() * 3;
      var spread = (Math.random() - 0.5) * 14;
      particles.push({
        x: x + peelUx * (4 + Math.random() * 8) + (-peelUy) * spread,
        y: y + peelUy * (4 + Math.random() * 8) + peelUx * spread,
        vx: peelUx * (1.2 + Math.random() * 2.4) + (Math.random() - 0.5) * 0.8,
        vy: peelUy * (0.6 + Math.random() * 1.2) + Math.random() * 0.4,
        rot: Math.random() * 360,
        vr: (Math.random() - 0.5) * 18,
        w: w,
        h: h,
        life: 1,
        stage: stage,
        el: null,
      });
    }
    startParticleLoop();
  }

  function spawnPeelFragment(x, y, stage, peelUx, peelUy, peelProgress) {
    var host = ensureDebrisLayer();
    if (!host) return;
    var len = stage === 0 ? 14 + peelProgress * 10 : 8 + peelProgress * 6;
    particles.push({
      x: x,
      y: y,
      vx: peelUx * 0.35,
      vy: peelUy * 0.2,
      rot: Math.atan2(peelUy, peelUx) * 180 / Math.PI,
      vr: 0,
      w: len,
      h: stage === 0 ? 4.5 : 2.5,
      life: 1,
      stage: stage,
      isFragment: true,
      el: null,
    });
    startParticleLoop();
  }

  function startParticleLoop() {
    if (particleRaf) return;
    function tick() {
      if (!particles.length) {
        particleRaf = null;
        if (debrisLayer) debrisLayer.innerHTML = '';
        return;
      }
      var host = ensureDebrisLayer();
      if (!host) {
        particles = [];
        particleRaf = null;
        return;
      }
      var alive = [];
      var html = '';
      var i;
      for (i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.vy += 0.22;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life -= p.isFragment ? 0.028 : 0.018;
        if (p.life <= 0 || p.y > 22000) continue;
        alive.push(p);
        var alpha = Math.min(1, p.life * 1.4);
        var color = p.stage === 0
          ? 'rgba(250, 204, 21, ' + alpha + ')'
          : 'rgba(96, 165, 250, ' + alpha + ')';
        var border = p.stage === 0
          ? 'rgba(161, 98, 7, ' + alpha + ')'
          : 'rgba(29, 78, 216, ' + alpha + ')';
        html +=
          '<span class="lab-stripper-debris' + (p.isFragment ? ' is-fragment' : '') + '" ' +
          'style="left:' + Math.round(p.x) + 'px;top:' + Math.round(p.y) + 'px;' +
          'width:' + p.w.toFixed(1) + 'px;height:' + p.h.toFixed(1) + 'px;' +
          'transform:rotate(' + p.rot.toFixed(1) + 'deg);' +
          'background:' + color + ';border-color:' + border + ';"></span>';
      }
      particles = alive;
      host.innerHTML = html;
      particleRaf = requestAnimationFrame(tick);
    }
    particleRaf = requestAnimationFrame(tick);
  }

  function preloadStripperImages(done) {
    if (imagesReady) {
      if (done) done();
      return;
    }
    if (imagesLoading) {
      if (done) {
        var wait = setInterval(function () {
          if (imagesReady) {
            clearInterval(wait);
            done();
          }
        }, 16);
      }
      return;
    }
    imagesLoading = true;
    var loaded = 0;
    function onReady() {
      loaded += 1;
      if (loaded < 2) return;
      imagesReady =
        stripperLeftImg && stripperRightImg &&
        stripperLeftImg.complete && stripperRightImg.complete &&
        stripperLeftImg.naturalWidth > 0 && stripperRightImg.naturalWidth > 0;
      imagesLoading = false;
      if (layer) paintAllStrippers();
      if (done) done();
    }
    stripperLeftImg = new Image();
    stripperRightImg = new Image();
    stripperLeftImg.decoding = 'async';
    stripperRightImg.decoding = 'async';
    stripperLeftImg.onload = onReady;
    stripperRightImg.onload = onReady;
    stripperLeftImg.onerror = onReady;
    stripperRightImg.onerror = onReady;
    stripperLeftImg.src = 'images/stripper-left.png';
    stripperRightImg.src = 'images/stripper-right.png';
  }

  function getJawSpreadRad(s) {
    // PNG halves are sliced closed at 0°. Spring-rest idle spreads jaws outward ±JAW_OPEN_DEG.
    var spreadDeg = s.jawState === 'clamped' ? JAW_CLOSED_DEG : JAW_OPEN_DEG;
    return spreadDeg * Math.PI / 180;
  }

  function drawCentralScrew(ctx, pivotX, pivotY, scale) {
    var screwR = 7.2 * scale;
    var grad = ctx.createRadialGradient(
      pivotX - screwR * 0.22, pivotY - screwR * 0.28, 0,
      pivotX, pivotY, screwR
    );
    grad.addColorStop(0, '#f1f5f9');
    grad.addColorStop(0.55, '#9ca3af');
    grad.addColorStop(1, '#6b7280');
    ctx.beginPath();
    ctx.arc(pivotX, pivotY, screwR, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 0.85;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(pivotX, pivotY, screwR * 0.72, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.6)';
    ctx.lineWidth = 0.35;
    ctx.stroke();
    ctx.fillStyle = '#374151';
    ctx.beginPath();
    ctx.arc(pivotX, pivotY, screwR * 0.33, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1.15;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pivotX, pivotY - screwR * 0.36);
    ctx.lineTo(pivotX, pivotY + screwR * 0.36);
    ctx.moveTo(pivotX - screwR * 0.36, pivotY);
    ctx.lineTo(pivotX + screwR * 0.36, pivotY);
    ctx.stroke();
  }

  function renderStripperCanvas(canvas, s) {
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var cw = Math.round(STRIPPER_W * dpr);
    var ch = Math.round(STRIPPER_H * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
      canvas.style.width = STRIPPER_W + 'px';
      canvas.style.height = STRIPPER_H + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, STRIPPER_W, STRIPPER_H);

    if (!imagesReady || !stripperLeftImg || !stripperRightImg) {
      ctx.fillStyle = 'rgba(15, 20, 28, 0.04)';
      ctx.fillRect(0, 0, STRIPPER_W, STRIPPER_H);
      return;
    }

    var scaleX = STRIPPER_W / IMG_NATURAL_W;
    var scaleY = STRIPPER_H / IMG_NATURAL_H;
    var scale = Math.min(scaleX, scaleY);
    var plx = IMG_PIVOT_LEFT_X * scaleX;
    var ply = IMG_PIVOT_LEFT_Y * scaleY;
    var prx = IMG_PIVOT_RIGHT_X * scaleX;
    var pry = IMG_PIVOT_RIGHT_Y * scaleY;
    var screwX = PIVOT_X;
    var screwY = PIVOT_Y;
    var spreadRad = getJawSpreadRad(s);
    var rot = typeof s.rot === 'number' ? s.rot * Math.PI / 180 : 0;

    ctx.save();
    if (rot) {
      ctx.translate(screwX, screwY);
      ctx.rotate(rot);
      ctx.translate(-screwX, -screwY);
    }

    ctx.save();
    ctx.translate(screwX, screwY);
    ctx.rotate(-spreadRad);
    ctx.translate(-plx, -ply);
    ctx.drawImage(
      stripperLeftImg,
      0, 0, IMG_NATURAL_W, IMG_NATURAL_H,
      0, 0, STRIPPER_W, STRIPPER_H
    );
    ctx.restore();

    ctx.save();
    ctx.translate(screwX, screwY);
    ctx.rotate(spreadRad);
    ctx.translate(-prx, -pry);
    ctx.drawImage(
      stripperRightImg,
      0, 0, IMG_NATURAL_W, IMG_NATURAL_H,
      0, 0, STRIPPER_W, STRIPPER_H
    );
    ctx.restore();

    drawCentralScrew(ctx, screwX, screwY, scale);
    ctx.restore();
  }

  function paintStripperNode(s, node) {
    if (!node) node = layer && layer.querySelector('[data-stripper-node="' + s.id + '"]');
    if (!node || !s) return;
    var canvas = node.querySelector('.lab-stripper__art');
    if (canvas) renderStripperCanvas(canvas, s);
  }

  function paintAllStrippers() {
    if (!layer) return;
    strippers.forEach(function (s) {
      paintStripperNode(s);
    });
  }

  function stripperMarkup(s) {
    var selected = selection.id === s.id ? ' is-selected' : '';
    var clamped = s.jawState === 'clamped' ? ' is-clamped' : '';
    return (
      '<div class="lab-stripper' + selected + clamped + '" data-stripper-node="' + s.id + '" ' +
      'style="left:' + Math.round(s.x - STRIPPER_W / 2) + 'px;top:' +
      Math.round(s.y - STRIPPER_H / 2) + 'px" ' +
      'title="CFS-3 Fiber Optic Stripper · clamp + peel">' +
      '<canvas class="lab-stripper__art" aria-hidden="true"></canvas>' +
      '</div>'
    );
  }

  function rebuildLayer() {
    var host = ensureLayer();
    if (!host) return;
    var html = '';
    strippers.forEach(function (s) { html += stripperMarkup(s); });
    host.innerHTML = html;
    bindLayerEvents(host);
    paintAllStrippers();
  }

  function updateStripperPosition(s, node) {
    if (!node) node = layer && layer.querySelector('[data-stripper-node="' + s.id + '"]');
    if (!node) return;
    node.style.left = Math.round(s.x - STRIPPER_W / 2) + 'px';
    node.style.top = Math.round(s.y - STRIPPER_H / 2) + 'px';
  }

  function updateStripperNode(s, node, opts) {
    opts = opts || {};
    if (!node) node = layer && layer.querySelector('[data-stripper-node="' + s.id + '"]');
    if (!node) return;
    updateStripperPosition(s, node);
    node.classList.toggle('is-clamped', s.jawState === 'clamped');
    if (!opts.skipArt) paintStripperNode(s, node);
  }

  function placeStripper(x, y) {
    seq += 1;
    var item = {
      id: 'str-' + seq,
      x: typeof x === 'number' ? Math.round(x) : 0,
      y: typeof y === 'number' ? Math.round(y) : 0,
      rot: 0,
      jawState: 'open',
    };
    strippers.push(item);
    selection = { kind: 'stripper', id: item.id };
    if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
      FtthLab.setSelectionOwner('cfs-stripper');
    }
    rebuildLayer();
    pushHistory();
    updateInspector();
    setStatus('CFS-3 Stripper placed · drag near fiber tip · hold to clamp · peel outward');
    return item;
  }

  function removeStripper(id) {
    strippers = strippers.filter(function (s) { return s.id !== id; });
    if (selection.id === id) selection = { kind: 'none', id: null };
    rebuildLayer();
    updateInspector();
    pushHistory();
    setStatus('CFS-3 Stripper removed');
  }

  function selectStripper(id, opts) {
    selection = { kind: 'stripper', id: id };
    if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
      FtthLab.setSelectionOwner('cfs-stripper');
    }
    updateInspector();
    if (!(opts && opts.skipRebuild)) rebuildLayer();
  }

  function clampJaws(s, node) {
    s.jawState = 'clamped';
    if (node) {
      node.classList.add('is-clamped');
      paintStripperNode(s, node);
    }
  }

  function openJaws(s, node) {
    s.jawState = 'open';
    if (node) {
      node.classList.remove('is-clamped');
      paintStripperNode(s, node);
    }
  }

  function bindLayerEvents(host) {
    host.querySelectorAll('[data-stripper-node]').forEach(function (node) {
      node.addEventListener('click', function (e) {
        e.stopPropagation();
        selectStripper(node.getAttribute('data-stripper-node'), { skipRebuild: true });
        host.querySelectorAll('.lab-stripper.is-selected').forEach(function (el) {
          if (el !== node) el.classList.remove('is-selected');
        });
        node.classList.add('is-selected');
      });

      node.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        var id = node.getAttribute('data-stripper-node');
        var s = findStripper(id);
        if (!s) return;
        selectStripper(id, { skipRebuild: true });

        clampJaws(s, node);
        playClampSnip();

        var target = findStripTarget(e.clientX, e.clientY);
        if (target) {
          startPeelSession(e, s, target, node);
          return;
        }

        startStripperDrag(e, s, node);
      });
    });
  }

  function startStripperDrag(e, s, node) {
    var zoom = getZoom() || 1;
    var sx = e.clientX;
    var sy = e.clientY;
    var ox = s.x;
    var oy = s.y;
    var moved = false;
    node.classList.add('is-dragging');
    document.body.classList.add('lab-stripper-dragging');
    try { node.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }

    function endDrag(ev) {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      try { node.releasePointerCapture(ev.pointerId); } catch (err2) { /* ignore */ }
      node.classList.remove('is-dragging');
      document.body.classList.remove('lab-stripper-dragging');
      openJaws(s, node);
    }

    function onMove(ev) {
      var dx = (ev.clientX - sx) / zoom;
      var dy = (ev.clientY - sy) / zoom;
      if (!moved && Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      moved = true;
      s.x = Math.round(ox + dx);
      s.y = Math.round(oy + dy);
      updateStripperPosition(s, node);
    }

    function onUp(ev) {
      endDrag(ev);
      if (moved) pushHistory();
      rebuildLayer();
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function startPeelSession(e, s, target, node) {
    s.x = target.x;
    s.y = target.y;
    s.rot = target.rot;
    updateStripperNode(s, node);
    document.body.classList.add('lab-stripper-peeling');
    try { node.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }

    var peelUx = target.peelUx;
    var peelUy = target.peelUy;
    var stage = target.stage;
    var threshold = stage === 0 ? PEEL_JACKET_PX : PEEL_BUFFER_PX;
    var startWorld = clientToWorld(e.clientX, e.clientY);
    var peelAccum = 0;
    var lastFragment = 0;
    var completed = false;

    function endPeel(ev) {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      try { node.releasePointerCapture(ev.pointerId); } catch (err2) { /* ignore */ }
      openJaws(s, node);
      document.body.classList.remove('lab-stripper-peeling');
      clearStripPeel(target.id);
      if (completed) {
        spawnDebris(s.x, s.y, stage, peelUx, peelUy);
        pushHistory();
        var label = stage === 0
          ? 'Outer jacket stripped · buffer coating exposed'
          : 'Buffer stripped · bare glass core exposed';
        setStatus('CFS-3 · ' + label);
      } else {
        setStatus('CFS-3 · peel incomplete · clamp and drag toward fiber tip');
      }
      rebuildLayer();
    }

    function onMove(ev) {
      var w = clientToWorld(ev.clientX, ev.clientY);
      var dx = w.x - startWorld.x;
      var dy = w.y - startWorld.y;
      var along = dx * peelUx + dy * peelUy;
      if (along < 0) along = 0;
      peelAccum = Math.max(peelAccum, along);
      var peelNorm = Math.min(1, peelAccum / threshold);
      setStripPeel(target.id, peelNorm);
      s.x = target.x + peelUx * peelAccum * 0.35;
      s.y = target.y + peelUy * peelAccum * 0.35;
      updateStripperPosition(s, node);
      if (peelNorm - lastFragment >= 0.22) {
        lastFragment = peelNorm;
        spawnPeelFragment(
          target.x + peelUx * peelAccum * 0.5,
          target.y + peelUy * peelAccum * 0.5,
          stage,
          peelUx,
          peelUy,
          peelNorm
        );
      }
      if (peelAccum >= threshold && !completed) {
        completed = commitStripStage(target.id);
      }
    }

    function onUp(ev) {
      endPeel(ev);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function updateInspector() {
    var card = document.getElementById('lab-inspector-card');
    var detail = document.getElementById('lab-inspector-detail');
    if (!card || selection.kind !== 'stripper' || !selection.id) return;
    var s = findStripper(selection.id);
    if (!s) return;
    card.innerHTML =
      '<h2>CFS-3 Stripper</h2>' +
      '<p>Fiber optic stripper · 3-notch jaw · clamp + outward peel.</p>';
    if (!detail) return;
    detail.hidden = false;
    detail.innerHTML =
      '<div class="lab-stripper-config">' +
      '<p class="lab-inspector__label">Jaw state</p>' +
      '<p class="lab-pcord-attach">' + (s.jawState === 'clamped' ? 'Clamped shut' : 'Open · spring-loaded') + '</p>' +
      '<p class="lab-inspector__label">Tri-hole blade (top)</p>' +
      '<ol class="lab-stripper-stages">' +
      '<li><strong>Top notch</strong> · 125 µm acrylate → bare glass</li>' +
      '<li><strong>Middle notch</strong> · 250–900 µm buffer tube</li>' +
      '<li><strong>Lower notch</strong> · 2–3 mm outer jacket</li>' +
      '</ol>' +
      '<p class="lab-inspector__hint">Click &amp; hold to clamp · release to spring open</p>' +
      '<button type="button" class="lab-eject-btn" data-remove-stripper="' + s.id +
      '">Remove Stripper</button>' +
      '</div>';
    var rm = detail.querySelector('[data-remove-stripper]');
    if (rm) {
      rm.addEventListener('click', function () {
        removeStripper(s.id);
      });
    }
  }

  function renderToolbox() {
    var host = document.getElementById('lab-stripper-tree');
    if (!host) return;
    host.innerHTML =
      '<div class="lab-toolbox" role="list">' +
      '<div class="tool-item lab-tool lab-tool--stripper' +
      (selectedTool === 'stripper' ? ' is-selected' : '') +
      '" data-tool="stripper" data-lab-tool="stripper" draggable="true" ' +
      'role="listitem" tabindex="0" title="CFS-3 Fiber Optic Stripper">' +
      '<span class="lab-tool__mark lab-tool__mark--stripper" aria-hidden="true"></span>' +
      '<span class="lab-tool__copy">' +
      '<strong>CFS-3 Stripper</strong>' +
      '<span>Vertical · 3-notch blade</span>' +
      '</span>' +
      '</div>' +
      '</div>';
    bindToolbox(host);
  }

  function bindToolbox(host) {
    var btn = host.querySelector('[data-tool="stripper"]');
    if (!btn) return;

    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('cfs-stripper');
      }
      selectedTool = 'stripper';
      renderToolbox();
      setStatus('CFS-3 Stripper · drag onto workspace · clamp on fiber tip · peel outward');
    });

    btn.addEventListener('dragstart', function (ev) {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('cfs-stripper');
      }
      selectedTool = 'stripper';
      dragLib = { kind: 'stripper' };
      if (global.FtthLab && FtthLab.beginDrag) FtthLab.beginDrag({ kind: 'stripper' });
      try {
        ev.dataTransfer.setData('text/plain', 'lab:stripper');
        ev.dataTransfer.setData('text/lab-drag', 'stripper');
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

  function bindStageDrop() {
    var stage = document.getElementById('lab-canvas-2d');
    var mount = document.getElementById('lab-2d-mount');
    var world = document.getElementById('lab-2d-world');
    [stage, mount, world].forEach(function (el) {
      if (!el || el.dataset.stripperDrop === '1') return;
      el.dataset.stripperDrop = '1';

      el.addEventListener('dragover', function (ev) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        if (!((dragLib && dragLib.kind === 'stripper') || (active && active.kind === 'stripper'))) {
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
        if (kind !== 'stripper') return;
        ev.preventDefault();
        ev.stopPropagation();
        dragLib = null;
        if (global.FtthLab && FtthLab.endDrag) FtthLab.endDrag();
        var pt = clientToWorld(ev.clientX, ev.clientY);
        placeStripper(Math.round(pt.x), Math.round(pt.y));
        selectedTool = null;
        renderToolbox();
      });
    });
  }

  function deleteSelected() {
    if (selection.kind === 'stripper' && selection.id) {
      removeStripper(selection.id);
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
    if (id === 'cfs-stripper') return;
    selectedTool = null;
    renderToolbox();
  }

  function mount() {
    preloadStripperImages();
    renderToolbox();
    bindStageDrop();
    ensureLayer();
    rebuildLayer();
    pushHistory();
  }

  var tool = {
    id: 'cfs-stripper',
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
      applySnapshot({ strippers: [], seq: 0 });
    },
  };

  function tryRegister() {
    if (global.FtthLab && typeof FtthLab.registerTool === 'function') {
      FtthLab.registerTool('cfs-stripper', tool);
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
