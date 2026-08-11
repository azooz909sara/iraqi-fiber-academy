/**
 * Patch Cord — free-floating yellow jumper
 * Drag ends into equipment ports. SC/APC (green) / SC/PC (blue).
 * Mismatches warn only and add insertion-loss penalty (not blocked).
 */
(function (global) {
  'use strict';

  var MISMATCH_MSG =
    'Connector polish mismatch (SC/APC ↔ SC/PC): high back reflection expected. ' +
    'Connection allowed — extra insertion loss applied to the power budget.';

  var MISMATCH_PENALTY_DB = 0.75; /* per mismatched end */
  var MATCHED_CONNECTOR_DB = 0.2; /* typical mated pair insertion */

  var ctx = null;
  var layer = null;
  var cords = [];
  var seq = 0;
  var selection = { kind: 'none', cordId: null };
  var dragLib = null;
  var selectedTool = null;
  var history = [];
  var historyIndex = -1;
  var historyLocked = false;
  var HISTORY_MAX = 60;
  var endDragState = null;

  function setStatus(msg) {
    if (global.FtthLab && FtthLab.setStatus) FtthLab.setStatus(msg);
  }

  function showWarning(msg) {
    if (global.FtthLab && FtthLab.showAlert) FtthLab.showAlert(msg, 'warn');
    else window.alert(msg);
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
      FtthLab.setSelectionOwner('patch-cord');
    }
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value == null ? null : value));
  }

  /** Internal: 'APC' | 'PC'  (PC ≈ UPC / SC-PC blue) */
  function normalizePolish(v) {
    var s = String(v || '').toUpperCase().replace(/\s+/g, '');
    if (s === 'APC' || s === 'SC/APC' || s === 'SCAPC') return 'APC';
    return 'PC';
  }

  function displayPolish(v) {
    return normalizePolish(v) === 'APC' ? 'SC/APC' : 'SC/PC';
  }

  function portPolishNorm(v) {
    var s = String(v || '').toUpperCase();
    return s === 'APC' ? 'APC' : 'PC';
  }

  function polishMatch(cordPolish, portPolish) {
    return normalizePolish(cordPolish) === portPolishNorm(portPolish);
  }

  function findCord(id) {
    for (var i = 0; i < cords.length; i++) {
      if (cords[i].id === id) return cords[i];
    }
    return null;
  }

  function endKey(end) {
    return end === 'B' ? 'sideB' : 'sideA';
  }

  function captureSnapshot() {
    return { cords: cloneJson(cords), seq: seq };
  }

  function applySnapshot(snap) {
    if (!snap) return;
    historyLocked = true;
    cords = cloneJson(snap.cords) || [];
    seq = snap.seq || 0;
    selection = { kind: 'none', cordId: null };
    endDragState = null;
    rebuildLayer();
    updateInspector();
    refreshBudget();
    historyLocked = false;
  }

  function pushHistory() {
    if (historyLocked) return;
    history = history.slice(0, historyIndex + 1);
    history.push(captureSnapshot());
    if (history.length > HISTORY_MAX) history.shift();
    historyIndex = history.length - 1;
    if (historyIndex > 0 && global.FtthLab && typeof FtthLab.recordHistory === 'function') {
      FtthLab.recordHistory('patch-cord');
    }
  }

  function undo() {
    if (historyIndex <= 0) return false;
    historyIndex -= 1;
    applySnapshot(history[historyIndex]);
    setStatus('Undo · patch cord');
    return true;
  }

  function redo() {
    if (historyIndex >= history.length - 1) return false;
    historyIndex += 1;
    applySnapshot(history[historyIndex]);
    setStatus('Redo · patch cord');
    return true;
  }

  function defaultPos() {
    var w = getWorldSize();
    var x = Math.round(w / 2 + 60 + cords.length * 30);
    var y = Math.round(w / 2 + 200 + (cords.length % 3) * 50);
    return { x: x, y: y };
  }

  function placeCord(x, y) {
    seq += 1;
    var pos = (typeof x === 'number' && typeof y === 'number')
      ? { x: x, y: y }
      : defaultPos();
    var cord = {
      id: 'pc-' + seq,
      ax: pos.x,
      ay: pos.y,
      bx: pos.x + 120,
      by: pos.y,
      sideA: { polish: 'PC', attached: null, mismatch: false },
      sideB: { polish: 'PC', attached: null, mismatch: false },
    };
    cords.push(cord);
    selectCord(cord.id);
    rebuildLayer();
    pushHistory();
    refreshBudget();
    setStatus('Patch cord placed · drag ends into ports · set SC/APC or SC/PC in properties');
    return cord;
  }

  function removeCord(id) {
    cords = cords.filter(function (c) { return c.id !== id; });
    if (selection.cordId === id) selection = { kind: 'none', cordId: null };
    rebuildLayer();
    updateInspector();
    pushHistory();
    refreshBudget();
    setStatus('Patch cord removed');
  }

  function setEndPolish(id, end, polish) {
    var cord = findCord(id);
    if (!cord) return;
    polish = normalizePolish(polish);
    var side = cord[endKey(end)];
    side.polish = polish;
    if (side.attached) {
      side.mismatch = !polishMatch(polish, side.attached.polish);
      side.attached.mismatch = side.mismatch;
      if (side.mismatch) showWarning(MISMATCH_MSG);
    }
    rebuildLayer();
    updateInspector();
    pushHistory();
    refreshBudget();
    setStatus('Side ' + end + ' → ' + displayPolish(polish));
  }

  function samePort(att, hit) {
    if (!att || !hit) return false;
    if (att.owner !== hit.owner) return false;
    if (att.owner === 'splitter') {
      return att.splitterId === hit.splitterId && att.port === hit.port;
    }
    if (att.owner === 'olt') {
      return att.slot === hit.slot && att.oltPort === hit.oltPort;
    }
    return false;
  }

  function clearPortFromOthers(hit, exceptCordId, exceptEnd) {
    cords.forEach(function (c) {
      ['A', 'B'].forEach(function (end) {
        if (c.id === exceptCordId && end === exceptEnd) return;
        var side = c[endKey(end)];
        if (side.attached && samePort(side.attached, hit)) {
          side.attached = null;
          side.mismatch = false;
        }
      });
    });
  }

  function attachEnd(cord, end, hit) {
    var side = cord[endKey(end)];
    var mismatch = !polishMatch(side.polish, hit.polish);
    clearPortFromOthers(hit, cord.id, end);
    side.attached = {
      owner: hit.owner,
      polish: portPolishNorm(hit.polish) === 'APC' ? 'APC' : 'UPC',
      label: hit.label,
      splitterId: hit.splitterId || null,
      port: hit.port || null,
      slot: hit.slot || null,
      oltPort: hit.oltPort || null,
      wx: hit.wx,
      wy: hit.wy,
      mismatch: mismatch,
    };
    side.mismatch = mismatch;
    if (end === 'A') {
      cord.ax = hit.wx;
      cord.ay = hit.wy;
    } else {
      cord.bx = hit.wx;
      cord.by = hit.wy;
    }
    if (mismatch) showWarning(MISMATCH_MSG);
    setStatus(
      'Side ' + end + ' · ' + displayPolish(side.polish) + ' → ' + hit.label +
      (mismatch ? ' · mismatch warning · +' + MISMATCH_PENALTY_DB + ' dB' : '')
    );
  }

  function detachEnd(cord, end) {
    var side = cord[endKey(end)];
    side.attached = null;
    side.mismatch = false;
  }

  /* ─── Hit-test equipment ports ─── */

  function hitTestPort(clientX, clientY) {
    var list = document.elementsFromPoint
      ? document.elementsFromPoint(clientX, clientY)
      : [];
    var i;
    var el;
    var node;
    var world = clientToWorld(clientX, clientY);

    for (i = 0; i < list.length; i++) {
      el = list[i];
      node = el.closest && el.closest('.lab-fx-port.is-active, .lab-fx-port.is-upc, .lab-fx-port.is-apc');
      if (!node) node = el.closest && el.closest('.lab-fx-port');
      if (node && node.classList.contains('is-active')) {
        var slot = parseInt(node.getAttribute('data-lab-slot'), 10);
        var port = parseInt(node.getAttribute('data-lab-sfp'), 10);
        var polish = node.classList.contains('is-apc') ? 'APC' : 'UPC';
        var cage = node.querySelector('.lab-fx-port__cage') || node;
        var rect = cage.getBoundingClientRect();
        var center = clientToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
          owner: 'olt',
          slot: slot,
          oltPort: port,
          polish: polish,
          label: 'LT' + (slot < 10 ? '0' : '') + slot + '/P' + port,
          wx: center.x,
          wy: center.y,
          el: node,
        };
      }

      node = el.closest && el.closest('.lab-cas-port');
      if (node) {
        var sid = node.getAttribute('data-spl-id');
        var pid = node.getAttribute('data-spl-port');
        var pPolish = node.classList.contains('is-apc') ? 'APC' : 'UPC';
        var face = node.querySelector('i') || node;
        var r2 = face.getBoundingClientRect();
        var c2 = clientToWorld(r2.left + r2.width / 2, r2.top + r2.height / 2);
        return {
          owner: 'splitter',
          splitterId: sid,
          port: pid,
          polish: pPolish,
          label: (sid || 'SPL') + ' ' + pid,
          wx: c2.x,
          wy: c2.y,
          el: node,
        };
      }
    }

    /* Fallback: no element hit — keep free world point available to callers */
    return null;
  }

  function syncAttachedPositions(cord) {
    ['A', 'B'].forEach(function (end) {
      var side = cord[endKey(end)];
      if (!side.attached) return;
      var att = side.attached;
      var el = null;
      if (att.owner === 'olt') {
        el = document.querySelector(
          '.lab-fx-port[data-lab-slot="' + att.slot + '"][data-lab-sfp="' + att.oltPort + '"]'
        );
        if (el) {
          var cage = el.querySelector('.lab-fx-port__cage') || el;
          var rect = cage.getBoundingClientRect();
          var pt = clientToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
          att.wx = pt.x;
          att.wy = pt.y;
          if (end === 'A') { cord.ax = pt.x; cord.ay = pt.y; }
          else { cord.bx = pt.x; cord.by = pt.y; }
        }
        return;
      } else if (att.owner === 'splitter') {
        el = document.querySelector(
          '.lab-cas-port[data-spl-id="' + att.splitterId + '"][data-spl-port="' + att.port + '"]'
        );
        if (el) {
          var face = el.querySelector('i') || el;
          var r2 = face.getBoundingClientRect();
          var pt2 = clientToWorld(r2.left + r2.width / 2, r2.top + r2.height / 2);
          att.wx = pt2.x;
          att.wy = pt2.y;
          if (end === 'A') { cord.ax = pt2.x; cord.ay = pt2.y; }
          else { cord.bx = pt2.x; cord.by = pt2.y; }
        }
      }
    });
  }

  /* ─── Loss / budget ─── */

  function cordLossDb(cord) {
    var loss = 0;
    var aOn = !!cord.sideA.attached;
    var bOn = !!cord.sideB.attached;
    if (aOn && bOn) {
      loss += MATCHED_CONNECTOR_DB * 2;
      if (cord.sideA.mismatch) loss += MISMATCH_PENALTY_DB;
      if (cord.sideB.mismatch) loss += MISMATCH_PENALTY_DB;
    } else {
      if (aOn && cord.sideA.mismatch) loss += MISMATCH_PENALTY_DB;
      if (bOn && cord.sideB.mismatch) loss += MISMATCH_PENALTY_DB;
    }
    return loss;
  }

  function getNetworkLossDb() {
    var sum = 0;
    cords.forEach(function (c) {
      sum += cordLossDb(c);
    });
    return Math.round(sum * 100) / 100;
  }

  function getMismatchCount() {
    var n = 0;
    cords.forEach(function (c) {
      if (c.sideA.attached && c.sideA.mismatch) n += 1;
      if (c.sideB.attached && c.sideB.mismatch) n += 1;
    });
    return n;
  }

  function refreshBudget() {
    if (global.FtthLab && typeof FtthLab.refreshPowerBudget === 'function') {
      FtthLab.refreshPowerBudget();
      return;
    }
    var loss = getNetworkLossDb();
    var text = loss > 0
      ? 'Power budget · Patch + mismatch ' + loss.toFixed(2) + ' dB'
      : 'Power budget · no active patch paths';
    if (global.FtthLab && FtthLab.setBudget) FtthLab.setBudget(text);
  }

  function deleteSelected() {
    if (selection.kind === 'cord' && selection.cordId) {
      removeCord(selection.cordId);
      return true;
    }
    return false;
  }

  function selectCord(id) {
    selection = { kind: 'cord', cordId: id };
    claimSelection();
    updateInspector();
    rebuildLayer();
  }

  /* ─── Toolbox ─── */

  function renderToolbox() {
    var host = document.getElementById('lab-patchcord-tree');
    if (!host) return;
    host.innerHTML =
      '<div class="lab-toolbox" role="list">' +
      '<button type="button" class="lab-tool lab-tool--pcord' +
      (selectedTool === 'patchcord' ? ' is-selected' : '') +
      '" draggable="true" data-lab-tool="patchcord" role="listitem">' +
      '<span class="lab-tool__mark lab-tool__mark--pcord" aria-hidden="true"></span>' +
      '<span class="lab-tool__copy">' +
      '<strong>Patch Cord</strong>' +
      '<span>Drag ends into ports</span>' +
      '</span>' +
      '</button>' +
      '</div>';
    bindToolbox(host);
  }

  function bindToolbox(host) {
    var btn = host.querySelector('[data-lab-tool="patchcord"]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      selectedTool = 'patchcord';
      renderToolbox();
      setStatus('Patch Cord · drag onto workspace, then drag A/B ends into ports');
    });
    btn.addEventListener('dragstart', function (e) {
      selectedTool = 'patchcord';
      dragLib = { kind: 'patchcord' };
      if (global.FtthLab && FtthLab.beginDrag) FtthLab.beginDrag({ kind: 'patchcord' });
      try {
        e.dataTransfer.setData('text/plain', 'lab:patchcord');
        e.dataTransfer.setData('text/lab-drag', 'patchcord');
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
      if (!el || el.dataset.patchcordDrop === '1') return;
      el.dataset.patchcordDrop = '1';
      el.addEventListener('dragover', function (e) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        if (!((dragLib && dragLib.kind === 'patchcord') || (active && active.kind === 'patchcord'))) {
          return;
        }
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      });
      el.addEventListener('drop', function (e) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        var kind = (e.dataTransfer && e.dataTransfer.getData('text/lab-drag')) ||
          (active && active.kind) || (dragLib && dragLib.kind) || '';
        if (kind !== 'patchcord') return;
        e.preventDefault();
        e.stopPropagation();
        var pt = clientToWorld(e.clientX, e.clientY);
        placeCord(Math.round(pt.x - 20), Math.round(pt.y - 10));
        dragLib = null;
        if (global.FtthLab && FtthLab.endDrag) FtthLab.endDrag();
      });
    });
  }

  /* ─── Render ─── */

  function ensureLayer() {
    var mount = (ctx && ctx.host2d) || document.getElementById('lab-2d-mount');
    if (!mount) return null;
    if (!layer || !layer.parentNode) {
      layer = document.createElement('div');
      layer.className = 'lab-pcord-layer';
      layer.setAttribute('data-lab-pcord-layer', '1');
      mount.appendChild(layer);
    }
    return layer;
  }

  function endClass(side) {
    return normalizePolish(side.polish) === 'APC' ? 'is-apc' : 'is-pc';
  }

  function bezierPath(x1, y1, x2, y2) {
    var dx = x2 - x1;
    var mid = x1 + dx / 2;
    var c1y = y1;
    var c2y = y2;
    if (Math.abs(dx) < 40) {
      c1y = y1 + (y2 - y1) * 0.25;
      c2y = y1 + (y2 - y1) * 0.75;
      mid = x1 + (dx >= 0 ? 40 : -40);
    }
    return 'M ' + x1 + ' ' + y1 +
      ' C ' + mid + ' ' + c1y + ', ' + mid + ' ' + c2y + ', ' + x2 + ' ' + y2;
  }

  var END_W = 14;
  var END_H = 18;

  function endStyle(x, y) {
    return 'left:' + Math.round(x - END_W / 2) + 'px;top:' + Math.round(y - END_H / 2) + 'px';
  }

  function endMarkup(cord, end, side) {
    var label = end === 'B' ? 'B' : 'A';
    return (
      '<button type="button" class="lab-pcord__end lab-pcord__end--' + end.toLowerCase() + ' ' +
      endClass(side) +
      (side.attached ? ' is-attached' : '') +
      (side.mismatch ? ' is-mismatch' : '') +
      '" data-pcord-id="' + cord.id + '" data-pcord-end="' + end + '" ' +
      'style="' + endStyle(end === 'A' ? cord.ax : cord.bx, end === 'A' ? cord.ay : cord.by) + '" ' +
      'title="Side ' + label + ' · ' + displayPolish(side.polish) + ' · drag to port" ' +
      'aria-label="Side ' + label + ' ' + displayPolish(side.polish) + '">' +
      '<span class="lab-pcord__housing" aria-hidden="true">' +
      '<i class="lab-pcord__ferrule"></i>' +
      '</span>' +
      '<span class="lab-pcord__boot" aria-hidden="true"></span>' +
      '<b class="lab-pcord__mark">' + label + '</b>' +
      '</button>'
    );
  }

  function rebuildLayer() {
    var host = ensureLayer();
    if (!host) return;

    cords.forEach(function (c) { syncAttachedPositions(c); });

    var html = '<svg class="lab-pcord-svg" aria-hidden="true">';
    cords.forEach(function (c) {
      var path = bezierPath(c.ax, c.ay, c.bx, c.by);
      var bad = c.sideA.mismatch || c.sideB.mismatch;
      var sel = selection.cordId === c.id ? ' is-selected' : '';
      /* Wide invisible hit stroke so the clean yellow cable can be dragged */
      html +=
        '<path class="lab-pcord-fiber-hit" data-pcord-drag="' + c.id + '" d="' + path +
        '" fill="none" />' +
        '<path class="lab-pcord-fiber' + (bad ? ' is-mismatch' : '') + sel +
        '" data-pcord-fiber="' + c.id + '" d="' + path + '" fill="none" />';
    });
    html += '</svg>';

    cords.forEach(function (c) {
      var selected = selection.cordId === c.id ? ' is-selected' : '';
      var linked = (c.sideA.attached && c.sideB.attached) ? ' is-linked' : '';
      html +=
        '<div class="lab-pcord' + selected + linked + '" data-pcord-node="' + c.id + '">' +
        endMarkup(c, 'A', c.sideA) +
        endMarkup(c, 'B', c.sideB) +
        '</div>';
    });

    host.innerHTML = html;
    bindLayerEvents(host);
  }

  function updateFiberPath(cord) {
    if (!layer) return;
    var d = bezierPath(cord.ax, cord.ay, cord.bx, cord.by);
    var path = layer.querySelector('[data-pcord-fiber="' + cord.id + '"]');
    var hit = layer.querySelector('.lab-pcord-fiber-hit[data-pcord-drag="' + cord.id + '"]');
    if (path) path.setAttribute('d', d);
    if (hit) hit.setAttribute('d', d);
    var aBtn = layer.querySelector('[data-pcord-id="' + cord.id + '"][data-pcord-end="A"]');
    var bBtn = layer.querySelector('[data-pcord-id="' + cord.id + '"][data-pcord-end="B"]');
    if (aBtn) {
      aBtn.style.left = Math.round(cord.ax - END_W / 2) + 'px';
      aBtn.style.top = Math.round(cord.ay - END_H / 2) + 'px';
    }
    if (bBtn) {
      bBtn.style.left = Math.round(cord.bx - END_W / 2) + 'px';
      bBtn.style.top = Math.round(cord.by - END_H / 2) + 'px';
    }
  }

  function bindLayerEvents(host) {
    /* Drag whole free cord via the yellow fiber hit-path */
    host.querySelectorAll('[data-pcord-drag]').forEach(function (grip) {
      grip.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        var id = grip.getAttribute('data-pcord-drag');
        var c = findCord(id);
        if (!c) return;
        selectCord(id);
        var zoom = getZoom();
        var sx = e.clientX;
        var sy = e.clientY;
        var oax = c.ax;
        var oay = c.ay;
        var obx = c.bx;
        var oby = c.by;
        var aLocked = !!c.sideA.attached;
        var bLocked = !!c.sideB.attached;
        var moved = false;

        function onMove(ev) {
          moved = true;
          var dx = (ev.clientX - sx) / zoom;
          var dy = (ev.clientY - sy) / zoom;
          if (!aLocked) {
            c.ax = oax + dx;
            c.ay = oay + dy;
          }
          if (!bLocked) {
            c.bx = obx + dx;
            c.by = oby + dy;
          }
          updateFiberPath(c);
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

    /* Drag individual ends to plug into ports */
    host.querySelectorAll('[data-pcord-end]').forEach(function (btn) {
      btn.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        var id = btn.getAttribute('data-pcord-id');
        var end = btn.getAttribute('data-pcord-end');
        var c = findCord(id);
        if (!c) return;
        selectCord(id);
        detachEnd(c, end);
        btn.classList.remove('is-attached', 'is-mismatch');
        btn.classList.add('is-dragging');
        document.body.classList.add('lab-pcord-plugging');

        endDragState = { cordId: id, end: end };

        function onMove(ev) {
          var pt = clientToWorld(ev.clientX, ev.clientY);
          if (end === 'A') {
            c.ax = pt.x;
            c.ay = pt.y;
          } else {
            c.bx = pt.x;
            c.by = pt.y;
          }
          updateFiberPath(c);

          document.querySelectorAll('.lab-fx-port.is-plug-target, .lab-cas-port.is-plug-target')
            .forEach(function (n) { n.classList.remove('is-plug-target'); });
          var hit = hitTestPort(ev.clientX, ev.clientY);
          if (hit && hit.el) hit.el.classList.add('is-plug-target');
        }

        function onUp(ev) {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          btn.classList.remove('is-dragging');
          document.body.classList.remove('lab-pcord-plugging');
          document.querySelectorAll('.is-plug-target')
            .forEach(function (n) { n.classList.remove('is-plug-target'); });

          var hit = hitTestPort(ev.clientX, ev.clientY);
          if (hit) {
            attachEnd(c, end, hit);
          } else {
            var pt = clientToWorld(ev.clientX, ev.clientY);
            if (end === 'A') {
              c.ax = pt.x;
              c.ay = pt.y;
            } else {
              c.bx = pt.x;
              c.by = pt.y;
            }
            setStatus('Side ' + end + ' free · drag onto an equipment port to plug');
          }
          endDragState = null;
          rebuildLayer();
          updateInspector();
          pushHistory();
          refreshBudget();
        }

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    });

    host.querySelectorAll('[data-pcord-node]').forEach(function (node) {
      node.addEventListener('click', function (e) {
        if (e.target.closest('.lab-pcord__end') || e.target.closest('[data-pcord-drag]')) return;
        selectCord(node.getAttribute('data-pcord-node'));
      });
    });
  }

  function polishToggleHtml(cordId, end, polish, label) {
    var isApc = normalizePolish(polish) === 'APC';
    return (
      '<p class="lab-inspector__label" style="margin:0.55rem 0 0.35rem">' + label + '</p>' +
      '<div class="lab-polish-toggle" role="group" aria-label="' + label + '">' +
      '<button type="button" class="lab-polish-btn is-upc' + (!isApc ? ' is-active' : '') +
      '" data-pc-polish="' + cordId + ':' + end + ':PC">SC/PC · Blue</button>' +
      '<button type="button" class="lab-polish-btn is-apc' + (isApc ? ' is-active' : '') +
      '" data-pc-polish="' + cordId + ':' + end + ':APC">SC/APC · Green</button>' +
      '</div>'
    );
  }

  function updateInspector() {
    var card = document.getElementById('lab-inspector-card');
    var detail = document.getElementById('lab-inspector-detail');
    if (!card) return;
    if (selection.kind !== 'cord' || !selection.cordId) return;
    var c = findCord(selection.cordId);
    if (!c) return;

    var pathLoss = cordLossDb(c);
    card.innerHTML =
      '<h2>Patch Cord</h2>' +
      '<p>Drag Side A / Side B into OLT, splitter, or SFP ports. Mismatched polish warns and adds loss — it does not block.</p>';

    if (!detail) return;
    detail.hidden = false;
    detail.innerHTML =
      '<div class="lab-pcord-config">' +
      polishToggleHtml(c.id, 'A', c.sideA.polish, 'Side A Connector') +
      '<p class="lab-pcord-attach' + (c.sideA.mismatch ? ' is-warn' : '') + '">' +
      (c.sideA.attached
        ? 'A → ' + c.sideA.attached.label +
          (c.sideA.mismatch ? ' · MISMATCH +' + MISMATCH_PENALTY_DB + ' dB' : '')
        : 'A · unplugged — drag end to a port') +
      '</p>' +
      polishToggleHtml(c.id, 'B', c.sideB.polish, 'Side B Connector') +
      '<p class="lab-pcord-attach' + (c.sideB.mismatch ? ' is-warn' : '') + '">' +
      (c.sideB.attached
        ? 'B → ' + c.sideB.attached.label +
          (c.sideB.mismatch ? ' · MISMATCH +' + MISMATCH_PENALTY_DB + ' dB' : '')
        : 'B · unplugged — drag end to a port') +
      '</p>' +
      '<div class="lab-spl-sheet" style="margin-top:0.55rem">' +
      '<div><span>Side A</span><strong class="' +
      (normalizePolish(c.sideA.polish) === 'APC' ? 'is-apc-text' : 'is-upc-text') + '">' +
      displayPolish(c.sideA.polish) + '</strong></div>' +
      '<div><span>Side B</span><strong class="' +
      (normalizePolish(c.sideB.polish) === 'APC' ? 'is-apc-text' : 'is-upc-text') + '">' +
      displayPolish(c.sideB.polish) + '</strong></div>' +
      '<div><span>Path loss</span><strong>' + pathLoss.toFixed(2) + ' dB</strong></div>' +
      '</div>' +
      '<button type="button" class="lab-eject-btn" data-remove-pcord="' + c.id +
      '">Remove Patch Cord</button>' +
      '</div>';

    detail.querySelectorAll('[data-pc-polish]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var parts = btn.getAttribute('data-pc-polish').split(':');
        setEndPolish(parts[0], parts[1], parts[2]);
      });
    });
    var rm = detail.querySelector('[data-remove-pcord]');
    if (rm) {
      rm.addEventListener('click', function () { removeCord(c.id); });
    }
  }

  function onViewChange() {
    rebuildLayer();
  }

  function onLayoutChange() {
    if (!layer) return;
    cords.forEach(function (c) {
      syncAttachedPositions(c);
      updateFiberPath(c);
    });
  }

  function cancelPatch() {
    endDragState = null;
  }

  function mount(api) {
    ctx = api || {};
    cords = [];
    seq = 0;
    history = [];
    historyIndex = -1;
    historyLocked = false;
    selection = { kind: 'none', cordId: null };
    selectedTool = null;
    dragLib = null;
    endDragState = null;
    renderToolbox();
    bindStageDrop();
    ensureLayer();
    rebuildLayer();
    pushHistory();
    refreshBudget();
  }

  var tool = {
    id: 'patch-cord',
    mount: mount,
    onViewChange: onViewChange,
    onLayoutChange: onLayoutChange,
    cancelPatch: cancelPatch,
    undo: undo,
    redo: redo,
    deleteSelected: deleteSelected,
    placeCord: placeCord,
    getNetworkLossDb: getNetworkLossDb,
    getMismatchCount: getMismatchCount,
    rebuildLayer: rebuildLayer,
  };

  function tryRegister() {
    if (global.FtthLab && typeof FtthLab.registerTool === 'function') {
      FtthLab.registerTool('patch-cord', tool);
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
