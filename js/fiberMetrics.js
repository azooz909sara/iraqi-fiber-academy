/**
 * Fiber geometry, distance, BOQ, and loss-calculation prep.
 */
import { ctx } from './simContext.js';

/** Field scale: one grid cell ≈ 10 m (50 px cell → 10 m). */
export const METERS_PER_CELL = 10;

export function getNodeCenter(node, cellSize) {
  if (!node) return null;
  const cs = cellSize != null ? cellSize : ctx.CELL_SIZE;
  if (node.free && node.px != null && node.py != null) {
    return { x: node.px, y: node.py };
  }
  return {
    x: node.col * cs + cs / 2,
    y: node.row * cs + cs / 2,
  };
}

export function pixelDistance(a, b) {
  if (!a || !b) return 0;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function pixelsToMeters(pixels, cellSize, metersPerCell) {
  const cs = cellSize != null ? cellSize : ctx.CELL_SIZE;
  const mpc = metersPerCell != null ? metersPerCell : METERS_PER_CELL;
  return pixels * (mpc / cs);
}

export function connectionLengthMeters(fromNode, toNode, cellSize, metersPerCell) {
  const a = getNodeCenter(fromNode, cellSize);
  const b = getNodeCenter(toNode, cellSize);
  if (!a || !b) return 0;
  return pixelsToMeters(pixelDistance(a, b), cellSize, metersPerCell);
}

/**
 * @returns {{ totalMeters: number, segments: Array<{ id, from, to, meters, cable, fibers }> }}
 */
export function calculateFiberMetrics(nodes, connections, cellSize, metersPerCell) {
  const nodeMap = {};
  for (let i = 0; i < nodes.length; i++) nodeMap[nodes[i].id] = nodes[i];

  const segments = [];
  let totalMeters = 0;

  for (let j = 0; j < connections.length; j++) {
    const c = connections[j];
    const fromNode = nodeMap[c.from];
    const toNode = nodeMap[c.to];
    if (!fromNode || !toNode) continue;
    const meters = connectionLengthMeters(fromNode, toNode, cellSize, metersPerCell);
    totalMeters += meters;
    segments.push({
      id: c.id,
      from: c.from,
      to: c.to,
      meters: Math.round(meters * 10) / 10,
      cable: c.cable || 'standard',
      fibers: c.fibers || null,
    });
  }

  return { totalMeters: Math.round(totalMeters * 10) / 10, segments };
}

export function formatFiberLength(meters) {
  if (meters >= 1000) return (Math.round(meters / 10) / 100).toFixed(2) + ' km';
  return Math.round(meters * 10) / 10 + ' m';
}

/** BOQ / bill-of-quantities prep — extensible for future export. */
export function buildFiberBoq(nodes, connections, cellSize, metersPerCell) {
  const metrics = calculateFiberMetrics(nodes, connections, cellSize, metersPerCell);
  const equipmentCounts = {};
  for (let i = 0; i < nodes.length; i++) {
    const t = nodes[i].type;
    equipmentCounts[t] = (equipmentCounts[t] || 0) + 1;
  }
  const cableByType = {};
  for (let s = 0; s < metrics.segments.length; s++) {
    const seg = metrics.segments[s];
    const key = seg.cable + (seg.fibers ? '_' + seg.fibers + 'f' : '');
    if (!cableByType[key]) cableByType[key] = { cable: seg.cable, fibers: seg.fibers, meters: 0, count: 0 };
    cableByType[key].meters += seg.meters;
    cableByType[key].count += 1;
  }
  return {
    generatedAt: new Date().toISOString(),
    totalFiberMeters: metrics.totalMeters,
    totalFiberFormatted: formatFiberLength(metrics.totalMeters),
    segments: metrics.segments,
    equipmentCounts,
    cableByType,
    /** Reserved for loss budget (dB) per segment — future OTDR integration */
    lossBudget: null,
  };
}

/** Reserved API for future optical loss calculations. */
export function estimateSegmentLoss(_segment, _cableCatalog) {
  return { lossDb: null, note: 'Loss calculation — future implementation' };
}

/** Haversine great-circle distance in meters (WGS84). */
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = function (d) { return d * Math.PI / 180; };
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Total path length along vertex chain (meters). */
export function haversinePathMeters(path) {
  if (!path || path.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += haversineMeters(path[i - 1].lat, path[i - 1].lng, path[i].lat, path[i].lng);
  }
  return total;
}

export function gisConnectionLengthMeters(fromEq, toEq) {
  if (!fromEq || !toEq) return 0;
  return haversineMeters(fromEq.lat, fromEq.lng, toEq.lat, toEq.lng);
}

/**
 * @returns {{ totalMeters: number, totalFormatted: string, segments: Array }}
 */
export function calculateGisFiberMetrics(equipment, connections) {
  const eqMap = {};
  for (let i = 0; i < equipment.length; i++) eqMap[equipment[i].id] = equipment[i];

  const segments = [];
  let totalMeters = 0;

  for (let j = 0; j < connections.length; j++) {
    const c = connections[j];
    let meters = 0;
    if (c.path && c.path.length >= 2) {
      meters = c.lengthMeters != null ? c.lengthMeters : haversinePathMeters(c.path);
    } else {
      const fromEq = eqMap[c.from];
      const toEq = eqMap[c.to];
      if (!fromEq || !toEq) continue;
      meters = gisConnectionLengthMeters(fromEq, toEq);
    }
    const fromEq = eqMap[c.from];
    const toEq = eqMap[c.to];
    if (!fromEq) continue;
    totalMeters += meters;
    segments.push({
      id: c.id,
      from: c.from,
      to: c.to,
      meters: Math.round(meters * 10) / 10,
      cable: c.cable || 'standard',
      fibers: c.fibers || null,
      path: c.path || null,
      fromLat: fromEq.lat,
      fromLng: fromEq.lng,
      toLat: toEq ? toEq.lat : (c.path && c.path.length ? c.path[c.path.length - 1].lat : fromEq.lat),
      toLng: toEq ? toEq.lng : (c.path && c.path.length ? c.path[c.path.length - 1].lng : fromEq.lng),
    });
  }

  const total = Math.round(totalMeters * 10) / 10;
  return {
    totalMeters: total,
    totalFormatted: formatFiberLength(total),
    segments,
  };
}

/** BOQ for GIS designs — real-world coordinates. */
export function buildGisFiberBoq(equipment, connections) {
  const metrics = calculateGisFiberMetrics(equipment, connections);
  const equipmentCounts = {};
  for (let i = 0; i < equipment.length; i++) {
    const t = equipment[i].type;
    equipmentCounts[t] = (equipmentCounts[t] || 0) + 1;
  }
  const cableByType = {};
  for (let s = 0; s < metrics.segments.length; s++) {
    const seg = metrics.segments[s];
    const key = seg.cable + (seg.fibers ? '_' + seg.fibers + 'f' : '');
    if (!cableByType[key]) cableByType[key] = { cable: seg.cable, fibers: seg.fibers, meters: 0, count: 0 };
    cableByType[key].meters += seg.meters;
    cableByType[key].count += 1;
  }
  return {
    generatedAt: new Date().toISOString(),
    coordinateSystem: 'WGS84',
    totalFiberMeters: metrics.totalMeters,
    totalFiberFormatted: metrics.totalFormatted,
    segments: metrics.segments,
    equipmentCounts,
    cableByType,
    lossBudget: null,
  };
}
