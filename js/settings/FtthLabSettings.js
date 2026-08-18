/**
 * FTTH Lab — toolbox icon config persistence + undo/redo.
 * localStorage key: ifa_ftth_lab_config
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'ifa_ftth_lab_config';
  var MAX_HISTORY = 60;
  var MAX_ICON_CHARS = 1800000;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  var FACTORY_DEFAULT_FTTH_LAB_CONFIG = {
    version: 1,
    categories: [
      { id: 'active', label: 'ACTIVE EQUIPMENT' },
      { id: 'splitters', label: 'SPLITTERS' },
      { id: 'test', label: 'TEST EQUIPMENT' },
      { id: 'termination', label: 'PATCH PANELS / TERMINATION' },
    ],
    items: [
      { id: 'chassis', toolKey: 'chassis', categoryId: 'active', label: 'Nokia 7360 FX-16', sublabel: 'OLT', markClass: 'chassis', icon: '' },
      { id: 'card', toolKey: 'card', categoryId: 'active', label: 'FGLT-D Line Card', sublabel: 'Line card', markClass: 'card', icon: '' },
      { id: 'sfp', toolKey: 'sfp', categoryId: 'active', label: 'SFP Transceiver', sublabel: 'Optical module', markClass: 'sfp', icon: '' },
      { id: 'splitter', toolKey: 'splitter', categoryId: 'splitters', label: 'Splitter', sublabel: 'Configure on workspace', markClass: 'splitter', icon: '' },
      { id: 'opm', toolKey: 'opm', categoryId: 'test', label: 'Viavi OLP-38', sublabel: 'SC dock · live dBm', markClass: 'opm', icon: '' },
      { id: 'ols', toolKey: 'ols', categoryId: 'test', label: 'OLS-35 / OPL', sublabel: 'Calibrated source · 1310 / 1550', markClass: 'ols', icon: '' },
      { id: 'vfl', toolKey: 'vfl', categoryId: 'test', label: 'Visual Fault Locator', sublabel: '10 mW · 650 nm laser', markClass: 'vfl', icon: '' },
      { id: 'jig', toolKey: 'jig', categoryId: 'test', label: 'Macro-Bend Tester', sublabel: 'Articulated slot · 0–180°', markClass: 'jig', icon: '' },
      { id: 'patchcord', toolKey: 'patchcord', categoryId: 'termination', label: 'Patch Cord', sublabel: 'A ↔ B same click-drag rules', markClass: 'pcord', icon: '' },
      { id: 'pigtail', toolKey: 'pigtail', categoryId: 'termination', label: 'SC Pigtail', sublabel: 'SC connector + bare fiber', markClass: 'pigtail', icon: '' },
      { id: 'spool', toolKey: 'spool', categoryId: 'termination', label: 'Fiber Spool', sublabel: 'Type in properties panel', markClass: 'spool', icon: '' },
      { id: 'coupler', toolKey: 'coupler', categoryId: 'termination', label: 'SC/APC Coupler', sublabel: 'Inline sleeve · 0.2–0.5 dB IL', markClass: 'cpl', icon: '' },
    ],
  };

  function clipIcon(src) {
    var value = typeof src === 'string' ? src : '';
    if (value.length > MAX_ICON_CHARS) return '';
    return value;
  }

  function normalizeItem(raw) {
    var item = raw && typeof raw === 'object' ? raw : {};
    var factory = FACTORY_DEFAULT_FTTH_LAB_CONFIG.items.filter(function (fi) {
      return fi.id === item.id || fi.toolKey === item.toolKey;
    })[0] || {};
    return {
      id: String(item.id || factory.id || ('tool_' + Date.now())),
      toolKey: String(item.toolKey || factory.toolKey || ''),
      categoryId: String(item.categoryId || factory.categoryId || 'active'),
      label: String(item.label || factory.label || 'Toolbox item'),
      sublabel: String(item.sublabel || factory.sublabel || ''),
      markClass: String(item.markClass || factory.markClass || ''),
      icon: clipIcon(item.icon || ''),
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
      version: 1,
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

  function applyToolboxIcons(config) {
    var cfg = normalizeConfig(config || saved);
    var iconMap = {};
    cfg.items.forEach(function (item) {
      if (item.toolKey) iconMap[item.toolKey] = item;
    });
    document.querySelectorAll('.lab-rail .lab-tool[data-lab-tool]').forEach(function (btn) {
      var key = btn.getAttribute('data-lab-tool');
      var item = iconMap[key];
      var mark = btn.querySelector('.lab-tool__mark');
      if (!mark || !item) return;
      applyIconToMark(mark, item.icon, item.markClass);
    });
  }

  var Store = {
    STORAGE_KEY: STORAGE_KEY,
    FACTORY_DEFAULT_FTTH_LAB_CONFIG: FACTORY_DEFAULT_FTTH_LAB_CONFIG,
    MAX_ICON_CHARS: MAX_ICON_CHARS,

    getActiveConfig: function () {
      return clone(saved);
    },

    getDraft: function () {
      return clone(draft);
    },

    getIconForTool: function (toolKey) {
      var item = saved.items.filter(function (it) { return it.toolKey === toolKey; })[0];
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

    setToolIcon: function (toolKey, iconData, recordHistory) {
      var next = clone(draft);
      var found = false;
      next.items = next.items.map(function (it) {
        if (it.toolKey !== toolKey) return it;
        found = true;
        return normalizeItem(Object.assign({}, it, { icon: clipIcon(iconData || '') }));
      });
      if (!found) return false;
      Store.setDraft(next, recordHistory !== false);
      return true;
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
      applyToolboxIcons(saved);
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
    applyIconToMark: applyIconToMark,
    normalizeConfig: normalizeConfig,
  };

  global.FACTORY_DEFAULT_FTTH_LAB_CONFIG = FACTORY_DEFAULT_FTTH_LAB_CONFIG;
  global.FtthLabSettings = Store;
})(typeof window !== 'undefined' ? window : globalThis);
