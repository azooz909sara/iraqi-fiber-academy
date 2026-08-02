/**
 * LocalStorage save / load / auto-save for FTTH designs.
 */
import { ctx } from './simContext.js';
import { layerState } from './mapLayers.js';

const STORAGE_KEY = 'fiber_academy_ftth_design_v1';
const AUTOSAVE_DELAY_MS = 2000;
let autosaveTimer = null;
let autosaveEnabled = true;

export function serializeDesign() {
  return {
    version: 2,
    savedAt: new Date().toISOString(),
    currentLayout: ctx.currentLayout,
    mapMode: ctx.mapMode || 'virtual',
    nodes: JSON.parse(JSON.stringify(ctx.nodes)),
    connections: JSON.parse(JSON.stringify(ctx.connections)),
    nodeId: ctx.nodeId,
    connId: ctx.connId,
    toolboxVals: JSON.parse(JSON.stringify(ctx.toolboxVals || {})),
    layerState: JSON.parse(JSON.stringify(layerState)),
    zoomLevel: ctx.zoomLevel,
    panX: ctx.panX,
    panY: ctx.panY,
    selectedNodeId: ctx.selectedNodeId || null,
    osmView: ctx.osmView ? JSON.parse(JSON.stringify(ctx.osmView)) : null,
    gisProject: ctx.gisProject ? JSON.parse(JSON.stringify(ctx.gisProject)) : null,
    gisEquipment: JSON.parse(JSON.stringify(ctx.gisEquipment || [])),
    gisConnections: JSON.parse(JSON.stringify(ctx.gisConnections || [])),
    gisNodeId: ctx.gisNodeId || 0,
    gisConnId: ctx.gisConnId || 0,
    selectedGisId: ctx.selectedGisId || null,
    topology: ctx.api.serializeTopologyState ? ctx.api.serializeTopologyState() : null,
    networkZones: ctx.api.serializeNetworkZones ? ctx.api.serializeNetworkZones() : null,
  };
}

export function saveDesignToStorage(manual) {
  try {
    const payload = serializeDesign();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    updateSaveStatus(manual ? 'Saved' : 'Auto-saved');
    return true;
  } catch (err) {
    console.error('[Persistence] Save failed:', err);
    if (ctx.api.toast) ctx.api.toast('Save failed — storage full or blocked', 'error');
    return false;
  }
}

export function loadDesignFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.error('[Persistence] Load failed:', err);
    return null;
  }
}

export function hasSavedDesign() {
  return !!localStorage.getItem(STORAGE_KEY);
}

export function clearSavedDesign() {
  localStorage.removeItem(STORAGE_KEY);
  updateSaveStatus('Cleared');
}

function updateSaveStatus(text) {
  const el = document.getElementById('save-status');
  if (!el) return;
  el.textContent = text;
  el.classList.add('save-status--flash');
  setTimeout(function () { el.classList.remove('save-status--flash'); }, 1200);
}

export function scheduleAutoSave() {
  if (!autosaveEnabled) return;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(function () {
    autosaveTimer = null;
    saveDesignToStorage(false);
  }, AUTOSAVE_DELAY_MS);
}

export function bindPersistenceControls() {
  const btnSave = document.getElementById('btn-save-design');
  const btnLoad = document.getElementById('btn-load-design');
  if (btnSave) {
    btnSave.addEventListener('click', function () {
      if (saveDesignToStorage(true) && ctx.api.toast) {
        ctx.api.toast('Design saved ✓', 'success');
      }
    });
  }
  if (btnLoad) {
    btnLoad.addEventListener('click', function () {
      const state = loadDesignFromStorage();
      if (!state) {
        if (ctx.api.toast) ctx.api.toast('No saved design found', 'warn');
        return;
      }
      if (ctx.api.restoreDesign) ctx.api.restoreDesign(state, true);
    });
  }
}

/**
 * Called from mainSimulator after init — restores last session if present.
 */
export function tryAutoRestoreOnInit() {
  const state = loadDesignFromStorage();
  if (state && ctx.api.restoreDesign) {
    ctx.api.restoreDesign(state, false);
    updateSaveStatus('Restored');
    return true;
  }
  return false;
}

export function registerPersistenceHooks() {
  ctx.api.persistChange = function () {
    scheduleAutoSave();
  };
  ctx.api.saveDesign = function () { return saveDesignToStorage(true); };
  ctx.api.loadDesign = function () {
    const state = loadDesignFromStorage();
    if (state && ctx.api.restoreDesign) ctx.api.restoreDesign(state, true);
    return !!state;
  };
}
