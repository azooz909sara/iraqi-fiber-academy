/**
 * GIS cable connections — delegates to dynamic path routing in OSM mode.
 */
import { ctx } from './simContext.js';
import { findGisEquipment, findNearestGisEquipment } from './gisStore.js';
import { renderGisConnections } from './gisMapRenderer.js';
import { calculateGisFiberMetrics } from './fiberMetrics.js';
import {
  armGisCable, disarmGisCable, cancelCableDraw, isCableDrawActive,
  handleGisCableEquipmentClick, startCableDrawFromEquipment,
} from './gisCableRouting.js';

export function setGisConnectMode(on) {
  if (on) {
    armGisCable(ctx.selectedCableId || 'cable_ftth');
  } else {
    disarmGisCable();
  }
  updateGisConnectUI();
  if (ctx.api.updateGisStatusBar) ctx.api.updateGisStatusBar();
}

export function toggleGisConnectMode() {
  setGisConnectMode(!ctx.gisCableArmed && !isCableDrawActive());
}

function updateGisConnectUI() {
  const btn = document.getElementById('btn-connect-mode');
  if (!btn || ctx.mapMode !== 'osm') return;
  const active = !!ctx.gisCableArmed || isCableDrawActive();
  btn.classList.toggle('border-fiber-cyan', active);
  btn.classList.toggle('text-fiber-cyan', active);
  btn.textContent = isCableDrawActive() ? '🔗 Routing…' : (active ? '🔗 Cable Armed' : '🔗 Cable Mode');
}

export function handleGisEquipmentClick(id) {
  if (handleGisCableEquipmentClick(id)) return;

  if (ctx.gisCableArmed && !isCableDrawActive()) {
    startCableDrawFromEquipment(id);
    return;
  }

  if (ctx.api.selectGisEquipment) ctx.api.selectGisEquipment(id);
}

export function linkGisEquipment(fromId, toId) {
  const a = findGisEquipment(fromId);
  const b = findGisEquipment(toId);
  if (!a || !b) return false;
  startCableDrawFromEquipment(fromId);
  if (ctx.api.toast) ctx.api.toast('Route to target — click corners, right-click to finish', 'success');
  return true;
}

export function updateGisMetrics() {
  const metrics = calculateGisFiberMetrics(ctx.gisEquipment, ctx.gisConnections);
  const setText = function (id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  setText('metric-components', ctx.gisEquipment.length);
  setText('metric-connections', ctx.gisConnections.length);
  setText('metric-length', metrics.totalFormatted);
  const olt = ctx.gisEquipment.find(function (e) { return e.type === 'olt'; });
  const oltEl = document.getElementById('metric-olt');
  if (oltEl) {
    if (!olt) {
      oltEl.textContent = 'Missing';
      oltEl.className = 'font-mono text-red-400';
    } else {
      const linked = ctx.gisConnections.some(function (c) {
        return c.from === olt.id || c.to === olt.id;
      });
      oltEl.textContent = linked ? 'Connected' : 'Isolated';
      oltEl.className = 'font-mono ' + (linked ? 'text-fiber-phosphor' : 'text-yellow-400');
    }
  }
  setText('metric-homes', '—');
}

export function bindGisConnectButton() {
  const btn = document.getElementById('btn-connect-mode');
  if (!btn || btn._gisBound) return;
  btn._gisBound = true;
  btn.addEventListener('click', function (e) {
    if (ctx.mapMode === 'osm') {
      e.stopImmediatePropagation();
      toggleGisConnectMode();
    }
  }, true);
}

export { disarmGisCable as disarmGisCableExport, cancelCableDraw };
