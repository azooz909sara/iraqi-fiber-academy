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
  var MISMATCH_PENALTY_DB = 3.0;
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
  var OLS_MAGNET_SNAP_PX = 56;
  var OLS_MAGNET_LOCK_PX = 30;
  var TAIL_SNAP_PX = 18;
  var TAIL_W = 10;
  var TAIL_H = 16;
  var HEADING_MIN_PX = 2.5;
  var HEADING_SMOOTH = 0.42;
  var HISTORY_MAX = 60;
  var PIGTAIL_CATENARY_SAMPLES = 48;
  var PIGTAIL_CATENARY_SLACK = 1.12;
  var SLEEVE_MOUNT_PROX_PX = 25;
  var SLEEVE_EJECT_PULL_PX = 14;
  var STRIP_CLAMP_PROX_PX = 6;
  /** Hard max distance from cutting notch to fiber centerline for clamp/strip. */
  var STRIP_NOTCH_HIT_PX = 6;
  /** Ephemeral peel animation scale (px dragged per full peel = 1). */
  var STRIP_PEEL_ANIM_PX = 18;
  /** Bare tip zone for cleaver V-groove alignment. */
  var CLEAVE_TIP_ZONE_PX = 52;
  var CLEAVE_HIT_PX = 8;
  var CLEAVE_WASTE_PX = 16;
  var CLEAVE_MIN_CUT_PX = 2;
  var BLADE_HIT_RADIUS_PX = 20;
  /** Dropzone highlight radius (fiber tip → cleaver groove). Snap occurs on release only. */
  var CLEAVER_SNAP_PX = 40;
  /** Pointer → silver `.clamp-base-groove` center (world px); live pull + lock on release. */
  var SPLICER_SNAP_PX = 40;
  var SPLICER_UNDOCK_PX = 22;
  /** Jacket frontier must not cross ruler stop beyond this tolerance (world px). */
  var RULER_WALL_EPS = 0.75;
  /** Orthogonal snake: adaptive primary-axis preview + fillet corners. */
  var ORTHO_FILLET_R = 16;
  var ORTHO_TURN_PX = 10;
  var ORTHO_MIN_SEG = 8;
  var ORTHO_BACKTRACK_PX = 8;
  /** Initial free length: connector (left) → bare tip (right), same Y. */
  var SPAWN_LEN_PX = 120;

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

  function getSleeveSizePx() {
    if (global.FtthLab && typeof FtthLab.getSleeveSizePx === 'function') {
      return FtthLab.getSleeveSizePx();
    }
    return { w: 56, h: 8 };
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

  /**
   * Sleeve long axis parallel to fiber tangent (CSS y+ down).
   * headingRotFromMotion is +90° off — do not use for sleeve alignment.
   */
  function fiberPathTangentRotDeg(dx, dy) {
    if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) return 0;
    return Math.atan2(dy, dx) * 180 / Math.PI;
  }

  /** Angled OLT SFP tier: the seat axis is baked into the port element. */
  function oltPortSeatRotation(hit) {
    var el = hit && hit.el;
    var node = el && el.closest ? el.closest('.lab-fx-port') : null;
    if (!node) return null;
    var v = Number(node.getAttribute('data-lab-port-rot'));
    return isFinite(v) ? v : null;
  }

  function portAlignedRotation(hit) {
    if (hit && hit.owner === 'coupler') {
      return hit.port === 'B' || hit.port === 'b' ? -90 : 90;
    }
    if (hit && (hit.owner === 'vfl' || hit.owner === 'opm' || hit.owner === 'ols')) {
      return 180;
    }
    if (hit && (hit.owner === 'splitter' ||
        (hit.el && hit.el.classList && hit.el.classList.contains('lab-cas-port')))) {
      return 180;
    }
    var oltRot = oltPortSeatRotation(hit);
    if (oltRot != null) return oltRot;
    return 0;
  }

  function resolveUprightPlugRotation(hit, p) {
    if (hit && hit.owner === 'coupler') return portAlignedRotation(hit);
    /* OPM / VFL / OLS top adapters: always ferrule-down / cable-up */
    if (hit && (hit.owner === 'vfl' || hit.owner === 'opm' || hit.owner === 'ols')) return 180;
    /* Angled SFP cages seat along the module axis — never flip to upright */
    if (oltPortSeatRotation(hit) != null) return portAlignedRotation(hit);
    var base = portAlignedRotation(hit);
    var alt = base === 0 ? 180 : 0;
    var dY = (hit && typeof hit.wy === 'number') ? (hit.wy - p.ay) : 0;
    if (Math.abs(dY) < 1) return base;
    var preferred = headingRotFromMotion(0, dY);
    var dBase = Math.abs(((preferred - base + 540) % 360) - 180);
    var dAlt = Math.abs(((preferred - alt + 540) % 360) - 180);
    return dAlt < dBase ? alt : base;
  }

  function olsMagnetRadius() {
    if (global.FtthLab && typeof FtthLab.getOlsMagnetSnapPx === 'function') {
      var n = Number(FtthLab.getOlsMagnetSnapPx());
      if (isFinite(n) && n > 0) return n;
    }
    return OLS_MAGNET_SNAP_PX;
  }

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
        best = {
          owner: 'ols',
          olsId: node.getAttribute('data-ols-port'),
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

  function applyOlsMagneticPull(p, hit, clientX, clientY) {
    if (!hit || hit.owner !== 'ols' || !p) return null;
    enrichOlsHitDeepSeat(hit);
    var c = olsPortScreenCenter(hit.el);
    var d = hit.screenDist != null
      ? hit.screenDist
      : (c ? dist2(clientX, clientY, c.x, c.y) : 9999);
    if (d > olsMagnetRadius()) return null;
    if (hit.el) hit.el.classList.add('is-plug-target');
    p.connector.liveRot = 180;
    seatConnectorAtPort(p, hit.wx, hit.wy);
    updateFiberPath(p);
    if (d <= OLS_MAGNET_LOCK_PX) return 'lock';
    return 'pull';
  }

  function captureSnapshot() {
    return { pigtails: cloneJson(pigtails), seq: seq };
  }

  function applySnapshot(snap) {
    if (!snap) return;
    historyLocked = true;
    pigtails = cloneJson(snap.pigtails) || [];
    pigtails.forEach(function (p) {
      if (!p) return;
      p.hasSleeve = !!p.hasSleeve;
      if (p.hasSleeve && typeof p.sleeveAlong !== 'number') {
        p.sleeveAlong = 0;
      }
      if (!p.hasSleeve) p.sleeveAlong = null;
      if (typeof p.stripStage !== 'number') p.stripStage = 0;
      if (typeof p.stripPeel !== 'number') p.stripPeel = 0;
      if (p.stripStage < 0) p.stripStage = 0;
      if (p.stripStage > 2) p.stripStage = 2;
      if (typeof p.stripLengthPx !== 'number') p.stripLengthPx = 0;
      ensureFiberStrip(p);
      p.cleaved = !!p.cleaved;
      p.isCleaved = !!(p.isCleaved || p.cleaved);
      p.cleaved = p.isCleaved;
      if (typeof p.cleaveAngle !== 'number') {
        p.cleaveAngle = p.isCleaved ? 90 : 0;
      }
      if (p.isCleaved) {
        restoreCleavedStripLock(p);
      } else {
        p.cleavedStripLock = null;
      }
      if ((Number(p.stripStage) || 0) >= 2 || p.stripFrontierLock) {
        restorePermanentStripFrontier(p);
      } else {
        p.stripFrontierLock = null;
        clampStripFrontiersToPath(p);
      }
      if (!Array.isArray(p.pathHistory)) {
        p.pathHistory = Array.isArray(p.route) ? cloneJson(p.route) : [];
      }
      if (!Array.isArray(p.route)) p.route = p.pathHistory.slice();
      else p.route = p.pathHistory.slice();
      p.routeMode = p.routeMode === 'gravity' ? 'gravity' : 'snake';
      p.snake = null;
      p.isSnappedToCleaver = !!p.isSnappedToCleaver;
      if (!p.isSnappedToCleaver || !p.snappedCleaverId) {
        p.isSnappedToCleaver = false;
        p.snappedCleaverId = null;
        p.cleaverSlotAnchorX = null;
      }
      p.isSnappedToSplicer = !!p.isSnappedToSplicer;
      if (!p.isSnappedToSplicer || !p.snappedSplicerId || !p.snappedSplicerSide) {
        p.isSnappedToSplicer = false;
        p.snappedSplicerId = null;
        p.snappedSplicerSide = null;
        p.splicerGrooveY = null;
        p.splicerTipX = null;
        p.splicerPreviewSlot = null;
        p.splicerDragDetached = false;
        p.splicerGrooveAnchor = null;
        p.splicerBareGlassPx = null;
        p.splicerInnerEdgeX = null;
        p.splicerDockSnapshot = null;
        p.splicerWeldMachineId = null;
      }
    });
    seq = snap.seq || 0;
    selection = { kind: 'none', id: null };
    rebuildLayer();
    renderSplicerFiberOverlays();
    updateInspector();
    refreshBudget();
    historyLocked = false;
  }

  /**
   * Bare-fiber path for sleeve sliding: 0% = cleaved tip (End B), 100% = strain relief.
   */
  function fiberSleevePathPoints(p) {
    return fiberRenderPathPointsDense(p).slice().reverse();
  }

  function polylineLength(pts) {
    var len = 0;
    var i;
    for (i = 1; i < pts.length; i++) {
      len += dist2(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
    }
    return len;
  }

  function defaultSleeveAlong(totalLen, sleeveW) {
    if (!totalLen || totalLen < 1) return 0;
    return Math.min(1, (sleeveW * 0.48) / totalLen);
  }

  function pushSleevePathPt(out, pt) {
    if (!pt) return;
    if (
      out.length &&
      Math.abs(out[out.length - 1].x - pt.x) < 0.25 &&
      Math.abs(out[out.length - 1].y - pt.y) < 0.25
    ) {
      return;
    }
    out.push({ x: pt.x, y: pt.y });
  }

  function sampleQuadraticArc(p0, cp, p1, steps) {
    var out = [];
    var i;
    steps = Math.max(2, steps || 10);
    for (i = 1; i <= steps; i++) {
      var t = i / steps;
      var mt = 1 - t;
      out.push({
        x: mt * mt * p0.x + 2 * mt * t * cp.x + t * t * p1.x,
        y: mt * mt * p0.y + 2 * mt * t * cp.y + t * t * p1.y,
      });
    }
    return out;
  }

  /** Dense world points along filleted ortho route (matches visible fiber fillets). */
  function sampleFilletOrthoPoints(pts, radius) {
    pts = collapseOrthoPts(pts);
    if (!pts.length) return [];
    if (pts.length < 2) return [{ x: pts[0].x, y: pts[0].y }];
    var rMax = Math.max(8, Math.min(24, radius != null ? radius : ORTHO_FILLET_R));
    var out = [];
    var i;
    pushSleevePathPt(out, pts[0]);
    if (pts.length === 2) {
      pushSleevePathPt(out, pts[1]);
      return out;
    }
    for (i = 1; i < pts.length - 1; i++) {
      var prev = pts[i - 1];
      var mid = pts[i];
      var next = pts[i + 1];
      var v1x = mid.x - prev.x;
      var v1y = mid.y - prev.y;
      var v2x = next.x - mid.x;
      var v2y = next.y - mid.y;
      var len1 = Math.sqrt(v1x * v1x + v1y * v1y) || 1;
      var len2 = Math.sqrt(v2x * v2x + v2y * v2y) || 1;
      var r = Math.min(rMax, len1 * 0.5, len2 * 0.5);
      if (r < 2) {
        pushSleevePathPt(out, mid);
        continue;
      }
      var before = {
        x: mid.x - (v1x / len1) * r,
        y: mid.y - (v1y / len1) * r,
      };
      var after = {
        x: mid.x + (v2x / len2) * r,
        y: mid.y + (v2y / len2) * r,
      };
      pushSleevePathPt(out, before);
      sampleQuadraticArc(before, mid, after, 10).forEach(function (pt) {
        pushSleevePathPt(out, pt);
      });
    }
    pushSleevePathPt(out, pts[pts.length - 1]);
    return out;
  }

  function pointAtPathDistance(pts, dist) {
    if (!pts || !pts.length) {
      return { x: 0, y: 0, rot: 0, dist: 0, t: 0 };
    }
    if (pts.length === 1) {
      return { x: pts[0].x, y: pts[0].y, rot: 0, dist: 0, t: 0 };
    }
    var total = polylineLength(pts);
    if (dist <= 0) {
      var dx0 = pts[1].x - pts[0].x;
      var dy0 = pts[1].y - pts[0].y;
      return {
        x: pts[0].x,
        y: pts[0].y,
        rot: fiberPathTangentRotDeg(dx0, dy0),
        dist: 0,
        t: 0,
      };
    }
    if (dist >= total) {
      var last = pts.length - 1;
      var dxL = pts[last].x - pts[last - 1].x;
      var dyL = pts[last].y - pts[last - 1].y;
      return {
        x: pts[last].x,
        y: pts[last].y,
        rot: fiberPathTangentRotDeg(dxL, dyL),
        dist: total,
        t: 1,
      };
    }
    var acc = 0;
    var i;
    for (i = 1; i < pts.length; i++) {
      var ax = pts[i - 1].x;
      var ay = pts[i - 1].y;
      var bx = pts[i].x;
      var by = pts[i].y;
      var segLen = dist2(ax, ay, bx, by);
      if (acc + segLen >= dist) {
        var u = segLen > 0 ? (dist - acc) / segLen : 0;
        return {
          x: ax + (bx - ax) * u,
          y: ay + (by - ay) * u,
          rot: fiberPathTangentRotDeg(bx - ax, by - ay),
          dist: dist,
          t: total > 0 ? dist / total : 0,
        };
      }
      acc += segLen;
    }
    return pointAtPathDistance(pts, total);
  }

  function projectOntoFiberPath(pts, wx, wy) {
    if (!pts || pts.length < 2) {
      return { x: wx, y: wy, rot: 0, dist: 0, t: 0, perpDist: 0 };
    }
    var total = polylineLength(pts);
    var best = null;
    var acc = 0;
    var i;
    for (i = 1; i < pts.length; i++) {
      var ax = pts[i - 1].x;
      var ay = pts[i - 1].y;
      var bx = pts[i].x;
      var by = pts[i].y;
      var segDx = bx - ax;
      var segDy = by - ay;
      var segLen = Math.sqrt(segDx * segDx + segDy * segDy);
      var segLen2 = segLen * segLen;
      var u = segLen2 > 0 ? ((wx - ax) * segDx + (wy - ay) * segDy) / segLen2 : 0;
      var uClamped = Math.max(0, Math.min(1, u));
      var px = ax + segDx * uClamped;
      var py = ay + segDy * uClamped;
      var perp = dist2(wx, wy, px, py);
      var along = acc + uClamped * segLen;
      var cand = {
        x: px,
        y: py,
        rot: fiberPathTangentRotDeg(segDx, segDy),
        dist: along,
        t: total > 0 ? along / total : 0,
        perpDist: perp,
      };
      if (!best || perp < best.perpDist) best = cand;
      acc += segLen;
    }
    /* Extrapolate before the bare tip so backward pull can eject. */
    var ax0 = pts[0].x;
    var ay0 = pts[0].y;
    var bx0 = pts[1].x;
    var by0 = pts[1].y;
    var segDx0 = bx0 - ax0;
    var segDy0 = by0 - ay0;
    var segLen0 = Math.sqrt(segDx0 * segDx0 + segDy0 * segDy0) || 1;
    var u0 = ((wx - ax0) * segDx0 + (wy - ay0) * segDy0) / (segLen0 * segLen0);
    if (u0 < 0) {
      var px0 = ax0 + segDx0 * u0;
      var py0 = ay0 + segDy0 * u0;
      var perp0 = dist2(wx, wy, px0, py0);
      var along0 = u0 * segLen0;
      if (!best || perp0 <= best.perpDist + 6) {
        best = {
          x: px0,
          y: py0,
          rot: fiberPathTangentRotDeg(segDx0, segDy0),
          dist: along0,
          t: total > 0 ? along0 / total : 0,
          perpDist: perp0,
        };
      }
    }
    return best || { x: wx, y: wy, rot: 0, dist: 0, t: 0, perpDist: 0 };
  }

  /**
   * Sleeve pose locked to fiber path coordinate (sleeveAlong: 0% tip → 100% strain relief).
   */
  function sleeveGeometry(p) {
    var size = getSleeveSizePx();
    var pts = fiberSleevePathPoints(p);
    var total = polylineLength(pts);
    var along = typeof p.sleeveAlong === 'number'
      ? p.sleeveAlong
      : defaultSleeveAlong(total, size.w);
    var pt = pointAtPathDistance(pts, along * total);
    return {
      x: pt.x,
      y: pt.y,
      rot: pt.rot,
      w: size.w,
      h: size.h,
    };
  }

  function sleeveStyle(p) {
    var g = sleeveGeometry(p);
    return (
      'left:' + Math.round(g.x - g.w / 2) + 'px;' +
      'top:' + Math.round(g.y - g.h / 2) + 'px;' +
      'width:' + g.w + 'px;' +
      'height:' + g.h + 'px;' +
      'transform-origin:50% 50%;' +
      'transform:rotate(' + g.rot.toFixed(2) + 'deg)'
    );
  }

  function triggerSleeveSlideIn(id) {
    var el = layer && layer.querySelector('.lab-pigtail-sleeve[data-pt-sleeve="' + id + '"]');
    if (!el) return;
    el.classList.add('is-sliding');
    window.setTimeout(function () {
      if (el && el.classList) el.classList.remove('is-sliding');
    }, 420);
  }

  function updateSleeveElement(p, el) {
    if (!el || !p || !p.hasSleeve) return;
    el.setAttribute('style', sleeveStyle(p));
  }

  function dragSleeveAlongPath(p, wx, wy) {
    var pts = fiberSleevePathPoints(p);
    var total = polylineLength(pts);
    var size = getSleeveSizePx();
    var proj = projectOntoFiberPath(pts, wx, wy);
    if (proj.dist < -SLEEVE_EJECT_PULL_PX) {
      return { eject: true, x: wx, y: wy };
    }
    p.sleeveAlong = total > 0
      ? Math.max(0, Math.min(1, proj.dist / total))
      : 0;
    return { eject: false, proj: proj };
  }

  function stripStageLabel(stage) {
    if (stage >= 2) return 'Bare glass (125 µm)';
    if (stage >= 1) return 'Buffer exposed · strip acrylate';
    return 'Jacketed · peel outer sheath';
  }

  /**
   * Layered strip state from tip (arc-length px on fiberSleevePathPoints):
   *   [0, bareTo) bare glass · [bareTo, jacketTo) buffer · [jacketTo, total) jacket
   */
  function ensureFiberStrip(p) {
    if (!p) return null;
    if (!p.fiberStrip || typeof p.fiberStrip !== 'object') {
      p.fiberStrip = { jacketTo: 0, bareTo: 0, peel: 0, peelLayer: null };
    }
    var fs = p.fiberStrip;
    if (typeof fs.jacketTo !== 'number' || !isFinite(fs.jacketTo)) {
      fs.jacketTo = Number(p.stripLengthPx) || 0;
    }
    if (typeof fs.bareTo !== 'number' || !isFinite(fs.bareTo)) {
      var st = Number(p.stripStage) || 0;
      fs.bareTo = st >= 2 ? fs.jacketTo : 0;
    }
    if (typeof fs.peel !== 'number' || !isFinite(fs.peel)) {
      fs.peel = Number(p.stripPeel) || 0;
    }
    if (fs.jacketTo < 0) fs.jacketTo = 0;
    if (fs.bareTo < 0) fs.bareTo = 0;
    if (fs.bareTo > fs.jacketTo) fs.bareTo = fs.jacketTo;
    enforceFullStripBareFrontier(p);
    return fs;
  }

  function isFullyStrippedPigtail(p) {
    if (!p) return false;
    if (p.isCleaved || p.cleaved) return true;
    return (Number(p.stripStage) || 0) >= 2;
  }

  /** Stage 2 / cleaved: zero buffer gap — bare glass runs tip → jacket frontier. */
  function enforceFullStripBareFrontier(p) {
    if (!p || !isFullyStrippedPigtail(p) || !p.fiberStrip) return false;
    snapBareToJacket(p.fiberStrip);
    return true;
  }

  function maxStripLenPx(p) {
    var pts = fiberSleevePathPoints(p);
    return Math.max(0, polylineLength(pts));
  }

  /** Admin-configurable bare glass length remaining after cleave (FtthLabSettings). */
  function getBareGlassLengthAfterCutPx() {
    if (global.FtthLabSettings && typeof FtthLabSettings.getItem === 'function') {
      var item = FtthLabSettings.getItem('fiber-cleaver');
      if (item && item.specs) {
        var n = Number(item.specs.bareGlassLengthAfterCutPx);
        if (isFinite(n) && n >= 1) return Math.round(n);
      }
    }
    return CLEAVE_WASTE_PX;
  }

  function restoreCleavedStripLock(p) {
    if (!p || !(p.isCleaved || p.cleaved)) return;
    ensureFiberStrip(p);
    if (!p.cleavedStripLock) {
      var boundary = getJacketBoundaryWorld(p);
      p.cleavedStripLock = {
        jacketTo: p.fiberStrip.jacketTo || 0,
        bareTo: p.fiberStrip.bareTo || 0,
        jacketBoundaryX: boundary ? boundary.x : null,
        rulerStopX: p.cleaverSlotAnchorX != null ? p.cleaverSlotAnchorX : null,
      };
    }
    var lock = p.cleavedStripLock;
    var maxLen = maxStripLenPx(p);
    var j = lock.jacketTo;
    if (!isFinite(j) || j < STRIP_TIP_EPS) j = STRIP_TIP_EPS;
    if (isFinite(maxLen) && maxLen >= 0 && j > maxLen) j = maxLen;
    p.fiberStrip.jacketTo = j;
    p.fiberStrip.bareTo = j;
    p.fiberStrip.peel = 0;
    p.fiberStrip.peelLayer = null;
    lock.jacketTo = j;
    lock.bareTo = j;
    syncStripStageFromFiberStrip(p);
    enforceFullStripBareFrontier(p);
    lockPermanentStripFrontier(p);
  }

  /** Persist stage-2 strip arc-lengths — survives cleaver undock and free drag. */
  function lockPermanentStripFrontier(p) {
    if (!p) return;
    ensureFiberStrip(p);
    if (!isFullyStrippedPigtail(p) && (Number(p.stripStage) || 0) < 2) return;
    enforceFullStripBareFrontier(p);
    var fs = p.fiberStrip;
    p.stripFrontierLock = {
      jacketTo: fs.jacketTo || 0,
      bareTo: fs.bareTo || 0,
      stripStage: 2,
    };
  }

  function restorePermanentStripFrontier(p) {
    if (!p) return false;
    if (p.isCleaved || p.cleaved) {
      restoreCleavedStripLock(p);
      lockPermanentStripFrontier(p);
      return true;
    }
    if ((Number(p.stripStage) || 0) >= 2 && !p.stripFrontierLock) {
      lockPermanentStripFrontier(p);
    }
    if (!p.stripFrontierLock) return false;
    ensureFiberStrip(p);
    var lock = p.stripFrontierLock;
    var fs = p.fiberStrip;
    var maxLen = maxStripLenPx(p);
    var j = lock.jacketTo;
    if (!isFinite(j) || j < STRIP_TIP_EPS) j = STRIP_TIP_EPS;
    if (isFinite(maxLen) && maxLen >= 0 && j > maxLen) j = maxLen;
    fs.jacketTo = j;
    fs.bareTo = j;
    fs.peel = 0;
    fs.peelLayer = null;
    p.stripStage = 2;
    p.stripLengthPx = j;
    lock.jacketTo = j;
    lock.bareTo = j;
    enforceFullStripBareFrontier(p);
    return true;
  }

  /** Binary-search jacketTo so the yellow jacket frontier lands on a fixed world X. */
  function pinJacketBoundaryToWorldX(p, targetX) {
    if (!p || targetX == null || !isFinite(targetX)) return;
    ensureFiberStrip(p);
    var maxLen = maxStripLenPx(p);
    if (!isFinite(maxLen) || maxLen <= 0) return;
    var lo = STRIP_TIP_EPS;
    var hi = maxLen;
    var iter;
    for (iter = 0; iter < 28; iter++) {
      var mid = (lo + hi) * 0.5;
      p.fiberStrip.jacketTo = mid;
      p.fiberStrip.bareTo = mid;
      var boundary = getJacketBoundaryWorld(p);
      if (!boundary || !isFinite(boundary.x)) break;
      if (Math.abs(boundary.x - targetX) <= RULER_WALL_EPS) {
        p.fiberStrip.bareTo = mid;
        return;
      }
      if (boundary.x > targetX) lo = mid;
      else hi = mid;
    }
    p.fiberStrip.bareTo = p.fiberStrip.jacketTo;
  }

  function captureCleaveStripAnchor(p, cleaverId) {
    ensureFiberStrip(p);
    var boundary = getJacketBoundaryWorld(p);
    var rulerStopX = p.cleaverSlotAnchorX;
    if (rulerStopX == null && cleaverId) {
      var slot = getCleaverSlotGeometry(cleaverId);
      if (slot && slot.rulerStopX != null) rulerStopX = slot.rulerStopX;
    }
    if (rulerStopX == null && boundary) rulerStopX = boundary.x;
    return {
      preJacketTo: p.fiberStrip.jacketTo || 0,
      preBareTo: p.fiberStrip.bareTo || 0,
      jacketBoundaryX: boundary ? boundary.x : null,
      rulerStopX: rulerStopX,
    };
  }

  /** Keep yellow jacket on ruler wall while docked; preserve arc-lengths when free. */
  function enforceCleavedJacketWall(p) {
    if (!p || !(p.isCleaved || p.cleaved) || !p.cleavedStripLock) return;
    if (!p.isSnappedToCleaver) {
      enforceFullStripBareFrontier(p);
      return;
    }
    var lock = p.cleavedStripLock;
    var wallX = lock.rulerStopX != null ? lock.rulerStopX : lock.jacketBoundaryX;
    if (wallX == null) return;
    if (lock.jacketBoundaryX != null) {
      pinJacketBoundaryToWorldX(p, lock.jacketBoundaryX);
    } else {
      p.fiberStrip.jacketTo = lock.jacketTo;
      p.fiberStrip.bareTo = lock.bareTo;
    }
    enforceRulerWall(p, wallX);
    lock.jacketTo = p.fiberStrip.jacketTo;
    lock.bareTo = p.fiberStrip.jacketTo;
    var boundary = getJacketBoundaryWorld(p);
    if (boundary) lock.jacketBoundaryX = boundary.x;
    enforceFullStripBareFrontier(p);
  }

  function lockCleavedStripGeometry(p, bareLenPx, opts) {
    opts = opts || {};
    if (!p) return;
    ensureFiberStrip(p);
    var bareLen = typeof bareLenPx === 'number' ? bareLenPx : getBareGlassLengthAfterCutPx();
    bareLen = Math.max(CLEAVE_MIN_CUT_PX, bareLen);
    var maxLen = maxStripLenPx(p);
    if (!isFinite(maxLen) || maxLen < 0) maxLen = 0;

    var jacketTo;
    if (typeof opts.preJacketTo === 'number') {
      var removed = typeof opts.removedFromTip === 'number' ? opts.removedFromTip : 0;
      jacketTo = Math.max(bareLen, opts.preJacketTo - removed);
    } else {
      jacketTo = p.fiberStrip.jacketTo || 0;
    }
    jacketTo = Math.min(jacketTo, maxLen);
    p.fiberStrip.jacketTo = jacketTo;
    p.fiberStrip.bareTo = jacketTo;
    p.fiberStrip.peel = 0;
    p.fiberStrip.peelLayer = null;

    var lock = {
      jacketTo: jacketTo,
      bareTo: jacketTo,
    };
    if (opts.jacketBoundaryX != null) lock.jacketBoundaryX = opts.jacketBoundaryX;
    if (opts.rulerStopX != null) lock.rulerStopX = opts.rulerStopX;
    p.cleavedStripLock = lock;

    var pinX = lock.jacketBoundaryX != null ? lock.jacketBoundaryX : lock.rulerStopX;
    if (pinX != null) {
      pinJacketBoundaryToWorldX(p, pinX);
      lock.jacketTo = p.fiberStrip.jacketTo;
      lock.bareTo = p.fiberStrip.jacketTo;
      enforceRulerWall(p, pinX);
    }

    enforceFullStripBareFrontier(p);
    syncStripStageFromFiberStrip(p);
    lockPermanentStripFrontier(p);
  }

  var STRIP_TIP_EPS = 0.05;
  /** When bareTo is within this many px of jacketTo, treat buffer as fully stripped. */
  var STRIP_BUFFER_COMPLETE_PX = 1;

  function isBareStripComplete(fs) {
    if (!fs) return false;
    var j = fs.jacketTo || 0;
    var b = fs.bareTo || 0;
    return j > STRIP_TIP_EPS && b >= j - STRIP_BUFFER_COMPLETE_PX;
  }

  function snapBareToJacket(fs) {
    if (!fs) return;
    fs.bareTo = fs.jacketTo || 0;
  }

  function snapBareIfComplete(fs) {
    if (isBareStripComplete(fs)) {
      snapBareToJacket(fs);
      return true;
    }
    return false;
  }

  /**
   * Keep strip frontiers valid against the live fiber polyline (tip-anchored arc-length).
   * Call whenever geometry changes — extend, route, or cleave.
   */
  function clampStripFrontiersToPath(p) {
    if (!p) return;
    ensureFiberStrip(p);
    if (p.isCleaved || p.cleaved || (Number(p.stripStage) || 0) >= 2 || p.stripFrontierLock) {
      restorePermanentStripFrontier(p);
      return;
    }
    var fs = p.fiberStrip;
    var maxLen = maxStripLenPx(p);
    if (!isFinite(maxLen) || maxLen < 0) maxLen = 0;
    if (fs.jacketTo > maxLen) fs.jacketTo = maxLen;
    if (fs.bareTo > fs.jacketTo) fs.bareTo = fs.jacketTo;
    if (fs.bareTo > maxLen) fs.bareTo = maxLen;
    syncStripStageFromFiberStrip(p);
  }

  /** Reconcile locked render length with measured sleeve-path arc length. */
  function syncPigtailFiberLength(p) {
    if (!p) return;
    var pts = fiberSleevePathPoints(p);
    var measured = polylineLength(pts);
    if (isFinite(measured) && measured > 0) {
      p.fixedLength = Math.max(40, measured);
    }
    clampStripFrontiersToPath(p);
  }

  function syncStripStageFromFiberStrip(p) {
    if (!p) return;
    ensureFiberStrip(p);
    var fs = p.fiberStrip;
    if (p.isCleaved || p.cleaved) {
      snapBareToJacket(fs);
      p.stripStage = 2;
      p.stripLengthPx = fs.jacketTo || 0;
      p.stripPeel = fs.peel || 0;
      return;
    }
    if (p.stripFrontierLock && (Number(p.stripStage) || 0) >= 2) {
      snapBareToJacket(fs);
      p.stripStage = 2;
      p.stripLengthPx = fs.jacketTo || 0;
      p.stripPeel = fs.peel || 0;
      return;
    }
    var j = fs.jacketTo || 0;
    var b = fs.bareTo || 0;
    if (j < STRIP_TIP_EPS) {
      p.stripStage = 0;
    } else if (b >= j - STRIP_BUFFER_COMPLETE_PX) {
      p.stripStage = 2;
      snapBareToJacket(fs);
      lockPermanentStripFrontier(p);
    } else {
      p.stripStage = 1;
    }
    p.stripLengthPx = j;
    p.stripPeel = fs.peel || 0;
  }

  /** Committed jacket strip length from tip (ignores ephemeral peel animation). */
  function stripCommittedPx(p) {
    if (!p) return 0;
    ensureFiberStrip(p);
    var n = Number(p.fiberStrip.jacketTo);
    return isFinite(n) && n > 0 ? n : 0;
  }

  /** How many px from the cleaved tip have jacket removed. */
  function stripExposedFromTipPx(p) {
    return stripCommittedPx(p);
  }

  function stripBareFromTipPx(p) {
    if (!p) return 0;
    ensureFiberStrip(p);
    var n = Number(p.fiberStrip.bareTo);
    return isFinite(n) && n > 0 ? n : 0;
  }

  /** Visual kind for the tip-side segment when only jacket is partially removed. */
  function stripExposedKind(p) {
    ensureFiberStrip(p);
    if (isFullyStrippedPigtail(p)) return 'bare';
    var fs = p.fiberStrip;
    if (isBareStripComplete(fs)) return 'bare';
    if ((fs.jacketTo || 0) > 0.5) return 'buffer';
    if ((fs.peel || 0) > 0.02) return 'buffer';
    return null;
  }

  function stripHitFromProj(p, pts, proj, stage, layer, thr) {
    var fs = ensureFiberStrip(p);
    var dirs = peelDirsFromPath(pts);
    return {
      id: p.id,
      stage: stage,
      layer: layer,
      x: proj.x,
      y: proj.y,
      rot: proj.rot,
      peelUx: dirs.peelUx,
      peelUy: dirs.peelUy,
      perpDist: proj.perpDist,
      along: proj.dist,
      jacketTo: fs.jacketTo || 0,
      bareTo: fs.bareTo || 0,
    };
  }

  function svgPathFromPoints(pts, opts) {
    opts = opts || {};
    if (!pts || !pts.length) return '';
    if (opts.fillet) {
      return filletOrthoSvg(pts, opts.filletRadius || ORTHO_FILLET_R);
    }
    var d = 'M ' + pts[0].x + ' ' + pts[0].y;
    var i;
    for (i = 1; i < pts.length; i++) {
      d += ' L ' + pts[i].x + ' ' + pts[i].y;
    }
    return d;
  }

  /** Dense polyline for arc-length / strip math (filleted snake corners). */
  function fiberRenderPathPointsDense(p) {
    var pts = fiberRenderPathPoints(p);
    if (usesOrthoRoute(p)) {
      return sampleFilletOrthoPoints(collapseOrthoPts(pts), ORTHO_FILLET_R);
    }
    return pts;
  }

  /** SVG d= string with smooth quadratic fillets in snake mode. */
  function fiberSvgPathFromRenderPoints(p, pts) {
    if (!pts || !pts.length) return '';
    if (usesOrthoRoute(p)) {
      return filletOrthoSvg(collapseOrthoPts(pts), ORTHO_FILLET_R);
    }
    return svgPathFromPoints(pts);
  }

  /** Slice a polyline between two arc-length distances [d0, d1]. */
  function slicePolylineByDistance(pts, d0, d1) {
    if (!pts || pts.length < 2) return pts ? pts.slice() : [];
    var total = polylineLength(pts);
    if (total < 0.01) return [{ x: pts[0].x, y: pts[0].y }];
    var a = Math.max(0, Math.min(total, d0));
    var b = Math.max(0, Math.min(total, d1));
    if (b < a) {
      var tmp = a;
      a = b;
      b = tmp;
    }
    if (b - a < 0.25) {
      var mid = pointAtPathDistance(pts, (a + b) / 2);
      return [{ x: mid.x, y: mid.y }, { x: mid.x, y: mid.y }];
    }
    var start = pointAtPathDistance(pts, a);
    var end = pointAtPathDistance(pts, b);
    var out = [{ x: start.x, y: start.y }];
    var acc = 0;
    var i;
    for (i = 1; i < pts.length; i++) {
      var ax = pts[i - 1].x;
      var ay = pts[i - 1].y;
      var bx = pts[i].x;
      var by = pts[i].y;
      var segLen = dist2(ax, ay, bx, by);
      var next = acc + segLen;
      if (next > a + 0.01 && acc < b - 0.01) {
        if (acc >= a - 0.01 && next <= b + 0.01) {
          pushSleevePathPt(out, { x: bx, y: by });
        } else if (acc < a && next > a && next <= b) {
          pushSleevePathPt(out, { x: bx, y: by });
        } else if (acc >= a && acc < b && next > b) {
          /* end handled below */
        } else if (acc < a && next > b) {
          /* segment spans both ends — only endpoints */
        }
      }
      acc = next;
    }
    pushSleevePathPt(out, { x: end.x, y: end.y });
    if (out.length < 2) out.push({ x: end.x, y: end.y });
    return out;
  }

  /**
   * Full render polyline connector → tip (same geometry as fiberPath).
   * Snake mode returns corner vertices; SVG fillets are applied at draw time.
   */
  function fiberRenderPathPoints(p) {
    var tipA = bootAnchor(p);
    var p0 = strainReliefStart(p);
    var tipB = { x: p.bx, y: p.by };
    ensurePathHistory(p);
    var pts = [{ x: tipA.x, y: tipA.y }, { x: p0.x, y: p0.y }];
    if (usesOrthoRoute(p)) {
      var ortho = orthoPolyline(p);
      var i;
      for (i = 0; i < ortho.length; i++) {
        pushSleevePathPt(pts, ortho[i]);
      }
      pushSleevePathPt(pts, tipB);
      return collapseOrthoPts(pts);
    }
    var L = resolvePigtailRenderLength(p, p0, tipB);
    var mid = samplePigtailCatenary(p0, tipB, L, PIGTAIL_CATENARY_SAMPLES);
    var j;
    for (j = 1; j < mid.length; j++) {
      pushSleevePathPt(pts, mid[j]);
    }
    return pts;
  }

  /** Map tip-anchored sleeve arc-length to the render polyline (includes boot segment). */
  function stripArcOnRenderPath(p, sleeveDistFromTip) {
    var d = Number(sleeveDistFromTip);
    if (!isFinite(d) || d <= 0) return 0;
    var sleevePts = fiberSleevePathPoints(p);
    var renderPts = fiberRenderPathPointsDense(p);
    var sleeveLen = polylineLength(sleevePts);
    var renderLen = polylineLength(renderPts);
    if (sleeveLen < STRIP_TIP_EPS) return 0;
    return Math.min(renderLen, d * (renderLen / sleeveLen));
  }

  /**
   * Render-path px length of exposed bare glass — identical math to the free-state
   * bare segment in buildPigtailFiberSvg (tip-anchored bareTo / jacketTo).
   */
  function getBareGlassDrawLengthPx(p) {
    if (!p) return 0;
    ensureFiberStrip(p);
    enforceFullStripBareFrontier(p);
    var fs = p.fiberStrip;
    var jacketTo = Math.max(0, fs.jacketTo || 0);
    var bareTo = Math.max(0, fs.bareTo || 0);
    var fullyStripped = isFullyStrippedPigtail(p);
    var bareComplete = fullyStripped || isBareStripComplete(fs);
    if (bareComplete) {
      bareTo = jacketTo;
    }
    if (bareTo <= STRIP_TIP_EPS) return 0;
    return stripArcOnRenderPath(p, bareTo);
  }

  function buildPigtailFiberSvg(p, opts) {
    opts = opts || {};
    var fullPts = fiberRenderPathPoints(p);
    var densePts = fiberRenderPathPointsDense(p);
    var fullPath = fiberSvgPathFromRenderPoints(p, fullPts) || fiberPath(p);
    var bad = p.connector.mismatch;
    var sel = selection.id === p.id ? ' is-selected' : '';
    var splicerDocked = !!p.isSnappedToSplicer;
    var splicerPort = !!opts.splicerPort;
    if (splicerDocked && !splicerPort) {
      return (
        '<path class="lab-pigtail-fiber-hit" data-pt-drag="' + p.id + '" d="' + fullPath +
        '" fill="none" stroke="transparent" />'
      );
    }
    ensureFiberStrip(p);
    enforceFullStripBareFrontier(p);
    var fs = p.fiberStrip;
    var jacketTo = Math.max(0, fs.jacketTo || 0);
    var bareTo = Math.max(0, fs.bareTo || 0);
    var fullyStripped = isFullyStrippedPigtail(p);
    var bareComplete = fullyStripped || isBareStripComplete(fs);
    if (bareComplete) {
      bareTo = jacketTo;
    }
    var peel = fs.peel || 0;
    var peelLayer = fs.peelLayer;
    var total = polylineLength(densePts);
    var html =
      '<path class="lab-pigtail-fiber-hit" data-pt-drag="' + p.id + '" d="' + fullPath +
      '" fill="none" stroke="transparent" />';

    var splicerCls = splicerDocked && splicerPort ? ' is-splicer-terminated' : '';

    function peelStyle(layerName) {
      if (peel <= 0.02 || peelLayer !== layerName) return '';
      return ' style="--strip-peel:' + peel.toFixed(3) + ';"';
    }

    function peelClass(layerName) {
      return peel > 0.02 && peelLayer === layerName ? ' is-strip-peeling' : '';
    }

    function segPathFromDenseSlice(d0, d1) {
      var segPts = slicePolylineByDistance(densePts, d0, d1);
      if (usesOrthoRoute(p) && segPts.length >= 2) {
        return filletOrthoSvg(collapseOrthoPts(segPts), ORTHO_FILLET_R);
      }
      return svgPathFromPoints(segPts);
    }

    var splicerSlot = null;
    if (splicerDocked && splicerPort && p.snappedSplicerId && p.snappedSplicerSide) {
      splicerSlot = getSplicerGrooveSlot(p.snappedSplicerId, p.snappedSplicerSide, { forTracking: true });
    }
  var splicerClampRender = !!(
      splicerDocked &&
      splicerPort &&
      splicerSlot &&
      p.splicerInnerEdgeX != null
    );

    if (splicerClampRender) {
      var innerPt = { x: p.splicerInnerEdgeX, y: splicerSlot.grooveY };
      var innerProj = projectOntoFiberStrict(densePts, innerPt.x, innerPt.y);
      var dInner = Math.max(0, Math.min(total, innerProj.dist || 0));
      var bareLenPx = getBareGlassDrawLengthPx(p);
      var dBareEnd = Math.min(total, dInner + Math.max(CLEAVE_MIN_CUT_PX, bareLenPx));
      var jacketPts = slicePolylineByDistance(densePts, 0, dInner);
      var barePts = slicePolylineByDistance(densePts, dInner, dBareEnd);
      if (jacketPts.length < 2) jacketPts = slicePolylineByDistance(densePts, 0, Math.max(dInner, 2));
      if (barePts.length < 2) barePts = slicePolylineByDistance(densePts, dInner, Math.max(dBareEnd, dInner + CLEAVE_MIN_CUT_PX));
      html +=
        '<path class="lab-pigtail-fiber lab-pigtail-fiber--jacket' +
        (bad ? ' is-mismatch' : '') + sel + peelClass('jacket') + splicerCls +
        '" data-pt-fiber="' + p.id + '" data-pt-fiber-seg="jacket" d="' +
        fiberSvgPathFromRenderPoints(p, jacketPts) + '" fill="none"' + peelStyle('jacket') + ' />' +
        '<path class="lab-pigtail-fiber lab-pigtail-fiber--bare lab-pigtail-fiber--bare-tip' +
        (p.cleaved || p.isCleaved ? ' lab-pigtail-fiber--cleaved' : '') +
        (bad ? ' is-mismatch' : '') + peelClass('bare') + splicerCls +
        '" data-pt-fiber-stripped="' + p.id + '" data-pt-fiber-seg="bare" d="' +
        fiberSvgPathFromRenderPoints(p, barePts) + '" fill="none"' + peelStyle('bare') + ' />';
    } else {
    var jacketRender = stripArcOnRenderPath(p, jacketTo);
    var bareRender = stripArcOnRenderPath(p, bareTo);
    if (jacketRender > STRIP_TIP_EPS && total > jacketRender + STRIP_TIP_EPS) {
      var dJacketEnd = Math.max(0, total - jacketRender);
      var dBareEnd = Math.max(dJacketEnd, total - bareRender);
      var jacketD = segPathFromDenseSlice(0, dJacketEnd);
      html +=
        '<path class="lab-pigtail-fiber lab-pigtail-fiber--jacket' +
        (bad ? ' is-mismatch' : '') + sel + peelClass('jacket') + splicerCls +
        '" data-pt-fiber="' + p.id + '" data-pt-fiber-seg="jacket" d="' + jacketD +
        '" fill="none"' + peelStyle('jacket') + ' />';

      var bufferGap = jacketRender - bareRender;
      var bufferSplit = !fullyStripped && !bareComplete &&
        bareRender > STRIP_TIP_EPS &&
        bufferGap >= STRIP_BUFFER_COMPLETE_PX;
      if (bufferSplit) {
        var bufferPts = slicePolylineByDistance(densePts, dJacketEnd, dBareEnd);
        var bufferLen = polylineLength(bufferPts);
        if (bufferLen < STRIP_BUFFER_COMPLETE_PX) {
          bufferSplit = false;
        } else {
          html +=
            '<path class="lab-pigtail-fiber lab-pigtail-fiber--buffer' +
            (bad ? ' is-mismatch' : '') + peelClass('buffer') +
            '" data-pt-fiber="' + p.id + '" data-pt-fiber-seg="buffer" d="' +
            segPathFromDenseSlice(dJacketEnd, dBareEnd) + '" fill="none"' + peelStyle('buffer') + ' />' +
            '<path class="lab-pigtail-fiber lab-pigtail-fiber--bare lab-pigtail-fiber--bare-tip' +
            (p.cleaved || p.isCleaved ? ' lab-pigtail-fiber--cleaved' : '') +
            (bad ? ' is-mismatch' : '') + peelClass('bare') + splicerCls +
            '" data-pt-fiber-stripped="' + p.id + '" data-pt-fiber-seg="bare" d="' +
            segPathFromDenseSlice(dBareEnd, total) + '" fill="none"' + peelStyle('bare') + ' />';
        }
      }
      if (!bufferSplit) {
        var tipBare = fullyStripped || bareComplete ||
          (bareRender >= jacketRender - STRIP_BUFFER_COMPLETE_PX && jacketRender > STRIP_TIP_EPS);
        var tipKind = tipBare ? 'bare' : (stripExposedKind(p) || 'buffer');
        html +=
          '<path class="lab-pigtail-fiber lab-pigtail-fiber--' + tipKind +
          (tipBare ? ' lab-pigtail-fiber--bare-tip' : '') +
          (p.cleaved || p.isCleaved ? ' lab-pigtail-fiber--cleaved' : '') +
          (bad ? ' is-mismatch' : '') + peelClass(tipBare ? 'bare' : 'buffer') + splicerCls +
          '" data-pt-fiber-stripped="' + p.id + '" data-pt-fiber-seg="' +
          (tipBare ? 'bare' : 'stripped') + '" d="' +
          segPathFromDenseSlice(dJacketEnd, total) + '" fill="none"' +
          peelStyle(tipBare ? 'bare' : 'buffer') + ' />';
      }
    } else {
      html +=
        '<path class="lab-pigtail-fiber lab-pigtail-fiber--jacket' +
        (bad ? ' is-mismatch' : '') + sel + peelClass('jacket') + splicerCls +
        '" data-pt-fiber="' + p.id + '" data-pt-fiber-seg="jacket" d="' + fullPath +
        '" fill="none"' + peelStyle('jacket') + ' />';
    }
    }

    var ghost = ghostPreviewPath(p);
    if (ghost) {
      html +=
        '<path class="lab-pigtail-fiber-ghost" data-pt-ghost="' + p.id +
        '" d="' + ghost + '" fill="none" />';
    }
    html +=
      '<path class="lab-pigtail-laser-core" data-pt-laser="' + p.id + '" d="' + fullPath +
      '" fill="none" />';
    return html;
  }

  function setStripGuideLine(guide) {
    var host = ensureLayer();
    if (!host) return;
    var svg = host.querySelector('.lab-pigtail-svg');
    if (!svg) return;
    var el = svg.querySelector('[data-pt-strip-guide="1"]');
    if (!guide || guide.x1 == null || guide.y1 == null || guide.x2 == null || guide.y2 == null) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
      return;
    }
    var d =
      'M ' + Number(guide.x1) + ' ' + Number(guide.y1) +
      ' L ' + Number(guide.x2) + ' ' + Number(guide.y2);
    if (!el) {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      el.setAttribute('data-pt-strip-guide', '1');
      el.setAttribute('class', 'lab-pigtail-strip-guide');
      el.setAttribute('fill', 'none');
      svg.appendChild(el);
    }
    el.setAttribute('d', d);
  }

  function clearStripGuideLine() {
    setStripGuideLine(null);
  }

  function setCleaverGuideLine(guide, seated) {
    var host = ensureLayer();
    if (!host) return;
    var svg = host.querySelector('.lab-pigtail-svg');
    if (!svg) return;
    var el = svg.querySelector('[data-pt-cleaver-guide="1"]');
    if (!guide || guide.x1 == null || guide.y1 == null || guide.x2 == null || guide.y2 == null) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
      return;
    }
    var d =
      'M ' + Number(guide.x1) + ' ' + Number(guide.y1) +
      ' L ' + Number(guide.x2) + ' ' + Number(guide.y2);
    if (!el) {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      el.setAttribute('data-pt-cleaver-guide', '1');
      el.setAttribute('fill', 'none');
      svg.appendChild(el);
    }
    el.setAttribute(
      'class',
      'lab-pigtail-cleaver-guide' + (seated ? ' is-seated' : ' is-approach')
    );
    el.setAttribute('d', d);
  }

  function clearCleaverGuideLine() {
    setCleaverGuideLine(null, false);
    setCleaverRulerWallGuide(null);
  }

  /** Vertical guide at ruler stop wall (jacket boundary target). */
  function setCleaverRulerWallGuide(slot, seated) {
    var host = ensureLayer();
    if (!host) return;
    var svg = host.querySelector('.lab-pigtail-svg');
    if (!svg) return;
    var el = svg.querySelector('[data-pt-cleaver-ruler="1"]');
    if (!slot || slot.rulerStopX == null || slot.grooveY == null) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
      return;
    }
    var y0 = slot.grooveY - 14;
    var y1 = slot.grooveY + 14;
    var d = 'M ' + Number(slot.rulerStopX) + ' ' + y0 + ' L ' + Number(slot.rulerStopX) + ' ' + y1;
    if (!el) {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      el.setAttribute('data-pt-cleaver-ruler', '1');
      el.setAttribute('fill', 'none');
      svg.appendChild(el);
    }
    el.setAttribute(
      'class',
      'lab-pigtail-cleaver-ruler' + (seated ? ' is-seated' : ' is-approach')
    );
    el.setAttribute('x1', String(slot.rulerStopX));
    el.setAttribute('y1', String(y0));
    el.setAttribute('x2', String(slot.rulerStopX));
    el.setAttribute('y2', String(y1));
    el.setAttribute('d', d);
  }

  function cleaverSlotGuideFromInfo(info) {
    if (!info) return null;
    if (info.slot) return info.slot;
    if (info.slotX1 != null && info.slotX2 != null && info.grooveY != null) {
      return { x1: info.slotX1, y1: info.grooveY, x2: info.slotX2, y2: info.grooveY };
    }
    return info.groove || null;
  }

  function getCleaverSlotGeometry(cleaverId) {
    if (!global.FtthLab || typeof FtthLab.getCleaverRulerStopWorld !== 'function') {
      if (global.FtthLab && typeof FtthLab.getCleaverGrooveWorld === 'function') {
        return FtthLab.getCleaverGrooveWorld(cleaverId);
      }
      return null;
    }
    return FtthLab.getCleaverRulerStopWorld(cleaverId);
  }

  /** World point where yellow jacket meets bare glass (tip-anchored arc-length jacketTo). */
  function getJacketBoundaryWorld(p) {
    if (!p) return null;
    ensureFiberStrip(p);
    var jacketTo = Number(p.fiberStrip.jacketTo) || 0;
    var pts = fiberSleevePathPoints(p);
    if (!pts || pts.length < 2) {
      return { x: p.bx, y: p.by };
    }
    if (jacketTo < STRIP_TIP_EPS) {
      return { x: pts[0].x, y: pts[0].y };
    }
    var pt = pointAtPathDistance(pts, jacketTo);
    return { x: pt.x, y: pt.y };
  }

  function translateTailGeometry(p, dx, dy) {
    if (!p || (!dx && !dy)) return;
    p.bx += dx;
    p.by += dy;
    if (usesOrthoRoute(p)) {
      var hist = ensurePathHistory(p);
      var i;
      for (i = 0; i < hist.length; i++) {
        hist[i].x += dx;
        hist[i].y += dy;
      }
      syncPathAlias(p);
    }
  }

  /** Hard wall — yellow jacket frontier may not cross rulerStopX (toward blade). */
  function enforceRulerWall(p, rulerStopX) {
    if (!p || rulerStopX == null) return;
    var i;
    for (i = 0; i < 12; i++) {
      var boundary = getJacketBoundaryWorld(p);
      if (!boundary || boundary.x <= rulerStopX + RULER_WALL_EPS) return;
      translateTailGeometry(p, rulerStopX - boundary.x, 0);
    }
  }

  function bareTipSpanX(bladeX, rulerStopX) {
    var wallX = rulerStopX;
    var blade = bladeX;
    if (!isFinite(wallX) || !isFinite(blade)) {
      return { minX: wallX, maxX: blade };
    }
    /* Bare zone: jacket wall (left/smaller X) → blade/anvil (right/larger X). */
    return {
      minX: Math.min(wallX, blade),
      maxX: Math.max(wallX, blade),
    };
  }

  function flattenOrthoForCleaverSlot(p, tipX, grooveY) {
    if (!usesOrthoRoute(p)) return;
    ensurePathHistory(p);
    var hist = p.pathHistory;
    var start = strainReliefStart(p);
    var inland = Math.max(ORTHO_MIN_SEG, 16);
    var tipFromEast = tipX >= start.x;
    var inlandX = tipFromEast ? tipX - inland : tipX + inland;
    if (!hist.length) {
      hist.push({ x: inlandX, y: grooveY });
    } else {
      var last = hist[hist.length - 1];
      if (Math.abs(last.y - grooveY) > 0.5) {
        hist.push({ x: last.x, y: grooveY });
      }
      last = hist[hist.length - 1];
      if (Math.abs(last.x - tipX) < ORTHO_MIN_SEG) {
        hist[hist.length - 1] = { x: inlandX, y: grooveY };
      }
    }
    p.pathHistory = hist;
    syncPathAlias(p);
    if (p.snake) {
      p.snake.axis = 'h';
      p.snake.ghost = null;
    }
  }

  /**
   * Shift whole tail so yellow jacket frontier (jacketTo) meets the ruler stop wall.
   */
  function alignJacketToRulerWall(p, slot) {
    if (!p || !slot || slot.rulerStopX == null || slot.grooveY == null) return false;
    var grooveY = slot.grooveY;
    var rulerStopX = slot.rulerStopX;
    p.by = grooveY;
    flattenOrthoForCleaverSlot(p, p.bx, grooveY);
    var boundary = getJacketBoundaryWorld(p);
    if (boundary) {
      translateTailGeometry(p, rulerStopX - boundary.x, 0);
    }
    enforceRulerWall(p, rulerStopX);
    p.by = Math.round(grooveY);
    return true;
  }

  /**
   * Pin jacket frontier on ruler stop; bare glass may extend toward blade only.
   */
  function pinJacketToRulerWall(p, slot, desiredTipX) {
    if (!p || !slot) return false;
    var rulerStopX = slot.rulerStopX;
    var grooveY = slot.grooveY;
    var bladeX = slot.bladeX;
    if (rulerStopX == null || grooveY == null || bladeX == null) return false;

    if (!alignJacketToRulerWall(p, slot)) return false;

    var span = bareTipSpanX(bladeX, rulerStopX);
    if (span.maxX - span.minX < ORTHO_MIN_SEG) return false;
    var tipX = Math.max(span.minX, Math.min(span.maxX, desiredTipX));
    p.bx = tipX;
    flattenOrthoForCleaverSlot(p, tipX, grooveY);

    var iter;
    for (iter = 0; iter < 12; iter++) {
      var boundary = getJacketBoundaryWorld(p);
      var err = boundary.x - rulerStopX;
      if (Math.abs(err) < RULER_WALL_EPS) break;
      translateTailGeometry(p, -err, 0);
      p.bx = tipX;
      flattenOrthoForCleaverSlot(p, tipX, grooveY);
    }
    enforceRulerWall(p, rulerStopX);
    p.bx = Math.round(tipX);
    p.by = Math.round(grooveY);
    return true;
  }

  /** Seat fiber in ruler slot — jacket locked at wall, bare tip toward blade. */
  function seatFiberInCleaverSlot(p, cleaverId) {
    return seatFiberOnCleaverDrop(p, cleaverId);
  }

  function refreshPigtailCleaverSlot(pigtailId, cleaverId) {
    var p = findPigtail(pigtailId);
    if (!p || !p.isSnappedToCleaver || p.snappedCleaverId !== cleaverId) return;
    var slot = getCleaverSlotGeometry(cleaverId);
    if (!slot || !slot.open) {
      clearCleaverSnap(p);
      return;
    }
    pinJacketToRulerWall(p, slot, p.bx);
    p.cleaverSlotAnchorX = slot.rulerStopX;
    var guide = cleaverSlotGuideFromInfo(slot);
    if (guide) setCleaverGuideLine(guide, true);
    setCleaverRulerWallGuide(slot, true);
    updateFiberPath(p);
  }

  function updateCleaverSnapVisual(p) {
    if (!layer || !p) return;
    var btn = layer.querySelector('[data-pt-id="' + p.id + '"][data-pt-end="B"]');
    if (btn) btn.classList.toggle('is-cleaver-docked', !!p.isSnappedToCleaver);
  }

  function clearCleaverSnap(p, opts) {
    opts = opts || {};
    if (!p) return;
    var cleaverId = p.snappedCleaverId;
    p.isSnappedToCleaver = false;
    p.snappedCleaverId = null;
    p.cleaverSlotAnchorX = null;
    if (cleaverId && global.FtthLab && typeof FtthLab.setCleaverDockedPigtail === 'function') {
      FtthLab.setCleaverDockedPigtail(cleaverId, null);
    }
    updateCleaverSnapVisual(p);
    restorePermanentStripFrontier(p);
    if (!opts.skipGuide) clearCleaverGuideLine();
    clearCleaverDropzoneHighlight();
  }

  function lockTipInCleaverGroove(p, cleaverId) {
    seatFiberInCleaverSlot(p, cleaverId);
  }

  function snapPigtailToCleaverGroove(p, cleaverId, snapX, grooveY, opts) {
    opts = opts || {};
    if (!p || p.cleaved || p.isCleaved) return false;
    if ((Number(p.stripStage) || 0) < 2) return false;
    if (p.tail && p.tail.attached) return false;
    if (!seatFiberOnCleaverDrop(p, cleaverId)) return false;
    if (global.FtthLab && typeof FtthLab.setCleaverDockedPigtail === 'function') {
      FtthLab.setCleaverDockedPigtail(cleaverId, p.id);
    }
    var slot = getCleaverSlotGeometry(cleaverId);
    var guide = cleaverSlotGuideFromInfo(slot);
    if (guide) setCleaverGuideLine(guide, true);
    if (slot) setCleaverRulerWallGuide(slot, true);
    updateCleaverSnapVisual(p);
    if (!opts.quiet) {
      setStatus('SC Pigtail · jacket seated against cleaver ruler · bare glass in groove');
    }
    return true;
  }

  function findCleaverGrooveSnapForTip(p, tipX, tipY) {
    if (!global.FtthLab || typeof FtthLab.findCleaverGrooveNear !== 'function') return null;
    if (!p || p.cleaved || p.isCleaved) return null;
    if ((Number(p.stripStage) || 0) < 2) return null;
    if (p.tail && p.tail.attached) return null;
    return FtthLab.findCleaverGrooveNear(tipX, tipY, CLEAVER_SNAP_PX);
  }

  function setCleaverDropzoneHighlight(cleaverId) {
    if (global.FtthLab && typeof FtthLab.setCleaverDropzoneActive === 'function') {
      FtthLab.setCleaverDropzoneActive(cleaverId, true);
    }
  }

  function clearCleaverDropzoneHighlight() {
    if (global.FtthLab && typeof FtthLab.clearCleaverDropzones === 'function') {
      FtthLab.clearCleaverDropzones();
    }
  }

  function cleaverEligibleForDropzone(p) {
    if (!p || p.cleaved || p.isCleaved) return false;
    if ((Number(p.stripStage) || 0) < 2) return false;
    if (p.tail && p.tail.attached) return false;
    return true;
  }

  /**
   * Snap on release only: lock Y to groove, shift tail so jacketTo meets ruler stop (art X=305).
   */
  function seatFiberOnCleaverDrop(p, cleaverId) {
    if (!cleaverEligibleForDropzone(p)) return false;
    var slot = getCleaverSlotGeometry(cleaverId);
    if (!slot || !slot.open || slot.grooveY == null || slot.rulerStopX == null) return false;

    var grooveY = slot.grooveY;
    var rulerStopX = slot.rulerStopX;
    var bladeX = slot.bladeX;
    var span = bareTipSpanX(bladeX, rulerStopX);
    if (span.maxX - span.minX < ORTHO_MIN_SEG) return false;

    p.by = Math.round(grooveY);
    flattenOrthoForCleaverSlot(p, p.bx, grooveY);

    var boundary = getJacketBoundaryWorld(p);
    if (boundary) {
      translateTailGeometry(p, rulerStopX - boundary.x, 0);
    }
    enforceRulerWall(p, rulerStopX);

    var tipX = Math.max(span.minX, Math.min(span.maxX, p.bx));
    p.bx = tipX;
    flattenOrthoForCleaverSlot(p, tipX, grooveY);
    boundary = getJacketBoundaryWorld(p);
    if (boundary) {
      translateTailGeometry(p, rulerStopX - boundary.x, 0);
    }
    enforceRulerWall(p, rulerStopX);

    var iter;
    for (iter = 0; iter < 16; iter++) {
      boundary = getJacketBoundaryWorld(p);
      if (!boundary || Math.abs(boundary.x - rulerStopX) < RULER_WALL_EPS) break;
      translateTailGeometry(p, rulerStopX - boundary.x, 0);
    }

    p.bx = Math.round(Math.max(span.minX, Math.min(span.maxX, p.bx)));
    p.by = Math.round(grooveY);
    p.isSnappedToCleaver = true;
    p.snappedCleaverId = cleaverId;
    p.cleaverSlotAnchorX = rulerStopX;
    lockPermanentStripFrontier(p);
    return true;
  }

  function finishCleaverDropSeat(p, cleaverId) {
    if (!seatFiberOnCleaverDrop(p, cleaverId)) return false;
    if (global.FtthLab && typeof FtthLab.setCleaverDockedPigtail === 'function') {
      FtthLab.setCleaverDockedPigtail(cleaverId, p.id);
    }
    var slot = getCleaverSlotGeometry(cleaverId);
    var guide = cleaverSlotGuideFromInfo(slot);
    if (guide) setCleaverGuideLine(guide, true);
    if (slot) setCleaverRulerWallGuide(slot, true);
    updateCleaverSnapVisual(p);
    updateFiberPath(p);
    setStatus('SC Pigtail · jacket seated against cleaver ruler · bare glass in groove');
    return true;
  }

  /** Bare stripped tip probe for cleaver secondary snap. */
  function findBareTipNearWorld(wx, wy, radiusPx) {
    var thr = typeof radiusPx === 'number' ? radiusPx : CLEAVER_SNAP_PX;
    var best = null;
    var bestD = thr + 1;
    var i;
    for (i = 0; i < pigtails.length; i++) {
      var p = pigtails[i];
      if (!p || p.cleaved || p.isCleaved) continue;
      if ((Number(p.stripStage) || 0) < 2) continue;
      if (p.tail && p.tail.attached) continue;
      var d = dist2(wx, wy, p.bx, p.by);
      if (d <= thr && d < bestD) {
        bestD = d;
        best = { id: p.id, x: p.bx, y: p.by, dist: d };
      }
    }
    return best;
  }

  function undockPigtailsFromCleaver(cleaverId) {
    var changed = false;
    pigtails.forEach(function (p) {
      if (p.isSnappedToCleaver && p.snappedCleaverId === cleaverId) {
        clearCleaverSnap(p, { skipGuide: true });
        changed = true;
      }
    });
    if (changed) clearCleaverGuideLine();
    if (changed) rebuildLayer();
  }

  function finalizePigtailCleaverDock(pigtailId) {
    var p = findPigtail(pigtailId);
    if (!p || !p.isSnappedToCleaver || !p.snappedCleaverId) {
      clearCleaverGuideLine();
      return;
    }
    refreshPigtailCleaverSlot(pigtailId, p.snappedCleaverId);
    pushHistory();
    setStatus('SC Pigtail · jacket seated against cleaver ruler · bare glass in groove');
  }

  /* ─── Fusion splicer clamp V-groove snap (cleaved pigtails) ─── */

  function splicerEligibleForSnap(p) {
    if (!p) return false;
    if (!(p.isCleaved || p.cleaved) && !isFullyStrippedPigtail(p)) return false;
    if (p.tail && p.tail.attached) return false;
    if (p.isSnappedToCleaver) return false;
    return true;
  }

  function getSplicerGrooveSlot(machineId, side, opts) {
    opts = opts || {};
    if (!global.FusionSplicerMachine) return null;
    if (opts.forTracking && typeof FusionSplicerMachine.getGrooveSlotForTracking === 'function') {
      return FusionSplicerMachine.getGrooveSlotForTracking(machineId, side);
    }
    if (typeof FusionSplicerMachine.getGrooveSlot === 'function') {
      return FusionSplicerMachine.getGrooveSlot(machineId, side);
    }
    return null;
  }

  function findSnappedPigtailOnSide(machineId, side, exceptId) {
    var i;
    for (i = 0; i < pigtails.length; i++) {
      var cand = pigtails[i];
      if (exceptId && cand.id === exceptId) continue;
      if (
        cand.isSnappedToSplicer &&
        cand.snappedSplicerId === machineId &&
        cand.snappedSplicerSide === side
      ) {
        return cand;
      }
    }
    return null;
  }

  function getSplicerDockedPair(machineId) {
    var left = null;
    var right = null;
    var i;
    for (i = 0; i < pigtails.length; i++) {
      var p = pigtails[i];
      if (!p.isSnappedToSplicer || p.snappedSplicerId !== machineId) continue;
      if (p.snappedSplicerSide === 'L') left = p;
      if (p.snappedSplicerSide === 'R') right = p;
    }
    return { left: left, right: right };
  }

  function isSplicerWeldedPair(machineId) {
    var pair = getSplicerDockedPair(machineId);
    return !!(
      pair.left &&
      pair.right &&
      pair.left.splicerWeldMachineId === machineId &&
      pair.right.splicerWeldMachineId === machineId
    );
  }

  function captureSplicerDockSnapshot(p) {
    if (!p) return;
    ensureFiberStrip(p);
    p.splicerDockSnapshot = {
      jacketTo: p.fiberStrip.jacketTo,
      bareTo: p.fiberStrip.bareTo,
      peel: p.fiberStrip.peel,
      peelLayer: p.fiberStrip.peelLayer,
    };
  }

  /** Restore strip arc-lengths captured before docking — never clamp-truncate after unsnap. */
  function restoreSplicerDockStripState(p) {
    if (!p || !p.splicerDockSnapshot) return;
    ensureFiberStrip(p);
    var snap = p.splicerDockSnapshot;
    p.fiberStrip.jacketTo = snap.jacketTo;
    p.fiberStrip.bareTo = snap.bareTo;
    p.fiberStrip.peel = snap.peel;
    p.fiberStrip.peelLayer = snap.peelLayer;
    p.splicerDockSnapshot = null;
    enforceFullStripBareFrontier(p);
    if (isFullyStrippedPigtail(p) || p.stripFrontierLock) {
      restorePermanentStripFrontier(p);
    }
  }

  function clearSplicerWeldForMachine(machineId) {
    if (!machineId) return;
    pigtails.forEach(function (p) {
      if (p.splicerWeldMachineId === machineId) {
        p.splicerWeldMachineId = null;
      }
    });
  }

  function syncSplicerWeldedTips(machineId) {
    if (!isSplicerWeldedPair(machineId)) return false;
    var pair = getSplicerDockedPair(machineId);
    var slotL = getSplicerGrooveSlot(machineId, 'L', { forTracking: true });
    var slotR = getSplicerGrooveSlot(machineId, 'R', { forTracking: true });
    if (!slotL || !slotR || !pair.left || !pair.right) return false;
    var meetX = (slotL.innerEdgeX + slotR.innerEdgeX) / 2;
    var grooveY = (slotL.grooveY + slotR.grooveY) / 2;
    pair.left.bx = Math.round(meetX);
    pair.left.by = Math.round(grooveY);
    pair.right.bx = Math.round(meetX);
    pair.right.by = Math.round(grooveY);
    pair.left.splicerInnerEdgeX = slotL.innerEdgeX;
    pair.right.splicerInnerEdgeX = slotR.innerEdgeX;
    return true;
  }

  function applySplicerArcWeld(machineId) {
    var pair = getSplicerDockedPair(machineId);
    if (!pair.left || !pair.right) return false;
    pair.left.splicerWeldMachineId = machineId;
    pair.right.splicerWeldMachineId = machineId;
    syncSplicerWeldedTips(machineId);
    return true;
  }

  /** Rigid-body shift — entire pigtail (connector, route, tip) moves as one unit. */
  function translatePigtailRigid(p, deltaX, deltaY) {
    if (!p) return;
    var dx = deltaX || 0;
    var dy = deltaY || 0;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
    p.ax += dx;
    p.ay += dy;
    p.bx += dx;
    p.by += dy;
    var hist = ensurePathHistory(p);
    var i;
    for (i = 0; i < hist.length; i++) {
      hist[i].x += dx;
      hist[i].y += dy;
    }
    syncPathAlias(p);
  }

  function translatePigtailRigidY(p, deltaY) {
    translatePigtailRigid(p, 0, deltaY);
  }

  /** Exposed bare-glass length on the render path (same px as free-state bare segment). */
  function getSplicerExposedBareLengthPx(p) {
    return Math.max(CLEAVE_MIN_CUT_PX, getBareGlassDrawLengthPx(p));
  }

  /**
   * Docked tip alignment — per-side only. Never mutates strip arc-lengths (clamp truncation
   * is geometric in buildPigtailFiberSvg). Bare glass length matches the free-state draw length.
   */
  function alignSplicerJacketToInnerEdge(p, slot) {
    if (!p || !slot) return false;
    var dir = slot.side === 'L' ? 1 : -1;
    var welded = p.splicerWeldMachineId === slot.machineId && isSplicerWeldedPair(slot.machineId);
    if (welded) {
      syncSplicerWeldedTips(slot.machineId);
      return true;
    }
    var exposed = getBareGlassDrawLengthPx(p);
    if (exposed < CLEAVE_MIN_CUT_PX) exposed = CLEAVE_MIN_CUT_PX;
    p.bx = Math.round(slot.innerEdgeX + dir * exposed);
    p.by = Math.round(slot.grooveY);
    p.splicerBareGlassPx = exposed;
    p.splicerInnerEdgeX = slot.innerEdgeX;
    return true;
  }

  /** Shift whole pigtail vertically so tip Y aligns with groove — no stretch, no diagonal bridge. */
  function applySplicerRigidSnapShift(p, slot) {
    if (!p || !slot) return false;
    var deltaY = slot.grooveY - p.by;
    if (Math.abs(deltaY) > 0.01) {
      translatePigtailRigidY(p, deltaY);
    }
    p.by = Math.round(slot.grooveY);
    p.ay = Math.round(p.ay);
    return true;
  }

  var splicerDockTrackRafId = null;

  function syncSnappedPigtailToLiveGroove(p) {
    if (!p || !p.isSnappedToSplicer) return false;
    var slot = getSplicerGrooveSlot(p.snappedSplicerId, p.snappedSplicerSide, { forTracking: true });
    if (!slot) return false;
    var changed = false;
    if (!p.splicerGrooveAnchor) {
      p.splicerGrooveAnchor = { x: slot.centerX, y: slot.grooveY };
      p.splicerGrooveY = slot.grooveY;
    } else {
      var deltaX = slot.centerX - p.splicerGrooveAnchor.x;
      var deltaY = slot.grooveY - p.splicerGrooveAnchor.y;
      if (Math.abs(deltaX) >= 0.01 || Math.abs(deltaY) >= 0.01) {
        translatePigtailRigid(p, deltaX, deltaY);
        p.splicerGrooveAnchor = { x: slot.centerX, y: slot.grooveY };
        p.splicerGrooveY = slot.grooveY;
        changed = true;
      }
    }
    var innerDrift = p.splicerInnerEdgeX == null ||
      Math.abs(p.splicerInnerEdgeX - slot.innerEdgeX) > 0.5;
    if (changed || innerDrift) {
      alignSplicerJacketToInnerEdge(p, slot);
      changed = true;
    }
    return changed;
  }

  function splicerDockTrackTick() {
    var anySnapped = false;
    var changed = false;
    var machineIds = {};
    pigtails.forEach(function (p) {
      if (!p.isSnappedToSplicer) return;
      anySnapped = true;
      if (p.snappedSplicerId) machineIds[p.snappedSplicerId] = true;
      if (syncSnappedPigtailToLiveGroove(p)) {
        changed = true;
        updateFiberPath(p);
      }
    });
    if (changed) {
      Object.keys(machineIds).forEach(function (mid) {
        renderSplicerFiberOverlays(mid);
      });
      if (layer) rebuildLayer();
    }
    if (anySnapped) {
      splicerDockTrackRafId = requestAnimationFrame(splicerDockTrackTick);
    } else {
      splicerDockTrackRafId = null;
    }
  }

  function ensureSplicerDockTracking() {
    if (splicerDockTrackRafId != null) return;
    splicerDockTrackRafId = requestAnimationFrame(splicerDockTrackTick);
  }

  function stopSplicerDockTracking() {
    if (splicerDockTrackRafId != null) {
      cancelAnimationFrame(splicerDockTrackRafId);
      splicerDockTrackRafId = null;
    }
  }

  function seatFiberInSplicerGroove(p, slot, opts) {
    opts = opts || {};
    if (!p || !slot || !slot.open) return false;
    if (!splicerEligibleForSnap(p) && !opts.force) return false;
    var occupant = findSnappedPigtailOnSide(slot.machineId, slot.side, p.id);
    if (occupant) return false;

    captureSplicerDockSnapshot(p);
    applySplicerRigidSnapShift(p, slot);
    alignSplicerJacketToInnerEdge(p, slot);

    p.isSnappedToSplicer = true;
    p.snappedSplicerId = slot.machineId;
    p.snappedSplicerSide = slot.side;
    p.splicerGrooveY = slot.grooveY;
    p.splicerTipX = p.bx;
    p.splicerGrooveAnchor = { x: slot.centerX, y: slot.grooveY };
    p.splicerPreviewSlot = null;

    if (global.FusionSplicerMachine && global.FusionSplicerMachine.getUI) {
      var api = FusionSplicerMachine.getUI(slot.machineId);
      if (api && typeof api.setFiberPlaced === 'function') {
        api.setFiberPlaced(slot.side, true);
      }
    }

    if (!opts.quiet) {
      setStatus('SC Pigtail · seated in ' + slot.side + '-clamp V-groove');
    }
    ensureSplicerDockTracking();
    return true;
  }

  function clearSplicerSnap(p, opts) {
    opts = opts || {};
    if (!p || !p.isSnappedToSplicer) return;
    var machineId = p.snappedSplicerId;
    var side = p.snappedSplicerSide;
    p.isSnappedToSplicer = false;
    p.snappedSplicerId = null;
    p.snappedSplicerSide = null;
    p.splicerGrooveY = null;
    p.splicerTipX = null;
    p.splicerPreviewSlot = null;
    p.splicerGrooveAnchor = null;
    p.splicerBareGlassPx = null;
    p.splicerInnerEdgeX = null;
    restoreSplicerDockStripState(p);
    if (machineId) clearSplicerWeldForMachine(machineId);
    if (machineId && side && global.FusionSplicerMachine && FusionSplicerMachine.getUI) {
      var api = FusionSplicerMachine.getUI(machineId);
      if (api && typeof api.setFiberPlaced === 'function') {
        api.setFiberPlaced(side, false);
      }
    }
    if (machineId) {
      renderSplicerFiberOverlays(machineId);
      if (!opts.skipRebuild && global.FusionSplicerMachine && FusionSplicerMachine.syncLidOverlays) {
        FusionSplicerMachine.syncLidOverlays(machineId);
      }
    }
  }

  /** Instant unsnap — detach machine slot, keep current geometry (shifted pathHistory + curves). */
  function forceUnsnapPigtailFromSplicer(p) {
    if (!p || !p.isSnappedToSplicer) return false;
    clearSplicerSnap(p, { skipRebuild: true });
    p.splicerDragDetached = true;
    updateFiberPath(p);
    return true;
  }

  /** Pointer → silver `.clamp-base-groove` via elementFromPoint (no radius math). */
  function hitTestSplicerGroove(clientX, clientY) {
    if (!global.FusionSplicerMachine ||
        typeof FusionSplicerMachine.hitTestSplicerGrooveAtClient !== 'function') {
      return null;
    }
    return FusionSplicerMachine.hitTestSplicerGrooveAtClient(clientX, clientY);
  }

  function setPigtailDragPassthrough(p, active) {
    if (!p) return;
    var selector = '[data-pt-drag="' + p.id + '"]';
    if (layer) {
      layer.querySelectorAll(selector).forEach(function (el) {
        el.classList.toggle('is-drag-passthrough', !!active);
        el.style.pointerEvents = active ? 'none' : '';
      });
      layer.querySelectorAll('[data-pt-fiber="' + p.id + '"]').forEach(function (el) {
        el.style.pointerEvents = active ? 'none' : '';
      });
    }
    document.querySelectorAll('.lab-fusion-fiber-layer ' + selector).forEach(function (el) {
      el.classList.toggle('is-drag-passthrough', !!active);
      el.style.pointerEvents = active ? 'none' : '';
    });
  }

  function highlightSplicerGrooveHit(hit) {
    if (global.FusionSplicerMachine && typeof FusionSplicerMachine.highlightSplicerGroove === 'function') {
      FusionSplicerMachine.highlightSplicerGroove(hit && hit.grooveEl ? hit.grooveEl : null);
      return;
    }
    if (hit && hit.grooveEl) {
      clearSplicerMagnetHighlight();
      hit.grooveEl.classList.add('magnet-active');
    } else if (hit && hit.machineId && hit.side) {
      setSplicerDropzoneHighlight(hit.machineId, hit.side);
    } else {
      clearSplicerMagnetHighlight();
    }
  }

  function clearSplicerMagnetHighlight() {
    if (global.FusionSplicerMachine && typeof FusionSplicerMachine.clearSplicerMagnetHighlights === 'function') {
      FusionSplicerMachine.clearSplicerMagnetHighlights();
      return;
    }
    document.querySelectorAll('.clamp-base-groove.magnet-active').forEach(function (el) {
      el.classList.remove('magnet-active');
    });
  }

  /** Magnet glow only while dragging — rigid snap executes on pointerup drop. */
  function applySplicerMagnetDuringDrag(p, clientX, clientY) {
    if (p.splicerDragDetached) return;
    if (!splicerEligibleForSnap(p)) {
      p.splicerPreviewSlot = null;
      clearSplicerMagnetHighlight();
      return;
    }
    var splicerHit = hitTestSplicerGroove(clientX, clientY);
    if (splicerHit && splicerHit.slot) {
      p.splicerPreviewSlot = splicerHit.slot;
      highlightSplicerGrooveHit(splicerHit);
      return;
    }
    p.splicerPreviewSlot = null;
    clearSplicerMagnetHighlight();
  }

  /** Lock pigtail into groove on pointer release. */
  function finishSplicerMagnetOnDrop(p, clientX, clientY) {
    if (!splicerEligibleForSnap(p)) return false;
    var dropHit = hitTestSplicerGroove(clientX, clientY);
    if (dropHit && dropHit.slot) {
      return finishSplicerDropSeat(p, dropHit);
    }
    return false;
  }

  function setSplicerDropzoneHighlight(machineId, side) {
    if (global.FusionSplicerMachine && typeof FusionSplicerMachine.setSplicerDropzoneActive === 'function') {
      FusionSplicerMachine.setSplicerDropzoneActive(machineId, side, true);
    }
  }

  function clearSplicerDropzoneHighlight() {
    clearSplicerMagnetHighlight();
    if (global.FusionSplicerMachine && typeof FusionSplicerMachine.clearSplicerDropzones === 'function') {
      FusionSplicerMachine.clearSplicerDropzones();
    }
  }

  function finishSplicerDropSeat(p, hit) {
    if (!hit || !hit.slot) return false;
    var ok = seatFiberInSplicerGroove(p, hit.slot);
    if (!ok) return false;
    updateFiberPath(p);
    renderSplicerFiberOverlays(hit.slot.machineId);
    return true;
  }

  function handoverPigtailToSplicerClamp(machineId, side, opts) {
    opts = opts || {};
    var slot = getSplicerGrooveSlot(machineId, side);
    if (!slot) return { ok: false, reason: 'no-slot' };
    if (!slot.open && !opts.forceOpen) return { ok: false, reason: 'clamp-closed' };

    var pig = opts.pigtailId ? findPigtail(opts.pigtailId) : null;
    var i;
    if (!pig) {
      pig = findSnappedPigtailOnSide(machineId, side);
    }
    if (!pig) {
      for (i = 0; i < pigtails.length; i++) {
        var cand = pigtails[i];
        if (!splicerEligibleForSnap(cand)) continue;
        if (cand.isSnappedToSplicer && cand.snappedSplicerId === machineId) continue;
        pig = cand;
        break;
      }
    }
    if (!pig) return { ok: false, reason: 'no-pigtail' };

    var ok = seatFiberInSplicerGroove(pig, slot, { force: !!opts.force, quiet: !!opts.quiet });
    if (!ok) return { ok: false, reason: 'seat-failed' };

    updateFiberPath(pig);
    rebuildLayer();
    renderSplicerFiberOverlays(machineId);
    if (!opts.quiet) pushHistory();
    return { ok: true, pigtailId: pig.id, slot: slot };
  }

  /** 60fps motor-align sync — force L/R docked pigtails to follow clamp CSS transform mid-transition. */
  function syncSplicerMotorAlignFrame(machineId) {
    if (!machineId) return false;
    var any = false;
    var changed = false;
    pigtails.forEach(function (p) {
      if (!p.isSnappedToSplicer || p.snappedSplicerId !== machineId) return;
      any = true;
      if (syncSnappedPigtailToLiveGroove(p)) changed = true;
      updateFiberPath(p);
    });
    if (any) renderSplicerFiberOverlays(machineId);
    return changed;
  }

  function refreshSplicerDocks(machineId) {
    var changed = false;
    pigtails.forEach(function (p) {
      if (!p.isSnappedToSplicer) return;
      if (machineId && p.snappedSplicerId !== machineId) return;
      var slot = getSplicerGrooveSlot(p.snappedSplicerId, p.snappedSplicerSide, { forTracking: true });
      if (!slot) {
        clearSplicerSnap(p, { skipRebuild: true });
        changed = true;
        return;
      }
      if (syncSnappedPigtailToLiveGroove(p)) {
        updateFiberPath(p);
        changed = true;
      }
    });
    if (changed) {
      rebuildLayer();
      renderSplicerFiberOverlays(machineId);
    } else if (machineId) {
      renderSplicerFiberOverlays(machineId);
    } else {
      renderSplicerFiberOverlays();
    }
  }

  function renderSplicerFiberOverlays(machineId) {
    if (!global.FusionSplicerMachine || typeof FusionSplicerMachine.ensureFiberLayer !== 'function') {
      return;
    }
    var ids = {};
    var i;
    for (i = 0; i < pigtails.length; i++) {
      if (pigtails[i].isSnappedToSplicer && pigtails[i].snappedSplicerId) {
        ids[pigtails[i].snappedSplicerId] = true;
      }
    }
    if (machineId) ids[machineId] = true;

    Object.keys(ids).forEach(function (mid) {
      var host = FusionSplicerMachine.ensureFiberLayer(mid);
      if (!host) return;
      var svg = host.querySelector('.lab-pigtail-svg');
      if (!svg) return;
      var html = '';
      pigtails.forEach(function (p) {
        if (!p.isSnappedToSplicer || p.snappedSplicerId !== mid) return;
        html +=
          '<g data-pt-fiber-wrap="' + p.id + '">' +
          buildPigtailFiberSvg(p, { splicerPort: true }) +
          '</g>';
      });
      svg.innerHTML = html;
      svg.querySelectorAll('[data-pt-drag]').forEach(bindPigtailBodyDragGrip);
      if (FusionSplicerMachine.syncLidOverlays) {
        FusionSplicerMachine.syncLidOverlays(mid);
      }
    });

    if (global.FusionSplicerMachine.list) {
      FusionSplicerMachine.list().forEach(function (m) {
        if (ids[m.id]) return;
        var stale = document.querySelector('[data-fusion-fiber-layer="' + m.id + '"]');
        if (stale) {
          var svg = stale.querySelector('.lab-pigtail-svg');
          if (svg) svg.innerHTML = '';
        }
        if (FusionSplicerMachine.syncLidOverlays) {
          FusionSplicerMachine.syncLidOverlays(m.id);
        }
      });
    }
  }

  /**
   * u is clamped to each segment [0,1] so empty space past the tip never hits.
   */
  function projectOntoFiberStrict(pts, wx, wy) {
    if (!pts || pts.length < 2) {
      return { x: wx, y: wy, rot: 0, dist: 0, t: 0, perpDist: Infinity, onSegment: false };
    }
    var total = polylineLength(pts);
    var best = null;
    var acc = 0;
    var i;
    for (i = 1; i < pts.length; i++) {
      var ax = pts[i - 1].x;
      var ay = pts[i - 1].y;
      var bx = pts[i].x;
      var by = pts[i].y;
      var segDx = bx - ax;
      var segDy = by - ay;
      var segLen = Math.sqrt(segDx * segDx + segDy * segDy);
      var segLen2 = segLen * segLen;
      var u = segLen2 > 0 ? ((wx - ax) * segDx + (wy - ay) * segDy) / segLen2 : 0;
      var uClamped = Math.max(0, Math.min(1, u));
      var px = ax + segDx * uClamped;
      var py = ay + segDy * uClamped;
      var perp = dist2(wx, wy, px, py);
      var along = acc + uClamped * segLen;
      var cand = {
        x: px,
        y: py,
        rot: fiberPathTangentRotDeg(segDx, segDy),
        dist: along,
        t: total > 0 ? along / total : 0,
        perpDist: perp,
        onSegment: u >= -0.001 && u <= 1.001,
      };
      if (!best || perp < best.perpDist) best = cand;
      acc += segLen;
    }
    return best || {
      x: wx, y: wy, rot: 0, dist: 0, t: 0, perpDist: Infinity, onSegment: false,
    };
  }

  function polylineAxisBounds(pts) {
    var minX = Infinity;
    var maxX = -Infinity;
    var minY = Infinity;
    var maxY = -Infinity;
    var i;
    for (i = 0; i < (pts || []).length; i++) {
      var p = pts[i];
      if (!p) continue;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    if (!isFinite(minX)) {
      return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }
    return { minX: minX, maxX: maxX, minY: minY, maxY: maxY };
  }

  function peelDirsFromPath(pts) {
    var tip = pts[0];
    var inner = pts.length > 1 ? pts[1] : tip;
    var dx = tip.x - inner.x;
    var dy = tip.y - inner.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { peelUx: dx / len, peelUy: dy / len };
  }

  /**
   * Notch must sit on remaining unstripped material:
   * - Jacket: anywhere inland on the yellow jacket
   * - Buffer: on exposed coating between bareTo and jacketTo
   */
  function notchIntersectsUnstrippedFiber(p, wx, wy, thresholdPx) {
    var thr = typeof thresholdPx === 'number' ? thresholdPx : STRIP_NOTCH_HIT_PX;
    thr = Math.min(thr, STRIP_NOTCH_HIT_PX);
    if (!p || p.isCleaved || p.cleaved) return null;
    ensureFiberStrip(p);
    clampStripFrontiersToPath(p);
    var fs = p.fiberStrip;

    var pts = fiberSleevePathPoints(p);
    if (!pts || pts.length < 2) return null;
    var total = polylineLength(pts);
    var jacketTo = fs.jacketTo || 0;
    var bareTo = fs.bareTo || 0;
    var maxStrip = total;
    var hasJacketRemain = jacketTo < maxStrip - STRIP_TIP_EPS;
    var hasBufferRemain = jacketTo > STRIP_TIP_EPS && bareTo < jacketTo - STRIP_BUFFER_COMPLETE_PX;
    if (!hasJacketRemain && !hasBufferRemain) return null;

    var proj = projectOntoFiberStrict(pts, wx, wy);
    if (!proj || !proj.onSegment) return null;
    if (proj.perpDist > thr) return null;
    if (proj.dist < -0.01) return null;

    if (hasJacketRemain && proj.dist >= jacketTo - STRIP_TIP_EPS && proj.dist <= maxStrip + STRIP_TIP_EPS) {
      return stripHitFromProj(p, pts, proj, 0, 'jacket', thr);
    }

    if (hasBufferRemain && proj.dist >= bareTo - STRIP_TIP_EPS && proj.dist < jacketTo - STRIP_BUFFER_COMPLETE_PX) {
      return stripHitFromProj(p, pts, proj, 1, 'buffer', thr);
    }

    return null;
  }

  function projectPigtailStripNotch(id, wx, wy) {
    var p = findPigtail(id);
    if (!p) return null;
    var pts = fiberSleevePathPoints(p);
    if (!pts || pts.length < 2) return null;
    var proj = projectOntoFiberStrict(pts, wx, wy);
    if (!proj) return null;
    var dirs = peelDirsFromPath(pts);
    return {
      dist: proj.dist,
      x: proj.x,
      y: proj.y,
      rot: proj.rot,
      perpDist: proj.perpDist,
      onSegment: proj.onSegment,
      peelUx: dirs.peelUx,
      peelUy: dirs.peelUy,
    };
  }

  /**
   * Arc-length from tip for an active peel — clamps to tip (0) when dragged past the end.
   */
  function peelAlongDistForSession(pts, wx, wy, session) {
    if (!pts || !session) return 0;
    var proj = projectOntoFiberStrict(pts, wx, wy);
    if (!proj) return 0;
    var along = Math.max(0, proj.dist);
    if (!isFinite(along)) along = 0;
    if (along <= STRIP_TIP_EPS) return 0;
    if (!proj.onSegment && along < (session.startAlong || 0) + 2) {
      return along;
    }
    if (along > session.startAlong + STRIP_TIP_EPS) {
      along = session.startAlong;
    }
    return along;
  }

  function peelAcceptsNotch(proj, session) {
    if (!proj || !session) return false;
    if (proj.perpDist <= STRIP_NOTCH_HIT_PX + 2) return true;
    if (proj.dist <= Math.max(3, (session.startAlong || 0) * 0.2)) return true;
    return false;
  }

  /**
   * Commit the full clamped segment when the peel session ends or the tool passes the tip.
   */
  function commitStripPeelSession(id, layerKind, session) {
    var p = findPigtail(id);
    if (!p || !session) return;
    ensureFiberStrip(p);
    var fs = p.fiberStrip;
    var maxLen = maxStripLenPx(p);
    var clampAlong = Math.min(maxLen, Math.max(0, session.startAlong || 0));
    if (layerKind === 'jacket') {
      fs.jacketTo = Math.min(maxLen, Math.max(fs.jacketTo || 0, clampAlong));
      if (fs.bareTo > fs.jacketTo) fs.bareTo = fs.jacketTo;
    } else if (layerKind === 'buffer') {
      var cap = Math.min(fs.jacketTo || 0, clampAlong);
      fs.bareTo = Math.min(fs.jacketTo || 0, Math.max(fs.bareTo || 0, cap));
      snapBareToJacket(fs);
    }
    fs.peel = 0;
    fs.peelLayer = null;
    syncStripStageFromFiberStrip(p);
    updateStripVisuals(p);
  }

  /**
   * Apply a clamp-and-drag strip from the cutting-notch world position.
   * Frontier = session.startAlong − notchAlong (arc-length from tip); completes at clamp point.
   */
  function applyStripDragFromNotch(id, wx, wy, layerKind, session) {
    var p = findPigtail(id);
    if (!p || !session) return null;
    ensureFiberStrip(p);
    clampStripFrontiersToPath(p);
    var fs = p.fiberStrip;
    if (layerKind === 'buffer' && (fs.jacketTo || 0) < STRIP_TIP_EPS) return null;

    var pts = fiberSleevePathPoints(p);
    if (!pts || pts.length < 2) return null;

    var along = peelAlongDistForSession(pts, wx, wy, session);
    var proj = projectOntoFiberStrict(pts, wx, wy);
    if (!proj || !peelAcceptsNotch(proj, session)) {
      if (along <= STRIP_TIP_EPS) {
        commitStripPeelSession(id, layerKind, session);
        proj = projectOntoFiberStrict(pts, pts[0].x, pts[0].y);
        return {
          ok: true,
          proj: proj,
          peeled: session.startAlong,
          jacketTo: fs.jacketTo,
          bareTo: fs.bareTo,
          peelUx: peelDirsFromPath(pts).peelUx,
          peelUy: peelDirsFromPath(pts).peelUy,
          completed: true,
        };
      }
      return null;
    }

    var maxLen = maxStripLenPx(p);
    var clampAlong = Math.min(maxLen, Math.max(0, session.startAlong || 0));
    var targetFrontier = Math.max(0, clampAlong - along);
    var peeled = clampAlong - targetFrontier;
    var animPx = layerKind === 'buffer' ? STRIP_PEEL_ANIM_PX * 0.85 : STRIP_PEEL_ANIM_PX;

    if (layerKind === 'jacket') {
      var newJacket = Math.min(maxLen, Math.max(fs.jacketTo || 0, targetFrontier));
      if (newJacket + STRIP_TIP_EPS < fs.jacketTo) return null;
      fs.jacketTo = newJacket;
      if (fs.bareTo > fs.jacketTo) fs.bareTo = fs.jacketTo;
      fs.peelLayer = 'jacket';
      fs.peel = Math.min(1, peeled / animPx);
    } else if (layerKind === 'buffer') {
      var newBare = Math.min(fs.jacketTo || 0, Math.max(fs.bareTo || 0, targetFrontier));
      if (newBare + STRIP_TIP_EPS < fs.bareTo) return null;
      fs.bareTo = newBare;
      if (along <= STRIP_TIP_EPS || isBareStripComplete(fs)) {
        snapBareToJacket(fs);
      }
      fs.peelLayer = 'buffer';
      fs.peel = Math.min(1, peeled / animPx);
    } else {
      return null;
    }

    syncStripStageFromFiberStrip(p);
    updateStripVisuals(p);
    return {
      ok: true,
      proj: proj,
      peeled: peeled,
      jacketTo: fs.jacketTo,
      bareTo: fs.bareTo,
      peelUx: peelDirsFromPath(pts).peelUx,
      peelUy: peelDirsFromPath(pts).peelUy,
      completed: along <= STRIP_TIP_EPS,
    };
  }

  function findStripTarget(clientX, clientY, thresholdPx) {
    var world = clientToWorld(clientX, clientY);
    return findStripTargetAtWorld(world.x, world.y, thresholdPx);
  }

  /**
   * Precision probe: world cutting-notch must intersect unstripped jacket or buffer.
   */
  function findStripTargetAtWorld(wx, wy, thresholdPx) {
    var thr = typeof thresholdPx === 'number' ? thresholdPx : STRIP_NOTCH_HIT_PX;
    thr = Math.min(thr, STRIP_NOTCH_HIT_PX);
    var best = null;
    var bestD = thr + 1;
    var i;
    for (i = 0; i < pigtails.length; i++) {
      var hit = notchIntersectsUnstrippedFiber(pigtails[i], wx, wy, thr);
      if (!hit) continue;
      if (hit.perpDist < bestD) {
        bestD = hit.perpDist;
        best = hit;
      }
    }
    return best;
  }

  /**
   * Intersect a polyline with vertical line x = cutX; pick crossing nearest nearY.
   */
  function intersectPolylineWithVertical(pts, cutX, nearY) {
    if (!pts || pts.length < 2) return null;
    var best = null;
    var bestDy = Infinity;
    var i;
    for (i = 0; i < pts.length - 1; i++) {
      var ax = pts[i].x;
      var ay = pts[i].y;
      var bx = pts[i + 1].x;
      var by = pts[i + 1].y;
      var minx = Math.min(ax, bx) - 0.5;
      var maxx = Math.max(ax, bx) + 0.5;
      if (cutX < minx || cutX > maxx) continue;
      var y;
      var t = 0;
      if (Math.abs(bx - ax) < 0.001) {
        if (Math.abs(ax - cutX) > 0.5) continue;
        y = ay;
      } else {
        t = (cutX - ax) / (bx - ax);
        if (t < -0.001 || t > 1.001) continue;
        y = ay + t * (by - ay);
      }
      var dy = Math.abs(y - nearY);
      if (dy < bestDy) {
        bestDy = dy;
        best = { x: cutX, y: y, segIndex: i, t: t };
      }
    }
    return best;
  }

  function trimOrthoPathAtCut(p, fullPts, cut) {
    if (!p || !fullPts || !cut) return;
    var newHist = [];
    var i;
    for (i = 1; i <= cut.segIndex; i++) {
      newHist.push({ x: fullPts[i].x, y: fullPts[i].y });
    }
    var cutPt = { x: cut.x, y: cut.y };
    if (!newHist.length) {
      p.pathHistory = [];
    } else {
      var last = newHist[newHist.length - 1];
      if (dist2(last.x, last.y, cutPt.x, cutPt.y) >= ORTHO_MIN_SEG) {
        newHist.push(cutPt);
      } else {
        newHist[newHist.length - 1] = cutPt;
      }
      p.pathHistory = newHist;
    }
    syncPathAlias(p);
    if (p.snake) {
      p.snake.axis = 'h';
      p.snake.ghost = null;
    }
  }

  /**
   * Truncate visible fiber at blade X — discard the tip-side (right) excess.
   */
  function truncateFiberAtBladeX(p, bladeX, bladeY) {
    if (!p) return null;
    var cutPt;
    if (usesOrthoRoute(p)) {
      var full = orthoPolyline(p);
      var cut = intersectPolylineWithVertical(full, bladeX, bladeY);
      if (cut) {
        cutPt = { x: cut.x, y: cut.y };
        trimOrthoPathAtCut(p, full, cut);
      } else {
        var sleevePts = fiberSleevePathPoints(p);
        var proj = projectOntoFiberStrict(sleevePts, bladeX, bladeY);
        cutPt = { x: bladeX, y: proj.y };
        trimOrthoPathAtCut(p, full, {
          x: cutPt.x,
          y: cutPt.y,
          segIndex: Math.max(0, full.length - 2),
          t: 1,
        });
      }
    } else {
      var pts = fiberSleevePathPoints(p);
      var proj2 = projectOntoFiberStrict(pts, bladeX, bladeY);
      cutPt = { x: bladeX, y: proj2.y };
    }
    p.bx = Math.round(cutPt.x);
    p.by = Math.round(cutPt.y);
    return cutPt;
  }

  /**
   * Point-to-line hit test: perpendicular distance from blade drop to pigtail polyline.
   * Requires fully stripped bare glass (stripStage === 2).
   */
  function findPigtailBladeHit(bladeX, bladeY, hitRadiusPx) {
    var thr = typeof hitRadiusPx === 'number' ? hitRadiusPx : BLADE_HIT_RADIUS_PX;
    var best = null;
    var bestD = thr + 1;
    var i;
    for (i = 0; i < pigtails.length; i++) {
      var p = pigtails[i];
      if (!p || p.cleaved || p.isCleaved) continue;
      if ((Number(p.stripStage) || 0) !== 2) continue;
      if (p.tail && p.tail.attached) continue;
      var pts = fiberSleevePathPoints(p);
      if (!pts || pts.length < 2) continue;
      var proj = projectOntoFiberStrict(pts, bladeX, bladeY);
      if (!proj || proj.perpDist > thr) continue;
      if (proj.perpDist < bestD) {
        bestD = proj.perpDist;
        best = {
          id: p.id,
          x: proj.x,
          y: proj.y,
          rot: proj.rot,
          perpDist: proj.perpDist,
          along: proj.dist,
        };
      }
    }
    return best;
  }

  /**
   * Distance-based cleave at blade drop — ignores magnetic snap / groove docking.
   */
  function commitCleaveAtBlade(bladeX, bladeY, opts) {
    opts = opts || {};
    var radius = typeof opts.hitRadius === 'number' ? opts.hitRadius : BLADE_HIT_RADIUS_PX;
    var hit = findPigtailBladeHit(bladeX, bladeY, radius);
    if (!hit) return false;
    var p = findPigtail(hit.id);
    if (!p) return false;
    var pts = fiberSleevePathPoints(p);
    if (!pts || pts.length < 2) return false;
    if (hit.along < CLEAVE_MIN_CUT_PX) return false;
    if (polylineLength(pts) < hit.along + 6) return false;

    var anchor = captureCleaveStripAnchor(p, opts.cleaverId);
    var lenBefore = polylineLength(pts);

    truncateFiberAtBladeX(p, bladeX, bladeY);

    var lenAfter = polylineLength(fiberSleevePathPoints(p));
    var removed = Math.max(0, lenBefore - lenAfter);

    p.isCleaved = true;
    p.cleaved = true;
    lockCleavedStripGeometry(p, getBareGlassLengthAfterCutPx(), {
      preJacketTo: anchor.preJacketTo,
      removedFromTip: removed,
      jacketBoundaryX: anchor.jacketBoundaryX,
      rulerStopX: anchor.rulerStopX,
    });
    p.cleaveAngle = 90;
    p.cleaveFaceRot = 90;
    clearCleaverSnap(p, { skipGuide: true });
    clearCleaverGuideLine();
    updateFiberPath(p);
    rebuildLayer();
    pushHistory();
    updateInspector();
    refreshBudget();
    setStatus('SC Pigtail · fiber cleaved · perpendicular end face');
    if (global.FtthLab && typeof FtthLab.showToast === 'function') {
      FtthLab.showToast('تم القص 90°');
    }
    return true;
  }

  /**
   * Cleaver V-groove probe: bare stripped tip seated on groove under blade.
   */
  function findCleavTargetAtWorld(wx, wy, thresholdPx) {
    var thr = typeof thresholdPx === 'number' ? thresholdPx : CLEAVE_HIT_PX;
    thr = Math.min(thr, CLEAVE_HIT_PX);
    var best = null;
    var bestD = thr + 1;
    var i;
    for (i = 0; i < pigtails.length; i++) {
      var p = pigtails[i];
      if (!p || p.cleaved || p.isCleaved) continue;
      if ((Number(p.stripStage) || 0) < 2) continue;
      if (p.tail && p.tail.attached) continue;
      var pts = fiberSleevePathPoints(p);
      if (!pts || pts.length < 2) continue;
      var proj = projectOntoFiberStrict(pts, wx, wy);
      if (!proj || !proj.onSegment) continue;
      if (proj.dist > CLEAVE_TIP_ZONE_PX) continue;
      if (proj.perpDist > thr) continue;
      if (proj.perpDist < bestD) {
        bestD = proj.perpDist;
        best = {
          id: p.id,
          x: proj.x,
          y: proj.y,
          rot: proj.rot,
          perpDist: proj.perpDist,
          along: proj.dist,
          wastePx: getBareGlassLengthAfterCutPx(),
        };
      }
    }
    return best;
  }

  /**
   * Groove + blade alignment — fiber must lie on the horizontal channel under the blade.
   */
  function findCleavTargetInGroove(groove, blade, thresholdPx) {
    if (!groove || !blade) return null;
    var thr = typeof thresholdPx === 'number' ? thresholdPx : CLEAVE_HIT_PX;
    thr = Math.min(thr, CLEAVE_HIT_PX);
    var gx1 = Math.min(groove.x1, groove.x2);
    var gx2 = Math.max(groove.x1, groove.x2);
    var gy = (groove.y1 + groove.y2) * 0.5;
    if (Math.abs(blade.y - gy) > thr) return null;
    if (blade.x < gx1 - thr || blade.x > gx2 + thr) return null;
    var hit = findCleavTargetAtWorld(blade.x, blade.y, thr);
    if (!hit) return null;
    if (hit.x < gx1 - thr || hit.x > gx2 + thr) return null;
    if (Math.abs(hit.y - gy) > thr) return null;
    return hit;
  }

  /** Commit a precision cleave — slice at blade point, flat 90° end face. */
  function commitCleave(id, opts) {
    opts = opts || {};
    var p = findPigtail(id);
    if (!p || p.cleaved || p.isCleaved) return false;
    if ((Number(p.stripStage) || 0) < 2) return false;
    var pts = fiberSleevePathPoints(p);
    if (!pts || pts.length < 2) return false;
    var total = polylineLength(pts);
    var cutDist;
    if (typeof opts.cutX === 'number' && typeof opts.cutY === 'number') {
      var proj = projectOntoFiberStrict(pts, opts.cutX, opts.cutY);
      if (!proj || !proj.onSegment) return false;
      if (proj.perpDist > CLEAVE_HIT_PX) return false;
      if (proj.dist > CLEAVE_TIP_ZONE_PX) return false;
      cutDist = proj.dist;
    } else {
      cutDist = typeof opts.wastePx === 'number' ? opts.wastePx : getBareGlassLengthAfterCutPx();
    }
    if (cutDist < CLEAVE_MIN_CUT_PX) return false;
    if (total < cutDist + 6) return false;

    var anchor = captureCleaveStripAnchor(p, opts.cleaverId);
    var newTip = pointAtPathDistance(pts, cutDist);
    p.bx = newTip.x;
    p.by = newTip.y;
    p.isCleaved = true;
    p.cleaved = true;
    lockCleavedStripGeometry(p, getBareGlassLengthAfterCutPx(), {
      preJacketTo: anchor.preJacketTo,
      removedFromTip: cutDist,
      jacketBoundaryX: anchor.jacketBoundaryX,
      rulerStopX: anchor.rulerStopX,
    });
    p.cleaveAngle = typeof opts.cleaveAngle === 'number' ? opts.cleaveAngle : 90;
    p.cleaveFaceRot = typeof opts.cleaveFaceRot === 'number' ? opts.cleaveFaceRot : p.cleaveAngle;
    updateFiberPath(p);
    rebuildLayer();
    pushHistory();
    updateInspector();
    refreshBudget();
    setStatus('SC Pigtail · fiber cleaved · perpendicular end face');
    if (global.FtthLab && typeof FtthLab.showToast === 'function') {
      FtthLab.showToast('تم القص 90°');
    }
    return true;
  }

  function setStripPeel(id, peel) {
    var p = findPigtail(id);
    if (!p || p.isCleaved || p.cleaved) return;
    ensureFiberStrip(p);
    if ((Number(p.stripStage) || 0) >= 2 && (p.fiberStrip.peelLayer || '') !== 'jacket') return;
    var n = Number(peel);
    if (!isFinite(n)) n = 0;
    p.fiberStrip.peel = Math.max(0, Math.min(1, n));
    syncStripStageFromFiberStrip(p);
    updateStripVisuals(p);
  }

  /** Legacy hook — sets jacket frontier length from tip. */
  function setStripLengthPx(id, px) {
    var p = findPigtail(id);
    if (!p || p.isCleaved || p.cleaved) return;
    ensureFiberStrip(p);
    clampStripFrontiersToPath(p);
    var n = Number(px);
    if (!isFinite(n) || n < 0) n = 0;
    n = Math.min(n, maxStripLenPx(p));
    p.fiberStrip.jacketTo = Math.max(p.fiberStrip.jacketTo || 0, n);
    if (p.fiberStrip.bareTo > p.fiberStrip.jacketTo) {
      p.fiberStrip.bareTo = p.fiberStrip.jacketTo;
    }
    syncStripStageFromFiberStrip(p);
    updateStripVisuals(p);
  }

  function clearStripPeel(id) {
    var p = findPigtail(id);
    if (!p) return;
    ensureFiberStrip(p);
    p.fiberStrip.peel = 0;
    p.fiberStrip.peelLayer = null;
    syncStripStageFromFiberStrip(p);
    updateStripVisuals(p);
  }

  /** Stage is derived from fiberStrip frontiers — no fixed-length snap. */
  function commitStripStage(id) {
    var p = findPigtail(id);
    if (!p || p.isCleaved || p.cleaved) return false;
    ensureFiberStrip(p);
    syncStripStageFromFiberStrip(p);
    p.fiberStrip.peel = 0;
    p.fiberStrip.peelLayer = null;
    rebuildLayer();
    pushHistory();
    updateInspector();
    var stage = p.stripStage || 0;
    setStatus(
      stage >= 2
        ? 'SC Pigtail · buffer stripped · bare glass exposed'
        : stage >= 1
          ? 'SC Pigtail · jacket stripped · clamp buffer to peel coating'
          : 'SC Pigtail · jacket peel in progress'
    );
    return true;
  }

  function syncTailStripDom(p, tail) {
    if (!p || !tail) return;
    ensureFiberStrip(p);
    enforceFullStripBareFrontier(p);
    var fs = p.fiberStrip;
    var peel = fs.peel || 0;
    var peelLayer = fs.peelLayer;
    var j = fs.jacketTo || 0;
    var fullyStripped = isFullyStrippedPigtail(p);
    var bareComplete = fullyStripped || isBareStripComplete(fs);
    var jacketStripped = j > STRIP_TIP_EPS;
    var stage = p.stripStage || 0;

    tail.classList.toggle('is-strip-peeling', peel > 0.02);
    tail.style.setProperty('--strip-peel', peel.toFixed(3));
    tail.classList.toggle('is-strip-stage1', jacketStripped);
    tail.classList.toggle('is-strip-stage2', bareComplete);

    var jacketEl = tail.querySelector('.lab-pigtail__jacket');
    var bufferEl = tail.querySelector('.lab-pigtail__buffer');
    var cleaveEl = tail.querySelector('.lab-pigtail__cleave');
    if (jacketEl) {
      jacketEl.classList.toggle('is-strip-removed', jacketStripped);
      jacketEl.classList.toggle('is-strip-peeling', peel > 0.02 && peelLayer === 'jacket');
    }
    if (bufferEl) {
      bufferEl.classList.toggle('is-strip-exposed', !fullyStripped && jacketStripped && !bareComplete);
      bufferEl.classList.toggle('is-strip-jacketed', !jacketStripped);
      bufferEl.classList.toggle('is-strip-removed', bareComplete);
      bufferEl.classList.toggle('is-strip-peeling', peel > 0.02 && peelLayer === 'buffer');
    }
    if (cleaveEl) {
      cleaveEl.classList.toggle('is-strip-bare', bareComplete);
      cleaveEl.classList.toggle('is-strip-buffered', !fullyStripped && jacketStripped && !bareComplete);
      cleaveEl.classList.toggle('is-cleaved', !!(p.isCleaved || p.cleaved));
    }
  }

  function updateStripVisuals(p) {
    if (!layer || !p) return;
    ensureFiberStrip(p);
    replacePigtailFiberSvg(p);
    var tail = layer.querySelector('[data-pt-id="' + p.id + '"][data-pt-end="B"]');
    syncTailStripDom(p, tail);
  }

  function replacePigtailFiberSvg(p) {
    if (!layer || !p) return;
    var svg = layer.querySelector('.lab-pigtail-svg');
    if (!svg) return;
    function isFiberNode(n) {
      if (!n || n.nodeType !== 1) return false;
      return (
        n.getAttribute('data-pt-drag') === p.id ||
        n.getAttribute('data-pt-fiber') === p.id ||
        n.getAttribute('data-pt-fiber-stripped') === p.id ||
        n.getAttribute('data-pt-ghost') === p.id ||
        n.getAttribute('data-pt-laser') === p.id
      );
    }
    var child = svg.firstChild;
    var first = null;
    while (child) {
      if (isFiberNode(child)) {
        first = child;
        break;
      }
      child = child.nextSibling;
    }
    var insertBefore = null;
    if (first) {
      var cur = first;
      while (cur && isFiberNode(cur)) {
        var next = cur.nextSibling;
        svg.removeChild(cur);
        cur = next;
      }
      insertBefore = cur;
    }
    var temp = document.createElement('div');
    temp.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg">' + buildPigtailFiberSvg(p) + '</svg>';
    var wrap = temp.firstChild;
    if (!wrap) return;
    while (wrap.firstChild) {
      var node = wrap.firstChild;
      wrap.removeChild(node);
      if (insertBefore) svg.insertBefore(node, insertBefore);
      else svg.appendChild(node);
    }
    if (p.isSnappedToSplicer) {
      renderSplicerFiberOverlays(p.snappedSplicerId);
    }
  }

  function findBareTipProximity(clientX, clientY, thresholdPx) {
    var world = clientToWorld(clientX, clientY);
    var thr = typeof thresholdPx === 'number' ? thresholdPx : SLEEVE_MOUNT_PROX_PX;
    var best = null;
    var bestD = thr + 1;
    var i;
    for (i = 0; i < pigtails.length; i++) {
      var p = pigtails[i];
      if (!p || p.hasSleeve) continue;
      var d = dist2(world.x, world.y, p.bx, p.by);
      if (d <= thr && d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best ? { id: best.id, dist: bestD } : null;
  }

  /** Slide a 60mm protection sleeve onto a pigtail bare tip. Returns true if applied. */
  function mountSleeve(id, opts) {
    opts = opts || {};
    var p = findPigtail(id);
    if (!p) return false;
    if (p.hasSleeve && !opts.force) {
      setStatus('Sleeve already on this pigtail');
      selectPigtail(id);
      return false;
    }
    var pts = fiberSleevePathPoints(p);
    var total = polylineLength(pts);
    var size = getSleeveSizePx();
    p.hasSleeve = true;
    p.sleeveAlong = typeof opts.sleeveAlong === 'number'
      ? Math.max(0, Math.min(1, opts.sleeveAlong))
      : defaultSleeveAlong(total, size.w);
    if (opts.consumeFreeSleeveId && global.FtthLab &&
        typeof FtthLab.consumeFreeSleeve === 'function') {
      FtthLab.consumeFreeSleeve(opts.consumeFreeSleeveId);
    }
    selectPigtail(id);
    rebuildLayer();
    if (opts.slideIn !== false) triggerSleeveSlideIn(id);
    pushHistory();
    updateInspector();
    setStatus('Sleeve 60mm · slid onto bare fiber');
    return true;
  }

  function applySleeve(id, opts) {
    return mountSleeve(id, opts);
  }

  function ejectSleeve(id, wx, wy) {
    var p = findPigtail(id);
    if (!p || !p.hasSleeve) return null;
    var g = sleeveGeometry(p);
    var spawnX = typeof wx === 'number' ? wx : g.x;
    var spawnY = typeof wy === 'number' ? wy : g.y;
    p.hasSleeve = false;
    p.sleeveAlong = null;
    rebuildLayer();
    pushHistory();
    if (global.FtthLab && typeof FtthLab.placeFreeSleeve === 'function') {
      FtthLab.placeFreeSleeve(spawnX, spawnY, { fromEject: true });
    }
    setStatus('Sleeve ejected · free to move');
    return { x: spawnX, y: spawnY };
  }

  function hitTestPigtailBareEnd(clientX, clientY) {
    var list = document.elementsFromPoint
      ? document.elementsFromPoint(clientX, clientY)
      : [];
    var i;
    var el;
    var node;
    for (i = 0; i < list.length; i++) {
      el = list[i];
      if (!el || !el.closest) continue;
      node = el.closest('[data-pt-id][data-pt-end="B"], .lab-pigtail__tail');
      if (!node) continue;
      var id = node.getAttribute('data-pt-id');
      if (id && findPigtail(id)) return id;
    }
    /* Near-tip tolerance: also accept fiber hit near bare end */
    for (i = 0; i < list.length; i++) {
      el = list[i];
      if (!el || !el.closest) continue;
      node = el.closest('[data-pt-fiber], [data-pt-drag]');
      if (!node) continue;
      var fid =
        node.getAttribute('data-pt-fiber') ||
        node.getAttribute('data-pt-drag');
      var p = fid && findPigtail(fid);
      if (!p) continue;
      var world = clientToWorld(clientX, clientY);
      if (dist2(world.x, world.y, p.bx, p.by) <= 36) return fid;
    }
    return null;
  }

  function hitTestPigtailAtClient(clientX, clientY) {
    var bare = hitTestPigtailBareEnd(clientX, clientY);
    if (bare) return bare;
    var list = document.elementsFromPoint
      ? document.elementsFromPoint(clientX, clientY)
      : [];
    var i;
    var el;
    var node;
    for (i = 0; i < list.length; i++) {
      el = list[i];
      if (!el || !el.closest) continue;
      node = el.closest('[data-pt-fiber], [data-pt-drag], [data-pt-id], [data-pt-node], [data-pt-sleeve]');
      if (!node) continue;
      var id =
        node.getAttribute('data-pt-fiber') ||
        node.getAttribute('data-pt-drag') ||
        node.getAttribute('data-pt-id') ||
        node.getAttribute('data-pt-node') ||
        node.getAttribute('data-pt-sleeve');
      if (id && findPigtail(id)) return id;
    }
    return null;
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
    /* Pure horizontal spawn: SC on the left, bare tip straight right. */
    var tipX = pos.x + SPAWN_LEN_PX;
    var tipY = pos.y;
    var horizRot = endRotationDeg(pos.x, pos.y, tipX, tipY);
    var item = {
      id: 'pt-' + seq,
      ax: pos.x,
      ay: pos.y,
      bx: tipX,
      by: tipY,
      polish: 'PC',
      connector: {
        attached: null,
        mismatch: false,
        lockedRot: null,
        liveRot: horizRot,
      },
      tail: { attached: null },
      route: [],
      pathHistory: [],
      routeMode: 'snake',
      fixedLength: SPAWN_LEN_PX,
      hasSleeve: false,
      stripStage: 0,
      stripPeel: 0,
      stripLengthPx: 0,
      fiberStrip: { jacketTo: 0, bareTo: 0, peel: 0, peelLayer: null },
      drawLockRot: horizRot,
      isSnappedToCleaver: false,
      snappedCleaverId: null,
      cleaverSlotAnchorX: null,
      isSnappedToSplicer: false,
      snappedSplicerId: null,
      snappedSplicerSide: null,
      splicerGrooveY: null,
      splicerTipX: null,
      splicerPreviewSlot: null,
      splicerDragDetached: false,
      splicerGrooveAnchor: null,
      splicerBareGlassPx: null,
      splicerInnerEdgeX: null,
      splicerDockSnapshot: null,
      splicerWeldMachineId: null,
      cleavedStripLock: null,
      stripFrontierLock: null,
    };
    pigtails.push(item);
    selectPigtail(item.id);
    rebuildLayer();
    pushHistory();
    refreshBudget();
    setStatus('SC Pigtail placed · horizontal · drag connector or bare tip to route');
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

  function selectPigtail(id, opts) {
    selection = { kind: 'pigtail', id: id };
    claimSelection();
    updateInspector();
    if (!(opts && opts.skipRebuild)) rebuildLayer();
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
    if (typeof p.drawLockRot === 'number') return p.drawLockRot;
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

      node = el.closest && el.closest('.lab-ols-port[data-ols-port]');
      if (node) {
        var olsId = node.getAttribute('data-ols-port');
        var olsConn = (node.getAttribute('data-ols-connector') || 'SC').toUpperCase();
        if (olsConn !== 'SC') {
          if (global.FtthLab && FtthLab.showAlert) {
            FtthLab.showAlert('OLS-35 accepts SC connectors only (SC Pigtail / Patch Cord).', 'warn');
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
    if (hit.owner === 'ols') hit = enrichOlsHitDeepSeat(hit) || hit;
    var mismatch = !polishMatch(p.polish, hit.polish);
    if (hit.owner === 'vfl') mismatch = false;
    if (hit.owner === 'vfl' && global.FtthLab && typeof FtthLab.detachPcordsFromVfl === 'function') {
      FtthLab.detachPcordsFromVfl(hit.vflId, null, null);
    }
    var lockedRot = hit.owner === 'ols' ? 180 : resolveUprightPlugRotation(hit, p);
    if (hit.owner === 'ols' || hit.owner === 'opm' || hit.owner === 'vfl') lockedRot = 180;
    p.connector.attached = {
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
    p.connector.lockedRot = lockedRot;
    p.connector.liveRot = null;
    p.drawLockRot = null;
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
    if (global.FtthLab && typeof FtthLab.refreshOlsDocks === 'function') {
      FtthLab.refreshOlsDocks();
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
    if (global.FtthLab && typeof FtthLab.refreshOlsDocks === 'function') {
      FtthLab.refreshOlsDocks();
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
          p.connector.lockedRot = 180;
          att.lockedRot = 180;
          p.connector.liveRot = null;
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
          p.connector.lockedRot = 180;
          att.lockedRot = 180;
          p.connector.liveRot = null;
          seatConnectorAtPort(p, pwO.x, pwO.y);
        }
      } else if (att.owner === 'ols') {
        var pwS = null;
        if (global.FtthLab && typeof FtthLab.getOlsPortWorld === 'function') {
          pwS = FtthLab.getOlsPortWorld(att.olsId);
        }
        if (pwS) {
          att.wx = pwS.x;
          att.wy = pwS.y;
          p.connector.lockedRot = 180;
          att.lockedRot = 180;
          p.connector.liveRot = null;
          seatConnectorAtPort(p, pwS.x, pwS.y);
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
    var hist = (p.pathHistory && p.pathHistory.length) ? p.pathHistory : p.route;
    if (hist && hist.length) {
      var poly = [{ x: p0.x, y: p0.y }].concat(hist).concat([{ x: tipB.x, y: tipB.y }]);
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

  function getRouteMode(p) {
    return p && p.routeMode === 'gravity' ? 'gravity' : 'snake';
  }

  function ensurePathHistory(p) {
    if (!p) return [];
    if (!Array.isArray(p.pathHistory)) {
      p.pathHistory = Array.isArray(p.route) ? p.route.slice() : [];
    }
    p.route = p.pathHistory;
    return p.pathHistory;
  }

  function syncPathAlias(p) {
    if (!p) return;
    ensurePathHistory(p);
    p.route = p.pathHistory;
  }

  function setRouteMode(id, mode) {
    var p = findPigtail(id);
    if (!p) return;
    p.routeMode = mode === 'gravity' ? 'gravity' : 'snake';
    syncPathAlias(p);
    rebuildLayer();
    updateInspector();
    pushHistory();
    setStatus(
      p.routeMode === 'snake'
        ? 'Snake Route Mode · orthogonal L-ghost + filleted corners'
        : 'Gravity Physics Mode · catenary sag'
    );
  }

  function strainReliefStart(p) {
    var tipA = bootAnchor(p);
    var tA = bootOutDir(getConnRot(p));
    var stub = Math.max(STRAIN_RELIEF_PX * 0.55, BOOT_EXIT_STUB);
    return {
      x: tipA.x + tA.x * stub,
      y: tipA.y + tA.y * stub,
    };
  }

  function collapseOrthoPts(pts) {
    var out = [];
    var i;
    for (i = 0; i < pts.length; i++) {
      var pt = pts[i];
      if (!pt) continue;
      if (
        out.length &&
        Math.abs(out[out.length - 1].x - pt.x) < 0.5 &&
        Math.abs(out[out.length - 1].y - pt.y) < 0.5
      ) {
        continue;
      }
      out.push({ x: pt.x, y: pt.y });
    }
    return out;
  }

  function orthoPolyline(p) {
    var start = strainReliefStart(p);
    var tipB = { x: p.bx, y: p.by };
    var hist = ensurePathHistory(p);
    var ghost = p.snake && p.snake.ghost ? { x: p.snake.ghost.x, y: p.snake.ghost.y } : null;
    var dragA = !!(p.snake && p.snake.dragEnd === 'A');
    var pts = [{ x: start.x, y: start.y }];
    var i;
    /* Ghost bend sits between the free tip and committed history (never in pathHistory). */
    if (ghost && dragA) pts.push(ghost);
    for (i = 0; i < hist.length; i++) {
      pts.push({ x: hist[i].x, y: hist[i].y });
    }
    if (ghost && !dragA) pts.push(ghost);
    pts.push(tipB);
    return collapseOrthoPts(pts);
  }

  function inferAxis(from, to) {
    if (!from || !to) return null;
    var dx = to.x - from.x;
    var dy = to.y - from.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null;
    /* Prefer H-then-V ghost when axes are equal. */
    return Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
  }

  /**
   * Preview L-bend from locked vertex → cursor (not committed).
   * Primary axis picks the first leg so we never invert into a Z-stair.
   * axis 'h' → horizontal then vertical; 'v' → vertical then horizontal.
   */
  function ghostBendFrom(last, cursorX, cursorY, axis) {
    if (!last || !axis) return null;
    var dx = cursorX - last.x;
    var dy = cursorY - last.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null;
    if (axis === 'h') {
      if (Math.abs(dy) < 0.5) return null;
      return { x: cursorX, y: last.y };
    }
    if (Math.abs(dx) < 0.5) return null;
    return { x: last.x, y: cursorY };
  }

  function commitGhostCorner(corners, last, ghost, atFront) {
    if (!ghost || !last) return last;
    if (dist2(last.x, last.y, ghost.x, ghost.y) < ORTHO_MIN_SEG) return last;
    if (atFront) corners.unshift({ x: ghost.x, y: ghost.y });
    else corners.push({ x: ghost.x, y: ghost.y });
    return { x: ghost.x, y: ghost.y };
  }

  /** Dominant axis from last locked point → cursor (recomputed every move). */
  function primaryAxisFromDelta(dx, dy) {
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null;
    return Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
  }

  /**
   * Pop committed corners while the cursor retreats back along the route.
   * Returns the new hinge/last point after any unrolls.
   */
  function backtrackCorners(corners, anchor, cursorX, cursorY, atFront) {
    var guard = 0;
    while (corners.length && guard++ < 64) {
      var last = atFront ? corners[0] : corners[corners.length - 1];
      var prev = atFront
        ? (corners.length > 1 ? corners[1] : anchor)
        : (corners.length > 1 ? corners[corners.length - 2] : anchor);

      var inDx = last.x - prev.x;
      var inDy = last.y - prev.y;
      var inLen = Math.sqrt(inDx * inDx + inDy * inDy) || 1;
      var outDx = cursorX - last.x;
      var outDy = cursorY - last.y;
      /* Positive along = continuing past the corner in the arrival direction. */
      var along = (outDx * inDx + outDy * inDy) / inLen;
      var perp = (outDx * (-inDy) + outDy * inDx) / inLen;
      var dLast = Math.sqrt(outDx * outDx + outDy * outDy);

      var pastCorner = along < -ORTHO_BACKTRACK_PX && Math.abs(perp) <= Math.max(ORTHO_TURN_PX * 2, 24);
      var onCornerBacking =
        dLast <= ORTHO_TURN_PX && along < 0 && Math.abs(perp) <= ORTHO_TURN_PX * 2;

      if (!pastCorner && !onCornerBacking) break;

      if (atFront) corners.shift();
      else corners.pop();
    }
    if (atFront) {
      return corners.length ? corners[0] : anchor;
    }
    return corners.length ? corners[corners.length - 1] : anchor;
  }

  /**
   * Aim connector boot / ferrule along the active travel segment.
   * Bare-tip rotation is derived in tailStyle from the last path segment.
   */
  function alignEndsToTravel(p, dragEnd) {
    if (!p) return;
    if (dragEnd === 'A') {
      var hinge = (p.pathHistory && p.pathHistory.length)
        ? p.pathHistory[0]
        : { x: p.bx, y: p.by };
      /* Ferrule leads outward along travel (hinge → connector). */
      var lead = headingRotFromMotion(p.ax - hinge.x, p.ay - hinge.y);
      p.drawLockRot = lead;
      p.connector.liveRot = lead;
      return;
    }
    if (p.connector.attached) return;
    var first = (p.pathHistory && p.pathHistory.length)
      ? p.pathHistory[0]
      : { x: p.bx, y: p.by };
    var bootAim = endRotationDeg(p.ax, p.ay, first.x, first.y);
    p.drawLockRot = bootAim;
    p.connector.liveRot = bootAim;
  }

  /**
   * SVG path for orthogonal polyline with smooth quadratic fillets at corners.
   */
  function filletOrthoSvg(pts, radius) {
    pts = collapseOrthoPts(pts);
    if (pts.length < 2) return '';
    if (pts.length === 2) {
      return 'M ' + pts[0].x + ' ' + pts[0].y + ' L ' + pts[1].x + ' ' + pts[1].y;
    }
    var rMax = Math.max(8, Math.min(24, radius != null ? radius : ORTHO_FILLET_R));
    var d = 'M ' + pts[0].x + ' ' + pts[0].y;
    var i;
    for (i = 1; i < pts.length - 1; i++) {
      var prev = pts[i - 1];
      var mid = pts[i];
      var next = pts[i + 1];
      var v1x = mid.x - prev.x;
      var v1y = mid.y - prev.y;
      var v2x = next.x - mid.x;
      var v2y = next.y - mid.y;
      var len1 = Math.sqrt(v1x * v1x + v1y * v1y) || 1;
      var len2 = Math.sqrt(v2x * v2x + v2y * v2y) || 1;
      var r = Math.min(rMax, len1 * 0.5, len2 * 0.5);
      if (r < 2) {
        d += ' L ' + mid.x + ' ' + mid.y;
        continue;
      }
      var before = {
        x: mid.x - (v1x / len1) * r,
        y: mid.y - (v1y / len1) * r,
      };
      var after = {
        x: mid.x + (v2x / len2) * r,
        y: mid.y + (v2y / len2) * r,
      };
      d += ' L ' + before.x + ' ' + before.y;
      d += ' Q ' + mid.x + ' ' + mid.y + ' ' + after.x + ' ' + after.y;
    }
    var last = pts[pts.length - 1];
    d += ' L ' + last.x + ' ' + last.y;
    return d;
  }

  /**
   * Begin / continue orthogonal snake from either end.
   * Never clears pathHistory — continues recorded vertices.
   */
  function beginOrthoSnake(p, dragEnd) {
    ensurePathHistory(p);
    dragEnd = dragEnd === 'A' ? 'A' : 'B';
    var hist = p.pathHistory;
    var startA = strainReliefStart(p);
    var tipB = { x: p.bx, y: p.by };

    if (dragEnd === 'B') {
      if (typeof p.drawLockRot !== 'number') {
        p.drawLockRot = getConnRot(p);
      }
      p.connector.liveRot = p.drawLockRot;
      var lastB = hist.length ? hist[hist.length - 1] : startA;
      p.snake = {
        dragEnd: 'B',
        corners: hist.slice(),
        axis: null,
        ghost: null,
        pin: { x: p.ax, y: p.ay },
      };
      /* Seed axis from current tip so the first move stays on the spawn axis. */
      p.snake.axis = inferAxis(lastB, tipB);
    } else {
      var hingeA = hist.length ? hist[0] : tipB;
      p.snake = {
        dragEnd: 'A',
        corners: hist.slice(),
        axis: null,
        ghost: null,
        pinB: { x: p.bx, y: p.by },
      };
      p.snake.axis = inferAxis(hingeA, { x: p.ax, y: p.ay });
    }
  }

  /**
   * Adaptive primary-axis routing while dragging tip B.
   * Dominant H/V each frame — no sticky inverted Z-stair.
   * Backtracking pops corners when retreating along the route.
   */
  function updateOrthoSnake(p, cursorX, cursorY) {
    if (!p.snake) beginOrthoSnake(p, 'B');
    if (p.snake.dragEnd === 'A') {
      updateOrthoSnakeFromA(p, cursorX, cursorY);
      return;
    }

    p.ax = p.snake.pin.x;
    p.ay = p.snake.pin.y;

    var start = strainReliefStart(p);
    var corners = p.snake.corners;
    var last = backtrackCorners(corners, start, cursorX, cursorY, false);

    var dx = cursorX - last.x;
    var dy = cursorY - last.y;
    var axis = primaryAxisFromDelta(dx, dy);
    p.snake.axis = axis;

    if (!axis) {
      p.bx = last.x;
      p.by = last.y;
      p.snake.ghost = null;
      p.pathHistory = corners.slice();
      syncPathAlias(p);
      alignEndsToTravel(p, 'B');
      return;
    }

    if (axis === 'h') {
      /*
       * Predominantly horizontal: extend straight to mouseX (no vertical stair).
       * Tip rides the horizontal rail; secondary dy beyond threshold commits a corner.
       */
      if (Math.abs(dy) > ORTHO_TURN_PX) {
        var bendH = { x: cursorX, y: last.y };
        last = commitGhostCorner(corners, last, bendH, false);
        p.bx = last.x;
        p.by = cursorY;
        p.snake.axis = 'v';
        p.snake.ghost = null;
      } else {
        p.bx = cursorX;
        p.by = last.y;
        p.snake.ghost = null;
      }
    } else {
      /* Predominantly vertical: extend straight to mouseY. */
      if (Math.abs(dx) > ORTHO_TURN_PX) {
        var bendV = { x: last.x, y: cursorY };
        last = commitGhostCorner(corners, last, bendV, false);
        p.bx = cursorX;
        p.by = last.y;
        p.snake.axis = 'h';
        p.snake.ghost = null;
      } else {
        p.bx = last.x;
        p.by = cursorY;
        p.snake.ghost = null;
      }
    }

    p.pathHistory = corners.slice();
    syncPathAlias(p);
    alignEndsToTravel(p, 'B');
  }

  function updateOrthoSnakeFromA(p, cursorX, cursorY) {
    p.bx = p.snake.pinB.x;
    p.by = p.snake.pinB.y;

    var tipB = { x: p.bx, y: p.by };
    var corners = p.snake.corners;
    var hinge = backtrackCorners(corners, tipB, cursorX, cursorY, true);

    var dx = cursorX - hinge.x;
    var dy = cursorY - hinge.y;
    var axis = primaryAxisFromDelta(dx, dy);
    p.snake.axis = axis;

    if (!axis) {
      p.ax = hinge.x;
      p.ay = hinge.y;
      p.snake.ghost = null;
      p.pathHistory = corners.slice();
      syncPathAlias(p);
      alignEndsToTravel(p, 'A');
      return;
    }

    if (axis === 'h') {
      if (Math.abs(dy) > ORTHO_TURN_PX) {
        var bendH = { x: cursorX, y: hinge.y };
        hinge = commitGhostCorner(corners, hinge, bendH, true);
        p.ax = hinge.x;
        p.ay = cursorY;
        p.snake.axis = 'v';
        p.snake.ghost = null;
      } else {
        p.ax = cursorX;
        p.ay = hinge.y;
        p.snake.ghost = null;
      }
    } else if (Math.abs(dx) > ORTHO_TURN_PX) {
      var bendV = { x: hinge.x, y: cursorY };
      hinge = commitGhostCorner(corners, hinge, bendV, true);
      p.ax = cursorX;
      p.ay = hinge.y;
      p.snake.axis = 'h';
      p.snake.ghost = null;
    } else {
      p.ax = hinge.x;
      p.ay = cursorY;
      p.snake.ghost = null;
    }

    p.pathHistory = corners.slice();
    syncPathAlias(p);
    alignEndsToTravel(p, 'A');
  }

  function endOrthoSnake(p) {
    if (!p) return;
    if (p.snake && p.snake.corners) {
      var corners = p.snake.corners.slice();
      var ghost = p.snake.ghost;
      /* Lock remaining L-bend so release never leaves a diagonal elastic segment. */
      if (ghost) {
        if (p.snake.dragEnd === 'A') {
          var hinge = corners.length ? corners[0] : { x: p.bx, y: p.by };
          commitGhostCorner(corners, hinge, ghost, true);
        } else {
          var start = strainReliefStart(p);
          var last = corners.length ? corners[corners.length - 1] : start;
          commitGhostCorner(corners, last, ghost, false);
        }
      }
      p.pathHistory = corners;
    }
    syncPathAlias(p);
    p.snake = null;
    var startLen = strainReliefStart(p);
    var poly = [{ x: startLen.x, y: startLen.y }]
      .concat(p.pathHistory || [])
      .concat([{ x: p.bx, y: p.by }]);
    var len = 0;
    var i;
    for (i = 1; i < poly.length; i++) {
      len += dist2(poly[i - 1].x, poly[i - 1].y, poly[i].x, poly[i].y);
    }
    p.fixedLength = Math.max(40, len);
    clampStripFrontiersToPath(p);
  }

  function usesOrthoRoute(p) {
    /* Snake mode is always orthogonal (incl. horizontal spawn with empty hist). */
    return !!(p && getRouteMode(p) === 'snake');
  }

  function moveTipGravity(p, dragEnd, cursorX, cursorY) {
    if (dragEnd === 'A') {
      p.ax = cursorX;
      p.ay = cursorY;
      /* Instant heading — no lerp damping */
      p.connector.liveRot = endRotationDeg(p.ax, p.ay, p.bx, p.by);
      p.drawLockRot = null;
    } else {
      p.bx = cursorX;
      p.by = cursorY;
    }
  }

  /**
   * Fiber path: snake (ortho + fillets) or gravity catenary per routeMode.
   * pathHistory is always preserved regardless of render mode.
   * Active snake.ghost is included as an L-preview bend (not stored until commit).
   */
  function fiberPath(p) {
    var tipA = bootAnchor(p);
    var p0 = strainReliefStart(p);
    var tipB = { x: p.bx, y: p.by };
    ensurePathHistory(p);

    if (usesOrthoRoute(p)) {
      var pts = orthoPolyline(p);
      if (
        !pts.length ||
        Math.abs(pts[0].x - p0.x) > 0.5 ||
        Math.abs(pts[0].y - p0.y) > 0.5
      ) {
        pts = [{ x: p0.x, y: p0.y }].concat(pts);
        pts = collapseOrthoPts(pts);
      }
      var body = filletOrthoSvg(pts, ORTHO_FILLET_R);
      var rest = String(body || '')
        .replace(/^M\s*[-+]?[\d.]+(?:e[-+]?\d+)?\s+[-+]?[\d.]+(?:e[-+]?\d+)?/i, '')
        .trim();
      return (
        'M ' + tipA.x + ' ' + tipA.y +
        ' L ' + p0.x + ' ' + p0.y +
        (rest ? ' ' + rest : '')
      );
    }

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

  /** Dashed L-bend overlay for the uncommitted ghost segment only. */
  function ghostPreviewPath(p) {
    if (!p || !p.snake || !p.snake.ghost) return '';
    var ghost = { x: p.snake.ghost.x, y: p.snake.ghost.y };
    var pts;
    if (p.snake.dragEnd === 'A') {
      var startA = strainReliefStart(p);
      var hinge = p.pathHistory.length
        ? { x: p.pathHistory[0].x, y: p.pathHistory[0].y }
        : { x: p.bx, y: p.by };
      pts = [startA, ghost, hinge];
    } else {
      var startB = strainReliefStart(p);
      var last = p.pathHistory.length
        ? {
            x: p.pathHistory[p.pathHistory.length - 1].x,
            y: p.pathHistory[p.pathHistory.length - 1].y,
          }
        : startB;
      pts = [last, ghost, { x: p.bx, y: p.by }];
    }
    return filletOrthoSvg(collapseOrthoPts(pts), ORTHO_FILLET_R);
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
    var rot;
    if (p.isSnappedToCleaver) {
      rot = 0;
    } else if (usesOrthoRoute(p)) {
      var pts = orthoPolyline(p);
      if (pts.length >= 2) {
        var a = pts[pts.length - 2];
        var b = pts[pts.length - 1];
        /* Cleave leads along travel (prev → tip). */
        rot = headingRotFromMotion(b.x - a.x, b.y - a.y);
      } else {
        rot = headingRotFromMotion(p.bx - p.ax, p.by - p.ay);
      }
    } else {
      /* Buffer faces connector; cleave faces away */
      rot = endRotationDeg(p.bx, p.by, p.ax, p.ay) + 180;
    }
    return (
      'left:' + Math.round(p.bx - TAIL_W / 2) + 'px;' +
      'top:' + Math.round(p.by - TAIL_H / 2) + 'px;' +
      'transform-origin:50% 50%;' +
      'transform:rotate(' + rot.toFixed(2) + 'deg)'
    );
  }

  function ensureLayer() {
    var mount = document.getElementById('lab-2d-mount');
    if (!mount) return null;
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'lab-pigtail-layer';
      layer.setAttribute('data-lab-pigtail-layer', '1');
    }
    if (layer.parentNode !== mount) {
      mount.appendChild(layer);
    } else if (layer !== mount.lastElementChild) {
      /* Paint after cleaver/other bench tools so fiber stays on the ruler visually */
      mount.appendChild(layer);
    }
    return layer;
  }

  function rebuildLayer() {
    var host = ensureLayer();
    if (!host) return;
    pigtails.forEach(syncAttached);
    pigtails.forEach(syncPigtailFiberLength);

    var html =
      '<svg class="lab-pigtail-svg" aria-hidden="true">' +
      '<defs>' +
      '<filter id="lab-vfl-core-beam-pt" x="-30%" y="-30%" width="160%" height="160%">' +
      '<feGaussianBlur in="SourceGraphic" stdDeviation="0.55" result="blur"/>' +
      '<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '</defs>';
    pigtails.forEach(function (p) {
      html += buildPigtailFiberSvg(p);
    });
    html += '</svg>';

    pigtails.forEach(function (p) {
      var selected = selection.id === p.id ? ' is-selected' : '';
      ensureFiberStrip(p);
      var fs = p.fiberStrip;
      var j = fs.jacketTo || 0;
      var fullyStripped = isFullyStrippedPigtail(p);
      var bareComplete = fullyStripped || isBareStripComplete(fs);
      var jacketStripped = j > STRIP_TIP_EPS;
      var stripStage = p.stripStage || 0;
      var peel = fs.peel || 0;
      var peelLayer = fs.peelLayer;
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
        (p.isSnappedToCleaver ? ' is-cleaver-docked' : '') +
        (p.isSnappedToSplicer ? ' is-splicer-docked' : '') +
        (p.isCleaved || p.cleaved ? ' is-cleaved' : '') +
        (jacketStripped ? ' is-strip-stage1' : '') +
        (bareComplete ? ' is-strip-stage2' : '') +
        (peel > 0.02 ? ' is-strip-peeling' : '') +
        '" data-pt-id="' + p.id + '" data-pt-end="B" style="' + tailStyle(p) +
        ';--strip-peel:' + peel.toFixed(3) + ';" ' +
        'title="Bare fiber · ' + stripStageLabel(stripStage) + '" aria-label="Bare fiber tail">' +
        '<span class="lab-pigtail__jacket' +
        (jacketStripped ? ' is-strip-removed' : '') +
        (peel > 0.02 && peelLayer === 'jacket' ? ' is-strip-peeling' : '') +
        '" aria-hidden="true"></span>' +
        '<span class="lab-pigtail__buffer' +
        (fullyStripped ? ' is-strip-removed' : (jacketStripped && !bareComplete ? ' is-strip-exposed' : ' is-strip-jacketed')) +
        (bareComplete ? ' is-strip-removed' : '') +
        (peel > 0.02 && peelLayer === 'buffer' ? ' is-strip-peeling' : '') +
        '" aria-hidden="true"></span>' +
        '<span class="lab-pigtail__cleave' +
        (bareComplete ? ' is-strip-bare' : '') +
        (jacketStripped && !bareComplete ? ' is-strip-buffered' : '') +
        (p.cleaved || p.isCleaved ? ' is-cleaved' : '') +
        '" aria-hidden="true"></span>' +
        '<span class="lab-vfl-exit-flare lab-vfl-exit-flare--tail" aria-hidden="true">' +
        '<i class="lab-vfl-exit-flare__aura"></i>' +
        '<i class="lab-vfl-exit-flare__hot"></i>' +
        '</span>' +
        '</button>' +
        (p.hasSleeve
          ? '<div class="lab-pigtail-sleeve lab-sleeve-tube" data-pt-sleeve="' + p.id + '" style="' +
            sleeveStyle(p) + '" title="Sleeve 60mm · drag along fiber" aria-label="Splice protection sleeve"></div>'
          : '') +
        '</div>';
    });

    host.innerHTML = html;
    bindLayerEvents(host);
    pigtails.forEach(function (p) {
      if (!p.isSnappedToCleaver || !p.snappedCleaverId) return;
      var dockInfo = getCleaverSlotGeometry(p.snappedCleaverId);
      var dockGuide = cleaverSlotGuideFromInfo(dockInfo);
      if (dockGuide) setCleaverGuideLine(dockGuide, true);
      if (dockInfo) setCleaverRulerWallGuide(dockInfo, true);
    });
    reapplyStoredVflGlow();
    renderSplicerFiberOverlays();
  }

  function updateFiberPath(p) {
    if (!layer) return;
    if (isFullyStrippedPigtail(p) || p.stripFrontierLock) {
      restorePermanentStripFrontier(p);
    }
    syncPigtailFiberLength(p);
    replacePigtailFiberSvg(p);
    var aBtn = layer.querySelector('[data-pt-id="' + p.id + '"][data-pt-end="A"]');
    var bBtn = layer.querySelector('[data-pt-id="' + p.id + '"][data-pt-end="B"]');
    if (aBtn) aBtn.setAttribute('style', connectorStyle(p));
    if (bBtn) {
      var stripStage = p.stripStage || 0;
      bBtn.setAttribute(
        'style',
        tailStyle(p) + ';--strip-peel:' + (p.stripPeel || 0).toFixed(3) + ';'
      );
      bBtn.classList.toggle('is-strip-stage1', stripStage >= 1);
      bBtn.classList.toggle('is-strip-stage2', stripStage >= 2);
      bBtn.classList.toggle('is-cleaver-docked', !!p.isSnappedToCleaver);
      bBtn.classList.toggle('is-splicer-docked', !!p.isSnappedToSplicer);
    }
    var sleeve = layer.querySelector('.lab-pigtail-sleeve[data-pt-sleeve="' + p.id + '"]');
    if (p.hasSleeve) {
      if (sleeve) {
        sleeve.setAttribute('style', sleeveStyle(p));
      } else {
        var hostNode = layer.querySelector('[data-pt-node="' + p.id + '"]');
        if (hostNode) {
          var wrapEl = document.createElement('div');
          wrapEl.className = 'lab-pigtail-sleeve lab-sleeve-tube';
          wrapEl.setAttribute('data-pt-sleeve', p.id);
          wrapEl.setAttribute('style', sleeveStyle(p));
          wrapEl.setAttribute('title', 'Sleeve 60mm');
          hostNode.appendChild(wrapEl);
        }
      }
    } else if (sleeve && sleeve.parentNode) {
      sleeve.parentNode.removeChild(sleeve);
    }
  }

  function clearPlugHighlights() {
    document.querySelectorAll(
      '.lab-fx-port.is-plug-target, .lab-cas-port.is-plug-target, .lab-cpl-port.is-plug-target, ' +
      '.lab-vfl-port.is-plug-target, .lab-opm-port.is-plug-target, .lab-ols-port.is-plug-target, .lab-splice-point.is-plug-target, .lab-term-point.is-plug-target, ' +
      '[data-lab-splice].is-plug-target, [data-lab-term].is-plug-target'
    ).forEach(function (n) { n.classList.remove('is-plug-target'); });
  }

  function highlightPort(el) {
    clearPlugHighlights();
    if (el) el.classList.add('is-plug-target');
  }

  function bindPigtailBodyDragGrip(grip) {
    if (!grip || grip.dataset.ptDragBound === '1') return;
    grip.dataset.ptDragBound = '1';
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

      if (p.isSnappedToCleaver) {
        clearCleaverSnap(p, { skipGuide: true });
      } else if (p.isSnappedToSplicer) {
        forceUnsnapPigtailFromSplicer(p);
      } else if (isFullyStrippedPigtail(p) || p.stripFrontierLock) {
        restorePermanentStripFrontier(p);
      }

      document.body.classList.add('lab-pigtail-dragging');
      setPigtailDragPassthrough(p, true);

      var w0 = clientToWorld(e.clientX, e.clientY);
      var oax = p.ax;
      var oay = p.ay;
      var obx = p.bx;
      var oby = p.by;
      var moved = false;
      ensurePathHistory(p);
      var hist0 = p.pathHistory.map(function (pt) {
        return { x: pt.x, y: pt.y };
      });

      function onMove(ev) {
        moved = true;
        applySplicerMagnetDuringDrag(p, ev.clientX, ev.clientY);
        var w = clientToWorld(ev.clientX, ev.clientY);
        var dx = w.x - w0.x;
        var dy = w.y - w0.y;
        p.ax = oax + dx;
        p.ay = oay + dy;
        p.bx = obx + dx;
        p.by = oby + dy;
        if (hist0.length) {
          p.pathHistory = hist0.map(function (pt) {
            return { x: pt.x + dx, y: pt.y + dy };
          });
          syncPathAlias(p);
        }

        if (isFullyStrippedPigtail(p) || p.stripFrontierLock) {
          restorePermanentStripFrontier(p);
        }
        updateFiberPath(p);
        if (p.isSnappedToSplicer) {
          renderSplicerFiberOverlays(p.snappedSplicerId);
        }
      }

      function onUp(ev) {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        document.body.classList.remove('lab-pigtail-dragging');
        setPigtailDragPassthrough(p, false);

        var seated = finishSplicerMagnetOnDrop(p, ev.clientX, ev.clientY);
        if (!seated) p.splicerPreviewSlot = null;
        p.splicerDragDetached = false;
        clearSplicerMagnetHighlight();
        clearSplicerDropzoneHighlight();

        rebuildLayer();
        updateInspector();
        if (moved || seated) pushHistory();
      }

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  }

  function bindLayerEvents(host) {
    host.querySelectorAll('[data-pt-node]').forEach(function (node) {
      node.addEventListener('click', function (e) {
        if (e.target.closest('[data-pt-end]') || e.target.closest('[data-pt-drag]')) return;
        if (e.target.closest('[data-pt-sleeve]')) return;
        e.stopPropagation();
        selectPigtail(node.getAttribute('data-pt-node'));
      });
    });

    host.querySelectorAll('[data-pt-sleeve]').forEach(function (btn) {
      btn.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        var id = btn.getAttribute('data-pt-sleeve');
        var p = findPigtail(id);
        if (!p || !p.hasSleeve) return;
        selectPigtail(id, { skipRebuild: true });
        btn.classList.add('is-dragging');
        document.body.classList.add('lab-sleeve-dragging');
        try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }

        var moved = false;
        var ejected = false;

        function finishDrag(ev) {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
          try { btn.releasePointerCapture(ev.pointerId); } catch (err2) { /* ignore */ }
          btn.classList.remove('is-dragging');
          document.body.classList.remove('lab-sleeve-dragging');
        }

        function onMove(ev) {
          moved = true;
          var world = clientToWorld(ev.clientX, ev.clientY);
          var result = dragSleeveAlongPath(p, world.x, world.y);
          if (result.eject) {
            ejected = true;
            finishDrag(ev);
            ejectSleeve(id, world.x, world.y);
            return;
          }
          updateSleeveElement(p, btn);
        }

        function onUp(ev) {
          if (ejected) return;
          var world = clientToWorld(ev.clientX, ev.clientY);
          var result = dragSleeveAlongPath(p, world.x, world.y);
          finishDrag(ev);
          if (result.eject) {
            ejectSleeve(id, world.x, world.y);
            return;
          }
          rebuildLayer();
          updateInspector();
          if (moved) pushHistory();
        }

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
      });
    });

    host.querySelectorAll('[data-pt-drag]').forEach(bindPigtailBodyDragGrip);

    /* Connector drag / plug — snake from A or gravity 1:1 world tracking */
    host.querySelectorAll('[data-pt-end="A"]').forEach(function (btn) {
      btn.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        var id = btn.getAttribute('data-pt-id');
        var p = findPigtail(id);
        if (!p) return;
        selectPigtail(id);

        var home = p.connector.attached
          ? { x: p.connector.attached.wx, y: p.connector.attached.wy }
          : null;
        var unplugged = false;
        var moved = false;
        var snakeMode = getRouteMode(p) === 'snake';

        if (snakeMode) {
          beginOrthoSnake(p, 'A');
        } else {
          p.snake = { dragEnd: 'A' };
        }

        btn.classList.add('is-dragging');
        document.body.classList.add('lab-pigtail-dragging');
        try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }

        function onMove(ev) {
          moved = true;
          var world = clientToWorld(ev.clientX, ev.clientY);
          if (p.connector.attached && !unplugged) {
            var pull = dist2(world.x, world.y, home.x, home.y);
            if (pull < UNPLUG_PULL_PX) {
              seatConnectorAtPort(p, home.x, home.y);
              updateFiberPath(p);
              return;
            }
            detachConnector(p);
            unplugged = true;
            btn.classList.remove('is-attached');
            if (snakeMode) beginOrthoSnake(p, 'A');
            setStatus(
              snakeMode
                ? 'Connector · snake route · release on a port to plug'
                : 'Connector free · release on a port to plug'
            );
          }

          if (snakeMode) {
            updateOrthoSnake(p, world.x, world.y);
          } else {
            moveTipGravity(p, 'A', world.x, world.y);
          }

          var hit = resolvePlugHit(ev.clientX, ev.clientY);
          highlightPort(hit && hit.el);
          if (hit && hit.owner === 'ols') {
            var mag = applyOlsMagneticPull(p, hit, ev.clientX, ev.clientY);
            if (mag === 'lock' && !p.connector.attached) {
              endOrthoSnake(p);
              attachConnector(p, hit);
              window.removeEventListener('pointermove', onMove);
              window.removeEventListener('pointerup', onUp);
              window.removeEventListener('pointercancel', onUp);
              try { btn.releasePointerCapture(ev.pointerId); } catch (errM) { /* ignore */ }
              btn.classList.remove('is-dragging');
              document.body.classList.remove('lab-pigtail-dragging');
              clearPlugHighlights();
              p.connector.liveRot = null;
              rebuildLayer();
              updateInspector();
              pushHistory();
              refreshBudget();
              setStatus('OLS-35 · magnetic dock · SC seated vertical');
              return;
            }
          } else if (!snakeMode && hit && (hit.owner === 'vfl' || hit.owner === 'opm') &&
              dist2(p.ax, p.ay, hit.wx, hit.wy) < PLUG_SNAP_PX * 3) {
            p.connector.liveRot = 180;
          }
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
          if (snakeMode) endOrthoSnake(p);
          else p.snake = null;
          if (!p.connector.attached) p.connector.liveRot = null;

          if (!p.connector.attached) {
            var hit = resolvePlugHit(ev.clientX, ev.clientY);
            var snapR = (hit && hit.owner === 'ols')
              ? olsMagnetRadius()
              : PLUG_SNAP_PX * 3;
            var d = hit
              ? (hit.screenDist != null
                ? hit.screenDist
                : dist2(p.ax, p.ay, hit.wx, hit.wy))
              : 9999;
            if (hit && d < snapR) {
              attachConnector(p, hit);
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

    /* Bare tip drag — snake from B or gravity 1:1; connector stays pinned in snake */
    host.querySelectorAll('[data-pt-end="B"]').forEach(function (btn) {
      btn.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        var id = btn.getAttribute('data-pt-id');
        var p = findPigtail(id);
        if (!p) return;
        selectPigtail(id);

        var undocked = false;
        var moved = false;
        var snakeMode = getRouteMode(p) === 'snake';

        if (p.isSnappedToCleaver) {
          clearCleaverSnap(p, { skipGuide: true });
        } else if (p.isSnappedToSplicer) {
          forceUnsnapPigtailFromSplicer(p);
        } else if (isFullyStrippedPigtail(p) || p.stripFrontierLock) {
          restorePermanentStripFrontier(p);
        }

        if (snakeMode) beginOrthoSnake(p, 'B');
        else p.snake = { dragEnd: 'B' };

        var home = p.tail.attached
          ? { x: p.tail.attached.wx, y: p.tail.attached.wy }
          : null;

        btn.classList.add('is-dragging');
        document.body.classList.add('lab-pigtail-dragging');
        setPigtailDragPassthrough(p, true);

        function onMove(ev) {
          moved = true;
          var world = clientToWorld(ev.clientX, ev.clientY);
          if (p.tail.attached && !undocked) {
            var pull = dist2(world.x, world.y, home.x, home.y);
            if (pull < TAIL_SNAP_PX) {
              p.bx = home.x;
              p.by = home.y;
              updateFiberPath(p);
              return;
            }
            detachTail(p);
            undocked = true;
            btn.classList.remove('is-attached');
            if (snakeMode) beginOrthoSnake(p, 'B');
            setStatus(
              snakeMode
                ? 'Bare tip · snake route · release on splice / termination'
                : 'Bare tip free · release on splice / termination'
            );
          }

          applySplicerMagnetDuringDrag(p, ev.clientX, ev.clientY);

          if (snakeMode) {
            updateOrthoSnake(p, world.x, world.y);
          } else {
            moveTipGravity(p, 'B', world.x, world.y);
          }

          if (isFullyStrippedPigtail(p) || p.stripFrontierLock) {
            restorePermanentStripFrontier(p);
            if (p.isSnappedToCleaver && (p.isCleaved || p.cleaved)) {
              enforceCleavedJacketWall(p);
            }
          }

          if (cleaverEligibleForDropzone(p) &&
              global.FtthLab && typeof FtthLab.findCleaverGrooveNear === 'function') {
            var grooveHit = FtthLab.findCleaverGrooveNear(p.bx, p.by, CLEAVER_SNAP_PX);
            if (grooveHit && grooveHit.dist <= CLEAVER_SNAP_PX) {
              setCleaverDropzoneHighlight(grooveHit.cleaverId);
            } else {
              clearCleaverDropzoneHighlight();
            }
          } else {
            clearCleaverDropzoneHighlight();
          }

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
          setPigtailDragPassthrough(p, false);
          clearPlugHighlights();
          if (snakeMode) endOrthoSnake(p);
          else p.snake = null;

          var seated = false;
          var activeCleaver = document.querySelector('.lab-cleaver.cleaver-dropzone-active');
          if (activeCleaver) {
            var dropCleaverId = activeCleaver.getAttribute('data-cleaver-node');
            seated = finishCleaverDropSeat(p, dropCleaverId);
          }
          clearCleaverDropzoneHighlight();

          if (!seated) {
            seated = finishSplicerMagnetOnDrop(p, ev.clientX, ev.clientY);
          }
          if (!seated) p.splicerPreviewSlot = null;
          p.splicerDragDetached = false;
          clearSplicerMagnetHighlight();
          clearSplicerDropzoneHighlight();

          if (!seated) {
            clearCleaverGuideLine();
          }

          if (!p.tail.attached && !p.isSnappedToCleaver && !p.isSnappedToSplicer) {
            var hit = hitTestTailTarget(ev.clientX, ev.clientY);
            if (hit) {
              attachTail(p, hit);
            }
          }
          rebuildLayer();
          updateInspector();
          if (moved || undocked || seated) pushHistory();
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
              olsId: p.connector.attached.olsId || null,
              splitterId: p.connector.attached.splitterId || null,
              port: p.connector.attached.port || null,
              slot: p.connector.attached.slot != null ? p.connector.attached.slot : null,
              oltPort: p.connector.attached.oltPort != null ? p.connector.attached.oltPort : null,
              mismatch: !!p.connector.mismatch,
              polish: p.polish === 'APC' ? 'APC' : 'UPC',
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
      '<p class="lab-inspector__label">Cable route mode</p>' +
      '<div class="lab-route-mode-toggle" role="group" aria-label="Pigtail route mode">' +
      '<button type="button" class="lab-route-mode-btn' +
      (getRouteMode(p) === 'snake' ? ' is-active' : '') +
      '" data-pt-route-mode="' + p.id + ':snake">Snake Route Mode</button>' +
      '<button type="button" class="lab-route-mode-btn' +
      (getRouteMode(p) === 'gravity' ? ' is-active' : '') +
      '" data-pt-route-mode="' + p.id + ':gravity">Gravity Physics Mode</button>' +
      '</div>' +
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
        : (p.isSnappedToCleaver
          ? 'Tail · magnetically seated in cleaver V-groove'
          : 'Tail · free · dock on splice / termination')) +
      '</p>' +
      '<div class="lab-spl-sheet">' +
      '<div><span>Type</span><strong class="' +
      (isApc ? 'is-apc-text' : 'is-upc-text') + '">' + displayPolish(p.polish) +
      '</strong></div>' +
      '<div><span>Ends</span><strong>SC · Bare</strong></div>' +
      '<div><span>Strip</span><strong>' + stripStageLabel(p.stripStage || 0) + '</strong></div>' +
      '<div><span>Cleave</span><strong>' +
      (p.isCleaved || p.cleaved
        ? (p.cleaveAngle || 90) + '° face · ready to splice'
        : 'Not cleaved') + '</strong></div>' +
      '<div><span>IL</span><strong>' +
      (p.connector.attached ? loss.toFixed(2) + ' dB' : '—') +
      '</strong></div>' +
      '</div>' +
      '<button type="button" class="lab-eject-btn" data-remove-pt="' + p.id +
      '">Remove Pigtail</button>' +
      '</div>';

    detail.querySelectorAll('[data-pt-route-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var parts = btn.getAttribute('data-pt-route-mode').split(':');
        setRouteMode(parts[0], parts[1]);
      });
    });
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
      ensurePathHistory(p);
      if (p.pathHistory && p.pathHistory.length) {
        p.pathHistory.forEach(function (pt) {
          pt.x += dx;
          pt.y += dy;
        });
        syncPathAlias(p);
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
      FtthLab.applySleeveToPigtail = mountSleeve;
      FtthLab.mountSleeveOnPigtail = mountSleeve;
      FtthLab.ejectSleeveFromPigtail = ejectSleeve;
      FtthLab.findBareTipProximity = findBareTipProximity;
      FtthLab.hitTestPigtailAtClient = hitTestPigtailAtClient;
      FtthLab.hitTestPigtailBareEnd = hitTestPigtailBareEnd;
      FtthLab.findPigtailStripTarget = findStripTarget;
      FtthLab.findPigtailStripTargetAtWorld = findStripTargetAtWorld;
      FtthLab.setPigtailStripPeel = setStripPeel;
      FtthLab.setPigtailStripLengthPx = setStripLengthPx;
      FtthLab.clearPigtailStripPeel = clearStripPeel;
      FtthLab.commitPigtailStripStage = commitStripStage;
      FtthLab.projectPigtailStripNotch = projectPigtailStripNotch;
      FtthLab.applyPigtailStripDrag = applyStripDragFromNotch;
      FtthLab.commitPigtailStripPeelSession = commitStripPeelSession;
      FtthLab.setPigtailStripGuide = setStripGuideLine;
      FtthLab.clearPigtailStripGuide = clearStripGuideLine;
      FtthLab.findPigtailCleavTargetAtWorld = findCleavTargetAtWorld;
      FtthLab.findPigtailCleavTargetInGroove = findCleavTargetInGroove;
      FtthLab.getJacketBoundaryWorld = getJacketBoundaryWorld;
      FtthLab.refreshPigtailCleaverSlot = refreshPigtailCleaverSlot;
      FtthLab.findPigtailBladeHit = findPigtailBladeHit;
      FtthLab.commitPigtailCleave = commitCleave;
      FtthLab.commitPigtailCleaveAtBlade = commitCleaveAtBlade;
      FtthLab.getBareGlassLengthAfterCutPx = getBareGlassLengthAfterCutPx;
      FtthLab.bladeHitRadiusPx = function () { return BLADE_HIT_RADIUS_PX; };
      FtthLab.findPigtailBareTipNearWorld = findBareTipNearWorld;
      FtthLab.snapPigtailToCleaverGroove = function (id, cleaverId, snapX, grooveY, opts) {
        var pig = findPigtail(id);
        if (!pig) return false;
        var ok = snapPigtailToCleaverGroove(pig, cleaverId, snapX, grooveY, opts);
        if (ok) updateFiberPath(pig);
        return ok;
      };
      FtthLab.dockPigtailToCleaver = FtthLab.snapPigtailToCleaverGroove;
      FtthLab.clearPigtailCleaverSnap = function (id) {
        var pig = findPigtail(id);
        if (pig) clearCleaverSnap(pig);
      };
      FtthLab.clearPigtailCleaverDock = FtthLab.clearPigtailCleaverSnap;
      FtthLab.undockPigtailsFromCleaver = undockPigtailsFromCleaver;
      FtthLab.setCleaverGuideLine = setCleaverGuideLine;
      FtthLab.clearCleaverGuideLine = clearCleaverGuideLine;
      FtthLab.finalizePigtailCleaverDock = finalizePigtailCleaverDock;
      FtthLab.handoverPigtailToSplicerClamp = handoverPigtailToSplicerClamp;
      FtthLab.refreshSplicerDocks = refreshSplicerDocks;
      FtthLab.syncSplicerMotorAlignFrame = syncSplicerMotorAlignFrame;
      FtthLab.ensureSplicerDockTracking = ensureSplicerDockTracking;
      FtthLab.renderSplicerFiberOverlays = renderSplicerFiberOverlays;
      FtthLab.clearPigtailSplicerSnap = function (id) {
        var pig = findPigtail(id);
        if (pig) clearSplicerSnap(pig);
      };
      FtthLab.findSplicerGrooveNear = function (clientX, clientY) {
        return hitTestSplicerGroove(clientX, clientY);
      };

      document.addEventListener('fusion-splicer:clampLid', function () {
        renderSplicerFiberOverlays();
        refreshSplicerDocks();
      });
      document.addEventListener('fusion-splicer:clampNudge', function () {
        ensureSplicerDockTracking();
        refreshSplicerDocks();
      });
      document.addEventListener('fusion-splicer:spliceStart', function () {
        ensureSplicerDockTracking();
      });
      document.addEventListener('fusion-splicer:spliceComplete', function (ev) {
        var machineId = ev.detail && ev.detail.machineId;
        if (machineId) applySplicerArcWeld(machineId);
        refreshSplicerDocks(machineId);
        rebuildLayer();
      });
      document.addEventListener('fusion-splicer:reset', function (ev) {
        var machineId = ev.detail && ev.detail.machineId;
        if (machineId) clearSplicerWeldForMachine(machineId);
      });

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
    applySleeve: applySleeve,
    mountSleeve: mountSleeve,
    ejectSleeve: ejectSleeve,
    findBareTipProximity: findBareTipProximity,
    findStripTarget: findStripTarget,
    setStripPeel: setStripPeel,
    setStripLengthPx: setStripLengthPx,
    clearStripPeel: clearStripPeel,
    commitStripStage: commitStripStage,
    hitTestPigtailAtClient: hitTestPigtailAtClient,
    hitTestPigtailBareEnd: hitTestPigtailBareEnd,
    translateForVfl: translateForVfl,
    onLabConfigChanged: function () {
      renderToolbox();
      updateInspector();
    },
    exportProjectState: captureSnapshot,
    importProjectState: applySnapshot,
    resetProjectState: function () {
      applySnapshot({ pigtails: [], seq: 0 });
    },
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
