/**
 * Zoom, pan, hand/select tools, zoom-responsive icon scaling.
 */
import { ctx } from './simContext.js';

const ZOOM_COMP_MIN = 1;
const ZOOM_COMP_MAX = 4;
const NODE_BASE_PX = 44;
const MIN_SCREEN_NODE_PX = 30;
const MIN_SCREEN_STROKE = 2;
const ZOOM_WHEEL_DELTA = 0.05;

/** Cached compensation — Scale ≈ BaseSize / Zoom (clamped). */
const _zoomCompCache = { zoom: null, comp: ZOOM_COMP_MIN };
let _zoomCompRaf = 0;

export function getZoomCompensation() {
  const z = ctx.zoomLevel;
  if (_zoomCompCache.zoom === z) return _zoomCompCache.comp;
  let comp = ZOOM_COMP_MIN;
  if (z > 0 && z < 1) {
    comp = NODE_BASE_PX / (NODE_BASE_PX * z);
    comp = Math.max(MIN_SCREEN_NODE_PX / (NODE_BASE_PX * z), 1 / z);
  }
  comp = Math.max(ZOOM_COMP_MIN, Math.min(ZOOM_COMP_MAX, comp));
  _zoomCompCache.zoom = z;
  _zoomCompCache.comp = comp;
  return comp;
}

const _cachedNodes = [];
const _cachedLines = [];
let _cacheValid = false;

function updateDomCache() {
  if (_cacheValid) return;
  _cachedNodes.length = 0;
  _cachedLines.length = 0;
  const nodes = document.querySelectorAll('.placed-node');
  for (let i = 0; i < nodes.length; i++) _cachedNodes.push(nodes[i]);
  if (ctx.dom.connectionsLayer) {
    const lines = ctx.dom.connectionsLayer.querySelectorAll('.conn-line:not(.conn-line--preview)');
    for (let j = 0; j < lines.length; j++) _cachedLines.push(lines[j]);
  }
  _cacheValid = true;
}

function invalidateDomCache() {
  _cacheValid = false;
}

function applyZoomCompensationNow() {
  const comp = getZoomCompensation();
  if (ctx.dom.cityCanvas) {
    ctx.dom.cityCanvas.style.setProperty('--zoom-comp', String(comp));
  }
  updateDomCache();
  for (let i = 0; i < _cachedNodes.length; i++) {
    const node = _cachedNodes[i];
    node.style.transform = comp > 1 ? 'scale(' + comp + ')' : '';
    node.style.transformOrigin = 'center center';
  }
  for (let j = 0; j < _cachedLines.length; j++) {
    const line = _cachedLines[j];
    const base = parseFloat(line.getAttribute('data-base-width') || '2.5');
    line.setAttribute('stroke-width', String(Math.max(MIN_SCREEN_STROKE, base * comp)));
  }
  const preview = document.getElementById('cable-preview-line');
  if (preview) {
    const pb = parseFloat(preview.getAttribute('data-base-width') || '3');
    preview.setAttribute('stroke-width', String(Math.max(MIN_SCREEN_STROKE, pb * comp)));
  }
}

export function applyZoomCompensation() {
  if (_zoomCompRaf) return;
  _zoomCompRaf = requestAnimationFrame(function () {
    _zoomCompRaf = 0;
    applyZoomCompensationNow();
  });
}

export function applyMapTransform() {
  if (ctx.dom.zoomInner) {
    ctx.dom.zoomInner.style.transformOrigin = '0 0';
    ctx.dom.zoomInner.style.transform =
      `translate(${ctx.panX}px,${ctx.panY}px) scale(${ctx.zoomLevel})`;
  }
  if (ctx.dom.zoomLabel) {
    ctx.dom.zoomLabel.textContent = `${Math.round(ctx.zoomLevel * 100)}%`;
  }
  applyZoomCompensation();
}

export function setZoom(val, pivotX, pivotY) {
  const newZoom = Math.max(ctx.ZOOM_MIN, Math.min(ctx.ZOOM_MAX, Math.round(val * 100) / 100));
  if (pivotX != null && pivotY != null) {
    const ratio = newZoom / ctx.zoomLevel;
    ctx.panX = pivotX - (pivotX - ctx.panX) * ratio;
    ctx.panY = pivotY - (pivotY - ctx.panY) * ratio;
  }
  ctx.zoomLevel = newZoom;
  applyMapTransform();
}

export function resetMapView() {
  if (!ctx.dom.canvasWrapper) {
    applyMapTransform();
    return;
  }
  ctx.zoomLevel = ctx.currentLayout === 'satellite' ? 0.28 : 0.38;
  ctx.panX = (ctx.dom.canvasWrapper.clientWidth - ctx.MAP_W * ctx.zoomLevel) * 0.5;
  ctx.panY = (ctx.dom.canvasWrapper.clientHeight - ctx.MAP_H * ctx.zoomLevel) * 0.5;
  applyMapTransform();
}

export function onMapWheel(e) {
  if (!ctx.dom.canvasWrapper) return;
  e.preventDefault();
  const rect = ctx.dom.canvasWrapper.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const delta = e.deltaY > 0 ? -ZOOM_WHEEL_DELTA : ZOOM_WHEEL_DELTA;
  setZoom(ctx.zoomLevel + delta, px, py);
}

export function onPanStart(e) {
  if (e.button !== 0) return;
  if (e.target.closest('.grid-controls') || e.target.closest('#map-layer-toggles') ||
      e.target.closest('button') || e.target.closest('select')) return;

  if (ctx.mapInteractionMode === 'hand') {
    e.preventDefault();
    ctx.isPanning = true;
    ctx.panSession = { x: e.clientX, y: e.clientY, panX: ctx.panX, panY: ctx.panY };
    if (ctx.dom.canvasWrapper) ctx.dom.canvasWrapper.classList.add('is-panning');
    return;
  }

  if (ctx.connectMode) return;
  if (e.target.closest('.node') || e.target.closest('.placed-node')) return;
  e.preventDefault();
  ctx.isPanning = true;
  ctx.panSession = { x: e.clientX, y: e.clientY, panX: ctx.panX, panY: ctx.panY };
  if (ctx.dom.canvasWrapper) ctx.dom.canvasWrapper.classList.add('is-panning');
}

let _panRaf = 0;

export function onPanMove(e) {
  if (!ctx.isPanning || !ctx.panSession) return;
  ctx.panX = ctx.panSession.panX + (e.clientX - ctx.panSession.x);
  ctx.panY = ctx.panSession.panY + (e.clientY - ctx.panSession.y);
  if (_panRaf) return;
  _panRaf = requestAnimationFrame(function () {
    _panRaf = 0;
    applyMapTransform();
  });
}

export function onPanEnd() {
  ctx.isPanning = false;
  ctx.panSession = null;
  if (ctx.dom.canvasWrapper) ctx.dom.canvasWrapper.classList.remove('is-panning');
}

export function setMapInteractionMode(mode) {
  ctx.mapInteractionMode = mode === 'hand' ? 'hand' : 'select';
  if (ctx.dom.canvasWrapper) {
    ctx.dom.canvasWrapper.classList.toggle('map-mode-hand', ctx.mapInteractionMode === 'hand');
    ctx.dom.canvasWrapper.classList.toggle('map-mode-select', ctx.mapInteractionMode === 'select');
  }
  if (ctx.dom.toolSelect) {
    ctx.dom.toolSelect.classList.toggle('map-tool-btn--active', ctx.mapInteractionMode === 'select');
    ctx.dom.toolSelect.setAttribute('aria-pressed', ctx.mapInteractionMode === 'select' ? 'true' : 'false');
  }
  if (ctx.dom.toolHand) {
    ctx.dom.toolHand.classList.toggle('map-tool-btn--active', ctx.mapInteractionMode === 'hand');
    ctx.dom.toolHand.setAttribute('aria-pressed', ctx.mapInteractionMode === 'hand' ? 'true' : 'false');
  }
  if (ctx.api.updateNodesDraggable) ctx.api.updateNodesDraggable();
  if (ctx.api.hideContextMenu) ctx.api.hideContextMenu();
}

let _cachedWrapRect = null;
let _wrapRectValid = false;

function getWrapRect() {
  if (_wrapRectValid && _cachedWrapRect) return _cachedWrapRect;
  if (!ctx.dom.canvasWrapper) return null;
  _cachedWrapRect = ctx.dom.canvasWrapper.getBoundingClientRect();
  _wrapRectValid = true;
  return _cachedWrapRect;
}

function invalidateWrapRect() {
  _wrapRectValid = false;
  _cachedWrapRect = null;
}

export function clientToGridCoords(clientX, clientY) {
  const wrapRect = getWrapRect();
  if (!wrapRect) return null;
  return {
    x: (clientX - wrapRect.left - ctx.panX) / ctx.zoomLevel,
    y: (clientY - wrapRect.top - ctx.panY) / ctx.zoomLevel,
  };
}

export function placementCoordsFromEvent(e) {
  const pt = clientToGridCoords(e.clientX, e.clientY);
  if (!pt) return null;
  return {
    col: Math.max(0, Math.min(ctx.GRID_COLS - 1, Math.floor(pt.x / ctx.CELL_SIZE))),
    row: Math.max(0, Math.min(ctx.GRID_ROWS - 1, Math.floor(pt.y / ctx.CELL_SIZE))),
    px: pt.x,
    py: pt.y,
  };
}

export function bindZoomPanEvents() {
  if (ctx.dom.toolSelect) {
    ctx.dom.toolSelect.addEventListener('click', () => setMapInteractionMode('select'));
  }
  if (ctx.dom.toolHand) {
    ctx.dom.toolHand.addEventListener('click', () => setMapInteractionMode('hand'));
  }
  const zoomIn = document.getElementById('btn-zoom-in');
  const zoomOut = document.getElementById('btn-zoom-out');
  const zoomReset = document.getElementById('btn-zoom-reset');
  if (zoomIn) {
    zoomIn.addEventListener('click', () => {
      const px = ctx.dom.canvasWrapper ? ctx.dom.canvasWrapper.clientWidth / 2 : null;
      const py = ctx.dom.canvasWrapper ? ctx.dom.canvasWrapper.clientHeight / 2 : null;
      setZoom(ctx.zoomLevel + 0.15, px, py);
    });
  }
  if (zoomOut) {
    zoomOut.addEventListener('click', () => {
      const px = ctx.dom.canvasWrapper ? ctx.dom.canvasWrapper.clientWidth / 2 : null;
      const py = ctx.dom.canvasWrapper ? ctx.dom.canvasWrapper.clientHeight / 2 : null;
      setZoom(ctx.zoomLevel - 0.15, px, py);
    });
  }
  if (zoomReset) zoomReset.addEventListener('click', resetMapView);

  if (ctx.dom.canvasWrapper) {
    ctx.dom.canvasWrapper.addEventListener('wheel', onMapWheel, { passive: false });
    ctx.dom.canvasWrapper.addEventListener('mousedown', onPanStart);
    window.addEventListener('mousemove', onPanMove);
    window.addEventListener('mouseup', onPanEnd);
  }

  window.addEventListener('resize', () => {
    invalidateWrapRect();
    invalidateDomCache();
  }, { passive: true });
}

export { invalidateDomCache, invalidateWrapRect };
