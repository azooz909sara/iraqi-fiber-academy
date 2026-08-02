/**
 * Node Properties Panel — extensible metadata display.
 */
import { ctx } from './simContext.js';
import { getNodeCenter } from './fiberMetrics.js';
import { getGisTypeLabel } from './gisEquipmentTypes.js';
import { findGisEquipment } from './gisStore.js';
import { calculateGisFiberMetrics } from './fiberMetrics.js';

const TYPE_LABELS = {
  olt: 'OLT',
  splitter: 'Splitter',
  fdt: 'FDT Cabinet',
  pole_foundation: 'Pole Foundation',
  pole: 'Pole',
  handhole: 'Handhole',
  closure: 'Closure',
  ont: 'ONT',
  home: 'Home',
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getNodeStatus(node) {
  if (!node) return '—';
  if (node.locked) return 'Locked';
  if (node.type === 'pole_foundation') {
    const parts = [];
    if (node.hasPole) parts.push('Pole mounted');
    if (node.hasClosure) parts.push('Closure installed');
    if (node.fatSplitter) parts.push('FAT ' + node.fatSplitter);
    return parts.length ? parts.join(' · ') : 'Foundation only';
  }
  if (node.type === 'handhole' && node.hasClosure) return 'Handhole + Closure';
  const linked = ctx.connections.some(function (c) {
    return c.from === node.id || c.to === node.id;
  });
  if (linked) return 'Connected';
  return 'Placed';
}

function getGisConnectedLinks(equipmentId) {
  const links = [];
  for (let i = 0; i < ctx.gisConnections.length; i++) {
    const c = ctx.gisConnections[i];
    if (c.from !== equipmentId && c.to !== equipmentId) continue;
    const otherId = c.from === equipmentId ? c.to : c.from;
    const other = findGisEquipment(otherId);
    links.push({
      id: c.id,
      peerId: otherId,
      peerType: other ? other.type : '?',
      cable: c.cable || 'standard',
    });
  }
  return links;
}

function getGisLinkDistances(equipmentId) {
  const metrics = calculateGisFiberMetrics(ctx.gisEquipment, ctx.gisConnections);
  return metrics.segments.filter(function (s) {
    return s.from === equipmentId || s.to === equipmentId;
  });
}

export function showGisPropertyPanel(equipmentId) {
  ctx.selectedGisId = equipmentId || null;
  ctx.selectedNodeId = null;
  const panel = document.getElementById('property-panel');
  const body = document.getElementById('property-panel-body');
  if (!panel || !body) return;

  if (!equipmentId) {
    panel.classList.add('property-panel--empty');
    body.innerHTML = '<p class="prop-panel__hint text-slate-500 text-[11px]">Select equipment on the map to inspect GIS properties.</p>';
    return;
  }

  const eq = findGisEquipment(equipmentId);
  if (!eq) {
    showGisPropertyPanel(null);
    return;
  }

  panel.classList.remove('property-panel--empty');
  const links = getGisConnectedLinks(equipmentId);
  const distSegs = getGisLinkDistances(equipmentId);
  const typeLabel = getGisTypeLabel(eq.type);
  const variantLine = eq.variant
    ? '<div class="prop-row"><span class="prop-label">Variant</span><span class="prop-value font-mono">' + escapeHtml(eq.variant) + '</span></div>'
    : '';

  let linksHtml;
  if (!links.length) {
    linksHtml = '<p class="prop-panel__empty">No connections</p>';
  } else {
    linksHtml = '<ul class="prop-links">' + links.map(function (l) {
      const seg = distSegs.find(function (s) { return s.id === l.id; });
      const dist = seg ? ' · ' + seg.meters + ' m' : '';
      return '<li><span class="font-mono text-fiber-cyan">' + escapeHtml(l.peerId) + '</span> ' +
        '<span class="text-slate-500">(' + escapeHtml(l.peerType) + ')</span> · ' +
        escapeHtml(l.cable) + dist + '</li>';
    }).join('') + '</ul>';
  }

  body.innerHTML =
    '<div class="prop-row"><span class="prop-label">Mode</span><span class="prop-value text-fiber-cyan">GIS / OpenStreetMap</span></div>' +
    '<div class="prop-row"><span class="prop-label">ID</span><span class="prop-value font-mono text-fiber-cyan">' + escapeHtml(eq.id) + '</span></div>' +
    '<div class="prop-row"><span class="prop-label">Type</span><span class="prop-value">' + escapeHtml(typeLabel) + '</span></div>' +
    variantLine +
    '<div class="prop-row"><span class="prop-label">Status</span><span class="prop-value">' + (eq.locked ? 'Locked' : 'Placed') + '</span></div>' +
    '<div class="prop-row"><span class="prop-label">Latitude</span><span class="prop-value font-mono">' + eq.lat.toFixed(6) + '</span></div>' +
    '<div class="prop-row"><span class="prop-label">Longitude</span><span class="prop-value font-mono">' + eq.lng.toFixed(6) + '</span></div>' +
    '<div class="prop-section"><p class="prop-section__title">Connected Links</p>' + linksHtml + '</div>' +
    '<div class="prop-section prop-section--future"><p class="prop-section__title">Extended Metadata</p>' + renderMetadata(eq) + '</div>' +
    '<div class="prop-section"><button type="button" id="btn-gis-delete-equipment" class="w-full mt-2 py-1.5 text-[10px] font-semibold rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10">Remove Equipment</button></div>';

  const delBtn = document.getElementById('btn-gis-delete-equipment');
  if (delBtn) {
    delBtn.addEventListener('click', function () {
      if (ctx.api.deleteGisEquipment) ctx.api.deleteGisEquipment(equipmentId);
      showGisPropertyPanel(null);
    });
  }
}

export function clearGisPropertyPanel() {
  showGisPropertyPanel(null);
}

function getConnectedLinks(nodeId) {
  const links = [];
  for (let i = 0; i < ctx.connections.length; i++) {
    const c = ctx.connections[i];
    if (c.from !== nodeId && c.to !== nodeId) continue;
    const otherId = c.from === nodeId ? c.to : c.from;
    const other = ctx.api.findNode ? ctx.api.findNode(otherId) : null;
    links.push({
      id: c.id,
      peerId: otherId,
      peerType: other ? other.type : '?',
      cable: c.cable || 'standard',
    });
  }
  return links;
}

function formatPosition(node) {
  const center = getNodeCenter(node, ctx.CELL_SIZE);
  if (node.free && node.px != null) {
    return 'Free (' + Math.round(node.px) + ', ' + Math.round(node.py) + ') px';
  }
  return 'Grid [' + node.col + ', ' + node.row + '] · center (' +
    Math.round(center.x) + ', ' + Math.round(center.y) + ') px';
}

function renderMetadata(node) {
  if (!node.meta || typeof node.meta !== 'object') {
    return '<p class="prop-panel__empty">No extended metadata</p>';
  }
  const keys = Object.keys(node.meta);
  if (!keys.length) return '<p class="prop-panel__empty">No extended metadata</p>';
  return keys.map(function (k) {
    return '<div class="prop-row"><span class="prop-label">' + escapeHtml(k) + '</span>' +
      '<span class="prop-value font-mono">' + escapeHtml(String(node.meta[k])) + '</span></div>';
  }).join('');
}

export function showPropertyPanel(nodeId) {
  if (ctx.mapMode === 'osm') {
    showGisPropertyPanel(nodeId);
    return;
  }
  ctx.selectedNodeId = nodeId || null;
  ctx.selectedGisId = null;
  const panel = document.getElementById('property-panel');
  const body = document.getElementById('property-panel-body');
  if (!panel || !body) return;

  if (!nodeId) {
    panel.classList.add('property-panel--empty');
    body.innerHTML = '<p class="prop-panel__hint text-slate-500 text-[11px]">Select a component on the map to inspect properties.</p>';
    return;
  }

  const node = ctx.api.findNode ? ctx.api.findNode(nodeId) : null;
  if (!node) {
    showPropertyPanel(null);
    return;
  }

  panel.classList.remove('property-panel--empty');
  const links = getConnectedLinks(nodeId);
  const typeLabel = TYPE_LABELS[node.type] || node.type;
  const variantLine = node.variant
    ? '<div class="prop-row"><span class="prop-label">Variant</span><span class="prop-value font-mono">' + escapeHtml(node.variant) + '</span></div>'
    : '';

  let linksHtml;
  if (!links.length) {
    linksHtml = '<p class="prop-panel__empty">No connections</p>';
  } else {
    linksHtml = '<ul class="prop-links">' + links.map(function (l) {
      return '<li><span class="font-mono text-fiber-cyan">' + escapeHtml(l.peerId) + '</span> ' +
        '<span class="text-slate-500">(' + escapeHtml(l.peerType) + ')</span> · ' +
        escapeHtml(l.cable) + '</li>';
    }).join('') + '</ul>';
  }

  body.innerHTML =
    '<div class="prop-row"><span class="prop-label">ID</span><span class="prop-value font-mono text-fiber-cyan">' + escapeHtml(node.id) + '</span></div>' +
    '<div class="prop-row"><span class="prop-label">Type</span><span class="prop-value">' + escapeHtml(typeLabel) + '</span></div>' +
    variantLine +
    '<div class="prop-row"><span class="prop-label">Status</span><span class="prop-value">' + escapeHtml(getNodeStatus(node)) + '</span></div>' +
    '<div class="prop-row prop-row--stack"><span class="prop-label">Position</span><span class="prop-value font-mono text-[10px]">' + escapeHtml(formatPosition(node)) + '</span></div>' +
    '<div class="prop-section"><p class="prop-section__title">Connected Links</p>' + linksHtml + '</div>' +
    '<div class="prop-section prop-section--future"><p class="prop-section__title">Extended Metadata</p>' + renderMetadata(node) + '</div>';
}

export function clearPropertyPanel() {
  if (ctx.mapMode === 'osm') {
    clearGisPropertyPanel();
    return;
  }
  showPropertyPanel(null);
}

export function initPropertyPanel() {
  showPropertyPanel(null);
}
