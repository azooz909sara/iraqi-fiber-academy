/**
 * GIS equipment & connection state — isolated from Virtual City nodes.
 */
import { ctx } from './simContext.js';
import { isGisPlaceable } from './gisEquipmentTypes.js';

export function initGisStore() {
  if (!ctx.gisEquipment) ctx.gisEquipment = [];
  if (!ctx.gisConnections) ctx.gisConnections = [];
  if (ctx.gisNodeId == null) ctx.gisNodeId = 0;
  if (ctx.gisConnId == null) ctx.gisConnId = 0;
  if (ctx.gisConnectFrom == null) ctx.gisConnectFrom = null;
  if (ctx.gisConnectMode == null) ctx.gisConnectMode = false;
  if (ctx.selectedGisId == null) ctx.selectedGisId = null;
}

export function findGisEquipment(id) {
  for (let i = 0; i < ctx.gisEquipment.length; i++) {
    if (ctx.gisEquipment[i].id === id) return ctx.gisEquipment[i];
  }
  return null;
}

export function findNearestGisEquipment(lat, lng, maxDelta) {
  const max = maxDelta != null ? maxDelta : 0.0005;
  let best = null;
  let bestD = max;
  for (let i = 0; i < ctx.gisEquipment.length; i++) {
    const eq = ctx.gisEquipment[i];
    const dLat = Math.abs(eq.lat - lat);
    const dLng = Math.abs(eq.lng - lng);
    const d = dLat + dLng;
    if (d < bestD) {
      bestD = d;
      best = eq;
    }
  }
  return best;
}

export function countGisByType(type) {
  let n = 0;
  for (let i = 0; i < ctx.gisEquipment.length; i++) {
    if (ctx.gisEquipment[i].type === type) n++;
  }
  return n;
}

export function createGisEquipment(type, lat, lng, variant) {
  if (!isGisPlaceable(type)) return null;
  ctx.gisNodeId += 1;
  return {
    id: 'g' + ctx.gisNodeId,
    type,
    lat,
    lng,
    variant: variant || null,
    meta: {},
    locked: false,
    createdAt: new Date().toISOString(),
  };
}

export function addGisEquipment(equipment) {
  ctx.gisEquipment.push(equipment);
  return equipment;
}

export function removeGisEquipment(id) {
  for (let i = ctx.gisEquipment.length - 1; i >= 0; i--) {
    if (ctx.gisEquipment[i].id === id) ctx.gisEquipment.splice(i, 1);
  }
  for (let j = ctx.gisConnections.length - 1; j >= 0; j--) {
    if (ctx.gisConnections[j].from === id || ctx.gisConnections[j].to === id) {
      ctx.gisConnections.splice(j, 1);
    }
  }
  if (ctx.selectedGisId === id) ctx.selectedGisId = null;
  if (ctx.gisConnectFrom === id) ctx.gisConnectFrom = null;
}

export function addGisConnection(fromId, toId, cable, fibers) {
  ctx.gisConnId += 1;
  const conn = {
    id: 'gc' + ctx.gisConnId,
    from: fromId,
    to: toId,
    cable: cable || 'standard',
    fibers: fibers || null,
    path: null,
    lengthMeters: null,
  };
  ctx.gisConnections.push(conn);
  return conn;
}

export function addGisPathConnection(opts) {
  ctx.gisConnId += 1;
  const conn = {
    id: 'gc' + ctx.gisConnId,
    from: opts.from,
    to: opts.to,
    cable: opts.cable || 'cable_ftth',
    fibers: opts.fibers || null,
    path: opts.path ? JSON.parse(JSON.stringify(opts.path)) : null,
    lengthMeters: opts.lengthMeters != null ? opts.lengthMeters : null,
  };
  ctx.gisConnections.push(conn);
  return conn;
}

export function clearGisDesign() {
  ctx.gisEquipment.length = 0;
  ctx.gisConnections.length = 0;
  ctx.gisNodeId = 0;
  ctx.gisConnId = 0;
  ctx.gisConnectFrom = null;
  ctx.gisConnectMode = false;
  ctx.selectedGisId = null;
}

export function serializeGisState() {
  return {
    gisEquipment: JSON.parse(JSON.stringify(ctx.gisEquipment)),
    gisConnections: JSON.parse(JSON.stringify(ctx.gisConnections)),
    gisNodeId: ctx.gisNodeId,
    gisConnId: ctx.gisConnId,
    selectedGisId: ctx.selectedGisId,
  };
}

export function restoreGisState(data) {
  clearGisDesign();
  if (!data) return;
  const eq = data.gisEquipment || [];
  const cn = data.gisConnections || [];
  for (let i = 0; i < eq.length; i++) ctx.gisEquipment.push(JSON.parse(JSON.stringify(eq[i])));
  for (let j = 0; j < cn.length; j++) ctx.gisConnections.push(JSON.parse(JSON.stringify(cn[j])));
  ctx.gisNodeId = data.gisNodeId || 0;
  ctx.gisConnId = data.gisConnId || 0;
  ctx.selectedGisId = data.selectedGisId || null;
}
