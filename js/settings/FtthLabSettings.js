/**
 * FTTH Lab — device metadata, toolbox icons, specs persistence + undo/redo.
 * localStorage key: ifa_ftth_lab_config
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'ifa_ftth_lab_config';
  var MAX_HISTORY = 60;
  var MAX_ICON_CHARS = 1800000;

  var DEFAULT_SPLITTER_LOSSES = {
    '1x4': 7.3,
    '1x8': 10.5,
    '1x16': 13.8,
    '1x32': 17.1,
    '1x64': 21.0,
    '2x4': 7.3,
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  var FACTORY_DEFAULT_FTTH_LAB_CONFIG = {
    version: 2,
    categories: [
      { id: 'active', label: 'ACTIVE EQUIPMENT' },
      { id: 'splitters', label: 'SPLITTERS' },
      { id: 'test', label: 'TEST EQUIPMENT' },
      { id: 'termination', label: 'PATCH PANELS / TERMINATION' },
    ],
    items: [
      {
        id: 'chassis', toolKey: 'chassis', categoryId: 'active',
        label: 'Nokia 7360 FX-16', sublabel: 'OLT', markClass: 'chassis', icon: '',
        guideText: 'Drag onto the workspace to place the OLT chassis.',
      },
      {
        id: 'card', toolKey: 'card', categoryId: 'active',
        label: 'FGLT-D Line Card', sublabel: 'Line card', markClass: 'card', icon: '',
        guideText: 'Drop onto an empty LT slot on the FX-16 chassis.',
      },
      {
        id: 'sfp', toolKey: 'sfp', categoryId: 'active',
        label: 'SFP Transceiver', sublabel: 'Optical module', markClass: 'sfp', icon: '',
        guideText: 'Drop onto an empty square port on an installed FGLT-D line card.',
        specs: { txLevels: [-3, -6], defaultTxDbm: -3 },
      },
      {
        id: 'splitter', toolKey: 'splitter', categoryId: 'splitters',
        label: 'Splitter', sublabel: 'Configure on workspace', markClass: 'splitter', icon: '',
        guideText: 'Select ratio and port polish (UPC/APC) in the properties panel.',
        specs: { losses: clone(DEFAULT_SPLITTER_LOSSES) },
      },
      {
        id: 'opm', toolKey: 'opm', categoryId: 'test',
        label: 'Viavi OLP-38', sublabel: 'SC dock · live dBm', markClass: 'opm', icon: '',
        guideText: 'Dock an SC Patch Cord or Pigtail into the metal adapter on top.',
      },
      {
        id: 'ols', toolKey: 'ols', categoryId: 'test',
        label: 'OLS-35', sublabel: 'Calibrated source · 1310 / 1550', markClass: 'ols', icon: '',
        guideText: 'Calibrated optical source · 1310 / 1550 nm · dock a patch cord, then enable laser.',
        specs: { txLevels: [-3, -6], defaultTxDbm: -3 },
      },
      {
        id: 'vfl', toolKey: 'vfl', categoryId: 'test',
        label: 'Visual Fault Locator', sublabel: '10 mW · 650 nm laser', markClass: 'vfl', icon: '',
        guideText: 'Dock SC fiber and enable the red fault locator laser.',
      },
      {
        id: 'jig', toolKey: 'jig', categoryId: 'test',
        label: 'Macro-Bend Tester', sublabel: 'Articulated slot · 0–180°', markClass: 'jig', icon: '',
        guideText: 'Route a patch cord through the slot and set bend angle θ in properties.',
      },
      {
        id: 'patchcord', toolKey: 'patchcord', categoryId: 'termination',
        label: 'Patch Cord', sublabel: 'A ↔ B same click-drag rules', markClass: 'pcord', icon: '',
        guideText: 'Drag both ends · SC/UPC or SC/APC · meter mode in properties.',
      },
      {
        id: 'pigtail', toolKey: 'pigtail', categoryId: 'termination',
        label: 'SC Pigtail', sublabel: 'SC connector + bare fiber', markClass: 'pigtail', icon: '',
        guideText: 'SC connector on one end · bare fiber tail for splicing or winding.',
      },
      {
        id: 'spool', toolKey: 'spool', categoryId: 'termination',
        label: 'Fiber Spool', sublabel: 'Type in properties panel', markClass: 'spool', icon: '',
        guideText: 'Pin spool on workspace · set fiber type and length in properties.',
      },
      {
        id: 'coupler', toolKey: 'coupler', categoryId: 'termination',
        label: 'SC/APC Coupler', sublabel: 'Inline sleeve · 0.2–0.5 dB IL', markClass: 'cpl', icon: '',
        guideText: 'Inline SC adapter · switch UPC/APC type in properties.',
      },
    ],
  };

  function clipIcon(src) {
    var value = typeof src === 'string' ? src : '';
    if (value.length > MAX_ICON_CHARS) return '';
    return value;
  }

  function parseTxLevels(value) {
    if (Array.isArray(value)) {
      return value.map(Number).filter(function (n) { return isFinite(n); });
    }
    return String(value == null ? '' : value)
      .split(/[,;\s]+/)
      .map(function (s) { return parseFloat(s.trim()); })
      .filter(function (n) { return isFinite(n); });
  }

  function normalizeSpecs(toolKey, specs, factorySpecs) {
    specs = specs && typeof specs === 'object' ? specs : {};
    factorySpecs = factorySpecs && typeof factorySpecs === 'object' ? factorySpecs : {};

    if (toolKey === 'ols' || toolKey === 'sfp') {
      var levels = parseTxLevels(specs.txLevels != null ? specs.txLevels : factorySpecs.txLevels);
      if (!levels.length) levels = parseTxLevels(factorySpecs.txLevels || [-3, -6]);
      if (!levels.length) levels = [-3, -6];
      var def = Number(specs.defaultTxDbm != null ? specs.defaultTxDbm : factorySpecs.defaultTxDbm);
      if (!isFinite(def) || levels.indexOf(def) < 0) {
        def = levels.indexOf(-3) >= 0 ? -3 : levels[0];
      }
      return { txLevels: levels, defaultTxDbm: def };
    }

    if (toolKey === 'splitter') {
      var losses = clone(factorySpecs.losses || DEFAULT_SPLITTER_LOSSES);
      if (specs.losses && typeof specs.losses === 'object') {
        Object.keys(specs.losses).forEach(function (k) {
          var n = Number(specs.losses[k]);
          if (isFinite(n)) losses[k] = n;
        });
      }
      return { losses: losses };
    }

    return specs;
  }

  function factoryItemFor(item) {
    return FACTORY_DEFAULT_FTTH_LAB_CONFIG.items.filter(function (fi) {
      return fi.id === item.id || fi.toolKey === item.toolKey;
    })[0] || {};
  }

  function normalizeItem(raw) {
    var item = raw && typeof raw === 'object' ? raw : {};
    var factory = factoryItemFor(item);
    return {
      id: String(item.id || factory.id || ('tool_' + Date.now())),
      toolKey: String(item.toolKey || factory.toolKey || ''),
      categoryId: String(item.categoryId || factory.categoryId || 'active'),
      label: String(item.label || factory.label || 'Toolbox item'),
      sublabel: String(item.sublabel || factory.sublabel || ''),
      guideText: String(item.guideText || factory.guideText || item.sublabel || factory.sublabel || ''),
      markClass: String(item.markClass || factory.markClass || ''),
      icon: clipIcon(item.icon || ''),
      specs: normalizeSpecs(
        String(item.toolKey || factory.toolKey || ''),
        item.specs,
        factory.specs
      ),
    };
  }

  function normalizeConfig(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var factory = FACTORY_DEFAULT_FTTH_LAB_CONFIG;
    var cats = Array.isArray(src.categories) && src.categories.length
      ? src.categories
      : factory.categories;
    var byKey = {};
    var items = [];
    if (Array.isArray(src.items)) {
      src.items.forEach(function (it) {
        var norm = normalizeItem(it);
        if (norm.toolKey) {
          byKey[norm.toolKey] = norm;
          items.push(norm);
        }
      });
    }
    factory.items.forEach(function (fi) {
      if (!byKey[fi.toolKey]) items.push(normalizeItem(fi));
      else {
        var idx = items.findIndex(function (it) { return it.toolKey === fi.toolKey; });
        if (idx >= 0) {
          items[idx] = normalizeItem(Object.assign({}, fi, items[idx]));
        }
      }
    });
    items.sort(function (a, b) {
      var ai = factory.items.findIndex(function (fi) { return fi.toolKey === a.toolKey; });
      var bi = factory.items.findIndex(function (fi) { return fi.toolKey === b.toolKey; });
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    });
    return {
      version: 2,
      categories: cats.map(function (c) {
        return {
          id: String((c && c.id) || 'active'),
          label: String((c && c.label) || ''),
        };
      }),
      items: items,
    };
  }

  function loadSaved() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return clone(FACTORY_DEFAULT_FTTH_LAB_CONFIG);
      return normalizeConfig(JSON.parse(raw));
    } catch (err) {
      return clone(FACTORY_DEFAULT_FTTH_LAB_CONFIG);
    }
  }

  var saved = loadSaved();
  var draft = clone(saved);
  var historyStack = [clone(draft)];
  var historyPointer = 0;

  function emit(name, detail) {
    try {
      global.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
    } catch (err) { /* ignore */ }
  }

  function persistSaved() {
    try {
      global.localStorage.removeItem(STORAGE_KEY);
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      return true;
    } catch (err) {
      return false;
    }
  }

  function clearCustomIconStyles(mark) {
    if (!mark) return;
    mark.classList.remove('lab-tool__mark--custom');
    mark.style.backgroundImage = '';
    mark.style.backgroundSize = '';
    mark.style.backgroundRepeat = '';
    mark.style.backgroundPosition = '';
    mark.style.backgroundColor = '';
    mark.style.borderColor = '';
    mark.style.boxShadow = '';
  }

  function applyIconToMark(mark, icon, markClass) {
    if (!mark) return;
    if (markClass && !mark.classList.contains('lab-tool__mark--' + markClass)) {
      mark.className = 'lab-tool__mark lab-tool__mark--' + markClass;
    }
    if (icon && icon.indexOf('data:image') === 0) {
      mark.classList.add('lab-tool__mark--custom');
      mark.style.backgroundImage = 'url("' + icon.replace(/"/g, '\\"') + '")';
      mark.style.backgroundSize = 'contain';
      mark.style.backgroundRepeat = 'no-repeat';
      mark.style.backgroundPosition = 'center';
      mark.style.backgroundColor = 'transparent';
      mark.style.borderColor = 'rgba(148, 163, 184, 0.25)';
      mark.style.boxShadow = 'none';
    } else {
      clearCustomIconStyles(mark);
    }
  }

  function itemMapFromConfig(config) {
    var map = {};
    normalizeConfig(config).items.forEach(function (item) {
      if (item.toolKey) map[item.toolKey] = item;
    });
    return map;
  }

  function applyToolboxIcons(config) {
    var iconMap = itemMapFromConfig(config || saved);
    document.querySelectorAll('.lab-rail .lab-tool[data-lab-tool]').forEach(function (btn) {
      var key = btn.getAttribute('data-lab-tool');
      var item = iconMap[key];
      var mark = btn.querySelector('.lab-tool__mark');
      if (!mark || !item) return;
      applyIconToMark(mark, item.icon, item.markClass);
    });
  }

  function applyToolboxLabels(config) {
    var labelMap = itemMapFromConfig(config || saved);
    document.querySelectorAll('.lab-rail .lab-tool[data-lab-tool]').forEach(function (btn) {
      var key = btn.getAttribute('data-lab-tool');
      var item = labelMap[key];
      if (!item) return;
      var strong = btn.querySelector('.lab-tool__copy strong');
      var span = btn.querySelector('.lab-tool__copy span');
      if (strong) strong.textContent = item.label;
      if (span) span.textContent = item.sublabel;
    });
  }

  function applyToolboxPresentation(config) {
    applyToolboxIcons(config);
    applyToolboxLabels(config);
  }

  var Store = {
    STORAGE_KEY: STORAGE_KEY,
    FACTORY_DEFAULT_FTTH_LAB_CONFIG: FACTORY_DEFAULT_FTTH_LAB_CONFIG,
    DEFAULT_SPLITTER_LOSSES: DEFAULT_SPLITTER_LOSSES,
    MAX_ICON_CHARS: MAX_ICON_CHARS,
    parseTxLevels: parseTxLevels,

    getActiveConfig: function () {
      return clone(saved);
    },

    getDraft: function () {
      return clone(draft);
    },

    getItem: function (toolKey) {
      if (!toolKey) return null;
      var item = saved.items.filter(function (it) { return it.toolKey === toolKey; })[0];
      return item ? clone(item) : null;
    },

    getIconForTool: function (toolKey) {
      var item = Store.getItem(toolKey);
      return item && item.icon ? item.icon : '';
    },

    setDraft: function (next, recordHistory) {
      draft = normalizeConfig(next);
      if (recordHistory !== false) {
        historyStack = historyStack.slice(0, historyPointer + 1);
        historyStack.push(clone(draft));
        if (historyStack.length > MAX_HISTORY) historyStack.shift();
        historyPointer = historyStack.length - 1;
      }
      emit('ifa:ftth-lab-draft-changed', { draft: clone(draft) });
    },

    updateItem: function (toolKey, patch, recordHistory) {
      if (!toolKey || !patch || typeof patch !== 'object') return false;
      var next = clone(draft);
      var found = false;
      next.items = next.items.map(function (it) {
        if (it.toolKey !== toolKey) return it;
        found = true;
        var merged = Object.assign({}, it, patch);
        if (patch.specs) {
          merged.specs = normalizeSpecs(toolKey, Object.assign({}, it.specs, patch.specs), factoryItemFor(it).specs);
        }
        return normalizeItem(merged);
      });
      if (!found) return false;
      Store.setDraft(next, recordHistory !== false);
      return true;
    },

    setToolIcon: function (toolKey, iconData, recordHistory) {
      return Store.updateItem(toolKey, { icon: clipIcon(iconData || '') }, recordHistory);
    },

    canUndo: function () { return historyPointer > 0; },
    canRedo: function () { return historyPointer < historyStack.length - 1; },

    undo: function () {
      if (!Store.canUndo()) return false;
      historyPointer -= 1;
      draft = clone(historyStack[historyPointer]);
      emit('ifa:ftth-lab-draft-changed', { draft: clone(draft) });
      return true;
    },

    redo: function () {
      if (!Store.canRedo()) return false;
      historyPointer += 1;
      draft = clone(historyStack[historyPointer]);
      emit('ifa:ftth-lab-draft-changed', { draft: clone(draft) });
      return true;
    },

    resetToDefaults: function () {
      Store.setDraft(clone(FACTORY_DEFAULT_FTTH_LAB_CONFIG), true);
    },

    saveChanges: function () {
      saved = clone(draft);
      var ok = persistSaved();
      applyToolboxPresentation(saved);
      emit('ifa:ftth-lab-config-saved', { config: clone(saved), ok: ok });
      return ok;
    },

    discardDraft: function () {
      draft = clone(saved);
      historyStack = [clone(draft)];
      historyPointer = 0;
      emit('ifa:ftth-lab-draft-changed', { draft: clone(draft) });
    },

    applyToolboxIcons: applyToolboxIcons,
    applyToolboxLabels: applyToolboxLabels,
    applyToolboxPresentation: applyToolboxPresentation,
    applyIconToMark: applyIconToMark,
    normalizeConfig: normalizeConfig,
    normalizeItem: normalizeItem,
  };

  global.FACTORY_DEFAULT_FTTH_LAB_CONFIG = FACTORY_DEFAULT_FTTH_LAB_CONFIG;
  global.FtthLabSettings = Store;
})(typeof window !== 'undefined' ? window : globalThis);
