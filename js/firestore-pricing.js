/**
 * Firestore real-time sync for public pricing plans (collection: `pricing`).
 * Deploy rules: firebase deploy --only firestore:rules
 */
import { db } from './firebase-config.js';
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

var COLLECTION = 'pricing';
var cachedPlans = [];
var snapshotReady = false;
var listeners = [];
var unsubscribeSnapshot = null;

function normalizePlan(raw, docId) {
  if (window.PlatformPlans && typeof window.PlatformPlans.normalizePlan === 'function') {
    return window.PlatformPlans.normalizePlan(Object.assign({}, raw, { id: docId || raw.id }));
  }
  return Object.assign({}, raw, { id: docId || raw.id || '' });
}

function sortPlans(list) {
  return (list || []).slice().sort(function (a, b) {
    return (a.sortOrder || 0) - (b.sortOrder || 0);
  });
}

function stripUndefined(obj) {
  var out = {};
  Object.keys(obj || {}).forEach(function (key) {
    if (obj[key] !== undefined) out[key] = obj[key];
  });
  return out;
}

function preparePayload(payload, existing) {
  var base = Object.assign({}, existing || {}, payload || {});
  var normalized = normalizePlan(base, existing && existing.id);
  if (!normalized) throw new Error('بيانات الباقة غير صالحة');
  if (!normalized.name) throw new Error('اسم الباقة مطلوب');
  delete normalized.id;
  return stripUndefined(normalized);
}

function notifyListeners() {
  var plans = cachedPlans.slice();
  listeners.forEach(function (fn) {
    try {
      fn(plans);
    } catch (err) {
      console.error('[PricingFirestore] listener failed', err);
    }
  });
  try {
    var detail = { plans: plans, count: plans.length };
    window.dispatchEvent(new CustomEvent('ifa:pricing-firestore-changed', { detail: detail }));
    document.dispatchEvent(new CustomEvent('ifa:pricing-firestore-changed', { detail: detail }));
    window.dispatchEvent(new CustomEvent('ifa:platform-plans-changed', { detail: detail }));
    document.dispatchEvent(new CustomEvent('ifa:platform-plans-changed', { detail: detail }));
  } catch (err) {
    /* ignore */
  }
  if (typeof window.renderPublicPlans === 'function') {
    window.renderPublicPlans();
  }
}

function handleSnapshot(snap) {
  cachedPlans = sortPlans(
    snap.docs.map(function (docSnap) {
      return normalizePlan(docSnap.data(), docSnap.id);
    })
  );
  snapshotReady = true;
  notifyListeners();
}

export function subscribePricingPlans(callback) {
  if (typeof callback === 'function') {
    listeners.push(callback);
    if (snapshotReady) callback(cachedPlans.slice());
  }
  return function () {
    listeners = listeners.filter(function (fn) {
      return fn !== callback;
    });
  };
}

export function getCachedPricingPlans() {
  return cachedPlans.slice();
}

export function isPricingSnapshotReady() {
  return snapshotReady;
}

export function findCachedPricingPlan(id) {
  var key = String(id || '');
  if (!key) return null;
  for (var i = 0; i < cachedPlans.length; i++) {
    if (String(cachedPlans[i].id) === key) return cachedPlans[i];
  }
  return null;
}

export async function addPricingPlan(payload) {
  var now = new Date().toISOString();
  var prepared = preparePayload(
    Object.assign({}, payload, {
      sortOrder: isFinite(Number(payload && payload.sortOrder))
        ? Number(payload.sortOrder)
        : cachedPlans.length,
      createdAt: now,
      updatedAt: now,
    })
  );
  var ref = await addDoc(collection(db, COLLECTION), prepared);
  return ref.id;
}

export async function updatePricingPlan(id, payload) {
  var key = String(id || '').trim();
  if (!key) throw new Error('معرّف الباقة غير صالح');
  var existing = findCachedPricingPlan(key);
  var prepared = preparePayload(
    Object.assign({}, payload, { updatedAt: new Date().toISOString() }),
    existing
  );
  await updateDoc(doc(db, COLLECTION, key), prepared);
  return key;
}

export async function deletePricingPlan(id) {
  var key = String(id || '').trim();
  if (!key) throw new Error('معرّف الباقة غير صالح');
  await deleteDoc(doc(db, COLLECTION, key));
  return true;
}

export function startPricingFirestoreSync() {
  if (unsubscribeSnapshot) return unsubscribeSnapshot;
  unsubscribeSnapshot = onSnapshot(
    collection(db, COLLECTION),
    handleSnapshot,
    function (err) {
      console.error('[PricingFirestore] onSnapshot failed', err);
    }
  );
  return unsubscribeSnapshot;
}

var api = {
  subscribe: subscribePricingPlans,
  getCachedPlans: getCachedPricingPlans,
  isReady: isPricingSnapshotReady,
  findPlan: findCachedPricingPlan,
  addPlan: addPricingPlan,
  updatePlan: updatePricingPlan,
  deletePlan: deletePricingPlan,
  start: startPricingFirestoreSync,
};

window.PlatformPricingFirestore = api;
startPricingFirestoreSync();

export default api;
