/**
 * SC Pigtail — single SC connector (End A) + bare/stripped fiber tail (End B).
 * Connector plugs into OLT / splitter / coupler ports; bare tip parks on
 * splice / termination points (.lab-splice-point, [data-lab-splice], …).
 */
(function (global) {
  'use strict';

  var MISMATCH_MSG =
    'Connector polish mismatch (SC/APC ↔ SC/PC): high back reflection expected. ' +
    'Connection allowed — extra insertion loss applied to the power budget.';
  var MISMATCH_PENALTY_DB = 0.75;
  var MATCHED_CONNECTOR_DB = 0.2;

  var END_W = 14;
  var END_H = 22;
  /*
   * Same local frame as patch cord (lab-pcord__end):
   *   ferrule = local −Y (nose), ribbed boot = local +Y (cable exit).
   * World pos = button center; path must start at bootAnchor (rear tip).
   */
  var BOOT_EXIT_OFFSET = END_H / 2;
  var BOOT_EXIT_STUB = 10;
  var STRAIN_RELIEF_PX = 22;
  var UNPLUG_PULL_PX = 36;
  var PLUG_SNAP_PX = 22;
  var TAIL_SNAP_PX = 18;
  var TAIL_W = 10;
  var TAIL_H = 16;
  var HEADING_MIN_PX = 2.5;
  var HEADING_SMOOTH = 0.42;
  var HISTORY_MAX = 60;
  var PIGTAIL_CATENARY_SAMPLES = 48;
  var PIGTAIL_CATENARY_SLACK = 1.12;

  var ctx = null;
  var layer = null;
  var pigtails = [];
  var seq = 0;
  var selection = { kind: 'none', id: null };
  var dragLib = null;
  var selectedTool = null;
  var history = [];
  var historyIndex = -1;
  var historyLocked = false;

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
      FtthLab.setSelectionOwner('sc-pigtail');
    }
  }

  function cloneJson(v) {
    return JSON.parse(JSON.stringify(v == null ? null : v));
  }

  function normalizePolish(v) {
    var s = String(v || '').toUpperCase().replace(/\s+/g, '');
    if (s === 'APC' || s === 'SC/APC' || s === 'SCAPC') return 'APC';
    return 'PC';
  }

  function displayPolish(v) {
    return normalizePolish(v) === 'APC' ? 'SC/APC' : 'SC/PC';
  }

  function portPolishNorm(v) {
    return String(v || '').toUpperCase() === 'APC' ? 'APC' : 'PC';
  }

  function polishMatch(cordPolish, portPolish) {
    return normalizePolish(cordPolish) === portPolishNorm(portPolish);
  }

  function findPigtail(id) {
    for (var i = 0; i < pigtails.length; i++) {
      if (pigtails[i].id === id) return pigtails[i];
    }
    return null;
  }

  function dist2(ax, ay, bx, by) {
    var dx = ax - bx;
    var dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * CSS rotate(θ) with y+ down — identical to patch cord:
   *   bootOutDir(θ) = (−sin θ, cos θ) aims local +Y (boot → cable).
   *   θ = atan2(−tx, ty) aims boot toward the other end.
   */
  function endRotationDeg(cx, cy, towardX, towardY) {
    var tx = towardX - cx;
    var ty = towardY - cy;
    return Math.atan2(-tx, ty) * 180 / Math.PI;
  }

  function bootOutDir(rotDeg) {
    var r = rotDeg * Math.PI / 180;
    return { x: -Math.sin(r), y: Math.cos(r) };
  }

  function localToWorld(cx, cy, lx, ly, rotDeg) {
    var r = rotDeg * Math.PI / 180;
    var cos = Math.cos(r);
    var sin = Math.sin(r);
    return {
      x: cx + lx * cos - ly * sin,
      y: cy + lx * sin + ly * cos,
    };
  }

  function lerpAngleDeg(from, to, t) {
    var d = ((to - from + 540) % 360) - 180;
    return from + d * t;
  }

  /** Ferrule/nose leads along (dx, dy) — same as patch cord. */
  function headingRotFromMotion(dx, dy) {
    return Math.atan2(dx, -dy) * 180 / Math.PI;
  }

  function portAlignedRotation(hit) {
    if (hit && hit.owner === 'coupler') {
      return hit.port === 'B' || hit.port === 'b' ? -90 : 90;
    }
    if (hit && hit.owner === 'vfl') {
      return 180;
    }
    if (hit && hit.owner === 'opm') {
      return 0;
    }
    if (hit && (hit.owner === 'splitter' ||
        (hit.el && hit.el.classList && hit.el.classList.contains('lab-cas-port')))) {
      return 180;
    }
    return 0;
  }

  function resolveUprightPlugRotation(hit, p) {
    if (hit && hit.owner === 'coupler') return portAlignedRotation(hit);
    var base = portAlignedRotation(hit);
    var alt = base === 0 ? 180 : 0;
    var dY = (hit && typeof hit.wy === 'number') ? (hit.wy - p.ay) : 0;
    if (Math.abs(dY) < 1) return base;
    var preferred = headingRotFromMotion(0, dY);
    var dBase = Math.abs(((preferred - base + 540) % 360) - 180);
    var dAlt = Math.abs(((preferred - alt + 540) % 360) - 180);
    return dAlt < dBase ? alt : base;
  }

  function captureSnapshot() {
    return { pigtails: cloneJson(pigtails), seq: seq };
  }

  function applySnapshot(snap) {
    if (!snap) return;
    historyLocked = true;
    pigtails = cloneJson(snap.pigtails) || [];
    seq = snap.seq || 0;
    selection = { kind: 'none', id: null };
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
      FtthLab.recordHistory('sc-pigtail');
    }
  }

  function undo() {
    if (historyIndex <= 0) return false;
    historyIndex -= 1;
    applySnapshot(history[historyIndex]);
    setStatus('Undo · SC pigtail');
    return true;
  }

  function redo() {
    if (historyIndex >= history.length - 1) return false;
    historyIndex += 1;
    applySnapshot(history[historyIndex]);
    setStatus('Redo · SC pigtail');
    return true;
  }

  function defaultPos() {
    var w = getWorldSize();
    return {
      x: Math.round(w / 2 + 80 + pigtails.length * 28),
      y: Math.round(w / 2 + 240 + (pigtails.length % 3) * 40),
    };
  }

  function placePigtail(x, y) {
    seq += 1;
    var pos = (typeof x === 'number' && typeof y === 'number')
      ? { x: x, y: y }
      : defaultPos();
    var item = {
      id: 'pt-' + seq,
      ax: pos.x,
      ay: pos.y,
      bx: pos.x,
      by: pos.y + 120,
      polish: 'PC',
      connector: {
        attached: null,
        mismatch: false,
        lockedRot: null,
        liveRot: null,
      },
      tail: { attached: null },
      route: [],
      fixedLength: null,
    };
    pigtails.push(item);
    selectPigtail(item.id);
    rebuildLayer();
    pushHistory();
    refreshBudget();
    setStatus('SC Pigtail placed · drag connector to a port · bare tip for splice / termination');
    return item;
  }

  function removePigtail(id) {
    pigtails = pigtails.filter(function (p) { return p.id !== id; });
    if (selection.id === id) selection = { kind: 'none', id: null };
    rebuildLayer();
    updateInspector();
    pushHistory();
    refreshBudget();
    setStatus('SC Pigtail removed');
  }

  function selectPigtail(id) {
    selection = { kind: 'pigtail', id: id };
    claimSelection();
    updateInspector();
    rebuildLayer();
  }

  function setConnectorPolish(id, polish) {
    var p = findPigtail(id);
    if (!p) return;
    p.polish = normalizePolish(polish);
    if (p.connector.attached) {
      p.connector.mismatch = !polishMatch(p.polish, p.connector.attached.polish);
      p.connector.attached.mismatch = p.connector.mismatch;
      if (p.connector.mismatch) showWarning(MISMATCH_MSG);
    }
    rebuildLayer();
    updateInspector();
    pushHistory();
    refreshBudget();
    setStatus('SC Pigtail → ' + displayPolish(p.polish));
  }

  function getConnRot(p) {
    if (p.connector.attached) {
      if (typeof p.connector.lockedRot === 'number') return p.connector.lockedRot;
      if (p.connector.attached && typeof p.connector.attached.lockedRot === 'number') {
        p.connector.lockedRot = p.connector.attached.lockedRot;
        return p.connector.lockedRot;
      }
    }
    if (typeof p.connector.liveRot === 'number') return p.connector.liveRot;
    /* Boot aims toward bare tip — ferrule opposite (same as patch End A → B) */
    return endRotationDeg(p.ax, p.ay, p.bx, p.by);
  }

  function updateLiveHeading(p, dx, dy) {
    if (p.connector.attached) return;
    if (dist2(0, 0, dx, dy) < HEADING_MIN_PX) return;
    var target = headingRotFromMotion(dx, dy);
    if (typeof p.connector.liveRot === 'number') {
      p.connector.liveRot = lerpAngleDeg(p.connector.liveRot, target, HEADING_SMOOTH);
    } else {
      p.connector.liveRot = target;
    }
  }

  /** Seat ferrule on port face; boot exits along locked axis (patch-cord seatEndAtPort). */
  function seatConnectorAtPort(p, portX, portY) {
    var rot = getConnRot(p);
    if (p.connector.attached && typeof p.connector.lockedRot !== 'number') {
      p.connector.lockedRot = rot;
      p.connector.attached.lockedRot = rot;
    }
    rot = getConnRot(p);
    var t = bootOutDir(rot);
    p.ax = portX + t.x * BOOT_EXIT_OFFSET;
    p.ay = portY + t.y * BOOT_EXIT_OFFSET;
  }

  /** Exact rear tip of the ribbed boot — fiber path must start here. */
  function bootAnchor(p) {
    return localToWorld(p.ax, p.ay, 0, BOOT_EXIT_OFFSET, getConnRot(p));
  }

  function unitVec(x, y) {
    var len = Math.sqrt(x * x + y * y) || 1;
    return { x: x / len, y: y / len };
  }

  /* ─── Hit tests ─── */

  function hitTestPort(clientX, clientY) {
    var list = document.elementsFromPoint
      ? document.elementsFromPoint(clientX, clientY)
      : [];
    var i;
    var el;
    var node;

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
        var pw = null;
        if (global.FtthLab && typeof FtthLab.getCouplerPortWorld === 'function') {
          pw = FtthLab.getCouplerPortWorld(cid, cport);
        }
        var wx;
        var wy;
        if (pw) {
          wx = pw.x;
          wy = pw.y;
        } else {
          var r3 = node.getBoundingClientRect();
          var c3 = clientToWorld(r3.left + r3.width / 2, r3.top + r3.height / 2);
          wx = c3.x;
          wy = c3.y;
        }
        return {
          owner: 'coupler',
          couplerId: cid,
          port: cport,
          polish: cPolish,
          label: 'SC Coupler ' + cport + ' · ' + (cPolish === 'APC' ? 'SC/APC' : 'SC/PC'),
          wx: wx,
          wy: wy,
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
            FtthLab.showAlert('OLP-38 accepts SC connectors only (SC Pigtail / Patch Cord).', 'warn');
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
    }
    return null;
  }

  /** Splice tray / termination parking points (ready for future trays). */
  function hitTestTailTarget(clientX, clientY) {
    var list = document.elementsFromPoint
      ? document.elementsFromPoint(clientX, clientY)
      : [];
    var i;
    var el;
    var node;
    for (i = 0; i < list.length; i++) {
      el = list[i];
      node = el.closest && el.closest(
        '.lab-splice-point, [data-lab-splice], .lab-term-point, [data-lab-term]'
      );
      if (!node) continue;
      var rect = node.getBoundingClientRect();
      var pt = clientToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
      var label = node.getAttribute('data-lab-splice') ||
        node.getAttribute('data-lab-term') ||
        node.getAttribute('title') ||
        'Splice / Term';
      return {
        owner: node.hasAttribute('data-lab-term') || node.classList.contains('lab-term-point')
          ? 'termination'
          : 'splice',
        label: label,
        wx: pt.x,
        wy: pt.y,
        el: node,
        spliceId: node.getAttribute('data-lab-splice') || null,
        termId: node.getAttribute('data-lab-term') || null,
      };
    }
    return null;
  }

  function attachConnector(p, hit) {
    if (!p || !hit) return;
    var mismatch = !polishMatch(p.polish, hit.polish);
    if (hit.owner === 'vfl') mismatch = false;
    if (hit.owner === 'vfl' && global.FtthLab && typeof FtthLab.detachPcordsFromVfl === 'function') {
      FtthLab.detachPcordsFromVfl(hit.vflId, null, null);
    }
    var lockedRot = resolveUprightPlugRotation(hit, p);
    p.connector.attached = {
      owner: hit.owner,
      polish: portPolishNorm(hit.polish) === 'APC' ? 'APC' : 'UPC',
      label: hit.label,
      splitterId: hit.splitterId || null,
      couplerId: hit.couplerId || null,
      vflId: hit.vflId || null,
      opmId: hit.opmId || null,
      port: hit.port || null,
      slot: hit.slot || null,
      oltPort: hit.oltPort || null,
      wx: hit.wx,
      wy: hit.wy,
      mismatch: mismatch,
      lockedRot: lockedRot,
    };
    p.connector.lockedRot = lockedRot;
    p.connector.liveRot = null;
    p.connector.mismatch = mismatch;
    var bx = p.bx;
    var by = p.by;
    seatConnectorAtPort(p, hit.wx, hit.wy);
    p.bx = bx;
    p.by = by;
    if (typeof p.fixedLength !== 'number') {
      var tip = bootAnchor(p);
      p.fixedLength = Math.max(40, dist2(tip.x, tip.y, p.bx, p.by));
    }
    if (mismatch) showWarning(MISMATCH_MSG);
    if (hit.el) {
      hit.el.classList.add('is-plug-click');
      setTimeout(function () { hit.el.classList.remove('is-plug-click'); }, 280);
    }
    setStatus(
      'Connector locked · ' + displayPolish(p.polish) + ' → ' + hit.label +
      (mismatch ? ' · mismatch +' + MISMATCH_PENALTY_DB + ' dB' : '')
    );
    if (global.FtthLab && typeof FtthLab.refreshVflLaser === 'function') {
      FtthLab.refreshVflLaser();
    }
    if (global.FtthLab && typeof FtthLab.refreshOpmDocks === 'function') {
      FtthLab.refreshOpmDocks();
    }
  }

  function detachConnector(p) {
    if (!p) return;
    p.connector.attached = null;
    p.connector.mismatch = false;
    p.connector.lockedRot = null;
    if (global.FtthLab && typeof FtthLab.refreshVflLaser === 'function') {
      FtthLab.refreshVflLaser();
    }
    if (global.FtthLab && typeof FtthLab.refreshOpmDocks === 'function') {
      FtthLab.refreshOpmDocks();
    }
  }

  function attachTail(p, hit) {
    if (!p || !hit) return;
    p.tail.attached = {
      owner: hit.owner,
      label: hit.label,
      spliceId: hit.spliceId,
      termId: hit.termId,
      wx: hit.wx,
      wy: hit.wy,
    };
    p.bx = hit.wx;
    p.by = hit.wy;
    if (hit.el) {
      hit.el.classList.add('is-tail-dock');
      setTimeout(function () { hit.el.classList.remove('is-tail-dock'); }, 280);
    }
    setStatus('Bare fiber parked · ' + hit.label);
  }

  function detachTail(p) {
    if (!p) return;
    p.tail.attached = null;
  }

  function syncAttached(p) {
    if (p.connector.attached) {
      var att = p.connector.attached;
      if (att.owner === 'coupler' && global.FtthLab &&
          typeof FtthLab.getCouplerPortWorld === 'function') {
        var pw = FtthLab.getCouplerPortWorld(att.couplerId, att.port);
        if (pw) {
          att.wx = pw.x;
          att.wy = pw.y;
          if (typeof p.connector.lockedRot !== 'number') {
            p.connector.lockedRot = typeof pw.rot === 'number' ? pw.rot : portAlignedRotation(att);
          }
          seatConnectorAtPort(p, pw.x, pw.y);
        }
      } else if (att.owner === 'olt') {
        var el = document.querySelector(
          '.lab-fx-port[data-lab-slot="' + att.slot + '"][data-lab-sfp="' + att.oltPort + '"]'
        );
        if (el) {
          var cage = el.querySelector('.lab-fx-port__cage') || el;
          var rect = cage.getBoundingClientRect();
          var pt = clientToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
          att.wx = pt.x;
          att.wy = pt.y;
          seatConnectorAtPort(p, pt.x, pt.y);
        }
      } else if (att.owner === 'splitter') {
        var el2 = document.querySelector(
          '.lab-cas-port[data-spl-id="' + att.splitterId + '"][data-spl-port="' + att.port + '"]'
        );
        if (el2) {
          var face = el2.querySelector('i') || el2;
          var r2 = face.getBoundingClientRect();
          var pt2 = clientToWorld(r2.left + r2.width / 2, r2.top + r2.height / 2);
          att.wx = pt2.x;
          att.wy = pt2.y;
          seatConnectorAtPort(p, pt2.x, pt2.y);
        }
      } else if (att.owner === 'vfl') {
        var pwV = null;
        if (global.FtthLab && typeof FtthLab.getVflPortWorld === 'function') {
          pwV = FtthLab.getVflPortWorld(att.vflId);
        }
        if (pwV) {
          att.wx = pwV.x;
          att.wy = pwV.y;
          if (typeof p.connector.lockedRot !== 'number') {
            p.connector.lockedRot = typeof pwV.rot === 'number' ? pwV.rot : 180;
          }
          seatConnectorAtPort(p, pwV.x, pwV.y);
        }
      } else if (att.owner === 'opm') {
        var pwO = null;
        if (global.FtthLab && typeof FtthLab.getOpmPortWorld === 'function') {
          pwO = FtthLab.getOpmPortWorld(att.opmId);
        }
        if (pwO) {
          att.wx = pwO.x;
          att.wy = pwO.y;
          if (typeof p.connector.lockedRot !== 'number') {
            p.connector.lockedRot = typeof pwO.rot === 'number' ? pwO.rot : 0;
          }
          seatConnectorAtPort(p, pwO.x, pwO.y);
        }
      }
    }
    if (p.tail.attached) {
      var tAtt = p.tail.attached;
      var sel = null;
      if (tAtt.spliceId) {
        sel = document.querySelector(
          '[data-lab-splice="' + tAtt.spliceId + '"], .lab-splice-point[data-lab-splice="' +
          tAtt.spliceId + '"]'
        );
      } else if (tAtt.termId) {
        sel = document.querySelector(
          '[data-lab-term="' + tAtt.termId + '"], .lab-term-point[data-lab-term="' +
          tAtt.termId + '"]'
        );
      }
      if (sel) {
        var tr = sel.getBoundingClientRect();
        var tp = clientToWorld(tr.left + tr.width / 2, tr.top + tr.height / 2);
        tAtt.wx = tp.x;
        tAtt.wy = tp.y;
        p.bx = tp.x;
        p.by = tp.y;
      } else if (typeof tAtt.wx === 'number') {
        p.bx = tAtt.wx;
        p.by = tAtt.wy;
      }
    }
  }

  /* ─── Path / render — continuous downward catenary (all states) ─── */

  function pigtailSlackFactor() {
    return (global.FtthLab && FtthLab.CATENARY_DEFAULT_SLACK) || PIGTAIL_CATENARY_SLACK;
  }

  /** Dense hanging samples between two world points (shared FtthLab sampler preferred). */
  function samplePigtailCatenary(p0, p3, length, count) {
    count = Math.max(2, count || PIGTAIL_CATENARY_SAMPLES);
    if (global.FtthLab && typeof FtthLab.sampleFiberCatenary === 'function') {
      return FtthLab.sampleFiberCatenary(p0, p3, length, count);
    }
    /* Parabolic hang fallback before patch-cord mounts (screen Y+ down). */
    var chord = dist2(p0.x, p0.y, p3.x, p3.y) || 1;
    var L = Math.max(length || chord * pigtailSlackFactor(), chord * 1.0002);
    var excess = Math.max(0, L - chord);
    var sag = Math.sqrt(Math.max(0, excess * chord * 0.5)) * 0.45;
    if (sag < 6) sag = Math.min(36, chord * 0.14);
    var pts = [];
    var i;
    for (i = 0; i < count; i++) {
      var t = count === 1 ? 0.5 : i / (count - 1);
      var x = p0.x + (p3.x - p0.x) * t;
      var y = p0.y + (p3.y - p0.y) * t + 4 * sag * t * (1 - t);
      pts.push({ x: x, y: y });
    }
    pts[0] = { x: p0.x, y: p0.y };
    pts[count - 1] = { x: p3.x, y: p3.y };
    return pts;
  }

  /**
   * Arc length for render: locked length, else traced route length, else natural slack.
   * Route / freehand ink never becomes the drawn polyline — only length / sag intent.
   */
  function resolvePigtailRenderLength(p, p0, tipB) {
    var chord = dist2(p0.x, p0.y, tipB.x, tipB.y) || 1;
    if (typeof p.fixedLength === 'number' && p.fixedLength > 0) {
      return Math.max(p.fixedLength, chord * 1.0002);
    }
    if (p.route && p.route.length) {
      var poly = [{ x: p0.x, y: p0.y }].concat(p.route).concat([{ x: tipB.x, y: tipB.y }]);
      var len = 0;
      var i;
      for (i = 1; i < poly.length; i++) {
        len += dist2(poly[i - 1].x, poly[i - 1].y, poly[i].x, poly[i].y);
      }
      return Math.max(len, chord * pigtailSlackFactor(), chord * 1.0002);
    }
    var slack = pigtailSlackFactor();
    var sagFn = global.FtthLab && FtthLab.fiberCatenarySagDepth;
    var lenFn = global.FtthLab && FtthLab.fiberCatenaryLengthForSag;
    if (typeof sagFn === 'function' && typeof lenFn === 'function') {
      return Math.max(chord * slack, lenFn(p0, tipB, sagFn(chord)));
    }
    return Math.max(chord * slack, chord * 1.0002);
  }

  /**
   * Fiber starts at boot rear tip, short axial strain-relief stub, then a
   * continuous gravitational catenary to the bare tip — Free Draw, Meter,
   * drag, and plugged states all use the same curve (never straight / jagged).
   */
  function fiberPath(p) {
    var tipA = bootAnchor(p);
    var tA = bootOutDir(getConnRot(p));
    var tipB = { x: p.bx, y: p.by };
    var stub = Math.max(STRAIN_RELIEF_PX * 0.55, BOOT_EXIT_STUB);
    var p0 = {
      x: tipA.x + tA.x * stub,
      y: tipA.y + tA.y * stub,
    };
    var L = resolvePigtailRenderLength(p, p0, tipB);
    var mid = samplePigtailCatenary(p0, tipB, L, PIGTAIL_CATENARY_SAMPLES);
    var d = 'M ' + tipA.x + ' ' + tipA.y + ' L ' + p0.x + ' ' + p0.y;
    var i;
    for (i = 1; i < mid.length - 1; i++) {
      d += ' L ' + mid[i].x + ' ' + mid[i].y;
    }
    d += ' L ' + tipB.x + ' ' + tipB.y;
    return d;
  }

  function connectorStyle(p) {
    var rot = getConnRot(p);
    return (
      'left:' + Math.round(p.ax - END_W / 2) + 'px;' +
      'top:' + Math.round(p.ay - END_H / 2) + 'px;' +
      'transform-origin:50% 50%;' +
      'transform:rotate(' + rot.toFixed(2) + 'deg)'
    );
  }

  function tailStyle(p) {
    /* Buffer (top/−Y) faces connector; cleave (+Y) faces away — +180 vs endRotationDeg */
    var rot = endRotationDeg(p.bx, p.by, p.ax, p.ay) + 180;
    return (
      'left:' + Math.round(p.bx - TAIL_W / 2) + 'px;' +
      'top:' + Math.round(p.by - TAIL_H / 2) + 'px;' +
      'transform-origin:50% 50%;' +
      'transform:rotate(' + rot.toFixed(2) + 'deg)'
    );
  }

  function ensureLayer() {
    if (layer && layer.parentNode) return layer;
    var mount = document.getElementById('lab-2d-mount');
    if (!mount) return null;
    layer = document.createElement('div');
    layer.className = 'lab-pigtail-layer';
    layer.setAttribute('data-lab-pigtail-layer', '1');
    mount.appendChild(layer);
    return layer;
  }

  function rebuildLayer() {
    var host = ensureLayer();
    if (!host) return;
    pigtails.forEach(syncAttached);

    var html =
      '<svg class="lab-pigtail-svg" aria-hidden="true">' +
      '<defs>' +
      '<filter id="lab-vfl-core-beam-pt" x="-30%" y="-30%" width="160%" height="160%">' +
      '<feGaussianBlur in="SourceGraphic" stdDeviation="0.55" result="blur"/>' +
      '<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '</defs>';
    pigtails.forEach(function (p) {
      var path = fiberPath(p);
      var bad = p.connector.mismatch;
      var sel = selection.id === p.id ? ' is-selected' : '';
      html +=
        '<path class="lab-pigtail-fiber-hit" data-pt-drag="' + p.id + '" d="' + path +
        '" fill="none" />' +
        '<path class="lab-pigtail-fiber' + (bad ? ' is-mismatch' : '') + sel +
        '" data-pt-fiber="' + p.id + '" d="' + path + '" fill="none" />' +
        '<path class="lab-pigtail-laser-core" data-pt-laser="' + p.id + '" d="' + path +
        '" fill="none" />';
    });
    html += '</svg>';

    pigtails.forEach(function (p) {
      var selected = selection.id === p.id ? ' is-selected' : '';
      html +=
        '<div class="lab-pigtail' + selected + '" data-pt-node="' + p.id + '">' +
        '<button type="button" class="lab-pigtail__conn lab-pcord__end ' +
        (normalizePolish(p.polish) === 'APC' ? 'is-apc' : 'is-pc') +
        (p.connector.attached ? ' is-attached' : '') +
        (p.connector.mismatch ? ' is-mismatch' : '') +
        '" data-pt-id="' + p.id + '" data-pt-end="A" style="' + connectorStyle(p) + '" ' +
        'title="SC connector · ' + displayPolish(p.polish) +
        (p.connector.attached ? ' · plugged' : ' · drag to port') + '" ' +
        'aria-label="SC pigtail connector">' +
        '<span class="lab-pcord__housing" aria-hidden="true"><i class="lab-pcord__ferrule"></i></span>' +
        '<span class="lab-pcord__boot" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>' +
        '<b class="lab-pcord__mark">A</b>' +
        '</button>' +
        '<button type="button" class="lab-pigtail__tail' +
        (p.tail.attached ? ' is-attached' : '') +
        '" data-pt-id="' + p.id + '" data-pt-end="B" style="' + tailStyle(p) + '" ' +
        'title="Bare fiber · splice / termination" aria-label="Bare fiber tail">' +
        '<span class="lab-pigtail__buffer" aria-hidden="true"></span>' +
        '<span class="lab-pigtail__cleave" aria-hidden="true"></span>' +
        '<span class="lab-vfl-exit-flare lab-vfl-exit-flare--tail" aria-hidden="true">' +
        '<i class="lab-vfl-exit-flare__aura"></i>' +
        '<i class="lab-vfl-exit-flare__hot"></i>' +
        '</span>' +
        '</button>' +
        '</div>';
    });

    host.innerHTML = html;
    bindLayerEvents(host);
    reapplyStoredVflGlow();
  }

  function updateFiberPath(p) {
    if (!layer) return;
    var d = fiberPath(p);
    var path = layer.querySelector('[data-pt-fiber="' + p.id + '"]');
    var hit = layer.querySelector('.lab-pigtail-fiber-hit[data-pt-drag="' + p.id + '"]');
    var laser = layer.querySelector('[data-pt-laser="' + p.id + '"]');
    if (path) path.setAttribute('d', d);
    if (hit) hit.setAttribute('d', d);
    if (laser) laser.setAttribute('d', d);
    var aBtn = layer.querySelector('[data-pt-id="' + p.id + '"][data-pt-end="A"]');
    var bBtn = layer.querySelector('[data-pt-id="' + p.id + '"][data-pt-end="B"]');
    if (aBtn) aBtn.setAttribute('style', connectorStyle(p));
    if (bBtn) bBtn.setAttribute('style', tailStyle(p));
  }

  function clearPlugHighlights() {
    document.querySelectorAll(
      '.lab-fx-port.is-plug-target, .lab-cas-port.is-plug-target, .lab-cpl-port.is-plug-target, ' +
      '.lab-vfl-port.is-plug-target, .lab-opm-port.is-plug-target, .lab-splice-point.is-plug-target, .lab-term-point.is-plug-target, ' +
      '[data-lab-splice].is-plug-target, [data-lab-term].is-plug-target'
    ).forEach(function (n) { n.classList.remove('is-plug-target'); });
  }

  function highlightPort(el) {
    clearPlugHighlights();
    if (el) el.classList.add('is-plug-target');
  }

  function bindLayerEvents(host) {
    host.querySelectorAll('[data-pt-node]').forEach(function (node) {
      node.addEventListener('click', function (e) {
        if (e.target.closest('[data-pt-end]') || e.target.closest('[data-pt-drag]')) return;
        e.stopPropagation();
        selectPigtail(node.getAttribute('data-pt-node'));
      });
    });

    host.querySelectorAll('[data-pt-drag]').forEach(function (grip) {
      grip.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        var id = grip.getAttribute('data-pt-drag');
        var p = findPigtail(id);
        if (!p) return;
        selectPigtail(id);
        if (p.connector.attached && p.tail.attached) {
          setStatus('Both ends parked · drag connector or bare tip to move');
          return;
        }
        if (p.connector.attached || p.tail.attached) {
          setStatus('Drag the free end (connector or bare tip)');
          return;
        }
        var zoom = getZoom() || 1;
        var sx = e.clientX;
        var sy = e.clientY;
        var oax = p.ax;
        var oay = p.ay;
        var obx = p.bx;
        var oby = p.by;
        function onMove(ev) {
          var dx = (ev.clientX - sx) / zoom;
          var dy = (ev.clientY - sy) / zoom;
          p.ax = oax + dx;
          p.ay = oay + dy;
          p.bx = obx + dx;
          p.by = oby + dy;
          updateFiberPath(p);
        }
        function onUp() {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          pushHistory();
        }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    });

    /* Connector drag / plug */
    host.querySelectorAll('[data-pt-end="A"]').forEach(function (btn) {
      btn.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        var id = btn.getAttribute('data-pt-id');
        var p = findPigtail(id);
        if (!p) return;
        selectPigtail(id);

        var zoom = getZoom() || 1;
        var sx = e.clientX;
        var sy = e.clientY;
        var oax = p.ax;
        var oay = p.ay;
        var home = p.connector.attached
          ? { x: p.connector.attached.wx, y: p.connector.attached.wy }
          : null;
        var unplugged = false;
        var moved = false;
        btn.classList.add('is-dragging');
        document.body.classList.add('lab-pigtail-dragging');
        try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }

        function onMove(ev) {
          moved = true;
          var dx = (ev.clientX - sx) / zoom;
          var dy = (ev.clientY - sy) / zoom;
          if (p.connector.attached && !unplugged) {
            var pull = dist2(0, 0, dx, dy);
            if (pull < UNPLUG_PULL_PX) {
              seatConnectorAtPort(p, home.x, home.y);
              updateFiberPath(p);
              return;
            }
            detachConnector(p);
            unplugged = true;
            btn.classList.remove('is-attached');
            setStatus('Connector free · release on a port to plug');
          }
          p.ax = oax + dx;
          p.ay = oay + dy;
          updateLiveHeading(p, dx, dy);
          var hit = hitTestPort(ev.clientX, ev.clientY);
          highlightPort(hit && hit.el);
          updateFiberPath(p);
        }

        function onUp(ev) {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
          try { btn.releasePointerCapture(ev.pointerId); } catch (err2) { /* ignore */ }
          btn.classList.remove('is-dragging');
          document.body.classList.remove('lab-pigtail-dragging');
          clearPlugHighlights();
          p.connector.liveRot = null;

          if (!p.connector.attached) {
            var hit = hitTestPort(ev.clientX, ev.clientY);
            if (hit && dist2(p.ax, p.ay, hit.wx, hit.wy) < PLUG_SNAP_PX * 3) {
              attachConnector(p, hit);
            } else if (home && unplugged && !moved) {
              /* noop */
            }
          }
          rebuildLayer();
          updateInspector();
          if (moved || unplugged) pushHistory();
          refreshBudget();
        }

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
      });
    });

    /* Bare tip drag / dock */
    host.querySelectorAll('[data-pt-end="B"]').forEach(function (btn) {
      btn.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        var id = btn.getAttribute('data-pt-id');
        var p = findPigtail(id);
        if (!p) return;
        selectPigtail(id);

        var zoom = getZoom() || 1;
        var sx = e.clientX;
        var sy = e.clientY;
        var obx = p.bx;
        var oby = p.by;
        var home = p.tail.attached
          ? { x: p.tail.attached.wx, y: p.tail.attached.wy }
          : null;
        var undocked = false;
        var moved = false;
        btn.classList.add('is-dragging');
        document.body.classList.add('lab-pigtail-dragging');

        function onMove(ev) {
          moved = true;
          var dx = (ev.clientX - sx) / zoom;
          var dy = (ev.clientY - sy) / zoom;
          if (p.tail.attached && !undocked) {
            if (dist2(0, 0, dx, dy) < TAIL_SNAP_PX) {
              p.bx = home.x;
              p.by = home.y;
              updateFiberPath(p);
              return;
            }
            detachTail(p);
            undocked = true;
            btn.classList.remove('is-attached');
            setStatus('Bare tip free · release on a splice / termination point');
          }
          p.bx = obx + dx;
          p.by = oby + dy;
          var hit = hitTestTailTarget(ev.clientX, ev.clientY);
          highlightPort(hit && hit.el);
          updateFiberPath(p);
        }

        function onUp(ev) {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
          btn.classList.remove('is-dragging');
          document.body.classList.remove('lab-pigtail-dragging');
          clearPlugHighlights();

          if (!p.tail.attached) {
            var hit = hitTestTailTarget(ev.clientX, ev.clientY);
            if (hit) attachTail(p, hit);
          }
          rebuildLayer();
          updateInspector();
          if (moved || undocked) pushHistory();
        }

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
      });
    });
  }

  /* ─── Toolbox ─── */

  function renderToolbox() {
    var host = document.getElementById('lab-pigtail-tree');
    if (!host) return;
    host.innerHTML =
      '<div class="lab-toolbox" role="list">' +
      '<button type="button" class="lab-tool lab-tool--pigtail' +
      (selectedTool === 'pigtail' ? ' is-selected' : '') +
      '" draggable="true" data-lab-tool="pigtail" role="listitem">' +
      '<span class="lab-tool__mark lab-tool__mark--pigtail" aria-hidden="true"></span>' +
      '<span class="lab-tool__copy">' +
      '<strong>SC Pigtail</strong>' +
      '<span>SC connector + bare fiber</span>' +
      '</span>' +
      '</button>' +
      '</div>';
    bindToolbox(host);
  }

  function bindToolbox(host) {
    var btn = host.querySelector('[data-lab-tool="pigtail"]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('sc-pigtail');
      }
      selectedTool = 'pigtail';
      renderToolbox();
      setStatus('SC Pigtail · drag onto canvas · plug connector · park bare tip on splice/term');
    });
    btn.addEventListener('dragstart', function (e) {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('sc-pigtail');
      }
      selectedTool = 'pigtail';
      dragLib = { kind: 'pigtail' };
      if (global.FtthLab && FtthLab.beginDrag) FtthLab.beginDrag({ kind: 'pigtail' });
      try {
        e.dataTransfer.setData('text/plain', 'lab:pigtail');
        e.dataTransfer.setData('text/lab-drag', 'pigtail');
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
      if (!el || el.dataset.pigtailDrop === '1') return;
      el.dataset.pigtailDrop = '1';
      el.addEventListener('dragover', function (e) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        if (!((dragLib && dragLib.kind === 'pigtail') || (active && active.kind === 'pigtail'))) {
          return;
        }
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      });
      el.addEventListener('drop', function (e) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        var kind = (e.dataTransfer && e.dataTransfer.getData('text/lab-drag')) ||
          (active && active.kind) || (dragLib && dragLib.kind) || '';
        if (kind !== 'pigtail') return;
        e.preventDefault();
        e.stopPropagation();
        dragLib = null;
        if (global.FtthLab && FtthLab.endDrag) FtthLab.endDrag();
        selectedTool = 'pigtail';
        var pt = clientToWorld(e.clientX, e.clientY);
        placePigtail(Math.round(pt.x - 8), Math.round(pt.y - 10));
      });
    });
  }

  /* ─── Inspector / budget ─── */

  function pigtailLossDb(p) {
    if (!p.connector.attached) return 0;
    var loss = MATCHED_CONNECTOR_DB;
    if (p.connector.mismatch) loss += MISMATCH_PENALTY_DB;
    return loss;
  }

  function getNetworkLossDb() {
    var sum = 0;
    pigtails.forEach(function (p) { sum += pigtailLossDb(p); });
    return Math.round(sum * 100) / 100;
  }

  function getMismatchCount() {
    var n = 0;
    pigtails.forEach(function (p) {
      if (p.connector.attached && p.connector.mismatch) n += 1;
    });
    return n;
  }

  function refreshBudget() {
    if (global.FtthLab && typeof FtthLab.refreshPowerBudget === 'function') {
      FtthLab.refreshPowerBudget();
    }
  }

  function pigtailFiberLengthM(p) {
    if (!p) return 0;
    if (typeof p.fixedLength === 'number' && p.fixedLength > 0) {
      var ppm = 160;
      if (global.FtthLab && typeof FtthLab.worldPxToMeters === 'function') {
        return FtthLab.worldPxToMeters(p.fixedLength);
      }
      return p.fixedLength / ppm;
    }
    var dx = p.bx - p.ax;
    var dy = p.by - p.ay;
    var lenPx = Math.sqrt(dx * dx + dy * dy);
    if (global.FtthLab && typeof FtthLab.worldPxToMeters === 'function') {
      return FtthLab.worldPxToMeters(lenPx);
    }
    return lenPx / 160;
  }

  function getLaserGraphNodes() {
    return pigtails.map(function (p) {
      return {
        id: p.id,
        connector: p.connector.attached
          ? {
              owner: p.connector.attached.owner,
              couplerId: p.connector.attached.couplerId || null,
              vflId: p.connector.attached.vflId || null,
              opmId: p.connector.attached.opmId || null,
              splitterId: p.connector.attached.splitterId || null,
              port: p.connector.attached.port || null,
              slot: p.connector.attached.slot != null ? p.connector.attached.slot : null,
              oltPort: p.connector.attached.oltPort != null ? p.connector.attached.oltPort : null,
            }
          : null,
        tail: p.tail.attached
          ? {
              owner: p.tail.attached.owner,
              spliceId: p.tail.attached.spliceId || null,
              termId: p.tail.attached.termId || null,
            }
          : null,
        fiberLengthM: pigtailFiberLengthM(p),
      };
    });
  }

  function applyLaserGlow(ids, mode, meta) {
    meta = meta || {};
    var map = {};
    var exits = meta.pigtailExits || {};
    (ids || []).forEach(function (id) { map[id] = true; });
    if (!mode && global.FtthLab && FtthLab._vflGlow) mode = FtthLab._vflGlow.mode;
    mode = String(mode || 'OFF').toUpperCase();
    if (!layer) return;

    layer.querySelectorAll('[data-pt-fiber]').forEach(function (el) {
      el.classList.remove('is-vfl-glow', 'is-vfl-glow--cw', 'is-vfl-glow--glint');
    });

    layer.querySelectorAll('[data-pt-laser]').forEach(function (el) {
      var id = el.getAttribute('data-pt-laser');
      var on = !!map[id] && mode !== 'OFF';
      el.classList.remove('is-vfl-glow', 'is-vfl-glow--cw', 'is-vfl-glow--glint');
      if (!on) return;
      el.classList.add('is-vfl-glow');
      el.classList.add(mode === 'GLINT' ? 'is-vfl-glow--glint' : 'is-vfl-glow--cw');
    });

    layer.querySelectorAll('[data-pt-id][data-pt-end]').forEach(function (el) {
      var id = el.getAttribute('data-pt-id');
      var end = el.getAttribute('data-pt-end');
      el.classList.remove('is-vfl-laser-exit', 'is-vfl-laser-exit--cw', 'is-vfl-laser-exit--glint');
      if (map[id] && exits[id] === end && mode !== 'OFF' && !el.classList.contains('is-attached')) {
        el.classList.add('is-vfl-laser-exit');
        el.classList.add(mode === 'GLINT' ? 'is-vfl-laser-exit--glint' : 'is-vfl-laser-exit--cw');
      }
    });
  }

  function reapplyStoredVflGlow() {
    var glow = global.FtthLab && FtthLab._vflGlow;
    if (glow) applyLaserGlow(glow.pigtails, glow.mode, { pigtailExits: glow.pigtailExits });
  }

  function updateInspector() {
    var card = document.getElementById('lab-inspector-card');
    var detail = document.getElementById('lab-inspector-detail');
    if (!card) return;
    if (selection.kind !== 'pigtail' || !selection.id) return;
    var p = findPigtail(selection.id);
    if (!p) return;

    var isApc = normalizePolish(p.polish) === 'APC';
    var loss = pigtailLossDb(p);
    card.innerHTML =
      '<h2>SC Pigtail</h2>' +
      '<p>One SC connector + bare fiber for splice or termination.</p>';

    if (!detail) return;
    detail.hidden = false;
    detail.innerHTML =
      '<div class="lab-pigtail-config">' +
      '<p class="lab-inspector__label">Connector polish</p>' +
      '<div class="lab-polish-toggle" role="group">' +
      '<button type="button" class="lab-polish-btn is-upc' + (!isApc ? ' is-active' : '') +
      '" data-pt-polish="' + p.id + ':PC">SC/PC · Blue</button>' +
      '<button type="button" class="lab-polish-btn is-apc' + (isApc ? ' is-active' : '') +
      '" data-pt-polish="' + p.id + ':APC">SC/APC · Green</button>' +
      '</div>' +
      '<p class="lab-pcord-attach' + (p.connector.mismatch ? ' is-warn' : '') + '">' +
      (p.connector.attached
        ? 'A → ' + p.connector.attached.label +
          (p.connector.mismatch ? ' · MISMATCH +' + MISMATCH_PENALTY_DB + ' dB' : '')
        : 'A · unplugged') +
      '</p>' +
      '<p class="lab-pcord-attach">' +
      (p.tail.attached
        ? 'Tail → ' + p.tail.attached.label
        : 'Tail · free · dock on splice / termination') +
      '</p>' +
      '<div class="lab-spl-sheet">' +
      '<div><span>Type</span><strong class="' +
      (isApc ? 'is-apc-text' : 'is-upc-text') + '">' + displayPolish(p.polish) +
      '</strong></div>' +
      '<div><span>Ends</span><strong>SC · Bare</strong></div>' +
      '<div><span>IL</span><strong>' +
      (p.connector.attached ? loss.toFixed(2) + ' dB' : '—') +
      '</strong></div>' +
      '</div>' +
      '<button type="button" class="lab-eject-btn" data-remove-pt="' + p.id +
      '">Remove Pigtail</button>' +
      '</div>';

    detail.querySelectorAll('[data-pt-polish]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var parts = btn.getAttribute('data-pt-polish').split(':');
        setConnectorPolish(parts[0], parts[1]);
      });
    });
    var rm = detail.querySelector('[data-remove-pt]');
    if (rm) {
      rm.addEventListener('click', function () {
        removePigtail(p.id);
        if (global.FtthLab && typeof FtthLab.resetInspectorIdle === 'function') {
          FtthLab.resetInspectorIdle();
        }
      });
    }
  }

  function onLayoutChange(payload) {
    if (!layer) return;
    var onlyCoupler = payload && payload.source === 'coupler' ? payload.couplerId : null;
    var onlyVfl = payload && payload.source === 'vfl' ? payload.vflId : null;
    pigtails.forEach(function (p) {
      if (onlyCoupler) {
        var on = p.connector.attached && p.connector.attached.owner === 'coupler' &&
          p.connector.attached.couplerId === onlyCoupler;
        if (!on) return;
      }
      if (onlyVfl) {
        var onV = p.connector.attached && p.connector.attached.owner === 'vfl' &&
          p.connector.attached.vflId === onlyVfl;
        if (!onV) return;
      }
      var oax = p.ax;
      var oay = p.ay;
      syncAttached(p);
      var dax = p.ax - oax;
      var day = p.ay - oay;
      if ((dax || day) && !p.tail.attached) {
        /* Keep bare tip planted when only connector moves with equipment */
      }
      updateFiberPath(p);
    });
  }

  function refreshCouplerPolish(couplerId, polish) {
    polish = portPolishNorm(polish) === 'APC' ? 'APC' : 'UPC';
    var warned = false;
    pigtails.forEach(function (p) {
      if (!p.connector.attached || p.connector.attached.owner !== 'coupler') return;
      if (p.connector.attached.couplerId !== couplerId) return;
      p.connector.attached.polish = polish;
      p.connector.attached.label =
        'SC Coupler ' + p.connector.attached.port + ' · ' +
        (polish === 'APC' ? 'SC/APC' : 'SC/PC');
      p.connector.mismatch = !polishMatch(p.polish, polish);
      p.connector.attached.mismatch = p.connector.mismatch;
      if (p.connector.mismatch) warned = true;
    });
    if (warned) showWarning(MISMATCH_MSG);
    rebuildLayer();
    updateInspector();
    refreshBudget();
  }

  function detachPortsForCoupler(couplerId) {
    var changed = false;
    pigtails.forEach(function (p) {
      if (!p.connector.attached || p.connector.attached.owner !== 'coupler') return;
      if (p.connector.attached.couplerId !== couplerId) return;
      detachConnector(p);
      changed = true;
    });
    if (changed) {
      rebuildLayer();
      updateInspector();
      refreshBudget();
    }
  }

  function deleteSelected() {
    if (selection.kind === 'pigtail' && selection.id) {
      removePigtail(selection.id);
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

  function cancelPatch() { /* pigtails have no dual-state link session */ }

  function onToolboxClaim(payload) {
    var id = payload && payload.toolId;
    if (id === 'sc-pigtail') return;
    if (selectedTool) {
      selectedTool = null;
      renderToolbox();
    }
  }

  function onViewChange() {
    rebuildLayer();
  }

  function detachPigtailsFromVfl(vflId, exceptId) {
    pigtails.forEach(function (p) {
      if (p.id === exceptId) return;
      if (p.connector.attached && p.connector.attached.owner === 'vfl' &&
          p.connector.attached.vflId === vflId) {
        detachConnector(p);
      }
    });
    rebuildLayer();
    refreshBudget();
  }

  /** Rigid group translate for pigtails plugged into a VFL port. */
  function translateForVfl(vflId, dx, dy, opts) {
    opts = opts || {};
    if (!dx && !dy) return;
    var changed = false;
    pigtails.forEach(function (p) {
      if (!p.connector.attached || p.connector.attached.owner !== 'vfl' ||
          p.connector.attached.vflId !== vflId) return;
      changed = true;
      p.ax += dx;
      p.ay += dy;
      p.bx += dx;
      p.by += dy;
      if (p.route && p.route.length) {
        p.route.forEach(function (pt) {
          pt.x += dx;
          pt.y += dy;
        });
      }
      syncAttached(p);
      if (opts.live) updateFiberPath(p);
    });
    if (changed && !opts.live) rebuildLayer();
    if (changed && global.FtthLab && typeof FtthLab.refreshVflLaser === 'function') {
      FtthLab.refreshVflLaser();
    }
  }

  function mount(api) {
    ctx = api || {};
    pigtails = [];
    seq = 0;
    history = [];
    historyIndex = -1;
    historyLocked = false;
    selection = { kind: 'none', id: null };
    selectedTool = null;
    dragLib = null;
    renderToolbox();
    bindStageDrop();
    ensureLayer();
    rebuildLayer();
    pushHistory();
    refreshBudget();

    if (global.FtthLab) {
      var prevRefresh = FtthLab.refreshCouplerPolish;
      FtthLab.refreshCouplerPolish = function (couplerId, polish) {
        refreshCouplerPolish(couplerId, polish);
        if (typeof prevRefresh === 'function' && prevRefresh !== refreshCouplerPolish) {
          prevRefresh(couplerId, polish);
        }
      };
      var prevDetach = FtthLab.detachPortsForCoupler;
      FtthLab.detachPortsForCoupler = function (couplerId) {
        detachPortsForCoupler(couplerId);
        if (typeof prevDetach === 'function' && prevDetach !== detachPortsForCoupler) {
          prevDetach(couplerId);
        }
      };

      FtthLab.detachPigtailsFromVfl = detachPigtailsFromVfl;

      var prevTranslate = FtthLab.translateVflGroup;
      FtthLab.translateVflGroup = function (vflId, dx, dy, opts) {
        if (typeof prevTranslate === 'function' && prevTranslate !== translateForVfl) {
          prevTranslate(vflId, dx, dy, opts);
        }
        translateForVfl(vflId, dx, dy, opts);
      };

      var prevGraph = FtthLab.getFiberLaserGraph;
      FtthLab.getFiberLaserGraph = function () {
        var base = typeof prevGraph === 'function'
          ? (prevGraph() || { pcords: [], pigtails: [] })
          : { pcords: [], pigtails: [] };
        base.pigtails = getLaserGraphNodes();
        return base;
      };

      var prevGlow = FtthLab.applyFiberLaserGlow;
      FtthLab.applyFiberLaserGlow = function (targets) {
        if (typeof prevGlow === 'function') prevGlow(targets);
        applyLaserGlow(
          targets && targets.pigtails,
          targets && targets.mode,
          { pigtailExits: targets && targets.pigtailExits }
        );
      };
    }
  }

  var tool = {
    id: 'sc-pigtail',
    mount: mount,
    onViewChange: onViewChange,
    onLayoutChange: onLayoutChange,
    undo: undo,
    redo: redo,
    deleteSelected: deleteSelected,
    clearSelection: clearSelection,
    cancelPatch: cancelPatch,
    onToolboxClaim: onToolboxClaim,
    getNetworkLossDb: getNetworkLossDb,
    getMismatchCount: getMismatchCount,
    getLaserGraphNodes: getLaserGraphNodes,
    applyLaserGlow: applyLaserGlow,
    translateForVfl: translateForVfl,
  };

  function tryRegister() {
    if (global.FtthLab && typeof FtthLab.registerTool === 'function') {
      FtthLab.registerTool('sc-pigtail', tool);
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
