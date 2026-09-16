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
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

/**
 * Create users/{uid} immediately after Email/Password sign-up.
 * @param {import('firebase/auth').User} user
 * @returns {Promise<object|null>}
 */
export async function createUserProfileOnSignUp(user) {
  if (!user || !user.uid) return null;

  var profile = {
    uid: user.uid,
    email: user.email || null,
    role: 'user',
    createdAt: new Date(),
  };

  await setDoc(doc(db, 'users', user.uid), profile);
  return profile;
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
  if (!user || !user.uid) return null;

  var ref = doc(db, 'users', user.uid);
  var snap = await getDoc(ref);

  if (snap.exists()) {
    return snap.data();
  }

  var profile = {
    uid: user.uid,
    email: user.email || null,
    name: user.displayName || null,
    photo: user.photoURL || null,
    isSubscriber: false,
    isAdmin: false,
    role: 'user',
    createdAt: new Date(),
  };

  await setDoc(ref, profile);
  return profile;
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
