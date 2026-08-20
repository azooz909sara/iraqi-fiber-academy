/**
 * Public landing page statistics — localStorage CMS (ifa_platform_stats).
 */
(function (global) {
  'use strict';

  var KEY = 'ifa_platform_stats';

  var DEFAULTS = {
    enrolledStudents: 2500,
    simulatedKilometers: 15000,
    trainingProjects: 48,
    satisfactionRate: 98,
  };

  function readJson() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  function clampInt(value, fallback, min, max) {
    var n = parseInt(value, 10);
    if (!isFinite(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  function normalizeStats(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    return {
      enrolledStudents: clampInt(src.enrolledStudents, DEFAULTS.enrolledStudents, 0, 99999999),
      simulatedKilometers: clampInt(src.simulatedKilometers, DEFAULTS.simulatedKilometers, 0, 999999999),
      trainingProjects: clampInt(src.trainingProjects, DEFAULTS.trainingProjects, 0, 9999999),
      satisfactionRate: clampInt(src.satisfactionRate, DEFAULTS.satisfactionRate, 0, 100),
    };
  }

  /** Always Latin digits 0-9 — never Arabic-Indic numerals. */
  function formatStatNumber(value) {
    var n = Number(value);
    if (!isFinite(n)) return '0';
    return Math.round(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  function getStats() {
    return normalizeStats(readJson());
  }

  function saveStats(patch) {
    var next = normalizeStats(Object.assign({}, getStats(), patch || {}));
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch (err) {
      console.error('[PlatformStats] save failed', err);
    }
    try {
      global.dispatchEvent(new CustomEvent('ifa:platform-stats-changed', { detail: next }));
    } catch (err2) {
      /* ignore */
    }
    return next;
  }

  function applyLandingStats(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var stats = getStats();
    scope.querySelectorAll('[data-stat-key]').forEach(function (el) {
      var key = el.getAttribute('data-stat-key');
      if (!stats.hasOwnProperty(key)) return;
      var value = stats[key];
      el.setAttribute('data-target', String(value));
      el.textContent = '0';
    });
  }

  function loadPublicStats() {
    applyLandingStats(document);
  }

  global.PlatformStats = {
    KEY: KEY,
    DEFAULTS: DEFAULTS,
    getStats: getStats,
    saveStats: saveStats,
    normalizeStats: normalizeStats,
    formatStatNumber: formatStatNumber,
    applyLandingStats: applyLandingStats,
    loadPublicStats: loadPublicStats,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadPublicStats);
  } else {
    loadPublicStats();
  }

  global.addEventListener('storage', function (e) {
    if (e.key === KEY) loadPublicStats();
  });
})(typeof window !== 'undefined' ? window : this);
