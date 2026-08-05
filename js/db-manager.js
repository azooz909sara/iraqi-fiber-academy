/**
 * Cloud Firestore user profiles & subscriber flags.
 */
import { db } from './firebase-config.js';
import {
  doc,
  getDoc,
  setDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

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
