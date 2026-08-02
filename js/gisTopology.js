/**
 * Field topology workflow — target points, route chaining, topology banner.
 */
import { ctx } from './simContext.js';
import { getOsmMap, getTopologyLayer, getRouteLayer } from './osmMapEngine.js';

let activeCrosshair = null;
const topologyNodeMarkers = {};
const routePolylines = {};

export function getActiveTopologyPoint() {
  return ctx.activeTopologyPoint || null;
}

export function setActiveTopologyPoint(lat, lng, silent) {
  ctx.activeTopologyPoint = { lat, lng };
  ctx.activeLatLng = ctx.activeTopologyPoint;
  showTopologyCrosshair(lat, lng);
  if (!silent) updateTopologyBanner();
  if (ctx.api.updateGisStatusBar) ctx.api.updateGisStatusBar();
}

export function clearActiveTopologyPoint() {
  ctx.activeTopologyPoint = null;
  ctx.activeLatLng = null;
  removeCrosshair();
  updateTopologyBanner();
  if (ctx.api.updateGisStatusBar) ctx.api.updateGisStatusBar();
}

function crosshairHtml() {
  return '<div class="gis-crosshair gis-crosshair--topology" aria-hidden="true">' +
    '<span class="gis-crosshair__ring"></span>' +
    '<span class="gis-crosshair__h"></span>' +
    '<span class="gis-crosshair__v"></span>' +
    '<span class="gis-crosshair__dot"></span>' +
    '</div>';
}

function removeCrosshair() {
  if (activeCrosshair) {
    activeCrosshair.remove();
    activeCrosshair = null;
  }
}

function showTopologyCrosshair(lat, lng) {
  const layer = getTopologyLayer();
  if (!layer) return;
  removeCrosshair();
  activeCrosshair = L.marker([lat, lng], {
    icon: L.divIcon({
      className: 'gis-crosshair-wrap',
      html: crosshairHtml(),
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    }),
    interactive: false,
    zIndexOffset: 2500,
  });
  activeCrosshair.addTo(layer);
}

function nextTopologyId() {
  ctx.topologyNodeId = (ctx.topologyNodeId || 0) + 1;
  return 'tp' + ctx.topologyNodeId;
}

function nextRouteId() {
  ctx.topologyRouteId = (ctx.topologyRouteId || 0) + 1;
  return 'tr' + ctx.topologyRouteId;
}

function routeStyle(type) {
  if (type === 'aerial') {
    return { color: '#38bdf8', weight: 4, opacity: 0.9, dashArray: null };
  }
  return { color: '#b45309', weight: 5, opacity: 0.85, dashArray: '10 6' };
}

function addTopologyNodeMarker(node) {
  const layer = getTopologyLayer();
  if (!layer) return;
  const marker = L.circleMarker([node.lat, node.lng], {
    radius: 5,
    color: '#fbbf24',
    fillColor: '#f59e0b',
    fillOpacity: 0.9,
    weight: 2,
    className: 'gis-topology-node',
  });
  marker._topologyId = node.id;
  marker.addTo(layer);
  topologyNodeMarkers[node.id] = marker;
}

function drawRouteSegment(fromNode, toNode, routeType) {
  const layer = getRouteLayer();
  if (!layer || !fromNode || !toNode) return null;
  const id = nextRouteId();
  const style = routeStyle(routeType || ctx.gisRouteMode || 'underground');
  const line = L.polyline(
    [[fromNode.lat, fromNode.lng], [toNode.lat, toNode.lng]],
    style
  );
  line._routeId = id;
  line.addTo(layer);
  const route = {
    id,
    from: fromNode.id,
    to: toNode.id,
    type: routeType || ctx.gisRouteMode || 'underground',
  };
  ctx.topologyRoutes.push(route);
  routePolylines[id] = line;
  return route;
}

export function registerTopologyPoint(lat, lng) {
  if (ctx.mapMode !== 'osm') return null;

  setActiveTopologyPoint(lat, lng, true);

  const prevId = ctx.topologyChainLastId;
  const node = { id: nextTopologyId(), lat, lng };
  ctx.topologyNodes.push(node);
  addTopologyNodeMarker(node);

  if (ctx.gisRouteMode && prevId) {
    const prev = ctx.topologyNodes.find(function (n) { return n.id === prevId; });
    if (prev) drawRouteSegment(prev, node, ctx.gisRouteMode);
  }

  ctx.topologyChainLastId = node.id;
  updateTopologyBanner();
  return node;
}

export function setGisRouteMode(mode) {
  ctx.gisRouteMode = mode || null;
  document.querySelectorAll('[data-gis-route-mode]').forEach(function (btn) {
    const m = btn.getAttribute('data-gis-route-mode');
    const on = m === mode;
    btn.classList.toggle('map-layer-btn--active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  updateTopologyBanner();
  if (ctx.api.toast && mode) {
    ctx.api.toast(
      mode === 'aerial' ? 'Aerial Route — click consecutive topology points' : 'Underground Excavation — click consecutive points',
      'success'
    );
  }
}

export function clearTopologyDesign() {
  ctx.topologyNodes = [];
  ctx.topologyRoutes = [];
  ctx.topologyChainLastId = null;
  clearActiveTopologyPoint();

  Object.keys(topologyNodeMarkers).forEach(function (id) {
    topologyNodeMarkers[id].remove();
    delete topologyNodeMarkers[id];
  });
  Object.keys(routePolylines).forEach(function (id) {
    routePolylines[id].remove();
    delete routePolylines[id];
  });
  updateTopologyBanner();
}

export function updateTopologyBanner() {
  const banner = document.getElementById('topology-banner');
  if (!banner) return;

  const pt = getActiveTopologyPoint();
  if (pt && ctx.mapMode === 'osm') {
    banner.classList.remove('hidden');
    const routeLabel = ctx.gisRouteMode === 'aerial' ? 'Aerial Route' :
      ctx.gisRouteMode === 'underground' ? 'Underground Excavation' : 'Topology';
    banner.innerHTML =
      '<span class="topology-banner__icon">◎</span>' +
      '<span class="topology-banner__text"><strong>Topology Active:</strong> ' +
      pt.lat.toFixed(5) + ', ' + pt.lng.toFixed(5) + ' Registered</span>' +
      '<span class="topology-banner__mode">' + routeLabel + '</span>';
  } else {
    banner.classList.add('hidden');
    banner.innerHTML = '';
  }
}

function onMapContextMenu(e) {
  if (ctx.mapMode !== 'osm') return;
  if (ctx.gisCableDraw && ctx.gisCableDraw.active) return;
  L.DomEvent.preventDefault(e);

  if (ctx.topologyNodes.length > 0) {
    const last = ctx.topologyNodes[ctx.topologyNodes.length - 1];
    if (last && topologyNodeMarkers[last.id]) {
      topologyNodeMarkers[last.id].remove();
      delete topologyNodeMarkers[last.id];
    }
    if (ctx.topologyRoutes.length > 0) {
      const route = ctx.topologyRoutes.pop();
      if (route && routePolylines[route.id]) {
        routePolylines[route.id].remove();
        delete routePolylines[route.id];
      }
    }
    ctx.topologyNodes.pop();
    ctx.topologyChainLastId = ctx.topologyNodes.length
      ? ctx.topologyNodes[ctx.topologyNodes.length - 1].id
      : null;
    if (ctx.api.toast) ctx.api.toast('Last topology point removed', 'warn');
    updateTopologyBanner();
  }
}

export function bindTopologyInteractions() {
  const map = getOsmMap();
  if (!map || map._topologyBound) return;
  map._topologyBound = true;

  ctx.api.onTopologyContextMenu = onMapContextMenu;
}

export function bindTopologyControls() {
  const bar = document.getElementById('osm-topology-controls');
  if (!bar || bar._bound) return;
  bar._bound = true;

  bar.querySelectorAll('[data-gis-route-mode]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const mode = btn.getAttribute('data-gis-route-mode');
      const current = ctx.gisRouteMode;
      setGisRouteMode(current === mode ? null : mode);
    });
  });

  const clearBtn = document.getElementById('btn-clear-topology');
  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      clearTopologyDesign();
      if (ctx.api.toast) ctx.api.toast('Topology cleared', 'warn');
    });
  }
}

export function restoreTopologyState(state) {
  clearTopologyDesign();
  if (!state) return;
  (state.topologyNodes || []).forEach(function (n) {
    ctx.topologyNodeId = Math.max(ctx.topologyNodeId || 0, parseInt(n.id.replace('tp', ''), 10) || 0);
    ctx.topologyNodes.push(n);
    addTopologyNodeMarker(n);
  });
  ctx.topologyChainLastId = state.topologyChainLastId || null;
  if (state.activeTopologyPoint) setActiveTopologyPoint(state.activeTopologyPoint.lat, state.activeTopologyPoint.lng, true);
  (state.topologyRoutes || []).forEach(function (r) {
    const a = ctx.topologyNodes.find(function (n) { return n.id === r.from; });
    const b = ctx.topologyNodes.find(function (n) { return n.id === r.to; });
    if (a && b) drawRouteSegment(a, b, r.type);
  });
  if (state.gisRouteMode) setGisRouteMode(state.gisRouteMode);
  updateTopologyBanner();
}

export function serializeTopologyState() {
  return {
    topologyNodes: JSON.parse(JSON.stringify(ctx.topologyNodes || [])),
    topologyRoutes: JSON.parse(JSON.stringify(ctx.topologyRoutes || [])),
    topologyChainLastId: ctx.topologyChainLastId,
    activeTopologyPoint: ctx.activeTopologyPoint ? Object.assign({}, ctx.activeTopologyPoint) : null,
    gisRouteMode: ctx.gisRouteMode,
    topologyNodeId: ctx.topologyNodeId || 0,
    topologyRouteId: ctx.topologyRouteId || 0,
  };
}
