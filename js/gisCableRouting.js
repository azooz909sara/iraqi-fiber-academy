/**
 * Dynamic GIS cable routing — click-to-angle vertices, live preview, path length.
 */
import { ctx } from './simContext.js';
import { findGisEquipment, findNearestGisEquipment, addGisPathConnection } from './gisStore.js';
import { renderGisPathConnection, removeGisPathLine } from './gisMapRenderer.js';
import { getOsmMap, getCableDrawLayer } from './osmMapEngine.js';
import { haversinePathMeters, formatFiberLength } from './fiberMetrics.js';

let previewLine = null;
let anchorMarkers = [];

export function isCableDrawActive() {
  return !!(ctx.gisCableDraw && ctx.gisCableDraw.active);
}

export function isCableArmed() {
  return !!ctx.gisCableArmed;
}

export function armGisCable(cableId) {
  ctx.gisCableArmed = cableId || ctx.selectedCableId || 'cable_ftth';
  ctx.selectedCableId = ctx.gisCableArmed;
  cancelCableDraw();
  if (ctx.api.disarmGisPlacement) ctx.api.disarmGisPlacement(false);
  if (ctx.api.setGisZoneMode) ctx.api.setGisZoneMode(false);
  highlightCableToolbox(ctx.gisCableArmed);
  if (ctx.api.toast) {
    ctx.api.toast('Cable armed — click source equipment to start routing', 'success');
  }
  if (ctx.api.updateGisStatusBar) ctx.api.updateGisStatusBar();
}

export function disarmGisCable() {
  ctx.gisCableArmed = null;
  cancelCableDraw();
  highlightCableToolbox(null);
  if (ctx.api.updateGisStatusBar) ctx.api.updateGisStatusBar();
}

function highlightCableToolbox(cableId) {
  document.querySelectorAll('#toolbox-items .toolbox-item--cable').forEach(function (el) {
    el.classList.toggle('toolbox-item--selected', cableId != null && el.dataset.type === cableId);
  });
}

function getSourceLatLng() {
  const d = ctx.gisCableDraw;
  if (!d || !d.fromId) return null;
  const eq = findGisEquipment(d.fromId);
  return eq ? { lat: eq.lat, lng: eq.lng } : null;
}

function buildPathLatLngs(cursor) {
  const d = ctx.gisCableDraw;
  const src = getSourceLatLng();
  if (!src || !d) return [];
  const path = [src];
  for (let i = 0; i < d.vertices.length; i++) path.push(d.vertices[i]);
  if (cursor) path.push(cursor);
  return path;
}

function updatePreview(cursor) {
  const layer = getCableDrawLayer();
  if (!layer || !isCableDrawActive()) return;

  const latlngs = buildPathLatLngs(cursor);
  if (latlngs.length < 2) return;

  const cable = ctx.gisCableDraw.cableId || 'cable_ftth';
  const color = cable === 'cable_lastmile' ? '#f59e0b' : '#3b82f6';

  if (previewLine) {
    previewLine.setLatLngs(latlngs.map(function (p) { return [p.lat, p.lng]; }));
  } else {
    previewLine = L.polyline(
      latlngs.map(function (p) { return [p.lat, p.lng]; }),
      { color, weight: 3, opacity: 0.75, dashArray: '8 5', className: 'gis-cable-preview' }
    ).addTo(layer);
  }
}

function clearPreview() {
  if (previewLine) { previewLine.remove(); previewLine = null; }
}

function addAnchorMarker(lat, lng) {
  const layer = getCableDrawLayer();
  if (!layer) return;
  const m = L.circleMarker([lat, lng], {
    radius: 5, color: '#00e5ff', fillColor: '#0891b2', fillOpacity: 1, weight: 2,
    className: 'gis-cable-anchor',
  }).addTo(layer);
  anchorMarkers.push(m);
}

export function startCableDrawFromEquipment(equipmentId) {
  if (!ctx.gisCableArmed && !ctx.gisConnectMode) return false;

  const eq = findGisEquipment(equipmentId);
  if (!eq) return false;

  ctx.gisCableDraw = {
    active: true,
    fromId: equipmentId,
    cableId: ctx.gisCableArmed || ctx.selectedCableId || 'cable_ftth',
    vertices: [],
  };
  ctx.gisConnectFrom = equipmentId;
  clearPreview();
  anchorMarkers.forEach(function (m) { m.remove(); });
  anchorMarkers = [];

  if (ctx.api.toast) {
    ctx.api.toast('Routing — click corners, right-click to finish', 'success');
  }
  if (ctx.api.updateGisStatusBar) ctx.api.updateGisStatusBar();
  return true;
}

export function handleCableMapClick(lat, lng) {
  if (!isCableDrawActive()) return false;

  ctx.gisCableDraw.vertices.push({ lat, lng });
  addAnchorMarker(lat, lng);
  updatePreview({ lat, lng });
  if (ctx.api.updateGisStatusBar) ctx.api.updateGisStatusBar();
  return true;
}

export function finalizeCableDraw(endLat, endLng) {
  const d = ctx.gisCableDraw;
  if (!d || !d.active) return false;

  const src = getSourceLatLng();
  if (!src) { cancelCableDraw(); return false; }

  let toId = null;
  const near = findNearestGisEquipment(endLat, endLng, 0.0004);
  if (near && near.id !== d.fromId) toId = near.id;

  const path = [src].concat(d.vertices);
  if (toId) {
    const target = findGisEquipment(toId);
    if (target) path.push({ lat: target.lat, lng: target.lng });
  } else if (d.vertices.length) {
    path.push({ lat: endLat, lng: endLng });
  }

  if (path.length < 2) {
    if (ctx.api.toast) ctx.api.toast('Cable path too short', 'warn');
    cancelCableDraw();
    return false;
  }

  const lengthMeters = Math.round(haversinePathMeters(path) * 10) / 10;
  const fibers = ctx.toolboxVals && ctx.toolboxVals[d.cableId] ? ctx.toolboxVals[d.cableId] : null;

  const conn = addGisPathConnection({
    from: d.fromId,
    to: toId || d.fromId,
    cable: d.cableId,
    fibers,
    path,
    lengthMeters,
  });

  renderGisPathConnection(conn);
  cancelCableDraw();
  disarmGisCable();

  if (ctx.api.onGisDesignChanged) ctx.api.onGisDesignChanged();
  if (ctx.api.toast) {
    ctx.api.toast('Cable locked — ' + formatFiberLength(lengthMeters), 'success');
  }
  return true;
}

export function cancelCableDraw() {
  ctx.gisCableDraw = { active: false, fromId: null, cableId: null, vertices: [] };
  ctx.gisConnectFrom = null;
  clearPreview();
  anchorMarkers.forEach(function (m) { m.remove(); });
  anchorMarkers = [];
}

export function handleCableMapMove(lat, lng) {
  if (!isCableDrawActive()) return;
  updatePreview({ lat, lng });
}

export function handleCableContextMenu(lat, lng) {
  if (!isCableDrawActive()) return false;
  finalizeCableDraw(lat, lng);
  return true;
}

export function handleCableDblClick(lat, lng) {
  if (!isCableDrawActive()) return false;
  finalizeCableDraw(lat, lng);
  return true;
}

export function handleGisCableEquipmentClick(id) {
  if (ctx.gisCableArmed && !isCableDrawActive()) {
    return startCableDrawFromEquipment(id);
  }
  if (isCableDrawActive() && ctx.gisCableDraw.fromId !== id) {
    const target = findGisEquipment(id);
    if (target) finalizeCableDraw(target.lat, target.lng);
    return true;
  }
  return false;
}

export function bindCableRouting() {
  const toolbox = document.getElementById('toolbox-items');
  if (toolbox && !toolbox._cableRouteBound) {
    toolbox._cableRouteBound = true;
    toolbox.addEventListener('click', function (e) {
      if (ctx.mapMode !== 'osm') return;
      const item = e.target.closest('.toolbox-item--cable');
      if (!item) return;
      e.preventDefault();
      e.stopPropagation();
      armGisCable(item.dataset.type);
    }, true);
  }

  const map = getOsmMap();
  if (!map) return;
  if (map._cableRouteBound) return;
  map._cableRouteBound = true;

  map.on('dblclick', function (e) {
    if (ctx.mapMode !== 'osm') return;
    if (handleCableDblClick(e.latlng.lat, e.latlng.lng)) {
      L.DomEvent.preventDefault(e);
      L.DomEvent.stopPropagation(e);
    }
  });
}

export function bindCableToolbox() {
  bindCableRouting();
}
