/**
 * Firestore real-time sync for simulator CMS (settings/simulators).
 * Deploy rules: firebase deploy --only firestore:rules
 */
import { db } from './firebase-config.js';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

var SIMULATORS_REF = doc(db, 'settings', 'simulators');
var META_KEY = 'ifa_simulators_meta';
var SHOWCASE_KEY = 'ifa_simulator_showcase';
var SETTINGS_KEY = 'ifa_platform_settings';

var cachedBundle = null;
var snapshotReady = false;
var listeners = [];
var unsubscribeSnapshot = null;
var seedInFlight = false;
var needsSeed = false;

function catalogIds() {
  if (window.PlatformSimulators && Array.isArray(window.PlatformSimulators.CATALOG)) {
    return window.PlatformSimulators.CATALOG.map(function (s) {
      return String(s.id || '');
    }).filter(Boolean);
  }
  return [
    'ftth-simulator',
    'otdr-simulator',
    'power-meter',
    'fusion-splicer',
    'fiber-anatomy',
    'patch-panel-lab',
  ];
}

function defaultShowcaseEntry() {
  if (window.PlatformSimulatorShowcase && typeof window.PlatformSimulatorShowcase.defaultShowcaseEntry === 'function') {
    return window.PlatformSimulatorShowcase.defaultShowcaseEntry();
  }
  return {
    title: '',
    description: '',
    showcaseImage: '',
    visibleInShowcase: true,
  };
}

function normalizeShowcaseEntry(raw) {
  var s = raw && typeof raw === 'object' ? raw : {};
  return {
    title: String(s.title || '').trim().slice(0, 200),
    description: String(s.description || '').trim().slice(0, 800),
    showcaseImage: String(s.showcaseImage || '').trim(),
    visibleInShowcase: s.visibleInShowcase !== false,
  };
}

function defaultSimulatorsMeta() {
  if (window.PlatformSimulators && typeof window.PlatformSimulators.defaultSimulatorMeta === 'function') {
    return window.PlatformSimulators.defaultSimulatorMeta();
  }
  return {};
}

function normalizeSimulatorsMeta(raw) {
  var stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  var defaults = defaultSimulatorsMeta();
  var out = {};
  catalogIds().forEach(function (id) {
    var d = defaults[id] || {};
    var m = stored[id] || {};
    var iconType = m.iconType === 'image' ? 'image' : 'emoji';
    out[id] = {
      title: String(m.title != null ? m.title : d.title || '').trim(),
      description: String(m.description != null ? m.description : d.description || '').trim(),
      icon: String(m.icon != null ? m.icon : d.icon || '◆'),
      iconType: iconType,
    };
  });
  return out;
}

function normalizeShowcaseStore(raw) {
  var stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  var out = {};
  var interval = Number(stored._intervalSeconds);
  out._intervalSeconds = isFinite(interval) && interval >= 2 ? Math.min(60, Math.round(interval)) : 5;
  catalogIds().forEach(function (id) {
    out[id] = normalizeShowcaseEntry(stored[id]);
  });
  return out;
}

function defaultPlatformSettings() {
  return { freeSimulatorIds: [], comingSoonSimulatorIds: [], freeTrialDays: 0 };
}

function normalizePlatformSettings(raw) {
  var base = defaultPlatformSettings();
  var src = raw && typeof raw === 'object' ? raw : {};
  var normalizeIds = function (list) {
    if (window.PlatformSimulators && typeof window.PlatformSimulators.normalizeSimulatorIds === 'function') {
      return window.PlatformSimulators.normalizeSimulatorIds(list);
    }
    return Array.isArray(list) ? list.map(String).filter(Boolean) : [];
  };
  var days = Number(src.freeTrialDays != null ? src.freeTrialDays : base.freeTrialDays);
  return {
    freeSimulatorIds: normalizeIds(src.freeSimulatorIds != null ? src.freeSimulatorIds : base.freeSimulatorIds),
    comingSoonSimulatorIds: normalizeIds(
      src.comingSoonSimulatorIds != null ? src.comingSoonSimulatorIds : base.comingSoonSimulatorIds
    ),
    freeTrialDays: isFinite(days) && days > 0 ? Math.min(365, Math.round(days)) : 0,
  };
}

function emptyBundle() {
  return {
    simulatorsMeta: normalizeSimulatorsMeta({}),
    showcaseStore: normalizeShowcaseStore({}),
    platformSettings: normalizePlatformSettings(null),
    updatedAt: null,
  };
}

function normalizeBundle(raw) {
  var src = raw && typeof raw === 'object' ? raw : {};
  return {
    simulatorsMeta: normalizeSimulatorsMeta(src.simulatorsMeta || src.meta),
    showcaseStore: normalizeShowcaseStore(src.showcaseStore || src.showcaseMeta || src.showcase),
    platformSettings: normalizePlatformSettings(src.platformSettings),
    updatedAt: src.updatedAt || null,
  };
}

function readLocalBundle() {
  var meta = {};
  var showcase = {};
  var settings = {};
  try {
    meta = JSON.parse(localStorage.getItem(META_KEY) || '{}');
  } catch (err) {
    meta = {};
  }
  try {
    showcase = JSON.parse(localStorage.getItem(SHOWCASE_KEY) || '{}');
  } catch (err) {
    showcase = {};
  }
  try {
    settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch (err) {
    settings = {};
  }
  return normalizeBundle({
    simulatorsMeta: meta,
    showcaseStore: showcase,
    platformSettings: settings,
  });
}

function writeLocalBundle(bundle) {
  var normalized = normalizeBundle(bundle);
  try {
    localStorage.setItem(META_KEY, JSON.stringify(normalized.simulatorsMeta));
    localStorage.setItem(SHOWCASE_KEY, JSON.stringify(normalized.showcaseStore));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized.platformSettings));
  } catch (err) {
    console.error('[PlatformSimulatorsFirestore] localStorage write failed', err);
  }
  return normalized;
}

function applyBundleToPlatform(bundle) {
  var normalized = writeLocalBundle(bundle);
  cachedBundle = normalized;
  snapshotReady = true;

  if (window.PlatformSimulators && typeof window.PlatformSimulators.applySimulatorMetaToCards === 'function') {
    window.PlatformSimulators.applySimulatorMetaToCards();
  }
  if (window.PlatformSimulatorShowcase && typeof window.PlatformSimulatorShowcase.mountSimulatorShowcase === 'function') {
    window.PlatformSimulatorShowcase.mountSimulatorShowcase();
  }
  if (window.PlatformSimulators && typeof window.PlatformSimulators.applyPublicSimulatorGates === 'function') {
    window.PlatformSimulators.applyPublicSimulatorGates();
  }

  try {
    window.dispatchEvent(
      new CustomEvent('ifa:simulators-meta-changed', { detail: normalized.simulatorsMeta })
    );
    document.dispatchEvent(
      new CustomEvent('ifa:simulators-meta-changed', { detail: normalized.simulatorsMeta })
    );
    window.dispatchEvent(
      new CustomEvent('ifa:simulator-showcase-changed', { detail: normalized.showcaseStore })
    );
    document.dispatchEvent(
      new CustomEvent('ifa:simulator-showcase-changed', { detail: normalized.showcaseStore })
    );
    window.dispatchEvent(
      new CustomEvent('ifa:platform-settings-changed', { detail: normalized.platformSettings })
    );
    document.dispatchEvent(
      new CustomEvent('ifa:platform-settings-changed', { detail: normalized.platformSettings })
    );
    window.dispatchEvent(
      new CustomEvent('ifa:simulators-firestore-changed', { detail: normalized })
    );
    document.dispatchEvent(
      new CustomEvent('ifa:simulators-firestore-changed', { detail: normalized })
    );
  } catch (err) {
    /* ignore */
  }
}

function notifyListeners() {
  var bundle = getCachedSimulatorsBundle();
  listeners.forEach(function (fn) {
    try {
      fn(bundle);
    } catch (err) {
      console.error('[PlatformSimulatorsFirestore] listener failed', err);
    }
  });
}

function mergeSimulatorsMetaPatch(current, patch) {
  var base = normalizeSimulatorsMeta(current);
  var incoming = patch && typeof patch === 'object' ? patch : {};
  Object.keys(incoming).forEach(function (id) {
    if (catalogIds().indexOf(id) === -1) return;
    var m = incoming[id] || {};
    base[id] = {
      title: String(m.title != null ? m.title : base[id].title).trim() || base[id].title,
      description: String(m.description != null ? m.description : base[id].description),
      icon: String(m.icon != null ? m.icon : base[id].icon),
      iconType: m.iconType === 'image' ? 'image' : 'emoji',
    };
  });
  return base;
}

function mergeShowcasePatch(currentStore, patch, intervalSeconds) {
  var base = normalizeShowcaseStore(currentStore);
  if (intervalSeconds != null) {
    var sec = Number(intervalSeconds);
    if (isFinite(sec)) base._intervalSeconds = Math.max(2, Math.min(60, Math.round(sec)));
  }
  var incoming = patch && typeof patch === 'object' ? patch : {};
  Object.keys(incoming).forEach(function (id) {
    if (id.charAt(0) === '_') return;
    if (catalogIds().indexOf(id) === -1) return;
    base[id] = normalizeShowcaseEntry(Object.assign({}, base[id], incoming[id]));
  });
  return base;
}

function isDocumentEmpty(data) {
  if (!data || typeof data !== 'object') return true;
  var hasMeta =
    data.simulatorsMeta &&
    typeof data.simulatorsMeta === 'object' &&
    Object.keys(data.simulatorsMeta).some(function (key) {
      var entry = data.simulatorsMeta[key];
      return entry && (entry.title || entry.description || entry.icon);
    });
  var showcase = data.showcaseStore || data.showcaseMeta || data.showcase;
  var hasShowcase =
    showcase &&
    typeof showcase === 'object' &&
    Object.keys(showcase).some(function (key) {
      if (key.charAt(0) === '_') return false;
      var entry = showcase[key];
      return entry && (entry.title || entry.description || entry.showcaseImage);
    });
  return !hasMeta && !hasShowcase;
}

function localBundleHasRichContent(bundle) {
  var b = normalizeBundle(bundle || readLocalBundle());
  var meta = b.simulatorsMeta || {};
  var hasCustomMeta = catalogIds().some(function (id) {
    var entry = meta[id];
    if (!entry) return false;
    if (entry.iconType === 'image') return true;
    if (entry.icon && String(entry.icon).indexOf('data:') === 0) return true;
    return false;
  });
  if (hasCustomMeta) return true;

  var showcase = b.showcaseStore || {};
  return Object.keys(showcase).some(function (key) {
    if (key.charAt(0) === '_') return false;
    var entry = showcase[key];
    return !!(entry && (entry.showcaseImage || entry.title || entry.description));
  });
}

function canAutoSeedFirestore() {
  var Auth = window.IFAAuth;
  if (!Auth || typeof Auth.isLoggedIn !== 'function' || !Auth.isLoggedIn()) return false;
  if (typeof Auth.isAdminUser !== 'function') return false;
  return Auth.isAdminUser(Auth.getAuthState().profile);
}

function formatFirestoreWriteError(err) {
  var code = err && err.code ? String(err.code) : '';
  if (code === 'permission-denied') {
    return 'رفض Firestore: حسابك لا يملك صلاحية المسؤول (admin) لكتابة settings/simulators';
  }
  if (code === 'unavailable') {
    return 'Firestore غير متاح حالياً — تحقق من الاتصال بالإنترنت';
  }
  if (code === 'invalid-argument' || code === 'failed-precondition') {
    return 'بيانات المحاكيات غير صالحة أو كبيرة جداً لـ Firestore (الحد ~1MB للمستند)';
  }
  var message = err && err.message ? String(err.message) : 'خطأ غير معروف';
  return 'فشل نشر المحاكيات إلى Firestore: ' + message;
}

function buildFirestorePayload(bundle) {
  var normalized = normalizeBundle(bundle);
  return {
    simulatorsMeta: normalized.simulatorsMeta,
    showcaseStore: normalized.showcaseStore,
    platformSettings: normalized.platformSettings,
    updatedAt: serverTimestamp(),
  };
}

async function writeBundleToFirestore(bundle) {
  var normalized = normalizeBundle(bundle);
  await setDoc(SIMULATORS_REF, buildFirestorePayload(normalized), { merge: true });
  cachedBundle = normalized;
  snapshotReady = true;
  needsSeed = false;
  return normalized;
}

/**
 * One-time / auto migration: publish admin browser cache (localStorage) to Firestore.
 * Callable from console: PlatformSimulatorsFirestore.migrateLocalCacheToFirestore({ force: true })
 */
export async function migrateLocalCacheToFirestore(options) {
  var opts = options && typeof options === 'object' ? options : {};
  if (seedInFlight) {
    return { ok: false, reason: 'in-flight' };
  }
  if (!canAutoSeedFirestore()) {
    return { ok: false, reason: 'not-admin' };
  }

  var local = readLocalBundle();
  var hasRichLocal = localBundleHasRichContent(local);
  if (!opts.force && !hasRichLocal && !needsSeed) {
    return { ok: false, reason: 'no-local-data' };
  }

  seedInFlight = true;
  try {
    var payload = hasRichLocal || localBundleHasRichContent(local) ? local : emptyBundle();
    var saved = await writeBundleToFirestore(payload);
    applyBundleToPlatform(saved);
    notifyListeners();
    if (!opts.silent) {
      console.info('[PlatformSimulatorsFirestore] migrated local cache to Firestore', saved);
    }
    return { ok: true, bundle: saved, migratedRichContent: hasRichLocal };
  } catch (err) {
    console.error('[PlatformSimulatorsFirestore] migration failed', err);
    return { ok: false, reason: 'write-failed', error: err, message: formatFirestoreWriteError(err) };
  } finally {
    seedInFlight = false;
  }
}

async function seedFromLocalOrDefaults() {
  if (!canAutoSeedFirestore()) return { ok: false, reason: 'not-admin' };
  var local = readLocalBundle();
  if (localBundleHasRichContent(local)) {
    return migrateLocalCacheToFirestore({ silent: true });
  }
  return migrateLocalCacheToFirestore({ silent: true, force: true });
}

function handleSnapshot(snap) {
  if (!snap.exists() || isDocumentEmpty(snap.data())) {
    needsSeed = true;
    var local = readLocalBundle();
    cachedBundle = local;
    snapshotReady = true;
    applyBundleToPlatform(local);
    notifyListeners();
    if (canAutoSeedFirestore()) {
      seedFromLocalOrDefaults();
    }
    return;
  }
  needsSeed = false;
  cachedBundle = normalizeBundle(snap.data());
  snapshotReady = true;
  applyBundleToPlatform(cachedBundle);
  notifyListeners();
}

export function getCachedSimulatorsBundle() {
  return normalizeBundle(cachedBundle || readLocalBundle());
}

export function isSimulatorsSnapshotReady() {
  return snapshotReady;
}

export function subscribeSimulators(callback) {
  if (typeof callback === 'function') {
    listeners.push(callback);
    if (snapshotReady) callback(getCachedSimulatorsBundle());
  }
  return function () {
    listeners = listeners.filter(function (fn) {
      return fn !== callback;
    });
  };
}

export function listenToSimulatorsMeta(callback) {
  return subscribeSimulators(callback);
}

export function whenSimulatorsFirestoreReady() {
  if (window.PlatformSimulatorsFirestore && typeof window.PlatformSimulatorsFirestore.saveSimulatorsBundle === 'function') {
    return Promise.resolve(window.PlatformSimulatorsFirestore);
  }
  if (window.__ifaSimulatorsFirestoreReady) {
    return window.__ifaSimulatorsFirestoreReady;
  }
  return Promise.resolve(window.PlatformSimulatorsFirestore || null);
}

export async function saveSimulatorMetaToFirestore(patch) {
  var current = getCachedSimulatorsBundle();
  var next = normalizeBundle({
    simulatorsMeta: mergeSimulatorsMetaPatch(current.simulatorsMeta, patch),
    showcaseStore: current.showcaseStore,
    platformSettings: current.platformSettings,
  });
  try {
    await writeBundleToFirestore(next);
  } catch (err) {
    var wrapped = new Error(formatFirestoreWriteError(err));
    wrapped.code = err && err.code;
    wrapped.cause = err;
    throw wrapped;
  }
  applyBundleToPlatform(next);
  notifyListeners();
  return next.simulatorsMeta;
}

export async function saveShowcaseMetaToFirestore(patch, intervalSeconds) {
  var current = getCachedSimulatorsBundle();
  var next = normalizeBundle({
    simulatorsMeta: current.simulatorsMeta,
    showcaseStore: mergeShowcasePatch(current.showcaseStore, patch, intervalSeconds),
    platformSettings: current.platformSettings,
  });
  try {
    await writeBundleToFirestore(next);
  } catch (err) {
    var wrapped = new Error(formatFirestoreWriteError(err));
    wrapped.code = err && err.code;
    wrapped.cause = err;
    throw wrapped;
  }
  applyBundleToPlatform(next);
  notifyListeners();
  return next.showcaseStore;
}

export async function saveSimulatorsBundle(payload) {
  var current = getCachedSimulatorsBundle();
  var incoming = payload && typeof payload === 'object' ? payload : {};
  var next = normalizeBundle({
    simulatorsMeta: incoming.simulatorsMeta
      ? mergeSimulatorsMetaPatch(current.simulatorsMeta, incoming.simulatorsMeta)
      : current.simulatorsMeta,
    showcaseStore: mergeShowcasePatch(
      current.showcaseStore,
      incoming.showcaseMeta || incoming.showcasePatch || incoming.showcaseStore,
      incoming.showcaseIntervalSeconds != null
        ? incoming.showcaseIntervalSeconds
        : incoming.intervalSeconds
    ),
    platformSettings: incoming.platformSettings
      ? normalizePlatformSettings(Object.assign({}, current.platformSettings, incoming.platformSettings))
      : current.platformSettings,
  });
  try {
    await writeBundleToFirestore(next);
  } catch (err) {
    var wrapped = new Error(formatFirestoreWriteError(err));
    wrapped.code = err && err.code;
    wrapped.cause = err;
    throw wrapped;
  }
  applyBundleToPlatform(next);
  notifyListeners();
  return next;
}

export function startSimulatorsFirestoreSync() {
  if (unsubscribeSnapshot) return unsubscribeSnapshot;
  unsubscribeSnapshot = onSnapshot(
    SIMULATORS_REF,
    handleSnapshot,
    function (err) {
      console.error('[PlatformSimulatorsFirestore] onSnapshot failed', err);
      cachedBundle = readLocalBundle();
      snapshotReady = true;
      applyBundleToPlatform(cachedBundle);
      notifyListeners();
    }
  );
  return unsubscribeSnapshot;
}

window.addEventListener('ifa:auth-changed', function (e) {
  var detail = (e && e.detail) || {};
  if (detail.profileSynced && needsSeed) {
    seedFromLocalOrDefaults();
  }
});

var api = {
  subscribe: subscribeSimulators,
  listenToSimulatorsMeta: listenToSimulatorsMeta,
  whenReady: whenSimulatorsFirestoreReady,
  getCachedSimulatorsBundle: getCachedSimulatorsBundle,
  isReady: isSimulatorsSnapshotReady,
  saveSimulatorMetaToFirestore: saveSimulatorMetaToFirestore,
  saveShowcaseMetaToFirestore: saveShowcaseMetaToFirestore,
  saveSimulatorsBundle: saveSimulatorsBundle,
  migrateLocalCacheToFirestore: migrateLocalCacheToFirestore,
  formatFirestoreWriteError: formatFirestoreWriteError,
  start: startSimulatorsFirestoreSync,
};

window.PlatformSimulatorsFirestore = api;
startSimulatorsFirestoreSync();

if (typeof window.__ifaSimulatorsFirestoreReadyResolve === 'function') {
  window.__ifaSimulatorsFirestoreReadyResolve(api);
}

export default api;
