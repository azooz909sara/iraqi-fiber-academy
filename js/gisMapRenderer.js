/**
 * Render GIS markers and fiber polylines on Leaflet map — incremental updates.
 */
import { ctx } from './simContext.js';
import { getGisLayerId } from './gisEquipmentTypes.js';
import { GIS_CABLE_TYPES } from './gisEquipmentTypes.js';
import { createGisDivIcon, createGisSelectedIcon, setGisIconZoom, updateMarkerIconDom } from './gisIcons.js';
import { findGisEquipment } from './gisStore.js';
import { getOsmMap, getFtthLayerRegistry } from './osmMapEngine.js';

const markerMap = {};
const polylineMap = {};

function getCableColor(cableId) {
  const def = GIS_CABLE_TYPES[cableId];
  return def ? def.color : '#00e5ff';
}

function currentMapZoom() {
  const map = getOsmMap();
  return map ? map.getZoom() : 12;
}

export function renderGisMarker(equipment) {
  const map = getOsmMap();
  if (!map || !equipment) return null;

  const layerId = getGisLayerId(equipment.type);
  const reg = getFtthLayerRegistry();
  const group = reg[layerId] && reg[layerId].group;
  if (!group) return null;

  const isSelected = ctx.selectedGisId === equipment.id;
  const zoom = currentMapZoom();
  const existing = markerMap[equipment.id];

  if (existing) {
    updateMarkerIconDom(existing, equipment, isSelected, zoom);
    existing.setLatLng([equipment.lat, equipment.lng]);
    return existing;
  }

  const icon = isSelected ? createGisSelectedIcon(equipment, zoom) : createGisDivIcon(equipment, zoom);
  const marker = L.marker([equipment.lat, equipment.lng], {
    icon,
    draggable: !equipment.locked,
    title: equipment.id + ' — ' + equipment.type,
  });

  marker._gisId = equipment.id;
  marker.on('click', function (e) {
    L.DomEvent.stopPropagation(e);
    if (ctx.api.onGisMarkerClick) ctx.api.onGisMarkerClick(equipment.id);
  });

  marker.on('dragend', function () {
    const ll = marker.getLatLng();
    equipment.lat = ll.lat;
    equipment.lng = ll.lng;
    updateGisConnectionsForEquipment(equipment.id);
    if (ctx.api.onGisEquipmentMoved) ctx.api.onGisEquipmentMoved(equipment.id);
  });

  marker.addTo(group);
  markerMap[equipment.id] = marker;
  return marker;
}

export function removeGisMarker(id) {
  const marker = markerMap[id];
  if (marker) {
    marker.remove();
    delete markerMap[id];
  }
}

export function renderAllGisMarkers() {
  for (let i = 0; i < ctx.gisEquipment.length; i++) {
    renderGisMarker(ctx.gisEquipment[i]);
  }
}

export function refreshGisMarkerSelection() {
  const prevId = ctx._prevSelectedGisId;
  const newId = ctx.selectedGisId;
  const zoom = currentMapZoom();

  if (prevId && prevId !== newId) {
    const prevEq = findGisEquipment(prevId);
    const prevMarker = markerMap[prevId];
    if (prevEq && prevMarker) updateMarkerIconDom(prevMarker, prevEq, false, zoom);
  }
  if (newId) {
    const newEq = findGisEquipment(newId);
    const newMarker = markerMap[newId];
    if (newEq && newMarker) updateMarkerIconDom(newMarker, newEq, true, zoom);
  }
  ctx._prevSelectedGisId = newId;
}

export function refreshAllGisMarkerIcons() {
  const zoom = currentMapZoom();
  setGisIconZoom(zoom);
  for (let i = 0; i < ctx.gisEquipment.length; i++) {
    const eq = ctx.gisEquipment[i];
    const marker = markerMap[eq.id];
    if (marker) {
      updateMarkerIconDom(marker, eq, ctx.selectedGisId === eq.id, zoom);
    }
  }
}

export function renderGisPathConnection(conn) {
  if (!conn) return null;
  const reg = getFtthLayerRegistry();
  const cableGroup = reg.fiberCables && reg.fiberCables.group;
  if (!cableGroup) return null;

  const latlngs = conn.path
    ? conn.path.map(function (p) { return [p.lat, p.lng]; })
    : null;
  if (!latlngs || latlngs.length < 2) return renderGisConnections();

  const color = getCableColor(conn.cable);
  const existing = polylineMap[conn.id];
  if (existing) {
    existing.setLatLngs(latlngs);
    existing.setStyle({ color, weight: 4, opacity: 0.9, dashArray: null });
    return existing;
  }
  const line = L.polyline(latlngs, {
    color, weight: 4, opacity: 0.9, className: 'gis-cable-path',
  });
  line._gisConnId = conn.id;
  line.addTo(cableGroup);
  polylineMap[conn.id] = line;
  return line;
}

export function removeGisPathLine(id) {
  removeGisPolyline(id);
}

function removeGisPolyline(id) {
  const line = polylineMap[id];
  if (line) {
    line.remove();
    delete polylineMap[id];
  }
}

export function renderGisConnections() {
  const map = getOsmMap();
  if (!map) return;

  const reg = getFtthLayerRegistry();
  const cableGroup = reg.fiberCables && reg.fiberCables.group;
  if (!cableGroup) return;

  const activeIds = {};
  for (let i = 0; i < ctx.gisConnections.length; i++) {
    const c = ctx.gisConnections[i];
    activeIds[c.id] = true;

    let latlngs;
    if (c.path && c.path.length >= 2) {
      latlngs = c.path.map(function (p) { return [p.lat, p.lng]; });
    } else {
      const a = findGisEquipment(c.from);
      const b = findGisEquipment(c.to);
      if (!a || !b) continue;
      latlngs = [[a.lat, a.lng], [b.lat, b.lng]];
    }

    const color = getCableColor(c.cable);
    const existing = polylineMap[c.id];
    const weight = c.path ? 4 : 3;

    if (existing) {
      existing.setLatLngs(latlngs);
      existing.setStyle({ color, weight, opacity: 0.9, dashArray: c.path ? null : (c.cable === 'standard' ? '6 4' : null) });
    } else {
      const line = L.polyline(latlngs, {
        color, weight, opacity: 0.9,
        dashArray: c.path ? null : (c.cable === 'standard' ? '6 4' : null),
        className: c.path ? 'gis-cable-path' : '',
      });
      line._gisConnId = c.id;
      line.addTo(cableGroup);
      polylineMap[c.id] = line;
    }
  }

  Object.keys(polylineMap).forEach(function (id) {
    if (!activeIds[id]) removeGisPolyline(id);
  });
}

export function updateGisConnectionsForEquipment(equipmentId) {
  for (let i = 0; i < ctx.gisConnections.length; i++) {
    const c = ctx.gisConnections[i];
    if (c.from !== equipmentId && c.to !== equipmentId) continue;
    const a = findGisEquipment(c.from);
    const b = findGisEquipment(c.to);
    const line = polylineMap[c.id];
    if (a && b && line) {
      line.setLatLngs([[a.lat, a.lng], [b.lat, b.lng]]);
    }
  }
  if (ctx.api.persistChange) ctx.api.persistChange();
}

export function removeGisConnectionsForEquipment(equipmentId) {
  const toRemove = [];
  for (let i = 0; i < ctx.gisConnections.length; i++) {
    const c = ctx.gisConnections[i];
    if (c.from === equipmentId || c.to === equipmentId) toRemove.push(c.id);
  }
  toRemove.forEach(removeGisPolyline);
}

export function renderFullGisMap() {
  syncGisMapLayers();
}

export function syncGisMapLayers() {
  const liveIds = {};
  for (let i = 0; i < ctx.gisEquipment.length; i++) {
    const eq = ctx.gisEquipment[i];
    liveIds[eq.id] = true;
    if (!markerMap[eq.id]) renderGisMarker(eq);
  }
  Object.keys(markerMap).forEach(function (id) {
    if (!liveIds[id]) removeGisMarker(id);
  });
  renderGisConnections();
}

export function clearGisMapLayers() {
  Object.keys(markerMap).forEach(removeGisMarker);
  Object.keys(polylineMap).forEach(function (id) { removeGisPolyline(id); });
}

export function flyToGisEquipment(id) {
  const map = getOsmMap();
  const eq = findGisEquipment(id);
  if (map && eq) map.flyTo([eq.lat, eq.lng], Math.max(map.getZoom(), 16), { duration: 0.5 });
}
