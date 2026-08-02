/**
 * Future cable routing, path planning, and loss architecture (stub).
 * Virtual City simulator continues using SVG lines in mainSimulator.
 */
import { ctx } from './simContext.js';
import { calculateFiberMetrics, estimateSegmentLoss } from './fiberMetrics.js';

export const CABLE_MODES = {
  DIRECT: 'direct',
  ROUTED: 'routed',
  TRENCH: 'trench',
};

/** @typedef {{ id: string, mode: string, waypoints: Array<{x,y}|{lat,lng}>, fibers: number|null, cableType: string }} CableRoute */

export function createCableRoute(fromId, toId, mode) {
  return {
    id: 'route_' + Date.now(),
    fromId,
    toId,
    mode: mode || CABLE_MODES.DIRECT,
    waypoints: [],
    fibers: null,
    cableType: 'standard',
    lossDb: null,
    lengthMeters: null,
  };
}

/** Placeholder — future street-following route planner */
export function planRoute(_fromNode, _toNode, _options) {
  return {
    waypoints: [],
    lengthMeters: null,
    note: 'Route planning — future GIS / OSM integration',
  };
}

export function buildCableReport(nodes, connections) {
  const metrics = calculateFiberMetrics(nodes, connections, ctx.CELL_SIZE);
  const segments = metrics.segments.map(function (seg) {
    return Object.assign({}, seg, estimateSegmentLoss(seg, null));
  });
  return {
    mode: ctx.mapMode || 'virtual',
    segmentCount: segments.length,
    totalMeters: metrics.totalMeters,
    segments,
    routingEngine: 'direct-svg',
    futureFeatures: ['routed-paths', 'trench-mode', 'splice-loss', 'otdr-trace'],
  };
}

export function registerCableEngine() {
  ctx.api.cableEngine = {
    createCableRoute,
    planRoute,
    buildCableReport,
    CABLE_MODES,
  };
}
