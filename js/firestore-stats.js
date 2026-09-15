/**
 * Firestore real-time sync for landing page statistics (settings/stats).
 */
import { db } from './firebase-config.js';
import { doc, onSnapshot, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

var DOC_PATH = ['settings', 'stats'];
var cachedStats = null;
var snapshotReady = false;
var listeners = [];
var unsubscribeSnapshot = null;

var DEFAULTS = {
  enrolledStudents: 2500,
  simulatedKilometers: 15000,
  trainingProjects: 48,
  satisfactionRate: 98,
};

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

function notifyListeners() {
  var stats = getCachedPlatformStats();
  listeners.forEach(function (fn) {
    try {
      fn(stats);
    } catch (err) {
      console.error('[PlatformStatsFirestore] listener failed', err);
    }
  });
  try {
    window.dispatchEvent(new CustomEvent('ifa:platform-stats-changed', { detail: stats }));
    document.dispatchEvent(new CustomEvent('ifa:platform-stats-changed', { detail: stats }));
  } catch (err) {
    /* ignore */
  }
  if (window.PlatformStats && typeof window.PlatformStats.applyLandingStats === 'function') {
    window.PlatformStats.applyLandingStats(document);
  }
}

function handleSnapshot(snap) {
  if (!snap.exists()) {
    cachedStats = normalizeStats(DEFAULTS);
  } else {
    cachedStats = normalizeStats(snap.data());
  }
  snapshotReady = true;
  notifyListeners();
}

export function getCachedPlatformStats() {
  return normalizeStats(cachedStats || DEFAULTS);
}

export function isStatsSnapshotReady() {
  return snapshotReady;
}

export function subscribePlatformStats(callback) {
  if (typeof callback === 'function') {
    listeners.push(callback);
    if (snapshotReady) callback(getCachedPlatformStats());
  }
  return function () {
    listeners = listeners.filter(function (fn) {
      return fn !== callback;
    });
  };
}

export async function savePlatformStats(patch) {
  var next = normalizeStats(Object.assign({}, getCachedPlatformStats(), patch || {}));
  next.updatedAt = new Date().toISOString();
  await setDoc(doc(db, DOC_PATH[0], DOC_PATH[1]), next, { merge: true });
  cachedStats = next;
  snapshotReady = true;
  notifyListeners();
  return next;
}

export function startPlatformStatsSync() {
  if (unsubscribeSnapshot) return unsubscribeSnapshot;
  unsubscribeSnapshot = onSnapshot(
    doc(db, DOC_PATH[0], DOC_PATH[1]),
    handleSnapshot,
    function (err) {
      console.error('[PlatformStatsFirestore] onSnapshot failed', err);
      cachedStats = normalizeStats(DEFAULTS);
      snapshotReady = true;
      notifyListeners();
    }
  );
  return unsubscribeSnapshot;
}

var api = {
  DEFAULTS: DEFAULTS,
  normalizeStats: normalizeStats,
  subscribe: subscribePlatformStats,
  getCachedStats: getCachedPlatformStats,
  isReady: isStatsSnapshotReady,
  saveStats: savePlatformStats,
  start: startPlatformStatsSync,
};

window.PlatformStatsFirestore = api;
startPlatformStatsSync();

export default api;
