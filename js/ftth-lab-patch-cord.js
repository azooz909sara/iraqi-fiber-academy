/**
 * Patch Cord — symmetrical click-and-drag for End A and End B
 * Plugged end stays locked; free end moves only on mouse-down+hold.
 * Manual mouse path is recorded and frozen when the free end snaps.
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
  /** Dual-state link: A locked in port, B follows mouse until snap */
  var linkSession = null; /* { cordId, freeEnd } */
  var suppressPortClickUntil = 0;

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
    endLinkSession({ silent: true });
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
    var span = 120; /* vertical A (top) → B (bottom) */
    var cord = {
      id: 'pc-' + seq,
      ax: pos.x,
      ay: pos.y,
      bx: pos.x,
      by: pos.y + span,
      sideA: { polish: 'PC', attached: null, mismatch: false, lockedRot: null, liveRot: null },
      sideB: { polish: 'PC', attached: null, mismatch: false, lockedRot: null, liveRot: null },
      route: [],
      pathLocked: false,
    };
    cords.push(cord);
    selectCord(cord.id);
    rebuildLayer();
    pushHistory();
    refreshBudget();
    setStatus('Patch cord placed · vertical span · drag a free end to route · snap into a port to lock');
    return cord;
  }

  function removeCord(id) {
    if (linkSession && linkSession.cordId === id) endLinkSession({ silent: true });
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
          side.lockedRot = null;
        }
      });
    });
  }

  function attachEnd(cord, end, hit) {
    var side = cord[endKey(end)];
    var mismatch = !polishMatch(side.polish, hit.polish);
    clearPortFromOthers(hit, cord.id, end);
    var otherEnd = oppositeEnd(end);
    /* Zero drag rotation, then lock to strict vertical socket pose (0° or 180°) */
    var lockedRot = resolveUprightPlugRotation(hit, cord, end);
    lockedRot = lockedRot === 180 || lockedRot === -180 ? 180 : 0;
    side.liveRot = null;
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
      lockedRot: lockedRot,
    };
    side.lockedRot = lockedRot;
    side.liveRot = null;
    side.mismatch = mismatch;
    /* Seat only this end — never move or shrink the free end */
    var freePos = getEndWorld(cord, otherEnd);
    seatEndAtPort(cord, end, hit.wx, hit.wy);
    setEndWorld(cord, otherEnd, freePos.x, freePos.y);
    if (mismatch) showWarning(MISMATCH_MSG);
    setStatus(
      'Side ' + end + ' locked · ' + displayPolish(side.polish) + ' → ' + hit.label +
      (mismatch ? ' · mismatch warning · +' + MISMATCH_PENALTY_DB + ' dB' : '')
    );
  }

  function detachEnd(cord, end) {
    var side = cord[endKey(end)];
    side.attached = null;
    side.mismatch = false;
    side.lockedRot = null;
    /* Keep last live heading if any; drag will update it */
    cord.pathLocked = false;
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
          /* Keep plug-time upright lock — do not re-derive sideways axes on sync */
          if (typeof side.lockedRot !== 'number') {
            side.lockedRot = portAlignedRotation({ owner: 'olt', el: el, wx: pt.x, wy: pt.y });
            att.lockedRot = side.lockedRot;
          }
          side.liveRot = null;
          seatEndAtPort(cord, end, pt.x, pt.y);
        }
        return;
      }
      if (att.owner === 'splitter') {
        el = document.querySelector(
          '.lab-cas-port[data-spl-id="' + att.splitterId + '"][data-spl-port="' + att.port + '"]'
        );
        if (el) {
          var face = el.querySelector('i') || el;
          var r2 = face.getBoundingClientRect();
          var pt2 = clientToWorld(r2.left + r2.width / 2, r2.top + r2.height / 2);
          att.wx = pt2.x;
          att.wy = pt2.y;
          if (typeof side.lockedRot !== 'number') {
            side.lockedRot = portAlignedRotation({ owner: 'splitter', el: el, wx: pt2.x, wy: pt2.y });
            att.lockedRot = side.lockedRot;
          }
          side.liveRot = null;
          seatEndAtPort(cord, end, pt2.x, pt2.y);
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
      '<span>A ↔ B same click-drag rules</span>' +
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
      setStatus('Patch Cord · click-and-hold End A or End B to drag — no auto-follow');
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
        dragLib = null;
        if (global.FtthLab && FtthLab.endDrag) FtthLab.endDrag();
        selectedTool = 'patchcord';
        var hit = hitTestPort(e.clientX, e.clientY);
        if (hit) {
          startLinkFromPort(hit);
          return;
        }
        var pt = clientToWorld(e.clientX, e.clientY);
        placeCord(Math.round(pt.x - 20), Math.round(pt.y - 10));
      });
    });
  }

  /* ─── Dual-state link lifecycle (A locked → B follows → B snap) ─── */

  function clearPortHighlights() {
    document.querySelectorAll('.lab-fx-port.is-plug-target, .lab-cas-port.is-plug-target')
      .forEach(function (n) { n.classList.remove('is-plug-target'); });
  }

  function unbindLinkFollow() {
    if (!linkSession) return;
    if (linkSession._onMove) {
      window.removeEventListener('pointermove', linkSession._onMove);
    }
    if (linkSession._onDown) {
      window.removeEventListener('pointerdown', linkSession._onDown, true);
    }
    linkSession._onMove = null;
    linkSession._onDown = null;
  }

  function endLinkSession(opts) {
    opts = opts || {};
    unbindLinkFollow();
    linkSession = null;
    document.body.classList.remove('lab-pcord-linking');
    clearPortHighlights();
    if (global.FtthLab) FtthLab._patchPending = null;
  }

  function cancelLinkSession() {
    if (!linkSession) {
      if (global.FtthLab) FtthLab._patchPending = null;
      return;
    }
    var id = linkSession.cordId;
    var c = findCord(id);
    endLinkSession({ silent: true });
    if (!c) {
      setStatus('Patch link cancelled');
      return;
    }
    var free = getFreeEnd(c);
    if (free) {
      rebuildLayer();
      updateInspector();
      setStatus(
        'End ' + oppositeEnd(free) + ' locked · click-and-hold End ' + free + ' to drag'
      );
      return;
    }
    if (!c.sideA.attached && !c.sideB.attached) {
      removeCord(id);
    }
    setStatus('Patch link cancelled');
  }

  function oppositeEnd(end) {
    return end === 'A' ? 'B' : 'A';
  }

  /** Which connector is free (unplugged), or null if none/both. */
  function getFreeEnd(cord) {
    if (!cord) return null;
    var aOn = !!cord.sideA.attached;
    var bOn = !!cord.sideB.attached;
    if (aOn && !bOn) return 'B';
    if (bOn && !aOn) return 'A';
    return null;
  }

  /**
   * Mark a half-connected cord. The plugged end stays locked; the free end
   * keeps its current workspace position (no auto-shrink / snap-back) until
   * an explicit click-and-hold drag.
   */
  function armHalfConnected(cord, freeEnd) {
    if (!cord) return;
    freeEnd = freeEnd || getFreeEnd(cord);
    if (!freeEnd) return;
    freeEnd = freeEnd === 'A' ? 'A' : 'B';
    var lockedEnd = oppositeEnd(freeEnd);
    if (!cord[endKey(lockedEnd)].attached) return;

    linkSession = { cordId: cord.id, freeEnd: freeEnd };
    if (global.FtthLab) {
      FtthLab._patchPending = {
        fromPatchCord: true,
        cordId: cord.id,
        freeEnd: freeEnd,
      };
    }
    selectCord(cord.id);
    setStatus(
      'End ' + lockedEnd + ' locked · End ' + freeEnd +
      ' stays put — click-and-hold it to drag'
    );
  }

  /**
   * First port click locks End A. End B is created at a fixed offset once,
   * then left alone — never auto-collapsed when A seats.
   */
  function startLinkFromPort(hit) {
    if (!hit || typeof hit.wx !== 'number') return false;
    if (linkSession) cancelLinkSession();

    seq += 1;
    var polish = hit.polish === 'APC' || String(hit.polish).toUpperCase() === 'APC' ? 'APC' : 'PC';
    var freeX = hit.wx + 140;
    var freeY = hit.wy + 70;
    var cord = {
      id: 'pc-' + seq,
      ax: hit.wx,
      ay: hit.wy,
      bx: freeX,
      by: freeY,
      sideA: { polish: polish, attached: null, mismatch: false, lockedRot: null, liveRot: null },
      sideB: { polish: polish, attached: null, mismatch: false, lockedRot: null, liveRot: null },
      route: [],
      pathLocked: false,
    };
    cords.push(cord);
    attachEnd(cord, 'A', hit);
    /* Preserve free-end spawn position — do not re-snap B toward A after seat */
    cord.bx = freeX;
    cord.by = freeY;
    clearDrawnPath(cord);
    selectCord(cord.id);
    rebuildLayer();
    flashPort(hit.el);
    armHalfConnected(cord, 'B');
    return true;
  }

  /** Used only if a pending half-link is completed via API — prefer drag-release. */
  function completeLinkToPort(hit) {
    if (!linkSession || !hit) return false;
    var c = findCord(linkSession.cordId);
    var freeEnd = linkSession.freeEnd || 'B';
    if (!c) {
      endLinkSession({ silent: true });
      return false;
    }
    attachEnd(c, freeEnd, hit);
    var seatTip = bootExitStub(c, freeEnd);
    appendRoutePoint(c, seatTip.x, seatTip.y);
    lockDrawnPath(c);
    flashPort(hit.el);
    endLinkSession({ silent: true });
    suppressPortClickUntil = Date.now() + 450;
    rebuildLayer();
    updateInspector();
    pushHistory();
    refreshBudget();
    setStatus(
      'Patch connected · drawn path locked · ' +
      (c.sideA.attached && c.sideA.attached.label) + ' ↔ ' +
      (c.sideB.attached && c.sideB.attached.label)
    );
    return true;
  }

  /** Enrich a port descriptor from splitter/OLT into a full hit with world coords. */
  function resolvePortDesc(portDesc) {
    if (!portDesc) return null;
    if (typeof portDesc.wx === 'number' && typeof portDesc.wy === 'number' && portDesc.el) {
      return portDesc;
    }
    var el = null;
    if (portDesc.owner === 'olt') {
      el = document.querySelector(
        '.lab-fx-port.is-active[data-lab-slot="' + portDesc.slot +
        '"][data-lab-sfp="' + portDesc.oltPort + '"]'
      );
    } else if (portDesc.owner === 'splitter') {
      el = document.querySelector(
        '.lab-cas-port[data-spl-id="' + portDesc.splitterId +
        '"][data-spl-port="' + portDesc.port + '"]'
      );
    }
    if (!el) return null;
    var face = el.querySelector('.lab-fx-port__cage, i') || el;
    var rect = face.getBoundingClientRect();
    var center = clientToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      owner: portDesc.owner,
      polish: portDesc.polish,
      label: portDesc.label,
      splitterId: portDesc.splitterId || null,
      port: portDesc.port || null,
      slot: portDesc.slot != null ? portDesc.slot : null,
      oltPort: portDesc.oltPort != null ? portDesc.oltPort : null,
      wx: center.x,
      wy: center.y,
      el: el,
    };
  }

  /**
   * Entry from splitter/OLT port clicks (and FtthLab.tryPatchPort).
   * Starts or completes the dual-state yellow patch-cord link.
   */
  function tryPatchPort(portDesc) {
    var hit = resolvePortDesc(portDesc);
    if (!hit) return false;

    if (linkSession) {
      /* No auto-complete on port click — user must click-drag the free end */
      setStatus('Click-and-drag the free connector end onto the target port');
      return true;
    }

    if (selectedTool === 'patchcord' || (portDesc && portDesc.forcePatchCord)) {
      return startLinkFromPort(hit);
    }
    return false;
  }

  function bindPortLifecycle() {
    if (typeof document === 'undefined') return;
    if (document.documentElement.dataset.pcordLifecycle === '1') return;
    document.documentElement.dataset.pcordLifecycle = '1';

    document.addEventListener('click', function (e) {
      var el = e.target.closest && e.target.closest(
        '.lab-fx-port.is-active, .lab-cas-port'
      );
      if (!el) return;

      if (Date.now() < suppressPortClickUntil) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        return;
      }

      /* Half-connected: ignore port clicks — only click-drag free end completes the link */
      if (linkSession) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        setStatus('Click-and-hold the free End and drag it onto the target port');
        return;
      }

      if (selectedTool !== 'patchcord') return;

      var hit = hitTestPort(e.clientX, e.clientY);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      startLinkFromPort(hit);
    }, true);
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

  var END_W = 14;
  var END_H = 22;
  /*
   * Local frame matches CSS: ferrule at top (−Y), ribbed boot at bottom (+Y).
   * World pos = button center (transform-origin 50% 50%).
   */
  var BOOT_EXIT_OFFSET = END_H / 2; /* rear tip of boot flush with button bottom */
  var BOOT_EXIT_STUB = 10; /* straight run past the tip before any curve */
  var BODY_CLEAR_PX = END_H / 2 + 3;
  var HEADING_MIN_PX = 2.5; /* ignore micro jitter when updating live heading */
  var HEADING_SMOOTH = 0.42; /* blend factor toward new motion heading */
  var UNPLUG_PULL_PX = 36;
  var PLUG_SNAP_PX = 22;
  /** Base gravity sag (px); also scaled by end-to-end distance */
  var GRAVITY_OFFSET = 100;
  var GRAVITY_SAG_RATIO = 0.28;
  var GRAVITY_SAG_MIN = 24;
  var GRAVITY_SAG_MAX = 160;
  /** Min world distance between recorded mouse-path samples (anti-jitter) */
  var TRACE_SAMPLE_PX = 14;
  var TRACE_MAX_POINTS = 180;
  var CHAIKIN_ITERATIONS = 2;

  function dist2(ax, ay, bx, by) {
    var dx = ax - bx;
    var dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function setEndWorld(cord, end, x, y) {
    if (end === 'A') { cord.ax = x; cord.ay = y; }
    else { cord.bx = x; cord.by = y; }
  }

  function getEndWorld(cord, end) {
    return end === 'A' ? { x: cord.ax, y: cord.ay } : { x: cord.bx, y: cord.by };
  }

  /**
   * CSS rotate(θ) with y+ down:
   *   x' = x cosθ − y sinθ
   *   y' = x sinθ + y cosθ
   * Local +Y = boot (rear); local −Y = ferrule (nose).
   * bootOutDir(θ) = (−sin θ, cos θ). Aim that vector at (toward − center):
   *   θ = atan2(−tx, ty)
   */
  function endRotationDeg(cx, cy, towardX, towardY) {
    var tx = towardX - cx;
    var ty = towardY - cy;
    return Math.atan2(-tx, ty) * 180 / Math.PI;
  }

  /** Unit vector of local +Y after CSS rotate — rear boot → cable. */
  function bootOutDir(rotDeg) {
    var r = rotDeg * Math.PI / 180;
    return { x: -Math.sin(r), y: Math.cos(r) };
  }

  /** Map connector-local coords onto world using the same matrix as CSS rotate(). */
  function localToWorld(cx, cy, lx, ly, rotDeg) {
    var r = rotDeg * Math.PI / 180;
    var cos = Math.cos(r);
    var sin = Math.sin(r);
    return {
      x: cx + lx * cos - ly * sin,
      y: cy + lx * sin + ly * cos,
    };
  }

  /** Shortest-path blend between two CSS degrees. */
  function lerpAngleDeg(from, to, t) {
    var d = ((to - from + 540) % 360) - 180;
    return from + d * t;
  }

  /**
   * Drag heading: ferrule/nose leads along (dx, dy); boot trails opposite.
   * Ferrule after rotate = (sin θ, −cos θ) ⇒ θ = atan2(dx, −dy).
   */
  function headingRotFromMotion(dx, dy) {
    return Math.atan2(dx, -dy) * 180 / Math.PI;
  }

  /**
   * Strict vertical socket axis only (never sideways).
   * 0°  = boot down / ferrule up
   * 180° = boot up / ferrule down (typical faceplate insert from above)
   */
  function portAlignedRotation(hit) {
    if (hit && (hit.owner === 'splitter' ||
        (hit.el && hit.el.classList && hit.el.classList.contains('lab-cas-port')))) {
      return 180;
    }
    /* OLT / default: upright ferrule-up seat */
    return 0;
  }

  /** Pick exact 0° or 180° from vertical approach; ignores horizontal drag heading. */
  function resolveUprightPlugRotation(hit, cord, end) {
    var base = portAlignedRotation(hit);
    var alt = base === 0 ? 180 : 0;
    var p = getEndWorld(cord, end);
    var dY = (hit && typeof hit.wy === 'number') ? (hit.wy - p.y) : 0;
    if (Math.abs(dY) < 1) return base;
    var preferred = headingRotFromMotion(0, dY);
    var dBase = Math.abs(((preferred - base + 540) % 360) - 180);
    var dAlt = Math.abs(((preferred - alt + 540) % 360) - 180);
    return dAlt < dBase ? alt : base;
  }

  function getEndRotation(cord, end) {
    var side = cord[endKey(end)];
    if (side.attached) {
      if (typeof side.lockedRot === 'number') return side.lockedRot;
      if (side.attached && typeof side.attached.lockedRot === 'number') {
        side.lockedRot = side.attached.lockedRot;
        return side.lockedRot;
      }
    }
    /* Live drag heading (nose → motion) drives CSS rotate + bootAnchor */
    if (typeof side.liveRot === 'number') return side.liveRot;
    var p = getEndWorld(cord, end);
    var o = end === 'A' ? { x: cord.bx, y: cord.by } : { x: cord.ax, y: cord.ay };
    return endRotationDeg(p.x, p.y, o.x, o.y);
  }

  /** Apply smoothed motion heading while an end is free / being dragged. */
  function updateLiveHeading(cord, end, dx, dy) {
    var side = cord[endKey(end)];
    if (!side || side.attached) return;
    if (dist2(0, 0, dx, dy) < HEADING_MIN_PX) return;
    var target = headingRotFromMotion(dx, dy);
    if (typeof side.liveRot === 'number') {
      side.liveRot = lerpAngleDeg(side.liveRot, target, HEADING_SMOOTH);
    } else {
      side.liveRot = target;
    }
  }

  /** Seat on port: ferrule on the port face, boot aimed along the locked axis. */
  function seatEndAtPort(cord, end, portX, portY) {
    var side = cord[endKey(end)];
    var rot = getEndRotation(cord, end);
    if (side.attached && typeof side.lockedRot !== 'number') {
      side.lockedRot = rot;
      side.attached.lockedRot = rot;
    }
    var t = bootOutDir(rot);
    setEndWorld(cord, end, portX + t.x * BOOT_EXIT_OFFSET, portY + t.y * BOOT_EXIT_OFFSET);
  }

  /**
   * Exact rear tip of the ribbed boot in world space (uses current rotation,
   * including live drag heading).
   */
  function bootAnchor(cord, end) {
    var p = getEndWorld(cord, end);
    var rot = getEndRotation(cord, end);
    return localToWorld(p.x, p.y, 0, BOOT_EXIT_OFFSET, rot);
  }

  /** Short outward stub past the boot tip so the fiber leaves straight before curving. */
  function bootExitStub(cord, end) {
    var tip = bootAnchor(cord, end);
    var t = bootOutDir(getEndRotation(cord, end));
    return {
      x: tip.x + t.x * BOOT_EXIT_STUB,
      y: tip.y + t.y * BOOT_EXIT_STUB,
    };
  }

  /** True if a sample sits inside/near a connector body (would pierce housing if used). */
  function pointInsideConnectorBody(cord, end, x, y) {
    var c = getEndWorld(cord, end);
    return dist2(c.x, c.y, x, y) < BODY_CLEAR_PX;
  }

  function ensureRoute(cord) {
    if (!cord.route) cord.route = [];
    return cord.route;
  }

  function clearDrawnPath(cord) {
    if (!cord) return;
    cord.route = [];
    cord.pathLocked = false;
  }

  /**
   * Record the mouse trail while the free end is dragged.
   * Distance dead-band rejects hand jitter; pathLocked freezes further samples.
   */
  function appendRoutePoint(cord, x, y) {
    if (!cord || cord.pathLocked) return false;
    var route = ensureRoute(cord);
    var last = route[route.length - 1];
    if (!last) {
      route.push({ x: x, y: y });
      return true;
    }
    if (dist2(last.x, last.y, x, y) < TRACE_SAMPLE_PX) return false;
    route.push({ x: x, y: y });
    if (route.length > TRACE_MAX_POINTS * 2) {
      cord.route = downsampleRoute(route, TRACE_MAX_POINTS);
    }
    return true;
  }

  function downsampleRoute(pts, maxN) {
    if (!pts || pts.length <= maxN) return pts || [];
    var out = [];
    var step = (pts.length - 1) / (maxN - 1);
    var i;
    for (i = 0; i < maxN; i++) {
      var idx = Math.round(i * step);
      out.push({ x: pts[idx].x, y: pts[idx].y });
    }
    return out;
  }

  /** Drop near-duplicate vertices before Chaikin (keeps endpoints). */
  function simplifyRouteMinDist(pts, minDist) {
    if (!pts || pts.length < 3) return pts ? pts.slice() : [];
    var out = [{ x: pts[0].x, y: pts[0].y }];
    var i;
    for (i = 1; i < pts.length - 1; i++) {
      var prev = out[out.length - 1];
      if (dist2(prev.x, prev.y, pts[i].x, pts[i].y) >= minDist) {
        out.push({ x: pts[i].x, y: pts[i].y });
      }
    }
    var last = pts[pts.length - 1];
    if (dist2(out[out.length - 1].x, out[out.length - 1].y, last.x, last.y) < 0.5) {
      out[out.length - 1] = { x: last.x, y: last.y };
    } else {
      out.push({ x: last.x, y: last.y });
    }
    return out;
  }

  /**
   * Chaikin's corner-cutting on an open polyline (endpoints preserved).
   * Softens jagged hand-drawn corners into an organic sagging curve.
   */
  function chaikinSmooth(pts, iterations) {
    if (!pts || pts.length < 3) return pts ? pts.slice() : [];
    iterations = iterations == null ? CHAIKIN_ITERATIONS : iterations;
    var curr = pts.slice();
    var n;
    for (n = 0; n < iterations; n++) {
      if (curr.length < 3) break;
      var next = [{ x: curr[0].x, y: curr[0].y }];
      var i;
      for (i = 0; i < curr.length - 1; i++) {
        var p = curr[i];
        var q = curr[i + 1];
        next.push({
          x: 0.75 * p.x + 0.25 * q.x,
          y: 0.75 * p.y + 0.25 * q.y,
        });
        next.push({
          x: 0.25 * p.x + 0.75 * q.x,
          y: 0.25 * p.y + 0.75 * q.y,
        });
      }
      next.push({
        x: curr[curr.length - 1].x,
        y: curr[curr.length - 1].y,
      });
      curr = next;
    }
    return curr;
  }

  /** Post-draw cleanup: simplify jitter → Chaikin → optional downsample. */
  function smoothDrawnRoute(cord) {
    if (!cord || cord.pathLocked) return;
    var route = ensureRoute(cord);
    if (route.length < 3) return;
    route = simplifyRouteMinDist(route, TRACE_SAMPLE_PX * 0.75);
    route = chaikinSmooth(route, CHAIKIN_ITERATIONS);
    if (route.length > TRACE_MAX_POINTS) {
      route = downsampleRoute(route, TRACE_MAX_POINTS);
    }
    cord.route = route;
  }

  /** Freeze the traced path so it never auto-recalculates after both ends are plugged. */
  function lockDrawnPath(cord) {
    if (!cord) return;
    smoothDrawnRoute(cord);
    var route = ensureRoute(cord);
    if (route.length > TRACE_MAX_POINTS) {
      cord.route = downsampleRoute(route, TRACE_MAX_POINTS);
    }
    cord.pathLocked = true;
  }

  function buildCablePoints(cord) {
    var a = bootAnchor(cord, 'A');
    var b = bootAnchor(cord, 'B');
    var aStub = bootExitStub(cord, 'A');
    var bStub = bootExitStub(cord, 'B');
    var route = ensureRoute(cord).slice();

    if (!route.length) return [a, aStub, bStub, b];

    if (route.length >= 1) {
      var dFirstA = dist2(route[0].x, route[0].y, a.x, a.y);
      var dLastA = dist2(route[route.length - 1].x, route[route.length - 1].y, a.x, a.y);
      if (dLastA < dFirstA) route.reverse();
    }

    /* Keep only mid-span samples — drop anything inside a connector or on the exit stubs */
    var cleaned = [];
    var i;
    for (i = 0; i < route.length; i++) {
      var p = route[i];
      if (pointInsideConnectorBody(cord, 'A', p.x, p.y)) continue;
      if (pointInsideConnectorBody(cord, 'B', p.x, p.y)) continue;
      if (dist2(p.x, p.y, a.x, a.y) < 3) continue;
      if (dist2(p.x, p.y, b.x, b.y) < 3) continue;
      if (dist2(p.x, p.y, aStub.x, aStub.y) < 2.5) continue;
      if (dist2(p.x, p.y, bStub.x, bStub.y) < 2.5) continue;
      if (cleaned.length && dist2(cleaned[cleaned.length - 1].x, cleaned[cleaned.length - 1].y, p.x, p.y) < 2) {
        continue;
      }
      cleaned.push(p);
    }

    return [a, aStub].concat(cleaned).concat([bStub, b]);
  }

  /** Smooth SVG path through recorded waypoints (Catmull-Rom → cubic Bezier). */
  function smoothPathThrough(pts) {
    if (!pts || pts.length < 2) return '';
    if (pts.length === 2) {
      return 'M ' + pts[0].x + ' ' + pts[0].y + ' L ' + pts[1].x + ' ' + pts[1].y;
    }
    if (pts.length === 3) {
      return (
        'M ' + pts[0].x + ' ' + pts[0].y +
        ' Q ' + pts[1].x + ' ' + pts[1].y + ', ' + pts[2].x + ' ' + pts[2].y
      );
    }
    var d = 'M ' + pts[0].x + ' ' + pts[0].y;
    var i;
    var k = 4.5;
    for (i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i];
      var p1 = pts[i];
      var p2 = pts[i + 1];
      var p3 = pts[i + 2] || p2;
      var c1x = p1.x + (p2.x - p0.x) / k;
      var c1y = p1.y + (p2.y - p0.y) / k;
      var c2x = p2.x - (p3.x - p1.x) / k;
      var c2y = p2.y - (p3.y - p1.y) / k;
      d += ' C ' + c1x + ' ' + c1y + ', ' + c2x + ' ' + c2y + ', ' + p2.x + ' ' + p2.y;
    }
    return d;
  }

  /**
   * Prefer the user-traced route. Fall back to a light gravity sag only when
   * no path has been drawn yet (idle / untraced span).
   */
  function cordCablePath(cord) {
    var route = ensureRoute(cord);
    if (route.length || cord.pathLocked) {
      return smoothPathThrough(buildCablePoints(cord));
    }
    return gravityBezierPath(cord);
  }

  /**
   * Fallback only for untraced cords (no mouse path yet).
   * Both ends free → clean chord along boot exit axes (no sideways sag).
   * One end plugged → light gravity sag toward the free end.
   */
  function gravityBezierPath(cord) {
    var p0 = bootAnchor(cord, 'A');
    var p3 = bootAnchor(cord, 'B');
    var tA = bootOutDir(getEndRotation(cord, 'A'));
    var tB = bootOutDir(getEndRotation(cord, 'B'));
    var dx = p3.x - p0.x;
    var dy = p3.y - p0.y;
    var dist = Math.sqrt(dx * dx + dy * dy) || 1;
    var bothFree = !cord.sideA.attached && !cord.sideB.attached;

    if (bothFree) {
      /* Handles follow each boot’s rear-exit vector for a clean vertical stub */
      var h = Math.min(BOOT_EXIT_STUB + 12, Math.max(BOOT_EXIT_STUB, dist * 0.22));
      return (
        'M ' + p0.x + ' ' + p0.y +
        ' C ' + (p0.x + tA.x * h) + ' ' + (p0.y + tA.y * h) + ', ' +
        (p3.x + tB.x * h) + ' ' + (p3.y + tB.y * h) + ', ' +
        p3.x + ' ' + p3.y
      );
    }

    var gravityOffset = Math.min(
      GRAVITY_SAG_MAX,
      Math.max(GRAVITY_SAG_MIN, GRAVITY_OFFSET * 0.45 + dist * GRAVITY_SAG_RATIO)
    );
    var handle = Math.min(96, Math.max(28, dist * 0.35));
    var p1x = p0.x + tA.x * handle;
    var p1y = p0.y + tA.y * handle + gravityOffset * 0.35;
    var p2x = p3.x + tB.x * handle;
    var p2y = p3.y + tB.y * handle + gravityOffset * 0.35;
    return (
      'M ' + p0.x + ' ' + p0.y +
      ' C ' + p1x + ' ' + p1y + ', ' + p2x + ' ' + p2y + ', ' + p3.x + ' ' + p3.y
    );
  }

  function endStyle(cord, end) {
    var p = getEndWorld(cord, end);
    var rot = getEndRotation(cord, end);
    /* Pivot at connector center — left/top place the box so (END_W/2, END_H/2) = world p */
    return (
      'left:' + Math.round(p.x - END_W / 2) + 'px;' +
      'top:' + Math.round(p.y - END_H / 2) + 'px;' +
      'transform-origin:50% 50%;' +
      'transform:rotate(' + rot.toFixed(2) + 'deg)'
    );
  }

  function endMarkup(cord, end, side) {
    var label = end === 'B' ? 'B' : 'A';
    return (
      '<button type="button" class="lab-pcord__end lab-pcord__end--' + end.toLowerCase() + ' ' +
      endClass(side) +
      (side.attached ? ' is-attached' : '') +
      (side.mismatch ? ' is-mismatch' : '') +
      '" data-pcord-id="' + cord.id + '" data-pcord-end="' + end + '" ' +
      'style="' + endStyle(cord, end) + '" ' +
      'title="Side ' + label + ' · ' + displayPolish(side.polish) +
      (side.attached
        ? ' · locked in port · pull to unplug'
        : ' · drag to follow mouse · release on port to snap') +
      '" ' +
      'aria-label="Side ' + label + ' ' + displayPolish(side.polish) + '">' +
      '<span class="lab-pcord__housing" aria-hidden="true">' +
      '<i class="lab-pcord__ferrule"></i>' +
      '</span>' +
      '<span class="lab-pcord__boot" aria-hidden="true">' +
      '<i></i><i></i><i></i><i></i><i></i>' +
      '</span>' +
      '<b class="lab-pcord__mark">' + label + '</b>' +
      '</button>'
    );
  }

  function flashPort(el) {
    if (!el) return;
    el.classList.add('is-plug-click');
    setTimeout(function () { el.classList.remove('is-plug-click'); }, 280);
  }

  function rebuildLayer() {
    var host = ensureLayer();
    if (!host) return;

    cords.forEach(function (c) { syncAttachedPositions(c); });

    var html = '<svg class="lab-pcord-svg" aria-hidden="true">';
    cords.forEach(function (c) {
      var path = cordCablePath(c);
      var bad = c.sideA.mismatch || c.sideB.mismatch;
      var sel = selection.cordId === c.id ? ' is-selected' : '';
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

  /** Real-time path + free-end pose; plugged ends keep locked style. */
  function updateFiberPath(cord) {
    if (!layer) return;
    var d = cordCablePath(cord);
    var path = layer.querySelector('[data-pcord-fiber="' + cord.id + '"]');
    var hit = layer.querySelector('.lab-pcord-fiber-hit[data-pcord-drag="' + cord.id + '"]');
    if (path) path.setAttribute('d', d);
    if (hit) hit.setAttribute('d', d);
    var aBtn = layer.querySelector('[data-pcord-id="' + cord.id + '"][data-pcord-end="A"]');
    var bBtn = layer.querySelector('[data-pcord-id="' + cord.id + '"][data-pcord-end="B"]');
    if (aBtn) aBtn.setAttribute('style', endStyle(cord, 'A'));
    if (bBtn) bBtn.setAttribute('style', endStyle(cord, 'B'));
  }

  function bindLayerEvents(host) {
    /* Whole free cord move via fiber (plugged ends stay locked) */
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
        /* Path routing is only via click-drag on a connector end — never auto / fiber-glue */
        if (aLocked || bLocked) {
          setStatus('Click-and-hold a free connector end to drag and draw the path');
          return;
        }
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

    /* Identical click-and-hold drag for End A and End B — no auto cursor glue */
    host.querySelectorAll('[data-pcord-end]').forEach(function (btn) {
      btn.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }

        var id = btn.getAttribute('data-pcord-id');
        var end = btn.getAttribute('data-pcord-end');
        var c = findCord(id);
        if (!c) return;
        selectCord(id);

        var side = c[endKey(end)];
        var wasAttached = !!side.attached;
        var portHome = wasAttached
          ? {
              x: side.attached.wx,
              y: side.attached.wy,
              label: side.attached.label,
              lockedRot: side.lockedRot,
            }
          : null;
        var startClientX = e.clientX;
        var startClientY = e.clientY;
        var released = false;
        var pluggedNow = false;
        var otherEnd = oppositeEnd(end);
        var otherWasLocked = !!c[endKey(otherEnd)].attached;
        var startWorld = clientToWorld(e.clientX, e.clientY);
        var lastWorld = { x: startWorld.x, y: startWorld.y };

        /*
         * Free end + other plugged → continue / extend manual path on this drag.
         * Never wipe cord.route — preserve existing waypoints across re-grabs.
         */
        if (!wasAttached && otherWasLocked && !c.pathLocked) {
          if (!ensureRoute(c).length) {
            var seedBoot = bootAnchor(c, otherEnd);
            appendRoutePoint(c, seedBoot.x, seedBoot.y);
          }
        }

        btn.classList.add('is-dragging');
        document.body.classList.add('lab-pcord-plugging');
        endDragState = { cordId: id, end: end };

        function clearHighlights() {
          document.querySelectorAll('.lab-fx-port.is-plug-target, .lab-cas-port.is-plug-target')
            .forEach(function (n) { n.classList.remove('is-plug-target'); });
        }

        function onMove(ev) {
          var mouse = clientToWorld(ev.clientX, ev.clientY);
          var pullPx = dist2(ev.clientX, ev.clientY, startClientX, startClientY);

          if (wasAttached && !released) {
            /* Plugged A or B: stay locked until pull clears unplug threshold */
            if (pullPx < UNPLUG_PULL_PX) {
              if (portHome) seatEndAtPort(c, end, portHome.x, portHome.y);
              btn.classList.add('is-tension');
              updateFiberPath(c);
              return;
            }
            released = true;
            detachEnd(c, end);
            lastWorld.x = mouse.x;
            lastWorld.y = mouse.y;
            /* Keep cord.route intact — do not clearDrawnPath on unplug */
            btn.classList.remove('is-attached', 'is-mismatch', 'is-tension');
            btn.classList.add('is-unplugging');
            setStatus('Side ' + end + ' unplugged from ' + (portHome.label || 'port'));
            refreshBudget();
            updateInspector();
          }

          /* Opposite plugged end stays seated (symmetrical for A↔B) */
          if (c[endKey(otherEnd)].attached) {
            var oAtt = c[endKey(otherEnd)].attached;
            seatEndAtPort(c, otherEnd, oAtt.wx, oAtt.wy);
          }

          /* Dynamic heading: nose follows mouse motion; boot trails (feeds bootAnchor) */
          if (!c[endKey(end)].attached) {
            updateLiveHeading(c, end, mouse.x - lastWorld.x, mouse.y - lastWorld.y);
            if (dist2(lastWorld.x, lastWorld.y, mouse.x, mouse.y) >= HEADING_MIN_PX) {
              lastWorld.x = mouse.x;
              lastWorld.y = mouse.y;
            }
          }

          setEndWorld(c, end, mouse.x, mouse.y);
          if (c[endKey(otherEnd)].attached && !c.pathLocked) {
            /* Record at the free boot tip (not the connector center) to avoid body piercing */
            var tip = bootExitStub(c, end);
            appendRoutePoint(c, tip.x, tip.y);
          }
          updateFiberPath(c);

          clearHighlights();
          var hit = hitTestPort(ev.clientX, ev.clientY);
          if (hit && hit.el) {
            var br = hit.el.getBoundingClientRect();
            var dScreen = dist2(
              ev.clientX, ev.clientY,
              br.left + br.width / 2, br.top + br.height / 2
            );
            if (dScreen <= PLUG_SNAP_PX * 1.6) hit.el.classList.add('is-plug-target');
          }
        }

        function onUp(ev) {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          try { btn.releasePointerCapture(ev.pointerId); } catch (err2) { /* ignore */ }
          btn.classList.remove('is-dragging', 'is-tension', 'is-unplugging');
          document.body.classList.remove('lab-pcord-plugging');
          clearHighlights();

          var hit = hitTestPort(ev.clientX, ev.clientY);
          var mouse = clientToWorld(ev.clientX, ev.clientY);

          if (wasAttached && !released) {
            syncAttachedPositions(c);
            setStatus('Side ' + end + ' still locked · pull farther to unplug');
          } else if (hit) {
            var snapEl = hit.el.querySelector('.lab-fx-port__cage') ||
              hit.el.querySelector('i') || hit.el;
            var rect = snapEl.getBoundingClientRect();
            var dScreen = dist2(
              ev.clientX, ev.clientY,
              rect.left + rect.width / 2, rect.top + rect.height / 2
            );
            if (dScreen <= PLUG_SNAP_PX * 1.75) {
              attachEnd(c, end, hit);
              if (!c.pathLocked) {
                var seatTip = bootExitStub(c, end);
                appendRoutePoint(c, seatTip.x, seatTip.y);
                smoothDrawnRoute(c);
              }
              pluggedNow = true;
              flashPort(hit.el);
              if (c[endKey(otherEnd)].attached) {
                lockDrawnPath(c);
                endLinkSession({ silent: true });
                setStatus('Patch connected · drawn path locked (End ' + end + ' snapped)');
              }
            } else {
              setEndWorld(c, end, mouse.x, mouse.y);
              if (!c.pathLocked && ensureRoute(c).length >= 3) smoothDrawnRoute(c);
              setStatus('Side ' + end + ' free · release over a port to snap-lock');
            }
          } else {
            setEndWorld(c, end, mouse.x, mouse.y);
            if (!c.pathLocked && ensureRoute(c).length >= 3) smoothDrawnRoute(c);
            setStatus('Side ' + end + ' free · click-and-drag to draw, release on a port');
          }

          endDragState = null;
          rebuildLayer();
          updateInspector();
          pushHistory();
          refreshBudget();
          if (pluggedNow && layer) {
            var live = layer.querySelector(
              '[data-pcord-id="' + id + '"][data-pcord-end="' + end + '"]'
            );
            if (live) {
              live.classList.add('is-just-plugged');
              setTimeout(function () { live.classList.remove('is-just-plugged'); }, 320);
            }
          }

          /* First end plugged — free end keeps its current position (no shrink/snap-back) */
          if (pluggedNow) {
            var other = oppositeEnd(end);
            if (c[endKey(end)].attached && !c[endKey(other)].attached) {
              armHalfConnected(c, other);
            }
          }
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
      '<p>End A and End B use the same rules: plugging one end locks only that end — the free end stays where it is (no auto-shrink or snap-back). Move the free end only with click-and-hold drag; release on a port to snap and lock the drawn path.</p>';

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
    cancelLinkSession();
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
    endLinkSession({ silent: true });
    renderToolbox();
    bindStageDrop();
    bindPortLifecycle();
    ensureLayer();
    rebuildLayer();
    pushHistory();
    refreshBudget();

    if (global.FtthLab) {
      var prevTry = FtthLab.tryPatchPort;
      FtthLab.tryPatchPort = function (portDesc) {
        if (tryPatchPort(portDesc)) return true;
        if (typeof prevTry === 'function' && prevTry !== tryPatchPort) {
          return prevTry(portDesc);
        }
        return false;
      };
    }
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
    startLinkFromPort: startLinkFromPort,
    tryPatchPort: tryPatchPort,
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
