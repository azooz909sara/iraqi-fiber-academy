/**
 * GIS equipment type definitions — maps toolbox types to OSM layers.
 */
export const GIS_PLACEABLE_TYPES = {
  olt: { label: 'OLT', layerId: 'olt', max: 8, color: '#1e40af' },
  fdt: { label: 'Cabinet (FDT)', layerId: 'cabinets', max: 48, color: '#f59e0b' },
  handhole: { label: 'Handhole', layerId: 'handholes', max: 80, color: '#94a3b8' },
  closure: { label: 'Closure', layerId: 'closures', max: 80, color: '#ef4444' },
  pole: { label: 'Pole', layerId: 'poles', max: 80, color: '#eab308' },
  pole_foundation: { label: 'Pole Foundation', layerId: 'poles', max: 80, color: '#64748b' },
  splitter: { label: 'Splitter', layerId: 'splitters', max: 32, color: '#8b5cf6' },
};

export const GIS_CABLE_TYPES = {
  cable_ftth: { label: 'FTTH Main Cable', color: '#3b82f6' },
  cable_lastmile: { label: 'Last Mile Cable', color: '#f59e0b' },
  standard: { label: 'Standard', color: '#00e5ff' },
};

export function isGisPlaceable(type) {
  return GIS_PLACEABLE_TYPES[type] != null;
}

export function getGisLayerId(type) {
  const def = GIS_PLACEABLE_TYPES[type];
  return def ? def.layerId : 'handholes';
}

export function getGisTypeLabel(type) {
  const def = GIS_PLACEABLE_TYPES[type];
  return def ? def.label : type;
}
