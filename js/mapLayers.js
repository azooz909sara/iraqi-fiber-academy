/**
 * Map layer toggle logic (top toolbar).
 */
import { ctx, SATELLITE_BG_URL } from './simContext.js';

export const LAYER_PRESETS = {
  satellite: {
    autoBuildings: true, apartments: true, towers: true, parks: true,
    sidewalks: true, streets: false, poi: true, satellite: true,
  },
  standard: {
    autoBuildings: true, apartments: true, towers: true, parks: true,
    sidewalks: true, streets: true, poi: true, satellite: false,
  },
};

export const layerState = {
  autoBuildings: true,
  apartments: true,
  towers: true,
  parks: true,
  sidewalks: true,
  streets: true,
  poi: true,
  satellite: true,
};

export function resetLayerDefaultsForLayout(layoutId) {
  const preset = layoutId === 'satellite' ? LAYER_PRESETS.satellite : LAYER_PRESETS.standard;
  Object.assign(layerState, preset);
  syncLayerToggleButtons();
}

export function syncLayerToggleButtons() {
  if (!ctx.dom.mapLayerToggles) return;
  const btns = ctx.dom.mapLayerToggles.querySelectorAll('[data-layer]');
  for (let i = 0; i < btns.length; i++) {
    const key = btns[i].getAttribute('data-layer');
    const on = !!layerState[key];
    btns[i].classList.toggle('map-layer-btn--active', on);
    btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    if (key === 'satellite') {
      const isSat = ctx.currentLayout === 'satellite';
      btns[i].classList.toggle('map-layer-btn--disabled', !isSat);
    }
  }
}

export function applyLayerVisibility() {
  const canvas = ctx.dom.cityCanvas;
  if (!canvas) return;

  canvas.classList.toggle('layer-hide-auto-buildings', !layerState.autoBuildings);
  canvas.classList.toggle('layer-hide-apartments', !layerState.apartments);
  canvas.classList.toggle('layer-hide-towers', !layerState.towers);
  canvas.classList.toggle('layer-hide-parks', !layerState.parks);
  canvas.classList.toggle('layer-hide-sidewalks', !layerState.sidewalks);
  canvas.classList.toggle('layer-hide-streets', !layerState.streets);
  canvas.classList.toggle('layer-hide-poi', !layerState.poi);
  canvas.classList.toggle('layer-hide-satellite', !layerState.satellite);

  const getLayout = ctx.api.getLayout;
  const isSatelliteLayout = ctx.api.isSatelliteLayout;
  if (getLayout && isSatelliteLayout && isSatelliteLayout(getLayout(ctx.currentLayout))) {
    if (ctx.dom.satelliteBgLayer) {
      ctx.dom.satelliteBgLayer.style.backgroundImage = layerState.satellite
        ? `url('${SATELLITE_BG_URL}')`
        : 'none';
    }
  }
}

export function toggleLayerVisibility(key) {
  if (key === 'satellite' && ctx.currentLayout !== 'satellite') return;
  layerState[key] = !layerState[key];
  syncLayerToggleButtons();
  applyLayerVisibility();
}

export function initLayerControls() {
  syncLayerToggleButtons();
  applyLayerVisibility();
}

export function bindMapLayerToggles() {
  if (!ctx.dom.mapLayerToggles) return;
  ctx.dom.mapLayerToggles.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-layer]');
    if (!btn || btn.classList.contains('map-layer-btn--disabled')) return;
    toggleLayerVisibility(btn.getAttribute('data-layer'));
  });
}

/** Used by applyLayoutCanvas in main */
export function getLayerState() {
  return layerState;
}
