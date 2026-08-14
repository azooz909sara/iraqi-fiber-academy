/**
 * Patch Cord — symmetrical click-and-drag for End A and End B
 * Plugged end stays locked; free end moves only on mouse-down+hold.
 * On full connect, mid-span is a true catenary y = c + a·cosh(x/a); cable
 * length is locked (fixedLength) and preserved when relocating a connector.
 * Relocate = fixed-length tether + catenary reset on the new port span.
 * Gravity lock: mid-span sag is always +Y (down); upward bulges are mirrored.
 * Length modes: Free Draw (route/stretch) · Meter Mode (fixed m · pure catenary sag).
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
  /** Ephemeral rope sim keyed by cord id (not persisted in history) */
  var ropePhysics = {};
  var physRafId = 0;

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

  function getPxPerMeter() {
    if (global.FtthLab && typeof FtthLab.getPxPerMeter === 'function') {
      return FtthLab.getPxPerMeter() || 160;
    }
    return 160;
  }

  function metersToPx(m) {
    if (global.FtthLab && typeof FtthLab.metersToWorldPx === 'function') {
      return FtthLab.metersToWorldPx(m);
    }
    return Number(m) * getPxPerMeter();
  }

  function pxToMeters(px) {
    if (global.FtthLab && typeof FtthLab.worldPxToMeters === 'function') {
      return FtthLab.worldPxToMeters(px);
    }
    return Number(px) / getPxPerMeter();
  }

  function isMeterMode(cord) {
    return !!(cord && cord.lengthMode === 'meter');
  }

  function normalizeLengthMeters(m) {
    var n = Math.round(Number(m) * 2) / 2;
    if (!isFinite(n) || n < 0.5) n = 0.5;
    if (n > 100) n = 100;
    return n;
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
    clearAllRopePhysics();
    cords = cloneJson(snap.cords) || [];
    seq = snap.seq || 0;
    selection = { kind: 'none', cordId: null };
    endDragState = null;
    cords.forEach(function (c) {
      if (!c.lengthMode) c.lengthMode = 'free';
      if (typeof c.lengthMeters !== 'number') {
        c.lengthMeters = typeof c.fixedLength === 'number'
          ? normalizeLengthMeters(pxToMeters(c.fixedLength))
          : 3;
      }
    });
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

  /** Default free-spawn span (px) and face-to-face boot rotations. */
  function defaultSpawnSpanPx() {
    if (global.FtthLab && typeof FtthLab.PATCH_CORD_DEFAULT_SPAN_PX === 'number') {
      return Math.max(80, FtthLab.PATCH_CORD_DEFAULT_SPAN_PX);
    }
    return 180;
  }

  function defaultSpawnRotA() {
    if (global.FtthLab && typeof FtthLab.PATCH_CORD_DEFAULT_ROT_A === 'number') {
      return FtthLab.PATCH_CORD_DEFAULT_ROT_A;
    }
    return -90; /* boot toward +X (peer) */
  }

  function defaultSpawnRotB() {
    if (global.FtthLab && typeof FtthLab.PATCH_CORD_DEFAULT_ROT_B === 'number') {
      return FtthLab.PATCH_CORD_DEFAULT_ROT_B;
    }
    return 90; /* boot toward −X (peer) */
  }

  function defaultSpawnSagSlack() {
    if (global.FtthLab && typeof FtthLab.PATCH_CORD_DEFAULT_SAG_SLACK === 'number') {
      return Math.max(1.05, FtthLab.PATCH_CORD_DEFAULT_SAG_SLACK);
    }
    return 1.18;
  }

  /**
   * Seed mid-span samples so a fresh cord paints a natural downward catenary
   * immediately (no straight chord / empty path flash).
   */
  function seedInitialCatenaryRoute(cord) {
    if (!cord) return;
    var ends = reliefSpanEnds(cord);
    var chord = dist2(ends.a.x, ends.a.y, ends.b.x, ends.b.y) || 1;
    var slack = defaultSpawnSagSlack();
    var sag = catenarySagDepth(chord);
    var L = Math.max(
      chord * slack,
      catenaryLengthForSag(ends.a, ends.b, sag)
    );
    var full = sampleTrueCatenary(ends.a, ends.b, L, CATENARY_SAMPLES);
    cord.route = full.slice(1, -1);
    cord.pathLocked = false;
  }

  /**
   * Apply horizontal face-to-face pose: A left / B right, boots toward each
   * other (−90° / +90°), then seed a hanging catenary between the relief tips.
   */
  function applyDefaultFreeSpawnPose(cord, originX, originY) {
    var span = defaultSpawnSpanPx();
    var rotA = defaultSpawnRotA();
    var rotB = defaultSpawnRotB();
    cord.ax = originX;
    cord.ay = originY;
    cord.bx = originX + span;
    cord.by = originY;
    cord.sideA.liveRot = rotA;
    cord.sideB.liveRot = rotB;
    cord.sideA.lockedRot = null;
    cord.sideB.lockedRot = null;
    seedInitialCatenaryRoute(cord);
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
      bx: pos.x,
      by: pos.y,
      sideA: { polish: 'PC', attached: null, mismatch: false, lockedRot: null, liveRot: null },
      sideB: { polish: 'PC', attached: null, mismatch: false, lockedRot: null, liveRot: null },
      route: [],
      pathLocked: false,
      fixedLength: null, /* locked mid-span length once both ends first connect */
      lengthMode: 'free', /* 'free' | 'meter' */
      lengthMeters: 3, /* Meter Mode target length */
      relocating: false, /* true while moving a plugged end to a new port */
    };
    applyDefaultFreeSpawnPose(cord, pos.x, pos.y);
    cords.push(cord);
    selectCord(cord.id);
    rebuildLayer();
    pushHistory();
    refreshBudget();
    setStatus(
      'Patch cord placed · horizontal face-to-face · natural sag · ' +
      'drag a free end to route · snap into a port to lock'
    );
    return cord;
  }

  function removeCord(id) {
    if (linkSession && linkSession.cordId === id) endLinkSession({ silent: true });
    clearRopePhysics(id);
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
    if (att.owner === 'coupler') {
      return att.couplerId === hit.couplerId && att.port === hit.port;
    }
    if (att.owner === 'vfl') {
      return att.vflId === hit.vflId;
    }
    if (att.owner === 'opm') {
      return att.opmId === hit.opmId;
    }
    if (att.owner === 'ols') {
      return att.olsId === hit.olsId;
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
    if (hit && hit.owner === 'ols') {
      hit = enrichOlsHitDeepSeat(hit) || hit;
    }
    var side = cord[endKey(end)];
    var mismatch = !polishMatch(side.polish, hit.polish);
    if (hit.owner === 'vfl') mismatch = false;
    if (hit.owner === 'opm' || hit.owner === 'ols') mismatch = !polishMatch(side.polish, hit.polish);
    clearPortFromOthers(hit, cord.id, end);
    if (hit.owner === 'vfl' && global.FtthLab && typeof FtthLab.detachPigtailsFromVfl === 'function') {
      FtthLab.detachPigtailsFromVfl(hit.vflId, null);
    }
    var otherEnd = oppositeEnd(end);
    /* Coupler faces are horizontal; OLT/splitter/VFL/OPM/OLS stay vertical (0° / 180°) */
    var lockedRot = resolveUprightPlugRotation(hit, cord, end);
    if (hit && (hit.owner === 'vfl' || hit.owner === 'opm' || hit.owner === 'ols')) {
      lockedRot = 180;
    } else if (!(hit && (hit.owner === 'coupler'))) {
      lockedRot = lockedRot === 180 || lockedRot === -180 ? 180 : 0;
    }
    side.liveRot = null;
    side.attached = {
      owner: hit.owner,
      polish: portPolishNorm(hit.polish) === 'APC' ? 'APC' : 'UPC',
      label: hit.label,
      splitterId: hit.splitterId || null,
      couplerId: hit.couplerId || null,
      vflId: hit.vflId || null,
      opmId: hit.opmId || null,
      olsId: hit.olsId || null,
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
    if (global.FtthLab && typeof FtthLab.refreshVflLaser === 'function') {
      FtthLab.refreshVflLaser();
    }
    if (global.FtthLab && typeof FtthLab.refreshOpmDocks === 'function') {
      FtthLab.refreshOpmDocks();
    }
    if (global.FtthLab && typeof FtthLab.refreshOlsDocks === 'function') {
      FtthLab.refreshOlsDocks();
    }
    if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
      FtthLab.notifyLayoutChange({ source: 'patch-cord', opm: true, ols: true });
    }
  }

  function detachEnd(cord, end) {
    var side = cord[endKey(end)];
    var other = oppositeEnd(end);
    var otherAttached = !!(cord[endKey(other)] && cord[endKey(other)].attached);
    /* Capture span length before unlock so relocate cannot grow the cable */
    if (typeof cord.fixedLength !== 'number' && (cord.pathLocked || otherAttached)) {
      var measured = measureCableSpanLength(cord);
      if (measured > 0) cord.fixedLength = measured;
    }
    side.attached = null;
    side.mismatch = false;
    side.lockedRot = null;
    cord.pathLocked = false;
    cord.relocating = otherAttached && typeof cord.fixedLength === 'number';
    clearRopePhysics(cord.id);
    if (global.FtthLab && typeof FtthLab.refreshVflLaser === 'function') {
      FtthLab.refreshVflLaser();
    }
    if (global.FtthLab && typeof FtthLab.refreshOpmDocks === 'function') {
      FtthLab.refreshOpmDocks();
    }
    if (global.FtthLab && typeof FtthLab.refreshOlsDocks === 'function') {
      FtthLab.refreshOlsDocks();
    }
  }

  function clearDrawnPath(cord) {
    if (!cord) return;
    cord.route = [];
    cord.pathLocked = false;
    cord.relocating = false;
    /* Keep fixedLength — physical cord length survives path clears / relocates */
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

      node = el.closest && el.closest('.lab-cpl-port');
      if (node) {
        var cid = node.getAttribute('data-cpl-id');
        var cport = node.getAttribute('data-cpl-port') || 'A';
        var cPolish = node.classList.contains('is-apc') ? 'APC' : 'UPC';
        var cFace = node.querySelector('i') || node;
        var r3 = cFace.getBoundingClientRect();
        var c3 = clientToWorld(r3.left + r3.width / 2, r3.top + r3.height / 2);
        return {
          owner: 'coupler',
          couplerId: cid,
          port: cport,
          polish: cPolish,
          label: 'SC Coupler ' + cport + ' · ' + (cPolish === 'APC' ? 'SC/APC' : 'SC/PC'),
          wx: c3.x,
          wy: c3.y,
          el: node,
        };
      }

      node = el.closest && el.closest('.lab-vfl-port[data-vfl-port]');
      if (node) {
        var vid = node.getAttribute('data-vfl-port');
        var ferrule = node.querySelector('.lab-vfl-port__ferrule') || node;
        var rV = ferrule.getBoundingClientRect();
        var cV = clientToWorld(rV.left + rV.width / 2, rV.top + rV.height / 2);
        return {
          owner: 'vfl',
          vflId: vid,
          polish: 'UPC',
          label: 'VFL · SC port',
          wx: cV.x,
          wy: cV.y,
          el: node,
        };
      }

      node = el.closest && el.closest('.lab-opm-port[data-opm-port]');
      if (node) {
        var oid = node.getAttribute('data-opm-port');
        var conn = (node.getAttribute('data-opm-connector') || 'SC').toUpperCase();
        if (conn !== 'SC') {
          if (global.FtthLab && FtthLab.showAlert) {
            FtthLab.showAlert('OLP-38 accepts SC connectors only (Patch Cord / SC Pigtail).', 'warn');
          } else if (global.FtthLab && FtthLab.setStatus) {
            FtthLab.setStatus('Dock rejected · SC connector required');
          }
          return null;
        }
        var knurl = node.querySelector('.viavi__adapter-knurl, .lab-opm__adapter-knurl') || node;
        var rO = knurl.getBoundingClientRect();
        var cO = clientToWorld(rO.left + rO.width / 2, rO.top + rO.height * 0.35);
        return {
          owner: 'opm',
          opmId: oid,
          polish: 'UPC',
          connectorType: 'SC',
          label: 'Viavi OLP-38 · SC adapter',
          wx: cO.x,
          wy: cO.y,
          el: node,
        };
      }

      node = el.closest && el.closest('.lab-ols-port[data-ols-port]');
      if (node) {
        var olsId = node.getAttribute('data-ols-port');
        var olsConn = (node.getAttribute('data-ols-connector') || 'SC').toUpperCase();
        if (olsConn !== 'SC') {
          if (global.FtthLab && FtthLab.showAlert) {
            FtthLab.showAlert('OLS-35 accepts SC connectors only (Patch Cord / SC Pigtail).', 'warn');
          } else if (global.FtthLab && FtthLab.setStatus) {
            FtthLab.setStatus('Dock rejected · SC connector required');
          }
          return null;
        }
        var olsSlot = node.querySelector(
          '.lab-ols__adapter-slot, .lab-ols__adapter-knurl, .viavi__adapter-knurl'
        ) || node;
        var rS = olsSlot.getBoundingClientRect();
        var cS = clientToWorld(rS.left + rS.width / 2, rS.top + Math.max(1, rS.height * 0.2));
        return {
          owner: 'ols',
          olsId: olsId,
          polish: 'UPC',
          connectorType: 'SC',
          label: 'Viavi OLS-35 · SC adapter',
          wx: cS.x,
          wy: cS.y,
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
        return;
      }
      if (att.owner === 'coupler') {
        var pw = null;
        if (global.FtthLab && typeof FtthLab.getCouplerPortWorld === 'function') {
          pw = FtthLab.getCouplerPortWorld(att.couplerId, att.port);
        }
        if (pw) {
          att.wx = pw.x;
          att.wy = pw.y;
          if (typeof side.lockedRot !== 'number') {
            side.lockedRot = typeof pw.rot === 'number'
              ? pw.rot
              : portAlignedRotation({ owner: 'coupler', port: att.port });
            att.lockedRot = side.lockedRot;
          }
          side.liveRot = null;
          seatEndAtPort(cord, end, pw.x, pw.y);
          return;
        }
        el = document.querySelector(
          '.lab-cpl-port[data-cpl-id="' + att.couplerId + '"][data-cpl-port="' + att.port + '"]'
        );
        if (el) {
          var rC = el.getBoundingClientRect();
          var ptC = clientToWorld(rC.left + rC.width / 2, rC.top + rC.height / 2);
          att.wx = ptC.x;
          att.wy = ptC.y;
          if (typeof side.lockedRot !== 'number') {
            side.lockedRot = portAlignedRotation({
              owner: 'coupler',
              port: att.port,
              el: el,
              wx: ptC.x,
              wy: ptC.y,
            });
            att.lockedRot = side.lockedRot;
          }
          side.liveRot = null;
          seatEndAtPort(cord, end, ptC.x, ptC.y);
        }
        return;
      }
      if (att.owner === 'vfl') {
        var pwV = null;
        if (global.FtthLab && typeof FtthLab.getVflPortWorld === 'function') {
          pwV = FtthLab.getVflPortWorld(att.vflId);
        }
        if (pwV) {
          att.wx = pwV.x;
          att.wy = pwV.y;
          /* Always re-assert upward cable exit (180°) on top test ports */
          side.lockedRot = 180;
          att.lockedRot = 180;
          side.liveRot = null;
          seatEndAtPort(cord, end, pwV.x, pwV.y);
        }
        return;
      }
      if (att.owner === 'opm') {
        var pwO = null;
        if (global.FtthLab && typeof FtthLab.getOpmPortWorld === 'function') {
          pwO = FtthLab.getOpmPortWorld(att.opmId);
        }
        if (pwO) {
          att.wx = pwO.x;
          att.wy = pwO.y;
          side.lockedRot = 180;
          att.lockedRot = 180;
          side.liveRot = null;
          seatEndAtPort(cord, end, pwO.x, pwO.y);
        }
        return;
      }
      if (att.owner === 'ols') {
        var pwS = null;
        if (global.FtthLab && typeof FtthLab.getOlsPortWorld === 'function') {
          pwS = FtthLab.getOlsPortWorld(att.olsId);
        }
        if (pwS) {
          att.wx = pwS.x;
          att.wy = pwS.y;
          side.lockedRot = 180;
          att.lockedRot = 180;
          side.liveRot = null;
          seatEndAtPort(cord, end, pwS.x, pwS.y);
        }
      }
    });
  }

  /* ─── Loss / budget ─── */

  function cordFiberLengthM(cord) {
    if (!cord) return 0;
    if (isMeterMode(cord) && typeof cord.lengthMeters === 'number') {
      return cord.lengthMeters;
    }
    if (typeof cord.fixedLength === 'number' && cord.fixedLength > 0) {
      return pxToMeters(cord.fixedLength);
    }
    var dx = cord.bx - cord.ax;
    var dy = cord.by - cord.ay;
    return pxToMeters(Math.sqrt(dx * dx + dy * dy));
  }

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

  /** Attachment snapshot for VFL laser propagation. */
  function getLaserGraphNodes() {
    return cords.map(function (c) {
      function sideSnap(side) {
        if (!side.attached) return null;
        return {
          owner: side.attached.owner,
          couplerId: side.attached.couplerId || null,
          vflId: side.attached.vflId || null,
          splitterId: side.attached.splitterId || null,
          opmId: side.attached.opmId || null,
          olsId: side.attached.olsId || null,
          port: side.attached.port || null,
          slot: side.attached.slot != null ? side.attached.slot : null,
          oltPort: side.attached.oltPort != null ? side.attached.oltPort : null,
          mismatch: !!side.mismatch,
        };
      }
      return {
        id: c.id,
        sideA: sideSnap(c.sideA),
        sideB: sideSnap(c.sideB),
        lossDb: cordLossDb(c),
        fiberLengthM: cordFiberLengthM(c),
        freeA: !c.sideA.attached,
        freeB: !c.sideB.attached,
      };
    });
  }

  function applyLaserGlow(ids, mode, meta) {
    meta = meta || {};
    var map = {};
    var exits = meta.pcordExits || {};
    (ids || []).forEach(function (id) { map[id] = true; });
    if (!mode && global.FtthLab && FtthLab._vflGlow) mode = FtthLab._vflGlow.mode;
    mode = String(mode || 'OFF').toUpperCase();
    if (!layer) return;

    /* Jacket paths must never pick up laser tint */
    layer.querySelectorAll('[data-pcord-fiber]').forEach(function (el) {
      el.classList.remove('is-vfl-glow', 'is-vfl-glow--cw', 'is-vfl-glow--glint');
    });

    layer.querySelectorAll('[data-pcord-laser]').forEach(function (el) {
      var id = el.getAttribute('data-pcord-laser');
      var on = !!map[id] && mode !== 'OFF';
      el.classList.remove('is-vfl-glow', 'is-vfl-glow--cw', 'is-vfl-glow--glint');
      if (!on) return;
      el.classList.add('is-vfl-glow');
      el.classList.add(mode === 'GLINT' ? 'is-vfl-glow--glint' : 'is-vfl-glow--cw');
    });

    layer.querySelectorAll('[data-pcord-id][data-pcord-end]').forEach(function (el) {
      var id = el.getAttribute('data-pcord-id');
      var end = el.getAttribute('data-pcord-end');
      el.classList.remove('is-vfl-laser-exit', 'is-vfl-laser-exit--cw', 'is-vfl-laser-exit--glint');
      if (map[id] && exits[id] === end && mode !== 'OFF' && !el.classList.contains('is-attached')) {
        el.classList.add('is-vfl-laser-exit');
        el.classList.add(mode === 'GLINT' ? 'is-vfl-laser-exit--glint' : 'is-vfl-laser-exit--cw');
      }
    });
  }

  function reapplyStoredVflGlow() {
    var glow = global.FtthLab && FtthLab._vflGlow;
    if (glow) applyLaserGlow(glow.pcords, glow.mode, { pcordExits: glow.pcordExits });
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
    /* Keep toolbox arm after place/select — only ESC / background / other tool clears it */
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
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('patch-cord');
      }
      selectedTool = 'patchcord';
      renderToolbox();
      setStatus('Patch Cord · click-and-hold End A or End B to drag — no auto-follow');
    });
    btn.addEventListener('dragstart', function (e) {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('patch-cord');
      }
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
    document.querySelectorAll(
      '.lab-fx-port.is-plug-target, .lab-cas-port.is-plug-target, .lab-cpl-port.is-plug-target, ' +
      '.lab-vfl-port.is-plug-target, .lab-opm-port.is-plug-target, .lab-ols-port.is-plug-target'
    ).forEach(function (n) { n.classList.remove('is-plug-target'); });
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
      fixedLength: null,
      lengthMode: 'free',
      lengthMeters: 3,
      relocating: false,
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
  var BOOT_EXIT_STUB = 10; /* first strain-relief marker past the tip */
  var STRAIN_RELIEF_PX = 22; /* total straight exit before curvature is allowed */
  var STRAIN_LEAD_PTS = 3; /* tip + 2 collinear relief points per end */
  var BODY_CLEAR_PX = END_H / 2 + 3;
  var HEADING_MIN_PX = 2.5; /* ignore micro jitter when updating live heading */
  var HEADING_SMOOTH = 0.42; /* blend factor toward new motion heading */
  /* Free-head upright cone: ±90° = full L/R, never ferrule-down (≈180°) */
  var HEADING_MAX_TILT_DEG = 90;
  var UNPLUG_PULL_PX = 36;
  var PLUG_SNAP_PX = 22;
  /** OLS-35 magnetic capture (screen px) — larger than generic port snap */
  var OLS_MAGNET_SNAP_PX = 56;
  /** Auto-click lock once magnetically seated */
  var OLS_MAGNET_LOCK_PX = 30;
  /** Base gravity sag (px); also scaled by end-to-end distance */
  var GRAVITY_OFFSET = 100;
  var GRAVITY_SAG_RATIO = 0.28;
  var GRAVITY_SAG_MIN = 24;
  var GRAVITY_SAG_MAX = 160;
  /** Slack factor when no user length is available (true catenary) */
  var CATENARY_DEFAULT_SLACK = 1.12;
  /** Dense samples for mathematically accurate mid-span */
  var CATENARY_SAMPLES = 48;
  /** Min world distance between recorded mouse-path samples (anti-jitter) */
  var TRACE_SAMPLE_PX = 14;
  var TRACE_MAX_POINTS = 180;
  var CHAIKIN_ITERATIONS = 2;
  /** Catmull-Rom densify: samples per segment when polishing free-hand ink */
  var SPLINE_SAMPLES_PER_SEG = 5;
  /** SVG Catmull handle divisor — lower = silkier mid-span (always cubic, never raw L) */
  var CATMULL_HANDLE_K = 3.8;
  /* ─── Mid-span rope / spring-damper (fully linked cords) ─── */
  var PHYS_SEGMENTS = 28;
  var PHYS_DAMPING = 0.9;
  var PHYS_REST_SPRING = 0.07;
  var PHYS_STRUCT_ITERS = 5;
  var PHYS_STRUCT_STRENGTH = 0.52;
  var PHYS_GRAB_SIGMA = 2.6; /* particle-index falloff for rubber pull */
  var PHYS_GRAB_NEIGHBOR = 0.62;
  var PHYS_RELEASE_KICK = 0.38; /* initial Verlet impulse toward rest */
  var PHYS_SUBSTEPS = 2;
  var PHYS_SETTLE_EPS = 0.55;
  var PHYS_MAX_SETTLE = 220;

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

  /** Clamp free-end CSS rotate into the upright hemisphere (ferrule never nose-down). */
  function clampUprightHeading(rotDeg) {
    if (global.FtthLab && typeof FtthLab.clampConnectorHeadingUpright === 'function') {
      return FtthLab.clampConnectorHeadingUpright(rotDeg, HEADING_MAX_TILT_DEG);
    }
    var a = Number(rotDeg);
    if (!isFinite(a)) return 0;
    a = ((a + 180) % 360 + 360) % 360 - 180;
    if (a > HEADING_MAX_TILT_DEG) return HEADING_MAX_TILT_DEG;
    if (a < -HEADING_MAX_TILT_DEG) return -HEADING_MAX_TILT_DEG;
    return a;
  }

  /** Unconstrained nose→motion degrees (used when choosing 0° vs 180° at plug). */
  function headingRotFromMotionRaw(dx, dy) {
    return Math.atan2(dx, -dy) * 180 / Math.PI;
  }

  /**
   * Free-drag heading: ferrule/nose leads along motion; boot trails opposite.
   * Left/right yaw stays smooth (±90°). Vertical downward motion is ignored
   * so the head stays upright instead of flipping to ~180° (nose-down).
   * Ferrule after rotate = (sin θ, −cos θ) ⇒ upright θ = 0.
   */
  function headingRotFromMotion(dx, dy) {
    if (global.FtthLab && typeof FtthLab.headingRotFromMotionUpright === 'function') {
      return FtthLab.headingRotFromMotionUpright(dx, dy, HEADING_MAX_TILT_DEG);
    }
    var ax = dx;
    var ay = dy > 0 ? 0 : dy;
    if (Math.abs(ax) < 1e-9 && Math.abs(ay) < 1e-9) return 0;
    return clampUprightHeading(Math.atan2(ax, -ay) * 180 / Math.PI);
  }

  /**
   * Strict vertical socket axis for OLT / splitter faceplates.
   * SC coupler barrel uses horizontal faces (A left / B right).
   * Top-mounted test gear (VFL / OLP-38 / OLS-35): always 180° so ferrule seats
   * downward into the adapter and the yellow cable exits straight up.
   */
  function portAlignedRotation(hit) {
    if (hit && hit.owner === 'coupler') {
      return hit.port === 'B' ? -90 : 90;
    }
    if (hit && (hit.owner === 'vfl' || hit.owner === 'opm' || hit.owner === 'ols')) {
      return 180;
    }
    if (hit && (hit.owner === 'splitter' ||
        (hit.el && hit.el.classList && hit.el.classList.contains('lab-cas-port')))) {
      return 180;
    }
    /* OLT / default: upright ferrule-up seat */
    return 0;
  }

  /** Test-equipment top ports never flip with approach direction. */
  function isTopTestPort(hit) {
    return !!(hit && (hit.owner === 'vfl' || hit.owner === 'opm' || hit.owner === 'ols'));
  }

  function olsMagnetRadius() {
    if (global.FtthLab && typeof FtthLab.getOlsMagnetSnapPx === 'function') {
      var n = Number(FtthLab.getOlsMagnetSnapPx());
      if (isFinite(n) && n > 0) return n;
    }
    return OLS_MAGNET_SNAP_PX;
  }

  function plugSnapRadiusFor(hit) {
    if (hit && hit.owner === 'ols') return olsMagnetRadius();
    return PLUG_SNAP_PX;
  }

  /** Refresh OLS hit to deep-seat metallic adapter center (ferrule flush inside). */
  function enrichOlsHitDeepSeat(hit) {
    if (!hit || hit.owner !== 'ols' || !hit.olsId) return hit;
    if (global.FtthLab && typeof FtthLab.getOlsPortWorld === 'function') {
      var pw = FtthLab.getOlsPortWorld(hit.olsId);
      if (pw) {
        hit.wx = pw.x;
        hit.wy = pw.y;
        hit.rot = 180;
        hit.deepSeat = true;
      }
    }
    return hit;
  }

  function olsPortScreenCenter(el) {
    if (!el) return null;
    var slot = el.querySelector('.lab-ols__adapter-slot, .lab-ols__sc-block') || el;
    var r = slot.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.25 };
  }

  /**
   * Magnetic OLS capture — proximity to metallic port even when cursor
   * is not directly over the hit-test element.
   */
  function findNearestOlsHit(clientX, clientY, maxPx) {
    maxPx = maxPx != null ? maxPx : olsMagnetRadius();
    var nodes = document.querySelectorAll('.lab-ols-port[data-ols-port]');
    var best = null;
    var bestD = maxPx;
    var i;
    for (i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var c = olsPortScreenCenter(node);
      if (!c) continue;
      var d = dist2(clientX, clientY, c.x, c.y);
      if (d <= bestD) {
        bestD = d;
        var olsId = node.getAttribute('data-ols-port');
        best = {
          owner: 'ols',
          olsId: olsId,
          polish: 'UPC',
          connectorType: 'SC',
          label: 'Viavi OLS-35 · SC adapter',
          el: node,
          screenDist: d,
        };
        enrichOlsHitDeepSeat(best);
      }
    }
    return best;
  }

  function resolvePlugHit(clientX, clientY) {
    var hit = hitTestPort(clientX, clientY);
    if (hit && hit.owner === 'ols') {
      enrichOlsHitDeepSeat(hit);
      var c = olsPortScreenCenter(hit.el);
      if (c) hit.screenDist = dist2(clientX, clientY, c.x, c.y);
      return hit;
    }
    var ols = findNearestOlsHit(clientX, clientY);
    if (ols) return ols;
    return hit;
  }

  /**
   * While dragging: pull connector into OLS deep seat + force vertical (180°).
   * Returns 'lock' when inside auto-click radius, 'pull' when in magnet zone, else null.
   */
  function applyOlsMagneticPull(cord, end, hit, clientX, clientY) {
    if (!hit || hit.owner !== 'ols' || !cord) return null;
    enrichOlsHitDeepSeat(hit);
    var c = olsPortScreenCenter(hit.el);
    var d = hit.screenDist != null
      ? hit.screenDist
      : (c ? dist2(clientX, clientY, c.x, c.y) : 9999);
    var magnet = olsMagnetRadius();
    if (d > magnet) return null;
    if (hit.el) hit.el.classList.add('is-plug-target');
    var side = cord[endKey(end)];
    side.liveRot = 180;
    seatEndAtPort(cord, end, hit.wx, hit.wy);
    updateFiberPath(cord);
    if (d <= OLS_MAGNET_LOCK_PX) return 'lock';
    return 'pull';
  }

  /** Vertical ports: pick 0° or 180°. Coupler: keep horizontal face axis. */
  function resolveUprightPlugRotation(hit, cord, end) {
    if (hit && hit.owner === 'coupler') return portAlignedRotation(hit);
    /* OPM / VFL / OLS: cable always exits upward — ignore approach vector */
    if (isTopTestPort(hit)) return 180;
    var base = portAlignedRotation(hit);
    var alt = base === 0 ? 180 : 0;
    var p = getEndWorld(cord, end);
    var dY = (hit && typeof hit.wy === 'number') ? (hit.wy - p.y) : 0;
    if (Math.abs(dY) < 1) return base;
    var preferred = headingRotFromMotionRaw(0, dY);
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
    if (typeof side.liveRot === 'number') {
      /* Exact ±180 is the top-port (OPM/VFL) dock preview — do not clamp */
      if (side.liveRot === 180 || side.liveRot === -180) return 180;
      return clampUprightHeading(side.liveRot);
    }
    var p = getEndWorld(cord, end);
    var o = end === 'A' ? { x: cord.bx, y: cord.by } : { x: cord.ax, y: cord.ay };
    /* Free idle: boot toward cable, but never flip ferrule nose-down */
    return clampUprightHeading(endRotationDeg(p.x, p.y, o.x, o.y));
  }

  /** Apply smoothed motion heading while an end is free / being dragged. */
  function updateLiveHeading(cord, end, dx, dy) {
    var side = cord[endKey(end)];
    if (!side || side.attached) return;
    if (dist2(0, 0, dx, dy) < HEADING_MIN_PX) return;
    var target = headingRotFromMotion(dx, dy);
    if (typeof side.liveRot === 'number') {
      side.liveRot = clampUprightHeading(
        lerpAngleDeg(side.liveRot, target, HEADING_SMOOTH)
      );
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

  /** Short outward stub past the boot tip (compat / recording). */
  function bootExitStub(cord, end) {
    var tip = bootAnchor(cord, end);
    var t = bootOutDir(getEndRotation(cord, end));
    return {
      x: tip.x + t.x * BOOT_EXIT_STUB,
      y: tip.y + t.y * BOOT_EXIT_STUB,
    };
  }

  /**
   * Strict strain-relief chain: tip → mid → outer, all on the port/boot axis.
   * Length adapts to connector facing so opposing boots do not fold the span.
   */
  function strainReliefChain(cord, end) {
    var tip = bootAnchor(cord, end);
    var t = bootOutDir(getEndRotation(cord, end));
    var u = unitVec(t.x, t.y);
    var otherTip = end === 'A' ? bootAnchor(cord, 'B') : bootAnchor(cord, 'A');
    var otherDir = bootOutDir(getEndRotation(cord, end === 'A' ? 'B' : 'A'));
    var uOther = unitVec(otherDir.x, otherDir.y);
    var parallel = bootsParallelSameWay(u, uOther);
    var outD = adaptiveBootStubLength(
      u,
      tip,
      otherTip,
      Math.max(STRAIN_RELIEF_PX, BOOT_EXIT_STUB),
      parallel
    );
    var midD = outD * 0.45;
    return [
      tip,
      { x: tip.x + u.x * midD, y: tip.y + u.y * midD },
      { x: tip.x + u.x * outD, y: tip.y + u.y * outD },
    ];
  }

  /** Cosine of boot-out vs tip→other: +1 faces peer, −1 faces away. */
  function bootFacesToward(bootDir, fromTip, toTip) {
    var dx = toTip.x - fromTip.x;
    var dy = toTip.y - fromTip.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    return (bootDir.x * dx + bootDir.y * dy) / len;
  }

  /** Same-direction boots: dot(tA, tB) ≈ +1 (both exit parallel). */
  function bootsParallelSameWay(tA, tB) {
    return tA.x * tB.x + tA.y * tB.y > 0.65;
  }

  /**
   * Tip→tip chord that never falls back to a fake vertical when tips coincide.
   * Prefer average boot axis (lateral) then screen-down.
   */
  function safeTipChord(tipA, tipB, tA, tB) {
    var dx = tipB.x - tipA.x;
    var dy = tipB.y - tipA.y;
    if (dx * dx + dy * dy > 4) return unitVec(dx, dy);
    var sx = (tA.x + tB.x) * 0.5;
    var sy = (tA.y + tB.y) * 0.5;
    if (sx * sx + sy * sy > 1e-6) return unitVec(sx, sy);
    return { x: 1, y: 0 };
  }

  /** Unit vector in the downward hemisphere, perpendicular to `along` (screen y+ down). */
  function hangPerp(along) {
    var p = unitVec(-along.y, along.x);
    if (p.y < 0) p = { x: -p.x, y: -p.y };
    if (p.x * p.x + p.y * p.y < 1e-8) p = { x: 0, y: 1 };
    return p;
  }

  /**
   * Strain-relief stub length along boot axis.
   * Full length when facing the peer; shortened when reversed/sideways so
   * stubs do not cross or collapse the mid-span chord.
   * Parallel same-way boots use short stubs (avoid past-end hairpins).
   */
  function adaptiveBootStubLength(bootDir, tip, otherTip, baseStub, parallelSame) {
    var span = dist2(tip.x, tip.y, otherTip.x, otherTip.y) || 1;
    var face = bootFacesToward(bootDir, tip, otherTip);
    var scale;
    if (face >= 0.35) scale = 1;
    else if (face >= 0) scale = 0.55 + 0.45 * (face / 0.35);
    else scale = Math.max(0.28, 0.45 + face * 0.35);
    if (global.FtthLab && typeof FtthLab.adaptiveFiberStubScale === 'function') {
      scale = FtthLab.adaptiveFiberStubScale(face);
    }
    if (parallelSame) scale = Math.min(scale, 0.42);
    var len = baseStub * scale;
    var cap = Math.max(BOOT_EXIT_STUB * 0.75, span * 0.28);
    if (parallelSame) cap = Math.min(cap, Math.max(BOOT_EXIT_STUB, span * 0.16));
    return Math.max(BOOT_EXIT_STUB * 0.45, Math.min(len, cap));
  }

  /**
   * Extra cable length (fraction of tip span) when boots face away / reverse /
   * run parallel — room for a natural hang or lateral service loop.
   */
  function opposingOrientationSlackFraction(tA, tB, tipA, tipB) {
    var faceA = bootFacesToward(tA, tipA, tipB);
    var faceB = bootFacesToward(tB, tipB, tipA);
    if (global.FtthLab && typeof FtthLab.opposingFiberSlackFraction === 'function') {
      var base = FtthLab.opposingFiberSlackFraction(faceA, faceB);
      if (bootsParallelSameWay(tA, tB)) base += 0.18;
      return base;
    }
    var away = 0;
    if (faceA < 0.25) away += (0.25 - faceA) * 0.22;
    if (faceB < 0.25) away += (0.25 - faceB) * 0.22;
    if (bootsParallelSameWay(tA, tB)) away += 0.18;
    return away;
  }

  /**
   * Place mid-span catenary anchors from boot stubs.
   * Parallel same-way: hang anchors under the tip chord (lateral loop) so the
   * far stub never extends past B and forces a hairpin backtrack.
   * Overlap: open a minimum-width downward service loop (no fake vertical axis).
   */
  function resolveOrientedCatenaryAnchors(tipA, tipB, tA, tB, stubA, stubB) {
    var span = dist2(tipA.x, tipA.y, tipB.x, tipB.y);
    var chord = safeTipChord(tipA, tipB, tA, tB);
    var parallel = bootsParallelSameWay(tA, tB);
    var overlapped = span < 18;
    var down = hangPerp(chord);
    var drop = Math.min(52, Math.max(22, (overlapped ? 40 : span * 0.2) + (parallel ? 10 : 0)));

    var p0 = {
      x: tipA.x + tA.x * stubA,
      y: tipA.y + tA.y * stubA,
    };
    var p3 = {
      x: tipB.x + tB.x * stubB,
      y: tipB.y + tB.y * stubB,
    };

    if (overlapped) {
      var halfW = Math.max(32, Math.max(stubA, stubB) * 1.4);
      var cx = (tipA.x + tipB.x) * 0.5;
      var cy = (tipA.y + tipB.y) * 0.5;
      p0 = {
        x: cx - chord.x * halfW + down.x * drop,
        y: cy - chord.y * halfW + down.y * drop,
      };
      p3 = {
        x: cx + chord.x * halfW + down.x * drop,
        y: cy + chord.y * halfW + down.y * drop,
      };
      return { p0: p0, p3: p3, collapsed: true, parallel: parallel, overlapped: true };
    }

    if (parallel) {
      /* Lateral service loop under both tips — short axial lead then drop */
      var along = Math.min(Math.max(span * 0.18, 12), span * 0.35);
      var lead = Math.min(stubA, BOOT_EXIT_STUB);
      var leadB = Math.min(stubB, BOOT_EXIT_STUB);
      p0 = {
        x: tipA.x + tA.x * lead + chord.x * along * 0.35 + down.x * drop,
        y: tipA.y + tA.y * lead + chord.y * along * 0.35 + down.y * drop,
      };
      p3 = {
        x: tipB.x + tB.x * leadB - chord.x * along * 0.35 + down.x * drop,
        y: tipB.y + tB.y * leadB - chord.y * along * 0.35 + down.y * drop,
      };
      /* Keep mid chord open and progressing tipA→tipB */
      var midLen = dist2(p0.x, p0.y, p3.x, p3.y);
      var progress = (p3.x - p0.x) * chord.x + (p3.y - p0.y) * chord.y;
      if (midLen < Math.max(24, span * 0.25) || progress < span * 0.15) {
        p0 = {
          x: tipA.x + chord.x * (span * 0.12) + down.x * drop,
          y: tipA.y + chord.y * (span * 0.12) + down.y * drop,
        };
        p3 = {
          x: tipB.x - chord.x * (span * 0.12) + down.x * drop,
          y: tipB.y - chord.y * (span * 0.12) + down.y * drop,
        };
      }
      return { p0: p0, p3: p3, collapsed: true, parallel: true, overlapped: false };
    }

    return stabilizeCatenaryAnchors(tipA, tipB, tA, tB, p0, p3, chord);
  }

  /** Pull mid-span anchors apart along a safe tip chord when stubs would cross. */
  function stabilizeCatenaryAnchors(tipA, tipB, tA, tB, p0, p3, chordOpt) {
    var span = dist2(tipA.x, tipA.y, tipB.x, tipB.y) || 1;
    var chord = chordOpt || safeTipChord(tipA, tipB, tA, tB);
    var midLen = dist2(p0.x, p0.y, p3.x, p3.y);
    var progress = (p3.x - p0.x) * chord.x + (p3.y - p0.y) * chord.y;
    var collapsed = midLen < Math.max(14, span * 0.18) || progress < span * 0.12;
    if (!collapsed) {
      return { p0: p0, p3: p3, collapsed: false, parallel: false, overlapped: false };
    }
    var down = hangPerp(chord);
    var drop = Math.min(36, Math.max(10, span * 0.16));
    var along = Math.min(STRAIN_RELIEF_PX, span * 0.22);
    var n0 = {
      x: tipA.x + chord.x * along + tA.x * (BOOT_EXIT_STUB * 0.55) + down.x * drop * 0.45,
      y: tipA.y + chord.y * along + tA.y * (BOOT_EXIT_STUB * 0.55) + down.y * drop * 0.45,
    };
    var n3 = {
      x: tipB.x - chord.x * along + tB.x * (BOOT_EXIT_STUB * 0.55) + down.x * drop * 0.45,
      y: tipB.y - chord.y * along + tB.y * (BOOT_EXIT_STUB * 0.55) + down.y * drop * 0.45,
    };
    return {
      p0: { x: p0.x * 0.25 + n0.x * 0.75, y: p0.y * 0.25 + n0.y * 0.75 },
      p3: { x: p3.x * 0.25 + n3.x * 0.75, y: p3.y * 0.25 + n3.y * 0.75 },
      collapsed: true,
      parallel: false,
      overlapped: false,
    };
  }

  function blendUnitTan(primary, secondary, weightPrimary) {
    var w = Math.max(0, Math.min(1, weightPrimary));
    return unitVec(
      primary.x * w + secondary.x * (1 - w),
      primary.y * w + secondary.y * (1 - w)
    );
  }

  function naturalCatenaryTangents(mid) {
    if (!mid || mid.length < 2) {
      return { inTan: { x: 1, y: 0 }, outTan: { x: 1, y: 0 } };
    }
    var a = mid[0];
    var b = mid[Math.min(2, mid.length - 1)];
    var c = mid[Math.max(0, mid.length - 3)];
    var d = mid[mid.length - 1];
    return {
      inTan: unitVec(b.x - a.x, b.y - a.y),
      outTan: unitVec(d.x - c.x, d.y - c.y),
    };
  }

  /**
   * Boot-tangent blend weight. Parallel / fighting tangents defer to the
   * catenary so cubic handles do not form S-cusps at the anchors.
   */
  function bootTangentBlendWeight(face, opts) {
    opts = opts || {};
    if (opts.parallel || opts.overlapped) {
      return Math.max(0.12, Math.min(0.38, 0.22 + Math.max(0, face) * 0.2));
    }
    if (face >= 0.4) return 0.92;
    if (face >= 0) return 0.55 + face * 0.7;
    return Math.max(0.18, 0.45 + face * 0.3);
  }

  /**
   * Soften an end tangent when it fights the natural catenary direction
   * (dot < 0) — prevents forced anti-chord handles on parallel layouts.
   */
  function reconcileEndTangent(desired, natural, preferBoot) {
    var nat = natural || desired;
    var des = desired || nat;
    var d = des.x * nat.x + des.y * nat.y;
    if (d >= 0.15) {
      return blendUnitTan(des, nat, preferBoot);
    }
    /* Fighting: keep mostly natural, tiny boot influence for soft join */
    return blendUnitTan(nat, des, 0.82);
  }

  /** True if a sample sits inside/near a connector body (would pierce housing if used). */
  function pointInsideConnectorBody(cord, end, x, y) {
    var c = getEndWorld(cord, end);
    return dist2(c.x, c.y, x, y) < BODY_CLEAR_PX;
  }

  /** Default sag depth guess from span (used only to pick slack when no user ink). */
  function catenarySagDepth(dist) {
    return Math.min(
      GRAVITY_SAG_MAX,
      Math.max(GRAVITY_SAG_MIN * 0.45, dist * GRAVITY_SAG_RATIO)
    );
  }

  /**
   * Solve catenary scale a from:
   *   2 a sinh(h / (2 a)) = v
   * where h = horizontal span, v = sqrt(L² − Δy²) (physics / y-up frame).
   */
  function solveCatenaryA(h, v) {
    h = Math.abs(h);
    if (h < 1e-8 || v < h * 1.0000001) {
      /* Nearly taut — a → ∞; return large a for a near-straight span */
      return Math.max(h * 50, 1e6);
    }
    /* Initial guess from series: sinh(z)≈z+z³/6 ⇒ a ≈ h / sqrt(24*(v/h - 1)) */
    var r = v / h;
    var a = r > 1.0001
      ? h / Math.sqrt(Math.max(1e-8, 24 * (r - 1)))
      : h * 10;
    if (!isFinite(a) || a <= 0) a = h;
    var i;
    for (i = 0; i < 28; i++) {
      var half = h / (2 * a);
      if (half > 50) {
        a *= 2;
        continue;
      }
      var sh = Math.sinh(half);
      var ch = Math.cosh(half);
      var f = 2 * a * sh - v;
      var df = 2 * sh - (h / a) * ch;
      if (Math.abs(df) < 1e-14) break;
      var next = a - f / df;
      if (next <= 0 || !isFinite(next)) next = a * 0.5;
      if (Math.abs(next - a) < 1e-9 * Math.max(1, a)) {
        a = next;
        break;
      }
      a = next;
    }
    return Math.max(a, 1e-4);
  }

  /**
   * Fit y = y0 + a·cosh((x − x0)/a) through two endpoints with cable length L.
   * Coordinates are physics-frame (Y positive UP).
   * Near-vertical spans (|Δx| tiny) return a flag so the sampler can use a
   * chord-parameterized hang instead of a fake 0.75px x-nudge.
   */
  function fitCatenaryParamsYUp(x1, y1, x2, y2, length) {
    var h = x2 - x1;
    var v = y2 - y1;
    var chord = Math.sqrt(h * h + v * v) || 1;
    var L = Math.max(length, chord * 1.0002);
    var absH = Math.abs(h);
    if (absH < 8) {
      return {
        a: Math.max(chord * 0.35, 1),
        x0: 0.5 * (x1 + x2),
        y0: Math.min(y1, y2) - Math.max(chord * 0.2, 8),
        L: L,
        x1: x1,
        x2: x2,
        degenerateX: true,
      };
    }
    var span = Math.sqrt(L * L - v * v);
    if (!isFinite(span) || span < absH) {
      L = Math.sqrt(absH * absH + v * v) * 1.0002;
      span = Math.sqrt(Math.max(0, L * L - v * v));
    }
    var a = solveCatenaryA(absH, span);
    /* Vertex x-offset for unequal supports:
       x0 = ½ (x1 + x2 − a ln((L+v)/(L−v))) */
    var lv = Math.max(L - Math.abs(v), 1e-9);
    var x0 = 0.5 * (x1 + x2 - a * Math.log((L + v) / (L - v)));
    if (!isFinite(x0)) x0 = 0.5 * (x1 + x2);
    var y0 = y1 - a * Math.cosh((x1 - x0) / a);
    if (!isFinite(y0)) y0 = Math.min(y1, y2) - a;
    return { a: a, x0: x0, y0: y0, L: L, x1: x1, x2: x2, degenerateX: false };
  }

  /** Evaluate physics-frame catenary Y_up at horizontal x. */
  function evalCatenaryYUp(params, x) {
    return params.y0 + params.a * Math.cosh((x - params.x0) / params.a);
  }

  /**
   * Chord-parameterized downward hang for near-vertical / tiny-Δx spans.
   * Avoids the old fake horizontal cosh nudge that created parallel folds.
   */
  function sampleParametricHang(p0, p3, length, count) {
    count = Math.max(2, count || CATENARY_SAMPLES);
    var dx = p3.x - p0.x;
    var dy = p3.y - p0.y;
    var chord = Math.sqrt(dx * dx + dy * dy) || 1;
    var L = Math.max(length || chord * CATENARY_DEFAULT_SLACK, chord * 1.0002);
    var excess = Math.max(0, L - chord);
    var sag = Math.sqrt(Math.max(0, excess * chord * 0.5)) * 0.55;
    if (sag < 10) sag = Math.min(56, Math.max(14, chord * 0.38 + excess * 0.35));
    var pts = [];
    var i;
    for (i = 0; i < count; i++) {
      var t = count === 1 ? 0.5 : i / (count - 1);
      var drop = 4 * sag * t * (1 - t);
      pts.push({
        x: p0.x + dx * t,
        y: p0.y + dy * t + drop,
      });
    }
    pts[0] = { x: p0.x, y: p0.y };
    pts[count - 1] = { x: p3.x, y: p3.y };
    return enforceDownwardSag(pts);
  }

  /**
   * Sample a hanging span between screen-space points (y+ down).
   * Uses true cosh when |Δx| is healthy; otherwise a parametric hang.
   */
  function sampleTrueCatenary(p0, p3, length, count) {
    count = Math.max(2, count || CATENARY_SAMPLES);
    var chord = dist2(p0.x, p0.y, p3.x, p3.y) || 1;
    var L = Math.max(length || chord * CATENARY_DEFAULT_SLACK, chord * 1.0002);
    if (Math.abs(p3.x - p0.x) < 8) {
      return sampleParametricHang(p0, p3, L, count);
    }
    var x1 = p0.x;
    var x2 = p3.x;
    var y1up = -p0.y;
    var y2up = -p3.y;
    var params = fitCatenaryParamsYUp(x1, y1up, x2, y2up, L);
    if (params.degenerateX) {
      return sampleParametricHang(p0, p3, L, count);
    }
    /* a must stay positive so cosh hangs down in Y-up (= +Y sag on screen) */
    if (!(params.a > 0)) params.a = Math.abs(params.a) || 1;
    var pts = [];
    var i;
    for (i = 0; i < count; i++) {
      var t = count === 1 ? 0.5 : i / (count - 1);
      var x = x1 + (params.x2 - params.x1) * t;
      var yUp = evalCatenaryYUp(params, x);
      pts.push({ x: x, y: -yUp });
    }
    /* Exact endpoint lock (numeric cosh drift) */
    pts[0] = { x: p0.x, y: p0.y };
    pts[pts.length - 1] = { x: p3.x, y: p3.y };
    return enforceDownwardSag(pts);
  }

  /** Max drop below chord for a candidate length (screen y+ down). */
  function catenarySagForLength(p0, p3, length) {
    return routeSagDepth(sampleTrueCatenary(p0, p3, length, 36));
  }

  /**
   * Cable length whose true catenary reaches at least targetSag below the chord.
   */
  function catenaryLengthForSag(p0, p3, targetSag) {
    var chord = dist2(p0.x, p0.y, p3.x, p3.y) || 1;
    if (targetSag < 1) return chord * 1.002;
    var lo = chord * 1.0005;
    var hi = chord + Math.max(targetSag * 3.5, chord * 0.15);
    var guard = 0;
    while (catenarySagForLength(p0, p3, hi) < targetSag && guard < 18) {
      hi = chord + (hi - chord) * 1.35;
      guard += 1;
    }
    var i;
    for (i = 0; i < 26; i++) {
      var mid = (lo + hi) * 0.5;
      if (catenarySagForLength(p0, p3, mid) < targetSag) lo = mid;
      else hi = mid;
    }
    return (lo + hi) * 0.5;
  }

  /**
   * Fit a true catenary between relief tips using the user's drawn length and
   * sag depth (L ≥ user length and L ≥ length needed for user sag).
   * Returns mid-span points only (endpoints supplied by strain-relief chains).
   */
  function fitTrueCatenaryFromUser(p0, p3, route, count) {
    count = count || CATENARY_SAMPLES;
    var poly = [{ x: p0.x, y: p0.y }]
      .concat(route || [])
      .concat([{ x: p3.x, y: p3.y }]);
    var chord = dist2(p0.x, p0.y, p3.x, p3.y) || 1;
    var userLen = Math.max(polylineLength(poly), chord * 1.002);
    var userSag = routeSagDepth(poly);
    var L = userLen;
    if (userSag > 2) {
      L = Math.max(L, catenaryLengthForSag(p0, p3, userSag));
    } else {
      L = Math.max(L, chord * CATENARY_DEFAULT_SLACK);
    }
    L = Math.min(L, chord * 6);
    var full = sampleTrueCatenary(p0, p3, L, count);
    return full.slice(1, -1);
  }

  /** Default hanging span (no user ink) via true catenary + distance-scaled slack. */
  function naturalCatenarySamples(p0, p3, count) {
    var chord = dist2(p0.x, p0.y, p3.x, p3.y) || 1;
    var sag = catenarySagDepth(chord);
    var L = Math.max(
      chord * CATENARY_DEFAULT_SLACK,
      catenaryLengthForSag(p0, p3, sag)
    );
    return sampleTrueCatenary(p0, p3, L, count || CATENARY_SAMPLES);
  }

  /**
   * Fixed-length mid-span: always a true catenary.
   * Excess length (L > chord) becomes deeper downward gravitational sag — never loops.
   */
  function sampleFixedLengthSpan(p0, p3, lengthPx, count) {
    return sampleTrueCatenary(p0, p3, lengthPx, count);
  }

  function polylineLength(pts) {
    if (!pts || pts.length < 2) return 0;
    var len = 0;
    var i;
    for (i = 1; i < pts.length; i++) {
      len += dist2(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
    }
    return len;
  }

  /**
   * Max drop below the end-to-end chord (y+ down) — measures user sag depth.
   */
  function routeSagDepth(pts) {
    if (!pts || pts.length < 3) return 0;
    var a = pts[0];
    var b = pts[pts.length - 1];
    var dy = b.y - a.y;
    var cum = [0];
    var i;
    for (i = 1; i < pts.length; i++) {
      cum[i] = cum[i - 1] + dist2(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
    }
    var total = cum[cum.length - 1] || 1;
    var sag = 0;
    for (i = 1; i < pts.length - 1; i++) {
      var t = cum[i] / total;
      var cy = a.y + dy * t;
      var drop = pts[i].y - cy;
      if (drop > sag) sag = drop;
    }
    return sag;
  }

  /**
   * Gravity lock (screen y+ down): mid-span may never rise above the end-to-end
   * chord. Any upward bulge is mirrored to a positive downward offset.
   */
  function enforceDownwardSag(pts) {
    if (!pts || pts.length < 3) return pts ? pts.slice() : [];
    var a = pts[0];
    var b = pts[pts.length - 1];
    var n = pts.length;
    var out = new Array(n);
    out[0] = { x: a.x, y: a.y };
    out[n - 1] = { x: b.x, y: b.y };
    var i;
    for (i = 1; i < n - 1; i++) {
      var t = i / (n - 1);
      var cy = a.y + (b.y - a.y) * t;
      var y = pts[i].y;
      var drop = y - cy; /* >0 = below chord (gravity OK) */
      if (drop < 0) {
        /* Upward inversion — flip to equal downward sag */
        y = cy - drop;
      }
      out[i] = { x: pts[i].x, y: y };
    }
    return out;
  }

  /** Uniform Catmull-Rom sample on segment p1→p2 (t in [0,1]). */
  function catmullRomPoint(p0, p1, p2, p3, t) {
    var t2 = t * t;
    var t3 = t2 * t;
    return {
      x: 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
      ),
      y: 0.5 * (
        (2 * p1.y) +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
      ),
    };
  }

  /**
   * Densify an open polyline with Catmull-Rom samples that pass through every
   * waypoint — used for live free-hand polish before catenary lock.
   */
  function catmullRomResample(pts, samplesPerSeg) {
    if (!pts || pts.length < 2) return pts ? pts.slice() : [];
    if (pts.length === 2) {
      return samplePolyline(pts, Math.max(2, samplesPerSeg + 1));
    }
    samplesPerSeg = Math.max(2, samplesPerSeg || SPLINE_SAMPLES_PER_SEG);
    var out = [];
    var segs = pts.length - 1;
    var i;
    var s;
    for (i = 0; i < segs; i++) {
      var p0 = pts[i === 0 ? 0 : i - 1];
      var p1 = pts[i];
      var p2 = pts[i + 1];
      var p3 = pts[i + 2 < pts.length ? i + 2 : pts.length - 1];
      for (s = 0; s < samplesPerSeg; s++) {
        if (i > 0 && s === 0) continue;
        out.push(catmullRomPoint(p0, p1, p2, p3, s / samplesPerSeg));
      }
    }
    var last = pts[pts.length - 1];
    out.push({ x: last.x, y: last.y });
    return out;
  }

  /**
   * After any shrink-prone polish, restore chord-relative sag + path length
   * so the cable keeps the user's drawn depth instead of collapsing shallow.
   */
  function restoreRouteMetrics(smoothed, reference) {
    if (!smoothed || smoothed.length < 3 || !reference || reference.length < 2) {
      return smoothed;
    }
    var targetSag = routeSagDepth(reference);
    var targetLen = polylineLength(reference);
    var curSag = routeSagDepth(smoothed);
    var a = smoothed[0];
    var b = smoothed[smoothed.length - 1];
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var cum = [0];
    var i;
    for (i = 1; i < smoothed.length; i++) {
      cum[i] = cum[i - 1] + dist2(
        smoothed[i - 1].x, smoothed[i - 1].y,
        smoothed[i].x, smoothed[i].y
      );
    }
    var total = cum[cum.length - 1] || 1;
    var sagScale = curSag > 1e-3 ? targetSag / curSag : 1;
    if (sagScale > 0.99 && sagScale < 1.01 && Math.abs(polylineLength(smoothed) - targetLen) < 4) {
      return smoothed;
    }
    var out = [{ x: a.x, y: a.y }];
    for (i = 1; i < smoothed.length - 1; i++) {
      var t = cum[i] / total;
      var cx = a.x + dx * t;
      var cy = a.y + dy * t;
      var p = smoothed[i];
      var ox = p.x - cx;
      var oy = p.y - cy;
      /* Never restore an upward bulge — force positive downward offset */
      if (oy < 0) oy = -oy;
      out.push({
        x: cx + ox * sagScale,
        y: cy + oy * sagScale,
      });
    }
    out.push({ x: b.x, y: b.y });
    var newLen = polylineLength(out);
    if (newLen > 1e-3 && targetLen > 1e-3) {
      var lenScale = targetLen / newLen;
      if (Math.abs(lenScale - 1) > 0.02 && Math.abs(lenScale - 1) < 0.45) {
        var mid = [];
        mid.push({ x: a.x, y: a.y });
        for (i = 1; i < out.length - 1; i++) {
          var tt = cum[i] / total;
          var bx = a.x + dx * tt;
          var by = a.y + dy * tt;
          var mx = out[i].x - bx;
          var my = out[i].y - by;
          if (my < 0) my = -my;
          mid.push({
            x: bx + mx * lenScale,
            y: by + my * lenScale,
          });
        }
        mid.push({ x: b.x, y: b.y });
        return enforceDownwardSag(mid);
      }
    }
    return enforceDownwardSag(out);
  }

  function ensureRoute(cord) {
    if (!cord.route) cord.route = [];
    return cord.route;
  }

  /**
   * Record the mouse trail while the free end is dragged (first-time routing only).
   * Relocate / fixed-length mode never appends — length stays locked.
   */
  function appendRoutePoint(cord, x, y) {
    if (!cord || cord.pathLocked || cord.relocating) return false;
    if (typeof cord.fixedLength === 'number') return false;
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

  /** Drop near-duplicate vertices before spline polish (keeps endpoints). */
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
   * Softens jagged hand-drawn corners — may shorten; pair with restoreRouteMetrics.
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

  /**
   * Polish user ink: simplify jitter → Catmull-Rom densify (shape/depth kept).
   * Optional light Chaikin + metric restore for extra silk without shallow collapse.
   */
  function smoothDrawnRoute(cord, opts) {
    opts = opts || {};
    if (!cord || (cord.pathLocked && !opts.force)) return;
    var route = ensureRoute(cord);
    if (route.length < 2) return;
    var reference = route.map(function (p) {
      return { x: p.x, y: p.y };
    });
    route = simplifyRouteMinDist(route, TRACE_SAMPLE_PX * 0.65);
    if (route.length < 2) {
      cord.route = reference;
      return;
    }
    var perSeg = opts.samplesPerSeg != null ? opts.samplesPerSeg : SPLINE_SAMPLES_PER_SEG;
    route = catmullRomResample(route, perSeg);
    var chaikinIters = opts.iterations != null ? opts.iterations : 0;
    if (chaikinIters > 0 && route.length >= 3) {
      route = chaikinSmooth(route, Math.min(chaikinIters, 2));
      route = restoreRouteMetrics(route, reference);
    }
    if (route.length > TRACE_MAX_POINTS) {
      route = downsampleRoute(route, TRACE_MAX_POINTS);
      route = restoreRouteMetrics(route, reference);
    }
    cord.route = route;
  }

  /**
   * Arc length of current span from strain-relief tip A → route → tip B.
   */
  function measureCableSpanLength(cord) {
    if (!cord) return 0;
    var ends = reliefSpanEnds(cord);
    var poly = [{ x: ends.a.x, y: ends.a.y }]
      .concat(ensureRoute(cord))
      .concat([{ x: ends.b.x, y: ends.b.y }]);
    var chord = dist2(ends.a.x, ends.a.y, ends.b.x, ends.b.y) || 1;
    return Math.max(polylineLength(poly), chord * 1.002);
  }

  /**
   * Resolve the immutable cable length for catenary fitting.
   * Never grows on relocate; only set once on first full connect.
   */
  function resolveFixedCableLength(cord, p0, p3, route) {
    var chord = dist2(p0.x, p0.y, p3.x, p3.y) || 1;
    if (isMeterMode(cord)) {
      cord.lengthMeters = normalizeLengthMeters(cord.lengthMeters || 3);
      cord.fixedLength = metersToPx(cord.lengthMeters);
      if (chord >= cord.fixedLength) return chord * 1.0002;
      return cord.fixedLength;
    }
    if (typeof cord.fixedLength === 'number' && cord.fixedLength > 0) {
      if (chord >= cord.fixedLength) return chord * 1.0002; /* taut — ports at max reach */
      return cord.fixedLength;
    }
    var poly = [{ x: p0.x, y: p0.y }].concat(route || []).concat([{ x: p3.x, y: p3.y }]);
    var userLen = Math.max(polylineLength(poly), chord * 1.002);
    var userSag = routeSagDepth(poly);
    var L = userLen;
    if (userSag > 2) L = Math.max(L, catenaryLengthForSag(p0, p3, userSag));
    else L = Math.max(L, chord * CATENARY_DEFAULT_SLACK);
    L = Math.min(L, chord * 6);
    cord.fixedLength = L;
    return L;
  }

  /** Keep free connector within fixedLength of the anchored relief tip. */
  function clampFreeEndToFixedLength(cord, freeEnd) {
    if (!cord || typeof cord.fixedLength !== 'number') return;
    var other = oppositeEnd(freeEnd);
    if (!cord[endKey(other)].attached) return;
    var L = cord.fixedLength;
    var anchTip = bootAnchor(cord, other);
    var freeTip = bootAnchor(cord, freeEnd);
    var dx = freeTip.x - anchTip.x;
    var dy = freeTip.y - anchTip.y;
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    if (d <= L * 0.999) return;
    var s = (L * 0.998) / d;
    var newTipX = anchTip.x + dx * s;
    var newTipY = anchTip.y + dy * s;
    var t = bootOutDir(getEndRotation(cord, freeEnd));
    setEndWorld(
      cord,
      freeEnd,
      newTipX - t.x * BOOT_EXIT_OFFSET,
      newTipY - t.y * BOOT_EXIT_OFFSET
    );
  }

  /**
   * Rebuild mid-span as a true catenary at the cord's locked length (tether preview).
   */
  function rebuildFixedLengthCatenary(cord) {
    if (!cord || typeof cord.fixedLength !== 'number') return;
    var ends = reliefSpanEnds(cord);
    var chord = dist2(ends.a.x, ends.a.y, ends.b.x, ends.b.y) || 1;
    var L = cord.fixedLength;
    if (chord >= L) L = chord * 1.0002;
    var full = sampleFixedLengthSpan(ends.a, ends.b, L, CATENARY_SAMPLES);
    cord.route = full.slice(1, -1);
    cord.pathLocked = true;
  }

  /** Slack used when laying out Meter Mode free/semi-bound spans (more = deeper sag). */
  var METER_SAG_SLACK = 1.32;

  /** Chord length that leaves a strong share of L for downward catenary sag. */
  function meterChordTarget(L) {
    L = Math.max(Number(L) || 0, 12);
    /* ~24% of length reserved for hang — small meter steps read as deeper sag */
    var chord = L / METER_SAG_SLACK;
    if (chord > L * 0.88) chord = L * 0.82;
    if (chord < 20) chord = Math.min(L * 0.85, Math.max(16, L - 8));
    return chord;
  }

  /** Place connector so its boot tip sits at (tipX, tipY) with boot aimed at aim. */
  function seatBootTipAt(cord, end, tipX, tipY, aimX, aimY) {
    var side = cord[endKey(end)];
    if (!side.attached) {
      side.liveRot = clampUprightHeading(endRotationDeg(tipX, tipY, aimX, aimY));
    }
    var t = bootOutDir(getEndRotation(cord, end));
    setEndWorld(
      cord,
      end,
      tipX - t.x * BOOT_EXIT_OFFSET,
      tipY - t.y * BOOT_EXIT_OFFSET
    );
  }

  /**
   * Meter Mode layout for any plug state:
   *  - both plugged → deepen/shallow catenary sag between fixed ports
   *  - one free → extend/retract free-tail vector, then hang at full L
   *  - both free → scale A↔B span, then hang at full L
   */
  function layoutMeterLengthGeometry(cord) {
    if (!cord || typeof cord.fixedLength !== 'number') return;
    var L = cord.fixedLength;
    var aOn = !!cord.sideA.attached;
    var bOn = !!cord.sideB.attached;
    var chordTarget = meterChordTarget(L);

    if (aOn && bOn) {
      rebuildFixedLengthCatenary(cord);
      return;
    }

    if (aOn !== bOn) {
      var freeEnd = aOn ? 'B' : 'A';
      var fixedEnd = aOn ? 'A' : 'B';
      var anch = bootAnchor(cord, fixedEnd);
      var freeTip = bootAnchor(cord, freeEnd);
      var dx = freeTip.x - anch.x;
      var dy = freeTip.y - anch.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      var ux;
      var uy;
      if (d < 10) {
        var out = bootOutDir(getEndRotation(cord, fixedEnd));
        ux = out.x;
        uy = out.y;
      } else {
        ux = dx / d;
        uy = dy / d;
      }
      seatBootTipAt(
        cord,
        freeEnd,
        anch.x + ux * chordTarget,
        anch.y + uy * chordTarget,
        anch.x,
        anch.y
      );
      rebuildFixedLengthCatenary(cord);
      return;
    }

    /* Both free — grow/shrink along current A→B axis about midpoint */
    var tipA = bootAnchor(cord, 'A');
    var tipB = bootAnchor(cord, 'B');
    var mx = (tipA.x + tipB.x) * 0.5;
    var my = (tipA.y + tipB.y) * 0.5;
    var abx = tipB.x - tipA.x;
    var aby = tipB.y - tipA.y;
    var abd = Math.sqrt(abx * abx + aby * aby);
    var ux2;
    var uy2;
    if (abd < 10) {
      ux2 = 0;
      uy2 = 1;
    } else {
      ux2 = abx / abd;
      uy2 = aby / abd;
    }
    var half = chordTarget * 0.5;
    seatBootTipAt(cord, 'A', mx - ux2 * half, my - uy2 * half, mx + ux2 * half, my + uy2 * half);
    seatBootTipAt(cord, 'B', mx + ux2 * half, my + uy2 * half, mx - ux2 * half, my - uy2 * half);
    rebuildFixedLengthCatenary(cord);
  }

  function applyMeterLengthToCord(cord) {
    if (!cord || !isMeterMode(cord)) return;
    cord.lengthMeters = normalizeLengthMeters(cord.lengthMeters || 3);
    cord.fixedLength = metersToPx(cord.lengthMeters);
    cord.pathLocked = true;
    cord.relocating = false;
    syncAttachedPositions(cord);
    layoutMeterLengthGeometry(cord);
  }

  function setLengthMode(id, mode) {
    var cord = findCord(id);
    if (!cord) return;
    mode = mode === 'meter' ? 'meter' : 'free';
    if (cord.lengthMode === mode) {
      updateInspector();
      return;
    }
    cord.lengthMode = mode;
    clearRopePhysics(cord.id);
    if (mode === 'meter') {
      if (typeof cord.lengthMeters !== 'number') {
        cord.lengthMeters = typeof cord.fixedLength === 'number'
          ? normalizeLengthMeters(pxToMeters(cord.fixedLength))
          : 3;
      }
      applyMeterLengthToCord(cord);
      setStatus(
        'Meter Mode · ' + cord.lengthMeters + ' m · mid-span drag disabled · excess length → deeper sag'
      );
    } else {
      /* Free Draw — keep physical length if known; restore hanging catenary */
      if (typeof cord.fixedLength === 'number' &&
          cord.sideA.attached && cord.sideB.attached) {
        var ends = reliefSpanEnds(cord);
        var chord = dist2(ends.a.x, ends.a.y, ends.b.x, ends.b.y) || 1;
        var L = cord.fixedLength;
        if (chord >= L) L = chord * 1.0002;
        var full = sampleTrueCatenary(ends.a, ends.b, L, CATENARY_SAMPLES);
        cord.route = full.slice(1, -1);
        cord.pathLocked = true;
      }
      setStatus('Free Draw · drag ends to route · stretch mid-span when both ports are linked');
    }
    rebuildLayer();
    updateInspector();
    pushHistory();
  }

  function setLengthMeters(id, meters) {
    var cord = findCord(id);
    if (!cord) return;
    cord.lengthMode = 'meter';
    cord.lengthMeters = normalizeLengthMeters(meters);
    clearRopePhysics(cord.id);
    applyMeterLengthToCord(cord);
    /* Instant canvas update — geometry already rebuilt above */
    rebuildLayer();
    updateFiberPath(cord);
    updateInspector();
    pushHistory();
    setStatus('Cable length · ' + cord.lengthMeters + ' m');
  }

  /** True if both seated relief tips fit within the locked cable length. */
  function spanFitsFixedLength(cord) {
    if (typeof cord.fixedLength !== 'number') return true;
    var ends = reliefSpanEnds(cord);
    var chord = dist2(ends.a.x, ends.a.y, ends.b.x, ends.b.y) || 0;
    return chord <= cord.fixedLength * 0.998;
  }

  /**
   * Full connection: fit true catenary between strain-relief tips at fixedLength.
   * First connect captures length; relocates reuse it — never accumulate.
   */
  function lockDrawnPath(cord) {
    if (!cord) return;
    cord.pathLocked = false;
    var aChain = strainReliefChain(cord, 'A');
    var bChain = strainReliefChain(cord, 'B');
    var aOuter = aChain[aChain.length - 1];
    var bOuter = bChain[bChain.length - 1];
    var route = ensureRoute(cord);
    var L = resolveFixedCableLength(
      cord,
      aOuter,
      bOuter,
      route.length ? route : null
    );
    var full = sampleFixedLengthSpan(aOuter, bOuter, L, CATENARY_SAMPLES, cord);
    cord.route = full.slice(1, -1);
    if (cord.route.length > TRACE_MAX_POINTS) {
      cord.route = downsampleRoute(cord.route, TRACE_MAX_POINTS);
    }
    cord.pathLocked = true;
    cord.relocating = false;
  }

  function clearRopePhysics(cordId) {
    if (!cordId || !ropePhysics[cordId]) return;
    ropePhysics[cordId].settling = false;
    delete ropePhysics[cordId];
  }

  function clearAllRopePhysics() {
    Object.keys(ropePhysics).forEach(function (id) {
      ropePhysics[id].settling = false;
    });
    ropePhysics = {};
    if (physRafId) {
      cancelAnimationFrame(physRafId);
      physRafId = 0;
    }
  }

  function reliefSpanEnds(cord) {
    var aChain = strainReliefChain(cord, 'A');
    var bChain = strainReliefChain(cord, 'B');
    return {
      a: aChain[aChain.length - 1],
      b: bChain[bChain.length - 1],
    };
  }

  /** Evenly resample a polyline to n points (arc-length). */
  function samplePolyline(pts, n) {
    if (!pts || pts.length < 2 || n < 2) return pts ? pts.slice() : [];
    var cum = [0];
    var i;
    for (i = 1; i < pts.length; i++) {
      cum[i] = cum[i - 1] + dist2(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
    }
    var total = cum[cum.length - 1] || 1;
    var out = [];
    for (var k = 0; k < n; k++) {
      var target = (k / (n - 1)) * total;
      var j = 1;
      while (j < cum.length - 1 && cum[j] < target) j += 1;
      var seg = cum[j] - cum[j - 1] || 1;
      var t = (target - cum[j - 1]) / seg;
      out.push({
        x: pts[j - 1].x + (pts[j].x - pts[j - 1].x) * t,
        y: pts[j - 1].y + (pts[j].y - pts[j - 1].y) * t,
      });
    }
    return out;
  }

  function refreshRopeRest(cord, rope) {
    /* Prefer the user's / pre-stretch shape; only fall back to catenary if empty */
    if (rope.grabBase && rope.grabBase.length === rope.particles.length) {
      bindRopeRestToPoints(rope, rope.grabBase);
      return;
    }
    var ends = reliefSpanEnds(cord);
    var shaped = [];
    var route = ensureRoute(cord);
    if (route.length >= 1) {
      shaped = samplePolyline(
        [{ x: ends.a.x, y: ends.a.y }].concat(route).concat([{ x: ends.b.x, y: ends.b.y }]),
        rope.particles.length
      );
    } else {
      shaped = naturalCatenarySamples(ends.a, ends.b, rope.particles.length);
    }
    bindRopeRestToPoints(rope, shaped);
  }

  function bindRopeRestToPoints(rope, pts) {
    if (!rope || !pts || pts.length !== rope.particles.length) return;
    var i;
    for (i = 0; i < pts.length; i++) {
      rope.particles[i].ox = pts[i].x;
      rope.particles[i].oy = pts[i].y;
    }
    for (i = 0; i < pts.length - 1; i++) {
      rope.lens[i] = dist2(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) || 1;
    }
  }

  function buildRopeFromCord(cord) {
    var ends = reliefSpanEnds(cord);
    var n = PHYS_SEGMENTS;
    var route = ensureRoute(cord);
    var poly;
    if (route.length >= 1) {
      poly = samplePolyline(
        [{ x: ends.a.x, y: ends.a.y }].concat(route).concat([{ x: ends.b.x, y: ends.b.y }]),
        n
      );
    } else {
      poly = naturalCatenarySamples(ends.a, ends.b, n);
    }
    /* Rest pose = current custom span (not a shallow default catenary) */
    var rest = poly.map(function (p) {
      return { x: p.x, y: p.y };
    });
    var particles = [];
    var lens = [];
    var i;
    for (i = 0; i < n; i++) {
      particles.push({
        x: poly[i].x,
        y: poly[i].y,
        px: poly[i].x,
        py: poly[i].y,
        ox: rest[i].x,
        oy: rest[i].y,
        pinned: i === 0 || i === n - 1,
      });
    }
    for (i = 0; i < n - 1; i++) {
      /* Prefer live span lengths while stretching; settle retargets to rest shape */
      lens.push(dist2(poly[i].x, poly[i].y, poly[i + 1].x, poly[i + 1].y) || 1);
    }
    return {
      particles: particles,
      lens: lens,
      grabIdx: -1,
      grabBase: null,
      settling: false,
      frames: 0,
    };
  }

  function writeRopeToRoute(cord, rope) {
    var ends = reliefSpanEnds(cord);
    var mid = [];
    var i;
    for (i = 1; i < rope.particles.length - 1; i++) {
      mid.push({ x: rope.particles[i].x, y: rope.particles[i].y });
    }
    var full = enforceDownwardSag(
      [{ x: ends.a.x, y: ends.a.y }].concat(mid).concat([{ x: ends.b.x, y: ends.b.y }])
    );
    cord.route = full.slice(1, -1);
    cord.pathLocked = true;
  }

  function pinRopeEnds(cord, rope) {
    var ends = reliefSpanEnds(cord);
    var a = rope.particles[0];
    var b = rope.particles[rope.particles.length - 1];
    a.x = a.px = ends.a.x;
    a.y = a.py = ends.a.y;
    b.x = b.px = ends.b.x;
    b.y = b.py = ends.b.y;
  }

  function findNearestRopeIndex(rope, wx, wy) {
    var best = 1;
    var bestD = Infinity;
    var i;
    for (i = 1; i < rope.particles.length - 1; i++) {
      var p = rope.particles[i];
      var d = dist2(p.x, p.y, wx, wy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** Elastic rubber-band pull from pre-grab snapshot toward the pointer. */
  function applyRopeGrab(rope, wx, wy) {
    var g = rope.grabIdx;
    var base = rope.grabBase;
    if (g < 0 || !base) return;
    var dx = wx - base[g].x;
    var dy = wy - base[g].y;
    var sigma = PHYS_GRAB_SIGMA;
    var i;
    for (i = 1; i < rope.particles.length - 1; i++) {
      var w = Math.exp(-((i - g) * (i - g)) / (2 * sigma * sigma));
      var pull = i === g ? 1 : w * PHYS_GRAB_NEIGHBOR;
      var p = rope.particles[i];
      p.x = base[i].x + dx * pull;
      p.y = base[i].y + dy * pull;
      p.px = p.x;
      p.py = p.y;
    }
    /* Soft length constraints so neighbors feel springy while stretching */
    for (var it = 0; it < 3; it++) {
      solveRopeConstraints(rope, true);
    }
  }

  function solveRopeConstraints(rope, protectGrab) {
    var pts = rope.particles;
    var i;
    for (i = 0; i < rope.lens.length; i++) {
      var p1 = pts[i];
      var p2 = pts[i + 1];
      var dx = p2.x - p1.x;
      var dy = p2.y - p1.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var diff = ((d - rope.lens[i]) / d) * PHYS_STRUCT_STRENGTH * 0.5;
      var move1 = !p1.pinned && !(protectGrab && i === rope.grabIdx);
      var move2 = !p2.pinned && !(protectGrab && (i + 1) === rope.grabIdx);
      if (move1 && move2) {
        p1.x += dx * diff;
        p1.y += dy * diff;
        p2.x -= dx * diff;
        p2.y -= dy * diff;
      } else if (move1) {
        p1.x += dx * diff * 2;
        p1.y += dy * diff * 2;
      } else if (move2) {
        p2.x -= dx * diff * 2;
        p2.y -= dy * diff * 2;
      }
    }
  }

  function stepRope(rope) {
    var pts = rope.particles;
    var i;
    var a = pts[0];
    var b = pts[pts.length - 1];
    for (i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p.pinned) continue;
      var vx = (p.x - p.px) * PHYS_DAMPING;
      var vy = (p.y - p.py) * PHYS_DAMPING;
      p.px = p.x;
      p.py = p.y;
      p.x += vx;
      p.y += vy;
      p.x += (p.ox - p.x) * PHYS_REST_SPRING;
      p.y += (p.oy - p.y) * PHYS_REST_SPRING;
    }
    /* Gravity clamp: no particle may sit above the end-to-end chord */
    for (i = 1; i < pts.length - 1; i++) {
      var q = pts[i];
      var t = i / (pts.length - 1);
      var cy = a.y + (b.y - a.y) * t;
      if (q.y < cy) {
        q.y = cy + (cy - q.y);
        if (q.py < cy) q.py = cy;
      }
    }
    for (var it = 0; it < PHYS_STRUCT_ITERS; it++) {
      solveRopeConstraints(rope, false);
    }
  }

  function ropeEnergy(rope) {
    var e = 0;
    var i;
    for (i = 1; i < rope.particles.length - 1; i++) {
      var p = rope.particles[i];
      e += Math.abs(p.x - p.px) + Math.abs(p.y - p.py);
      e += (Math.abs(p.x - p.ox) + Math.abs(p.y - p.oy)) * 0.12;
    }
    return e;
  }

  function snapRopeToRest(rope) {
    var i;
    for (i = 0; i < rope.particles.length; i++) {
      var p = rope.particles[i];
      p.x = p.px = p.ox;
      p.y = p.py = p.oy;
    }
  }

  function ensurePhysLoop() {
    if (physRafId) return;
    function tick() {
      physRafId = 0;
      var any = false;
      var settledIds = [];
      cords.forEach(function (c) {
        var rope = ropePhysics[c.id];
        if (!rope || !rope.settling) return;
        if (!(c.sideA.attached && c.sideB.attached)) {
          rope.settling = false;
          return;
        }
        pinRopeEnds(c, rope);
        var s;
        for (s = 0; s < PHYS_SUBSTEPS; s++) stepRope(rope);
        writeRopeToRoute(c, rope);
        updateFiberPath(c);
        rope.frames += 1;
        if (ropeEnergy(rope) < PHYS_SETTLE_EPS || rope.frames > PHYS_MAX_SETTLE) {
          if (typeof c.fixedLength === 'number' &&
              c.sideA.attached && c.sideB.attached) {
            rebuildFixedLengthCatenary(c);
          } else {
            snapRopeToRest(rope);
            writeRopeToRoute(c, rope);
          }
          updateFiberPath(c);
          rope.settling = false;
          settledIds.push(c.id);
        } else {
          any = true;
        }
      });
      if (settledIds.length && !historyLocked) pushHistory();
      if (any) physRafId = requestAnimationFrame(tick);
    }
    physRafId = requestAnimationFrame(tick);
  }

  function beginRopeSettle(cord) {
    var rope = ropePhysics[cord.id];
    if (!rope) return;
    /* Prefer locked cable length catenary as rest pose */
    if (typeof cord.fixedLength === 'number' &&
        cord.sideA.attached && cord.sideB.attached) {
      var ends = reliefSpanEnds(cord);
      var chord = dist2(ends.a.x, ends.a.y, ends.b.x, ends.b.y) || 1;
      var L = cord.fixedLength;
      if (chord >= L) L = chord * 1.0002;
      bindRopeRestToPoints(
        rope,
        sampleFixedLengthSpan(ends.a, ends.b, L, rope.particles.length, cord)
      );
    } else if (rope.grabBase) {
      bindRopeRestToPoints(rope, rope.grabBase);
    } else {
      refreshRopeRest(cord, rope);
    }
    pinRopeEnds(cord, rope);
    var i;
    for (i = 1; i < rope.particles.length - 1; i++) {
      var p = rope.particles[i];
      p.px = p.x - (p.ox - p.x) * PHYS_RELEASE_KICK;
      p.py = p.y - (p.oy - p.y) * PHYS_RELEASE_KICK;
    }
    rope.grabIdx = -1;
    rope.settling = true;
    rope.frames = 0;
    ensurePhysLoop();
  }

  /**
   * Start interactive mid-span stretch on a fully connected cord.
   */
  function beginRopeGrab(cord, wx, wy) {
    clearRopePhysics(cord.id);
    var rope = buildRopeFromCord(cord);
    pinRopeEnds(cord, rope);
    rope.grabIdx = findNearestRopeIndex(rope, wx, wy);
    rope.grabBase = rope.particles.map(function (p) {
      return { x: p.x, y: p.y };
    });
    bindRopeRestToPoints(rope, rope.grabBase);
    rope.settling = false;
    ropePhysics[cord.id] = rope;
    applyRopeGrab(rope, wx, wy);
    writeRopeToRoute(cord, rope);
    return rope;
  }

  function buildCablePoints(cord) {
    var aChain = strainReliefChain(cord, 'A');
    var bChain = strainReliefChain(cord, 'B');
    var a = aChain[0];
    var b = bChain[0];
    var aOuter = aChain[aChain.length - 1];
    var bOuter = bChain[bChain.length - 1];
    var aDir = bootOutDir(getEndRotation(cord, 'A'));
    var bDir = bootOutDir(getEndRotation(cord, 'B'));
    var route = ensureRoute(cord).slice();

    if (route.length >= 1) {
      var dFirstA = dist2(route[0].x, route[0].y, a.x, a.y);
      var dLastA = dist2(route[route.length - 1].x, route[route.length - 1].y, a.x, a.y);
      if (dLastA < dFirstA) route.reverse();
    }

    var clearR = STRAIN_RELIEF_PX + 2;
    var cleaned = [];
    var i;
    for (i = 0; i < route.length; i++) {
      var p = route[i];
      if (pointInsideConnectorBody(cord, 'A', p.x, p.y)) continue;
      if (pointInsideConnectorBody(cord, 'B', p.x, p.y)) continue;
      /* Keep mid-span clear of the straight strain-relief zones */
      if ((p.x - a.x) * aDir.x + (p.y - a.y) * aDir.y < clearR &&
          dist2(p.x, p.y, a.x, a.y) < clearR + 8) continue;
      if ((p.x - b.x) * bDir.x + (p.y - b.y) * bDir.y < clearR &&
          dist2(p.x, p.y, b.x, b.y) < clearR + 8) continue;
      if (dist2(p.x, p.y, a.x, a.y) < 4) continue;
      if (dist2(p.x, p.y, b.x, b.y) < 4) continue;
      if (dist2(p.x, p.y, aOuter.x, aOuter.y) < 3) continue;
      if (dist2(p.x, p.y, bOuter.x, bOuter.y) < 3) continue;
      if (cleaned.length &&
          dist2(cleaned[cleaned.length - 1].x, cleaned[cleaned.length - 1].y, p.x, p.y) < 2) {
        continue;
      }
      cleaned.push(p);
    }

    if (cleaned.length >= 1) {
      var span = [{ x: aOuter.x, y: aOuter.y }]
        .concat(cleaned)
        .concat([{ x: bOuter.x, y: bOuter.y }]);
      span = enforceDownwardSag(span);
      cleaned = span.slice(1, -1);
    }

    /* tip → relief mid → relief outer … midpoints … outer → mid → tip */
    return aChain.concat(cleaned).concat(bChain.slice().reverse());
  }

  /** Catmull-Rom / cubic spline commands; pen is already at pts[0].
   *  opts.inTan / opts.outTan (unit vectors) keep G1 continuity with strain-relief stubs.
   */
  function catmullRomCubicCommands(pts, opts) {
    opts = opts || {};
    if (!pts || pts.length < 2) return '';
    var inTan = opts.inTan || null;
    var outTan = opts.outTan || null;
    var k = CATMULL_HANDLE_K;

    if (pts.length === 2) {
      var h2 = dist2(pts[0].x, pts[0].y, pts[1].x, pts[1].y) / 3;
      if (h2 < 0.5) return ' L ' + pts[1].x + ' ' + pts[1].y;
      var i0 = inTan || {
        x: (pts[1].x - pts[0].x) / (h2 * 3 || 1),
        y: (pts[1].y - pts[0].y) / (h2 * 3 || 1),
      };
      var o0 = outTan || i0;
      return (
        ' C ' + (pts[0].x + i0.x * h2) + ' ' + (pts[0].y + i0.y * h2) + ', ' +
        (pts[1].x - o0.x * h2) + ' ' + (pts[1].y - o0.y * h2) + ', ' +
        pts[1].x + ' ' + pts[1].y
      );
    }

    if (pts.length === 3) {
      /* Promote Q to C with optional end tangents for fluid joins */
      var a = pts[0];
      var b = pts[1];
      var c = pts[2];
      var hA = dist2(a.x, a.y, b.x, b.y) / 3;
      var hB = dist2(b.x, b.y, c.x, c.y) / 3;
      var tIn = inTan || { x: (b.x - a.x) / (hA * 3 || 1), y: (b.y - a.y) / (hA * 3 || 1) };
      var tOut = outTan || { x: (c.x - b.x) / (hB * 3 || 1), y: (c.y - b.y) / (hB * 3 || 1) };
      return (
        ' C ' + (a.x + tIn.x * hA) + ' ' + (a.y + tIn.y * hA) + ', ' +
        (b.x - (c.x - a.x) / k) + ' ' + (b.y - (c.y - a.y) / k) + ', ' +
        b.x + ' ' + b.y +
        ' C ' + (b.x + (c.x - a.x) / k) + ' ' + (b.y + (c.y - a.y) / k) + ', ' +
        (c.x - tOut.x * hB) + ' ' + (c.y - tOut.y * hB) + ', ' +
        c.x + ' ' + c.y
      );
    }

    var d = '';
    var i;
    for (i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i];
      var p1 = pts[i];
      var p2 = pts[i + 1];
      var p3 = pts[i + 2] || p2;
      var seg = dist2(p1.x, p1.y, p2.x, p2.y);
      var c1x;
      var c1y;
      var c2x;
      var c2y;
      if (i === 0 && inTan) {
        var hIn = Math.max(seg / 3, 4);
        c1x = p1.x + inTan.x * hIn;
        c1y = p1.y + inTan.y * hIn;
      } else {
        c1x = p1.x + (p2.x - p0.x) / k;
        c1y = p1.y + (p2.y - p0.y) / k;
      }
      if (i === pts.length - 2 && outTan) {
        var hOut = Math.max(seg / 3, 4);
        c2x = p2.x - outTan.x * hOut;
        c2y = p2.y - outTan.y * hOut;
      } else {
        c2x = p2.x - (p3.x - p1.x) / k;
        c2y = p2.y - (p3.y - p1.y) / k;
      }
      d += ' C ' + c1x + ' ' + c1y + ', ' + c2x + ' ' + c2y + ', ' + p2.x + ' ' + p2.y;
    }
    return d;
  }

  function unitVec(x, y) {
    var d = Math.sqrt(x * x + y * y);
    if (d < 1e-8) return { x: 0, y: 1 };
    return { x: x / d, y: y / d };
  }

  /**
   * Straight strain-relief leads/trails (L only on the short axial stubs),
   * mid-span always cubic-spline interpolated — never raw polyline vertices.
   */
  function smoothPathThrough(pts, opts) {
    opts = opts || {};
    if (!pts || pts.length < 2) return '';
    var lead = opts.strainLead != null ? opts.strainLead : 0;
    var trail = opts.strainTrail != null ? opts.strainTrail : 0;

    if (lead < 2 && trail < 2) {
      return 'M ' + pts[0].x + ' ' + pts[0].y + catmullRomCubicCommands(pts);
    }

    var d = 'M ' + pts[0].x + ' ' + pts[0].y;
    var i;
    for (i = 1; i < lead && i < pts.length; i++) {
      d += ' L ' + pts[i].x + ' ' + pts[i].y;
    }
    var midStart = Math.max(0, lead - 1);
    var midEnd = Math.min(pts.length - 1, pts.length - trail);
    if (midEnd > midStart) {
      var mid = pts.slice(midStart, midEnd + 1);
      var inTan = null;
      var outTan = null;
      if (midStart >= 1) {
        inTan = unitVec(
          pts[midStart].x - pts[midStart - 1].x,
          pts[midStart].y - pts[midStart - 1].y
        );
      }
      if (midEnd + 1 < pts.length) {
        outTan = unitVec(
          pts[midEnd + 1].x - pts[midEnd].x,
          pts[midEnd + 1].y - pts[midEnd].y
        );
      }
      d += catmullRomCubicCommands(mid, { inTan: inTan, outTan: outTan });
    }
    for (i = midEnd + 1; i < pts.length; i++) {
      d += ' L ' + pts[i].x + ' ' + pts[i].y;
    }
    return d;
  }

  /**
   * Render-only densify of the free mid-span so sparse rope / catenary samples
   * never show polygonal corners. Strain-relief stubs are left untouched.
   */
  function densifyMidSpanForSpline(pts, lead, trail) {
    if (!pts || pts.length < lead + trail) return pts;
    var midStart = Math.max(0, lead - 1);
    var midEnd = Math.min(pts.length - 1, pts.length - trail);
    if (midEnd - midStart < 2) return pts;
    var mid = pts.slice(midStart, midEnd + 1);
    mid = catmullRomResample(mid, 4);
    if (mid.length >= 4) mid = chaikinSmooth(mid, 1);
    mid = enforceDownwardSag(mid);
    return pts.slice(0, midStart).concat(mid).concat(pts.slice(midEnd + 1));
  }

  /**
   * Arc length used for continuous catenary rendering (all modes / live drag).
   * Prefer live rope span length, then locked meters, then traced length, then default slack.
   */
  function resolveRenderCableLength(cord, p0, p3) {
    var chord = dist2(p0.x, p0.y, p3.x, p3.y) || 1;
    var rope = ropePhysics[cord.id];
    if (rope && rope.particles && rope.particles.length >= 2) {
      var rlen = 0;
      var ri;
      for (ri = 1; ri < rope.particles.length; ri++) {
        rlen += dist2(
          rope.particles[ri - 1].x, rope.particles[ri - 1].y,
          rope.particles[ri].x, rope.particles[ri].y
        );
      }
      if (rlen > chord * 1.001) return Math.max(rlen, chord * 1.0002);
    }
    if (typeof cord.fixedLength === 'number' && cord.fixedLength > 0) {
      return Math.max(cord.fixedLength, chord * 1.0002);
    }
    var route = ensureRoute(cord);
    if (route.length >= 2) {
      var poly = [{ x: p0.x, y: p0.y }].concat(route).concat([{ x: p3.x, y: p3.y }]);
      var len = polylineLength(poly);
      var sag = routeSagDepth(poly);
      var L = Math.max(len, chord * CATENARY_DEFAULT_SLACK);
      if (sag > 2) L = Math.max(L, catenaryLengthForSag(p0, p3, sag));
      return Math.max(L, chord * 1.0002);
    }
    var sagD = catenarySagDepth(chord);
    return Math.max(
      chord * CATENARY_DEFAULT_SLACK,
      catenaryLengthForSag(p0, p3, sagD)
    );
  }

  function svgCubic(c1, c2, p) {
    return (
      ' C ' + c1.x + ' ' + c1.y + ', ' +
      c2.x + ' ' + c2.y + ', ' +
      p.x + ' ' + p.y
    );
  }

  /** Cubic Hermite segment as SVG C (unit tangents × handle lengths). */
  function hermiteSvg(p0, t0, h0, p1, t1, h1) {
    return svgCubic(
      { x: p0.x + t0.x * h0, y: p0.y + t0.y * h0 },
      { x: p1.x - t1.x * h1, y: p1.y - t1.y * h1 },
      p1
    );
  }

  /**
   * Effective cable length for elastic sag (fixed meters / route / default slack).
   */
  function resolveElasticLengthPx(cord, tipA, tipB) {
    var chord = dist2(tipA.x, tipA.y, tipB.x, tipB.y) || 1;
    if (typeof cord.fixedLength === 'number' && cord.fixedLength > 0) {
      return Math.max(cord.fixedLength, chord * 1.0002);
    }
    if (isMeterMode(cord) && typeof cord.lengthMeters === 'number') {
      return Math.max(metersToWorldPx(cord.lengthMeters), chord * 1.0002);
    }
    var rope = ropePhysics[cord.id];
    if (rope && rope.particles && rope.particles.length >= 2) {
      var rlen = 0;
      var ri;
      for (ri = 1; ri < rope.particles.length; ri++) {
        rlen += dist2(
          rope.particles[ri - 1].x, rope.particles[ri - 1].y,
          rope.particles[ri].x, rope.particles[ri].y
        );
      }
      if (rlen > chord * 1.001) return Math.max(rlen, chord * 1.0002);
    }
    var route = ensureRoute(cord);
    if (route.length >= 2) {
      var poly = [{ x: tipA.x, y: tipA.y }].concat(route).concat([{ x: tipB.x, y: tipB.y }]);
      return Math.max(polylineLength(poly), chord * CATENARY_DEFAULT_SLACK);
    }
    return chord * CATENARY_DEFAULT_SLACK;
  }

  /**
   * Downward belly depth (screen y+). Scales with tip span; excess length
   * (Meter Mode / fixedLength) deepens the hang like a rubber band.
   */
  function computeElasticSagPx(chord, lengthPx) {
    if (global.FtthLab && typeof FtthLab.elasticFiberSagPx === 'function') {
      return FtthLab.elasticFiberSagPx(chord, lengthPx);
    }
    chord = Math.max(1, chord);
    var sag = Math.min(
      GRAVITY_SAG_MAX,
      Math.max(GRAVITY_SAG_MIN * 0.55, chord * GRAVITY_SAG_RATIO)
    );
    var L = Number(lengthPx);
    if (isFinite(L) && L > chord) {
      var excess = L - chord;
      sag = Math.max(
        sag,
        Math.sqrt(Math.max(0, excess * chord * 0.5)) * 0.55
      );
    }
    return Math.max(16, Math.min(GRAVITY_SAG_MAX, sag));
  }

  /**
   * Fully elastic gravity-biased Bezier path: tipA → belly → tipB.
   * No rigid axial stubs, no x-parameterized cosh. The belly is always the
   * midpoint offset downward in Y, so the cable hangs under any orientation,
   * overlap, or parallel boot layout. Boot exits blend lightly into the curve.
   */
  function buildElasticBezierPath(cord) {
    var tipA = bootAnchor(cord, 'A');
    var tipB = bootAnchor(cord, 'B');
    var dA = bootOutDir(getEndRotation(cord, 'A'));
    var dB = bootOutDir(getEndRotation(cord, 'B'));
    var tA = unitVec(dA.x, dA.y);
    var tB = unitVec(dB.x, dB.y);

    var chord = dist2(tipA.x, tipA.y, tipB.x, tipB.y) || 1;
    var L = resolveElasticLengthPx(cord, tipA, tipB);
    var sag = computeElasticSagPx(chord, L);

    var belly = {
      x: (tipA.x + tipB.x) * 0.5,
      y: (tipA.y + tipB.y) * 0.5 + sag,
    };

    /* Leave A / arrive B: mostly toward the belly, light boot influence (no kinks) */
    var toBellyA = unitVec(belly.x - tipA.x, belly.y - tipA.y);
    var fromBellyB = unitVec(tipB.x - belly.x, tipB.y - belly.y);
    var leaveA = blendUnitTan(toBellyA, tA, 0.28);
    var arriveB = blendUnitTan(fromBellyB, unitVec(-tB.x, -tB.y), 0.28);

    /* Elastic band tangent across the belly follows the tip chord */
    var along = unitVec(tipB.x - tipA.x, tipB.y - tipA.y);
    if (along.x * along.x + along.y * along.y < 1e-8) {
      along = { x: 1, y: 0 };
    }

    var lenA = dist2(tipA.x, tipA.y, belly.x, belly.y) || 1;
    var lenB = dist2(belly.x, belly.y, tipB.x, tipB.y) || 1;
    var hA0 = Math.max(14, Math.min(lenA * 0.42, chord * 0.35 + 18));
    var hA1 = Math.max(14, Math.min(lenA * 0.36, chord * 0.32 + 16));
    var hB0 = Math.max(14, Math.min(lenB * 0.36, chord * 0.32 + 16));
    var hB1 = Math.max(14, Math.min(lenB * 0.42, chord * 0.35 + 18));

    return (
      'M ' + tipA.x + ' ' + tipA.y +
      hermiteSvg(tipA, leaveA, hA0, belly, along, hA1) +
      hermiteSvg(belly, along, hB0, tipB, arriveB, hB1)
    );
  }

  /** Public render entry — elastic gravity Bezier (no rigid stubs / cosh solver). */
  function buildContinuousCatenaryPath(cord) {
    return buildElasticBezierPath(cord);
  }

  /** Public render entry — always continuous gravitational cable. */
  function cordCablePath(cord) {
    return buildElasticBezierPath(cord);
  }

  /** @deprecated alias — elastic Bezier. */
  function gravityBezierPath(cord) {
    return buildElasticBezierPath(cord);
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
      '<span class="lab-vfl-exit-flare" aria-hidden="true">' +
      '<i class="lab-vfl-exit-flare__aura"></i>' +
      '<i class="lab-vfl-exit-flare__hot"></i>' +
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

    var html =
      '<svg class="lab-pcord-svg" aria-hidden="true">' +
      '<defs>' +
      '<filter id="lab-vfl-core-beam" x="-30%" y="-30%" width="160%" height="160%">' +
      '<feGaussianBlur in="SourceGraphic" stdDeviation="0.55" result="blur"/>' +
      '<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '</defs>';
    cords.forEach(function (c) {
      var path = cordCablePath(c);
      var bad = c.sideA.mismatch || c.sideB.mismatch;
      var sel = selection.cordId === c.id ? ' is-selected' : '';
      html +=
        '<path class="lab-pcord-fiber-hit' + (isMeterMode(c) ? ' is-meter-mode' : '') +
        '" data-pcord-drag="' + c.id + '" d="' + path +
        '" fill="none" />' +
        '<path class="lab-pcord-fiber' + (bad ? ' is-mismatch' : '') + sel +
        (isMeterMode(c) ? ' is-meter-mode' : '') +
        '" data-pcord-fiber="' + c.id + '" d="' + path + '" fill="none" />' +
        '<path class="lab-pcord-laser-core" data-pcord-laser="' + c.id + '" d="' + path +
        '" fill="none" />';
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
    reapplyStoredVflGlow();
  }

  /** Real-time path + free-end pose; plugged ends keep locked style. */
  function updateFiberPath(cord) {
    if (!layer) return;
    var d = cordCablePath(cord);
    var path = layer.querySelector('[data-pcord-fiber="' + cord.id + '"]');
    var hit = layer.querySelector('.lab-pcord-fiber-hit[data-pcord-drag="' + cord.id + '"]');
    var laser = layer.querySelector('[data-pcord-laser="' + cord.id + '"]');
    var selOutline = layer.querySelector(
      '.lab-pcord-fiber-select[data-pcord-fiber-select="' + cord.id + '"]'
    );
    if (path) path.setAttribute('d', d);
    if (hit) hit.setAttribute('d', d);
    if (laser) laser.setAttribute('d', d);
    if (selOutline) selOutline.setAttribute('d', d);
    var aBtn = layer.querySelector('[data-pcord-id="' + cord.id + '"][data-pcord-end="A"]');
    var bBtn = layer.querySelector('[data-pcord-id="' + cord.id + '"][data-pcord-end="B"]');
    if (aBtn) aBtn.setAttribute('style', endStyle(cord, 'A'));
    if (bBtn) bBtn.setAttribute('style', endStyle(cord, 'B'));
  }

  function bindLayerEvents(host) {
    /* Fiber body: free cord translate · fully linked → elastic mid-span pull */
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

        /* Half-linked: path still drawn via free connector end only */
        if ((aLocked && !bLocked) || (!aLocked && bLocked)) {
          setStatus('Click-and-hold the free connector end to drag and draw the path');
          return;
        }

        /* Both ports locked — rubber-band mid-span (Free Draw only) */
        if (aLocked && bLocked) {
          if (isMeterMode(c)) {
            setStatus(
              'Meter Mode · ' + (c.lengthMeters || pxToMeters(c.fixedLength)).toFixed(1) +
              ' m · adjust length in Properties · mid-span drag disabled'
            );
            return;
          }
          var world0 = clientToWorld(e.clientX, e.clientY);
          beginRopeGrab(c, world0.x, world0.y);
          updateFiberPath(c);
          document.body.classList.add('lab-pcord-stretching');
          grip.classList.add('is-stretching');
          setStatus('Stretching patch cord · release to spring back to your drawn shape');
          var stretched = false;

          function onStretchMove(ev) {
            stretched = true;
            var rope = ropePhysics[c.id];
            if (!rope) return;
            var w = clientToWorld(ev.clientX, ev.clientY);
            applyRopeGrab(rope, w.x, w.y);
            writeRopeToRoute(c, rope);
            updateFiberPath(c);
          }
          function onStretchUp() {
            window.removeEventListener('pointermove', onStretchMove);
            window.removeEventListener('pointerup', onStretchUp);
            document.body.classList.remove('lab-pcord-stretching');
            grip.classList.remove('is-stretching');
            if (ropePhysics[c.id]) {
              beginRopeSettle(c);
              setStatus(
                stretched
                  ? 'Patch cord relaxing · settling to your custom depth and layout'
                  : 'Patch cord selected · drag the cable body to stretch'
              );
            }
          }
          window.addEventListener('pointermove', onStretchMove);
          window.addEventListener('pointerup', onStretchUp);
          return;
        }

        /* Both free — translate whole cord */
        var moved = false;
        var route0 = ensureRoute(c).map(function (p) {
          return { x: p.x, y: p.y };
        });

        function onMove(ev) {
          moved = true;
          var dx = (ev.clientX - sx) / zoom;
          var dy = (ev.clientY - sy) / zoom;
          c.ax = oax + dx;
          c.ay = oay + dy;
          c.bx = obx + dx;
          c.by = oby + dy;
          if (route0.length) {
            c.route = route0.map(function (p) {
              return { x: p.x + dx, y: p.y + dy };
            });
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
         * First-time routing only: seed path when free end starts drawing.
         * Relocate / fixed-length cords never append ink.
         */
        if (!wasAttached && otherWasLocked && !c.pathLocked &&
            typeof c.fixedLength !== 'number' && !c.relocating) {
          if (!ensureRoute(c).length) {
            var seedBoot = bootAnchor(c, otherEnd);
            appendRoutePoint(c, seedBoot.x, seedBoot.y);
          }
        }

        /* Fixed-length relocate whenever the other end is anchored and length is locked */
        if (otherWasLocked && typeof c.fixedLength === 'number') {
          c.relocating = true;
        }

        btn.classList.add('is-dragging');
        document.body.classList.add('lab-pcord-plugging');
        endDragState = { cordId: id, end: end };

        function clearHighlights() {
          document.querySelectorAll(
            '.lab-fx-port.is-plug-target, .lab-cas-port.is-plug-target, .lab-cpl-port.is-plug-target, ' +
            '.lab-vfl-port.is-plug-target, .lab-opm-port.is-plug-target, .lab-ols-port.is-plug-target'
          ).forEach(function (n) { n.classList.remove('is-plug-target'); });
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
            btn.classList.remove('is-attached', 'is-mismatch', 'is-tension');
            btn.classList.add('is-unplugging');
            setStatus(
              c.relocating
                ? 'Side ' + end + ' relocating · fixed length ' +
                  Math.round(c.fixedLength) + 'px · snap into a port'
                : 'Side ' + end + ' unplugged from ' + (portHome.label || 'port')
            );
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

          if (c.relocating && typeof c.fixedLength === 'number' &&
              c[endKey(otherEnd)].attached) {
            /* Fixed-length elastic tether — no path accumulation */
            clampFreeEndToFixedLength(c, end);
            rebuildFixedLengthCatenary(c);
          } else if (c[endKey(otherEnd)].attached && !c.pathLocked &&
                     typeof c.fixedLength !== 'number') {
            /* First-time freehand routing only */
            var tip = bootExitStub(c, end);
            appendRoutePoint(c, tip.x, tip.y);
          }
          updateFiberPath(c);

          clearHighlights();
          var hit = resolvePlugHit(ev.clientX, ev.clientY);
          if (hit && hit.owner === 'ols') {
            var mag = applyOlsMagneticPull(c, end, hit, ev.clientX, ev.clientY);
            if (mag === 'lock' && !c[endKey(end)].attached) {
              /* Instant magnetic click — deep seat + vertical lock */
              attachEnd(c, end, hit);
              if (c[endKey(otherEnd)].attached && !spanFitsFixedLength(c)) {
                detachEnd(c, end);
                c.relocating = typeof c.fixedLength === 'number';
                setEndWorld(c, end, mouse.x, mouse.y);
                clampFreeEndToFixedLength(c, end);
                rebuildFixedLengthCatenary(c);
              } else {
                pluggedNow = true;
                flashPort(hit.el);
                if (c[endKey(otherEnd)].attached) {
                  if (!c.pathLocked && typeof c.fixedLength !== 'number' && !c.relocating) {
                    var seatTipM = bootExitStub(c, end);
                    appendRoutePoint(c, seatTipM.x, seatTipM.y);
                    smoothDrawnRoute(c);
                  }
                  lockDrawnPath(c);
                  endLinkSession({ silent: true });
                }
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                try { btn.releasePointerCapture(ev.pointerId); } catch (errM) { /* ignore */ }
                btn.classList.remove('is-dragging', 'is-tension', 'is-unplugging');
                document.body.classList.remove('lab-pcord-plugging');
                clearHighlights();
                endDragState = null;
                rebuildLayer();
                updateInspector();
                pushHistory();
                refreshBudget();
                setStatus('OLS-35 · magnetic dock · SC seated vertical');
                return;
              }
            }
          } else if (hit && hit.el) {
            var br = hit.el.getBoundingClientRect();
            var dScreen = dist2(
              ev.clientX, ev.clientY,
              br.left + br.width / 2, br.top + br.height / 2
            );
            if (dScreen <= PLUG_SNAP_PX * 1.6) {
              hit.el.classList.add('is-plug-target');
              if (isTopTestPort(hit) && !c[endKey(end)].attached) {
                c[endKey(end)].liveRot = 180;
              }
            }
          }
        }

        function onUp(ev) {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          try { btn.releasePointerCapture(ev.pointerId); } catch (err2) { /* ignore */ }
          btn.classList.remove('is-dragging', 'is-tension', 'is-unplugging');
          document.body.classList.remove('lab-pcord-plugging');
          clearHighlights();

          var hit = resolvePlugHit(ev.clientX, ev.clientY);
          var mouse = clientToWorld(ev.clientX, ev.clientY);

          if (wasAttached && !released) {
            syncAttachedPositions(c);
            setStatus('Side ' + end + ' still locked · pull farther to unplug');
          } else if (hit) {
            var snapR = plugSnapRadiusFor(hit);
            var snapEl = hit.el && (
              hit.el.querySelector('.lab-ols__adapter-slot, .lab-ols__sc-block, .lab-fx-port__cage') ||
              hit.el.querySelector('i') || hit.el
            );
            var rect = snapEl
              ? snapEl.getBoundingClientRect()
              : { left: ev.clientX, top: ev.clientY, width: 0, height: 0 };
            var dScreen = hit.screenDist != null
              ? hit.screenDist
              : dist2(
                ev.clientX, ev.clientY,
                rect.left + rect.width / 2, rect.top + rect.height / 2
              );
            var snapMul = hit.owner === 'ols' ? 1 : 1.75;
            if (dScreen <= snapR * snapMul) {
              attachEnd(c, end, hit);
              /* Reject ports beyond the locked cable reach */
              if (c[endKey(otherEnd)].attached && !spanFitsFixedLength(c)) {
                detachEnd(c, end);
                c.relocating = typeof c.fixedLength === 'number';
                setEndWorld(c, end, mouse.x, mouse.y);
                clampFreeEndToFixedLength(c, end);
                rebuildFixedLengthCatenary(c);
                setStatus(
                  'Port out of reach · cable length locked at ' +
                  Math.round(c.fixedLength) + 'px'
                );
              } else {
                if (!c.pathLocked && typeof c.fixedLength !== 'number' && !c.relocating) {
                  var seatTip = bootExitStub(c, end);
                  appendRoutePoint(c, seatTip.x, seatTip.y);
                  smoothDrawnRoute(c);
                }
                pluggedNow = true;
                flashPort(hit.el);
                if (c[endKey(otherEnd)].attached) {
                  lockDrawnPath(c);
                  endLinkSession({ silent: true });
                  setStatus(
                    'Patch connected · length ' + Math.round(c.fixedLength) +
                    'px · true catenary'
                  );
                } else if (hit.owner === 'ols') {
                  setStatus('OLS-35 · SC docked vertical · deep seat');
                }
              }
            } else {
              setEndWorld(c, end, mouse.x, mouse.y);
              if (c.relocating && typeof c.fixedLength === 'number') {
                clampFreeEndToFixedLength(c, end);
                rebuildFixedLengthCatenary(c);
              } else if (!c.pathLocked && ensureRoute(c).length >= 3) {
                smoothDrawnRoute(c);
              }
              setStatus('Side ' + end + ' free · release over a port to snap-lock');
            }
          } else {
            setEndWorld(c, end, mouse.x, mouse.y);
            if (c.relocating && typeof c.fixedLength === 'number') {
              clampFreeEndToFixedLength(c, end);
              rebuildFixedLengthCatenary(c);
              setStatus(
                'Side ' + end + ' relocating · fixed length ' +
                Math.round(c.fixedLength) + 'px'
              );
            } else if (!c.pathLocked && ensureRoute(c).length >= 3) {
              smoothDrawnRoute(c);
              setStatus('Side ' + end + ' free · click-and-drag to draw, release on a port');
            } else {
              setStatus('Side ' + end + ' free · click-and-drag to draw, release on a port');
            }
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
      '<p class="lab-inspector__label">' + label + '</p>' +
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
    var meter = isMeterMode(c);
    var meters = normalizeLengthMeters(
      typeof c.lengthMeters === 'number'
        ? c.lengthMeters
        : (typeof c.fixedLength === 'number' ? pxToMeters(c.fixedLength) : 3)
    );
    var chordPx = 0;
    if (c.sideA.attached && c.sideB.attached) {
      var ends = reliefSpanEnds(c);
      chordPx = dist2(ends.a.x, ends.a.y, ends.b.x, ends.b.y) || 0;
    }
    var excessM = meter && typeof c.fixedLength === 'number'
      ? Math.max(0, pxToMeters(c.fixedLength - chordPx))
      : 0;

    card.innerHTML =
      '<h2>Patch Cord</h2>' +
      '<p>' + (meter
        ? 'Meter Mode · fixed length · longer cable = deeper catenary sag'
        : 'Free Draw · drag ends to route · stretch mid-span when linked') + '</p>';

    if (!detail) return;
    detail.hidden = false;

    var presets = [1, 2, 3, 5, 10];
    var presetHtml = presets.map(function (m) {
      return (
        '<button type="button" class="lab-pcord-len-preset' +
        (meters === m ? ' is-active' : '') +
        '" data-pc-len-preset="' + c.id + ':' + m + '">' + m + ' m</button>'
      );
    }).join('');

    detail.innerHTML =
      '<div class="lab-pcord-config">' +
      '<p class="lab-inspector__label">Length control</p>' +
      '<div class="lab-pcord-len-mode" role="group" aria-label="Cable length mode">' +
      '<button type="button" class="lab-pcord-len-mode-btn' + (!meter ? ' is-active' : '') +
      '" data-pc-len-mode="' + c.id + ':free">Free Draw</button>' +
      '<button type="button" class="lab-pcord-len-mode-btn' + (meter ? ' is-active' : '') +
      '" data-pc-len-mode="' + c.id + ':meter">Meter Mode</button>' +
      '</div>' +
      '<div class="lab-pcord-meter"' + (meter ? '' : ' hidden') + '>' +
      '<label class="lab-pcord-meter-label" for="lab-pcord-len-input-' + c.id +
      '">Length (meters)</label>' +
      '<div class="lab-pcord-meter-stepper">' +
      '<button type="button" class="lab-pcord-meter-btn" data-pc-len-step="' +
      c.id + ':-0.5" aria-label="Decrease length">−</button>' +
      '<input id="lab-pcord-len-input-' + c.id +
      '" class="lab-pcord-meter-input" type="number" min="0.5" max="100" step="0.5" ' +
      'value="' + meters + '" data-pc-len-meters="' + c.id + '">' +
      '<button type="button" class="lab-pcord-meter-btn" data-pc-len-step="' +
      c.id + ':0.5" aria-label="Increase length">+</button>' +
      '</div>' +
      '<div class="lab-pcord-len-presets">' + presetHtml + '</div>' +
      '<p class="lab-pcord-meter-hint">' +
      (excessM > 0.05
        ? 'Span ' + pxToMeters(chordPx).toFixed(2) + ' m · excess ' +
          excessM.toFixed(2) + ' m → deeper sag'
        : 'Length longer than the port span hangs as gravitational sag') +
      '</p>' +
      '</div>' +
      polishToggleHtml(c.id, 'A', c.sideA.polish, 'Side A') +
      '<p class="lab-pcord-attach' + (c.sideA.mismatch ? ' is-warn' : '') + '">' +
      (c.sideA.attached
        ? 'A → ' + c.sideA.attached.label +
          (c.sideA.mismatch ? ' · MISMATCH +' + MISMATCH_PENALTY_DB + ' dB' : '')
        : 'A · unplugged') +
      '</p>' +
      polishToggleHtml(c.id, 'B', c.sideB.polish, 'Side B') +
      '<p class="lab-pcord-attach' + (c.sideB.mismatch ? ' is-warn' : '') + '">' +
      (c.sideB.attached
        ? 'B → ' + c.sideB.attached.label +
          (c.sideB.mismatch ? ' · MISMATCH +' + MISMATCH_PENALTY_DB + ' dB' : '')
        : 'B · unplugged') +
      '</p>' +
      '<div class="lab-spl-sheet">' +
      '<div><span>Side A</span><strong class="' +
      (normalizePolish(c.sideA.polish) === 'APC' ? 'is-apc-text' : 'is-upc-text') + '">' +
      displayPolish(c.sideA.polish) + '</strong></div>' +
      '<div><span>Side B</span><strong class="' +
      (normalizePolish(c.sideB.polish) === 'APC' ? 'is-apc-text' : 'is-upc-text') + '">' +
      displayPolish(c.sideB.polish) + '</strong></div>' +
      '<div><span>Path loss</span><strong>' + pathLoss.toFixed(2) + ' dB</strong></div>' +
      (typeof c.fixedLength === 'number'
        ? '<div><span>Length</span><strong>' +
          (meter
            ? meters.toFixed(1) + ' m'
            : Math.round(c.fixedLength) + ' px') +
          '</strong></div>'
        : '') +
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
    detail.querySelectorAll('[data-pc-len-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var parts = btn.getAttribute('data-pc-len-mode').split(':');
        setLengthMode(parts[0], parts[1]);
      });
    });
    detail.querySelectorAll('[data-pc-len-step]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var parts = btn.getAttribute('data-pc-len-step').split(':');
        var cur = normalizeLengthMeters(
          typeof c.lengthMeters === 'number' ? c.lengthMeters : meters
        );
        setLengthMeters(parts[0], cur + Number(parts[1]));
      });
    });
    detail.querySelectorAll('[data-pc-len-preset]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var parts = btn.getAttribute('data-pc-len-preset').split(':');
        setLengthMeters(parts[0], parts[1]);
      });
    });
    var lenInput = detail.querySelector('[data-pc-len-meters]');
    if (lenInput) {
      lenInput.addEventListener('input', function () {
        var v = Number(lenInput.value);
        if (!isFinite(v) || v < 0.5) return;
        cord.lengthMode = 'meter';
        cord.lengthMeters = normalizeLengthMeters(v);
        clearRopePhysics(cord.id);
        applyMeterLengthToCord(cord);
        rebuildLayer();
        updateFiberPath(cord);
      });
      lenInput.addEventListener('change', function () {
        setLengthMeters(c.id, lenInput.value);
      });
      lenInput.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          setLengthMeters(c.id, lenInput.value);
        }
      });
    }
    var rm = detail.querySelector('[data-remove-pcord]');
    if (rm) {
      rm.addEventListener('click', function () { removeCord(c.id); });
    }
  }

  function onViewChange() {
    rebuildLayer();
  }

  /** Shift freehand mid-span with a moved end (keeps far tip planted). */
  function morphRouteForEndMove(cord, end, dx, dy) {
    if ((!dx && !dy) || !cord) return;
    var route = ensureRoute(cord);
    if (!route.length) return;
    var n = route.length;
    var i;
    for (i = 0; i < n; i++) {
      /* t=0 at A, t=1 at B — weight toward the moved connector */
      var t = (i + 1) / (n + 1);
      var w = end === 'A' ? (1 - t) : t;
      route[i].x += dx * w;
      route[i].y += dy * w;
    }
  }

  /**
   * After equipment moves (coupler / splitter / OLT): reseat plugs and
   * rebuild or morph the cable so heads + curve travel as one unit.
   */
  function onLayoutChange(payload) {
    if (!layer) return;
    var onlyCoupler = payload && payload.source === 'coupler' ? payload.couplerId : null;
    var onlyVfl = payload && payload.source === 'vfl' ? payload.vflId : null;

    cords.forEach(function (c) {
      if (onlyCoupler) {
        var aOnC = c.sideA.attached && c.sideA.attached.owner === 'coupler' &&
          c.sideA.attached.couplerId === onlyCoupler;
        var bOnC = c.sideB.attached && c.sideB.attached.owner === 'coupler' &&
          c.sideB.attached.couplerId === onlyCoupler;
        if (!aOnC && !bOnC) return;
      }
      if (onlyVfl) {
        var aOnV = c.sideA.attached && c.sideA.attached.owner === 'vfl' &&
          c.sideA.attached.vflId === onlyVfl;
        var bOnV = c.sideB.attached && c.sideB.attached.owner === 'vfl' &&
          c.sideB.attached.vflId === onlyVfl;
        if (!aOnV && !bOnV) return;
      }

      var oax = c.ax;
      var oay = c.ay;
      var obx = c.bx;
      var oby = c.by;
      syncAttachedPositions(c);
      var dax = c.ax - oax;
      var day = c.ay - oay;
      var dbx = c.bx - obx;
      var dby = c.by - oby;
      if (!dax && !day && !dbx && !dby) {
        updateFiberPath(c);
        return;
      }

      if (typeof c.fixedLength === 'number') {
        /* Locked physical length — true catenary follows the new port span */
        rebuildFixedLengthCatenary(c);
      } else {
        if ((dax || day) && !(dbx || dby)) morphRouteForEndMove(c, 'A', dax, day);
        else if ((dbx || dby) && !(dax || day)) morphRouteForEndMove(c, 'B', dbx, dby);
        else if ((dax || day) && (dbx || dby)) {
          if (dax === dbx && day === dby) {
            var route = ensureRoute(c);
            var i;
            for (i = 0; i < route.length; i++) {
              route[i].x += dax;
              route[i].y += day;
            }
          } else {
            morphRouteForEndMove(c, 'A', dax, day);
            morphRouteForEndMove(c, 'B', dbx, dby);
          }
        }
      }
      updateFiberPath(c);
    });
  }

  function cancelPatch() {
    endDragState = null;
    clearAllRopePhysics();
    cancelLinkSession();
  }

  function onToolboxClaim(payload) {
    var id = payload && payload.toolId;
    if (id === 'patch-cord') return;
    if (selectedTool) {
      selectedTool = null;
      renderToolbox();
    }
  }

  function clearSelection() {
    selection = { kind: 'none', cordId: null };
    selectedTool = null;
    endDragState = null;
    clearAllRopePhysics();
    cancelLinkSession();
    renderToolbox();
    rebuildLayer();
  }

  function refreshCouplerPolish(couplerId, polish) {
    polish = portPolishNorm(polish) === 'APC' ? 'APC' : 'UPC';
    var warned = false;
    cords.forEach(function (c) {
      ['A', 'B'].forEach(function (end) {
        var side = c[endKey(end)];
        if (!side.attached || side.attached.owner !== 'coupler') return;
        if (side.attached.couplerId !== couplerId) return;
        side.attached.polish = polish;
        side.attached.label =
          'SC Coupler ' + side.attached.port + ' · ' +
          (polish === 'APC' ? 'SC/APC' : 'SC/PC');
        side.mismatch = !polishMatch(side.polish, polish);
        side.attached.mismatch = side.mismatch;
        if (side.mismatch) warned = true;
      });
    });
    if (warned) showWarning(MISMATCH_MSG);
    rebuildLayer();
    updateInspector();
    refreshBudget();
  }

  function detachPortsForCoupler(couplerId) {
    var changed = false;
    cords.forEach(function (c) {
      ['A', 'B'].forEach(function (end) {
        var side = c[endKey(end)];
        if (!side.attached || side.attached.owner !== 'coupler') return;
        if (side.attached.couplerId !== couplerId) return;
        detachEnd(c, end);
        changed = true;
      });
    });
    if (changed) {
      rebuildLayer();
      updateInspector();
      refreshBudget();
    }
  }

  function detachPcordsFromVfl(vflId, exceptCordId, exceptEnd) {
    cords.forEach(function (c) {
      ['A', 'B'].forEach(function (end) {
        if (c.id === exceptCordId && end === exceptEnd) return;
        var side = c[endKey(end)];
        if (side.attached && side.attached.owner === 'vfl' &&
            side.attached.vflId === vflId) {
          detachEnd(c, end);
        }
      });
    });
    rebuildLayer();
    refreshBudget();
  }

  /**
   * Move every patch cord plugged into a VFL as one rigid group with the pen.
   * opts.live — update SVG paths without full layer rebuild (during drag).
   */
  function translateForVfl(vflId, dx, dy, opts) {
    opts = opts || {};
    if (!dx && !dy) return;
    var changed = false;
    cords.forEach(function (c) {
      var onVfl = false;
      ['A', 'B'].forEach(function (end) {
        var side = c[endKey(end)];
        if (side.attached && side.attached.owner === 'vfl' &&
            side.attached.vflId === vflId) {
          onVfl = true;
        }
      });
      if (!onVfl) return;
      changed = true;
      c.ax += dx;
      c.ay += dy;
      c.bx += dx;
      c.by += dy;
      var route = ensureRoute(c);
      var i;
      for (i = 0; i < route.length; i++) {
        route[i].x += dx;
        route[i].y += dy;
      }
      syncAttachedPositions(c);
      if (opts.live) updateFiberPath(c);
    });
    if (changed && !opts.live) rebuildLayer();
    if (changed && global.FtthLab && typeof FtthLab.refreshVflLaser === 'function') {
      FtthLab.refreshVflLaser();
    }
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
    clearAllRopePhysics();
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
      FtthLab.refreshCouplerPolish = refreshCouplerPolish;
      FtthLab.detachPortsForCoupler = detachPortsForCoupler;
      FtthLab.detachPcordsFromVfl = detachPcordsFromVfl;

      var prevTranslate = FtthLab.translateVflGroup;
      FtthLab.translateVflGroup = function (vflId, dx, dy, opts) {
        translateForVfl(vflId, dx, dy, opts);
        if (typeof prevTranslate === 'function' && prevTranslate !== translateForVfl) {
          prevTranslate(vflId, dx, dy, opts);
        }
      };

      var prevGraph = FtthLab.getFiberLaserGraph;
      FtthLab.getFiberLaserGraph = function () {
        var base = typeof prevGraph === 'function'
          ? (prevGraph() || { pcords: [], pigtails: [] })
          : { pcords: [], pigtails: [] };
        base.pcords = getLaserGraphNodes();
        return base;
      };

      var prevGlow = FtthLab.applyFiberLaserGlow;
      FtthLab.applyFiberLaserGlow = function (targets) {
        applyLaserGlow(
          targets && targets.pcords,
          targets && targets.mode,
          { pcordExits: targets && targets.pcordExits }
        );
        if (typeof prevGlow === 'function') prevGlow(targets);
      };

      /* Shared continuous-catenary sampler for pigtails / other fiber tools */
      FtthLab.sampleFiberCatenary = function (p0, p3, length, count) {
        return sampleTrueCatenary(p0, p3, length, count || CATENARY_SAMPLES);
      };
      FtthLab.fiberCatenaryLengthForSag = catenaryLengthForSag;
      FtthLab.fiberCatenarySagDepth = catenarySagDepth;
      FtthLab.CATENARY_DEFAULT_SLACK = CATENARY_DEFAULT_SLACK;

      FtthLab.hitTestLabPort = hitTestPort;
    }
  }

  var tool = {
    id: 'patch-cord',
    mount: mount,
    onViewChange: onViewChange,
    onLayoutChange: onLayoutChange,
    cancelPatch: cancelPatch,
    clearSelection: clearSelection,
    onToolboxClaim: onToolboxClaim,
    undo: undo,
    redo: redo,
    deleteSelected: deleteSelected,
    placeCord: placeCord,
    startLinkFromPort: startLinkFromPort,
    tryPatchPort: tryPatchPort,
    getNetworkLossDb: getNetworkLossDb,
    getMismatchCount: getMismatchCount,
    rebuildLayer: rebuildLayer,
    getLaserGraphNodes: getLaserGraphNodes,
    applyLaserGlow: applyLaserGlow,
    translateForVfl: translateForVfl,
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
