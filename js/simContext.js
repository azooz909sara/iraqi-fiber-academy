/**
 * Shared simulator state — imported by all modules.
 */
export const ctx = {
  dom: {},
  nodes: [],
  connections: [],
  nodeId: 0,
  connId: 0,
  connectMode: false,
  connectFrom: null,
  currentLayout: 'residential',
  toolboxVals: {},
  zoomLevel: 1,
  toolboxCollapsed: false,
  evalCollapsed: false,
  activeCable: null,
  selectedCableId: 'cable_ftth',
  suppressCableClick: false,
  previewMouse: { x: 0, y: 0 },
  hasPreviewMouse: false,
  panX: 0,
  panY: 0,
  isPanning: false,
  panSession: null,
  ZOOM_MIN: 0.08,
  ZOOM_MAX: 10,
  mapInteractionMode: 'select',
  selectedToolboxType: null,
  quickAddTarget: null,
  previewRaf: 0,
  touchContextTimer: null,
  contextMenuNodeId: null,
  lastDragOverCell: null,
  gridDnDBound: false,
  GRID_COLS: 100,
  GRID_ROWS: 100,
  CELL_SIZE: 50,
  MAP_W: 5000,
  MAP_H: 5000,
  LAYOUTS: {},
  /** Map workspace: 'virtual' | 'osm' */
  mapMode: 'virtual',
  selectedNodeId: null,
  osmView: null,
  gisProject: null,
  gisEquipment: [],
  gisConnections: [],
  gisNodeId: 0,
  gisConnId: 0,
  gisConnectMode: false,
  gisConnectFrom: null,
  selectedGisId: null,
  /** Active GIS target point (click-first workflow) */
  activeLatLng: null,
  /** Field topology — primary target for asset injection & routes */
  activeTopologyPoint: null,
  topologyNodes: [],
  topologyRoutes: [],
  topologyChainLastId: null,
  topologyNodeId: 0,
  topologyRouteId: 0,
  /** 'underground' | 'aerial' | null */
  gisRouteMode: null,
  gisWorkspaceBounds: null,
  gisZoneMode: false,
  gisZoneDraft: null,
  gisNetworkZones: [],
  gisZoneId: 0,
  /** Show/hide frozen Network Zone shadow overlay on OSM map */
  gisZoneShadowVisible: true,
  gisCableArmed: null,
  gisCableDraw: null,
  gisCursorCoords: null,
  /** Runtime callbacks registered by mainSimulator */
  api: {},
};

export const GRID_CFG_STANDARD = { cols: 100, rows: 100, cell: 50 };
export const GRID_CFG_SATELLITE = { cols: 120, rows: 120, cell: 50 };
export const SIDEWALK_EQUIPMENT = { pole_foundation: true, handhole: true, fdt: true };
export const PLACEMENT_ERR_SIDEWALK = 'Placement Error: Equipment must be installed on the sidewalk only';
export const CONTEXT_MENU_TYPES = { pole_foundation: true, handhole: true, fdt: true };
export const SATELLITE_BG_URL = 'images/satellite-bg.jpg';
export const ITPC_BLOCK = { type: 'itpc', c0: 5, r0: 5, c1: 7, r1: 7, label: 'ITPC Exchange' };

export function applyGridDimensions(layoutId) {
  const cfg = layoutId === 'satellite' ? GRID_CFG_SATELLITE : GRID_CFG_STANDARD;
  ctx.GRID_COLS = cfg.cols;
  ctx.GRID_ROWS = cfg.rows;
  ctx.CELL_SIZE = cfg.cell;
  ctx.MAP_W = ctx.GRID_COLS * ctx.CELL_SIZE;
  ctx.MAP_H = ctx.GRID_ROWS * ctx.CELL_SIZE;
}
