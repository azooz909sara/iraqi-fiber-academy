/**
 * FTTH Network Simulator — main orchestrator
 * (Bundled via build-bundle.ps1 — no ES module imports here)
 */
  var GRID_COLS = ctx.GRID_COLS;
  var GRID_ROWS = ctx.GRID_ROWS;
  var CELL_SIZE = ctx.CELL_SIZE;
  var MAP_W = ctx.MAP_W;
  var MAP_H = ctx.MAP_H;
  function refreshGridVars() {
    GRID_COLS = ctx.GRID_COLS;
    GRID_ROWS = ctx.GRID_ROWS;
    CELL_SIZE = ctx.CELL_SIZE;
    MAP_W = ctx.MAP_W;
    MAP_H = ctx.MAP_H;
  }
  function applyGridDimensionsMain(layoutId) {
    applyGridDimensions(layoutId);
    refreshGridVars();
  }

  var HOME_COUNT_MIN = 10;
  var HOME_COUNT_MAX = 16;

  /* ─── Layout cache (generated programmatically) ─── */
  var LAYOUTS = ctx.LAYOUTS;

  function createRng(initialSeed) {
    var seed = initialSeed;
    return {
      next: function () {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed;
      },
      int: function (min, max) {
        return min + (this.next() % (max - min + 1));
      },
    };
  }

  /* City band grid: [sidewalk|BLOCK×5|sidewalk|STREET] × [sidewalk|BLOCK×4|sidewalk|STREET] */
  var CITY_BAND = { COL_PERIOD: 8, ROW_PERIOD: 7, BLOCK_W: 5, BLOCK_H: 4, SIDEWALK: 1, STREET: 1 };

  function emptyStreetMaps() {
    return {
      streetsH: {}, streetsV: {},
      mainStreetsH: {}, mainStreetsV: {},
      sidewalksH: {}, sidewalksV: {},
    };
  }

  function cellIsSidewalkMap(maps, col, row) {
    return streetHas(maps.sidewalksH, row) || streetHas(maps.sidewalksV, col);
  }

  function markBorderSidewalks(maps) {
    var c, r;
    for (c = 0; c < GRID_COLS; c++) {
      maps.sidewalksH[0] = true;
      maps.sidewalksH[GRID_ROWS - 1] = true;
    }
    for (r = 0; r < GRID_ROWS; r++) {
      maps.sidewalksV[0] = true;
      maps.sidewalksV[GRID_COLS - 1] = true;
    }
  }

  function markBorderStreets(maps) {
    maps.streetsH[0] = true;
    maps.streetsH[GRID_ROWS - 1] = true;
    maps.streetsV[0] = true;
    maps.streetsV[GRID_COLS - 1] = true;
    maps.mainStreetsH[0] = true;
    maps.mainStreetsH[GRID_ROWS - 1] = true;
    maps.mainStreetsV[0] = true;
    maps.mainStreetsV[GRID_COLS - 1] = true;
  }

  function markCityBandGrid(maps, opts) {
    opts = opts || {};
    var cp = opts.colPeriod || CITY_BAND.COL_PERIOD;
    var rp = opts.rowPeriod || CITY_BAND.ROW_PERIOD;
    var mainColEvery = opts.mainColEvery || 4;
    var mainRowEvery = opts.mainRowEvery || 4;
    var c, r, pc, pr, bandIdx;

    markBorderStreets(maps);
    markBorderSidewalks(maps);

    for (c = 0; c < GRID_COLS; c++) {
      pc = ((c % cp) + cp) % cp;
      if (pc === 0) {
        maps.streetsV[c] = true;
        bandIdx = Math.floor(c / cp);
        if (bandIdx > 0 && bandIdx % mainColEvery === mainColEvery - 1) {
          maps.mainStreetsV[c] = true;
        }
      } else if (pc === 1 || pc === cp - 1) {
        maps.sidewalksV[c] = true;
      }
    }

    for (r = 0; r < GRID_ROWS; r++) {
      pr = ((r % rp) + rp) % rp;
      if (pr === 0) {
        maps.streetsH[r] = true;
        bandIdx = Math.floor(r / rp);
        if (bandIdx > 0 && bandIdx % mainRowEvery === mainRowEvery - 1) {
          maps.mainStreetsH[r] = true;
        }
      } else if (pr === 1 || pr === rp - 1) {
        maps.sidewalksH[r] = true;
      }
    }
  }

  function forEachBlockSlot(fn) {
    var cp = CITY_BAND.COL_PERIOD;
    var rp = CITY_BAND.ROW_PERIOD;
    var c0off = 2;
    var c1off = cp - 2;
    var r0off = 2;
    var r1off = rp - 2;
    var bc, br, c0, c1, r0, r1;
    for (bc = 0; bc < GRID_COLS; bc += cp) {
      for (br = 0; br < GRID_ROWS; br += rp) {
        c0 = bc + c0off;
        c1 = bc + c1off;
        r0 = br + r0off;
        r1 = br + r1off;
        if (c0 >= GRID_COLS || r0 >= GRID_ROWS) continue;
        c1 = Math.min(c1, GRID_COLS - 1);
        r1 = Math.min(r1, GRID_ROWS - 1);
        if (c1 < c0 || r1 < r0) continue;
        fn(c0, r0, c1, r1, bc, br);
      }
    }
  }

  function layoutFromMaps(name, kind, maps, zones, blocks) {
    return {
      name: name,
      layoutKind: kind,
      zones: zones,
      blocks: blocks || [],
      streetsH: maps.streetsH,
      streetsV: maps.streetsV,
      mainStreetsH: maps.mainStreetsH,
      mainStreetsV: maps.mainStreetsV,
      sidewalksH: maps.sidewalksH,
      sidewalksV: maps.sidewalksV,
    };
  }

  function rectsOverlap(a, b) {
    return a.c0 <= b.c1 && a.c1 >= b.c0 && a.r0 <= b.r1 && a.r1 >= b.r0;
  }

  function cellIsStreet(maps, col, row) {
    return streetHas(maps.streetsH, row) || streetHas(maps.streetsV, col);
  }

  function zoneFits(maps, zone, occupied) {
    var c, r;
    for (r = zone.r0; r <= zone.r1; r++) {
      for (c = zone.c0; c <= zone.c1; c++) {
        if (c < 1 || r < 1 || c >= GRID_COLS - 1 || r >= GRID_ROWS - 1) return false;
        if (cellIsStreet(maps, c, r)) return false;
        if (cellIsSidewalkMap(maps, c, r)) return false;
      }
    }
    for (var i = 0; i < occupied.length; i++) {
      if (rectsOverlap(zone, occupied[i])) return false;
    }
    return true;
  }

  function carveBlock(zones, block) {
    return zones.filter(function (z) { return !rectsOverlap(z, block); });
  }

  function stripHouseOverlaps(zones, rect) {
    return zones.filter(function (z) {
      return (z.type !== 'residential' && z.type !== 'baghdad_house') || !rectsOverlap(z, rect);
    });
  }

  /* ITPC Exchange — fixed 3×3 campus (top-left on all layouts) */

  function clearStreetsInBlock(layout, block) {
    var r, c;
    for (r = block.r0; r <= block.r1; r++) {
      delete layout.streetsH[r];
      delete layout.mainStreetsH[r];
      delete layout.sidewalksH[r];
    }
    for (c = block.c0; c <= block.c1; c++) {
      delete layout.streetsV[c];
      delete layout.mainStreetsV[c];
      delete layout.sidewalksV[c];
    }
  }

  function randomHomeCount(rng) {
    return rng.int(HOME_COUNT_MIN, HOME_COUNT_MAX);
  }

  var BLOCK_ELEMENT_POOLS = {
    residential: [
      { icon: '🏠', type: 'house',   weight: 26 },
      { icon: '🏡', type: 'house',   weight: 24 },
      { icon: '🏢', type: 'building', weight: 18 },
      { icon: '🏨', type: 'health',  weight: 8 },
      { icon: '🏦', type: 'bank',    weight: 8 },
      { icon: '🕌', type: 'worship', weight: 8 },
      { icon: '⛪', type: 'worship', weight: 8 },
    ],
    commercial: [
      { icon: '🏢', type: 'building', weight: 38 },
      { icon: '🏦', type: 'bank',    weight: 22 },
      { icon: '🏨', type: 'health',  weight: 14 },
      { icon: '🏠', type: 'house',   weight: 8 },
      { icon: '🏡', type: 'house',   weight: 8 },
      { icon: '🕌', type: 'worship', weight: 5 },
      { icon: '⛪', type: 'worship', weight: 5 },
    ],
    apartment: [
      { icon: '🏢', type: 'building', weight: 48 },
      { icon: '🏠', type: 'house',   weight: 14 },
      { icon: '🏡', type: 'house',   weight: 10 },
      { icon: '🏦', type: 'bank',    weight: 10 },
      { icon: '🏨', type: 'health',  weight: 10 },
      { icon: '🕌', type: 'worship', weight: 4 },
      { icon: '⛪', type: 'worship', weight: 4 },
    ],
  };

  function pickWeightedElement(rng, pool) {
    var total = 0;
    var i;
    for (i = 0; i < pool.length; i++) total += pool[i].weight;
    var roll = rng.next() % total;
    for (i = 0; i < pool.length; i++) {
      roll -= pool[i].weight;
      if (roll < 0) return { icon: pool[i].icon, type: pool[i].type };
    }
    return { icon: pool[0].icon, type: pool[0].type };
  }

  function shuffleElements(list, rng) {
    var i, j, tmp;
    for (i = list.length - 1; i > 0; i--) {
      j = rng.next() % (i + 1);
      tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  function computeAllBlockSlots(w, h) {
    var slots = [];
    var lc, lr;
    for (lr = 0; lr < h; lr++) {
      for (lc = 0; lc < w; lc++) {
        slots.push({ lc: lc, lr: lr });
      }
    }
    return slots;
  }

  function elementAtMatrix(elements, lc, lr) {
    for (var i = 0; i < elements.length; i++) {
      if (elements[i].lc === lc && elements[i].lr === lr) return elements[i];
    }
    return null;
  }

  function matrixNeighbors(lc, lr, w, h) {
    var out = [];
    if (lr > 0) out.push({ lc: lc, lr: lr - 1 });
    if (lr < h - 1) out.push({ lc: lc, lr: lr + 1 });
    if (lc > 0) out.push({ lc: lc - 1, lr: lr });
    if (lc < w - 1) out.push({ lc: lc + 1, lr: lr });
    return out;
  }

  function garnishWorshipWithTrees(elements, w, h, rng) {
    var worship = elements.filter(function (e) { return e.type === 'worship'; });
    var wi, ni, pos, neighbor, trees, pick, adjPos, occupant;

    for (wi = 0; wi < worship.length; wi++) {
      var wEl = worship[wi];
      var hasTreeNeighbor = matrixNeighbors(wEl.lc, wEl.lr, w, h).some(function (p) {
        var n = elementAtMatrix(elements, p.lc, p.lr);
        return n && n.type === 'tree';
      });
      if (hasTreeNeighbor) continue;

      var adjSlots = matrixNeighbors(wEl.lc, wEl.lr, w, h);
      for (ni = 0; ni < adjSlots.length; ni++) {
        adjPos = adjSlots[ni];
        occupant = elementAtMatrix(elements, adjPos.lc, adjPos.lr);
        if (!occupant || occupant.type === 'tree') continue;
        trees = elements.filter(function (e) { return e.type === 'tree'; });
        if (!trees.length) break;
        pick = trees[rng.next() % trees.length];
        var tmpLc = pick.lc;
        var tmpLr = pick.lr;
        pick.lc = occupant.lc;
        pick.lr = occupant.lr;
        occupant.lc = tmpLc;
        occupant.lr = tmpLr;
        break;
      }
    }
  }

  function assignBlockElements(zone, rng, poolKey) {
    var pool = BLOCK_ELEMENT_POOLS[poolKey] || BLOCK_ELEMENT_POOLS.residential;
    var w = zone.c1 - zone.c0 + 1;
    var h = zone.r1 - zone.r0 + 1;
    var allSlots = computeAllBlockSlots(w, h);
    var buildingCount = Math.min(randomHomeCount(rng), allSlots.length);
    var shuffled = shuffleElements(allSlots.slice(), rng);
    var buildingSlots = shuffled.slice(0, buildingCount);
    var treeSlots = shuffled.slice(buildingCount);
    var elements = [];
    var i;

    for (i = 0; i < buildingSlots.length; i++) {
      var slot = buildingSlots[i];
      var el = pickWeightedElement(rng, pool);
      elements.push({ icon: el.icon, type: el.type, lc: slot.lc, lr: slot.lr });
    }
    for (i = 0; i < treeSlots.length; i++) {
      var treeSlot = treeSlots[i];
      elements.push({ icon: '🌳', type: 'tree', lc: treeSlot.lc, lr: treeSlot.lr });
    }

    garnishWorshipWithTrees(elements, w, h, rng);
    zone.elements = elements;
    zone.homes = buildingCount;
  }

  function blockElementsPoolKey(zoneType) {
    if (zoneType === 'commercial') return 'commercial';
    if (zoneType === 'apartment') return 'apartment';
    if (zoneType === 'satellite_parcel') return 'residential';
    return 'residential';
  }

  function isSatelliteLayout(layout) {
    return layout && layout.layoutKind === 'satellite';
  }

  function applyLayoutCanvas(layout) {
    var canvas = dom.cityCanvas;
    var streetLayer = document.getElementById('street-layer');
    var satBg = dom.satelliteBgLayer;
    if (!canvas) return;

    if (isSatelliteLayout(layout)) {
      canvas.classList.add('map-canvas--satellite');
      canvas.setAttribute('data-layout-mode', 'satellite');
      canvas.style.backgroundImage = '';
      if (satBg) {
        satBg.style.display = 'block';
        satBg.style.width = MAP_W + 'px';
        satBg.style.height = MAP_H + 'px';
        satBg.style.backgroundImage = layerState.satellite ? "url('" + SATELLITE_BG_URL + "')" : 'none';
        satBg.style.backgroundSize = MAP_W + 'px ' + MAP_H + 'px';
      }
      if (streetLayer) streetLayer.style.display = 'none';
    } else {
      canvas.classList.remove('map-canvas--satellite');
      canvas.removeAttribute('data-layout-mode');
      canvas.style.backgroundImage = '';
      if (satBg) {
        satBg.style.display = 'none';
        satBg.style.backgroundImage = 'none';
      }
      if (streetLayer) streetLayer.style.display = '';
    }
    applyLayerVisibility();
  }

  function zoneContentInsetsPx(zone, layout) {
    return { top: 4, right: 4, bottom: 4, left: 4 };
  }

  function cellIsStreetLayout(layout, col, row) {
    return streetHas(layout.streetsH, row) || streetHas(layout.streetsV, col);
  }

  function isExplicitSidewalkCell(layout, col, row) {
    if (cellIsStreetLayout(layout, col, row)) return false;
    return streetHas(layout.sidewalksH, row) || streetHas(layout.sidewalksV, col);
  }

  function isLandmarkCell(layout, col, row) {
    return !!findBlock(layout, col, row);
  }

  function buildSidewalkMap(layout) {
    var map = {};
    var r, c;
    for (r = 0; r < GRID_ROWS; r++) {
      for (c = 0; c < GRID_COLS; c++) {
        if (isLandmarkCell(layout, c, r)) continue;
        if (isExplicitSidewalkCell(layout, c, r)) {
          map[c + ',' + r] = true;
        }
      }
    }
    layout.sidewalks = map;
    return layout;
  }

  function isSidewalkCell(layout, col, row) {
    return !!(layout && layout.sidewalks && layout.sidewalks[col + ',' + row]);
  }

  function isBuildingBlockCell(layout, col, row) {
    var zone = findZone(layout, col, row);
    if (!zone) return false;
    return zone.type === 'residential' || zone.type === 'baghdad_house' ||
      zone.type === 'apartment' || zone.type === 'commercial' ||
      zone.type === 'satellite_parcel';
  }

  function requiresSidewalkPlacement(type) {
    return SIDEWALK_EQUIPMENT[type] === true;
  }

  function isSatelliteFreePlacementMode() {
    return currentLayout === 'satellite';
  }

  function validateEquipmentPlacement(type, col, row) {
    if (isSatelliteFreePlacementMode() && SIDEWALK_EQUIPMENT[type]) {
      return { ok: true };
    }
    if (!requiresSidewalkPlacement(type)) return { ok: true };
    var layout = getLayout(currentLayout);
    if (isBlocked(col, row)) return { ok: false, msg: PLACEMENT_ERR_SIDEWALK };
    if (cellIsStreetLayout(layout, col, row)) return { ok: false, msg: PLACEMENT_ERR_SIDEWALK };
    if (isBuildingBlockCell(layout, col, row)) return { ok: false, msg: PLACEMENT_ERR_SIDEWALK };
    if (!isSidewalkCell(layout, col, row)) return { ok: false, msg: PLACEMENT_ERR_SIDEWALK };
    return { ok: true };
  }

  function showPlacementError(msg) {
    toast(msg || PLACEMENT_ERR_SIDEWALK, 'error');
  }

  function finalizeLayout(layout) {
    layout.zones = layout.zones || [];
    if (layout.layoutKind !== 'satellite') {
      layout.blocks = (layout.blocks || []).filter(function (b) {
        return b.type === 'itpc' || !rectsOverlap(b, ITPC_BLOCK);
      });
      layout.zones = carveBlock(layout.zones, ITPC_BLOCK);
      clearStreetsInBlock(layout, ITPC_BLOCK);
      layout.blocks.unshift({
        type: 'itpc',
        c0: ITPC_BLOCK.c0,
        r0: ITPC_BLOCK.r0,
        c1: ITPC_BLOCK.c1,
        r1: ITPC_BLOCK.r1,
        label: 'ITPC Exchange',
      });
      layout.itpc = ITPC_BLOCK;
    } else {
      var satItpc = {
        type: 'itpc',
        c0: ITPC_BLOCK.c0,
        r0: ITPC_BLOCK.r0,
        c1: ITPC_BLOCK.c1,
        r1: ITPC_BLOCK.r1,
        label: 'ITPC Exchange',
      };
      layout.zones = carveBlock(layout.zones, satItpc);
      clearStreetsInBlock(layout, satItpc);
      layout.blocks = [satItpc];
      layout.itpc = satItpc;
    }
    buildSidewalkMap(layout);
    return layout;
  }

  function isItpcCell(layout, col, row) {
    var itpc = layout && layout.itpc;
    if (!itpc) return false;
    return col >= itpc.c0 && col <= itpc.c1 && row >= itpc.r0 && row <= itpc.r1;
  }

  function resolveGridFromPlacement(col, row, px, py) {
    if (col != null && row != null) return { col: col, row: row };
    if (px != null && py != null) {
      return {
        col: Math.max(0, Math.min(GRID_COLS - 1, Math.floor(px / CELL_SIZE))),
        row: Math.max(0, Math.min(GRID_ROWS - 1, Math.floor(py / CELL_SIZE))),
      };
    }
    return null;
  }

  function canPlaceOltAt(col, row, px, py, ignoreId) {
    var grid = resolveGridFromPlacement(col, row, px, py);
    if (!grid) return { ok: false, msg: 'OLT must be placed inside ITPC Exchange' };
    return validateOltPlacement(grid.col, grid.row, ignoreId);
  }

  function validateOltPlacement(col, row, ignoreId) {
    var layout = getLayout(currentLayout);
    if (!layout.itpc) {
      return { ok: false, msg: 'ITPC Exchange not available on this layout' };
    }
    if (!isItpcCell(layout, col, row)) {
      return { ok: false, msg: 'OLT must be placed inside ITPC Exchange only — not on streets or buildings' };
    }
    if (isOccupied(col, row, ignoreId)) {
      return { ok: false, msg: 'Cell occupied' };
    }
    return { ok: true };
  }

  function ensureItpcOlt(layout) {
    /* OLT is placed manually by the user inside ITPC Exchange */
  }

  /* ─── Layout A: Organized Residential Grid ─── */
  function generateResidentialGrid() {
    var rng = createRng(42);
    var maps = emptyStreetMaps();
    markCityBandGrid(maps);
    var zones = [];
    var occupied = [];
    var parkLabels = ['Neighborhood Park', 'Green Belt', 'Playground', 'Garden Square'];
    var slotIdx = 0;

    forEachBlockSlot(function (c0, r0, c1, r1) {
      var z = { type: 'residential', c0: c0, r0: r0, c1: c1, r1: r1 };
      if (!zoneFits(maps, z, occupied)) return;
      if (slotIdx > 0 && slotIdx % 11 === 0) {
        z.type = 'park';
        z.label = parkLabels[(slotIdx / 11 | 0) % parkLabels.length];
        delete z.elements;
      } else {
        assignBlockElements(z, rng, 'residential');
      }
      zones.push(z);
      occupied.push(z);
      slotIdx++;
    });

    var blocks = [
      { type: 'school',    c0: 10, r0: 10, c1: 14, r1: 13, label: 'Primary School' },
      { type: 'school',    c0: 66, r0: 17, c1: 70, r1: 20, label: 'Secondary School' },
      { type: 'hospital',  c0: 82, r0: 10, c1: 86, r1: 13, label: 'Medical Center' },
      { type: 'market',    c0: 42, r0: 52, c1: 46, r1: 55, label: 'Local Market' },
      { type: 'library',   c0: 90, r0: 73, c1: 94, r1: 76, label: 'Public Library' },
      { type: 'community', c0: 50, r0: 82, c1: 54, r1: 85, label: 'Community Hub' },
    ];

    blocks.forEach(function (b) {
      zones = carveBlock(zones, b);
    });

    return layoutFromMaps('Organized Residential Grid', 'residential', maps, zones, blocks);
  }

  function fillBlockSlotsWithMix(zones, maps, rng, profile) {
    var occupied = [];
    var slotIdx = 0;
    profile = profile || 'urban';

    forEachBlockSlot(function (c0, r0, c1, r1) {
      var roll = rng.next() % 100;
      var z = null;

      if (profile === 'baghdad') {
        if (slotIdx % 9 === 8) {
          z = { type: 'park', c0: c0, r0: r0, c1: c1, r1: r1, label: 'Green Corridor' };
        } else {
          z = { type: 'baghdad_house', c0: c0, r0: r0, c1: c1, r1: r1 };
          assignBlockElements(z, rng, 'residential');
        }
      } else if (roll < 30) {
        z = { type: 'residential', c0: c0, r0: r0, c1: c1, r1: r1 };
        assignBlockElements(z, rng, 'residential');
      } else if (roll < 48) {
        z = { type: 'apartment', c0: c0, r0: r0, c1: c1, r1: r1, floors: rng.int(12, 24) };
        assignBlockElements(z, rng, 'apartment');
      } else if (roll < 62) {
        z = {
          type: 'commercial', c0: c0, r0: r0, c1: c1, r1: r1,
          floors: rng.int(16, 36), label: 'Office Tower',
        };
        assignBlockElements(z, rng, 'commercial');
      } else if (roll < 78) {
        z = { type: 'park', c0: c0, r0: r0, c1: c1, r1: r1, label: 'Urban Plaza' };
      } else {
        z = { type: 'greenbelt', c0: c0, r0: r0, c1: c1, r1: r1, label: 'Green Median' };
      }

      if (!z || !zoneFits(maps, z, occupied)) return;
      zones.push(z);
      occupied.push(z);
      slotIdx++;
    });

    return zones;
  }

  /* ─── Layout B: Urban Block District ─── */
  function generateUrbanDistrict() {
    var rng = createRng(137);
    var maps = emptyStreetMaps();
    markCityBandGrid(maps);
    var zones = fillBlockSlotsWithMix([], maps, rng, 'urban');

    var blocks = [
      { type: 'airport',   c0: 58, r0: 72, c1: 86, r1: 83, label: 'International Airport', sub: '2 Runways' },
      { type: 'hospital',  c0: 18, r0: 18, c1: 22, r1: 21, label: 'City Hospital', floors: 12 },
      { type: 'hospital',  c0: 66, r0: 50, c1: 70, r1: 53, label: 'Emergency Center', floors: 8 },
      { type: 'school',    c0: 34, r0: 34, c1: 38, r1: 37, label: 'Central School' },
      { type: 'school',    c0: 82, r0: 18, c1: 86, r1: 21, label: 'Tech Academy' },
      { type: 'tower',     c0: 42, r0: 10, c1: 46, r1: 13, label: 'Trade Tower', floors: 28 },
      { type: 'tower',     c0: 10, r0: 42, c1: 14, r1: 45, label: 'Sky Tower', floors: 36 },
      { type: 'market',    c0: 50, r0: 50, c1: 54, r1: 53, label: 'Grand Mall' },
      { type: 'community', c0: 26, r0: 58, c1: 30, r1: 61, label: 'Civic Center' },
    ];

    blocks.forEach(function (b) {
      zones = carveBlock(zones, b);
    });

    return layoutFromMaps('Urban Block District', 'downtown', maps, zones, blocks);
  }

  /* ─── Layout C: Modern Baghdad House Communities ─── */
  function generateBaghdadHouseCommunities() {
    var rng = createRng(256);
    var maps = emptyStreetMaps();
    markCityBandGrid(maps);
    var zones = fillBlockSlotsWithMix([], maps, rng, 'baghdad');

    var blocks = [
      { type: 'community', c0: 18, r0: 18, c1: 22, r1: 21, label: 'Services Center' },
      { type: 'library',   c0: 74, r0: 18, c1: 78, r1: 21, label: 'Community Library' },
      { type: 'market',    c0: 18, r0: 74, c1: 22, r1: 77, label: 'Neighborhood Market' },
      { type: 'park',      c0: 74, r0: 74, c1: 86, r1: 77, label: 'Central Garden' },
    ];

    blocks.forEach(function (b) {
      zones = carveBlock(zones, b);
    });

    return layoutFromMaps('Modern Baghdad House Communities', 'baghdad_house', maps, zones, blocks);
  }

  function buildSatelliteStreetLines() {
    var h = [];
    var v = [];
    var hStep = Math.max(10, Math.floor(GRID_ROWS / 9));
    var vStep = Math.max(12, Math.floor(GRID_COLS / 7));
    var i;
    for (i = hStep; i < GRID_ROWS - hStep; i += hStep) h.push(i);
    for (i = vStep; i < GRID_COLS - vStep; i += vStep) v.push(i);
    return { h: h, v: v };
  }

  function markSatelliteStreetGrid(maps) {
    var c, r, i;
    var lines = buildSatelliteStreetLines();
    maps.streetsH[0] = true;
    maps.streetsH[GRID_ROWS - 1] = true;
    maps.streetsV[0] = true;
    maps.streetsV[GRID_COLS - 1] = true;
    maps.sidewalksH[1] = true;
    maps.sidewalksH[GRID_ROWS - 2] = true;
    maps.sidewalksV[1] = true;
    maps.sidewalksV[GRID_COLS - 2] = true;

    for (i = 0; i < lines.h.length; i++) {
      r = lines.h[i];
      maps.streetsH[r] = true;
      maps.mainStreetsH[r] = true;
      if (r > 0 && !maps.streetsH[r - 1]) maps.sidewalksH[r - 1] = true;
      if (r < GRID_ROWS - 1 && !maps.streetsH[r + 1]) maps.sidewalksH[r + 1] = true;
    }
    for (i = 0; i < lines.v.length; i++) {
      c = lines.v[i];
      maps.streetsV[c] = true;
      maps.mainStreetsV[c] = true;
      if (c > 0 && !maps.streetsV[c - 1]) maps.sidewalksV[c - 1] = true;
      if (c < GRID_COLS - 1 && !maps.streetsV[c + 1]) maps.sidewalksV[c + 1] = true;
    }
  }

  function forEachSatelliteParcel(maps, fn) {
    var visited = {};
    var c, r, key, stack, minC, minR, maxC, maxR, p, nc, nr, k, w, h;

    for (r = 0; r < GRID_ROWS; r++) {
      for (c = 0; c < GRID_COLS; c++) {
        key = c + ',' + r;
        if (visited[key]) continue;
        if (cellIsStreet(maps, c, r) || cellIsSidewalkMap(maps, c, r)) continue;

        minC = maxC = c;
        minR = maxR = r;
        stack = [{ c: c, r: r }];
        visited[key] = true;

        while (stack.length) {
          p = stack.pop();
          if (p.c < minC) minC = p.c;
          if (p.c > maxC) maxC = p.c;
          if (p.r < minR) minR = p.r;
          if (p.r > maxR) maxR = p.r;

          var dirs = [
            { c: p.c - 1, r: p.r },
            { c: p.c + 1, r: p.r },
            { c: p.c, r: p.r - 1 },
            { c: p.c, r: p.r + 1 },
          ];
          for (var di = 0; di < dirs.length; di++) {
            nc = dirs[di].c;
            nr = dirs[di].r;
            if (nc < 0 || nr < 0 || nc >= GRID_COLS || nr >= GRID_ROWS) continue;
            k = nc + ',' + nr;
            if (visited[k]) continue;
            if (cellIsStreet(maps, nc, nr) || cellIsSidewalkMap(maps, nc, nr)) continue;
            visited[k] = true;
            stack.push({ c: nc, r: nr });
          }
        }

        w = maxC - minC + 1;
        h = maxR - minR + 1;
        if (w >= 2 && h >= 2) fn(minC, minR, maxC, maxR);
      }
    }
  }

  function generateSatelliteMap() {
    var rng = createRng(512);
    var maps = emptyStreetMaps();
    markSatelliteStreetGrid(maps);
    var zones = [];

    forEachSatelliteParcel(maps, function (c0, r0, c1, r1) {
      var z = {
        type: 'satellite_parcel',
        c0: c0, r0: r0, c1: c1, r1: r1,
      };
      assignBlockElements(z, rng, 'residential');
      zones.push(z);
    });

    return layoutFromMaps('Real Satellite Map', 'satellite', maps, zones, []);
  }

  function generateCityLayout(type) {
    if (type === 'satellite') return generateSatelliteMap();
    if (type === 'downtown') return generateUrbanDistrict();
    if (type === 'baghdad_house') return generateBaghdadHouseCommunities();
    return generateResidentialGrid();
  }

  var LAYOUT_VERSION = 6;

  function getLayout(id) {
    if (LAYOUTS[id] && LAYOUTS[id]._version !== LAYOUT_VERSION) delete LAYOUTS[id];
    if (!LAYOUTS[id]) {
      LAYOUTS[id] = finalizeLayout(generateCityLayout(id));
      LAYOUTS[id]._version = LAYOUT_VERSION;
    }
    return LAYOUTS[id];
  }

  function streetHas(map, idx) {
    return !!(map && map[idx]);
  }

  /* ─── Toolbox ─── */
  var TOOLBOX = [
    { id: 'network_zone',  label: 'Network Zone / Shadow', icon: '⬡', color: '#f59e0b', max: 20, visual: 'zone', gisOnly: true },
    { id: 'olt',            label: 'OLT',             icon: '', color: '#1e40af', max: 1,  visual: 'olt' },
    { id: 'splitter',       label: 'Splitter',        icon: '', color: '#8b5cf6', max: 16, visual: 'splitter',
      dropdown: ['1x2', '1x4', '1x8', '1x16', '2x4', '2x8', '2x16'], defaultVal: '1x8' },
    { id: 'fdt',            label: 'FDT Cabinet',     icon: '',   color: '#f59e0b', max: 48, visual: 'fdt' },
    { id: 'pole_foundation', label: 'pole foundation', icon: '', color: '#94a3b8', max: 40, visual: 'foundation' },
    { id: 'pole',           label: 'pole', icon: '', color: '#eab308', max: 40, visual: 'pole' },
    { id: 'handhole',       label: 'Handhole',        icon: '', color: '#94a3b8', max: 40, visual: 'handhole' },
    { id: 'closure',        label: 'Closure',         icon: '',   color: '#ff0000', max: 40, visual: 'closure' },
    { id: 'ont',            label: 'ONT',             icon: '📶', color: '#00e5ff', max: 99, visual: 'default' },
    { id: 'cable_ftth',     label: 'FTTH Main Cable', icon: '🔵', color: '#3b82f6', max: 99, visual: 'cable', isCable: true,
      dropdown: ['48', '72', '144', '288'], defaultVal: '72' },
    { id: 'cable_lastmile', label: 'Last Mile Cable', icon: '🟠', color: '#f59e0b', max: 99, visual: 'cable', isCable: true,
      dropdown: ['12', '24', '36', '48'], defaultVal: '24' },
  ];

  function parseSplitterRatio(ratioStr) {
    var m = String(ratioStr || '1x8').match(/^(\d+)x(\d+)$/i);
    if (!m) return { inputs: 1, outputs: 8 };
    return { inputs: parseInt(m[1], 10), outputs: parseInt(m[2], 10) };
  }

  function splitterParts(ratioStr) {
    var ratio = parseSplitterRatio(ratioStr);
    var inputs = Math.min(Math.max(ratio.inputs, 1), 2);
    var visOut = Math.min(Math.max(ratio.outputs, 1), 8);
    var i, ty;
    var parts = [];

    if (inputs === 1) {
      parts.push('<line class="spl-in" x1="2" y1="24" x2="14" y2="24" stroke="#c4b5fd" stroke-width="2.4" stroke-linecap="round"/>');
    } else {
      parts.push('<line class="spl-in" x1="2" y1="17" x2="14" y2="19" stroke="#c4b5fd" stroke-width="2.2" stroke-linecap="round"/>');
      parts.push('<line class="spl-in" x1="2" y1="31" x2="14" y2="29" stroke="#c4b5fd" stroke-width="2.2" stroke-linecap="round"/>');
    }

    parts.push('<rect x="14" y="16" width="12" height="16" rx="3" fill="#5b21b6" stroke="#a78bfa" stroke-width="1.3"/>');

    for (i = 0; i < visOut; i++) {
      ty = visOut === 1 ? 24 : Math.round(8 + (32 * i) / (visOut - 1));
      parts.push('<line class="spl-out" x1="26" y1="24" x2="46" y2="' + ty + '" stroke="#ddd6fe" stroke-width="1.6" stroke-linecap="round"/>');
    }

    parts.push('<text x="20" y="40" class="spl-ratio-label" font-size="5.5" fill="#e9d5ff" text-anchor="middle" font-family="Consolas,monospace">' + ratioStr + '</text>');
    return parts;
  }

  function splitterIconSvg(ratioStr, size) {
    var s = size || 36;
    return '<svg class="field-icon field-icon--splitter" viewBox="0 0 48 48" width="' + s + '" height="' + s + '" aria-hidden="true" data-ratio="' + ratioStr + '">' +
      splitterParts(ratioStr).join('') + '</svg>';
  }

  var FIELD_HH_GREEN = '#00B050';
  var FIELD_CL_RED = '#FF0000';

  function handholeIconSvg(size) {
    var s = size || 36;
    return '<svg class="field-icon field-icon--handhole" viewBox="0 0 48 48" width="' + s + '" height="' + s + '" aria-hidden="true">' +
      '<rect x="5" y="5" width="38" height="38" fill="none" stroke="' + FIELD_HH_GREEN + '" stroke-width="8"/>' +
    '</svg>';
  }

  function closureIconSvg(size) {
    var s = size || 36;
    return '<svg class="field-icon field-icon--closure" viewBox="0 0 48 48" width="' + s + '" height="' + s + '" aria-hidden="true">' +
      '<rect x="14" y="14" width="20" height="20" fill="' + FIELD_CL_RED + '"/>' +
    '</svg>';
  }

  function handholeClosureIconSvg(size) {
    var s = size || 36;
    return '<svg class="field-icon field-icon--handhole-closure" viewBox="0 0 48 48" width="' + s + '" height="' + s + '" aria-hidden="true">' +
      '<rect class="hh-frame" x="5" y="5" width="38" height="38" fill="none" stroke="' + FIELD_HH_GREEN + '" stroke-width="8"/>' +
      '<rect class="hh-closure-inner" x="16" y="16" width="16" height="16" fill="' + FIELD_CL_RED + '"/>' +
    '</svg>';
  }

  function itpcCampusSvg(size) {
    var s = size || 48;
    return '<svg class="itpc-campus__logo" viewBox="0 0 64 64" width="' + s + '" height="' + s + '" aria-hidden="true">' +
      '<rect x="4" y="10" width="56" height="44" rx="6" fill="#312e81" stroke="#a78bfa" stroke-width="2.5"/>' +
      '<rect x="10" y="16" width="44" height="28" rx="3" fill="#1e1b4b" stroke="#7c3aed" stroke-width="1.2"/>' +
      '<path d="M32 22 L32 38 M24 30 L40 30" stroke="#c4b5fd" stroke-width="2.5" stroke-linecap="round"/>' +
      '<circle cx="32" cy="30" r="9" fill="none" stroke="#8b5cf6" stroke-width="1.8" stroke-dasharray="3 2"/>' +
      '<path d="M32 8 L36 14 L28 14 Z" fill="#a78bfa"/>' +
      '<rect x="18" y="46" width="28" height="4" rx="1" fill="#4c1d95"/>' +
      '<text x="32" y="41" text-anchor="middle" font-size="7" font-weight="800" fill="#ddd6fe" font-family="system-ui,sans-serif">ITPC</text>' +
    '</svg>';
  }

  function oltIconSvg(size) {
    var s = size || 36;
    return '<svg class="field-icon field-icon--olt" viewBox="0 0 48 48" width="' + s + '" height="' + s + '" aria-hidden="true">' +
      '<rect x="10" y="6" width="28" height="36" rx="2" fill="#1e293b" stroke="#3b82f6" stroke-width="1.5"/>' +
      '<rect x="13" y="10" width="22" height="5" rx="1" fill="#334155"/>' +
      '<rect x="13" y="18" width="22" height="5" rx="1" fill="#2563eb" opacity="0.85"/>' +
      '<rect x="13" y="26" width="22" height="5" rx="1" fill="#334155"/>' +
      '<circle cx="16" cy="12.5" r="1.2" fill="#22d3ee"/>' +
      '<circle cx="16" cy="20.5" r="1.2" fill="#4ade80"/>' +
      '<circle cx="16" cy="28.5" r="1.2" fill="#22d3ee"/>' +
      '<rect x="32" y="10" width="1.5" height="21" rx="0.5" fill="#64748b"/>' +
      '</svg>';
  }

  function poleIconSvg(size, fatRatio) {
    var s = size || 36;
    var parts = [
      '<line x1="24" y1="46" x2="24" y2="14" stroke="#94a3b8" stroke-width="2.8" stroke-linecap="round"/>',
    ];
    if (fatRatio) {
      parts.push('<rect x="12" y="1" width="24" height="14" rx="1.5" fill="#1e293b" stroke="#64748b" stroke-width="1.1"/>');
      parts.push('<svg x="13" y="2" width="22" height="12" viewBox="0 0 48 48" preserveAspectRatio="xMidYMid meet">' +
        splitterParts(fatRatio).join('') + '</svg>');
    } else {
      parts.push('<rect x="12" y="1" width="24" height="14" rx="1.5" fill="#9ca3af" stroke="#64748b" stroke-width="1.1"/>');
    }
    return '<svg class="field-icon field-icon--pole" viewBox="0 0 48 48" width="' + s + '" height="' + s + '" aria-hidden="true">' +
      parts.join('') + '</svg>';
  }

  function foundationIconSvg(size, opts) {
    var s = size || 36;
    var o = opts || {};
    var parts = [
      '<rect x="10" y="36" width="28" height="10" rx="1" fill="#c4c8cc" stroke="#78716c" stroke-width="1"/>',
      '<rect x="11" y="37" width="9" height="8" rx="0.5" fill="#374151" stroke="#1f2937" stroke-width="0.8"/>',
      '<line x1="15.5" y1="38" x2="15.5" y2="44" stroke="#6b7280" stroke-width="1" stroke-linecap="round"/>',
    ];
    if (o.hasClosure) {
      parts.push('<rect x="12.5" y="39" width="6" height="4" fill="' + FIELD_CL_RED + '"/>');
    }
    if (o.hasPole) {
      parts.push('<line x1="24" y1="36" x2="24" y2="14" stroke="#94a3b8" stroke-width="2.6" stroke-linecap="round"/>');
      if (o.fatSplitter) {
        parts.push('<rect x="15" y="1" width="18" height="13" rx="1.5" fill="#1e293b" stroke="#64748b" stroke-width="0.9"/>');
        parts.push('<svg x="16" y="2" width="16" height="11" viewBox="0 0 48 48" preserveAspectRatio="xMidYMid meet">' +
          splitterParts(o.fatSplitter).join('') + '</svg>');
      } else {
        parts.push('<rect x="15" y="1" width="18" height="13" rx="1.5" fill="#9ca3af" stroke="#64748b" stroke-width="0.9"/>');
      }
    }
    return '<svg class="field-icon field-icon--foundation" viewBox="0 0 48 48" width="' + s + '" height="' + s + '" aria-hidden="true">' +
      parts.join('') + '</svg>';
  }

  function renderFoundationHtml(node) {
    var svg = foundationIconSvg(44, {
      hasClosure: !!node.hasClosure,
      hasPole: !!node.hasPole,
      fatSplitter: node.fatSplitter || null,
    });
    var label = node.hasPole ? 'pole' : 'pole foundation';
    return svg + '<span class="field-node-label field-node-label--foundation">' + label + '</span>';
  }

  function updateSplitterToolboxIcon(toolboxEl, ratio) {
    var wrap = toolboxEl.querySelector('[data-icon="splitter"]');
    if (wrap) wrap.innerHTML = splitterIconSvg(ratio, 32);
    toolboxEl.title = 'Splitter ' + ratio + ' — ' +
      (parseSplitterRatio(ratio).inputs === 1 ? '1 input → N outputs' : '2 inputs → N outputs');
  }

  function handholeOnlyHtml() {
    return handholeIconSvg(34) + '<span class="field-node-label field-node-label--handhole">HH</span>';
  }

  function handholeClosureHtml() {
    return '<div class="hh-closure-unit">' +
      handholeClosureIconSvg(34) +
      '<span class="field-node-label field-node-label--handhole-closure">HH+CL</span></div>';
  }

  function getNodeAt(col, row) {
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].col === col && nodes[i].row === row) return nodes[i];
    }
    return null;
  }

  function getClosureCount() {
    var n = 0;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].hasClosure) n++;
    }
    return n;
  }

  function getPoleCount() {
    var n = 0;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].type === 'pole_foundation' && nodes[i].hasPole) n++;
    }
    return n;
  }

  function isClosureHost(node) {
    return node && (node.type === 'handhole' || node.type === 'pole_foundation');
  }

  function getEffectiveType(node) {
    if (node.type === 'handhole' && node.hasClosure) return 'closure';
    if (node.type === 'pole_foundation') {
      if (node.hasPole) return 'pole';
      if (node.hasClosure) return 'closure';
      return 'pole_foundation';
    }
    return node.type;
  }

  function showClosureRuleFeedback(reason) {
    var fa = document.getElementById('feedback-area');
    var fl = document.getElementById('feedback-list');
    if (!fa || !fl) return;
    fa.classList.remove('hidden');
    var items = [];
    if (reason === 'empty') {
      items = [
        { ok: false, text: 'Field Rule: Closure cannot be dropped on an empty cell' },
        { ok: false, text: 'قاعدة ميدانية: الكلوجر لا يُنصب في مربع فارغ' },
        { ok: false, text: '① Place a Handhole or Pole Foundation first' },
        { ok: false, text: '② Drag Closure onto the opening — they merge in-place' },
      ];
    } else {
      items = [
        { ok: false, text: 'Closure installs only inside Handhole or Pole Foundation' },
        { ok: false, text: 'الكلوجر يُدمج داخل الهاندهل أو قاعدة العمود فقط' },
      ];
    }
    fl.innerHTML = items.map(function (m) {
      return '<li class="text-red-400">✗ ' + m.text + '</li>';
    }).join('');
  }

  function showPoleRuleFeedback() {
    var fa = document.getElementById('feedback-area');
    var fl = document.getElementById('feedback-list');
    if (!fa || !fl) return;
    fa.classList.remove('hidden');
    var items = [
      { ok: false, text: 'Field Rule: Pole requires a concrete foundation first' },
      { ok: false, text: 'يجب صب القاعدة الخرسانية أولاً قبل نصب العمود ميدانياً' },
      { ok: false, text: '① Install Pole Foundation / HH on the map' },
      { ok: false, text: '② Drop the Pole directly onto the foundation' },
    ];
    fl.innerHTML = items.map(function (m) {
      return '<li class="text-red-400">✗ ' + m.text + '</li>';
    }).join('');
  }

  function tryInstallClosure(targetNode) {
    if (!isClosureHost(targetNode)) {
      showClosureRuleFeedback('wrong');
      toast('Closure must be installed inside Handhole or Pole Foundation', 'error');
      return false;
    }
    if (targetNode.hasClosure) {
      toast('This opening already contains a Closure', 'warn');
      return false;
    }
    if (getClosureCount() >= findTool('closure').max) {
      toast('Maximum closures reached', 'warn');
      return false;
    }
    targetNode.hasClosure = true;
    renderNode(targetNode);
    buildToolbox();
    updateMetrics();
    toast('Closure merged into opening ✓', 'success');
    persistDesignChange();
    return true;
  }

  function tryInstallPole(foundationNode) {
    if (!foundationNode || foundationNode.type !== 'pole_foundation') {
      showPoleRuleFeedback();
      toast('يجب صب القاعدة الخرسانية أولاً قبل نصب العمود ميدانياً', 'error');
      return false;
    }
    if (foundationNode.hasPole) {
      toast('العمود منصوب بالفعل على هذه القاعدة', 'warn');
      return false;
    }
    if (getPoleCount() >= findTool('pole').max) {
      toast('Maximum poles reached', 'warn');
      return false;
    }
    foundationNode.hasPole = true;
    renderNode(foundationNode);
    buildToolbox();
    updateMetrics();
    toast('Distribution pole mounted on foundation ✓', 'success');
    persistDesignChange();
    return true;
  }

  function tryInstallFatSplitter(foundationNode, ratio) {
    if (!foundationNode || foundationNode.type !== 'pole_foundation' || !foundationNode.hasPole) {
      toast('Install pole on foundation first — then drop Splitter on FAT', 'error');
      return false;
    }
    var splRatio = ratio || toolboxVals.splitter || '1x8';
    foundationNode.fatSplitter = splRatio;
    renderNode(foundationNode);
    toast('Splitter installed in FAT box (' + splRatio + ') ✓', 'success');
    persistDesignChange();
    return true;
  }

  function handleClosureDrop(col, row) {
    var existing = getNodeAt(col, row);
    if (!existing) {
      showClosureRuleFeedback('empty');
      toast('Install Handhole or Foundation first — then drop Closure', 'error');
      return;
    }
    tryInstallClosure(existing);
  }

  function handlePoleDrop(col, row) {
    var existing = getNodeAt(col, row);
    if (!existing || existing.type !== 'pole_foundation') {
      showPoleRuleFeedback();
      toast('يجب صب القاعدة الخرسانية أولاً قبل نصب العمود ميدانياً', 'error');
      return;
    }
    tryInstallPole(existing);
  }

  var VALID_LINKS = {
    olt: ['splitter', 'fdt', 'handhole', 'closure', 'pole', 'pole_foundation'],
    splitter: ['fdt', 'closure', 'handhole', 'ont', 'splitter', 'pole', 'pole_foundation'],
    fdt: ['ont', 'closure', 'handhole', 'pole', 'pole_foundation'],
    pole: ['fdt', 'handhole', 'closure', 'ont', 'splitter', 'pole_foundation'],
    pole_foundation: ['fdt', 'handhole', 'closure', 'splitter', 'olt', 'ont', 'pole'],
    handhole: ['fdt', 'closure', 'splitter', 'olt', 'pole', 'pole_foundation'],
    closure: ['fdt', 'ont', 'handhole', 'pole', 'pole_foundation'],
    ont: [],
    home: [],
  };

  /* ─── State (ctx-backed) ─── */
  var nodes = ctx.nodes;
  var connections = ctx.connections;
  var nodeId = ctx.nodeId;
  var connId = ctx.connId;
  var connectMode = ctx.connectMode;
  var connectFrom = ctx.connectFrom;
  var currentLayout = ctx.currentLayout;
  var toolboxVals = ctx.toolboxVals;
  var zoomLevel = ctx.zoomLevel;
  var toolboxCollapsed = ctx.toolboxCollapsed;
  var evalCollapsed = ctx.evalCollapsed;
  var activeCable = ctx.activeCable;
  var selectedCableId = ctx.selectedCableId;
  var suppressCableClick = ctx.suppressCableClick;
  var previewMouse = ctx.previewMouse;
  var hasPreviewMouse = ctx.hasPreviewMouse;
  var panX = ctx.panX;
  var panY = ctx.panY;
  var isPanning = ctx.isPanning;
  var panSession = ctx.panSession;
  var ZOOM_MIN = ctx.ZOOM_MIN;
  var ZOOM_MAX = ctx.ZOOM_MAX;
  var selectedToolboxType = ctx.selectedToolboxType;
  var quickAddTarget = ctx.quickAddTarget;
  var previewRaf = ctx.previewRaf;
  var touchContextTimer = ctx.touchContextTimer;
  var contextMenuNodeId = ctx.contextMenuNodeId;
  var lastDragOverCell = ctx.lastDragOverCell;
  var gridDnDBound = ctx.gridDnDBound;
  var mapInteractionMode = ctx.mapInteractionMode;
  var dom = ctx.dom;

  function syncCtx() {
    ctx.nodeId = nodeId;
    ctx.connId = connId;
    ctx.connectMode = connectMode;
    ctx.connectFrom = connectFrom;
    ctx.currentLayout = currentLayout;
    ctx.toolboxCollapsed = toolboxCollapsed;
    ctx.evalCollapsed = evalCollapsed;
    ctx.activeCable = activeCable;
    ctx.selectedCableId = selectedCableId;
    ctx.suppressCableClick = suppressCableClick;
    ctx.previewMouse = previewMouse;
    ctx.hasPreviewMouse = hasPreviewMouse;
    ctx.panX = panX;
    ctx.panY = panY;
    ctx.isPanning = isPanning;
    ctx.panSession = panSession;
    ctx.selectedToolboxType = selectedToolboxType;
    ctx.quickAddTarget = quickAddTarget;
    ctx.previewRaf = previewRaf;
    ctx.touchContextTimer = touchContextTimer;
    ctx.contextMenuNodeId = contextMenuNodeId;
    ctx.lastDragOverCell = lastDragOverCell;
    ctx.gridDnDBound = gridDnDBound;
    ctx.mapInteractionMode = mapInteractionMode;
    ctx.zoomLevel = zoomLevel;
    ctx.LAYOUTS = LAYOUTS;
  }

  function persistDesignChange() {
    scheduleAutoSave();
  }

  function restoreDesign(state, showToast) {
    if (!state || state.version == null) return;
    connectFrom = null;
    ctx.connectFrom = null;
    setConnectMode(false, true);

    if (state.currentLayout && state.currentLayout !== currentLayout) {
      currentLayout = state.currentLayout;
      ctx.currentLayout = currentLayout;
      if (dom.layoutSelect) dom.layoutSelect.value = currentLayout;
      LAYOUTS = {};
      ctx.LAYOUTS = LAYOUTS;
      applyGridDimensionsMain(currentLayout);
    }

    if (state.layerState) Object.assign(layerState, state.layerState);
    else resetLayerDefaultsForLayout(currentLayout);

    if (state.toolboxVals) {
      Object.keys(state.toolboxVals).forEach(function (k) {
        toolboxVals[k] = state.toolboxVals[k];
      });
    }

    nodes.length = 0;
    connections.length = 0;
    var si;
    for (si = 0; si < (state.nodes || []).length; si++) {
      nodes.push(JSON.parse(JSON.stringify(state.nodes[si])));
    }
    for (si = 0; si < (state.connections || []).length; si++) {
      connections.push(JSON.parse(JSON.stringify(state.connections[si])));
    }
    nodeId = state.nodeId || 0;
    connId = state.connId || 0;
    ctx.nodeId = nodeId;
    ctx.connId = connId;

    buildGrid();
    nodes.forEach(function (n) { renderNode(n); });
    renderConnections();
    buildToolbox();
    syncLayerToggleButtons();
    applyLayerVisibility();
    updateMetrics();

    if (state.zoomLevel != null) zoomLevel = state.zoomLevel;
    if (state.panX != null) panX = state.panX;
    if (state.panY != null) panY = state.panY;
    ctx.zoomLevel = zoomLevel;
    ctx.panX = panX;
    ctx.panY = panY;
    applyMapTransform();

    if (state.gisProject) ctx.gisProject = state.gisProject;
    else getDefaultGisProject();
    if (state.osmView) ctx.osmView = state.osmView;

    if (ctx.api.restoreGisDesign) {
      ctx.api.restoreGisDesign(state);
    }

    if (state.mapMode && ctx.api.setMapMode) ctx.api.setMapMode(state.mapMode);

    if (state.mapMode === 'osm') {
      if (state.selectedGisId && ctx.api.selectGisEquipment) {
        ctx.api.selectGisEquipment(state.selectedGisId);
      } else {
        clearPropertyPanel();
      }
    } else if (state.selectedNodeId && findNode(state.selectedNodeId)) {
      highlightNode(state.selectedNodeId, 'selected');
      showPropertyPanel(state.selectedNodeId);
    } else {
      clearPropertyPanel();
    }

    syncCtx();
    if (showToast) toast('Design loaded ✓', 'success');
  }

  function registerApi() {
    registerEquipmentApi({
      getLayout: getLayout,
      isSatelliteLayout: isSatelliteLayout,
      isItpcCell: isItpcCell,
      isSidewalkCell: isSidewalkCell,
      isSatelliteFreePlacementMode: isSatelliteFreePlacementMode,
      canPlaceOltAt: canPlaceOltAt,
      resolveGridFromPlacement: resolveGridFromPlacement,
      addNode: addNode,
      isOccupied: isOccupied,
      isOccupiedFree: isOccupiedFree,
      handlePoleDrop: handlePoleDrop,
      handleClosureDrop: handleClosureDrop,
      tryInstallFatSplitter: tryInstallFatSplitter,
      findNode: findNode,
      isContextMenuEligible: isContextMenuEligible,
      showContextMenu: showContextMenu,
      positionContextMenu: positionContextMenu,
      toast: toast,
      getNodeAt: getNodeAt,
    });
    ctx.api.getLayout = getLayout;
    ctx.api.isSatelliteLayout = isSatelliteLayout;
    ctx.api.updateNodesDraggable = updateNodesDraggable;
    ctx.api.hideContextMenu = hideContextMenu;
    ctx.api.renderConnections = renderConnections;
    ctx.api.restoreDesign = restoreDesign;
    ctx.api.getNodeCenterPoint = function (nodeId) {
      var node = findNode(nodeId);
      return getNodeCenter(node, CELL_SIZE);
    };
    ctx.api.persistDesignChange = persistDesignChange;
    ctx.api.buildFiberBoq = function () {
      return buildFiberBoq(nodes, connections, CELL_SIZE);
    };
    ctx.api.rebuildToolbox = buildToolbox;
  }

  function init() {
    try {
      cacheDom();
      if (!dom.toolboxItems) {
        console.error('[Simulator] #toolbox-items missing — cannot render toolbox.');
        return;
      }
      registerApi();
      if (!dom.cityGrid) {
        console.warn('[Simulator] #city-grid missing — virtual map disabled until tab switch.');
      }

      LAYOUTS = ctx.LAYOUTS = {};
      initToolboxVals();
      initMapTheme();
      resetLayerDefaultsForLayout(currentLayout);
      if (dom.cityGrid) buildGrid();
      buildToolbox();
      bindEvents();
      bindMapLayerToggles();
      bindZoomPanEvents();
      bindEquipmentEvents();
      initLayerControls();
      registerPersistenceHooks();
      registerOsmEngine();
      registerCableEngine();
      registerGisProject();
      getDefaultGisProject();
      initGisSystem();
      bindPersistenceControls();
      initPropertyPanel();
      initMapModes();
      setMapInteractionMode('select');
      updateNodesDraggable();
      var restored = tryAutoRestoreOnInit();
      if (!restored) {
        updateMetrics();
        resetMapView();
      }
      syncCtx();
      console.info('[Simulator] Ready.');
    } catch (err) {
      console.error('[Simulator] Fatal init error:', err);
      try {
        if (dom.toolboxItems) buildToolbox();
      } catch (_e2) { /* ignore */ }
      var banner = document.getElementById('canvas-main');
      if (banner) {
        banner.insertAdjacentHTML('afterbegin',
          '<div class="sim-init-error" style="padding:8px 12px;background:#7f1d1d;color:#fecaca;font-size:12px;z-index:9999">' +
          'Simulator init error — check console. Toolbox restored where possible.</div>');
      }
    }
  }

  function cacheDom() {
    dom.cityGrid         = document.getElementById('city-grid');
    dom.connectionsLayer = document.getElementById('connections-layer');
    dom.toolboxItems     = document.getElementById('toolbox-items');
    dom.toolboxPanel     = document.getElementById('toolbox');
    dom.evalPanel        = document.getElementById('evaluation-panel');
    dom.fullscreenZone   = document.getElementById('simulator-container') || document.getElementById('fullscreen-zone');
    dom.zoomInner        = document.getElementById('canvas-zoom-inner');
    dom.zoomLabel        = document.getElementById('zoom-label');
    dom.layoutSelect     = document.getElementById('layout-select');
    dom.btnConnect       = document.getElementById('btn-connect-mode');
    dom.btnClear         = document.getElementById('btn-clear');
    dom.btnCheck         = document.getElementById('btn-check-design');
    dom.cityCanvas       = document.getElementById('city-canvas');
    dom.satelliteBgLayer = document.getElementById('satellite-bg-layer');
    dom.freeNodesLayer   = document.getElementById('free-nodes-layer');
    dom.streetLayer      = document.getElementById('street-layer');
    dom.canvasWrapper    = document.getElementById('canvas-wrapper');
    dom.mapLayerToggles  = document.getElementById('map-layer-toggles');
    dom.toolSelect         = document.getElementById('tool-select');
    dom.toolHand           = document.getElementById('tool-hand');
    dom.canvasMain       = document.getElementById('canvas-main');
    dom.contextMenu      = document.getElementById('sim-context-menu');
    dom.propertyPanel    = document.getElementById('property-panel');
  }

  function initMapTheme() {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    function applyTheme(e) {
      var theme = e.matches ? 'dark' : 'light';
      if (dom.cityCanvas) dom.cityCanvas.setAttribute('data-map-theme', theme);
      if (dom.canvasWrapper) dom.canvasWrapper.setAttribute('data-map-theme', theme);
      if (dom.canvasMain) dom.canvasMain.setAttribute('data-map-theme', theme);
    }
    applyTheme(mq);
    if (mq.addEventListener) {
      mq.addEventListener('change', applyTheme);
    } else if (mq.addListener) {
      mq.addListener(applyTheme);
    }
  }

  function findBlock(layout, col, row) {
    if (!layout.blocks) return null;
    for (var i = 0; i < layout.blocks.length; i++) {
      var b = layout.blocks[i];
      if (col >= b.c0 && col <= b.c1 && row >= b.r0 && row <= b.r1) return b;
    }
    return null;
  }

  function isBlockAnchor(block, col, row) {
    return block && col === block.c0 && row === block.r0;
  }

  function findZone(layout, col, row) {
    if (!layout.zones) return null;
    for (var i = 0; i < layout.zones.length; i++) {
      var z = layout.zones[i];
      if (col >= z.c0 && col <= z.c1 && row >= z.r0 && row <= z.r1) return z;
    }
    return null;
  }

  function isMedianCell(layout, col, row, onH, onV) {
    var onMainV = streetHas(layout.mainStreetsV, col);
    var onMainH = streetHas(layout.mainStreetsH, row);
    return (onMainV || onMainH) && !onH && !onV;
  }

  function isZoneAnchor(zone, col, row) {
    return zone && col === zone.c0 && row === zone.r0;
  }

  function zoneSpanPx(zone) {
    return {
      w: (zone.c1 - zone.c0 + 1) * CELL_SIZE,
      h: (zone.r1 - zone.r0 + 1) * CELL_SIZE,
    };
  }

  function renderBuildingPill(type, sp, icon, main, sub) {
    return '<div class="bldg-label bldg-label--' + type + '" style="width:' + sp.w + 'px;height:' + sp.h + 'px">' +
      '<div class="bldg-label__pill">' +
        '<span class="bldg-label__icon">' + icon + '</span>' +
        '<span class="bldg-label__main">' + main + '</span>' +
        (sub ? '<span class="bldg-label__sub">' + sub + '</span>' : '') +
      '</div>' +
    '</div>';
  }

  function findBlockElementAt(zone, col, row) {
    if (!zone || !zone.elements) return null;
    var lc = col - zone.c0;
    var lr = row - zone.r0;
    for (var i = 0; i < zone.elements.length; i++) {
      var e = zone.elements[i];
      if (e.lc === lc && e.lr === lr) return e;
    }
    return null;
  }

  function renderBlockCellBuilding(el) {
    return '<div class="block-cell-building block-cell-building--' + el.type + '" title="' + el.type + '">' +
      '<span class="block-cell-building__icon">' + el.icon + '</span></div>';
  }

  function renderBlockCountBadge(zone) {
    var count = zone.homes || 0;
    if (!count) return '';
    var subLabel = zone.type === 'apartment' ? 'Units' :
      zone.type === 'commercial' ? 'Mixed' : 'Block';
    return '<div class="block-count-badge" aria-hidden="true">' +
      '<span class="block-count-badge__n">' + count + '</span>' +
      '<span class="block-count-badge__lbl">' + subLabel + '</span></div>';
  }

  function computeBlockGridLayout(count) {
    var cols = Math.ceil(Math.sqrt(count * 1.12));
    var rows = Math.ceil(count / cols);
    while (cols * rows < count) cols++;
    return { cols: cols, rows: rows };
  }

  function renderBlockCommunityOverlay(zone, layout) {
    var elements = zone.elements || [];
    var count = elements.length || zone.homes || HOME_COUNT_MIN;
    var grid = computeBlockGridLayout(count);
    var sp = zoneSpanPx(zone);
    var kind = zone.type === 'baghdad_house' ? 'baghdad-house' : zone.type;
    var inset = zoneContentInsetsPx(zone, layout);
    var padL = inset.left + 4;
    var padT = inset.top + 4;
    var padR = inset.right + 4;
    var padB = inset.bottom + 4;
    var innerW = Math.max(sp.w - padL - padR, 20);
    var innerH = Math.max(sp.h - padT - padB, 16);
    var cellW = innerW / grid.cols;
    var cellH = innerH / grid.rows;
    var plots = '';
    var i, gc, gr, left, top, el, fontSize;

    for (i = 0; i < count; i++) {
      el = elements[i] || { icon: '🏠', type: 'house' };
      gc = i % grid.cols;
      gr = Math.floor(i / grid.cols);
      left = padL + gc * cellW + cellW * 0.08;
      top = padT + gr * cellH + cellH * 0.06;
      fontSize = Math.max(10, Math.min(18, Math.floor(Math.min(cellW, cellH) * 0.62)));
      plots += '<span class="block-element block-element--' + el.type + '" style="' +
        'left:' + left + 'px;top:' + top + 'px;' +
        'width:' + (cellW * 0.84) + 'px;height:' + (cellH * 0.88) + 'px;' +
        'font-size:' + fontSize + 'px" title="' + el.type + '">' + el.icon + '</span>';
    }

    var subLabel = zone.type === 'apartment' ? 'Units' :
      zone.type === 'commercial' ? 'Mixed' : 'Block';

    return '<div class="block-community block-community--' + kind + '" style="width:' + sp.w + 'px;height:' + sp.h + 'px">' +
      plots +
      '<div class="block-community__badge">' +
        '<span class="block-community__count">' + count + '</span>' +
        '<span class="block-community__label">' + subLabel + '</span>' +
      '</div></div>';
  }

  function renderHomesLabel(zone, layout) {
    return renderBlockCommunityOverlay(zone, layout);
  }

  function renderZoneOverlay(zone, layout) {
    var sp = zoneSpanPx(zone);
    var w = sp.w;
    var h = sp.h;

    if (zone.type === 'residential' || zone.type === 'baghdad_house' ||
        zone.type === 'apartment' || zone.type === 'commercial') {
      return '';
    }
    if (zone.type === 'park' || zone.type === 'greenbelt') {
      return '<div class="zone-badge zone-badge--park" style="width:' + w + 'px;height:' + h + 'px">' +
        '<span class="zone-badge__icon">🌳</span>' +
        '<span class="zone-badge__title">' + (zone.label || 'Park') + '</span>' +
      '</div>';
    }
    return '';
  }

  function renderItpcCampus(block) {
    var sp = zoneSpanPx(block);
    var logoSize = Math.min(sp.w, sp.h) * 0.38;
    return '<div class="itpc-campus itpc-campus--official" style="width:' + sp.w + 'px;height:' + sp.h + 'px">' +
      '<div class="itpc-campus__body">' +
        itpcCampusSvg(logoSize) +
        '<span class="itpc-campus__title">ITPC Exchange</span>' +
        '<span class="itpc-campus__badge">Official Exchange Building</span>' +
        '<span class="itpc-campus__sub">Ministry of Communications · OLT Hub</span>' +
        '<span class="itpc-campus__hint">OLT placement zone</span>' +
      '</div>' +
    '</div>';
  }

  function renderLandmarkBadge(block) {
    var sp = zoneSpanPx(block);
    if (block.type === 'itpc') return '';
    var icons = {
      airport: '✈️',
      hospital: '🏥',
      school: '🏫',
      tower: '🏙',
      market: '🛒',
      library: '📚',
      community: '🏛',
      park: '🌲',
    };
    var icon = icons[block.type] || '📍';
    var sub = block.floors ? block.floors + ' Floors' : (block.sub || '');
    return renderBuildingPill(block.type, sp, icon, block.label, sub);
  }

  function styleMapCell(cell, col, row, layout) {
    cell.className = 'grid-cell map-cell';
    cell.style.width  = CELL_SIZE + 'px';
    cell.style.height = CELL_SIZE + 'px';
    delete cell.dataset.landmark;
    delete cell.dataset.plotCol;
    delete cell.dataset.sidewalk;
    cell.innerHTML = '';

    var isSat = isSatelliteLayout(layout);
    if (isSat) cell.classList.add('map-cell--satellite');

    var onH = streetHas(layout.streetsH, row);
    var onV = streetHas(layout.streetsV, col);
    var mainH = streetHas(layout.mainStreetsH, row);
    var mainV = streetHas(layout.mainStreetsV, col);
    var onStreet = cellIsStreetLayout(layout, col, row);
    var onSidewalk = !onStreet && isSidewalkCell(layout, col, row);

    var itpc = layout.itpc;
    if (itpc && col >= itpc.c0 && col <= itpc.c1 && row >= itpc.r0 && row <= itpc.r1) {
      cell.classList.add('map-itpc-site');
      cell.dataset.landmark = '1';
      cell.dataset.layer = 'itpc';
      if (col === itpc.c0 && row === itpc.r0) {
        cell.innerHTML = renderItpcCampus(itpc);
      } else {
        cell.classList.add('map-itpc-site--tile');
      }
      return;
    }

    var zone = findZone(layout, col, row);

    if (onStreet) {
      cell.dataset.layer = 'street';
      if (isSat) {
        cell.classList.add('map-street-satellite');
        if (onH) cell.classList.add('map-street-satellite-h');
        if (onV) cell.classList.add('map-street-satellite-v');
      } else {
        cell.classList.add('map-street-h');
        cell.classList.add('map-street-v');
        cell.dataset.layer = 'street';
        if (streetHas(layout.streetsH, row) && !streetHas(layout.streetsV, col)) {
          cell.classList.remove('map-street-v');
        } else if (streetHas(layout.streetsV, col) && !streetHas(layout.streetsH, row)) {
          cell.classList.remove('map-street-h');
        }
        if (mainH) cell.classList.add('map-street-main-h');
        if (mainV) cell.classList.add('map-street-main-v');
        if (streetHas(layout.streetsH, row) && streetHas(layout.streetsV, col)) {
          cell.classList.add('map-street-x');
        }
      }
    } else if (onSidewalk) {
      cell.dataset.layer = 'sidewalk';
      cell.classList.add('map-sidewalk');
      if (isSat) cell.classList.add('map-sidewalk--satellite');
      cell.dataset.sidewalk = '1';
      if (row > 0 && streetHas(layout.streetsH, row - 1)) cell.classList.add('map-sidewalk--border-n');
      if (row < GRID_ROWS - 1 && streetHas(layout.streetsH, row + 1)) cell.classList.add('map-sidewalk--border-s');
      if (col > 0 && streetHas(layout.streetsV, col - 1)) cell.classList.add('map-sidewalk--border-w');
      if (col < GRID_COLS - 1 && streetHas(layout.streetsV, col + 1)) cell.classList.add('map-sidewalk--border-e');
    } else if (zone) {
      cell.classList.add('map-zone', 'map-zone--' + zone.type);
      if (zone.type === 'residential' || zone.type === 'baghdad_house' ||
          zone.type === 'apartment' || zone.type === 'commercial' ||
          zone.type === 'satellite_parcel') {
        if (isSat) cell.classList.add('map-satellite-parcel');
        else cell.classList.add('map-home-plot');
        if (zone.type === 'baghdad_house' || zone.type === 'apartment') {
          cell.dataset.plotCol = String(col - zone.c0);
        }
        var blockEl = findBlockElementAt(zone, col, row);
        if (blockEl) {
          cell.classList.add('map-block-filled');
          if (blockEl.type === 'tree') {
            cell.classList.add('map-block-tree');
            cell.dataset.layer = 'tree';
          } else {
            cell.classList.add('map-block-building');
            cell.dataset.layer = 'building';
          }
          if (isSat) cell.classList.add('map-satellite-marker');
          cell.innerHTML = renderBlockCellBuilding(blockEl);
        } else if (!isSat) {
          cell.classList.add('map-block-inner');
        }
        if (!isSat && isZoneAnchor(zone, col, row)) {
          cell.innerHTML += renderBlockCountBadge(zone);
        }
      } else if (isZoneAnchor(zone, col, row)) {
        cell.innerHTML = renderZoneOverlay(zone, layout);
      }
    } else if (isSat) {
      cell.classList.add('map-satellite-open');
    }

    if (!isSat && isMedianCell(layout, col, row, onH, onV)) {
      cell.classList.add('map-median');
      cell.innerHTML = '<span class="median-palm" aria-hidden="true">🌴</span>';
    }

    var block = findBlock(layout, col, row);
    if (block) {
      if (block.type === 'itpc') return;
      cell.classList.remove('map-zone', 'map-zone--residential', 'map-zone--baghdad_house', 'map-zone--apartment', 'map-zone--commercial', 'map-zone--park', 'map-zone--greenbelt');
      cell.classList.add('map-landmark', 'map-landmark--' + block.type);
      cell.dataset.landmark = '1';
      if (isBlockAnchor(block, col, row)) {
        cell.innerHTML = renderLandmarkBadge(block);
      } else {
        cell.innerHTML = '';
      }
    }

    if (cell.dataset.layer !== 'street' && cell.dataset.layer !== 'sidewalk') {
      cell.classList.add('map-cell--grid-eligible');
    }
  }

  function ensureConnectionsLayer(grid) {
    if (!dom.connectionsLayer || !grid) return;
    dom.connectionsLayer.setAttribute('class', 'map-connections-layer');
    dom.connectionsLayer.setAttribute('aria-hidden', 'true');
    if (dom.connectionsLayer.parentNode !== grid) {
      grid.insertBefore(dom.connectionsLayer, grid.firstChild);
    }
  }

  function resolveNodeIdFromEvent(e) {
    var nodeEl = e.target.closest('.node');
    if (!nodeEl) return null;
    return nodeEl.dataset.id || nodeEl.dataset.nodeId || nodeEl.id || null;
  }

  function onGridNodeClick(e) {
    var nodeElement = e.target.closest('.node');
    if (!nodeElement) return;

    e.preventDefault();
    e.stopPropagation();

    var nodeId = nodeElement.dataset.id || nodeElement.dataset.nodeId || nodeElement.id;
    if (!nodeId) return;

    if (connectMode) {
      onNodeClick(nodeId);
      return;
    }

    onNodeClick(nodeId);
  }

  function getConnectionCableSpec() {
    if (activeCable) return activeCable;
    if (connectMode) {
      var tool = findTool(selectedCableId);
      if (tool && tool.isCable) {
        return {
          cableId: selectedCableId,
          fibers: toolboxVals[selectedCableId],
          label: tool.label,
        };
      }
    }
    return null;
  }

  function isContextMenuEligible(node) {
    return node && CONTEXT_MENU_TYPES[node.type] === true;
  }

  function getNodeContextTitle(node) {
    if (node.type === 'pole_foundation') return node.hasPole ? 'pole' : 'pole foundation';
    if (node.type === 'fdt') return 'FDT Cabinet';
    if (node.type === 'handhole') return 'handhole';
    return node.type;
  }

  function buildContextMenuModel(node) {
    var items = [];
    var closureMax = findTool('closure').max;
    var canClosure = isClosureHost(node) && !node.hasClosure && getClosureCount() < closureMax;

    items.push({
      id: 'lock',
      label: node.locked ? '🔓 Unlock Position' : '🔒 Lock Position',
      active: !!node.locked,
    });

    if (node.type === 'pole_foundation' && node.hasPole) {
      var splRatio = toolboxVals.splitter || '1x8';
      items.push({
        id: 'add-splitter',
        label: '📥 Add Splitter to FAT (' + splRatio + ')',
        disabled: false,
      });
    }

    if (canClosure) {
      items.push({
        id: 'insert-closure',
        label: '📥 Insert Closure',
        disabled: false,
      });
    }

    items.push({ divider: true });
    items.push({ id: 'delete', label: '🗑️ Delete', danger: true });
    return { title: getNodeContextTitle(node), items: items };
  }

  function getCellFromEvent(e) {
    if (!dom.cityGrid) return null;
    var cell = e.target.closest('.map-cell');
    if (!cell || !dom.cityGrid.contains(cell)) return null;
    return cell;
  }

  function getCellCoords(cell) {
    if (!cell) return null;
    return {
      col: parseInt(cell.dataset.col, 10),
      row: parseInt(cell.dataset.row, 10),
    };
  }

  function isOccupiedFree(px, py, ignoreId) {
    var minDist = CELL_SIZE * 0.35;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.id === ignoreId) continue;
      if (n.free && n.px != null && n.py != null) {
        var dx = n.px - px;
        var dy = n.py - py;
        if (dx * dx + dy * dy < minDist * minDist) return true;
      } else if (n.px == null) {
        var cx = n.col * CELL_SIZE + CELL_SIZE / 2;
        var cy = n.row * CELL_SIZE + CELL_SIZE / 2;
        var dx2 = cx - px;
        var dy2 = cy - py;
        if (dx2 * dx2 + dy2 * dy2 < minDist * minDist) return true;
      }
    }
    return false;
  }

  function positionContextMenu(clientX, clientY) {
    var menu = dom.contextMenu;
    if (!menu) return;
    menu.classList.remove('hidden');
    menu.setAttribute('aria-hidden', 'false');
    var pad = 8;
    var w = menu.offsetWidth;
    var h = menu.offsetHeight;
    var left = Math.max(pad, Math.min(clientX, window.innerWidth - w - pad));
    var top = Math.max(pad, Math.min(clientY, window.innerHeight - h - pad));
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }

  function runContextMenuAction(actionId, node) {
    if (!node) return;
    hideContextMenu();

    if (actionId === 'lock') {
      toggleNodeLock(node);
      return;
    }
    if (actionId === 'delete') {
      removeNode(node.id);
      return;
    }
    if (actionId === 'add-splitter') {
      tryInstallFatSplitter(node, toolboxVals.splitter || '1x8');
      return;
    }
    if (actionId === 'insert-closure') {
      tryInstallClosure(node);
    }
  }

  function showContextMenu(clientX, clientY, node) {
    if (!dom.contextMenu || !node || !isContextMenuEligible(node)) return;
    contextMenuNodeId = node.id;
    ctx.contextMenuNodeId = node.id;
    var model = buildContextMenuModel(node);

    var html = '<div class="sim-context-menu__header">' + model.title + '</div>';
    model.items.forEach(function (item) {
      if (item.divider) {
        html += '<div class="sim-context-menu__divider"></div>';
        return;
      }
      var cls = 'sim-context-menu__item';
      if (item.danger) cls += ' sim-context-menu__item--danger';
      if (item.active) cls += ' sim-context-menu__item--active';
      html += '<button type="button" class="' + cls + '" data-action="' + item.id + '"' +
        (item.disabled ? ' disabled' : '') + '>' + item.label + '</button>';
    });
    dom.contextMenu.innerHTML = html;

    dom.contextMenu.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var target = findNode(contextMenuNodeId);
        runContextMenuAction(btn.dataset.action, target);
      });
    });

    positionContextMenu(clientX, clientY);
  }

  function toggleNodeLock(node) {
    if (!node) return;
    node.locked = !node.locked;
    renderNode(node);
    updateNodesDraggable();
    toast(node.locked ? 'Position locked ✓' : 'Position unlocked', node.locked ? 'success' : 'warn');
    persistDesignChange();
  }

  function onGridTouchStart(e) {
    if (e.touches.length !== 1) return;
    var nodeEl = e.target.closest('.placed-node');
    if (!nodeEl) return;
    var node = findNode(nodeEl.dataset.nodeId);
    if (!isContextMenuEligible(node)) return;
    var touch = e.touches[0];
    clearTimeout(touchContextTimer);
    touchContextTimer = setTimeout(function () {
      showContextMenu(touch.clientX, touch.clientY, node);
    }, 520);
  }

  function onGridTouchEnd() {
    clearTimeout(touchContextTimer);
  }

  function initToolboxVals() {
    TOOLBOX.forEach(function (item) {
      if (item.dropdown) {
        toolboxVals[item.id] = item.defaultVal || item.dropdown[0];
      }
    });
  }

  /* ═══════════════════════════════════════
     GRID
     ═══════════════════════════════════════ */
  function countAutoBuildings(layout) {
    layout = layout || getLayout(currentLayout);
    var total = 0;
    if (!layout || !layout.zones) return 0;
    layout.zones.forEach(function (z) {
      if (z.homes) {
        total += z.homes;
      } else if (z.elements) {
        z.elements.forEach(function (e) {
          if (e.type !== 'tree') total++;
        });
      }
    });
    return total;
  }

  function buildGrid() {
    applyGridDimensionsMain(currentLayout);
    var grid = dom.cityGrid;
    var layout = getLayout(currentLayout);
    var w = MAP_W;
    var h = MAP_H;

    grid.style.gridTemplateColumns = 'repeat(' + GRID_COLS + ', ' + CELL_SIZE + 'px)';
    grid.style.gridTemplateRows    = 'repeat(' + GRID_ROWS + ', ' + CELL_SIZE + 'px)';
    grid.style.width  = w + 'px';
    grid.style.height = h + 'px';
    grid.innerHTML = '';
    ensureConnectionsLayer(grid);

    if (dom.cityCanvas) {
      dom.cityCanvas.style.width = w + 'px';
      dom.cityCanvas.style.height = h + 'px';
      dom.cityCanvas.style.minWidth = '0';
      dom.cityCanvas.style.minHeight = '0';
    }
    applyLayoutCanvas(layout);
    if (dom.freeNodesLayer) {
      dom.freeNodesLayer.style.width = w + 'px';
      dom.freeNodesLayer.style.height = h + 'px';
      dom.freeNodesLayer.innerHTML = '';
    }
    setText('grid-info', isSatelliteLayout(layout)
      ? 'Real Satellite Map · ' + MAP_W + '×' + MAP_H + 'px'
      : GRID_COLS + ' × ' + GRID_ROWS + ' · ' + MAP_W + 'px');

    var frag = document.createDocumentFragment();
    for (var r = 0; r < GRID_ROWS; r++) {
      for (var c = 0; c < GRID_COLS; c++) {
        var cell = document.createElement('div');
        cell.dataset.col = c;
        cell.dataset.row = r;
        styleMapCell(cell, c, r, layout);
        frag.appendChild(cell);
      }
    }
    grid.appendChild(frag);

    ensureItpcOlt(layout);
    for (var hi = nodes.length - 1; hi >= 0; hi--) {
      if (nodes[hi].type === 'home') nodes.splice(hi, 1);
    }
    nodes.forEach(function (n) { renderNode(n); });
    renderConnections();
    updateNodesDraggable();
  }

  function getCell(col, row) {
    return dom.cityGrid.querySelector('[data-col="' + col + '"][data-row="' + row + '"]');
  }

  function isBlocked(col, row) {
    var layout = getLayout(currentLayout);
    if (isItpcCell(layout, col, row)) return false;
    var cell = getCell(col, row);
    return cell && cell.dataset.landmark === '1';
  }

  function isOccupied(col, row, ignoreId) {
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.col === col && n.row === row && n.id !== ignoreId) {
        return true;
      }
    }
    return false;
  }

  function switchLayout(id) {
    if (ctx.mapMode === 'osm') {
      if (dom.layoutSelect) dom.layoutSelect.value = currentLayout;
      toast('Switch to Virtual City mode to change grid layout', 'warn');
      return;
    }
    if (id === currentLayout) return;
    if (nodes.length > 0 && !window.confirm('Change layout? All components will be cleared.')) {
      if (dom.layoutSelect) dom.layoutSelect.value = currentLayout;
      return;
    }
    currentLayout = id;
    ctx.currentLayout = id;
    nodes.length = 0;
    connections.length = 0;
    connectFrom = null;
    ctx.connectFrom = null;
    LAYOUTS = {};
    ctx.LAYOUTS = LAYOUTS;
    applyGridDimensionsMain(id);
    resetLayerDefaultsForLayout(id);
    buildGrid();
    buildToolbox();
    syncLayerToggleButtons();
    updateMetrics();
    resetMapView();
    persistDesignChange();
  }

  /* ═══════════════════════════════════════
     TOOLBOX
     ═══════════════════════════════════════ */
  function buildToolbox() {
    var container = dom.toolboxItems;
    container.innerHTML = '';
    var isOsm = ctx.mapMode === 'osm';

    TOOLBOX.forEach(function (item) {
      if (item.gisOnly && !isOsm) return;

      var count;
      if (item.isCable) {
        count = 0;
      } else if (item.id === 'network_zone') {
        count = (ctx.gisNetworkZones && ctx.gisNetworkZones.length) || 0;
      } else if (isOsm && ctx.api.countGisByType) {
        if (item.id === 'closure') {
          count = ctx.api.countGisByType('closure');
        } else if (item.id === 'pole') {
          count = ctx.api.countGisByType('pole') + ctx.api.countGisByType('pole_foundation');
        } else {
          count = ctx.api.countGisByType(item.id);
        }
      } else if (item.id === 'closure') {
        count = getClosureCount();
      } else if (item.id === 'pole') {
        count = getPoleCount();
      } else {
        count = nodes.filter(function (n) { return n.type === item.id; }).length;
      }

      var el = document.createElement('div');
      el.className = 'toolbox-item flex items-center gap-3 p-3 rounded-xl border border-fiber-border bg-fiber-card hover:border-fiber-cyan/40 transition-all select-none';
      if (item.isCable) el.classList.add('toolbox-item--cable');
      el.dataset.type = item.id;

      var canDrag;
      if (item.isCable) {
        canDrag = true;
      } else if (item.id === 'network_zone') {
        canDrag = false;
      } else if (isOsm) {
        canDrag = count < item.max;
      } else if (item.id === 'olt') {
        canDrag = count < item.max && !!getLayout(currentLayout).itpc;
      } else if (item.id === 'closure') {
        canDrag = getClosureCount() < item.max;
      } else if (item.id === 'pole') {
        canDrag = getPoleCount() < item.max;
      } else {
        canDrag = count < item.max;
      }
      el.draggable = canDrag;
      if (!canDrag) el.classList.add('opacity-40');

      var iconHtml;
      if (item.visual === 'olt') {
        iconHtml = '<span class="toolbox-item__icon toolbox-item__icon--olt w-9 h-9 shrink-0 flex items-center justify-center">' +
          oltIconSvg(32) + '</span>';
      } else if (item.visual === 'zone') {
        iconHtml = '<span class="toolbox-item__icon w-9 h-9 shrink-0 flex items-center justify-center rounded-sm" style="background:#f59e0b33;border:1px solid #f59e0b88">' +
          '<span style="display:block;width:20px;height:16px;background:#f59e0b55;border:1px dashed #fbbf24;border-radius:2px"></span></span>';
      } else if (item.visual === 'fdt') {
        iconHtml = '<span class="toolbox-item__icon w-9 h-9 shrink-0 flex items-center justify-center rounded-sm" style="background:#f59e0b22;border:1px solid #f59e0b66">' +
          '<span style="display:block;width:18px;height:22px;border:1px solid #f59e0b;border-radius:2px;background:#1e293b"></span></span>';
      } else if (item.visual === 'splitter') {
        iconHtml = '<span class="toolbox-item__icon toolbox-item__icon--splitter w-9 h-9 shrink-0 flex items-center justify-center" data-icon="splitter">' +
          splitterIconSvg(toolboxVals.splitter || item.defaultVal, 32) + '</span>';
      } else if (item.visual === 'handhole') {
        iconHtml = '<span class="toolbox-item__icon toolbox-item__icon--handhole w-9 h-9 shrink-0 flex items-center justify-center">' +
          handholeIconSvg(32) + '</span>';
      } else if (item.visual === 'foundation') {
        iconHtml = '<span class="toolbox-item__icon toolbox-item__icon--foundation w-9 h-9 shrink-0 flex items-center justify-center">' +
          foundationIconSvg(32) + '</span>';
      } else if (item.visual === 'pole') {
        iconHtml = '<span class="toolbox-item__icon toolbox-item__icon--pole w-10 h-10 shrink-0 flex items-center justify-center">' +
          poleIconSvg(36) + '</span>';
      } else if (item.visual === 'closure') {
        iconHtml = '<span class="toolbox-item__icon toolbox-item__icon--closure w-9 h-9 shrink-0 flex items-center justify-center">' +
          closureIconSvg(32) + '</span>';
      } else {
        iconHtml = '<span class="toolbox-item__icon text-xl w-9 h-9 shrink-0 flex items-center justify-center rounded-lg" style="background:' +
          item.color + '22;border:1px solid ' + item.color + '44">' + item.icon + '</span>';
      }

      el.innerHTML = iconHtml +
        '<div class="toolbox-item__text toolbox-collapsible-text flex-1 min-w-0">' +
          '<p class="text-xs font-semibold text-white truncate">' + item.label +
            (item.id === 'olt' ? ' (ITPC)' : '') + '</p>' +
        '</div>';

      if (item.dropdown) {
        var sel = document.createElement('select');
        sel.className = 'toolbox-item__select toolbox-collapsible-text';
        item.dropdown.forEach(function (opt) {
          var o = document.createElement('option');
          o.value = opt;
          o.textContent = item.isCable ? (opt + ' fibers') : opt;
          sel.appendChild(o);
        });
        sel.value = toolboxVals[item.id];
        sel.addEventListener('mousedown', function (e) { e.stopPropagation(); });
        sel.addEventListener('change', function () {
          toolboxVals[item.id] = sel.value;
          if (item.id === 'splitter') {
            updateSplitterToolboxIcon(el, sel.value);
          }
          if (item.isCable) selectedCableId = item.id;
          if (activeCable && activeCable.cableId === item.id) {
            activeCable.fibers = sel.value;
          }
        });
        el.appendChild(sel);
        if (item.id === 'splitter') {
          updateSplitterToolboxIcon(el, sel.value);
        }
      }

      if (item.isCable) {
        el.title = 'Click or drag onto a node to connect';
        el.addEventListener('click', function () {
          if (suppressCableClick) return;
          setSelectedToolboxType(null);
          selectedCableId = item.id;
          
          // Check for batch duplication when cable is selected from toolbox
          var kind = item.id === 'cable_lastmile' ? 'lastmile' : 'distribution';
          var batch = 1;
          var capacity = kind === 'lastmile' ? 12 : 72;
          if (window.Sim && window.Sim.ui && window.Sim.ui.cableConfig) {
            var cfg = window.Sim.ui.cableConfig[kind];
            if (cfg) {
              batch = cfg.batch;
              capacity = cfg.capacity;
            }
          }
          var hintElement = document.getElementById('toolbox-footer-hint');
          if (hintElement && window.Sim && window.Sim.fiberCablePaths) {
            var isDuplicate = false;
            for (var i = 0; i < window.Sim.fiberCablePaths.length; i++) {
              var cable = window.Sim.fiberCablePaths[i];
              if (cable && Number(cable.batch) === Number(batch) && cable.kind === kind) {
                isDuplicate = true;
                break;
              }
            }
            if (isDuplicate) {
              hintElement.textContent = capacity + 'F' + batch + ' Duplicated ❗';
              hintElement.style.color = '#ff4d4d';
              hintElement.style.fontWeight = 'bold';
            } else {
              hintElement.textContent = '💡 على الرصيف فقط · FAT Pole فوق المثلث → FAT1';
              hintElement.style.color = '';
              hintElement.style.fontWeight = '';
            }
          }
          
          armCable(item.id);
        });
      } else if (!isOsm && !item.gisOnly) {
        el.addEventListener('click', function (ev) {
          if (ev.target.closest('select')) return;
          setSelectedToolboxType(item.id);
          toast(item.label + ' — right-click sidewalk to place', 'success');
        });
      }

      if (item.id === 'pole') {
        el.title = 'pole — drop onto pole foundation';
      }
      if (item.id === 'pole_foundation') {
        el.title = 'pole foundation';
      }
      if (item.id === 'olt') {
        el.title = isOsm
          ? 'OLT — install inside ITPC Exchange Building only'
          : 'OLT — install inside ITPC Exchange only (feeder origin)';
      }

      if (!isOsm) {
        el.addEventListener('dragstart', onToolboxDragStart);
        el.addEventListener('dragend', onToolboxDragEnd);
      }
      container.appendChild(el);
    });

    updateCableArmedUI();
    if (selectedToolboxType) setSelectedToolboxType(selectedToolboxType);
  }

  /* ═══════════════════════════════════════
     DRAG & DROP
     ═══════════════════════════════════════ */
  function onToolboxDragStart(e) {
    if (ctx.mapMode === 'osm') return;
    if (ctx.mapInteractionMode === 'hand') {
      e.preventDefault();
      return;
    }
    var type = e.currentTarget.dataset.type;
    var item = findTool(type);
    if (!item) { e.preventDefault(); return; }

    if (item.isCable) {
      e.dataTransfer.setData('text/cable', JSON.stringify({
        cableId: type,
        fibers: toolboxVals[type],
        label: item.label,
      }));
    } else if (type === 'closure') {
      if (getClosureCount() >= item.max) { e.preventDefault(); return; }
      e.dataTransfer.setData('text/closure', '1');
      e.dataTransfer.setData('text/new', JSON.stringify({ type: type }));
    } else if (type === 'pole') {
      if (getPoleCount() >= item.max) { e.preventDefault(); return; }
      e.dataTransfer.setData('text/pole', '1');
      e.dataTransfer.setData('text/new', JSON.stringify({ type: type }));
    } else if (type === 'splitter') {
      var splCount = nodes.filter(function (n) { return n.type === 'splitter'; }).length;
      if (splCount >= item.max) { e.preventDefault(); return; }
      e.dataTransfer.setData('text/splitter-install', '1');
      e.dataTransfer.setData('text/new', JSON.stringify({
        type: type,
        variant: toolboxVals[type] || null,
      }));
    } else if (type === 'olt') {
      if (nodes.filter(function (n) { return n.type === 'olt'; }).length >= item.max) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData('text/olt', '1');
      e.dataTransfer.setData('text/new', JSON.stringify({ type: type }));
    } else {
      var count = nodes.filter(function (n) { return n.type === type; }).length;
      if (count >= item.max) { e.preventDefault(); return; }
      e.dataTransfer.setData('text/new', JSON.stringify({
        type: type,
        variant: toolboxVals[type] || null,
      }));
      if (requiresSidewalkPlacement(type)) {
        e.dataTransfer.setData('text/sidewalk-equip', type);
      }
    }
    e.dataTransfer.effectAllowed = 'copy';
    e.currentTarget.classList.add('opacity-50');
    if (item.isCable) suppressCableClick = true;
  }

  function onToolboxDragEnd(e) {
    e.currentTarget.classList.remove('opacity-50');
    clearHighlights();
    if (e.currentTarget.classList.contains('toolbox-item--cable')) {
      setTimeout(function () { suppressCableClick = false; }, 80);
    }
  }

  function onNodeDragStart(e) {
    if (ctx.mapInteractionMode === 'hand' || connectMode) {
      e.preventDefault();
      return;
    }
    var node = findNode(e.currentTarget.dataset.nodeId);
    if (node && node.locked) {
      e.preventDefault();
      toast('Element is locked — unlock from context menu', 'warn');
      return;
    }
    e.stopPropagation();
    e.dataTransfer.setData('text/move', e.currentTarget.dataset.nodeId);
    if (node && requiresSidewalkPlacement(node.type)) {
      e.dataTransfer.setData('text/sidewalk-equip', node.type);
    }
    if (node && node.type === 'olt') {
      e.dataTransfer.setData('text/olt-move', '1');
    }
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.classList.add('dragging');
  }

  function onNodeDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    clearHighlights();
  }

  function clearCellDropHighlight(cell) {
    if (!cell) return;
    cell.classList.remove('drop-target');
    cell.classList.remove('sidewalk-drop-target');
    cell.classList.remove('pole-drop-target');
    cell.classList.remove('fat-drop-target');
    cell.classList.remove('itpc-drop-target');
    cell.classList.remove('closure-drop-target');
  }

  function onGridDragOver(e) {
    if (ctx.mapInteractionMode === 'hand') return;
    var cell = getCellFromEvent(e);
    if (!cell) {
      if (lastDragOverCell) {
        clearCellDropHighlight(lastDragOverCell);
        lastDragOverCell = null;
      }
      return;
    }
    if (lastDragOverCell && lastDragOverCell !== cell) {
      clearCellDropHighlight(lastDragOverCell);
    }
    lastDragOverCell = cell;
    handleCellDragOver(cell, e);
  }

  function onGridDragLeave(e) {
    if (!dom.cityGrid || dom.cityGrid.contains(e.relatedTarget)) return;
    if (lastDragOverCell) {
      clearCellDropHighlight(lastDragOverCell);
      lastDragOverCell = null;
    }
  }

  function onGridDrop(e) {
    var cell = getCellFromEvent(e);
    if (!cell) return;
    if (lastDragOverCell) {
      clearCellDropHighlight(lastDragOverCell);
      lastDragOverCell = null;
    }
    handleCellDrop(cell, e);
  }

  function handleCellDragOver(cell, e) {
    e.preventDefault();
    var col = parseInt(cell.dataset.col, 10);
    var row = parseInt(cell.dataset.row, 10);
    var isOlt = e.dataTransfer.types.indexOf('text/olt') >= 0;
    var isOltMove = e.dataTransfer.types.indexOf('text/olt-move') >= 0;
    var isClosure = e.dataTransfer.types.indexOf('text/closure') >= 0;
    var isPole = e.dataTransfer.types.indexOf('text/pole') >= 0;
    var isSplitter = e.dataTransfer.types.indexOf('text/splitter-install') >= 0;
    var isSidewalkEquip = e.dataTransfer.types.indexOf('text/sidewalk-equip') >= 0;
    var isMove = e.dataTransfer.types.indexOf('text/move') >= 0;
    e.dataTransfer.dropEffect = isMove ? 'move' : 'copy';
    if (isBlocked(col, row)) return;
    if (isOlt || isOltMove) {
      if (validateOltPlacement(col, row).ok) {
        cell.classList.add('drop-target', 'itpc-drop-target');
      }
      return;
    }
    if (isSidewalkEquip) {
      if (isSatelliteFreePlacementMode() || (validateEquipmentPlacement('pole_foundation', col, row).ok && !isOccupied(col, row))) {
        cell.classList.add('drop-target', 'sidewalk-drop-target');
      }
      return;
    }
    if (isClosure) {
      var closureTarget = getNodeAt(col, row);
      if (closureTarget && isClosureHost(closureTarget) && !closureTarget.hasClosure) {
        cell.classList.add('closure-drop-target');
      }
      return;
    }
    if (isPole) {
      var poleTarget = getNodeAt(col, row);
      if (poleTarget && poleTarget.type === 'pole_foundation' && !poleTarget.hasPole) {
        cell.classList.add('pole-drop-target');
      }
      return;
    }
    if (isSplitter) {
      var splTarget = getNodeAt(col, row);
      if (splTarget && splTarget.type === 'pole_foundation' && splTarget.hasPole) {
        cell.classList.add('fat-drop-target');
      } else if (!isOccupied(col, row)) {
        cell.classList.add('drop-target');
      }
      return;
    }
    if (!isBlocked(col, row) || isSatelliteFreePlacementMode()) {
      cell.classList.add('drop-target');
    }
  }

  function handleCellDrop(cell, e) {
    if (ctx.mapInteractionMode === 'hand') return;
    e.preventDefault();
    clearHighlights();
    lastDragOverCell = null;
    var col = parseInt(cell.dataset.col, 10);
    var row = parseInt(cell.dataset.row, 10);
    var placePt = placementCoordsFromEvent(e);

    if (isBlocked(col, row) && !isSatelliteFreePlacementMode()) {
      toast('Cannot place on landmark', 'warn');
      return;
    }

    var moveId = e.dataTransfer.getData('text/move');
    if (moveId) {
      var moved = findNode(moveId);
      if (moved && moved.free && isSatelliteFreePlacementMode() && placePt) {
        moveNodeFree(moveId, placePt.col, placePt.row, placePt.px, placePt.py);
      } else {
        moveNode(moveId, col, row);
      }
      return;
    }

    var newRaw = e.dataTransfer.getData('text/new');
    if (newRaw) {
      var data = JSON.parse(newRaw);
      if (data.type === 'closure') {
        handleClosureDrop(col, row);
        return;
      }
      if (data.type === 'pole') {
        handlePoleDrop(col, row);
        return;
      }
      if (data.type === 'splitter') {
        var splExisting = getNodeAt(col, row);
        if (splExisting && splExisting.type === 'pole_foundation' && splExisting.hasPole) {
          tryInstallFatSplitter(splExisting, data.variant);
          return;
        }
        if (splExisting && splExisting.type === 'pole_foundation' && !splExisting.hasPole) {
          toast('Install pole on foundation first — then drop Splitter on FAT', 'warn');
          return;
        }
      }
      if (data.type === 'olt') {
        var oltCheck = validateOltPlacement(col, row);
        if (!oltCheck.ok) {
          toast(oltCheck.msg, 'error');
          return;
        }
        if (!isOccupied(col, row)) addNode(data.type, col, row, data.variant);
        return;
      }
      if (requiresSidewalkPlacement(data.type) && isSatelliteFreePlacementMode() && placePt) {
        if (!isOccupiedFree(placePt.px, placePt.py)) {
          addNode(data.type, placePt.col, placePt.row, data.variant, {
            free: true, px: placePt.px, py: placePt.py,
          });
        }
        return;
      }
      if (!isOccupied(col, row)) {
        if (requiresSidewalkPlacement(data.type)) {
          var placeCheck = validateEquipmentPlacement(data.type, col, row);
          if (!placeCheck.ok) {
            showPlacementError(placeCheck.msg);
            return;
          }
        }
        addNode(data.type, col, row, data.variant);
      }
    }
  }

  function onNodeDropComponent(e) {
    var isClosure = e.dataTransfer.getData('text/closure');
    if (isClosure) {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.classList.remove('closure-drop-target');
      tryInstallClosure(findNode(e.currentTarget.dataset.nodeId));
      return;
    }

    var newRaw = e.dataTransfer.getData('text/new');
    if (!newRaw) return;
    var data;
    try { data = JSON.parse(newRaw); } catch (err) { return; }

    var node = findNode(e.currentTarget.dataset.nodeId);
    if (!node) return;

    if (data.type === 'pole') {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.classList.remove('pole-drop-target');
      tryInstallPole(node);
      return;
    }
    if (data.type === 'splitter') {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.classList.remove('fat-drop-target');
      tryInstallFatSplitter(node, data.variant);
    }
  }

  function onNodeDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    var isCable = e.dataTransfer.types.indexOf('text/cable') >= 0;
    var isClosure = e.dataTransfer.types.indexOf('text/closure') >= 0;
    var isPole = e.dataTransfer.types.indexOf('text/pole') >= 0;
    var isSplitter = e.dataTransfer.types.indexOf('text/splitter-install') >= 0;
    var node = findNode(e.currentTarget.dataset.nodeId);
    if (isCable) {
      e.dataTransfer.dropEffect = 'copy';
      e.currentTarget.classList.add('cable-drop-target');
    }
    if (isClosure && node && isClosureHost(node) && !node.hasClosure) {
      e.dataTransfer.dropEffect = 'copy';
      e.currentTarget.classList.add('closure-drop-target');
    }
    if (isPole && node && node.type === 'pole_foundation' && !node.hasPole) {
      e.dataTransfer.dropEffect = 'copy';
      e.currentTarget.classList.add('pole-drop-target');
    }
    if (isSplitter && node && node.type === 'pole_foundation' && node.hasPole) {
      e.dataTransfer.dropEffect = 'copy';
      e.currentTarget.classList.add('fat-drop-target');
    }
  }

  function onNodeDragLeave(e) {
    e.currentTarget.classList.remove('cable-drop-target');
    e.currentTarget.classList.remove('closure-drop-target');
    e.currentTarget.classList.remove('pole-drop-target');
    e.currentTarget.classList.remove('fat-drop-target');
  }

  function onNodeDropCable(e) {
    var raw = e.dataTransfer.getData('text/cable');
    if (!raw) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('cable-drop-target');
    var spec = JSON.parse(raw);
    activeCable = spec;
    setConnectMode(true, true);
    beginConnectionFrom(e.currentTarget.dataset.nodeId);
  }

  /* ═══════════════════════════════════════
     NODES
     ═══════════════════════════════════════ */
  function addNode(type, col, row, variant, freeOpts) {
    var item = findTool(type);
    if (!item || item.isCable) return;
    if (type === 'olt') {
      if (freeOpts && freeOpts.free) freeOpts = null;
      var oltPlace = validateOltPlacement(col, row);
      if (!oltPlace.ok) {
        toast(oltPlace.msg, 'error');
        return;
      }
    } else if (type === 'closure') {
      showClosureRuleFeedback('empty');
      toast('Drop Closure onto Handhole or Pole Foundation', 'error');
      return;
    }
    if (type === 'home') {
      toast('Homes are auto-generated in city blocks', 'warn');
      return;
    }
    if (type === 'pole') {
      showPoleRuleFeedback();
      toast('يجب صب القاعدة الخرسانية أولاً قبل نصب العمود ميدانياً', 'error');
      return;
    }
    if (type !== 'olt') {
      var placement = validateEquipmentPlacement(type, col, row);
      if (!placement.ok) {
        showPlacementError(placement.msg);
        return;
      }
    }
    if (type === 'pole_foundation') {
      if (nodes.filter(function (n) { return n.type === type; }).length >= item.max) return;
    } else if (nodes.filter(function (n) { return n.type === type; }).length >= item.max) {
      return;
    }

    var node = {
      id: 'n' + (++nodeId),
      type: type,
      col: col,
      row: row,
      variant: variant || null,
    };
    if (freeOpts && freeOpts.free && freeOpts.px != null && freeOpts.py != null) {
      var clamped = clampMapPoint(freeOpts.px, freeOpts.py);
      node.free = true;
      node.px = clamped.px;
      node.py = clamped.py;
      if (isOccupiedFree(node.px, node.py)) {
        toast('Too close to another component', 'warn');
        return;
      }
    }
    if (type === 'pole_foundation') {
      node.hasClosure = false;
      node.hasPole = false;
      node.fatSplitter = null;
    }
    nodes.push(node);
    ctx.nodeId = nodeId;
    if (!node.meta) node.meta = {};
    renderNode(node);
    buildToolbox();
    updateMetrics();
    persistDesignChange();
  }

  function moveNodeFree(id, col, row, px, py) {
    var node = findNode(id);
    if (!node || !node.free) {
      moveNode(id, col, row);
      return;
    }
    if (node.locked) {
      toast('Element is locked — unlock from context menu', 'warn');
      return;
    }
    var clamped = clampMapPoint(px, py);
    if (isOccupiedFree(clamped.px, clamped.py, id)) {
      toast('Too close to another component', 'warn');
      return;
    }
    if (node.type !== 'olt') {
      var placement = validateEquipmentPlacement(node.type, col, row);
      if (!placement.ok) {
        showPlacementError(placement.msg);
        return;
      }
    }
    node.col = col;
    node.row = row;
    node.px = clamped.px;
    node.py = clamped.py;
    renderNode(node);
    renderConnections();
    persistDesignChange();
  }

  function moveNode(id, col, row) {
    var node = findNode(id);
    if (!node || (node.col === col && node.row === row)) return;
    if (node.locked) {
      toast('Element is locked — unlock from context menu', 'warn');
      return;
    }
    if (node.type === 'olt') {
      var oltMove = validateOltPlacement(col, row, id);
      if (!oltMove.ok) {
        toast(oltMove.msg, 'error');
        return;
      }
    } else {
      var placement = validateEquipmentPlacement(node.type, col, row);
      if (!placement.ok) {
        showPlacementError(placement.msg);
        return;
      }
    }
    if (isOccupied(col, row, id)) {
      toast('Cell occupied', 'warn');
      return;
    }
    var oldCell = getCell(node.col, node.row);
    var el = document.getElementById(id);
    if (el) el.remove();
    resetCell(oldCell, node.col, node.row);

    node.col = col;
    node.row = row;
    renderNode(node);
    renderConnections();
    persistDesignChange();
  }

  function createNodeElement(node) {
    var item = findTool(node.type);
    var el = document.createElement('div');
    el.id = node.id;
    el.className = 'placed-node node flex flex-col items-center justify-center z-30';
    el.dataset.id = node.id;
    el.dataset.nodeId = node.id;
    var canDrag = ctx.mapInteractionMode !== 'hand' && !ctx.connectMode && !node.locked;
    el.draggable = canDrag;
    el.setAttribute('draggable', canDrag ? 'true' : 'false');
    if (node.locked) el.classList.add('placed-node--locked');

    if (node.type === 'olt') {
      el.classList.add('placed-node--olt');
      if (isItpcCell(getLayout(currentLayout), node.col, node.row)) {
        el.classList.add('placed-node--itpc-olt');
      }
      el.innerHTML = oltIconSvg(34) +
        '<span class="field-node-label field-node-label--olt">OLT</span>' +
        '<span class="text-[7px] text-slate-400 mt-0.5">ITPC</span>';
    } else if (node.type === 'fdt') {
      el.classList.add('placed-node--fdt');
      el.innerHTML = '<div class="fdt-body"><div class="fdt-door"></div><span class="fdt-label">FDT</span></div>';
    } else if (node.type === 'splitter') {
      el.classList.add('placed-node--splitter');
      var splRatio = node.variant || toolboxVals.splitter || '1x8';
      el.innerHTML = splitterIconSvg(splRatio, 38) +
        '<span class="field-node-label field-node-label--splitter">' + splRatio + '</span>';
    } else if (node.type === 'pole_foundation') {
      el.classList.add('placed-node--foundation');
      if (node.hasPole) el.classList.add('placed-node--foundation-pole');
      if (node.hasClosure) el.classList.add('placed-node--foundation-closure');
      el.innerHTML = renderFoundationHtml(node);
    } else if (node.type === 'handhole') {
      el.classList.add('placed-node--handhole');
      if (node.hasClosure) {
        el.classList.add('placed-node--handhole-closure');
        el.innerHTML = handholeClosureHtml();
      } else {
        el.innerHTML = handholeOnlyHtml();
      }
    } else if (node.type === 'closure') {
      el.classList.add('placed-node--closure');
      el.innerHTML = closureIconSvg(28);
    } else {
      el.style.background = item.color + '18';
      el.style.border = '1px solid ' + item.color + '66';
      var lbl = node.variant || item.label.split(' ')[0];
      el.innerHTML = '<span class="text-lg">' + item.icon + '</span>' +
        '<span class="text-[9px] font-mono font-bold mt-0.5" style="color:' + item.color + '">' + lbl + '</span>';
    }

    el.addEventListener('dragstart', onNodeDragStart);
    el.addEventListener('dragend', onNodeDragEnd);
    el.addEventListener('dragover', onNodeDragOver);
    el.addEventListener('dragleave', onNodeDragLeave);
    el.addEventListener('drop', function (ev) {
      onNodeDropCable(ev);
      onNodeDropComponent(ev);
    });
    return el;
  }

  function renderNode(node) {
    var existing = document.getElementById(node.id);
    if (existing) existing.remove();

    if (node.free && node.px != null && node.py != null) {
      if (!dom.freeNodesLayer) return;
      var freeEl = createNodeElement(node);
      freeEl.classList.add('placed-node--free');
      freeEl.style.position = 'absolute';
      freeEl.style.left = node.px + 'px';
      freeEl.style.top = node.py + 'px';
      dom.freeNodesLayer.appendChild(freeEl);
      applyZoomCompensation();
      return;
    }

    var cell = getCell(node.col, node.row);
    if (!cell) return;

    cell.classList.add('has-node');
    cell.innerHTML = '';

    var el = createNodeElement(node);
    el.classList.add('absolute', 'inset-1');
    cell.appendChild(el);
    applyZoomCompensation();
  }

  function removeNode(id) {
    var node = findNode(id);
    if (!node) return;
    for (var ni = nodes.length - 1; ni >= 0; ni--) {
      if (nodes[ni].id === id) nodes.splice(ni, 1);
    }
    for (var ci = connections.length - 1; ci >= 0; ci--) {
      if (connections[ci].from === id || connections[ci].to === id) connections.splice(ci, 1);
    }
    var el = document.getElementById(id);
    if (el) el.remove();
    if (!node.free) {
      resetCell(getCell(node.col, node.row), node.col, node.row);
    }
    if (connectFrom === id) {
      connectFrom = null;
      ctx.connectFrom = null;
    }
    if (ctx.selectedNodeId === id) clearPropertyPanel();
    renderConnections();
    buildToolbox();
    updateMetrics();
    persistDesignChange();
  }

  function resetCell(cell, col, row) {
    if (!cell) return;
    cell.classList.remove('has-node');
    styleMapCell(cell, col, row, getLayout(currentLayout));
  }

  /* ═══════════════════════════════════════
     CONNECTIONS
     ═══════════════════════════════════════ */
  function setConnectMode(on, keepState) {
    connectMode = on;
    ctx.connectMode = on;
    if (on) setSelectedToolboxType(null);
    if (!keepState) {
      connectFrom = null;
      ctx.connectFrom = null;
      hasPreviewMouse = false;
      ctx.hasPreviewMouse = false;
      if (!on) {
        activeCable = null;
        ctx.activeCable = null;
      }
    }
    clearNodeHighlight();
    if (dom.btnConnect) {
      dom.btnConnect.classList.toggle('border-fiber-cyan', connectMode);
      dom.btnConnect.classList.toggle('text-fiber-cyan', connectMode);
      dom.btnConnect.textContent = connectMode ? '🔗 Connecting…' : '🔗 Cable Mode';
    }
    updateCableArmedUI();
    updateNodesDraggable();
    renderConnections();
  }

  function gridCellCenter(col, row) {
    return {
      x: col * CELL_SIZE + CELL_SIZE / 2,
      y: row * CELL_SIZE + CELL_SIZE / 2,
    };
  }

  function getCanvasPoint(clientX, clientY) {
    return clientToGridCoords(clientX, clientY);
  }

  function getNodeCenterPoint(nodeId) {
    var node = findNode(nodeId);
    if (!node) return null;
    if (node.free && node.px != null && node.py != null) {
      return { x: node.px, y: node.py };
    }
    return gridCellCenter(node.col, node.row);
  }

  function getCableLineStyle(cableSpec) {
    var cableId = cableSpec ? cableSpec.cableId : 'standard';
    return {
      color: cableId === 'cable_ftth' ? '#3b82f6' : cableId === 'cable_lastmile' ? '#f59e0b' : '#00e5ff',
      width: cableId === 'standard' ? 2.5 : 3.5,
      dash: cableId === 'standard' ? '6 4' : '',
    };
  }

  function cancelPendingConnection(showToast) {
    if (!connectFrom) return;
    connectFrom = null;
    ctx.connectFrom = null;
    hasPreviewMouse = false;
    ctx.hasPreviewMouse = false;
    clearNodeHighlight();
    renderConnections();
    if (showToast) toast('Connection cancelled', 'warn');
  }

  function drawCablePreviewLine() {
    if (!dom.connectionsLayer || !connectFrom || !connectMode) return;
    var start = getNodeCenterPoint(connectFrom);
    if (!start) return;

    var endX = hasPreviewMouse ? previewMouse.x : start.x;
    var endY = hasPreviewMouse ? previewMouse.y : start.y;
    var style = getCableLineStyle(getConnectionCableSpec());

    var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('id', 'cable-preview-line');
    line.setAttribute('class', 'conn-line conn-line--preview');
    line.setAttribute('x1', start.x);
    line.setAttribute('y1', start.y);
    line.setAttribute('x2', endX);
    line.setAttribute('y2', endY);
    line.setAttribute('stroke', style.color);
    line.setAttribute('stroke-width', style.width);
    line.setAttribute('data-base-width', String(style.width));
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('opacity', '0.88');
    line.setAttribute('stroke-dasharray', '8 5');
    dom.connectionsLayer.appendChild(line);
  }

  function updateCablePreviewOnly() {
    var preview = document.getElementById('cable-preview-line');
    if (preview) preview.parentNode.removeChild(preview);
    drawCablePreviewLine();
  }

  function onCablePreviewMouseMove(e) {
    if (!connectMode || !connectFrom) return;
    if (previewRaf) return;
    var clientX = e.clientX;
    var clientY = e.clientY;
    previewRaf = requestAnimationFrame(function () {
      previewRaf = 0;
      var pt = clientToGridCoords(clientX, clientY);
      if (!pt) return;
      previewMouse.x = pt.x;
      previewMouse.y = pt.y;
      hasPreviewMouse = true;
      ctx.hasPreviewMouse = true;
      updateCablePreviewOnly();
    });
  }

  function onGridBackgroundClick(e) {
    if (!connectMode || !connectFrom) return;
    if (e.target.closest('.node')) return;
    cancelPendingConnection(true);
  }

  function beginConnectionFrom(id) {
    connectFrom = id;
    ctx.connectFrom = id;
    hasPreviewMouse = false;
    ctx.hasPreviewMouse = false;
    highlightNode(id, 'connect-source');
    drawCablePreviewLine();
    toast('Drag cable with mouse — click target node', 'success');
  }

  function toggleConnectMode() {
    if (!connectMode) {
      var spec = getConnectionCableSpec();
      if (!spec) {
        selectedCableId = selectedCableId || 'cable_ftth';
        activeCable = {
          cableId: selectedCableId,
          fibers: toolboxVals[selectedCableId],
          label: findTool(selectedCableId).label,
        };
      }
    }
    setConnectMode(!connectMode, false);
    if (connectMode) {
      var cSpec = getConnectionCableSpec();
      toast('Cable Mode — click source, drag to target (' + (cSpec ? cSpec.label : 'standard') + ')', 'success');
    }
  }

  function armCable(cableId) {
    var item = findTool(cableId);
    if (!item || !item.isCable) return;
    selectedCableId = cableId;
    activeCable = {
      cableId: cableId,
      fibers: toolboxVals[cableId],
      label: item.label,
    };
    ctx.activeCable = activeCable;
    setConnectMode(true, true);
    connectFrom = null;
    ctx.connectFrom = null;
    clearNodeHighlight();
    updateCableArmedUI();
    toast(item.label + ' (' + toolboxVals[cableId] + ' fibers) — click two nodes', 'success');
  }

  function updateCableArmedUI() {
    if (!dom.toolboxItems) return;
    var items = dom.toolboxItems.querySelectorAll('.toolbox-item--cable');
    for (var i = 0; i < items.length; i++) {
      var armed = activeCable && items[i].dataset.type === activeCable.cableId && connectMode;
      items[i].classList.toggle('toolbox-item--armed', !!armed);
    }
  }

  function onNodeClick(id) {
    if (!connectMode) {
      highlightNode(id, 'selected');
      showPropertyPanel(id);
      return;
    }
    if (!connectFrom) {
      beginConnectionFrom(id);
      return;
    }
    if (connectFrom === id) {
      cancelPendingConnection(false);
      return;
    }
    var fromId = connectFrom;
    var linked = linkNodes(fromId, id);
    if (linked) {
      connectFrom = null;
      ctx.connectFrom = null;
      hasPreviewMouse = false;
      ctx.hasPreviewMouse = false;
      clearNodeHighlight();
      updateCableArmedUI();
    } else {
      highlightNode(fromId, 'connect-source');
      drawCablePreviewLine();
    }
  }

  function linkNodes(fromId, toId) {
    var a = findNode(fromId);
    var b = findNode(toId);
    if (!a || !b) return false;

    var exists = connections.some(function (c) {
      return (c.from === fromId && c.to === toId) || (c.from === toId && c.to === fromId);
    });
    if (exists) { toast('Already connected', 'warn'); return false; }

    var cableSpec = getConnectionCableSpec();

    if (!cableSpec) {
      var allowed = VALID_LINKS[getEffectiveType(a)] || [];
      if (allowed.indexOf(getEffectiveType(b)) < 0) {
        toast('Invalid link: ' + getEffectiveType(a) + ' → ' + getEffectiveType(b), 'error');
        return false;
      }
    }

    connections.push({
      id: 'c' + (++connId),
      from: fromId,
      to: toId,
      cable: cableSpec ? cableSpec.cableId : 'standard',
      fibers: cableSpec ? cableSpec.fibers : null,
    });
    ctx.connId = connId;

    renderConnections();
    buildToolbox();
    updateMetrics();
    var cableLabel = cableSpec ? (cableSpec.label + ' ' + cableSpec.fibers + 'f') : 'Standard';
    toast('Connected — ' + cableLabel + ' ✓', 'success');
    persistDesignChange();
    return true;
  }

  function renderConnections() {
    if (!dom.connectionsLayer) return;
    dom.connectionsLayer.innerHTML = '';
    var w = MAP_W;
    var h = MAP_H;
    dom.connectionsLayer.setAttribute('width', w);
    dom.connectionsLayer.setAttribute('height', h);
    dom.connectionsLayer.setAttribute('viewBox', '0 0 ' + w + ' ' + h);

    connections.forEach(function (c) {
      var fromNode = findNode(c.from);
      var toNode = findNode(c.to);
      if (!fromNode || !toNode) return;
      var start = gridCellCenter(fromNode.col, fromNode.row);
      var end = gridCellCenter(toNode.col, toNode.row);
      var x1 = start.x;
      var y1 = start.y;
      var x2 = end.x;
      var y2 = end.y;
      var color = c.cable === 'cable_ftth' ? '#3b82f6' : c.cable === 'cable_lastmile' ? '#f59e0b' : '#00e5ff';
      var width = c.cable === 'standard' ? 2.5 : 3.5;
      var dash = c.cable === 'standard' ? '6 4' : '';

      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1);
      line.setAttribute('y1', y1);
      line.setAttribute('x2', x2);
      line.setAttribute('y2', y2);
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', width);
      line.setAttribute('data-base-width', String(width));
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('opacity', '0.9');
      if (dash) line.setAttribute('stroke-dasharray', dash);
      line.setAttribute('class', 'conn-line conn-line--' + (c.cable || 'standard'));
      dom.connectionsLayer.appendChild(line);
    });

    drawCablePreviewLine();
    applyZoomCompensation();
  }

  /* ═══════════════════════════════════════
     EVALUATION (basic)
     ═══════════════════════════════════════ */
  function checkDesign() {
    var score = 0;
    var msgs = [];
    var hasOlt = nodes.some(function (n) { return n.type === 'olt'; });
    var hasFdt = nodes.some(function (n) { return n.type === 'fdt'; });
    var autoBuildings = countAutoBuildings();
    var ontCount = nodes.filter(function (n) { return n.type === 'ont'; }).length;
    var closures = nodes.filter(function (n) { return n.hasClosure; });
    var handholes = nodes.filter(function (n) { return n.type === 'handhole'; });
    var foundations = nodes.filter(function (n) { return n.type === 'pole_foundation'; });
    var poles = nodes.filter(function (n) { return n.type === 'pole_foundation' && n.hasPole; });
    var fatSplitters = nodes.filter(function (n) { return n.type === 'pole_foundation' && n.fatSplitter; });

    if (hasOlt) { score += 25; msgs.push({ ok: true, text: 'OLT placed' }); }
    else msgs.push({ ok: false, text: 'Add OLT' });

    if (hasFdt) { score += 15; msgs.push({ ok: true, text: 'FDT cabinet placed' }); }
    else msgs.push({ ok: false, text: 'Add FDT cabinet' });

    if (connections.length >= 2) { score += 15; msgs.push({ ok: true, text: connections.length + ' connections' }); }
    else msgs.push({ ok: false, text: 'Add more connections' });

    if (autoBuildings > 0) {
      score += 10;
      msgs.push({ ok: true, text: autoBuildings + ' buildings auto-placed in city blocks' });
    }
    if (ontCount > 0) {
      score += 5;
      msgs.push({ ok: true, text: ontCount + ' ONT(s) placed' });
    }

    if (foundations.length > 0) {
      score += 5;
      msgs.push({ ok: true, text: foundations.length + ' pole foundation(s) placed' });
    }

    if (poles.length > 0) {
      score += 10;
      msgs.push({ ok: true, text: poles.length + ' pole(s) mounted ✓' });
    } else if (foundations.length > 0) {
      msgs.push({ ok: false, text: 'Drop pole onto foundation — cannot install pole on bare street' });
      msgs.push({ ok: false, text: 'يجب صب القاعدة الخرسانية أولاً قبل نصب العمود ميدانياً' });
    }

    if (fatSplitters.length > 0) {
      score += 5;
      msgs.push({ ok: true, text: fatSplitters.length + ' FAT splitter(s) activated ✓' });
    }

    if (handholes.length > 0) {
      score += 10;
      msgs.push({ ok: true, text: handholes.length + ' handhole(s) installed' });
    }

    if (closures.length > 0) {
      score += 15;
      msgs.push({ ok: true, text: closures.length + ' closure(s) merged inside handholes ✓' });
    } else if (handholes.length > 0 || foundations.length > 0) {
      msgs.push({ ok: false, text: 'Install Closure inside Handhole or Foundation opening' });
      msgs.push({ ok: false, text: 'قاعدة ميدانية: الكلوجر يُدمج داخل الهاندهل أو قاعدة العمود' });
    }

    score = Math.min(score, 100);
    var sv = document.getElementById('score-value');
    var sl = document.getElementById('score-label');
    var fa = document.getElementById('feedback-area');
    var fl = document.getElementById('feedback-list');
    if (sv) sv.textContent = score;
    if (sl) sl.textContent = score >= 70 ? 'Good start!' : 'Keep building';
    if (fa) fa.classList.remove('hidden');
    if (fl) {
      fl.innerHTML = msgs.map(function (m) {
        return '<li class="' + (m.ok ? 'text-fiber-phosphor' : 'text-red-400') + '">' +
          (m.ok ? '✓ ' : '✗ ') + m.text + '</li>';
      }).join('');
    }
  }

  function updateMetrics() {
    var autoBuildings = countAutoBuildings();
    var ontCount = nodes.filter(function (n) { return n.type === 'ont'; }).length;
    var fiberMetrics = calculateFiberMetrics(nodes, connections, CELL_SIZE);
    setText('metric-components', nodes.length);
    setText('metric-connections', connections.length);
    setText('metric-homes', ontCount + ' / ' + autoBuildings);
    setText('metric-length', formatFiberLength(fiberMetrics.totalMeters));
    var olt = nodes.find(function (n) { return n.type === 'olt'; });
    var oltEl = document.getElementById('metric-olt');
    if (oltEl) {
      if (!olt) { oltEl.textContent = 'Missing'; oltEl.className = 'font-mono text-red-400'; }
      else {
        var linked = connections.some(function (c) { return c.from === olt.id || c.to === olt.id; });
        oltEl.textContent = linked ? 'Connected' : 'Isolated';
        oltEl.className = 'font-mono ' + (linked ? 'text-fiber-phosphor' : 'text-yellow-400');
      }
    }
  }

  function setText(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function clearAll() {
    if (!window.confirm('Clear everything?')) return;
    nodes.length = 0;
    connections.length = 0;
    connectFrom = null;
    ctx.connectFrom = null;
    activeCable = null;
    ctx.activeCable = null;
    setConnectMode(false, true);
    buildGrid();
    buildToolbox();
    updateMetrics();
    resetMapView();
    setText('score-value', '—');
    var fa = document.getElementById('feedback-area');
    if (fa) fa.classList.add('hidden');
    clearPropertyPanel();
    persistDesignChange();
  }

  /* ═══════════════════════════════════════
     VIEWPORT (fullscreen / panels)
     ═══════════════════════════════════════ */
  function toggleToolbox() {
    toolboxCollapsed = !toolboxCollapsed;
    if (dom.toolboxPanel) dom.toolboxPanel.classList.toggle('collapsed', toolboxCollapsed);
    var btn = document.getElementById('toggle-toolbox');
    if (btn) btn.textContent = toolboxCollapsed ? '›' : '‹';
    setTimeout(renderConnections, 350);
  }

  function toggleEval() {
    evalCollapsed = !evalCollapsed;
    if (dom.evalPanel) dom.evalPanel.classList.toggle('collapsed', evalCollapsed);
    var btn = document.getElementById('toggle-eval');
    if (btn) btn.textContent = evalCollapsed ? '‹' : '›';
    setTimeout(renderConnections, 350);
  }

  function toggleFullscreen() {
    if (ctx.api.osmEngine && ctx.api.osmEngine.requestFullscreen) {
      ctx.api.osmEngine.requestFullscreen().catch(function () {
        if (dom.fullscreenZone) dom.fullscreenZone.requestFullscreen();
      });
      return;
    }
    if (!dom.fullscreenZone) return;
    if (!document.fullscreenElement) {
      dom.fullscreenZone.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  /* ═══════════════════════════════════════
     HELPERS
     ═══════════════════════════════════════ */
  function findTool(id) {
    for (var i = 0; i < TOOLBOX.length; i++) {
      if (TOOLBOX[i].id === id) return TOOLBOX[i];
    }
    return null;
  }

  function findNode(id) {
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) return nodes[i];
    }
    return null;
  }

  function highlightNode(id, cls) {
    clearNodeHighlight();
    var el = document.getElementById(id);
    if (el) el.classList.add(cls);
  }

  function clearNodeHighlight() {
    if (!dom.cityGrid && !dom.freeNodesLayer) return;
    var all = document.querySelectorAll('.placed-node');
    for (var i = 0; i < all.length; i++) {
      all[i].classList.remove('selected', 'connect-source');
    }
    clearPropertyPanel();
  }

  function clearHighlights() {
    lastDragOverCell = null;
    if (!dom.cityGrid) return;
    var cells = dom.cityGrid.querySelectorAll('.drop-target, .closure-drop-target, .pole-drop-target, .fat-drop-target, .sidewalk-drop-target, .itpc-drop-target');
    for (var i = 0; i < cells.length; i++) {
      cells[i].classList.remove('drop-target', 'closure-drop-target', 'pole-drop-target', 'fat-drop-target', 'sidewalk-drop-target', 'itpc-drop-target');
    }
    var nodesEl = dom.cityGrid.querySelectorAll('.pole-drop-target, .fat-drop-target, .closure-drop-target');
    for (var j = 0; j < nodesEl.length; j++) {
      nodesEl[j].classList.remove('pole-drop-target', 'fat-drop-target', 'closure-drop-target');
    }
  }

  function toast(msg, type) {
    var old = document.getElementById('sim-toast');
    if (old) old.parentNode.removeChild(old);
    var colors = { success: 'border-fiber-phosphor text-fiber-phosphor', error: 'border-red-400 text-red-400', warn: 'border-yellow-400 text-yellow-400' };
    var t = document.createElement('div');
    t.id = 'sim-toast';
    t.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl border bg-fiber-card text-xs font-semibold ' + (colors[type] || colors.warn);
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2800);
  }

  /* ═══════════════════════════════════════
     EVENTS
     ═══════════════════════════════════════ */
  function bindEvents() {
    if (dom.btnConnect) dom.btnConnect.addEventListener('click', toggleConnectMode);
    if (dom.btnClear) dom.btnClear.addEventListener('click', clearAll);
    if (dom.btnCheck) dom.btnCheck.addEventListener('click', checkDesign);
    if (dom.cityGrid) {
      dom.cityGrid.addEventListener('click', onGridNodeClick, true);
      dom.cityGrid.addEventListener('click', onGridBackgroundClick, true);
      dom.cityGrid.addEventListener('touchstart', onGridTouchStart, { passive: true });
      dom.cityGrid.addEventListener('touchend', onGridTouchEnd);
      dom.cityGrid.addEventListener('touchmove', onGridTouchEnd);
      if (!gridDnDBound) {
        dom.cityGrid.addEventListener('dragover', onGridDragOver);
        dom.cityGrid.addEventListener('dragleave', onGridDragLeave);
        dom.cityGrid.addEventListener('drop', onGridDrop);
        gridDnDBound = true;
      }
    }
    if (dom.cityCanvas) {
      dom.cityCanvas.addEventListener('mousemove', onCablePreviewMouseMove);
    }
    if (dom.layoutSelect) {
      dom.layoutSelect.addEventListener('change', function () {
        switchLayout(dom.layoutSelect.value);
      });
    }
    var btnFs = document.getElementById('btn-fullscreen');
    var toggleTb = document.getElementById('toggle-toolbox');
    var toggleEv = document.getElementById('toggle-eval');

    if (btnFs) btnFs.addEventListener('click', toggleFullscreen);
    if (toggleTb) toggleTb.addEventListener('click', toggleToolbox);
    if (toggleEv) toggleEv.addEventListener('click', toggleEval);

    document.addEventListener('fullscreenchange', function () {
      setTimeout(function () {
        resetMapView();
      }, 80);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (dom.contextMenu && !dom.contextMenu.classList.contains('hidden')) {
          hideContextMenu();
          return;
        }
        if (document.fullscreenElement) { document.exitFullscreen(); return; }
        if (connectFrom) {
          cancelPendingConnection(true);
          return;
        }
        if (connectMode) setConnectMode(false, true);
        clearNodeHighlight();
        clearPropertyPanel();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        var sel = dom.cityGrid && dom.cityGrid.querySelector('.placed-node.selected');
        if (sel) removeNode(sel.dataset.nodeId);
      }
    });

    var wrapper = document.getElementById('canvas-wrapper');
    if (wrapper) {
      wrapper.addEventListener('click', function (e) {
        if (!e.target.closest('#sim-context-menu')) hideContextMenu();
        if (connectMode && connectFrom && !e.target.closest('.node') && !e.target.closest('#city-grid')) {
          cancelPendingConnection(true);
          return;
        }
        if (connectMode) return;
        clearNodeHighlight();
        clearPropertyPanel();
      });
    }

    document.addEventListener('click', function (e) {
      if (dom.contextMenu && !dom.contextMenu.classList.contains('hidden') &&
          !e.target.closest('#sim-context-menu') && !e.target.closest('.placed-node')) {
        hideContextMenu();
      }
    });

    document.addEventListener('contextmenu', function (e) {
      if (e.target.closest('#sim-context-menu')) return;
      if (e.target.closest('#canvas-wrapper')) return;
      if (e.target.closest('#city-canvas')) return;
      if (e.target.closest('.placed-node')) return;
      hideContextMenu();
    });
  }

  /* ─── Boot ─── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
