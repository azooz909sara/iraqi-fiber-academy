/**
 * GIS FTTH system orchestrator — placement, topology, zones, cable routing.
 */
import { ctx } from './simContext.js';
import { initGisStore, findGisEquipment, removeGisEquipment as removeFromGisStore, restoreGisState, clearGisDesign, countGisByType } from './gisStore.js';
import {
  syncGisMapLayers, clearGisMapLayers, refreshGisMarkerSelection, flyToGisEquipment,
  removeGisMarker, removeGisConnectionsForEquipment, refreshAllGisMarkerIcons,
} from './gisMapRenderer.js';
import { getOsmMap } from './osmMapEngine.js';
import { bindGisPlacement, disarmGisPlacement, clearActiveLatLng, getArmedGisType, getActiveLatLng } from './gisPlacement.js';
import {
  bindTopologyInteractions, bindTopologyControls, clearTopologyDesign,
  updateTopologyBanner, restoreTopologyState, serializeTopologyState,
} from './gisTopology.js';
import {
  bindZoneToolbox, bindZoneShadowToggle, setGisZoneMode, clearNetworkZones, restoreNetworkZones,
  serializeNetworkZones, isGisZoneMode, applyWorkspacePanBounds, restoreNetworkZonesOnMap,
  applyZoneShadowVisibility, setZoneShadowVisible,
} from './gisNetworkZone.js';
import {
  bindCableRouting, cancelCableDraw, disarmGisCable, isCableDrawActive, isCableArmed,
} from './gisCableRouting.js';
import { handleGisEquipmentClick, setGisConnectMode, updateGisMetrics, bindGisConnectButton } from './gisConnections.js';
import { showGisPropertyPanel, clearGisPropertyPanel } from './propertyPanel.js';
import { getGisTypeLabel } from './gisEquipmentTypes.js';
import { calculateGisFiberMetrics, buildGisFiberBoq } from './fiberMetrics.js';

export function selectGisEquipment(id) {
  ctx._prevSelectedGisId = ctx.selectedGisId;
  ctx.selectedGisId = id || null;
  ctx.selectedNodeId = null;
  refreshGisMarkerSelection();
  if (id) {
    showGisPropertyPanel(id);
    flyToGisEquipment(id);
  } else {
    clearGisPropertyPanel();
  }
  updateGisStatusBar();
}

export function deleteGisEquipment(id) {
  removeGisConnectionsForEquipment(id);
  removeGisMarker(id);
  removeFromGisStore(id);
  if (ctx.selectedGisId === id) selectGisEquipment(null);
  onGisDesignChanged();
  if (ctx.api.toast) ctx.api.toast('Equipment removed', 'warn');
}

function onGisDesignChanged() {
  updateGisMetrics();
  updateGisStatusBar();
  updateTopologyBanner();
  if (ctx.api.persistChange) ctx.api.persistChange();
}

export function restoreGisDesign(state) {
  if (!state) return;
  restoreGisState(state);
  if (state.topology) restoreTopologyState(state.topology);
  if (state.networkZones) restoreNetworkZones(state.networkZones);
  if (getOsmMap()) {
    clearGisMapLayers();
    syncGisMapLayers();
    applyWorkspacePanBounds();
  }
  updateGisMetrics();
  updateGisStatusBar();
  updateTopologyBanner();
  if (state.selectedGisId && findGisEquipment(state.selectedGisId)) {
    ctx.selectedGisId = state.selectedGisId;
  }
}

export function initGisOnMapReady() {
  bindGisPlacement();
  bindTopologyInteractions();
  bindTopologyControls();
  bindZoneToolbox();
  bindZoneShadowToggle();
  bindCableRouting();
  bindGisConnectButton();
  syncGisMapLayers();
  updateGisMetrics();
  updateGisStatusBar();
  updateTopologyBanner();
  if (ctx.selectedGisId && findGisEquipment(ctx.selectedGisId)) {
    selectGisEquipment(ctx.selectedGisId);
  }
}

function formatCoord(n) {
  return n != null ? n.toFixed(5) : '—';
}

export function updateGisStatusBar() {
  const hint = document.getElementById('osm-workspace-hint');
  if (!hint || ctx.mapMode !== 'osm') return;

  const count = ctx.gisEquipment.length;
  const armed = getArmedGisType();
  const target = getActiveLatLng();
  const cursor = ctx.gisCursorCoords;
  const zoom = getOsmMap() ? getOsmMap().getZoom() : '—';

  let modeLabel = 'Ready';
  let modeClass = 'gis-status-badge__pill--idle';

  if (isGisZoneMode()) {
    modeLabel = 'Network Zone';
    modeClass = 'gis-status-badge__pill--zone';
  } else if (isCableDrawActive()) {
    const verts = ctx.gisCableDraw.vertices ? ctx.gisCableDraw.vertices.length : 0;
    modeLabel = 'Cable Route (' + verts + ' anchors)';
    modeClass = 'gis-status-badge__pill--cable';
  } else if (isCableArmed()) {
    modeLabel = 'Cable — pick source';
    modeClass = 'gis-status-badge__pill--cable';
  } else if (armed) {
    modeLabel = 'Install: ' + getGisTypeLabel(armed);
    modeClass = 'gis-status-badge__pill--armed';
  } else if (target) {
    modeLabel = 'Topology Active';
    modeClass = 'gis-status-badge__pill--target';
  }

  const coordText = target
    ? formatCoord(target.lat) + ', ' + formatCoord(target.lng)
    : cursor ? formatCoord(cursor.lat) + ', ' + formatCoord(cursor.lng) : '— , —';

  hint.innerHTML =
    '<div class="gis-status-badge">' +
      '<span class="gis-status-badge__pill ' + modeClass + '">' + modeLabel + '</span>' +
      '<span class="gis-status-badge__sep"></span>' +
      '<span class="gis-status-badge__coords">' + coordText + '</span>' +
      '<span class="gis-status-badge__sep"></span>' +
      '<span class="gis-status-badge__meta">Z' + zoom + ' · ' + count + ' assets</span>' +
    '</div>';
}

export function onMapModeEnterOsm() {
  disarmGisPlacement(false);
  clearActiveLatLng();
  setGisConnectMode(false);
  setGisZoneMode(false);
  initGisOnMapReady();
}

export function onMapModeLeaveOsm() {
  disarmGisPlacement(false);
  clearActiveLatLng();
  cancelCableDraw();
  disarmGisCable();
  setGisZoneMode(false);
  selectGisEquipment(null);
  updateTopologyBanner();
  resetConnectButtonForVirtual();
}

function resetConnectButtonForVirtual() {
  const btn = document.getElementById('btn-connect-mode');
  if (btn) {
    btn.classList.remove('border-fiber-cyan', 'text-fiber-cyan');
    btn.textContent = '🔗 Cable Mode';
  }
}

function onGisMapZoom() {
  refreshAllGisMarkerIcons();
  updateGisStatusBar();
}

export function registerGisController() {
  initGisStore();
  if (!ctx.topologyNodes) ctx.topologyNodes = [];
  if (!ctx.topologyRoutes) ctx.topologyRoutes = [];
  if (!ctx.gisNetworkZones) ctx.gisNetworkZones = [];

  ctx.api.findGisEquipment = findGisEquipment;
  ctx.api.countGisByType = countGisByType;
  ctx.api.selectGisEquipment = selectGisEquipment;
  ctx.api.onGisMarkerClick = handleGisEquipmentClick;
  ctx.api.onGisEquipmentMoved = onGisDesignChanged;
  ctx.api.onGisDesignChanged = onGisDesignChanged;
  ctx.api.onGisMapZoom = onGisMapZoom;
  ctx.api.updateGisStatusBar = updateGisStatusBar;
  ctx.api.bindGisPlacement = bindGisPlacement;
  ctx.api.bindTopologyInteractions = bindTopologyInteractions;
  ctx.api.bindCableRouting = bindCableRouting;
  ctx.api.bindZoneToolbox = bindZoneToolbox;
  ctx.api.bindZoneShadowToggle = bindZoneShadowToggle;
  ctx.api.applyZoneShadowVisibility = applyZoneShadowVisibility;
  ctx.api.setZoneShadowVisible = setZoneShadowVisible;
  ctx.api.setGisZoneMode = setGisZoneMode;
  ctx.api.disarmGisPlacement = disarmGisPlacement;
  ctx.api.disarmGisCable = disarmGisCable;
  ctx.api.cancelCableDraw = cancelCableDraw;
  ctx.api.syncGisMapLayers = syncGisMapLayers;
  ctx.api.restoreNetworkZonesOnMap = restoreNetworkZonesOnMap;
  ctx.api.applyWorkspacePanBounds = applyWorkspacePanBounds;
  ctx.api.restoreGisDesign = function (state) {
    restoreGisDesign({
      gisEquipment: state.gisEquipment,
      gisConnections: state.gisConnections,
      gisNodeId: state.gisNodeId,
      gisConnId: state.gisConnId,
      selectedGisId: state.selectedGisId,
      topology: state.topology,
      networkZones: state.networkZones,
    });
  };
  ctx.api.clearGisDesign = function () {
    clearGisDesign();
    clearTopologyDesign();
    clearNetworkZones();
    clearGisMapLayers();
    updateGisMetrics();
    updateGisStatusBar();
    updateTopologyBanner();
  };
  ctx.api.serializeTopologyState = serializeTopologyState;
  ctx.api.serializeNetworkZones = serializeNetworkZones;
  ctx.api.buildGisFiberBoq = function () {
    return buildGisFiberBoq(ctx.gisEquipment, ctx.gisConnections);
  };
  ctx.api.getGisMetrics = function () {
    return calculateGisFiberMetrics(ctx.gisEquipment, ctx.gisConnections);
  };
  ctx.api.deleteGisEquipment = deleteGisEquipment;
  ctx.api.initGisOnMapReady = initGisOnMapReady;
  ctx.api.onMapModeEnterOsm = onMapModeEnterOsm;
  ctx.api.onMapModeLeaveOsm = onMapModeLeaveOsm;

  ctx.api.findEquipment = function (id) {
    if (ctx.mapMode === 'osm') return findGisEquipment(id);
    return ctx.api.findNode ? ctx.api.findNode(id) : null;
  };
}

export function initGisSystem() {
  registerGisController();
}
