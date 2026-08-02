/**
 * GIS project metadata — Baghdad planning, compounds, housing projects (stub).
 */
import { ctx } from './simContext.js';

export const PROJECT_TYPES = {
  BAGHDAD_CITY: 'baghdad_city',
  RESIDENTIAL_COMPOUND: 'residential_compound',
  HOUSING_PROJECT: 'housing_project',
  INFRASTRUCTURE: 'infrastructure',
};

/** Default center: Baghdad */
export const DEFAULT_GIS_CENTER = { lat: 33.3152, lng: 44.3661, zoom: 12 };

/** Permanent ITPC Exchange footprint (lat/lng bounds) — OLT placement restricted here. */
export const ITPC_GIS_BOUNDS = {
  label: 'ITPC Exchange Building',
  southWest: { lat: 33.3140, lng: 44.3648 },
  northEast: { lat: 33.3164, lng: 44.3676 },
};

export function getItpcLatLngBounds() {
  const b = ITPC_GIS_BOUNDS;
  return L.latLngBounds(
    [b.southWest.lat, b.southWest.lng],
    [b.northEast.lat, b.northEast.lng]
  );
}

export function isInsideItpcBounds(lat, lng) {
  const b = ITPC_GIS_BOUNDS;
  return lat >= b.southWest.lat && lat <= b.northEast.lat &&
    lng >= b.southWest.lng && lng <= b.northEast.lng;
}

export function createGisProject(type, name) {
  return {
    id: 'gis_' + Date.now(),
    type: type || PROJECT_TYPES.BAGHDAD_CITY,
    name: name || 'Untitled FTTH Project',
    region: 'Baghdad',
    createdAt: new Date().toISOString(),
    center: Object.assign({}, DEFAULT_GIS_CENTER),
    layers: {
      cabinets: [],
      handholes: [],
      closures: [],
      poles: [],
      splitters: [],
      olt: [],
      fiberCables: [],
    },
    metadata: {},
  };
}

export function getDefaultGisProject() {
  if (!ctx.gisProject) {
    ctx.gisProject = createGisProject(PROJECT_TYPES.BAGHDAD_CITY, 'Baghdad FTTH Planning');
  }
  return ctx.gisProject;
}

export function registerGisProject() {
  ctx.api.gisProject = {
    create: createGisProject,
    get: getDefaultGisProject,
    PROJECT_TYPES,
    DEFAULT_GIS_CENTER,
  };
}
