/**
 * Custom Leaflet divIcon markers — distinct asset shapes/colors per FTTH type.
 */
import { getGisTypeLabel } from './gisEquipmentTypes.js';

let _iconZoom = 12;

export function setGisIconZoom(zoom) {
  _iconZoom = zoom;
}

export function getGisIconScale(zoom) {
  const z = zoom != null ? zoom : _iconZoom;
  return Math.max(0.55, Math.min(1.35, 0.45 + (z - 10) * 0.08));
}

function shell(inner, size, scale, shapeStyle) {
  const s = Math.round((size || 34) * scale);
  return '<div class="gis-marker" style="width:' + s + 'px;height:' + s + 'px;display:flex;align-items:center;justify-content:center;' +
    'box-shadow:0 2px 10px rgba(0,0,0,0.4);' + shapeStyle + '">' + inner + '</div>';
}

const ICON_BUILDERS = {
  /** Purple square — ITPC OLT */
  olt: function (scale) {
    const s = Math.round(34 * scale);
    return shell('', s, 1,
      'background:#7c3aed;border:2px solid #a78bfa;border-radius:4px;');
  },
  /** Orange triangle — FDT / Cabinet */
  fdt: function (scale) {
    const s = Math.round(36 * scale);
    return shell(
      '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24"><polygon points="12,3 22,21 2,21" fill="#f59e0b" stroke="#fb923c" stroke-width="1.5"/></svg>',
      s, 1, 'background:transparent;border:none;box-shadow:none;'
    );
  },
  /** Green square — Handhole */
  handhole: function (scale) {
    const s = Math.round(32 * scale);
    return shell('', s, 1,
      'background:#16a34a;border:3px solid #4ade80;border-radius:3px;');
  },
  closure: function (scale) {
    const s = Math.round(30 * scale);
    return shell('', s, 1,
      'background:#ef4444;border:2px solid #fca5a5;border-radius:3px;');
  },
  /** Blue circle — Pole */
  pole: function (scale) {
    const s = Math.round(28 * scale);
    return shell('', s, 1,
      'background:#2563eb;border:2px solid #60a5fa;border-radius:50%;');
  },
  pole_foundation: function (scale) {
    const s = Math.round(26 * scale);
    return shell('', s, 1,
      'background:#64748b;border:2px solid #94a3b8;border-radius:50%;');
  },
  splitter: function (variant, scale) {
    const ratio = variant || '1x8';
    const s = Math.round(32 * scale);
    return shell(
      '<span style="font-size:7px;font-weight:800;color:#ddd6fe">' + ratio + '</span>',
      s, 1, 'background:#5b21b6;border:2px solid #a78bfa;border-radius:4px;');
  },
};

function buildIconHtml(equipment, selected) {
  const type = equipment.type;
  const scale = getGisIconScale();
  const builder = ICON_BUILDERS[type] || ICON_BUILDERS.handhole;
  let html;
  if (type === 'splitter') html = builder(equipment.variant, scale);
  else html = builder(scale);
  const label = getGisTypeLabel(type);
  const labelStyle = selected ? 'opacity:1;font-weight:700;color:#00e5ff' : '';
  return html + '<span class="gis-marker-label" style="' + labelStyle + '">' + label + '</span>';
}

export function createGisDivIcon(equipment, zoom) {
  if (zoom != null) setGisIconZoom(zoom);
  const scale = getGisIconScale();
  const base = Math.round(38 * scale);
  return L.divIcon({
    className: 'gis-marker-wrap gis-marker-wrap--' + equipment.type,
    html: buildIconHtml(equipment, false),
    iconSize: [base, Math.round(46 * scale)],
    iconAnchor: [Math.round(base / 2), Math.round(42 * scale)],
    popupAnchor: [0, -Math.round(42 * scale)],
  });
}

export function createGisSelectedIcon(equipment, zoom) {
  const base = createGisDivIcon(equipment, zoom);
  return L.divIcon({
    className: base.options.className + ' gis-marker-wrap--selected',
    html: buildIconHtml(equipment, true),
    iconSize: base.options.iconSize,
    iconAnchor: base.options.iconAnchor,
    popupAnchor: base.options.popupAnchor,
  });
}

export function updateMarkerIconDom(marker, equipment, selected, zoom) {
  if (!marker) return;
  marker.setIcon(selected ? createGisSelectedIcon(equipment, zoom) : createGisDivIcon(equipment, zoom));
}
