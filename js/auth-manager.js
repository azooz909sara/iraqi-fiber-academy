/**
 * Google Sign-In UI + Firebase Auth state (ES module).
 * Mount points: elements with [data-auth-slot] in index.html / simulator.html.
 */
import { auth, provider } from './firebase-config.js';
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { syncUserProfile } from './db-manager.js';

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getFirstName(user) {
  var full = (user && (user.displayName || user.email)) || 'User';
  return String(full).trim().split(/\s+/)[0] || 'User';
}

function slotVariant(slot) {
  return (slot && slot.getAttribute('data-auth-variant')) || 'landing';
}

function loggedOutHtml(variant) {
  if (variant === 'simulator') {
    return (
      '<button type="button" class="auth-login-btn auth-login-btn--sim" data-auth-login>' +
      'تسجيل الدخول' +
      '</button>'
    );
  }
  return (
    '<a href="#" class="header__login" data-auth-login role="button">تسجيل الدخول</a>'
  );
}

function loggedInHtml(user, variant) {
  var name = escapeHtml(getFirstName(user));
  var photo = user && user.photoURL ? escapeHtml(user.photoURL) : '';
  var avatar = photo
    ? '<img class="auth-user__avatar" src="' + photo + '" alt="" width="28" height="28" referrerpolicy="no-referrer" />'
    : '<span class="auth-user__avatar auth-user__avatar--fallback" aria-hidden="true">' +
      name.charAt(0) +
      '</span>';

  if (variant === 'simulator') {
    return (
      '<div class="auth-user auth-user--sim" role="group" aria-label="Account">' +
      avatar +
      '<span class="auth-user__name">' + name + '</span>' +
      '<button type="button" class="auth-logout-btn auth-logout-btn--sim" data-auth-logout>تسجيل الخروج</button>' +
      '</div>'
    );
  }

  return (
    '<div class="auth-user" role="group" aria-label="الحساب">' +
    avatar +
    '<span class="auth-user__name">' + name + '</span>' +
    '<a href="#" class="auth-logout-link" data-auth-logout role="button">تسجيل الخروج</a>' +
    '</div>'
  );
}

function renderAuthSlot(slot, user) {
  if (!slot) return;
  var variant = slotVariant(slot);
  slot.innerHTML = user ? loggedInHtml(user, variant) : loggedOutHtml(variant);
}

export async function loginWithGoogle() {
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (err && (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request')) {
      return;
    }
    console.error('[Auth] Google sign-in failed:', err);
    alert('تعذر تسجيل الدخول عبر Google. حاول مرة أخرى.');
  }
}

export async function logoutUser() {
  try {
    await signOut(auth);
  } catch (err) {
    console.error('[Auth] Sign-out failed:', err);
    alert('تعذر تسجيل الخروج. حاول مرة أخرى.');
  }
}

function bindAuthClicks() {
  document.addEventListener('click', function (e) {
    var loginEl = e.target && e.target.closest ? e.target.closest('[data-auth-login]') : null;
    if (loginEl) {
      e.preventDefault();
      loginWithGoogle();
      return;
    }
    var logoutEl = e.target && e.target.closest ? e.target.closest('[data-auth-logout]') : null;
    if (logoutEl) {
      e.preventDefault();
      logoutUser();
    }
  });
}

function initAuthUI() {
  bindAuthClicks();
  var slots = document.querySelectorAll('[data-auth-slot]');
  onAuthStateChanged(auth, function (user) {
    slots.forEach(function (slot) {
      renderAuthSlot(slot, user);
    });

    if (user) {
      syncUserProfile(user).catch(function (err) {
        console.error('[Auth] syncUserProfile failed:', err);
      });
    }
  });
}

initAuthUI();
