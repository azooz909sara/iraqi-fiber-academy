/**
 * Cloud Firestore user profiles & subscriber flags.
 *
 * FIRST ADMIN SETUP (one-time):
 * 1. Sign up / sign in once so users/{uid} exists.
 * 2. Firebase Console → Firestore Database → users → open your document (doc id = Auth uid).
 * 3. Set field `role` to `admin` (string). Save.
 * 4. Sign out and back in (or refresh) so the client picks up the new role.
 */
import { db } from './firebase-config.js';
import {
  doc,
  getDoc,
  setDoc,
  runTransaction,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

function normalizeTrialConsumptionDocId(canvasHash) {
  var id = String(canvasHash || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 500);
  return id || '';
}

function buildDefaultUserProfile(user) {
  return {
    uid: user.uid,
    name: user.displayName || '',
    email: user.email || '',
    photoURL: user.photoURL || '',
    photo: user.photoURL || '',
    isSubscriber: false,
    isAdmin: false,
    role: 'user',
    createdAt: new Date().toISOString(),
  };
}

/**
 * Ensure users/{uid} exists (safe for first-time Google / redirect sign-in).
 * Firestore rules require role === 'user' on create.
 * @param {import('firebase/auth').User} user
 * @returns {Promise<object|null>}
 */
export async function ensureUserProfileDocument(user) {
  if (!user || !user.uid) return null;

  var ref = doc(db, 'users', user.uid);
  var snap = await getDoc(ref);
  if (snap.exists()) {
    return snap.data();
  }

  var profile = buildDefaultUserProfile(user);
  await setDoc(ref, profile);
  return profile;
}

/**
 * Create users/{uid} immediately after Email/Password sign-up.
 * @param {import('firebase/auth').User} user
 * @returns {Promise<object|null>}
 */
export async function createUserProfileOnSignUp(user) {
  if (!user || !user.uid) return null;
  return ensureUserProfileDocument(user);
}

/**
 * @param {string} uid
 * @returns {Promise<object|null>}
 */
export async function fetchUserProfile(uid) {
  if (!uid) return null;
  var snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? snap.data() : null;
}

/**
 * Ensure users/{uid} exists; create a default non-subscriber profile if missing.
 * @param {import('firebase/auth').User} user
 * @returns {Promise<object|null>}
 */
export async function syncUserProfile(user) {
  return ensureUserProfileDocument(user);
}

/**
 * Minimal users/{uid} stub when only uid is known (entitlements / settings merge).
 * @param {string} uid
 * @returns {Promise<void>}
 */
export async function ensureUserDocExistsForUid(uid) {
  if (!uid) return;
  var ref = doc(db, 'users', uid);
  var snap = await getDoc(ref);
  if (snap.exists()) return;
  await setDoc(ref, {
    uid: uid,
    role: 'user',
    isSubscriber: false,
    createdAt: new Date().toISOString(),
  });
}

/**
 * @param {string} uid
 * @returns {Promise<boolean>}
 */
export async function checkSubscriberStatus(uid) {
  if (!uid) return false;
  var snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return false;
  var data = snap.data() || {};
  return data.isSubscriber === true;
}

/**
 * @param {string} uid
 * @returns {Promise<string[]>}
 */
export async function getUserAllowedSimulators(uid) {
  if (!uid) return [];
  var snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return [];
  var data = snap.data() || {};
  if (!Array.isArray(data.allowedSimulators)) return [];
  return data.allowedSimulators
    .map(function (id) {
      return String(id || '').trim();
    })
    .filter(Boolean);
}

/**
 * @param {string} uid
 * @param {string} simulatorId
 * @returns {Promise<boolean>}
 */
export async function checkSimulatorAccess(uid, simulatorId) {
  if (!uid || !simulatorId) return false;
  var allowed = await getUserAllowedSimulators(uid);
  return allowed.indexOf(String(simulatorId)) !== -1;
}

/**
 * @param {string} uid
 * @returns {Promise<boolean>}
 */
export async function checkAdminStatus(uid) {
  if (!uid) return false;
  var snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return false;
  var data = snap.data() || {};
  return String(data.role || '') === 'admin';
}

/**
 * Global device trial lock (canvas fingerprint). One trial per fingerprint across profiles.
 * @param {string} canvasHash
 * @param {string} uid
 * @returns {Promise<boolean>} true if registered and trial may be granted; false if already consumed
 */
export async function checkAndRegisterDeviceTrial(canvasHash, uid) {
  var hashId = normalizeTrialConsumptionDocId(canvasHash);
  if (!hashId || !uid) return false;

  var ref = doc(db, 'trialConsumptions', hashId);
  try {
    return await runTransaction(db, async function (transaction) {
      var snap = await transaction.get(ref);
      if (snap.exists()) return false;
      transaction.set(ref, {
        uid: String(uid),
        createdAt: serverTimestamp(),
      });
      return true;
    });
  } catch (err) {
    console.error('[db-manager] checkAndRegisterDeviceTrial failed:', err);
    return false;
  }
}
