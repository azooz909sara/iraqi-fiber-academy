/**
 * Firebase app + Auth + Firestore (ES module).
 * Iraqi Fiber Academy — Google Sign-In & subscriber profiles.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCA_FPwBFwbuQrwBgiT88Uu5HzxZA_7UDY',
  authDomain: 'iraqi-fiber-academy.firebaseapp.com',
  projectId: 'iraqi-fiber-academy',
  storageBucket: 'iraqi-fiber-academy.firebasestorage.app',
  messagingSenderId: '679037485945',
  appId: '1:679037485945:web:ae91390e54e2fcbc6ae5a8',
  measurementId: 'G-VQGHF0KJFL',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const db = getFirestore(app);
