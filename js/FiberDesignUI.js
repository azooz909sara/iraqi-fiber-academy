/**
 * FTTH Fiber Design UI — Stage 4.
 * Sidebar tabs + Floating Matrix Viewer (read-only).
 * Renders AutoFiberEngine output only. No splice mutation.
 */
(function (global) {
  'use strict';

  var DEBUG = !!(global && global.FTTH_DEBUG);

  var deps = null;
  /** @type {Object<string, string>} active cable tab id per node */
  var activeCableTabByNode = Object.create(null);
  var stylesInjected = false;

  /* Floating matrix state */
  var matrixEl = null;
  var matrixOpen = false;
  var matrixEventsBound = false;
  var activeCabinetFilter = 'all';
  var activeClosureFilter = 'all';
  var activeSortMode = 'cindex'; // insertion, chronological, cindex
  var dragState = null;
  var resizeState = null;
  var MIN_WIN_W = 360;
  var MIN_WIN_H = 220;

  var MATRIX_COLUMNS = [
    { key: 'm_cable_id', label: 'M-Cable ID' },
    { key: 'm_tube_color', label: 'Cable tube color', colorCell: true },
    { key: 'm_fiber_color', label: 'Cable (Fiber color)', colorCell: true },
    { key: 'closure_id', label: 'HH-Closure_ID' },
    { key: 's_cable_id', label: 'S-Cable ID' },
    { key: 's_tube_color', label: 'S-Cable Tube color', colorCell: true },
    { key: 's_fiber_color', label: 'FAT Cable (Fiber color)', colorCell: true },
    { key: 'fiber_type', label: 'Fiber Type' },
    { key: 'fat_id', label: 'FAT ID' },
  ];

  var ROWSPAN_GROUP_KEYS = [
    'm_cable_id',
    'm_tube_color',
    'closure_id',
    's_cable_id',
    's_tube_color',
    'fat_id',
  ];

  var FIBER_COLOR_CSS = {
    blue: '#2563eb',
    orange: '#ea580c',
    green: '#16a34a',
    brown: '#92400e',
    slate: '#64748b',
    white: '#f8fafc',
    red: '#dc2626',
    black: '#1e293b',
    yellow: '#eab308',
    violet: '#7c3aed',
    rose: '#e11d48',
    aqua: '#06b6d4',
  };

  function init(api) {
    deps = Object.assign({}, deps || {}, api || {});
    ensureStyles();
  }

  function getManager() {
    return deps.getFiberDesignManager
      ? deps.getFiberDesignManager()
      : (global.FTTHFiberDesignManager || null);
  }

  function getOverlayHost() {
    if (deps && typeof deps.getOverlayHost === 'function') {
      var host = deps.getOverlayHost();
      if (host) return host;
    }
    return document.getElementById('sim-workspace-overlays') ||
      document.getElementById('canvas-main') ||
      document.getElementById('simulator-container');
  }

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(text) {
    return escapeHtml(text).replace(/'/g, '&#39;');
  }

  function parseCableLabelSortKey(label) {
    var raw = String(label || '').trim();
    var m = raw.match(/^(\d+)F(\d+)?/i);
    if (!m) {
      return { capacity: 0, batch: 9999, label: raw.toLowerCase() };
    }
    return {
      capacity: parseInt(m[1], 10) || 0,
      batch: parseInt(m[2] || '1', 10) || 1,
      label: raw.toLowerCase(),
    };
  }

  function cableTabLabel(cable) {
    if (!cable) return '—';
    if (cable.name && String(cable.name).trim()) return String(cable.name).trim();
    return 'Cable';
  }

  function sortCablesForTabs(cables) {
    /* Preserve physical connection / insertion order — no ascending label sort. */
    return (cables || []).slice();
  }

  function collectNodeCables(nodeData) {
    if (!nodeData || !nodeData.cables) return [];
    var inbound = Array.isArray(nodeData.cables.inbound) ? nodeData.cables.inbound : [];
    var outbound = Array.isArray(nodeData.cables.outbound) ? nodeData.cables.outbound : [];
    return inbound.concat(outbound);
  }

  function hasFiberDesignContent(nodeData) {
    if (!nodeData) return false;
    var cables = collectNodeCables(nodeData);
    return cables.length > 0;
  }

  function getActiveCableId(nodeId, cables) {
    var id = nodeId != null ? String(nodeId) : '';
    var activeId = id ? activeCableTabByNode[id] : null;
    if (activeId && cables.some(function (c) { return c && String(c.id) === String(activeId); })) {
      return String(activeId);
    }
    return cables.length ? String(cables[0].id) : null;
  }

  function renderFiberRow(fiber) {
    if (!fiber) return '';
    var status = fiber.status || 'available';
    return '<li class="fiber-design-fiber">' +
      '<span class="fiber-design-fiber__num">' + escapeHtml(fiber.fiber_number) + '</span>' +
      '<span class="fiber-design-fiber__color">' + escapeHtml(fiber.fiber_color || '—') + '</span>' +
      '<span class="fiber-design-fiber__status fiber-design-fiber__status--' +
      escapeAttr(status) + '">' + escapeHtml(status) + '</span>' +
      '</li>';
  }

  function renderTubeBlock(tube) {
    if (!tube) return '';
    var fibers = Array.isArray(tube.fibers) ? tube.fibers : [];
    var fiberHtml = fibers.length
      ? fibers.map(renderFiberRow).join('')
      : '<li class="fiber-design-fiber fiber-design-fiber--empty">No fibers</li>';
    return '<li class="fiber-design-tube">' +
      '<div class="fiber-design-tube__head">' +
      '<span class="fiber-design-tube__num">Tube ' + escapeHtml(tube.tube_number) + '</span>' +
      '<span class="fiber-design-tube__color">' + escapeHtml(tube.tube_color || '—') + '</span>' +
      '</div>' +
      '<ul class="fiber-design-fibers">' + fiberHtml + '</ul>' +
      '</li>';
  }

  function renderCableDetail(cable) {
    if (!cable) {
      return '<p class="fiber-design-panel__empty">No Fiber Design Available</p>';
    }
    var tubes = Array.isArray(cable.tubes) ? cable.tubes : [];
    if (!tubes.length) {
      return '<p class="fiber-design-panel__hint">No tubes defined for this cable.</p>';
    }
    var tubeHtml = tubes.map(renderTubeBlock).join('');
    var dir = cable.direction === 'outbound' ? 'Outbound' : 'Inbound';
    return '<div class="fiber-design-cable-detail">' +
      '<p class="fiber-design-cable-detail__meta">' +
      '<span class="fiber-design-cable-detail__dir">' + escapeHtml(dir) + '</span>' +
      (cable.name ? '<span class="fiber-design-cable-detail__name">' + escapeHtml(cable.name) + '</span>' : '') +
      '</p>' +
      '<ul class="fiber-design-tubes">' + tubeHtml + '</ul>' +
      '</div>';
  }

  function renderTabs(nodeId, cables, activeCableId) {
    if (!cables.length) return '';
    var tabsHtml = cables.map(function (cable) {
      var label = cableTabLabel(cable);
      var isActive = String(cable.id) === String(activeCableId);
      return '<button type="button" class="fiber-design-tab' + (isActive ? ' fiber-design-tab--active' : '') +
        '" role="tab" aria-selected="' + (isActive ? 'true' : 'false') + '" data-fiber-design-tab="1" ' +
        'data-node-id="' + escapeAttr(nodeId) + '" data-cable-id="' + escapeAttr(cable.id) + '">' +
        escapeHtml(label) + '</button>';
    }).join('');
    return '<div class="fiber-design-tabs" role="tablist">' + tabsHtml + '</div>';
  }

  function renderPanelBody(nodeId, nodeData) {
    if (!hasFiberDesignContent(nodeData)) {
      return '<div class="fiber-design-panel fiber-design-panel--empty">' +
        '<p class="fiber-design-panel__empty">No Fiber Design Available</p>' +
        '</div>';
    }

    var cables = sortCablesForTabs(collectNodeCables(nodeData));
    var activeCableId = getActiveCableId(nodeId, cables);
    var activeCable = null;
    var i;
    for (i = 0; i < cables.length; i++) {
      if (String(cables[i].id) === String(activeCableId)) {
        activeCable = cables[i];
        break;
      }
    }

    return '<div class="fiber-design-panel" data-fiber-design-node="' + escapeAttr(nodeId) + '">' +
      renderTabs(nodeId, cables, activeCableId) +
      '<div class="fiber-design-tab-content" role="tabpanel">' +
      renderCableDetail(activeCable) +
      '</div>' +
      '</div>';
  }

  function renderSection(nodeId) {
    var id = nodeId != null ? String(nodeId) : '';
    if (!id) {
      return '<section class="sidebar-section sidebar-section--fiber-design">' +
        '<h3 class="sidebar-section__title">Fiber Design</h3>' +
        '<div class="fiber-design-panel fiber-design-panel--empty">' +
        '<p class="fiber-design-panel__empty">No Fiber Design Available</p>' +
        '</div></section>';
    }

    var mgr = getManager();
    if (mgr && mgr.ensureDisplayData) mgr.ensureDisplayData();
    var nodeData = mgr && mgr.getNodeData ? mgr.getNodeData(id) : null;

    return '<section class="sidebar-section sidebar-section--fiber-design" id="fiber-design-sidebar-section">' +
      '<h3 class="sidebar-section__title">Fiber Design</h3>' +
      renderPanelBody(id, nodeData) +
      '</section>';
  }

  function refreshPanelContent(container, nodeId) {
    if (!container) return;
    var section = container.querySelector('#fiber-design-sidebar-section') ||
      container.querySelector('.sidebar-section--fiber-design');
    if (!section) return;
    var mgr = getManager();
    var nodeData = mgr && mgr.getNodeData ? mgr.getNodeData(nodeId) : null;
    var inner = section.querySelector('.fiber-design-panel') ||
      section.querySelector('.fiber-design-panel--empty');
    if (!inner) {
      var title = section.querySelector('.sidebar-section__title');
      var wrap = document.createElement('div');
      wrap.innerHTML = renderPanelBody(nodeId, nodeData);
      var newPanel = wrap.firstElementChild;
      if (title && title.nextSibling) {
        section.replaceChild(newPanel, title.nextSibling);
      } else {
        section.appendChild(newPanel);
      }
      return;
    }
    var wrap2 = document.createElement('div');
    wrap2.innerHTML = renderPanelBody(nodeId, nodeData);
    var newBody = wrap2.firstElementChild;
    if (newBody) inner.replaceWith(newBody);
  }

  function onTabClick(btn) {
    if (!btn) return;
    var nodeId = btn.getAttribute('data-node-id');
    var cableId = btn.getAttribute('data-cable-id');
    if (!nodeId || !cableId) return;
    activeCableTabByNode[String(nodeId)] = String(cableId);

    var panel = btn.closest('.fiber-design-panel');
    if (!panel) return;
    var tabs = panel.querySelectorAll('[data-fiber-design-tab]');
    var i;
    for (i = 0; i < tabs.length; i++) {
      var active = tabs[i] === btn;
      tabs[i].classList.toggle('fiber-design-tab--active', active);
      tabs[i].setAttribute('aria-selected', active ? 'true' : 'false');
    }

    var mgr = getManager();
    var nodeData = mgr && mgr.getNodeData ? mgr.getNodeData(nodeId) : null;
    if (!nodeData) return;
    var cables = sortCablesForTabs(collectNodeCables(nodeData));
    var activeCable = null;
    for (i = 0; i < cables.length; i++) {
      if (String(cables[i].id) === String(cableId)) {
        activeCable = cables[i];
        break;
      }
    }
    var content = panel.querySelector('.fiber-design-tab-content');
    if (content) content.innerHTML = renderCableDetail(activeCable);
  }

  function bind(container, nodeId) {
    if (!container) return;
    container.querySelectorAll('[data-fiber-design-tab]').forEach(function (btn) {
      if (btn._fiberDesignBound) return;
      btn._fiberDesignBound = true;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        onTabClick(btn);
      });
    });
    if (nodeId != null && !activeCableTabByNode[String(nodeId)]) {
      var mgr = getManager();
      var nodeData = mgr && mgr.getNodeData ? mgr.getNodeData(nodeId) : null;
      if (hasFiberDesignContent(nodeData)) {
        var cables = sortCablesForTabs(collectNodeCables(nodeData));
        if (cables.length) activeCableTabByNode[String(nodeId)] = String(cables[0].id);
      }
    }
  }

  function clearActiveTab(nodeId) {
    if (nodeId == null) return;
    delete activeCableTabByNode[String(nodeId)];
  }

  /* ═══════════════ Floating Matrix Viewer ═══════════════ */

  function fiberColorStyle(colorName) {
    var key = String(colorName || '').trim().toLowerCase();
    var bg = FIBER_COLOR_CSS[key] || '#334155';
    var fg = (key === 'white' || key === 'yellow') ? '#0f172a' : '#f8fafc';
    return 'background-color:' + bg + ';color:' + fg + ';';
  }

  function groupKeyForRow(row, fields) {
    var parts = [];
    var i;
    for (i = 0; i < fields.length; i++) {
      parts.push(String(row[fields[i]] != null ? row[fields[i]] : ''));
    }
    return parts.join('\u0001');
  }

  function applyRowspanMetadata(rows) {
    if (!rows || !rows.length) return rows;
    var r;
    var col;
    for (col = 0; col < ROWSPAN_GROUP_KEYS.length; col++) {
      var field = ROWSPAN_GROUP_KEYS[col];
      // CRITICAL FIX: closure_id and s_cable_id must merge independently of parent fields
      var parentFields = (field === 'closure_id' || field === 's_cable_id') ? [field] : ROWSPAN_GROUP_KEYS.slice(0, col + 1);
      var i = 0;
      while (i < rows.length) {
        var baseKey = groupKeyForRow(rows[i], parentFields);
        var span = 1;
        while (i + span < rows.length &&
          groupKeyForRow(rows[i + span], parentFields) === baseKey) {
          span++;
        }
        rows[i]['_rs_' + field] = span;
        for (r = 1; r < span; r++) {
          rows[i + r]['_skip_' + field] = true;
        }
        i += span;
      }
    }
    return rows;
  }

  function renderCabinetFilterOptions() {
    var mgr = getManager();
    var cabinets = [];
    if (mgr && mgr.AutoFiberEngine && mgr.AutoFiberEngine.getCabinetRegistry) {
      cabinets = mgr.AutoFiberEngine.getCabinetRegistry() || [];
    } else if (mgr && mgr.getCabinetRegistry) {
      cabinets = mgr.getCabinetRegistry() || [];
    }
    var html = '<option value="all">All Cabinets</option>';
    cabinets.forEach(function (c) {
      var id = String(c.cabinet_id || c.node_id);
      html += '<option value="' + escapeAttr(id) + '"' +
        (activeCabinetFilter === id ? ' selected' : '') + '>' +
        escapeHtml(c.cabinet_label || id) + '</option>';
    });
    return html;
  }

  function renderClosureFilterOptions() {
    var mgr = getManager();
    var closures = [];
    if (mgr && mgr.AutoFiberEngine && mgr.AutoFiberEngine.getClosuresForCabinet) {
      closures = mgr.AutoFiberEngine.getClosuresForCabinet(activeCabinetFilter) || [];
    } else if (mgr && mgr.getClosureRegistry) {
      closures = mgr.getClosureRegistry() || [];
      if (activeCabinetFilter !== 'all') {
        closures = closures.filter(function (c) {
          return String(c.cabinet_id) === activeCabinetFilter;
        });
      }
    }
    if (activeClosureFilter !== 'all') {
      var stillValid = closures.some(function (c) {
        return String(c.node_id) === activeClosureFilter;
      });
      if (!stillValid) activeClosureFilter = 'all';
    }
    var html = '<option value="all">All Closures</option>';
    closures.forEach(function (c) {
      var id = String(c.node_id);
      html += '<option value="' + escapeAttr(id) + '"' +
        (activeClosureFilter === id ? ' selected' : '') + '>' +
        escapeHtml(c.closure_id) + '</option>';
    });
    return html;
  }

  function renderMatrixTable(rows) {
    // Always render table headers, even with no data
    var head = MATRIX_COLUMNS.map(function (col) {
      return '<th scope="col">' + escapeHtml(col.label) + '</th>';
    }).join('');

    var body = '';
    if (rows && rows.length) {
      var annotated = applyRowspanMetadata(rows.slice());
      body = annotated.map(function (row) {
        var cells = MATRIX_COLUMNS.map(function (col) {
          if (row['_skip_' + col.key]) return '';
          var val = row[col.key] != null ? String(row[col.key]) : '—';
          if (col.key === 'fat_id') {
            var num = val.match(/(\d+)/);
            val = num ? num[1] : val;
          }
          var rs = row['_rs_' + col.key] || 1;
          var cls = 'fd-matrix-cell';
          var style = '';
          if (col.colorCell) {
            cls += ' fd-matrix-cell--color';
            style = fiberColorStyle(val);
          }
          if (col.key === 'fiber_type') {
            cls += ' fd-matrix-cell--type-' + escapeAttr(val.toLowerCase());
          }
          return '<td class="' + cls + '" rowspan="' + rs + '"' +
            (style ? ' style="' + style + '"' : '') + '>' +
            escapeHtml(val) + '</td>';
        }).join('');
        return '<tr>' + cells + '</tr>';
      }).join('');
    }

    return '<div class="fd-matrix-scroll">' +
      '<table class="fd-matrix-table" cellspacing="0" cellpadding="0">' +
      '<thead><tr>' + head + '</tr></thead>' +
      '<tbody>' + body + '</tbody>' +
      '</table></div>';
  }

  function renderSortOptions() {
    var options = [
      { value: 'insertion', label: 'Insertion Order (Default)' },
      { value: 'chronological', label: 'Chronological/Path Order' },
      { value: 'cindex', label: 'Ascending C-Index (C1, C2, C3...)' }
    ];
    var html = '';
    options.forEach(function (opt) {
      html += '<option value="' + opt.value + '"' +
        (activeSortMode === opt.value ? ' selected' : '') + '>' +
        opt.label + '</option>';
    });
    return html;
  }

  function sortRowsByMode(rows) {
    if (!rows || !rows.length) return rows;
    var sorted = rows.slice();
    
    if (activeSortMode === 'insertion') {
      // Sort by closure_order (insertion order)
      sorted.sort(function (a, b) {
        if (a.closure_order !== b.closure_order) {
          return (a.closure_order || 0) - (b.closure_order || 0);
        }
        // Secondary sort by cabinet, then cable
        if (a.cabinet_label !== b.cabinet_label) {
          return String(a.cabinet_label || '').localeCompare(String(b.cabinet_label || ''), undefined, { numeric: true });
        }
        if (a.m_cable_id !== b.m_cable_id) {
          return String(a.m_cable_id).localeCompare(String(b.m_cable_id), undefined, { numeric: true });
        }
        return 0;
      });
    } else if (activeSortMode === 'chronological') {
      // Sort by closure_id (chronological/path order)
      sorted.sort(function (a, b) {
        if (a.cabinet_label !== b.cabinet_label) {
          return String(a.cabinet_label || '').localeCompare(String(b.cabinet_label || ''), undefined, { numeric: true });
        }
        if (a.m_cable_id !== b.m_cable_id) {
          return String(a.m_cable_id).localeCompare(String(b.m_cable_id), undefined, { numeric: true });
        }
        if (a.closure_id !== b.closure_id) {
          return String(a.closure_id).localeCompare(String(b.closure_id), undefined, { numeric: true });
        }
        return 0;
      });
    } else if (activeSortMode === 'cindex') {
      // Sort by C-index (extract numeric suffix from closure_id)
      sorted.sort(function (a, b) {
        function extractCIndex(closureId) {
          var m = String(closureId || '').match(/C(\d+)/i);
          return m ? parseInt(m[1], 10) : 0;
        }
        var aIndex = extractCIndex(a.closure_id);
        var bIndex = extractCIndex(b.closure_id);
        if (aIndex !== bIndex) return aIndex - bIndex;
        // Secondary sort by cabinet, then cable
        if (a.cabinet_label !== b.cabinet_label) {
          return String(a.cabinet_label || '').localeCompare(String(b.cabinet_label || ''), undefined, { numeric: true });
        }
        if (a.m_cable_id !== b.m_cable_id) {
          return String(a.m_cable_id).localeCompare(String(b.m_cable_id), undefined, { numeric: true });
        }
        return 0;
      });
    }
    return sorted;
  }

  function renderMatrixBody() {
    if (DEBUG) {
    console.log('[FiberDesignUI] renderMatrixBody START');
    }
    try {
      var mgr = getManager();
      if (DEBUG) {
      console.log('[FiberDesignUI] renderMatrixBody: manager=' + (mgr ? 'found' : 'null'));
      }
      if (DEBUG) {
      console.log('[FiberDesignUI] renderMatrixBody: activeCabinetFilter=' + activeCabinetFilter + ', activeClosureFilter=' + activeClosureFilter + ', activeSortMode=' + activeSortMode);
      }

      var rows = mgr && mgr.getSpliceMatrixRows
        ? mgr.getSpliceMatrixRows({
          cabinet: activeCabinetFilter,
          closure: activeClosureFilter,
        })
        : [];

      // Apply sorting based on selected mode
      rows = sortRowsByMode(rows);

      if (DEBUG) {
      console.log('[FiberDesignUI] renderMatrixBody: rows=' + (rows ? rows.length : 0));
      }
      var engineBadge = '<span class="fd-float__badge">AutoFiberEngine · DFS</span>';

      if (DEBUG) {
      console.log('[FiberDesignUI] renderMatrixBody: calling renderMatrixTable');
      }
      var tableHtml = renderMatrixTable(rows);
      if (DEBUG) {
      console.log('[FiberDesignUI] renderMatrixBody SUCCESS');
      }

      return '<div class="fd-float__toolbar">' +
        '<label class="fd-float__filter-label" for="fd-matrix-cabinet-filter">Cabinet Filter</label>' +
        '<select id="fd-matrix-cabinet-filter" class="fd-float__filter-select">' +
        renderCabinetFilterOptions() +
        '</select>' +
        '<label class="fd-float__filter-label" for="fd-matrix-closure-filter">Closure Filter</label>' +
        '<select id="fd-matrix-closure-filter" class="fd-float__filter-select">' +
        renderClosureFilterOptions() +
        '</select>' +
        '<label class="fd-float__filter-label" for="fd-matrix-sort-mode" style="margin-left: 20px;">Sort By</label>' +
        '<select id="fd-matrix-sort-mode" class="fd-float__filter-select">' +
        renderSortOptions() +
        '</select>' +
        '<div style="display: inline-flex; align-items: center; gap: 8px; margin-left: 20px;">' +
        '<button id="btn-zoom-out" style="padding: 2px 10px; background: #2a2d3d; color: white; border: 1px solid #444; border-radius: 4px; cursor: pointer; font-weight: bold;">-</button>' +
        '<span id="zoom-text-display" style="color: #a0aabf; font-size: 13px;">100%</span>' +
        '<button id="btn-zoom-in" style="padding: 2px 10px; background: #2a2d3d; color: white; border: 1px solid #444; border-radius: 4px; cursor: pointer; font-weight: bold;">+</button>' +
        '</div>' +
        engineBadge +
        '<span class="fd-float__row-count">' + rows.length + ' splice row(s)</span>' +
        '</div>' +
        tableHtml;
    } catch (e) {
      console.error('[FiberDesignUI] renderMatrixBody EXCEPTION:', e.message);
      console.error('[FiberDesignUI] renderMatrixBody STACK:', e.stack);
      return '<div class="fd-matrix-error">Error rendering matrix: ' + e.message + '</div>';
    }
  }

  function bindMatrixFilter(scope) {
    var root = scope || matrixEl;
    if (!root) return;

    var cabSel = root.querySelector('#fd-matrix-cabinet-filter');
    if (cabSel && !cabSel._fdBound) {
      cabSel._fdBound = true;
      cabSel.addEventListener('change', function () {
        activeCabinetFilter = cabSel.value || 'all';
        activeClosureFilter = 'all';
        refreshMatrix();
      });
    }

    var cloSel = root.querySelector('#fd-matrix-closure-filter');
    if (cloSel && !cloSel._fdBound) {
      cloSel._fdBound = true;
      cloSel.addEventListener('change', function () {
        activeClosureFilter = cloSel.value || 'all';
        refreshMatrix();
      });
    }

    var sortSel = root.querySelector('#fd-matrix-sort-mode');
    if (sortSel && !sortSel._fdBound) {
      sortSel._fdBound = true;
      sortSel.addEventListener('change', function () {
        activeSortMode = sortSel.value || 'insertion';
        refreshMatrix();
      });
    }
  }

  function refreshMatrix(payload) {
    if (!matrixEl || !matrixOpen) return;
    var body = matrixEl.querySelector('.fd-float__body');
    if (!body) return;
    body.innerHTML = renderMatrixBody();
    bindMatrixFilter(body);
    if (payload && payload.reason === 'path-merged' && payload.merge) {
      matrixEl.setAttribute('data-last-merge-cable', String(payload.merge.cableId || ''));
    }
  }

  function onPathMerged(payload) {
    refreshMatrix(payload || { reason: 'path-merged' });
  }

  function getMatrixWindow() {
    return matrixEl ? matrixEl.querySelector('.fd-float__window') : null;
  }

  function hostOffsetRect() {
    var host = getOverlayHost();
    return host ? host.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }

  function onDragPointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    if (resizeState) return;
    var win = getMatrixWindow();
    if (!win) return;
    var rect = win.getBoundingClientRect();
    var hostRect = hostOffsetRect();
    dragState = {
      startX: e.clientX,
      startY: e.clientY,
      origLeft: rect.left - hostRect.left,
      origTop: rect.top - hostRect.top,
      width: rect.width,
      height: rect.height,
    };
    win.classList.add('is-dragging');
    e.preventDefault();
  }

  function onDragPointerMove(e) {
    if (!dragState || resizeState) return;
    var win = getMatrixWindow();
    if (!win) return;
    var dx = e.clientX - dragState.startX;
    var dy = e.clientY - dragState.startY;
    var left = Math.max(0, dragState.origLeft + dx);
    var top = Math.max(0, dragState.origTop + dy);
    win.style.left = left + 'px';
    win.style.top = top + 'px';
    win.style.right = 'auto';
    win.style.bottom = 'auto';
    win.style.width = dragState.width + 'px';
    win.style.height = dragState.height + 'px';
  }

  function onDragPointerUp() {
    if (!dragState) return;
    var win = getMatrixWindow();
    if (win) win.classList.remove('is-dragging');
    dragState = null;
  }

  function onResizePointerDown(e, edges) {
    if (e.button != null && e.button !== 0) return;
    var win = getMatrixWindow();
    if (!win) return;
    var rect = win.getBoundingClientRect();
    var hostRect = hostOffsetRect();
    resizeState = {
      edges: edges,
      startX: e.clientX,
      startY: e.clientY,
      left: rect.left - hostRect.left,
      top: rect.top - hostRect.top,
      width: rect.width,
      height: rect.height,
    };
    win.classList.add('is-resizing');
    e.preventDefault();
    e.stopPropagation();
  }

  function onResizePointerMove(e) {
    if (!resizeState) return;
    var win = getMatrixWindow();
    if (!win) return;
    var hostRect = hostOffsetRect();
    var dx = e.clientX - resizeState.startX;
    var dy = e.clientY - resizeState.startY;
    var left = resizeState.left;
    var top = resizeState.top;
    var width = resizeState.width;
    var height = resizeState.height;
    var edges = resizeState.edges;

    if (edges.indexOf('e') >= 0) {
      width = Math.max(MIN_WIN_W, resizeState.width + dx);
    }
    if (edges.indexOf('s') >= 0) {
      height = Math.max(MIN_WIN_H, resizeState.height + dy);
    }
    if (edges.indexOf('w') >= 0) {
      width = Math.max(MIN_WIN_W, resizeState.width - dx);
      left = resizeState.left + (resizeState.width - width);
    }
    if (edges.indexOf('n') >= 0) {
      height = Math.max(MIN_WIN_H, resizeState.height - dy);
      top = resizeState.top + (resizeState.height - height);
    }

    left = Math.max(0, Math.min(left, hostRect.width - MIN_WIN_W));
    top = Math.max(0, Math.min(top, hostRect.height - MIN_WIN_H));
    width = Math.min(width, hostRect.width - left);
    height = Math.min(height, hostRect.height - top);

    win.style.left = left + 'px';
    win.style.top = top + 'px';
    win.style.width = width + 'px';
    win.style.height = height + 'px';
    win.style.right = 'auto';
    win.style.bottom = 'auto';
  }

  function onResizePointerUp() {
    if (!resizeState) return;
    var win = getMatrixWindow();
    if (win) win.classList.remove('is-resizing');
    resizeState = null;
  }

  function onWindowPointerMove(e) {
    if (resizeState) onResizePointerMove(e);
    else if (dragState) onDragPointerMove(e);
  }

  function onWindowPointerUp() {
    onResizePointerUp();
    onDragPointerUp();
  }

  function cleanupLegacyModalNodes() {
    var legacyBackdrop = document.getElementById('fd-matrix-modal-backdrop');
    if (legacyBackdrop && legacyBackdrop.parentNode) {
      legacyBackdrop.parentNode.removeChild(legacyBackdrop);
    }
    var legacyModal = document.getElementById('fd-matrix-modal');
    if (legacyModal && legacyModal.parentNode) {
      legacyModal.parentNode.removeChild(legacyModal);
    }
  }

  function bindResizeHandles(win) {
    if (!win || win._fdResizeBound) return;
    win._fdResizeBound = true;
    var handles = [
      { cls: 'fd-float__resize fd-float__resize--n', edges: 'n' },
      { cls: 'fd-float__resize fd-float__resize--s', edges: 's' },
      { cls: 'fd-float__resize fd-float__resize--e', edges: 'e' },
      { cls: 'fd-float__resize fd-float__resize--w', edges: 'w' },
      { cls: 'fd-float__resize fd-float__resize--ne', edges: 'ne' },
      { cls: 'fd-float__resize fd-float__resize--nw', edges: 'nw' },
      { cls: 'fd-float__resize fd-float__resize--se', edges: 'se' },
      { cls: 'fd-float__resize fd-float__resize--sw', edges: 'sw' },
    ];
    handles.forEach(function (h) {
      var el = document.createElement('div');
      el.className = h.cls;
      el.setAttribute('data-resize-edges', h.edges);
      el.addEventListener('pointerdown', function (e) {
        onResizePointerDown(e, h.edges);
      });
      win.appendChild(el);
    });
  }

  function bindMatrixWindowEvents() {
    if (!matrixEl || matrixEventsBound) return;
    matrixEventsBound = true;

    var win = getMatrixWindow();
    var header = matrixEl.querySelector('.fd-float__header');
    var closeBtn = matrixEl.querySelector('#fd-float-close');

    if (closeBtn) {
      closeBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeMatrix();
      });
    }

    if (header) {
      header.addEventListener('pointerdown', function (e) {
        if (e.target && e.target.closest && e.target.closest('button, select, input, a')) return;
        onDragPointerDown(e);
      });
    }

    if (win) bindResizeHandles(win);

    document.addEventListener('pointermove', onWindowPointerMove);
    document.addEventListener('pointerup', onWindowPointerUp);
    document.addEventListener('pointercancel', onWindowPointerUp);

    document.addEventListener('keydown', function (e) {
      if (!matrixOpen || e.key !== 'Escape') return;
      e.preventDefault();
      closeMatrix();
    }, true);

    // Bind zoom controls
    bindZoomControls();
  }

  // Zoom functionality
  var currentMatrixZoom = 1.0;
  var ZOOM_STEP = 0.1;
  var zoomDelegationBound = false;

  function bindZoomControls() {
    // Use event delegation for dynamically generated UI
    if (zoomDelegationBound) return;
    zoomDelegationBound = true;

    // Zoom button clicks - delegate to document
    document.addEventListener('click', function (e) {
      var target = e.target;
      var zoomInBtn = target.closest('#btn-zoom-in');
      var zoomOutBtn = target.closest('#btn-zoom-out');

      if (zoomInBtn) {
        e.preventDefault();
        e.stopPropagation();
        if (currentMatrixZoom < 2.0) {
          currentMatrixZoom += ZOOM_STEP;
          applyMatrixZoom();
        }
      } else if (zoomOutBtn) {
        e.preventDefault();
        e.stopPropagation();
        if (currentMatrixZoom > 0.4) {
          currentMatrixZoom -= ZOOM_STEP;
          applyMatrixZoom();
        }
      }
    });

    // Ctrl + Mouse Wheel zoom - delegate to document
    document.addEventListener('wheel', function (e) {
      if (e.ctrlKey) {
        // Check if target is inside matrix window
        var matrixWindow = e.target.closest('#fd-float-matrix');
        if (matrixWindow) {
          e.preventDefault();
          if (e.deltaY < 0) {
            if (currentMatrixZoom < 2.0) {
              currentMatrixZoom += ZOOM_STEP;
            }
          } else {
            if (currentMatrixZoom > 0.4) {
              currentMatrixZoom -= ZOOM_STEP;
            }
          }
          applyMatrixZoom();
        }
      }
    }, { passive: false });
  }

  function applyMatrixZoom() {
    var matrixScroll = document.querySelector('#fd-float-matrix .fd-matrix-scroll');
    if (matrixScroll) {
      matrixScroll.style.zoom = currentMatrixZoom;
    }
    var zoomTextDisplay = document.querySelector('#zoom-text-display');
    if (zoomTextDisplay) {
      zoomTextDisplay.innerText = Math.round(currentMatrixZoom * 100) + '%';
    }
  }

  function ensureMatrixWindow() {
    if (DEBUG) {
    console.log('[FiberDesignUI] ensureMatrixWindow START');
    }
    try {
      cleanupLegacyModalNodes();

      var host = getOverlayHost();
      if (DEBUG) {
      console.log('[FiberDesignUI] ensureMatrixWindow: host=' + (host ? 'found' : 'null'));
      }
      if (!host) {
        console.error('[FiberDesignUI] ensureMatrixWindow ERROR: host is null');
        return null;
      }

      if (matrixEl && matrixEl.isConnected && matrixEl.querySelector('.fd-float__body')) {
        if (DEBUG) {
        console.log('[FiberDesignUI] ensureMatrixWindow: reusing existing matrix element');
        }
        var existingWin = getMatrixWindow();
        if (existingWin && !existingWin._fdResizeBound) bindResizeHandles(existingWin);
        if (DEBUG) {
        console.log('[FiberDesignUI] ensureMatrixWindow SUCCESS (reused)');
        }
        return matrixEl;
      }

      matrixEl = document.getElementById('fd-float-matrix');
      if (DEBUG) {
      console.log('[FiberDesignUI] ensureMatrixWindow: existing matrixEl by id=' + (matrixEl ? 'found' : 'null'));
      }
      
      if (!matrixEl || !matrixEl.querySelector('.fd-float__body')) {
        if (DEBUG) {
        console.log('[FiberDesignUI] ensureMatrixWindow: creating/initializing matrixEl');
        }
        if (!matrixEl) {
          matrixEl = document.createElement('div');
          matrixEl.id = 'fd-float-matrix';
        }
        matrixEl.className = 'fd-float-host';
        matrixEl.setAttribute('hidden', 'true');
        matrixEl.setAttribute('aria-hidden', 'true');
        matrixEl.innerHTML =
          '<div class="fd-float__window" role="dialog" aria-modal="false" aria-labelledby="fd-float-title">' +
          '<header class="fd-float__header">' +
          '<div class="fd-float__header-text">' +
          '<h2 id="fd-float-title" class="fd-float__title">Fiber Design Matrix</h2>' +
          '<p class="fd-float__subtitle">Read-only · AutoFiberEngine DFS topology</p>' +
          '</div>' +
          '<button type="button" class="fd-float__close" id="fd-float-close" aria-label="Close">×</button>' +
          '</header>' +
          '<div class="fd-float__body"></div>' +
          '<footer class="fd-float__footer">' +
          '<span class="fd-float__hint">Drag header to move · Resize from any edge or corner · Map stays interactive</span>' +
          '</footer>' +
          '</div>';
      }

      if (matrixEl.parentNode !== host) {
        host.appendChild(matrixEl);
      }

      hideMatrix();
      bindMatrixWindowEvents();
      if (DEBUG) {
      console.log('[FiberDesignUI] ensureMatrixWindow SUCCESS');
      }
      return matrixEl;
    } catch (e) {
      console.error('[FiberDesignUI] ensureMatrixWindow EXCEPTION:', e.message);
      console.error('[FiberDesignUI] ensureMatrixWindow STACK:', e.stack);
      return null;
    }
  }

  function showMatrix() {
    if (DEBUG) {
    console.log('[FiberDesignUI] showMatrix START');
    }
    if (!matrixEl) {
      console.error('[FiberDesignUI] showMatrix ERROR: matrixEl is null');
      return;
    }
    matrixOpen = true;
    matrixEl.removeAttribute('hidden');
    matrixEl.hidden = false;
    matrixEl.classList.add('is-open');
    matrixEl.setAttribute('aria-hidden', 'false');
    if (DEBUG) {
    console.log('[FiberDesignUI] showMatrix SUCCESS');
    }
  }

  function hideMatrix() {
    matrixOpen = false;
    dragState = null;
    resizeState = null;
    if (!matrixEl) return;
    matrixEl.setAttribute('hidden', 'true');
    matrixEl.hidden = true;
    matrixEl.classList.remove('is-open');
    matrixEl.setAttribute('aria-hidden', 'true');
  }

  function openMatrix(options) {
    if (DEBUG) {
    console.log('[FiberDesignUI] openMatrix START');
    }
    try {
      options = options || {};
      if (!ensureMatrixWindow()) {
        console.error('[FiberDesignUI] openMatrix ERROR: ensureMatrixWindow returned false');
        return;
      }
      
      // Show window FIRST so user gets feedback even if engine is slow/buggy
      showMatrix();
      
      var mgr = getManager();
      if (mgr && mgr.AutoFiberEngine) {
        try {
          /* Always rescan live map state when opening — do not wait for draw events */
          if (mgr.AutoFiberEngine.scanMapAndRegenerate) {
            mgr.AutoFiberEngine.scanMapAndRegenerate();
          } else if (mgr.AutoFiberEngine.regenerate) {
            mgr.AutoFiberEngine.regenerate();
          }
        } catch (engineErr) {
          console.error('[FiberDesignUI] Engine regeneration failed:', engineErr);
          // Don't return; refreshMatrix will show the error state in the body
        }
      } else if (mgr && mgr.ensureDisplayData) {
        mgr.ensureDisplayData();
      }

      activeCabinetFilter = options.cabinetFilter != null ? String(options.cabinetFilter) : 'all';
      activeClosureFilter = options.closureFilter != null ? String(options.closureFilter) : 'all';
      
      refreshMatrix();
      if (DEBUG) {
      console.log('[FiberDesignUI] openMatrix SUCCESS');
      }
    } catch (e) {
      console.error('[FiberDesignUI] openMatrix EXCEPTION:', e.message);
      console.error('[FiberDesignUI] openMatrix STACK:', e.stack);
    }
  }

  function closeMatrix() {
    hideMatrix();
  }

  function ensureStyles() {
    var style = document.getElementById('ftth-fiber-design-ui-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'ftth-fiber-design-ui-style';
      document.head.appendChild(style);
    }
    stylesInjected = true;
    style.textContent = [
      /* Sidebar */
      '.sidebar-section--fiber-design{margin-top:0.35rem;}',
      '.fiber-design-panel--empty{padding:0.15rem 0;}',
      '.fiber-design-panel__empty,.fiber-design-panel__hint{',
      'margin:0;padding:0.45rem 0.55rem;border-radius:0.45rem;',
      'border:1px dashed rgba(100,116,139,0.35);font-size:0.62rem;',
      'font-style:italic;color:#64748b;background:rgba(15,23,42,0.35);}',
      '.fiber-design-panel__hint{font-style:normal;color:#94a3b8;}',
      '.fiber-design-tabs{display:flex;flex-wrap:wrap;gap:0.3rem;margin-bottom:0.55rem;}',
      '.fiber-design-tab{',
      'padding:0.28rem 0.5rem;border-radius:0.35rem;border:1px solid rgba(71,85,105,0.55);',
      'background:rgba(15,23,42,0.72);color:#cbd5e1;font-size:0.62rem;font-weight:700;',
      'font-family:ui-monospace,Consolas,monospace;cursor:pointer;line-height:1.2;}',
      '.fiber-design-tab:hover{border-color:rgba(148,163,184,0.55);color:#f1f5f9;}',
      '.fiber-design-tab--active{border-color:#FFD400;background:rgba(255,212,0,0.12);color:#FFD400;}',
      '.fiber-design-tab-content{min-height:2rem;}',
      '.fiber-design-cable-detail__meta{display:flex;flex-wrap:wrap;gap:0.35rem 0.6rem;',
      'margin:0 0 0.45rem;font-size:0.58rem;color:#64748b;}',
      '.fiber-design-cable-detail__dir{text-transform:uppercase;letter-spacing:0.06em;font-weight:700;}',
      '.fiber-design-cable-detail__name{font-family:ui-monospace,Consolas,monospace;color:#94a3b8;}',
      '.fiber-design-tubes{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:0.4rem;}',
      '.fiber-design-tube{border:1px solid rgba(51,65,85,0.55);border-radius:0.45rem;',
      'background:rgba(15,23,42,0.45);overflow:hidden;}',
      '.fiber-design-tube__head{display:flex;justify-content:space-between;gap:0.5rem;',
      'padding:0.35rem 0.5rem;font-size:0.6rem;font-weight:700;color:#e2e8f0;',
      'background:rgba(30,41,59,0.55);border-bottom:1px solid rgba(51,65,85,0.45);}',
      '.fiber-design-tube__color{color:#94a3b8;font-weight:600;text-transform:capitalize;}',
      '.fiber-design-fibers{list-style:none;margin:0;padding:0.25rem 0;}',
      '.fiber-design-fiber{display:grid;grid-template-columns:1.5rem 1fr auto;gap:0.35rem;',
      'align-items:center;padding:0.22rem 0.5rem;font-size:0.58rem;color:#cbd5e1;}',
      '.fiber-design-fiber:nth-child(even){background:rgba(15,23,42,0.35);}',
      '.fiber-design-fiber__num{font-family:ui-monospace,Consolas,monospace;color:#64748b;}',
      '.fiber-design-fiber__color{text-transform:capitalize;}',
      '.fiber-design-fiber__status{font-size:0.54rem;text-transform:uppercase;letter-spacing:0.04em;',
      'padding:0.08rem 0.28rem;border-radius:0.25rem;background:rgba(51,65,85,0.45);color:#94a3b8;}',
      '.fiber-design-fiber__status--spliced{color:#4ade80;background:rgba(74,222,128,0.12);}',
      '.fiber-design-fiber__status--dark_fiber{color:#60a5fa;background:rgba(96,165,250,0.12);}',
      '.fiber-design-fiber__status--dead{color:#f87171;background:rgba(248,113,113,0.12);}',
      '.fiber-design-fiber--empty{font-style:italic;color:#64748b;padding:0.35rem 0.5rem;}',

      /* Floating window — host never captures map events */
      '.fd-float-host{display:none;position:absolute;inset:0;z-index:10050;pointer-events:none;}',
      '.fd-float-host.is-open{display:block;}',
      '.fd-float-host[hidden]{display:none !important;}',
      '.fd-float__window{',
      'position:absolute;left:4%;top:8%;width:min(72vw,920px);height:min(58vh,520px);',
      'min-width:360px;min-height:220px;max-width:96%;max-height:92%;',
      'display:flex;flex-direction:column;',
      'overflow:hidden;',
      'pointer-events:auto;',
      'border:1px solid rgba(71,85,105,0.9);border-radius:0.65rem;',
      'background:#0f172a;box-shadow:0 18px 50px rgba(0,0,0,0.5);}',
      '.fd-float__window.is-dragging,.fd-float__window.is-resizing{opacity:0.94;user-select:none;}',
      '.fd-float__header{',
      'display:flex;align-items:flex-start;justify-content:space-between;gap:0.75rem;',
      'padding:0.65rem 0.75rem;border-bottom:1px solid rgba(51,65,85,0.8);background:#111827;',
      'cursor:move;flex-shrink:0;touch-action:none;}',
      '.fd-float__title{margin:0;font-size:0.88rem;font-weight:700;color:#f8fafc;}',
      '.fd-float__subtitle{margin:0.15rem 0 0;font-size:0.62rem;color:#94a3b8;}',
      '.fd-float__close{',
      'border:none;background:rgba(51,65,85,0.55);color:#e2e8f0;border-radius:0.35rem;',
      'width:1.85rem;height:1.85rem;font-size:1.15rem;line-height:1;cursor:pointer;flex-shrink:0;}',
      '.fd-float__close:hover{background:rgba(71,85,105,0.85);}',
      '.fd-float__body{flex:1;min-height:0;overflow:auto;padding:0.65rem 0.75rem;}',
      '.fd-float__footer{',
      'padding:0.4rem 0.75rem;border-top:1px solid rgba(51,65,85,0.65);background:#0b1220;flex-shrink:0;}',
      '.fd-float__hint{font-size:0.58rem;color:#64748b;}',
      '.fd-float__toolbar{',
      'display:flex;flex-wrap:wrap;align-items:center;gap:0.45rem 0.75rem;margin-bottom:0.65rem;}',
      '.fd-float__filter-label{font-size:0.62rem;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;}',
      '.fd-float__filter-select{',
      'min-width:9.5rem;padding:0.3rem 0.45rem;border-radius:0.3rem;',
      'border:1px solid rgba(71,85,105,0.8);background:#1e293b;color:#f8fafc;font-size:0.68rem;}',
      '.fd-float__badge{',
      'font-size:0.58rem;padding:0.12rem 0.4rem;border-radius:0.25rem;',
      'background:rgba(56,189,248,0.12);color:#38bdf8;border:1px solid rgba(56,189,248,0.3);}',
      '.fd-float__row-count{margin-left:auto;font-size:0.6rem;color:#64748b;font-family:ui-monospace,Consolas,monospace;}',
      /* OS-style resize handles (all edges + corners) */
      '.fd-float__resize{position:absolute;z-index:5;background:transparent;}',
      '.fd-float__resize--n{left:8px;right:8px;top:-3px;height:8px;cursor:ns-resize;}',
      '.fd-float__resize--s{left:8px;right:8px;bottom:-3px;height:8px;cursor:ns-resize;}',
      '.fd-float__resize--e{top:8px;bottom:8px;right:-3px;width:8px;cursor:ew-resize;}',
      '.fd-float__resize--w{top:8px;bottom:8px;left:-3px;width:8px;cursor:ew-resize;}',
      '.fd-float__resize--ne{top:-4px;right:-4px;width:14px;height:14px;cursor:nesw-resize;}',
      '.fd-float__resize--nw{top:-4px;left:-4px;width:14px;height:14px;cursor:nwse-resize;}',
      '.fd-float__resize--se{bottom:-4px;right:-4px;width:14px;height:14px;cursor:nwse-resize;}',
      '.fd-float__resize--sw{bottom:-4px;left:-4px;width:14px;height:14px;cursor:nesw-resize;}',
      '.fd-matrix-scroll{overflow:auto;max-width:100%;border:1px solid rgba(51,65,85,0.75);border-radius:0.4rem;}',
      '.fd-matrix-table{width:100%;border-collapse:collapse;min-width:900px;font-size:0.65rem;}',
      '.fd-matrix-table thead th{',
      'position:sticky;top:0;z-index:2;padding:0.4rem 0.5rem;text-align:left;',
      'background:#1e293b;color:#cbd5e1;font-weight:700;border-bottom:1px solid rgba(71,85,105,0.85);',
      'white-space:nowrap;font-size:0.58rem;text-transform:uppercase;letter-spacing:0.04em;}',
      '.fd-matrix-table tbody td{',
      'padding:0.3rem 0.5rem;border-bottom:1px solid rgba(30,41,59,0.85);',
      'border-right:1px solid rgba(30,41,59,0.55);color:#e2e8f0;vertical-align:middle;}',
      '.fd-matrix-table tbody tr:nth-child(even) td{background:rgba(15,23,42,0.35);}',
      '.fd-matrix-cell--color{font-weight:700;text-transform:capitalize;text-shadow:0 1px 1px rgba(0,0,0,0.35);}',
      '.fd-matrix-cell--type-main{font-weight:700;color:#4ade80;}',
      '.fd-matrix-cell--type-expansion{font-weight:700;color:#60a5fa;}',
      '.fd-matrix-empty{',
      'padding:1rem;border:1px dashed rgba(100,116,139,0.45);border-radius:0.4rem;',
      'color:#94a3b8;font-size:0.72rem;text-align:center;background:rgba(15,23,42,0.45);}',
    ].join('');
  }

  global.FTTHFiberDesignUI = {
    init: init,
    renderSection: renderSection,
    bind: bind,
    refreshPanelContent: refreshPanelContent,
    clearActiveTab: clearActiveTab,
    sortCablesForTabs: sortCablesForTabs,
    openMatrix: openMatrix,
    closeMatrix: closeMatrix,
    refreshMatrix: refreshMatrix,
    onPathMerged: onPathMerged,
    isMatrixOpen: function () { return matrixOpen; },
    open: openMatrix,
    close: closeMatrix,
    refresh: refreshMatrix,
  };
})(typeof window !== 'undefined' ? window : globalThis);
