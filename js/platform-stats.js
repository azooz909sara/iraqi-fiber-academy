/**
 * Public landing page statistics — Firestore settings/stats (real-time) with local fallback.
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

  function usesFirestoreStats() {
    return !!(
      global.PlatformStatsFirestore &&
      typeof global.PlatformStatsFirestore.isReady === 'function' &&
      global.PlatformStatsFirestore.isReady()
    );
  }

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
    if (global.PlatformStatsFirestore && typeof global.PlatformStatsFirestore.normalizeStats === 'function') {
      return global.PlatformStatsFirestore.normalizeStats(raw);
    }
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
    if (usesFirestoreStats()) {
      return global.PlatformStatsFirestore.getCachedStats();
    }
    return normalizeStats(readJson() || DEFAULTS);
  }

  function saveStats(patch) {
    var next = normalizeStats(Object.assign({}, getStats(), patch || {}));
    if (global.PlatformStatsFirestore && typeof global.PlatformStatsFirestore.saveStats === 'function') {
      return global.PlatformStatsFirestore.saveStats(next);
    }
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
    return Promise.resolve(next);
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

  function bindFirestoreSubscription() {
    (function waitForFirestore(attempts) {
      if (global.PlatformStatsFirestore && typeof global.PlatformStatsFirestore.subscribe === 'function') {
        global.PlatformStatsFirestore.subscribe(function () {
          loadPublicStats();
        });
        return;
      }
      if (attempts > 40) return;
      global.setTimeout(function () {
        waitForFirestore(attempts + 1);
      }, 50);
    })(0);
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
    usesFirestore: usesFirestoreStats,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      loadPublicStats();
      bindFirestoreSubscription();
    });
  } else {
    loadPublicStats();
    bindFirestoreSubscription();
  }

  global.addEventListener('ifa:platform-stats-changed', function () {
    loadPublicStats();
  });

  global.addEventListener('storage', function (e) {
    if (usesFirestoreStats()) return;
    if (e.key === KEY) loadPublicStats();
  });
})(typeof window !== 'undefined' ? window : this);
