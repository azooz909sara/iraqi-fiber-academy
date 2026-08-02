/**
 * Equipment placement, drag/drop, context menu — registered by mainSimulator at init.
 */
import { ctx, SIDEWALK_EQUIPMENT, PLACEMENT_ERR_SIDEWALK } from './simContext.js';
import { placementCoordsFromEvent } from './zoomPanManager.js';

export function registerEquipmentApi(api) {
  Object.assign(ctx.api, api);
}

export function clampMapPoint(px, py) {
  return {
    px: Math.max(0, Math.min(ctx.MAP_W, px)),
    py: Math.max(0, Math.min(ctx.MAP_H, py)),
  };
}

export function setSelectedToolboxType(type) {
  ctx.selectedToolboxType = type || null;
  if (!ctx.dom.toolboxItems) return;
  const items = ctx.dom.toolboxItems.querySelectorAll('.toolbox-item');
  for (let i = 0; i < items.length; i++) {
    items[i].classList.toggle('toolbox-item--selected', items[i].dataset.type === ctx.selectedToolboxType);
  }
}

export function quickPlaceTool(type, col, row, px, py) {
  const api = ctx.api;
  if (type === 'olt') {
    const oltCheck = api.canPlaceOltAt(col, row, px, py);
    if (!oltCheck.ok) {
      api.toast(oltCheck.msg, 'error');
      return;
    }
    const grid = api.resolveGridFromPlacement(col, row, px, py);
    if (grid && !api.isOccupied(grid.col, grid.row)) {
      api.addNode('olt', grid.col, grid.row, null);
    }
    return;
  }
  if (type === 'pole') {
    api.handlePoleDrop(col, row);
    return;
  }
  if (type === 'closure') {
    api.handleClosureDrop(col, row);
    return;
  }
  if (type === 'splitter') {
    const splExisting = api.getNodeAt(col, row);
    if (splExisting && splExisting.type === 'pole_foundation' && splExisting.hasPole) {
      api.tryInstallFatSplitter(splExisting, ctx.toolboxVals.splitter || '1x8');
    } else {
      api.toast('Drop Splitter onto pole FAT box', 'warn');
    }
    return;
  }
  if (api.isSatelliteFreePlacementMode() && SIDEWALK_EQUIPMENT[type] && px != null && py != null) {
    if (!api.isOccupiedFree(px, py)) {
      api.addNode(type, col, row, ctx.toolboxVals[type] || null, { free: true, px, py });
    }
    return;
  }
  if (!api.isOccupied(col, row)) {
    api.addNode(type, col, row, ctx.toolboxVals[type] || null);
  }
}

export function hideContextMenu() {
  ctx.contextMenuNodeId = null;
  ctx.quickAddTarget = null;
  if (!ctx.dom.contextMenu) return;
  ctx.dom.contextMenu.classList.add('hidden');
  ctx.dom.contextMenu.setAttribute('aria-hidden', 'true');
  ctx.dom.contextMenu.innerHTML = '';
}

export function showQuickAddMenu(clientX, clientY, col, row, px, py) {
  if (!ctx.dom.contextMenu) return;
  ctx.quickAddTarget = { col, row, px, py };
  const layout = ctx.api.getLayout(ctx.currentLayout);
  const inItpc = ctx.api.isItpcCell(layout, col, row);
  let html = '<div class="sim-context-menu__title">Quick Add</div>';
  html += '<button type="button" class="sim-context-menu__item" data-quick="pole_foundation">📍 pole foundation</button>';
  html += '<button type="button" class="sim-context-menu__item" data-quick="handhole">🟩 Handhole</button>';
  html += '<button type="button" class="sim-context-menu__item" data-quick="fdt">🟧 FDT Cabinet</button>';
  if (inItpc) {
    html += '<button type="button" class="sim-context-menu__item" data-quick="olt">🖥️ OLT (ITPC only)</button>';
  }
  ctx.dom.contextMenu.innerHTML = html;
  ctx.dom.contextMenu.querySelectorAll('[data-quick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!ctx.quickAddTarget) return;
      quickPlaceTool(
        btn.getAttribute('data-quick'),
        ctx.quickAddTarget.col,
        ctx.quickAddTarget.row,
        ctx.quickAddTarget.px,
        ctx.quickAddTarget.py
      );
      hideContextMenu();
    });
  });
  ctx.api.positionContextMenu(clientX, clientY);
}

export function onMapContextMenu(e) {
  if (e.target.closest('.grid-controls') || e.target.closest('#map-layer-toggles')) return;

  if (ctx.mapInteractionMode === 'hand') {
    e.preventDefault();
    e.stopPropagation();
    hideContextMenu();
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  const nodeEl = e.target.closest('.placed-node');
  if (nodeEl) {
    const node = ctx.api.findNode(nodeEl.dataset.nodeId);
    if (ctx.api.isContextMenuEligible(node)) {
      ctx.api.showContextMenu(e.clientX, e.clientY, node);
    } else {
      hideContextMenu();
    }
    return;
  }

  const coords = placementCoordsFromEvent(e);
  if (!coords) {
    hideContextMenu();
    return;
  }

  if (ctx.selectedToolboxType) {
    if (ctx.selectedToolboxType === 'olt') {
      const oltToolboxCheck = ctx.api.canPlaceOltAt(coords.col, coords.row, coords.px, coords.py);
      if (!oltToolboxCheck.ok) {
        ctx.api.toast(oltToolboxCheck.msg, 'error');
        return;
      }
    }
    quickPlaceTool(ctx.selectedToolboxType, coords.col, coords.row, coords.px, coords.py);
    return;
  }

  const layout = ctx.api.getLayout(ctx.currentLayout);
  if (ctx.api.isSatelliteFreePlacementMode() ||
      ctx.api.isSidewalkCell(layout, coords.col, coords.row) ||
      ctx.api.isItpcCell(layout, coords.col, coords.row)) {
    showQuickAddMenu(e.clientX, e.clientY, coords.col, coords.row, coords.px, coords.py);
  } else {
    hideContextMenu();
  }
}

export function bindEquipmentEvents() {
  const targets = [ctx.dom.cityGrid, ctx.dom.cityCanvas, ctx.dom.freeNodesLayer, ctx.dom.canvasWrapper];
  for (let i = 0; i < targets.length; i++) {
    if (targets[i]) targets[i].addEventListener('contextmenu', onMapContextMenu);
  }
}

export function updateNodesDraggable() {
  if (!ctx.dom.cityGrid && !ctx.dom.freeNodesLayer) return;
  const handMode = ctx.mapInteractionMode === 'hand';
  const els = document.querySelectorAll('#city-grid .node, #city-grid .placed-node, #free-nodes-layer .placed-node');
  for (let i = 0; i < els.length; i++) {
    const node = ctx.api.findNode(els[i].dataset.nodeId);
    const canDrag = !handMode && !ctx.connectMode && node && !node.locked;
    els[i].draggable = canDrag;
    els[i].setAttribute('draggable', canDrag ? 'true' : 'false');
  }
  if (ctx.dom.cityGrid) {
    ctx.dom.cityGrid.classList.toggle('connect-mode-active', ctx.connectMode);
    ctx.dom.cityGrid.classList.toggle('map-mode-hand-active', handMode);
  }
  if (ctx.dom.freeNodesLayer) {
    ctx.dom.freeNodesLayer.classList.toggle('map-mode-hand-active', handMode);
  }
}
