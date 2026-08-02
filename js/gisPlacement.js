/**
 * GIS asset injection — delegates to zone/cable/topology modes.
 */
import { ctx } from './simContext.js';
import { GIS_PLACEABLE_TYPES, isGisPlaceable } from './gisEquipmentTypes.js';
import { createGisEquipment, addGisEquipment, countGisByType, findNearestGisEquipment } from './gisStore.js';
import { renderGisMarker } from './gisMapRenderer.js';
import { getOsmMap } from './osmMapEngine.js';
import { isInsideItpcBounds } from './gisProject.js';
import {
  registerTopologyPoint, getActiveTopologyPoint, clearActiveTopologyPoint,
  setActiveTopologyPoint, updateTopologyBanner,
} from './gisTopology.js';
import { isGisZoneMode, handleZoneMapClick } from './gisNetworkZone.js';
import {
  isCableDrawActive, isCableArmed, handleCableMapClick, handleCableContextMenu, handleCableMapMove,
} from './gisCableRouting.js';

let armedType = null;

export function getArmedGisType() { return armedType; }
export function getActiveLatLng() { return getActiveTopologyPoint(); }
export function clearActiveLatLng() { clearActiveTopologyPoint(); }

export function armGisPlacement(type) {
  if (!isGisPlaceable(type)) return null;
  armedType = type;
  highlightArmedToolbox(type);
  if (ctx.api.setGisZoneMode) ctx.api.setGisZoneMode(false);
  if (ctx.api.disarmGisCable) ctx.api.disarmGisCable();

  const pt = getActiveTopologyPoint();
  if (pt) {
    const placed = injectAssetAt(type, pt.lat, pt.lng);
    if (placed) disarmGisPlacement(false);
    return placed;
  }
  if (ctx.api.toast) {
    ctx.api.toast('Click map for topology target, then place ' + GIS_PLACEABLE_TYPES[type].label, 'success');
  }
  if (ctx.api.updateGisStatusBar) ctx.api.updateGisStatusBar();
  return null;
}

export function disarmGisPlacement(updateUi) {
  armedType = null;
  highlightArmedToolbox(null);
  if (updateUi !== false && ctx.api.updateGisStatusBar) ctx.api.updateGisStatusBar();
}

function highlightArmedToolbox(type) {
  document.querySelectorAll('#toolbox-items .toolbox-item').forEach(function (el) {
    if (el.dataset.type === 'network_zone') return;
    if (el.classList.contains('toolbox-item--cable')) return;
    el.classList.toggle('toolbox-item--selected', type != null && el.dataset.type === type);
  });
}

export function validateGisOltPlacement(lat, lng) {
  if (!isInsideItpcBounds(lat, lng)) {
    return { ok: false, msg: 'OLT must be placed inside ITPC Exchange Building only' };
  }
  return { ok: true };
}

export function injectAssetAt(type, lat, lng, variant) {
  const def = GIS_PLACEABLE_TYPES[type];
  if (!def) return null;
  if (countGisByType(type) >= def.max) {
    if (ctx.api.toast) ctx.api.toast('Maximum ' + def.label + ' reached', 'warn');
    return null;
  }
  if (type === 'olt') {
    const check = validateGisOltPlacement(lat, lng);
    if (!check.ok) { if (ctx.api.toast) ctx.api.toast(check.msg, 'warn'); return null; }
  }
  let v = variant;
  if (type === 'splitter' && !v && ctx.toolboxVals) v = ctx.toolboxVals.splitter || '1x8';

  const equipment = createGisEquipment(type, lat, lng, v);
  if (!equipment) return null;
  addGisEquipment(equipment);
  const marker = renderGisMarker(equipment);
  if (!marker) console.warn('[GIS] Injection failed');
  if (ctx.api.onGisDesignChanged) ctx.api.onGisDesignChanged();
  if (ctx.api.toast) ctx.api.toast(GIS_PLACEABLE_TYPES[type].label + ' installed ✓', 'success');
  return equipment;
}

export function placeGisEquipmentAt(type, lat, lng, variant) {
  return injectAssetAt(type, lat, lng, variant);
}

function onMapClick(e) {
  if (ctx.mapMode !== 'osm') return;
  const lat = e.latlng.lat;
  const lng = e.latlng.lng;

  if (isGisZoneMode()) {
    handleZoneMapClick(lat, lng);
    return;
  }

  if (isCableDrawActive()) {
    handleCableMapClick(lat, lng);
    return;
  }

  if (isCableArmed()) {
    const near = findNearestGisEquipment(lat, lng, 0.00035);
    if (near && ctx.api.onGisMarkerClick) ctx.api.onGisMarkerClick(near.id);
    return;
  }

  registerTopologyPoint(lat, lng);

  if (armedType) {
    injectAssetAt(armedType, lat, lng);
    disarmGisPlacement(false);
  }

  updateTopologyBanner();
  if (ctx.api.updateGisStatusBar) ctx.api.updateGisStatusBar();
}

function onMapMove(e) {
  ctx.gisCursorCoords = { lat: e.latlng.lat, lng: e.latlng.lng };
  handleCableMapMove(e.latlng.lat, e.latlng.lng);
}

function onMapContextMenu(e) {
  if (ctx.mapMode !== 'osm') return;
  L.DomEvent.preventDefault(e);
  if (handleCableContextMenu(e.latlng.lat, e.latlng.lng)) return;
  if (ctx.api.onTopologyContextMenu) ctx.api.onTopologyContextMenu(e);
}

function onToolboxClick(e) {
  if (ctx.mapMode !== 'osm') return;
  const item = e.target.closest('.toolbox-item');
  if (!item || item.classList.contains('toolbox-item--cable')) return;
  if (item.dataset.type === 'network_zone') return;
  const type = item.dataset.type;
  if (!isGisPlaceable(type)) {
    if (ctx.api.toast) ctx.api.toast('Not available for GIS placement', 'warn');
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  armGisPlacement(type);
}

export function bindGisPlacement() {
  const toolbox = document.getElementById('toolbox-items');
  if (toolbox && !toolbox._gisBound) {
    toolbox._gisBound = true;
    toolbox.addEventListener('click', onToolboxClick, true);
  }
  const map = getOsmMap();
  if (!map) return;
  if (!map._gisPlacementBound) {
    map._gisPlacementBound = true;
    map.on('click', onMapClick);
    map.on('mousemove', onMapMove);
    map.on('contextmenu', onMapContextMenu);
  }
}

export function unbindGisMapClick() {
  disarmGisPlacement(false);
  clearActiveTopologyPoint();
}

export function setGisClickTarget(lat, lng) { setActiveTopologyPoint(lat, lng); }
export function clearGisClickTarget() { clearActiveTopologyPoint(); }
