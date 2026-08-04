/**
 * FTTH Fiber Design — AutoFiberEngine (Stage 4).
 * Map topology → DFS traversal → splice matrix. NO UI.
 */
(function (global) {
  'use strict';

  var DEBUG = !!(global && global.FTTH_DEBUG);

  var deps = null;
  var nodeStore = Object.create(null);
  var matrixRows = [];
  var cabinetRegistry = [];
  var closureRegistry = [];
  var lastDesignVersion = 0;
  var regenTimer = null;
  var listeners = [];
  var currentCabinetCtx = null;
  // Per-run main cable allocation pointers (keyed by main cable id/name)
  var mainPointers = Object.create(null);
  // FACTORY RESET: Main Backbone Names registry for origin name tracking
  var mainBackboneNames = [];

  var FIBERS_PER_TUBE = 6;
  var FATS_PER_TUBE = 3;
  var FIBERS_PER_FAT = 2;
  var FIBER_STATUSES = ['spliced', 'dark_fiber', 'dead', 'available', 'reserved', 'fault'];
  var SPLICE_TYPES = ['Main', 'Expansion', 'Distribution', 'Drop', 'Patch', 'Test'];
  var MATRIX_FIBER_TYPES = ['Main', 'Expansion'];

  const TUBE_COLORS = ['Blue', 'Orange', 'Green', 'Brown', 'Slate', 'White', 'Red', 'Black'];
  const FIBER_COLORS = ['Blue', 'Orange', 'Green', 'Brown', 'Slate', 'White'];

  // Hardcoded color mapping for cable capacities (FACTORY RESET - NEW STANDARD)
  // Every tube ALWAYS contains exactly 6 fibers: [Blue, Orange, Green, Brown, Slate, White]
  var CAPACITY_COLOR_MAPPING = {
    12: {
      tubes: ['Blue', 'Orange'],
      fibers_per_tube: 6
    },
    24: {
      tubes: ['Blue', 'Orange', 'Green', 'Brown'],
      fibers_per_tube: 6
    },
    36: {
      tubes: ['Blue', 'Orange', 'Green', 'Brown', 'Slate', 'White'],
      fibers_per_tube: 6
    },
    48: {
      tubes: ['Blue', 'Orange', 'Green', 'Brown', 'Slate', 'White', 'Red', 'Black'],
      fibers_per_tube: 6
    }
  };

  var LAST_MILE_TUBE_COUNT = {
    48: 8,
    36: 6,
    24: 4,
    12: 2,
  };

  var STANDARD_COLOR_CODE = TUBE_COLORS.map(function (c) {
    return String(c || '').trim().toLowerCase();
  });

  /** Tube colors for a 48F main cable follow the 8-color main cable code. */
  var STANDARD_TUBE_COLORS = STANDARD_COLOR_CODE.slice();

  /** Fibers inside each tube use the first 6 colors of the main cable fiber code. */
  var STANDARD_FIBER_COLORS = STANDARD_COLOR_CODE.slice(0, FIBERS_PER_TUBE);

  /**
   * Within one tube: FAT i gets fiber pair (2i, 2i+1) as Main / Expansion.
   * Blue tube → Pole1 Blue/Orange, Pole2 Green/Brown, Pole3 Slate/White.
   */
  var TUBE_FAT_FIBER_PAIRS = [
    { main: 'blue', expansion: 'orange' },
    { main: 'green', expansion: 'brown' },
    { main: 'slate', expansion: 'white' },
  ];

  /**
   * Validate 48F cable standard before rendering matrix.
   * Throws error if tube count, tube order, fiber count, or fiber order is incorrect.
   */
  function validate48FStandard(tubes) {
    if (DEBUG) {
    console.log('[FiberDesignManager] validate48FStandard START');
    }
    try {
      if (!Array.isArray(tubes)) {
        console.error('[FiberDesignManager] validate48FStandard ERROR: tubes is not an array');
        throw new Error('Invalid tubes: not an array');
      }

      if (DEBUG) {
      console.log('[FiberDesignManager] validate48FStandard: tube count = ' + tubes.length);
      }

      // Validate tube count = 8
      if (tubes.length !== 8) {
        console.error('[FiberDesignManager] validate48FStandard ERROR: tube count is ' + tubes.length + ', expected 8');
        throw new Error('Invalid 48F cable: tube count is ' + tubes.length + ', must be exactly 8');
      }

      // Validate tube order matches standard
      for (var i = 0; i < 8; i++) {
        var expectedTubeColor = TUBE_COLORS[i].toLowerCase();
        var actualTubeColor = (tubes[i] && tubes[i].tube_color) ? String(tubes[i].tube_color).toLowerCase() : '';
        if (actualTubeColor !== expectedTubeColor) {
          console.error('[FiberDesignManager] validate48FStandard ERROR: tube #' + (i + 1) + ' is ' + actualTubeColor + ', expected ' + expectedTubeColor);
          throw new Error('Invalid 48F tube order: tube #' + (i + 1) + ' is ' + actualTubeColor + ', must be ' + expectedTubeColor);
        }
      }

      // Validate fiber count per tube = 6
      // Validate fiber order matches standard
      for (var t = 0; t < tubes.length; t++) {
        var tube = tubes[t];
        if (!tube || !Array.isArray(tube.fibers)) {
          console.error('[FiberDesignManager] validate48FStandard ERROR: tube #' + (t + 1) + ' missing fibers array');
          throw new Error('Invalid tube #' + (t + 1) + ': missing fibers array');
        }

        if (tube.fibers.length !== 6) {
          console.error('[FiberDesignManager] validate48FStandard ERROR: tube #' + (t + 1) + ' fiber count is ' + tube.fibers.length + ', expected 6');
          throw new Error('Invalid 48F tube #' + (t + 1) + ': fiber count is ' + tube.fibers.length + ', must be exactly 6');
        }

        for (var f = 0; f < 6; f++) {
          var expectedFiberColor = FIBER_COLORS[f].toLowerCase();
          var actualFiberColor = (tube.fibers[f] && tube.fibers[f].fiber_color) ? String(tube.fibers[f].fiber_color).toLowerCase() : '';
          if (actualFiberColor !== expectedFiberColor) {
            console.error('[FiberDesignManager] validate48FStandard ERROR: tube #' + (t + 1) + ' fiber #' + (f + 1) + ' is ' + actualFiberColor + ', expected ' + expectedFiberColor);
            throw new Error('Invalid 48F fiber order in tube #' + (t + 1) + ': fiber #' + (f + 1) + ' is ' + actualFiberColor + ', must be ' + expectedFiberColor);
          }
        }
      }

      if (DEBUG) {
      console.log('[FiberDesignManager] validate48FStandard SUCCESS');
      }
      return true;
    } catch (e) {
      console.error('[FiberDesignManager] validate48FStandard EXCEPTION:', e.message);
      console.error('[FiberDesignManager] validate48FStandard STACK:', e.stack);
      throw e;
    }
  }

  function init(api) {
    deps = api || {};
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function createUuid() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function normalizeNodeId(nodeId) {
    if (nodeId == null || nodeId === '') return '';
    return String(nodeId);
  }

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function deepClone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function cloneMetadata(meta) {
    return {
      created_at: meta.created_at,
      updated_at: meta.updated_at,
      created_by: meta.created_by != null ? meta.created_by : null,
      notes: meta.notes != null ? String(meta.notes) : '',
      is_mock: !!meta.is_mock,
      source: meta.source != null ? String(meta.source) : '',
    };
  }

  function createDefaultMetadata(createdBy, options) {
    options = options || {};
    var ts = nowIso();
    return {
      created_at: ts,
      updated_at: ts,
      created_by: createdBy != null ? String(createdBy) : null,
      notes: options.notes != null ? String(options.notes) : '',
      is_mock: !!options.is_mock,
      source: options.source != null ? String(options.source) : (options.is_mock ? 'mock' : 'real'),
    };
  }

  function touchMetadata(node) {
    if (!node || !node.metadata) return;
    node.metadata.updated_at = nowIso();
  }

  function parseCapacityFromLabel(label) {
    var m = String(label || '').match(/^(\d+)F/i);
    return m ? parseInt(m[1], 10) : 0;
  }

  function tubeCountForCapacity(capacityF) {
    var cap = Number(capacityF) || 0;
    if (LAST_MILE_TUBE_COUNT[cap]) return LAST_MILE_TUBE_COUNT[cap];
    if (cap > 0) return Math.max(1, Math.ceil(cap / FIBERS_PER_TUBE));
    return 2;
  }

  function normalizeFiberRef(ref) {
    if (!ref || typeof ref !== 'object') return null;
    var cableId = ref.cable_id != null ? String(ref.cable_id) : '';
    var tubeId = ref.tube_id != null ? String(ref.tube_id) : '';
    var fiberId = ref.fiber_id != null ? String(ref.fiber_id) : '';
    if (!cableId || !tubeId || !fiberId) return null;
    return { cable_id: cableId, tube_id: tubeId, fiber_id: fiberId };
  }

  function fiberRefKey(ref) {
    return ref.cable_id + '|' + ref.tube_id + '|' + ref.fiber_id;
  }

  function createFiber(fiberNumber, fiberColor, status) {
    return {
      id: createUuid(),
      fiber_number: Number(fiberNumber) || 1,
      fiber_color: isNonEmptyString(fiberColor) ? fiberColor.trim().toLowerCase() : 'blue',
      status: FIBER_STATUSES.indexOf(status) >= 0 ? status : 'available',
    };
  }

  function createTube(tubeNumber, tubeColor, fibers) {
    var tube = {
      id: createUuid(),
      tube_number: Number(tubeNumber) || 1,
      tube_color: isNonEmptyString(tubeColor) ? tubeColor.trim().toLowerCase() : 'blue',
      fibers: [],
    };
    if (Array.isArray(fibers)) {
      fibers.forEach(function (f) {
        if (!f) return;
        tube.fibers.push({
          id: f.id || createUuid(),
          fiber_number: Number(f.fiber_number) || tube.fibers.length + 1,
          fiber_color: isNonEmptyString(f.fiber_color) ? String(f.fiber_color).trim().toLowerCase() : 'blue',
          status: FIBER_STATUSES.indexOf(f.status) >= 0 ? f.status : 'available',
        });
      });
    }
    return tube;
  }

  function buildLastMileTubes(capacityF) {
    var tubeCount = tubeCountForCapacity(capacityF);
    var tubes = [];
    var t;
    for (t = 0; t < tubeCount; t++) {
      var fibers = [];
      var f;
      for (f = 0; f < FIBERS_PER_TUBE; f++) {
        fibers.push(createFiber(f + 1, STANDARD_FIBER_COLORS[f % STANDARD_FIBER_COLORS.length], 'available'));
      }
      tubes.push(createTube(t + 1, STANDARD_TUBE_COLORS[t % STANDARD_TUBE_COLORS.length], fibers));
    }
    return tubes;
  }

  function normalizeCableRole(role, direction) {
    if (role === 'main' || role === 'main_cable') return 'main';
    if (role === 'sub' || role === 'sub_cable') return 'sub';
    return direction === 'outbound' ? 'sub' : 'main';
  }

  function enforceFibersPerTube(tubes) {
    if (!Array.isArray(tubes)) return;
    tubes.forEach(function (tube, tubeIndex) {
      if (!tube.fibers) tube.fibers = [];
      while (tube.fibers.length < FIBERS_PER_TUBE) {
        var fi = tube.fibers.length;
        tube.fibers.push(createFiber(
          fi + 1,
          STANDARD_FIBER_COLORS[fi % STANDARD_FIBER_COLORS.length],
          'available'
        ));
      }
      if (tube.fibers.length > FIBERS_PER_TUBE) {
        tube.fibers = tube.fibers.slice(0, FIBERS_PER_TUBE);
      }
      tube.fibers.forEach(function (fiber, idx) {
        fiber.fiber_number = idx + 1;
      });
      if (!tube.tube_color) {
        tube.tube_color = STANDARD_TUBE_COLORS[tubeIndex % STANDARD_TUBE_COLORS.length];
      }
    });
  }

  function createCable(direction, options) {
    if (DEBUG) {
    console.log('[FiberDesignManager] createCable START: direction=' + direction + ', name=' + (options.name || ''));
    }
    try {
      options = options || {};
      var capacityF = Number(options.capacity_f) || parseCapacityFromLabel(options.name) || 12;
      if (DEBUG) {
      console.log('[FiberDesignManager] createCable: capacityF=' + capacityF);
      }
      var tubes = Array.isArray(options.tubes) && options.tubes.length
        ? options.tubes.map(function (t) {
          return createTube(t.tube_number, t.tube_color, t.fibers);
        })
        : buildLastMileTubes(capacityF);

      enforceFibersPerTube(tubes);

      // TEMPORARILY DISABLED: Validate 48F cable standard
      // This validation is blocking Matrix window from opening
      // if (capacityF === 48) {
      //   console.log('[FiberDesignManager] createCable: validating 48F standard');
      //   validate48FStandard(tubes);
      // }

      if (DEBUG) {
      console.log('[FiberDesignManager] createCable SUCCESS');
      }
      return {
        id: options.id || createUuid(),
        name: options.name != null ? String(options.name) : '',
        direction: direction === 'outbound' ? 'outbound' : 'inbound',
        role: normalizeCableRole(options.role, direction),
        cable_class: options.cable_class || 'last_mile',
        capacity_f: capacityF,
        map_cable_id: options.map_cable_id != null ? String(options.map_cable_id) : null,
        tubes: tubes,
      };
    } catch (e) {
      console.error('[FiberDesignManager] createCable EXCEPTION:', e.message);
      console.error('[FiberDesignManager] createCable STACK:', e.stack);
      throw e;
    }
  }

  function createEmptyNodeRecord(nodeId, nodeType, location, createdBy, metaOptions) {
    return {
      node_id: nodeId,
      node_type: isNonEmptyString(nodeType) ? String(nodeType).trim() : 'unknown',
      location: location && typeof location === 'object'
        ? {
          x: Number(location.x) || 0,
          y: Number(location.y) || 0,
          col: location.col != null ? Number(location.col) : undefined,
          row: location.row != null ? Number(location.row) : undefined,
        }
        : null,
      metadata: createDefaultMetadata(createdBy, metaOptions),
      cables: { inbound: [], outbound: [] },
      splices: [],
    };
  }

  function getCableBucket(node, direction) {
    if (!node || !node.cables) return null;
    return direction === 'outbound' ? node.cables.outbound : node.cables.inbound;
  }

  function collectNodeCables(node) {
    if (!node || !node.cables) return [];
    return (node.cables.inbound || []).concat(node.cables.outbound || []);
  }

  function findCable(node, cableId) {
    if (!node || !cableId) return null;
    var id = String(cableId);
    var list = collectNodeCables(node);
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && String(list[i].id) === id) return list[i];
    }
    return null;
  }

  function findTube(cable, tubeId) {
    if (!cable || !tubeId || !Array.isArray(cable.tubes)) return null;
    var id = String(tubeId);
    var i;
    for (i = 0; i < cable.tubes.length; i++) {
      if (cable.tubes[i] && String(cable.tubes[i].id) === id) return cable.tubes[i];
    }
    return null;
  }

  function findFiber(tube, fiberId) {
    if (!tube || !fiberId || !Array.isArray(tube.fibers)) return null;
    var id = String(fiberId);
    var i;
    for (i = 0; i < tube.fibers.length; i++) {
      if (tube.fibers[i] && String(tube.fibers[i].id) === id) return tube.fibers[i];
    }
    return null;
  }

  function findFiberByColor(tube, color) {
    if (!tube || !Array.isArray(tube.fibers)) return null;
    var key = String(color || '').toLowerCase();
    var i;
    for (i = 0; i < tube.fibers.length; i++) {
      if (tube.fibers[i] && String(tube.fibers[i].fiber_color).toLowerCase() === key) {
        return tube.fibers[i];
      }
    }
    return null;
  }

  function resolveFiberRef(node, ref) {
    var normalized = normalizeFiberRef(ref);
    if (!normalized || !node) return null;
    var cable = findCable(node, normalized.cable_id);
    if (!cable) return null;
    var tube = findTube(cable, normalized.tube_id);
    if (!tube) return null;
    var fiber = findFiber(tube, normalized.fiber_id);
    if (!fiber) return null;
    return { cable: cable, tube: tube, fiber: fiber };
  }

  function nodeHasCableContent(node) {
    return collectNodeCables(node).some(function (c) {
      return c && Array.isArray(c.tubes) && c.tubes.length > 0;
    });
  }

  function isRealFiberDesignNode(node) {
    if (!node) return false;
    if (node.metadata && node.metadata.is_mock === true) return false;
    if (node.metadata && node.metadata.source === 'auto_engine' && nodeHasCableContent(node)) return true;
    if (node.metadata && node.metadata.is_mock === false && nodeHasCableContent(node)) return true;
    if (nodeHasCableContent(node) && (node.splices || []).length > 0) return true;
    if (node.metadata && node.metadata.source === 'real' && nodeHasCableContent(node)) return true;
    return false;
  }

  function projectHasRealFiberDesignData() {
    if (matrixRows.length > 0) return true;
    var keys = Object.keys(nodeStore);
    var i;
    for (i = 0; i < keys.length; i++) {
      if (isRealFiberDesignNode(nodeStore[keys[i]])) return true;
    }
    return false;
  }

  function mapMatrixFiberType(spliceType) {
    var t = String(spliceType || 'Main');
    if (t === 'Main') return 'Main';
    return 'Expansion';
  }

  function cableDisplayId(cable) {
    if (!cable) return '—';
    if (cable.name) return String(cable.name);
    if (cable.capacity_f) return String(cable.capacity_f) + 'F';
    return String(cable.id).slice(0, 8);
  }

  function isMainCable(cable, originNode) {
    if (!cable) return false;
    // Main Cable: ONLY cables connected directly to Cabinet output
    if (originNode && isCabinetNode(originNode)) return true;
    // Check if cable originates from a Cabinet node
    var ends = resolveCableEndpoints(cable);
    if (ends.start && isCabinetNode(ends.start)) return true;
    if (ends.end && isCabinetNode(ends.end)) return true;
    return false;
  }

  // FACTORY RESET: New topology-based Main Cable identification with Origin Name Tracking
  // A cable is Main Cable IF AND ONLY IF:
  // 1. It originates from or is directly connected to a Cabinet node, OR
  // 2. Its name matches a registered Main Backbone Name (cable that originated from Cabinet)
  function isMainCableFromCabinet(cable, nodes) {
    if (!cable) return false;

    var cableName = String(cable.name || cable.id || '').trim().toUpperCase();

    // Check if cable name matches a registered Main Backbone Name
    if (mainBackboneNames.length > 0) {
      var isBackbone = mainBackboneNames.some(function (backboneName) {
        return cableName === String(backboneName).toUpperCase();
      });
      if (isBackbone) return true;
    }

    // Fallback: Check if cable originates from a Cabinet node (for initial registration)
    var ends = resolveCableEndpoints(cable);
    if (ends.start && isCabinetNode(ends.start)) return true;
    if (ends.end && isCabinetNode(ends.end)) return true;

    // If nodes array provided, check if either endpoint is a Cabinet in the nodes list
    if (nodes && Array.isArray(nodes)) {
      if (ends.start) {
        var startIsCabinet = nodes.some(function (n) {
          return n.id === ends.start.id && isCabinetNode(n);
        });
        if (startIsCabinet) return true;
      }
      if (ends.end) {
        var endIsCabinet = nodes.some(function (n) {
          return n.id === ends.end.id && isCabinetNode(n);
        });
        if (endIsCabinet) return true;
      }
    }

    return false;
  }

  // Register Main Backbone Names from cables directly connected to Cabinet (FIXED)
  function registerMainBackboneNames(mapCables, allNodes) {
    mainBackboneNames = []; // Reset registry

    if (!mapCables || !Array.isArray(mapCables)) return;

    mapCables.forEach(function (mapCable) {
      // CRITICAL FIX: Use mapCable directly to read actual map topology and coordinates
      var ends = resolveCableEndpoints(mapCable);
      var isDirectCabinet = false;

      if (ends.start && isCabinetNode(ends.start)) isDirectCabinet = true;
      if (ends.end && isCabinetNode(ends.end)) isDirectCabinet = true;

      if (allNodes && Array.isArray(allNodes)) {
        if (ends.start) {
          var startIsCabinet = allNodes.some(function (n) { return n.id === ends.start.id && isCabinetNode(n); });
          if (startIsCabinet) isDirectCabinet = true;
        }
        if (ends.end) {
          var endIsCabinet = allNodes.some(function (n) { return n.id === ends.end.id && isCabinetNode(n); });
          if (endIsCabinet) isDirectCabinet = true;
        }
      }

      // If directly connected to Cabinet, register its name as Main Backbone
      if (isDirectCabinet) {
        var label = getCableLabel(mapCable);
        if (label) {
          var backboneName = String(label).trim().toUpperCase();
          if (mainBackboneNames.indexOf(backboneName) === -1) {
            mainBackboneNames.push(backboneName);
            if (DEBUG) {
            console.log('[FiberDesignManager] Registered Main Backbone Name: ' + backboneName);
            }
          }
        }
      }
    });
  }

  function getClosureLabel(nodeId) {
    if (deps && deps.getClosureLabel) {
      return deps.getClosureLabel(nodeId) || String(nodeId);
    }
    return String(nodeId);
  }

  function getFatIdForNode(nodeId) {
    if (deps && deps.getFatIdForClosure) {
      return deps.getFatIdForClosure(nodeId) || '';
    }
    return '';
  }

  function getMapNodes() {
    if (deps && deps.getMapNodes) return deps.getMapNodes() || [];
    if (deps && deps.getClosureNodes) return deps.getClosureNodes() || [];
    return [];
  }

  function getMapCables() {
    if (deps && deps.getMapCables) return deps.getMapCables() || [];
    return [];
  }

  function resolveMapNode(ref) {
    if (!ref) return null;
    if (typeof ref === 'object' && ref.id) return ref;
    var id = String(ref);
    if (deps && deps.resolveNodeById) {
      var byId = deps.resolveNodeById(id);
      if (byId) return byId;
    }
    if (deps && deps.resolveNodeBySnapLabel) {
      return deps.resolveNodeBySnapLabel(id);
    }
    return null;
  }

  function getCableLabel(mapCable) {
    if (!mapCable) return 'Cable';
    if (deps && deps.getMapCableLabel) {
      return deps.getMapCableLabel(mapCable) || mapCable.name || mapCable.asBuiltId || 'Cable';
    }
    return mapCable.name || mapCable.asBuiltId || 'Cable';
  }

  function getFatLabelForNode(node) {
    if (!node) return '—';
    if (node.type === 'fat_handhole') {
      return node.autoName || node.fatSystemName || getClosureLabel(node.id) || node.id;
    }
    if (node.type === 'pole_foundation') {
      return node.poleName || node.autoName || ('P-' + node.id);
    }
    if (deps && deps.getFatIdForClosure) {
      return deps.getFatIdForClosure(node.id) || getClosureLabel(node.id);
    }
    return getClosureLabel(node.id);
  }

  /** Strip letters — matrix FAT ID shows digits only (FAT35 → 35). */
  function fatIdNumericOnly(label) {
    var m = String(label == null ? '' : label).match(/(\d+)/);
    return m ? m[1] : '—';
  }

  function nodeDistance(a, b) {
    var pa = getNodeXY(a);
    var pb = getNodeXY(b);
    if (!pa || !pb) return Infinity;
    return Math.hypot(pa.x - pb.x, pa.y - pb.y);
  }

  /**
   * Distance along a cable polyline from the end nearest `fromNode` to projection of `toNode`.
   * Falls back to Euclidean node distance.
   */
  function cablePathDistanceFromNode(cable, fromNode, toNode) {
    var pts = cable && cable.points;
    if (!pts || pts.length < 2) return nodeDistance(fromNode, toNode);
    var fromXY = getNodeXY(fromNode);
    var toXY = getNodeXY(toNode);
    if (!fromXY || !toXY) return nodeDistance(fromNode, toNode);

    function nearestIndex(xy) {
      var bestI = 0;
      var bestD = Infinity;
      var i;
      for (i = 0; i < pts.length; i++) {
        var d = Math.hypot(pts[i][0] - xy.x, pts[i][1] - xy.y);
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
      return bestI;
    }

    var fromIdx = nearestIndex(fromXY);
    var toIdx = nearestIndex(toXY);
    var i0 = Math.min(fromIdx, toIdx);
    var i1 = Math.max(fromIdx, toIdx);
    var len = 0;
    var i;
    for (i = i0; i < i1; i++) {
      len += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    }
    return len;
  }

  function isCabinetNode(node) {
    return !!(node && node.type === 'fdt');
  }

  function isClosureNode(node) {
    if (!node) return false;
    if (node.type === 'handhole' && (node.hasClosure || node.closureName)) return true;
    if (node.type === 'fat_handhole' && node.hasClosure) return true;
    return false;
  }

  function isFatOrPoleNode(node) {
    if (!node) return false;
    if (node.type === 'fat_handhole') return true;
    if (node.type === 'pole_foundation') return true;
    if (node.type === 'pole') return true;
    return false;
  }

  function resolveSnapLabel(label) {
    if (!label) return null;
    if (deps && deps.resolveNodeBySnapLabel) {
      var n = deps.resolveNodeBySnapLabel(label);
      if (n) return n;
    }
    return resolveMapNode(label);
  }

  function getNodeXY(node) {
    if (!node) return null;
    if (deps && deps.getNodeWorldXY) {
      var w = deps.getNodeWorldXY(node);
      if (w && isFinite(w.x) && isFinite(w.y)) return w;
    }
    if (deps && deps.getNodeLocation) {
      var loc = deps.getNodeLocation(node);
      if (loc && isFinite(loc.x) && isFinite(loc.y)) return { x: loc.x, y: loc.y };
    }
    if (node.location && isFinite(node.location.x) && isFinite(node.location.y)) {
      return { x: node.location.x, y: node.location.y };
    }
    return null;
  }

  function findNearestNodeAtPoint(x, y, maxDist) {
    if (!isFinite(x) || !isFinite(y)) return null;
    if (deps && deps.findNearestNodeAt) {
      var hit = deps.findNearestNodeAt(x, y, maxDist);
      if (hit) return hit;
    }
    var best = null;
    var bestD = maxDist != null ? maxDist : Infinity;
    getMapNodes().forEach(function (node) {
      if (!node || node.type === 'pole') return;
      var xy = getNodeXY(node);
      if (!xy) return;
      var d = Math.hypot(xy.x - x, xy.y - y);
      if (d <= bestD) {
        bestD = d;
        best = node;
      }
    });
    return best;
  }

  function resolveCableEndpoints(cable) {
    var start = null;
    var end = null;
    var ids = cable && cable.pointSnapNodeIds ? cable.pointSnapNodeIds : [];
    var i;
    for (i = 0; i < ids.length; i++) {
      if (!ids[i]) continue;
      var n = resolveMapNode(ids[i]);
      if (!n) continue;
      if (!start) start = n;
      end = n;
    }
    if (cable && cable.connectedTo) {
      if (!start && cable.connectedTo.start) start = resolveSnapLabel(cable.connectedTo.start);
      if (!end && cable.connectedTo.end) end = resolveSnapLabel(cable.connectedTo.end);
    }
    /* Geometric fallback — scan existing map polylines even if snap labels are stale */
    var pts = cable && cable.points;
    if (pts && pts.length >= 2) {
      var linkDist = (deps && deps.getCableLinkDistance) ? deps.getCableLinkDistance() : 80;
      if (!start) {
        start = findNearestNodeAtPoint(pts[0][0], pts[0][1], linkDist);
      }
      if (!end) {
        var last = pts[pts.length - 1];
        end = findNearestNodeAtPoint(last[0], last[1], linkDist);
      }
    }
    if (start && end && start.id === end.id) end = null;
    return { start: start, end: end };
  }

  function getCabinetLabel(node) {
    if (!node) return '—';
    if (deps && deps.getCabinetLabel) return deps.getCabinetLabel(node) || node.autoName || node.id;
    return node.autoName || node.code || String(node.id);
  }

  function findServingCabinet(node) {
    if (!node) return null;
    if (isCabinetNode(node)) return node;
    if (deps && deps.findServingFdt) return deps.findServingFdt(node);
    return null;
  }

  /* ─── Continuous fiber pointers (Main continuous · Sub resets per cable) ─── */

  /**
   * Strict 6-fiber tube math for a 48F main cable:
   *   tubeIndex       = Math.floor(globalFiberIndex / 6)
   *   fiberColorIndex = globalFiberIndex % 6
   * Each FAT consumes exactly 2 fibers (Main + Expansion).
   * When globalFiberIndex reaches 6, tube rolls to the next of 8 tube colors and fiber colors reset to Blue.
   * Uses fixed TUBE_COLORS and FIBER_COLORS arrays - never reorders.
   */
  function createFiberPointer(capacityF) {
    if (DEBUG) {
    console.log('[FiberDesignManager] createFiberPointer START: capacityF=' + capacityF);
    }
    return {
      capacityF: Number(capacityF) || 48,
      globalFiberIndex: 0,
      nextPair: function () {
        try {
          // Validate bounds for 48F cable (8 tubes * 6 fibers = 48 fibers max)
          var maxFibers = this.capacityF || 48;
          if (this.globalFiberIndex >= maxFibers) {
            console.error('[FiberDesignManager] createFiberPointer ERROR: exceeded capacity. globalFiberIndex=' + this.globalFiberIndex + ', maxFibers=' + maxFibers);
            throw new Error('Fiber pointer exceeded 48F capacity (' + maxFibers + ' fibers)');
          }

          /* Align to even index so Main+Expansion always share one tube pair. */
          if (this.globalFiberIndex % 2 !== 0) {
            this.globalFiberIndex += 1;
          }
          /* If only the 6th fiber remains in this tube, roll to the next tube. */
          if (this.globalFiberIndex % FIBERS_PER_TUBE === FIBERS_PER_TUBE - 1) {
            this.globalFiberIndex += 1;
          }

          var tubeIndex = Math.floor(this.globalFiberIndex / FIBERS_PER_TUBE);
          var fiberColorIndex = this.globalFiberIndex % FIBERS_PER_TUBE;

          // Validate tube index is within TUBE_COLORS array bounds
          if (tubeIndex >= TUBE_COLORS.length) {
            console.error('[FiberDesignManager] createFiberPointer ERROR: tubeIndex=' + tubeIndex + ' exceeds TUBE_COLORS.length=' + TUBE_COLORS.length);
            throw new Error('Tube index ' + tubeIndex + ' exceeds TUBE_COLORS array length ' + TUBE_COLORS.length);
          }

          var currentTubeColor = TUBE_COLORS[tubeIndex];
          var currentFiberColor = FIBER_COLORS[fiberColorIndex];

          var assignment = {
            tube_number: tubeIndex + 1,
            tube_color: currentTubeColor,
            main_fiber_color: currentFiberColor,
            expansion_fiber_color: FIBER_COLORS[fiberColorIndex + 1],
            main_fiber_index: fiberColorIndex,
            expansion_fiber_index: fiberColorIndex + 1,
            global_fiber_index: this.globalFiberIndex,
          };

          this.globalFiberIndex += FIBERS_PER_FAT;
          return assignment;
        } catch (e) {
          console.error('[FiberDesignManager] createFiberPointer EXCEPTION:', e.message);
          console.error('[FiberDesignManager] createFiberPointer STACK:', e.stack);
          throw e;
        }
      },
    };
  }

  function createMainFiberPointer(capacityF) {
    return createFiberPointer(capacityF || 48);
  }

  /** Each new Sub-Cable always starts at Blue tube / fiber 0. */
  function createSubCablePointer(capacityF) {
    return createFiberPointer(capacityF || 12);
  }

  /**
   * Get or create a shared main-pointer object for a main cable design instance.
   * Keyed by the design cable id/map_cable_id/name to ensure one pointer per main cable.
   */
  function getOrCreateMainPointer(mainCable) {
    if (!mainCable) return createMainFiberPointer(48);
    var key = String(mainCable.id || mainCable.map_cable_id || mainCable.name || '').toUpperCase();
    if (!key) key = String(mainCable.id || createUuid());
    if (!mainPointers[key]) {
      var cap = Number(mainCable.capacity_f) || Number(mainCable.capacity) || 48;
      mainPointers[key] = createMainFiberPointer(cap);
    }
    return mainPointers[key];
  }

  /** @deprecated */
  function createTubeFiberAllocator(capacityF) {
    return createMainFiberPointer(capacityF);
  }

  /**
   * Project point onto polyline; returns { distAlong, distToLine }.
   */
  function projectOntoCablePolyline(xy, pts) {
    if (!xy || !pts || pts.length < 2) {
      return { distAlong: 0, distToLine: Infinity };
    }
    var bestDist = Infinity;
    var bestAlong = 0;
    var walked = 0;
    var i;
    for (i = 0; i < pts.length - 1; i++) {
      var ax = pts[i][0];
      var ay = pts[i][1];
      var bx = pts[i + 1][0];
      var by = pts[i + 1][1];
      var dx = bx - ax;
      var dy = by - ay;
      var lenSq = dx * dx + dy * dy;
      var t = lenSq < 1e-9 ? 0 : Math.max(0, Math.min(1, ((xy.x - ax) * dx + (xy.y - ay) * dy) / lenSq));
      var px = ax + t * dx;
      var py = ay + t * dy;
      var d = Math.hypot(xy.x - px, xy.y - py);
      var segLen = Math.sqrt(lenSq);
      if (d < bestDist) {
        bestDist = d;
        bestAlong = walked + t * segLen;
      }
      walked += segLen;
    }
    return { distAlong: bestAlong, distToLine: bestDist };
  }

  /**
   * All equipment nodes along a cable, ordered from originNode toward the far end.
   * Discovers daisy-chained FATs on one LineString (not just endpoints).
   */
  function getOrderedNodesOnCable(cable, originNode) {
    if (!cable) return [];
    var pts = cable.points || [];
    var linkDist = (deps && deps.getCableLinkDistance) ? deps.getCableLinkDistance() : 80;
    var hits = [];
    var seen = Object.create(null);

    function addHit(node, distAlong) {
      if (!node || !node.id) return;
      var id = String(node.id);
      if (seen[id]) {
        var j;
        for (j = 0; j < hits.length; j++) {
          if (String(hits[j].node.id) === id && distAlong < hits[j].distAlong) {
            hits[j].distAlong = distAlong;
          }
        }
        return;
      }
      seen[id] = true;
      hits.push({ node: node, distAlong: distAlong });
    }

    var snapIds = cable.pointSnapNodeIds || [];
    var i;
    for (i = 0; i < snapIds.length; i++) {
      if (!snapIds[i]) continue;
      var snapped = resolveMapNode(snapIds[i]);
      if (!snapped) continue;
      var along = i;
      if (pts.length >= 2) {
        var sxy = getNodeXY(snapped);
        if (sxy) along = projectOntoCablePolyline(sxy, pts).distAlong;
      }
      addHit(snapped, along);
    }

    var labels = cable.snapLabels || [];
    for (i = 0; i < labels.length; i++) {
      if (!labels[i]) continue;
      var byLabel = resolveSnapLabel(labels[i]);
      if (!byLabel) continue;
      var alongL = i;
      if (pts.length >= 2) {
        var lxy = getNodeXY(byLabel);
        if (lxy) alongL = projectOntoCablePolyline(lxy, pts).distAlong;
      }
      addHit(byLabel, alongL);
    }

    if (pts.length >= 2) {
      getMapNodes().forEach(function (node) {
        if (!node) return;
        if (!isFatOrPoleNode(node) && !isClosureNode(node) && !isCabinetNode(node)) return;
        var xy = getNodeXY(node);
        if (!xy) return;
        var proj = projectOntoCablePolyline(xy, pts);
        if (proj.distToLine > linkDist) return;
        addHit(node, proj.distAlong);
      });
    }

    var ends = resolveCableEndpoints(cable);
    if (ends.start) addHit(ends.start, 0);
    if (ends.end && pts.length) {
      var totalLen = 0;
      for (i = 0; i < pts.length - 1; i++) {
        totalLen += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      }
      addHit(ends.end, totalLen);
    }

    if (!hits.length) return [];
    hits.sort(function (a, b) { return a.distAlong - b.distAlong; });

    if (originNode && originNode.id) {
      var originId = String(originNode.id);
      var oIdx = -1;
      for (i = 0; i < hits.length; i++) {
        if (String(hits[i].node.id) === originId) {
          oIdx = i;
          break;
        }
      }
      if (oIdx < 0) {
        var bestO = Infinity;
        for (i = 0; i < hits.length; i++) {
          var d = nodeDistance(originNode, hits[i].node);
          if (d < bestO) {
            bestO = d;
            oIdx = i;
          }
        }
      }
      if (oIdx > 0) {
        var towardEnd = hits.slice(oIdx);
        var towardStart = hits.slice(0, oIdx + 1).reverse();
        var endSpan = towardEnd.length > 1
          ? towardEnd[towardEnd.length - 1].distAlong - towardEnd[0].distAlong
          : 0;
        var startSpan = towardStart.length > 1
          ? Math.abs(towardStart[towardStart.length - 1].distAlong - towardStart[0].distAlong)
          : 0;
        hits = endSpan >= startSpan ? towardEnd : towardStart;
      }
    }

    return hits.map(function (h) { return h.node; });
  }

  /* ─── Design record helpers used by engine ─── */

  function ensureEngineNode(mapNode) {
    var id = normalizeNodeId(mapNode && mapNode.id);
    if (!id) return null;
    if (!nodeStore[id]) {
      var location = null;
      if (deps && deps.getNodeLocation) location = deps.getNodeLocation(mapNode);
      nodeStore[id] = createEmptyNodeRecord(
        id,
        mapNode.type || 'closure',
        location,
        deps && deps.getCurrentUserId ? deps.getCurrentUserId() : null,
        { is_mock: false, source: 'auto_engine' }
      );
    }
    return nodeStore[id];
  }

  function findOrAddDesignCable(node, direction, mapCable, role) {
    var mapId = mapCable && mapCable.id != null ? String(mapCable.id) : '';
    var bucket = getCableBucket(node, direction);
    var i;
    for (i = 0; i < bucket.length; i++) {
      if (bucket[i] && String(bucket[i].map_cable_id || '') === mapId && mapId) {
        return bucket[i];
      }
    }
    var label = getCableLabel(mapCable);
    var capacity = Number(mapCable && mapCable.capacity) || parseCapacityFromLabel(label) || 12;
    var cable = createCable(direction, {
      name: label,
      capacity_f: capacity,
      role: role || (direction === 'inbound' ? 'main' : 'sub'),
      map_cable_id: mapId || null,
      id: mapId ? ('design_' + mapId + '_' + direction) : undefined,
    });
    bucket.push(cable);
    return cable;
  }

  function ensureTubeOnCable(cable, tubeNumber, tubeColor) {
    enforceFibersPerTube(cable.tubes);
    var tn = Number(tubeNumber) || 1;
    while (cable.tubes.length < tn) {
      var idx = cable.tubes.length;
      var fibers = [];
      var f;
      for (f = 0; f < FIBERS_PER_TUBE; f++) {
        fibers.push(createFiber(f + 1, STANDARD_FIBER_COLORS[f], 'available'));
      }
      cable.tubes.push(createTube(
        idx + 1,
        STANDARD_TUBE_COLORS[idx % STANDARD_TUBE_COLORS.length],
        fibers
      ));
    }
    var tube = cable.tubes[tn - 1];
    if (tubeColor) tube.tube_color = String(tubeColor).toLowerCase();
    return tube;
  }

  function addEngineSplice(node, fromRef, toRef, type, fatId) {
    var fromResolved = resolveFiberRef(node, fromRef);
    var toResolved = resolveFiberRef(node, toRef);
    if (!fromResolved || !toResolved) return null;

    var splice = {
      splice_id: createUuid(),
      from: normalizeFiberRef(fromRef),
      to: normalizeFiberRef(toRef),
      type: type,
      fiber_type: mapMatrixFiberType(type),
      fat_id: fatId != null ? String(fatId) : '',
    };
    node.splices.push(splice);
    fromResolved.fiber.status = 'spliced';
    toResolved.fiber.status = 'spliced';
    touchMetadata(node);
    return splice;
  }

  // FACTORY RESET: Generate Matrix rows from M-Cable
  // Scans map, finds M-Cable using topology, generates rows based on capacity
  function generateMainCableRows(cable, cabinetNode) {
    if (!cable) return [];

    // Verify this is a Main Cable using topology
    if (!isMainCableFromCabinet(cable)) return [];

    var capacity = cable.capacity_f || 12;
    var colorMapping = CAPACITY_COLOR_MAPPING[capacity];

    if (!colorMapping) {
      if (DEBUG) {
      console.warn('[FiberDesignManager] No color mapping for capacity:', capacity);
      }
      return [];
    }

    var tubes = colorMapping.tubes;
    var fibersPerTube = colorMapping.fibers_per_tube;
    var rows = [];

    // Loop through each tube in strict standard color order (already enforced by CAPACITY_COLOR_MAPPING)
    for (var t = 0; t < tubes.length; t++) {
      var tubeColor = tubes[t];

      // Loop through each fiber in this tube (always 6 fibers: Blue, Orange, Green, Brown, Slate, White)
      for (var f = 0; f < fibersPerTube; f++) {
        var fiberColor = FIBER_COLORS[f % FIBER_COLORS.length];

        rows.push({
          m_cable_id: cable.name || cable.id || '—',
          m_tube_color: tubeColor,
          m_fiber_color: fiberColor,
          closure_id: '', // Will be populated when splices are processed
          s_cable_id: '', // Will be populated when splices are processed
          s_tube_color: '', // Will be populated when splices are processed
          s_fiber_color: '', // Will be populated when splices are processed
          fiber_type: '', // Will be populated when splices are processed
          fat_id: '', // Will be populated when splices are processed
        });
      }
    }

    return rows;
  }

  // FACTORY RESET: Fixed M-Cable traversal across multiple closures using Physical Map Cables
  function traverseMainCablePathFixed(mapCables, allNodes, cabinetNode) {
    if (!mapCables || !allNodes) return;

    var mainMapCables = [];
    mapCables.forEach(function (mapCable) {
      var tempCable = {
        name: getCableLabel(mapCable),
        id: mapCable.id,
        points: mapCable.points,
        pointSnapNodeIds: mapCable.pointSnapNodeIds,
        snapLabels: mapCable.snapLabels,
        connectedTo: mapCable.connectedTo
      };
      if (isMainCableFromCabinet(tempCable, allNodes)) {
        mainMapCables.push(mapCable);
      }
    });

    // Track closure traversal order for matrix sorting
    var closureOrderMap = Object.create(null);
    var globalClosureOrder = 0;
    var closureTraversalDebug = [];

    mainMapCables.forEach(function (startMapCable) {
      var mainCableName = String(getCableLabel(startMapCable)).trim().toLowerCase();
      var visitedClosures = Object.create(null);
      var visitedCableSegments = Object.create(null);

      // Create running allocation cursor for this Main Cable
      var designCableForCursor = createCable('outbound', {
        name: getCableLabel(startMapCable),
        capacity_f: Number(startMapCable.capacity) || parseCapacityFromLabel(getCableLabel(startMapCable)) || 12,
        map_cable_id: startMapCable.id,
      });
      var cableCursor = getOrCreateMainPointer(designCableForCursor);

      var currentMapCable = startMapCable;
      var lastNode = cabinetNode;
      var hopCount = 0;

      while (currentMapCable && hopCount < 100) {
        hopCount++;
        var currentCableId = String(currentMapCable.id);

        if (visitedCableSegments[currentCableId]) break;
        visitedCableSegments[currentCableId] = true;

        var orderedNodes = getOrderedNodesOnCable(currentMapCable, lastNode);
        
        orderedNodes.forEach(function (node) {
          // CRITICAL FIX 3: Skip FAT/Pole Handholes (like FH6) for main backbone matrix
          var nodeLabel = String(getClosureLabel(node.id)).toUpperCase();
          var isPassThrough = (node.type === 'fat_handhole') || (nodeLabel.indexOf('FH') === 0);
          
          // Only process true splices/closures, ignore pass-through handholes
          if (isClosureNode(node) && !isPassThrough) {
            var closureId = String(node.id);
            if (!visitedClosures[closureId]) {
              visitedClosures[closureId] = true;
              
              // Assign closure traversal order
              if (!closureOrderMap[closureId]) {
                globalClosureOrder++;
                closureOrderMap[closureId] = globalClosureOrder;
                var closureLabel = getClosureLabel(node.id) || node.id;
                closureTraversalDebug.push(globalClosureOrder + ' - ' + closureLabel);
              }
              
              var designCable = createCable('outbound', {
                name: getCableLabel(currentMapCable),
                capacity_f: Number(currentMapCable.capacity) || parseCapacityFromLabel(getCableLabel(currentMapCable)) || 12,
                map_cable_id: currentMapCable.id,
              });
              
              var closureLabel = getClosureLabel(node.id) || node.id;
              var startTubeColor = cableCursor.tubeIndex < 8 ? CAPACITY_COLOR_MAPPING[48].tubes[cableCursor.tubeIndex] : 'N/A';
              var startFiberColor = cableCursor.fiberIndex < 6 ? STANDARD_COLOR_CODE[cableCursor.fiberIndex] : 'N/A';
              var globalOffsetBefore = (cableCursor.tubeIndex * 6) + cableCursor.fiberIndex;
              
              if (DEBUG) {
              console.log('Closure ID: ' + closureLabel);
              }
              if (DEBUG) {
              console.log('Main Cable ID: ' + mainCableName);
              }
              if (DEBUG) {
              console.log('Start Tube: ' + startTubeColor + ' (index ' + cableCursor.tubeIndex + ')');
              }
              if (DEBUG) {
              console.log('Start Fiber: ' + startFiberColor + ' (index ' + cableCursor.fiberIndex + ')');
              }
              if (DEBUG) {
              console.log('Global Fiber Offset Before: ' + globalOffsetBefore);
              }
              
              var cableRows = generateMainCableRowsForClosure(designCable, node, cabinetNode, cableCursor, closureOrderMap[closureId]);
              matrixRows = matrixRows.concat(cableRows);
              
              var endTubeColor = cableCursor.tubeIndex < 8 ? CAPACITY_COLOR_MAPPING[48].tubes[cableCursor.tubeIndex] : 'N/A';
              var endFiberColor = cableCursor.fiberIndex < 6 ? STANDARD_COLOR_CODE[cableCursor.fiberIndex] : 'N/A';
              var globalOffsetAfter = (cableCursor.tubeIndex * 6) + cableCursor.fiberIndex;
              
              if (DEBUG) {
              console.log('End Tube: ' + endTubeColor + ' (index ' + cableCursor.tubeIndex + ')');
              }
              if (DEBUG) {
              console.log('End Fiber: ' + endFiberColor + ' (index ' + cableCursor.fiberIndex + ')');
              }
              if (DEBUG) {
              console.log('Global Fiber Offset After: ' + globalOffsetAfter);
              }
              
              lastNode = node;
            }
          }
        });

        var nextMapCable = null;
        if (lastNode) {
          mapCables.forEach(function (candidateMapCable) {
            var candidateId = String(candidateMapCable.id);
            if (visitedCableSegments[candidateId]) return;

            var candidateName = String(getCableLabel(candidateMapCable)).trim().toLowerCase();
            if (candidateName !== mainCableName) return;

            var candidateNodes = getOrderedNodesOnCable(candidateMapCable, lastNode);
            if (candidateNodes.length > 0) {
              var firstNodeId = String(candidateNodes[0].id);
              var lastNodeId = String(candidateNodes[candidateNodes.length - 1].id);
              var targetNodeId = String(lastNode.id);
              
              if (firstNodeId === targetNodeId || lastNodeId === targetNodeId) {
                nextMapCable = candidateMapCable;
              }
            }
          });
        }

        if (!nextMapCable) break; 
        currentMapCable = nextMapCable;
      }
    });
    
    // Print closure traversal order debug
    if (DEBUG) {
    console.log('=== CLOSURE TRAVERSAL ORDER ===');
    }
    closureTraversalDebug.forEach(function (entry) {
      if (DEBUG) {
      console.log(entry);
      }
    });
  }

  function generateMainCableRowsForClosure(designCable, closureNode, cabinetNode, cableCursor, closureOrder) {
    var rows = [];
    var capacity = Number(designCable.capacity_f) || 48;
    var tubeColors = CAPACITY_COLOR_MAPPING[capacity] || CAPACITY_COLOR_MAPPING[48];
    var closureIdStr = String(getClosureLabel(closureNode.id) || closureNode.id);
    var mainCableId = String(designCable.name || designCable.id || '');
    
    // Use cursor to continue from last consumed position
    var startTubeIndex = cableCursor ? cableCursor.tubeIndex : 0;
    var startFiberIndex = cableCursor ? cableCursor.fiberIndex : 0;

    // Extract any active splices mapped to this closure in the global system/node
    var activeSplices = [];
    if (window.matrixSpliceMap && window.matrixSpliceMap[closureIdStr]) {
      activeSplices = window.matrixSpliceMap[closureIdStr];
    } else if (closureNode.splices) {
      activeSplices = closureNode.splices;
    }

    // Generate rows starting from cursor position instead of 0
    var currentTubeIndex = startTubeIndex;
    var currentFiberIndex = startFiberIndex;
    
    while (currentTubeIndex < tubeColors.length) {
      var tubeColor = tubeColors[currentTubeIndex];
      
      for (; currentFiberIndex < 6; currentFiberIndex++) {
        var fiberColor = STANDARD_COLOR_CODE[currentFiberIndex];
        
        var row = {
          cabinet_label: String(cabinetNode.name || cabinetNode.id || ''),
          closure_id: closureIdStr,
          m_cable_id: mainCableId,
          m_tube_color: tubeColor,
          m_fiber_color: fiberColor,
          s_cable_id: '—',
          s_tube_color: '—',
          s_fiber_color: '—',
          fat_distance: 0,
          fiber_type: 'Main',
          closure_order: closureOrder || 0
        };

        // Check if a sub-cable/splice matches this specific Main tube & fiber color
        var matchedSplice = activeSplices.find(function(s) {
          var tMatch = String(s.m_tube_color || '').trim().toLowerCase() === String(tubeColor).trim().toLowerCase();
          var fMatch = String(s.m_fiber_color || '').trim().toLowerCase() === String(fiberColor).trim().toLowerCase();
          return tMatch && fMatch;
        });

        if (matchedSplice) {
          row.s_cable_id = matchedSplice.s_cable_id || matchedSplice.sub_cable_id || '12F1';
          row.s_tube_color = matchedSplice.s_tube_color || tubeColor;
          row.s_fiber_color = matchedSplice.s_fiber_color || fiberColor;
          row.fat_distance = matchedSplice.fat_distance || 0;
        }

        rows.push(row);
      }
      
      // Move to next tube, reset fiber index
      currentFiberIndex = 0;
      currentTubeIndex++;
    }

    // Update cursor to next available fiber position
    if (cableCursor) {
      cableCursor.tubeIndex = currentTubeIndex;
      cableCursor.fiberIndex = currentFiberIndex;
    }

    return rows;
  }

  function buildMatrixRow(node, splice, cabinetNode) {
    var fromR = resolveFiberRef(node, splice.from);
    var toR = resolveFiberRef(node, splice.to);
    if (!fromR || !toR) return null;

    // FACTORY RESET: Strict Main Cable validation using Main Backbone Names
    var fromName = String(fromR.cable.name || fromR.cable.id || '').trim().toUpperCase();
    var toName = String(toR.cable.name || toR.cable.id || '').trim().toUpperCase();

    // STRICT RULE: Prevent Main Cable self-splicing (continuous backbone routing)
    // If both cables have the same name, this is NOT a distribution splice
    if (fromName === toName) {
      if (DEBUG) {
      console.log('[FiberDesignManager] buildMatrixRow: Skipping self-splice (same cable): ' + fromName);
      }
      return null; // This is continuous backbone routing, not a splice
    }

    // STRICT RULE: Use Main Backbone Names for Main Cable identification
    var fromIsMain = isMainCableFromCabinet(fromR.cable);
    var toIsMain = isMainCableFromCabinet(toR.cable);

    var mainSide = null;
    var subSide = null;

    // STRICT RULE: Main Cable CANNOT be assigned to S-Cable columns
    // If both are Main Cables, skip this splice (invalid configuration)
    if (fromIsMain && toIsMain) {
      if (DEBUG) {
      console.log('[FiberDesignManager] buildMatrixRow: Both cables are Main - skipping invalid splice: ' + fromName + ' <-> ' + toName);
      }
      return null;
    }

    // Assign Main and Sub sides
    if (fromIsMain && !toIsMain) {
      mainSide = fromR;
      subSide = toR;
    } else if (toIsMain && !fromIsMain) {
      mainSide = toR;
      subSide = fromR;
    } else if (!fromIsMain && !toIsMain) {
      // Both are Sub cables - this is a distribution-to-distribution splice
      // Use direction to determine which is "primary" for display
      if (fromR.cable.direction === 'inbound' && toR.cable.direction === 'outbound') {
        mainSide = fromR;
        subSide = toR;
      } else if (toR.cable.direction === 'inbound' && fromR.cable.direction === 'outbound') {
        mainSide = toR;
        subSide = fromR;
      } else {
        // Default: from is primary, to is secondary
        mainSide = fromR;
        subSide = toR;
      }
    }

    var cab = cabinetNode || currentCabinetCtx || findServingCabinet(
      (deps && deps.resolveNodeById) ? deps.resolveNodeById(node.node_id) : null
    );

    var mainFiberIndex = -1;
    if (mainSide && mainSide.tube && mainSide.fiber) {
      var tubeNumber = Number(mainSide.tube.tube_number) || 1;
      var fiberNumber = Number(mainSide.fiber.fiber_number) || 1;
      mainFiberIndex = (tubeNumber - 1) * FIBERS_PER_TUBE + (fiberNumber - 1);
    }
    var explicitMainTubeColor = null;
    var explicitMainFiberColor = null;
    if (mainFiberIndex >= 0) {
      explicitMainTubeColor = TUBE_COLORS[Math.floor(mainFiberIndex / FIBERS_PER_TUBE) % TUBE_COLORS.length];
      explicitMainFiberColor = FIBER_COLORS[mainFiberIndex % FIBER_COLORS.length];
    }

    // CRITICAL FIX: Use the actual closure node where this splice occurs
    // This ensures accurate closure mapping for S-Cables
    var actualClosureId = getClosureLabel(node.node_id);

    return {
      node_id: node.node_id,
      closure_id: actualClosureId, // Use actual closure node ID
      cabinet_id: cab ? String(cab.id) : '',
      cabinet_label: cab ? getCabinetLabel(cab) : '—',
      m_cable_id: cableDisplayId(mainSide.cable),
      m_tube_color: explicitMainTubeColor || mainSide.tube.tube_color,
      m_fiber_color: explicitMainFiberColor || mainSide.fiber.fiber_color,
      s_cable_id: cableDisplayId(subSide.cable),
      s_tube_color: subSide.tube.tube_color,
      s_fiber_color: subSide.fiber.fiber_color,
      fiber_type: splice.fiber_type || mapMatrixFiberType(splice.type),
      fat_id: fatIdNumericOnly(splice.fat_id || getFatIdForNode(node.node_id) || ''),
      splice_id: splice.splice_id,
    };
  }

  function assignFatAtClosure(closureNode, inboundMapCable, outboundMapCable, fatNode, mainPointer, subPointer, cabinetNode, fatDistance) {
    var designNode = ensureEngineNode(closureNode);
    if (!designNode || !subPointer) return;

    var mainCable = findOrAddDesignCable(designNode, 'inbound', inboundMapCable, 'main');
    var subCable = findOrAddDesignCable(designNode, 'outbound', outboundMapCable, 'sub');

    // Use a shared main pointer per main cable so allocations persist globally.
    // Never reset this pointer - it continues across all closures and sub cables.
    var sharedMainPointer = getOrCreateMainPointer(mainCable);
    var mainAsg = sharedMainPointer.nextPair();
    var subAsg = subPointer.nextPair();
    if (!mainAsg || !subAsg) return;

    var mainTube = ensureTubeOnCable(mainCable, mainAsg.tube_number, mainAsg.tube_color);
    var subTube = ensureTubeOnCable(subCable, subAsg.tube_number, subAsg.tube_color);

    var fatId = fatIdNumericOnly(getFatLabelForNode(fatNode));
    var specs = [
      {
        type: 'Main',
        mColor: mainAsg.main_fiber_color,
        mIndex: mainAsg.main_fiber_index,
        sColor: subAsg.main_fiber_color,
        sIndex: subAsg.main_fiber_index,
      },
      {
        type: 'Expansion',
        mColor: mainAsg.expansion_fiber_color,
        mIndex: mainAsg.expansion_fiber_index,
        sColor: subAsg.expansion_fiber_color,
        sIndex: subAsg.expansion_fiber_index,
      },
    ];

    specs.forEach(function (spec) {
      var mFiber = mainTube.fibers[spec.mIndex] || findFiberByColor(mainTube, spec.mColor);
      var sFiber = subTube.fibers[spec.sIndex] || findFiberByColor(subTube, spec.sColor);
      if (!mFiber || !sFiber) return;
      if (mFiber.status === 'spliced' || sFiber.status === 'spliced') return;

      var splice = addEngineSplice(
        designNode,
        { cable_id: mainCable.id, tube_id: mainTube.id, fiber_id: mFiber.id },
        { cable_id: subCable.id, tube_id: subTube.id, fiber_id: sFiber.id },
        spec.type,
        fatId
      );
      if (!splice) return;
      var row = buildMatrixRow(designNode, splice, cabinetNode || currentCabinetCtx);
      if (row) {
        row.fat_id = fatId;
        row.fat_distance = fatDistance || 0;
        matrixRows.push(row);
      }
    });

    if (designNode.metadata) {
      designNode.metadata.is_mock = false;
      designNode.metadata.source = 'auto_engine';
    }
  }

  /* ─── Topology graph + DFS ─── */

  function addGraphEdge(graph, cable, aNode, bNode, cableIdx, virtual) {
    if (!aNode || !bNode || !aNode.id || !bNode.id) return null;
    if (String(aNode.id) === String(bNode.id)) return null;
    var a = String(aNode.id);
    var b = String(bNode.id);
    if (!graph.adj[a]) graph.adj[a] = [];
    if (!graph.adj[b]) graph.adj[b] = [];
    if (!graph.nodeById[a]) graph.nodeById[a] = aNode;
    if (!graph.nodeById[b]) graph.nodeById[b] = bNode;

    var edgeId = (virtual ? 'virtual_' : '') + (cable && cable.id ? cable.id : ('edge_' + cableIdx)) +
      '_' + a + '_' + b;
    /* Allow multiple segments of the same physical cable (daisy-chain FATs).
       Only reject an exact undirected a↔b duplicate. */
    var exists = graph.edges.some(function (e) {
      return (e.a === a && e.b === b) || (e.a === b && e.b === a);
    });
    if (exists) return null;

    var edge = {
      id: edgeId,
      cable: cable || { id: edgeId, capacity: 48, name: 'Feeder' },
      a: a,
      b: b,
      order: cableIdx,
      virtual: !!virtual,
    };
    graph.edges.push(edge);
    graph.adj[a].push({ to: b, edge: edge, directedFrom: a });
    graph.adj[b].push({ to: a, edge: edge, directedFrom: b });
    return edge;
  }

  function buildTopologyGraph() {
    var nodes = getMapNodes();
    var cables = getMapCables();
    var graph = {
      nodeById: Object.create(null),
      adj: Object.create(null),
      edges: [],
    };

    nodes.forEach(function (n) {
      if (!n || !n.id) return;
      graph.nodeById[String(n.id)] = n;
      graph.adj[String(n.id)] = [];
    });

    /*
     * Segment each map cable into consecutive equipment nodes along the
     * LineString (Closure → FAT → FAT → … → dead end). Endpoint-only edges
     * hide daisy-chained FATs from DFS.
     */
    cables.forEach(function (cable, cableIdx) {
      var ends = resolveCableEndpoints(cable);
      var origin = ends.start || ends.end || null;
      var ordered = getOrderedNodesOnCable(cable, origin);
      if (ordered.length >= 2) {
        var si;
        for (si = 0; si < ordered.length - 1; si++) {
          addGraphEdge(graph, cable, ordered[si], ordered[si + 1], cableIdx, false);
        }
        return;
      }
      if (ends.start && ends.end) {
        addGraphEdge(graph, cable, ends.start, ends.end, cableIdx, false);
      }
    });

    /*
     * If last-mile cables never snap onto the FDT itself, still attach them to
     * their serving cabinet so DFS can start from every Root Node.
     */
    cables.forEach(function (cable, cableIdx) {
      var ends = resolveCableEndpoints(cable);
      if (!ends.start || !ends.end) return;
      if (isCabinetNode(ends.start) || isCabinetNode(ends.end)) return;

      var fdt = findServingCabinet(ends.start) || findServingCabinet(ends.end);
      if (!fdt) return;

      var attach = null;
      if (isClosureNode(ends.start)) attach = ends.start;
      else if (isClosureNode(ends.end)) attach = ends.end;
      else if (isFatOrPoleNode(ends.start) && !isFatOrPoleNode(ends.end)) attach = ends.end;
      else if (isFatOrPoleNode(ends.end) && !isFatOrPoleNode(ends.start)) attach = ends.start;
      else attach = ends.start;

      if (!attach || isCabinetNode(attach)) return;
      addGraphEdge(graph, cable, fdt, attach, cableIdx + 100000, true);
    });

    Object.keys(graph.adj).forEach(function (id) {
      graph.adj[id].sort(function (x, y) {
        return (x.edge.order || 0) - (y.edge.order || 0);
      });
    });

    return graph;
  }

  function findRootCabinets(nodeById) {
    var roots = [];
    var seen = Object.create(null);
    Object.keys(nodeById).forEach(function (id) {
      if (isCabinetNode(nodeById[id])) {
        roots.push(nodeById[id]);
        seen[id] = true;
      }
    });
    /* Also pick up FDTs that exist on the map even if not yet edged */
    getMapNodes().forEach(function (n) {
      if (!n || !n.id || seen[String(n.id)]) return;
      if (isCabinetNode(n)) {
        roots.push(n);
        seen[String(n.id)] = true;
        nodeById[String(n.id)] = n;
      }
    });
    roots.sort(function (a, b) {
      return String(a.autoName || a.id).localeCompare(String(b.autoName || b.id), undefined, { numeric: true });
    });
    return roots;
  }

  /**
   * Collect ALL FAT/Pole nodes along one outbound Sub-Cable branch from a Closure.
   *
   * Phase 1 — walk the entire Sub-Cable LineString to the dead end and gather
   * every FAT on that exact path (closest → farthest). Do NOT allocate yet.
   * Phase 2 — continue through any further graph edges that share / extend
   * that branch (continuation cables), stopping at the next pure Closure.
   */
  function collectFatsAlongBranch(graph, closureNode, startLink, usedEdges, edgeKeyFn) {
    var closureId = String(closureNode.id);
    var results = [];
    var seenFat = Object.create(null);
    var visited = Object.create(null);
    visited[closureId] = true;

    function pushFat(node, hops, pathDist, edge) {
      if (!node || !isFatOrPoleNode(node)) return;
      var id = String(node.id);
      if (seenFat[id]) return;
      seenFat[id] = true;
      results.push({
        node: node,
        hops: hops,
        pathDist: pathDist,
        edge: edge || startLink.edge,
      });
    }

    var startCable = startLink.edge && startLink.edge.cable;
    var tipId = null;

    if (startCable) {
      var ordered = getOrderedNodesOnCable(startCable, closureNode);
      var oi;
      for (oi = 0; oi < ordered.length; oi++) {
        var on = ordered[oi];
        if (!on || !on.id) continue;
        var oid = String(on.id);
        if (oid === closureId) {
          visited[oid] = true;
          continue;
        }
        /* Next pure splice Closure ends this Sub-Cable domain */
        if (isClosureNode(on) && !isFatOrPoleNode(on)) {
          visited[oid] = true;
          break;
        }
        visited[oid] = true;
        tipId = oid;
        pushFat(on, results.length + 1, oi, startLink.edge);
      }

      /* Mark every graph segment that belongs to this Sub-Cable as used */
      var cableId = String(startCable.id || '');
      if (cableId && graph.edges) {
        graph.edges.forEach(function (e) {
          if (!e || e.virtual) return;
          if (String(e.cable && e.cable.id) !== cableId) return;
          usedEdges[edgeKeyFn(e)] = true;
        });
      } else if (startLink.edge) {
        usedEdges[edgeKeyFn(startLink.edge)] = true;
      }
    } else if (startLink.edge) {
      usedEdges[edgeKeyFn(startLink.edge)] = true;
    }

    /*
     * Phase 2: BFS only from the LineString dead-end tip for FATs on
     * continuation cables (same branch, different cable id).
     */
    if (!tipId && startLink.to) {
      tipId = String(startLink.to);
      visited[tipId] = true;
    }

    var queue = [];
    if (tipId && graph.nodeById[tipId]) {
      var tipNode = graph.nodeById[tipId];
      queue.push({
        id: tipId,
        parent: closureId,
        hops: Math.max(1, results.length),
        pathDist: cablePathDistanceFromNode(startCable, closureNode, tipNode) ||
          nodeDistance(closureNode, tipNode),
        edge: startLink.edge,
      });
    }

    while (queue.length) {
      queue.sort(function (a, b) {
        if (a.hops !== b.hops) return a.hops - b.hops;
        return a.pathDist - b.pathDist;
      });
      var cur = queue.shift();
      if (!cur) continue;

      var node = graph.nodeById[cur.id];
      if (!node) continue;

      /* Tip is usually already collected in phase 1; still expand from it. */
      if (!(String(cur.id) === tipId && seenFat[tipId])) {
        pushFat(node, cur.hops, cur.pathDist, cur.edge);
      }

      if (isClosureNode(node) && !isFatOrPoleNode(node) && String(node.id) !== closureId) {
        continue;
      }

      var neighbors = graph.adj[cur.id] || [];
      var i;
      for (i = 0; i < neighbors.length; i++) {
        var link = neighbors[i];
        var nextId = String(link.to);
        if (nextId === cur.parent || visited[nextId]) continue;
        var nextNode = graph.nodeById[nextId];
        if (!nextNode || isCabinetNode(nextNode)) continue;
        if (isClosureNode(nextNode) && !isFatOrPoleNode(nextNode)) continue;

        visited[nextId] = true;
        usedEdges[edgeKeyFn(link.edge)] = true;

        var hopDist = cur.pathDist + (
          cablePathDistanceFromNode(link.edge.cable, node, nextNode) || nodeDistance(node, nextNode)
        );
        queue.push({
          id: nextId,
          parent: cur.id,
          hops: cur.hops + 1,
          pathDist: hopDist,
          edge: link.edge,
        });
      }
    }

    results.sort(function (a, b) {
      if (a.hops !== b.hops) return a.hops - b.hops;
      return a.pathDist - b.pathDist;
    });
    return results;
  }

  /**
   * DFS from cabinet. At each Closure:
   * 1. Enter each outbound Sub-Cable
   * 2. FIRST collect ALL FATs on that branch to the dead end
   * 3. THEN allocate exactly 2 Main-Cable fibers per FAT (continuous tube math)
   *    Sub-Cable pointer resets to Blue/0 for each new outbound cable
   */
  function dfsDesignFromRoot(root, graph) {
    var usedEdges = Object.create(null);
    var processedClosures = Object.create(null);
    currentCabinetCtx = root;

    function edgeKey(edge) {
      return String(edge.id);
    }

    function processClosureDistribution(closureNode, mainCable, mainPointer, parentId) {
      var closureId = String(closureNode.id);
      if (processedClosures[closureId]) return;
      processedClosures[closureId] = true;

      if (!mainPointer) {
        mainPointer = createMainFiberPointer(Number(mainCable && mainCable.capacity) || 48);
      }

      var neighbors = (graph.adj[closureId] || []).slice();
      var outbound = [];
      var i;
      for (i = 0; i < neighbors.length; i++) {
        var link = neighbors[i];
        if (parentId && String(link.to) === String(parentId)) continue;
        if (usedEdges[edgeKey(link.edge)]) continue;
        var nextNode = graph.nodeById[link.to];
        if (!nextNode || isCabinetNode(nextNode)) continue;

        /* Deduplicate by physical Sub-Cable id — one collect/allocate pass per cable */
        var cid = link.edge && link.edge.cable && link.edge.cable.id
          ? String(link.edge.cable.id)
          : edgeKey(link.edge);
        var already = outbound.some(function (o) {
          var oc = o.link.edge && o.link.edge.cable && o.link.edge.cable.id;
          return oc ? String(oc) === cid : edgeKey(o.link.edge) === cid;
        });
        if (already) continue;

        outbound.push({
          link: link,
          nextNode: nextNode,
          geo: nodeDistance(closureNode, nextNode),
          order: link.edge.order || 0,
        });
      }

      outbound.sort(function (a, b) {
        if (a.order !== b.order) return a.order - b.order;
        return a.geo - b.geo;
      });

      for (i = 0; i < outbound.length; i++) {
        var out = outbound[i];
        var subCable = out.link.edge.cable;
        var subPointer = createSubCablePointer(Number(subCable && subCable.capacity) || 12);

        /* Collect ALL FATs on this Sub-Cable first — then allocate sequentially */
        var fats = collectFatsAlongBranch(graph, closureNode, out.link, usedEdges, edgeKey);

        if (!fats.length && isFatOrPoleNode(out.nextNode)) {
          usedEdges[edgeKey(out.link.edge)] = true;
          fats = [{
            node: out.nextNode,
            hops: 1,
            pathDist: out.geo,
            edge: out.link.edge,
          }];
        }

        var f;
        for (f = 0; f < fats.length; f++) {
          assignFatAtClosure(
            closureNode,
            mainCable,
            subCable,
            fats[f].node,
            mainPointer,
            subPointer,
            root,
            fats[f].pathDist
          );
        }

        if (isClosureNode(out.nextNode) && !isFatOrPoleNode(out.nextNode)) {
          usedEdges[edgeKey(out.link.edge)] = true;
          var nestedMain = out.link.edge.cable;
          // Use shared main pointer for nested closures to maintain continuous allocation
          var nestedPtr = getOrCreateMainPointer(nestedMain);
          processClosureDistribution(out.nextNode, nestedMain, nestedPtr, closureId);
        } else if (isFatOrPoleNode(out.nextNode) && isClosureNode(out.nextNode)) {
          processClosureDistribution(out.nextNode, mainCable, mainPointer, closureId);
        }
      }
    }

    function visitTowardClosures(nodeId, parentId, pathCtx) {
      var node = graph.nodeById[nodeId];
      if (!node) return;
      var ctx = pathCtx || { mainCable: null, mainPointer: null };
      var neighbors = graph.adj[nodeId] || [];
      var i;

      for (i = 0; i < neighbors.length; i++) {
        var link = neighbors[i];
        var ek = edgeKey(link.edge);
        if (usedEdges[ek]) continue;
        if (parentId && String(link.to) === String(parentId)) continue;

        var nextId = String(link.to);
        var nextNode = graph.nodeById[nextId];
        var cable = link.edge.cable;
        if (!nextNode) continue;

        if (isCabinetNode(node)) {
          var feederPtr = createMainFiberPointer(Number(cable && cable.capacity) || 48);
          usedEdges[ek] = true;
          if (isClosureNode(nextNode) || isFatOrPoleNode(nextNode)) {
            processClosureDistribution(nextNode, cable, feederPtr, nodeId);
          }
          visitTowardClosures(nextId, nodeId, {
            mainCable: cable,
            mainPointer: feederPtr,
          });
          continue;
        }

        if (isClosureNode(nextNode) || isFatOrPoleNode(nextNode)) {
          usedEdges[ek] = true;
          var ptr = ctx.mainPointer || createMainFiberPointer(Number((ctx.mainCable || cable).capacity) || 48);
          var mainCab = ctx.mainCable || cable;
          processClosureDistribution(nextNode, mainCab, ptr, nodeId);
          visitTowardClosures(nextId, nodeId, {
            mainCable: mainCab,
            mainPointer: ptr,
          });
          continue;
        }

        usedEdges[ek] = true;
        visitTowardClosures(nextId, nodeId, ctx);
      }
    }

    visitTowardClosures(String(root.id), null, {
      mainCable: null,
      mainPointer: null,
    });
    currentCabinetCtx = null;
  }

  function rebuildRegistries() {
    var cabSeen = Object.create(null);
    var cloSeen = Object.create(null);
    cabinetRegistry = [];
    closureRegistry = [];

    getMapNodes().forEach(function (n) {
      if (!n || !isCabinetNode(n)) return;
      var id = String(n.id);
      if (cabSeen[id]) return;
      cabSeen[id] = true;
      cabinetRegistry.push({
        node_id: id,
        cabinet_id: id,
        cabinet_label: getCabinetLabel(n),
      });
    });

    matrixRows.forEach(function (row) {
      if (row.cabinet_id && !cabSeen[row.cabinet_id]) {
        cabSeen[row.cabinet_id] = true;
        cabinetRegistry.push({
          node_id: row.cabinet_id,
          cabinet_id: row.cabinet_id,
          cabinet_label: row.cabinet_label || row.cabinet_id,
        });
      }
      if (row.node_id && !cloSeen[row.node_id]) {
        cloSeen[row.node_id] = true;
        closureRegistry.push({
          node_id: String(row.node_id),
          closure_id: row.closure_id || String(row.node_id),
          cabinet_id: row.cabinet_id || '',
          cabinet_label: row.cabinet_label || '',
        });
      }
    });

    if (deps && deps.getClosureNodes) {
      (deps.getClosureNodes() || []).forEach(function (n) {
        var id = normalizeNodeId(n.id);
        if (!id || cloSeen[id]) return;
        cloSeen[id] = true;
        var cab = findServingCabinet(n);
        closureRegistry.push({
          node_id: id,
          closure_id: getClosureLabel(id),
          cabinet_id: cab ? String(cab.id) : '',
          cabinet_label: cab ? getCabinetLabel(cab) : '',
        });
      });
    }

    cabinetRegistry.sort(function (a, b) {
      return String(a.cabinet_label).localeCompare(String(b.cabinet_label), undefined, { numeric: true });
    });
    closureRegistry.sort(function (a, b) {
      return String(a.closure_id).localeCompare(String(b.closure_id), undefined, { numeric: true });
    });
  }

  function sortMatrixRows(rows) {
    return rows.slice().sort(function (a, b) {
      // CRITICAL FIX: Sort by cabinet first
      if (a.cabinet_label !== b.cabinet_label) {
        return String(a.cabinet_label || '').localeCompare(String(b.cabinet_label || ''), undefined, { numeric: true });
      }
      // Then by M-Cable ID
      if (a.m_cable_id !== b.m_cable_id) {
        return String(a.m_cable_id).localeCompare(String(b.m_cable_id), undefined, { numeric: true });
      }
      // PRESERVE TRAVERSAL ORDER: Sort by closure_order (not closure_id)
      // This ensures closures appear in the order they were traversed from the map
      if (a.closure_order !== b.closure_order) {
        return (a.closure_order || 0) - (b.closure_order || 0);
      }
      // Then by S-Cable ID
      if (a.s_cable_id !== b.s_cable_id) {
        return String(a.s_cable_id).localeCompare(String(b.s_cable_id), undefined, { numeric: true });
      }
      // CRITICAL FIX: STRICT tube color order - use STANDARD_COLOR_CODE index
      if (a.m_tube_color !== b.m_tube_color) {
        var aIndex = STANDARD_COLOR_CODE.indexOf(String(a.m_tube_color).toLowerCase());
        var bIndex = STANDARD_COLOR_CODE.indexOf(String(b.m_tube_color).toLowerCase());
        return aIndex - bIndex;
      }
      if (a.s_tube_color !== b.s_tube_color) {
        var aIndex = STANDARD_COLOR_CODE.indexOf(String(a.s_tube_color).toLowerCase());
        var bIndex = STANDARD_COLOR_CODE.indexOf(String(b.s_tube_color).toLowerCase());
        return aIndex - bIndex;
      }
      // Sort FATs by topology distance from Closure (nearest first)
      var ad = Number(a.fat_distance) || 0;
      var bd = Number(b.fat_distance) || 0;
      if (ad !== bd) return ad - bd;
      if (a.fiber_type !== b.fiber_type) {
        return a.fiber_type === 'Main' ? -1 : 1;
      }
      return (a.m_fiber_color || '').localeCompare(b.m_fiber_color || '');
    });
  }

  function emitDesignChanged() {
    var i;
    for (i = 0; i < listeners.length; i++) {
      try { listeners[i]({ version: lastDesignVersion, rows: matrixRows.length }); } catch (e) { /* ignore */ }
    }
    if (global.FTTHFiberDesignUI && global.FTTHFiberDesignUI.refreshMatrix) {
      global.FTTHFiberDesignUI.refreshMatrix();
    }
    if (global.FTTHFiberDesignMatrixModal && global.FTTHFiberDesignMatrixModal.refresh) {
      global.FTTHFiberDesignMatrixModal.refresh();
    }
  }

  /**
   * AutoFiberEngine — reactive DFS design rebuild.
   */
  var AutoFiberEngine = {
    /**
     * Immediately scan current map state and rebuild matrix rows.
     */
    regenerate: function () {
      if (DEBUG) {
      console.log('[FiberDesignManager] regenerate START');
      }
      var startTime = Date.now();
      try {
        nodeStore = Object.create(null);
        matrixRows = [];
        currentCabinetCtx = null;
        mainPointers = Object.create(null); // reset per-regeneration

        if (DEBUG) {
        console.log('[FiberDesignManager] regenerate: building topology graph');
        }
        var graph = buildTopologyGraph();
        if (DEBUG) {
        console.log('[FiberDesignManager] regenerate: graph edges = ' + graph.edges.length);
        }

        if (DEBUG) {
        console.log('[FiberDesignManager] regenerate: finding root cabinets');
        }
        var roots = findRootCabinets(graph.nodeById);
        if (DEBUG) {
        console.log('[FiberDesignManager] regenerate: roots count = ' + roots.length);
        }

        if (!roots.length) {
          if (DEBUG) {
          console.log('[FiberDesignManager] regenerate: no roots, processing closure nodes');
          }
          (deps && deps.getClosureNodes ? deps.getClosureNodes() : []).forEach(function (n) {
            ensureEngineNode(n);
          });
        } else {
          if (DEBUG) {
          console.log('[FiberDesignManager] regenerate: processing ' + roots.length + ' roots');
          }
          roots.forEach(function (root) {
            if (!graph.adj[String(root.id)]) graph.adj[String(root.id)] = [];
            if (!graph.nodeById[String(root.id)]) graph.nodeById[String(root.id)] = root;
            dfsDesignFromRoot(root, graph);
          });
        }

        // FACTORY RESET: Register Main Backbone Names from Cabinet-connected cables
        if (DEBUG) {
        console.log('[FiberDesignManager] regenerate: registering Main Backbone Names');
        }
        var mapCables = getMapCables();
        var allNodes = getMapNodes();
        if (DEBUG) {
        console.log('[FiberDesignManager] regenerate: map cables = ' + mapCables.length);
        }
        registerMainBackboneNames(mapCables, allNodes);

        // FACTORY RESET: Generate Main Cable rows using fixed continuous traversal
        if (DEBUG) {
        console.log('[FiberDesignManager] regenerate: generating Main Cable rows with fixed traversal');
        }
        traverseMainCablePathFixed(mapCables, allNodes, roots[0]);

        if (DEBUG) {
        console.log('[FiberDesignManager] regenerate: matrix rows before sort = ' + matrixRows.length);
        }
        matrixRows = sortMatrixRows(matrixRows);
        if (DEBUG) {
        console.log('[FiberDesignManager] regenerate: matrix rows after sort = ' + matrixRows.length);
        }

        rebuildRegistries();
        if (DEBUG) {
        console.log('[FiberDesignManager] regenerate: cabinets = ' + cabinetRegistry.length + ', closures = ' + closureRegistry.length);
        }

        lastDesignVersion += 1;
        emitDesignChanged();

        var endTime = Date.now();
        if (DEBUG) {
        console.log('[FiberDesignManager] regenerate SUCCESS: duration=' + (endTime - startTime) + 'ms, rows=' + matrixRows.length);
        }
        return {
          ok: true,
          version: lastDesignVersion,
          rows: matrixRows.length,
          cabinets: cabinetRegistry.length,
          roots: roots.map(function (r) { return r.id; }),
          edges: graph.edges.length,
        };
      } catch (e) {
        var endTime = Date.now();
        console.error('[FiberDesignManager] regenerate EXCEPTION:', e.message);
        console.error('[FiberDesignManager] regenerate STACK:', e.stack);
        console.error('[FiberDesignManager] regenerate duration=' + (endTime - startTime) + 'ms, rows=' + matrixRows.length);
        throw e;
      }
    },

    scanMapAndRegenerate: function () {
      return AutoFiberEngine.regenerate();
    },

    getMatrixRows: function (filters) {
      if (DEBUG) {
      console.log('[FiberDesignManager] getMatrixRows START');
      }
      try {
        var cabinetFilter = 'all';
        var closureFilter = 'all';
        if (filters && typeof filters === 'object') {
          cabinetFilter = filters.cabinet != null ? String(filters.cabinet) : 'all';
          closureFilter = filters.closure != null ? String(filters.closure) : 'all';
        } else if (filters != null) {
          closureFilter = String(filters);
        }
        if (DEBUG) {
        console.log('[FiberDesignManager] getMatrixRows: cabinetFilter=' + cabinetFilter + ', closureFilter=' + closureFilter);
        }
        if (DEBUG) {
        console.log('[FiberDesignManager] getMatrixRows: total matrixRows = ' + matrixRows.length);
        }

        var filtered = matrixRows.filter(function (r) {
          if (cabinetFilter !== 'all' && String(r.cabinet_id) !== cabinetFilter) return false;
          if (closureFilter !== 'all' && String(r.node_id) !== closureFilter) return false;
          // TEMPORARILY DISABLED: Filter to show only 48F main cables
          // This filter might be returning empty results
          // var mCableId = String(r.m_cable_id || '').toUpperCase();
          // if (mCableId.indexOf('48F') === -1) return false;
          return true;
        });

        if (DEBUG) {
        console.log('[FiberDesignManager] getMatrixRows: filtered rows = ' + filtered.length);
        }
        if (DEBUG) {
        console.log('[FiberDesignManager] getMatrixRows SUCCESS');
        }
        return deepClone(filtered);
      } catch (e) {
        console.error('[FiberDesignManager] getMatrixRows EXCEPTION:', e.message);
        console.error('[FiberDesignManager] getMatrixRows STACK:', e.stack);
        throw e;
      }
    },

    getCabinetRegistry: function () {
      return deepClone(cabinetRegistry);
    },

    getClosuresForCabinet: function (cabinetFilter) {
      var filter = cabinetFilter != null ? String(cabinetFilter) : 'all';
      if (filter === 'all') return deepClone(closureRegistry);
      return deepClone(closureRegistry.filter(function (c) {
        return String(c.cabinet_id) === filter;
      }));
    },

    getVersion: function () {
      return lastDesignVersion;
    },

    subscribe: function (fn) {
      if (typeof fn !== 'function') return function () {};
      listeners.push(fn);
      return function () {
        listeners = listeners.filter(function (f) { return f !== fn; });
      };
    },
  };

  function notifyTopologyChanged() {
    if (regenTimer) clearTimeout(regenTimer);
    regenTimer = setTimeout(function () {
      regenTimer = null;
      AutoFiberEngine.regenerate();
    }, 60);
  }

  function initNodeData(nodeId, nodeType, location, options) {
    var id = normalizeNodeId(nodeId);
    if (!id) return null;
    options = options || {};
    if (nodeStore[id] && !options.replace) {
      return deepClone(nodeStore[id]);
    }
    var createdBy = options.createdBy != null
      ? options.createdBy
      : (deps && deps.getCurrentUserId ? deps.getCurrentUserId() : null);
    var record = createEmptyNodeRecord(id, nodeType, location, createdBy, {
      is_mock: !!options.is_mock,
      source: options.is_mock ? 'mock' : 'auto_engine',
    });
    nodeStore[id] = record;
    return deepClone(record);
  }

  function getNodeData(nodeId) {
    var id = normalizeNodeId(nodeId);
    if (!id || !nodeStore[id]) return null;
    return deepClone(nodeStore[id]);
  }

  function hasNodeData(nodeId) {
    var id = normalizeNodeId(nodeId);
    return !!(id && nodeStore[id]);
  }

  function addSpliceConnection(nodeId, fromIds, toIds, type, extra) {
    var id = normalizeNodeId(nodeId);
    if (!id || !nodeStore[id]) return { ok: false, error: 'node_not_found' };

    var fromRef = normalizeFiberRef(fromIds);
    var toRef = normalizeFiberRef(toIds);
    if (!fromRef || !toRef) return { ok: false, error: 'invalid_fiber_ref' };
    if (fiberRefKey(fromRef) === fiberRefKey(toRef)) {
      return { ok: false, error: 'same_fiber_endpoint' };
    }

    var node = nodeStore[id];
    var fromResolved = resolveFiberRef(node, fromRef);
    var toResolved = resolveFiberRef(node, toRef);
    if (!fromResolved || !toResolved) return { ok: false, error: 'fiber_not_found_in_node' };

    if (fromResolved.fiber.status === 'spliced') {
      return { ok: false, error: 'from_fiber_already_spliced' };
    }
    if (toResolved.fiber.status === 'spliced') {
      return { ok: false, error: 'to_fiber_already_spliced' };
    }

    var spliceType = isNonEmptyString(type) ? String(type).trim() : 'Main';
    extra = extra || {};
    var splice = {
      splice_id: createUuid(),
      from: fromRef,
      to: toRef,
      type: spliceType,
      fiber_type: mapMatrixFiberType(spliceType),
      fat_id: extra.fat_id != null ? String(extra.fat_id) : getFatIdForNode(id),
    };

    node.splices.push(splice);
    fromResolved.fiber.status = 'spliced';
    toResolved.fiber.status = 'spliced';
    if (node.metadata) {
      node.metadata.is_mock = false;
      node.metadata.source = 'auto_engine';
    }
    touchMetadata(node);

    var row = buildMatrixRow(node, splice);
    if (row) matrixRows.push(row);
    matrixRows = sortMatrixRows(matrixRows);
    lastDesignVersion += 1;
    emitDesignChanged();

    return { ok: true, splice: deepClone(splice) };
  }

  function addCable(nodeId, direction, cableSpec) {
    var id = normalizeNodeId(nodeId);
    if (!id || !nodeStore[id]) return { ok: false, error: 'node_not_found' };
    var node = nodeStore[id];
    var bucket = getCableBucket(node, direction);
    if (!bucket) return { ok: false, error: 'invalid_direction' };

    cableSpec = cableSpec || {};
    var cable = createCable(direction, cableSpec);
    bucket.push(cable);
    touchMetadata(node);
    return { ok: true, cable: deepClone(cable) };
  }

  function ensureDisplayData() {
    if (lastDesignVersion === 0) {
      AutoFiberEngine.regenerate();
    }
  }

  function getClosureRegistry() {
    if (lastDesignVersion === 0) AutoFiberEngine.regenerate();
    return AutoFiberEngine.getClosuresForCabinet('all');
  }

  function getCabinetRegistry() {
    if (lastDesignVersion === 0) AutoFiberEngine.regenerate();
    return AutoFiberEngine.getCabinetRegistry();
  }

  function getSpliceMatrixRows(closureFilterOrOptions) {
    if (DEBUG) {
    console.log('[FiberDesignManager] getSpliceMatrixRows START');
    }
    try {
      if (lastDesignVersion === 0) {
        if (DEBUG) {
        console.log('[FiberDesignManager] getSpliceMatrixRows: regenerating (version 0)');
        }
        AutoFiberEngine.regenerate();
      }
      if (closureFilterOrOptions && typeof closureFilterOrOptions === 'object') {
        if (DEBUG) {
        console.log('[FiberDesignManager] getSpliceMatrixRows: calling getMatrixRows with object filter');
        }
        return AutoFiberEngine.getMatrixRows(closureFilterOrOptions);
      }
      if (DEBUG) {
      console.log('[FiberDesignManager] getSpliceMatrixRows: calling getMatrixRows with string filter');
      }
      var result = AutoFiberEngine.getMatrixRows({
        cabinet: 'all',
        closure: closureFilterOrOptions != null ? String(closureFilterOrOptions) : 'all',
      });
      if (DEBUG) {
      console.log('[FiberDesignManager] getSpliceMatrixRows SUCCESS: rows=' + (result ? result.length : 0));
      }
      return result;
    } catch (e) {
      console.error('[FiberDesignManager] getSpliceMatrixRows EXCEPTION:', e.message);
      console.error('[FiberDesignManager] getSpliceMatrixRows STACK:', e.stack);
      throw e;
    }
  }

  function getFiberByRef(nodeId, ref) {
    var id = normalizeNodeId(nodeId);
    if (!id || !nodeStore[id]) return null;
    var resolved = resolveFiberRef(nodeStore[id], ref);
    if (!resolved) return null;
    return {
      ref: normalizeFiberRef(ref),
      fiber: deepClone(resolved.fiber),
      tube: {
        id: resolved.tube.id,
        tube_number: resolved.tube.tube_number,
        tube_color: resolved.tube.tube_color,
      },
      cable: {
        id: resolved.cable.id,
        name: resolved.cable.name,
        direction: resolved.cable.direction,
        role: resolved.cable.role,
      },
    };
  }

  function getSplices(nodeId) {
    var id = normalizeNodeId(nodeId);
    if (!id || !nodeStore[id]) return [];
    return deepClone(nodeStore[id].splices || []);
  }

  function exportAll() {
    var out = {};
    Object.keys(nodeStore).forEach(function (key) {
      out[key] = deepClone(nodeStore[key]);
    });
    return out;
  }

  function importAll(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return false;
    nodeStore = Object.create(null);
    Object.keys(snapshot).forEach(function (key) {
      var entry = snapshot[key];
      if (!entry || typeof entry !== 'object') return;
      var nodeId = normalizeNodeId(entry.node_id || key);
      if (!nodeId) return;
      nodeStore[nodeId] = {
        node_id: nodeId,
        node_type: entry.node_type || 'unknown',
        location: entry.location || null,
        metadata: cloneMetadata(entry.metadata || createDefaultMetadata(null, { is_mock: false, source: 'auto_engine' })),
        cables: {
          inbound: Array.isArray(entry.cables && entry.cables.inbound) ? entry.cables.inbound : [],
          outbound: Array.isArray(entry.cables && entry.cables.outbound) ? entry.cables.outbound : [],
        },
        splices: Array.isArray(entry.splices) ? entry.splices : [],
      };
      collectNodeCables(nodeStore[nodeId]).forEach(function (c) {
        enforceFibersPerTube(c.tubes);
      });
    });
    matrixRows = [];
    Object.keys(nodeStore).forEach(function (nodeId) {
      var node = nodeStore[nodeId];
      (node.splices || []).forEach(function (splice) {
        var row = buildMatrixRow(node, splice);
        if (row) matrixRows.push(row);
      });
    });
    matrixRows = sortMatrixRows(matrixRows);
    lastDesignVersion += 1;
    emitDesignChanged();
    return true;
  }

  function removeNodeData(nodeId) {
    var id = normalizeNodeId(nodeId);
    if (!id || !nodeStore[id]) return false;
    delete nodeStore[id];
    matrixRows = matrixRows.filter(function (r) { return String(r.node_id) !== id; });
    return true;
  }

  function ensureNodeDesign(nodeId, mapNode) {
    var id = normalizeNodeId(nodeId);
    if (!id) return null;
    ensureDisplayData();
    if (hasNodeData(id)) return getNodeData(id);
    if (mapNode) {
      ensureEngineNode(mapNode);
      return getNodeData(id);
    }
    return null;
  }

  function initNodeFromMapCables(mapNode) {
    ensureDisplayData();
    if (!mapNode) return null;
    return ensureNodeDesign(mapNode.id, mapNode);
  }

  function generateMockNodeDesign() {
    return AutoFiberEngine.regenerate();
  }

  /** @deprecated Stage 4 — linear auto-splice removed; use AutoFiberEngine.regenerate */
  function autoSpliceSequential() {
    return { ok: false, error: 'deprecated_use_auto_fiber_engine', created: 0, skipped: 0, splices: [] };
  }

  function clearAll() {
    nodeStore = Object.create(null);
    matrixRows = [];
    lastDesignVersion = 0;
  }

  global.FTTHFiberDesignManager = {
    init: init,
    initNodeData: initNodeData,
    getNodeData: getNodeData,
    hasNodeData: hasNodeData,
    addSpliceConnection: addSpliceConnection,
    addCable: addCable,
    getFiberByRef: getFiberByRef,
    getSplices: getSplices,
    ensureNodeDesign: ensureNodeDesign,
    initNodeFromMapCables: initNodeFromMapCables,
    autoSpliceSequential: autoSpliceSequential,
    getClosureRegistry: getClosureRegistry,
    getCabinetRegistry: getCabinetRegistry,
    getSpliceMatrixRows: getSpliceMatrixRows,
    ensureDisplayData: ensureDisplayData,
    projectHasRealFiberDesignData: projectHasRealFiberDesignData,
    generateMockNodeDesign: generateMockNodeDesign,
    buildLastMileTubes: buildLastMileTubes,
    parseCapacityFromLabel: parseCapacityFromLabel,
    exportAll: exportAll,
    importAll: importAll,
    removeNodeData: removeNodeData,
    clearAll: clearAll,
    createUuid: createUuid,
    createFiber: createFiber,
    createTube: createTube,
    createCable: createCable,
    notifyTopologyChanged: notifyTopologyChanged,
    AutoFiberEngine: AutoFiberEngine,
    FIBERS_PER_TUBE: FIBERS_PER_TUBE,
    FATS_PER_TUBE: FATS_PER_TUBE,
    FIBERS_PER_FAT: FIBERS_PER_FAT,
    FIBER_STATUSES: FIBER_STATUSES.slice(),
    SPLICE_TYPES: SPLICE_TYPES.slice(),
    MATRIX_FIBER_TYPES: MATRIX_FIBER_TYPES.slice(),
    LAST_MILE_TUBE_COUNT: deepClone(LAST_MILE_TUBE_COUNT),
    STANDARD_TUBE_COLORS: STANDARD_TUBE_COLORS.slice(),
    STANDARD_FIBER_COLORS: STANDARD_FIBER_COLORS.slice(),
    STANDARD_COLOR_CODE: STANDARD_COLOR_CODE.slice(),
    TUBE_FAT_FIBER_PAIRS: TUBE_FAT_FIBER_PAIRS.map(function (p) {
      return { main: p.main, expansion: p.expansion };
    }),
  };
})(typeof window !== 'undefined' ? window : globalThis);
