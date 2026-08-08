/**
 * Google Sign-In UI + Firebase Auth state (ES module).
 * Mount points: elements with [data-auth-slot] in index.html / simulator.html.
 *
 * Landing profile dropdown:
 * - Guest: Profile toggle → dropdown with "تسجيل الدخول" only
 * - Authenticated: name + email/status at top, role links, "تسجيل خروج" at bottom
 * Local session mirror in localStorage (`ifa_auth_user`) for instant UI toggle / file:// fallback.
 */
import { auth, provider } from './firebase-config.js';
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { syncUserProfile } from './db-manager.js';

/** Hard allow-list for admin dashboard access (normalized lowercase). */
var ADMIN_EMAILS = ['abdulazizyassin909@gmail.com'];
var LOCAL_AUTH_KEY = 'ifa_auth_user';

var slots = [];
var lastUser = null;
var lastProfile = null;
var refreshSlots = function () {};

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function getLocalAuthUser() {
  try {
    var raw = localStorage.getItem(LOCAL_AUTH_KEY);
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    if (!parsed || !normalizeEmail(parsed.email)) return null;
    return {
      name: String(parsed.name || '').trim() || String(parsed.email).split('@')[0],
      email: normalizeEmail(parsed.email),
      photoURL: String(parsed.photoURL || ''),
      isSubscriber: !!parsed.isSubscriber,
      isAdmin: !!parsed.isAdmin,
      isInstructor: !!parsed.isInstructor,
      role: String(parsed.role || ''),
    };
  } catch (err) {
    return null;
  }
}

function setLocalAuthUser(user) {
  if (!user || !normalizeEmail(user.email)) return;
  var payload = {
    name: String(user.name || user.displayName || '').trim() || normalizeEmail(user.email).split('@')[0],
    email: normalizeEmail(user.email),
    photoURL: String(user.photoURL || ''),
    isSubscriber: !!user.isSubscriber,
    isAdmin: !!user.isAdmin,
    isInstructor: !!user.isInstructor,
    role: String(user.role || ''),
    loggedInAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(LOCAL_AUTH_KEY, JSON.stringify(payload));
  } catch (err) {
    console.error('[Auth] local auth save failed', err);
  }
  if (window.InstructorApps && typeof window.InstructorApps.setSessionEmail === 'function') {
    window.InstructorApps.setSessionEmail(payload.email);
  }
  try {
    localStorage.setItem('ifa_session_email', payload.email);
  } catch (err2) {
    /* ignore */
  }
  return payload;
}

function clearLocalAuthUser() {
  try {
    localStorage.removeItem(LOCAL_AUTH_KEY);
  } catch (err) {
    /* ignore */
  }
  try {
    localStorage.removeItem('ifa_session_email');
  } catch (err2) {
    /* ignore */
  }
}

function notifyLocalAuthChanged(detail) {
  try {
    window.dispatchEvent(new CustomEvent('ifa:local-auth-changed', { detail: detail || {} }));
  } catch (err) {
    /* ignore */
  }
}

function getFirstName(user) {
  var full = (user && (user.displayName || user.name || user.email)) || 'User';
  return String(full).trim().split(/\s+/)[0] || 'User';
}

function getFullName(user, profile) {
  if (profile && profile.name) return String(profile.name).trim();
  if (user && user.displayName) return String(user.displayName).trim();
  if (user && user.name) return String(user.name).trim();
  if (user && user.email) return String(user.email).trim();
  return 'مستخدم';
}

function getSubscriptionLabel(profile) {
  if (profile && profile.isSubscriber === true) return 'مشترك نشط';
  return 'غير مشترك';
}

function readLocalSessionEmail() {
  try {
    var local = getLocalAuthUser();
    if (local && local.email) return local.email;
    var Apps = typeof window !== 'undefined' ? window.InstructorApps : null;
    if (Apps && typeof Apps.getSessionEmail === 'function') {
      var fromApps = normalizeEmail(Apps.getSessionEmail());
      if (fromApps) return fromApps;
    }
    var keys = ['ifa_session_email', 'approvedInstructorEmail', 'ifa_user_email', 'currentUserEmail'];
    for (var i = 0; i < keys.length; i++) {
      var v = normalizeEmail(localStorage.getItem(keys[i]));
      if (v) return v;
    }
  } catch (err) {
    /* ignore */
  }
  return '';
}

function isAdminEmail(email) {
  var key = normalizeEmail(email);
  if (!key) return false;
  for (var i = 0; i < ADMIN_EMAILS.length; i++) {
    if (key === ADMIN_EMAILS[i]) return true;
  }
  return false;
}

function isAdminUser(profile, email) {
  var resolved = normalizeEmail(email || (profile && profile.email) || '');
  if (isAdminEmail(resolved)) return true;
  if (!profile) return false;
  if (profile.isAdmin === true) return true;
  if (String(profile.role || '').toLowerCase() === 'admin') return true;
  return false;
}

function isInstructorUser(profile, email) {
  var Apps = typeof window !== 'undefined' ? window.InstructorApps : null;
  var checkEmail = normalizeEmail(
    email ||
      (profile && profile.email) ||
      (Apps && Apps.getSessionEmail ? Apps.getSessionEmail() : '') ||
      readLocalSessionEmail()
  );

  if (isAdminUser(profile, checkEmail)) return true;

  if (profile && (profile.isInstructor === true || String(profile.role || '').toLowerCase() === 'instructor')) {
    return true;
  }

  if (!Apps || !checkEmail) return false;

  if (typeof Apps.isApprovedInstructor === 'function' && Apps.isApprovedInstructor(checkEmail)) {
    return true;
  }

  if (
    typeof Apps.getInstructorApprovedFlag === 'function' &&
    Apps.getInstructorApprovedFlag() &&
    typeof Apps.getApprovedInstructorEmail === 'function'
  ) {
    return normalizeEmail(Apps.getApprovedInstructorEmail()) === checkEmail;
  }

  return false;
}

function resolveMenuEmail(user, profile) {
  if (user && user.email) return user.email;
  if (profile && profile.email) return profile.email;
  return readLocalSessionEmail();
}

function slotVariant(slot) {
  return (slot && slot.getAttribute('data-auth-variant')) || 'landing';
}

function avatarHtml(user, firstName) {
  var photo = user && user.photoURL ? escapeHtml(user.photoURL) : '';
  if (photo) {
    return (
      '<img class="user-menu__avatar" src="' +
      photo +
      '" alt="" width="28" height="28" referrerpolicy="no-referrer" />'
    );
  }
  return (
    '<span class="user-menu__avatar" aria-hidden="true">' +
    escapeHtml(firstName.charAt(0)) +
    '</span>'
  );
}

function simAvatarHtml(user, firstName) {
  var photo = user && user.photoURL ? escapeHtml(user.photoURL) : '';
  if (photo) {
    return (
      '<img class="auth-user__avatar" src="' +
      photo +
      '" alt="" width="28" height="28" referrerpolicy="no-referrer" />'
    );
  }
  return (
    '<span class="auth-user__avatar auth-user__avatar--fallback" aria-hidden="true">' +
    escapeHtml(firstName.charAt(0)) +
    '</span>'
  );
}

function accountToggleHtml(avatarInner) {
  return (
    '<button type="button" class="user-menu__toggle" id="userMenuToggle" ' +
      'aria-expanded="false" aria-haspopup="true" aria-controls="userMenuDropdown">' +
      avatarInner +
      '<span class="user-menu__label">الحساب</span>' +
      '<svg class="user-menu__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="2.5" aria-hidden="true">' +
        '<path d="M6 9l6 6 6-6"/>' +
      '</svg>' +
    '</button>'
  );
}

function guestMenuHtml() {
  return (
    '<div class="user-menu" id="userMenu" data-auth-guest="1">' +
      accountToggleHtml('<span class="user-menu__avatar" aria-hidden="true">?</span>') +
      '<div class="user-menu__dropdown" id="userMenuDropdown" role="menu" hidden>' +
        '<button type="button" class="user-menu__item user-menu__item--login" role="menuitem" data-auth-login>' +
          'تسجيل الدخول' +
        '</button>' +
      '</div>' +
    '</div>'
  );
}

function userMenuHtml(options) {
  var fullName = escapeHtml(options.fullName || 'مستخدم');
  var email = escapeHtml(options.email || '');
  var isAdmin = options.isAdmin === true;
  var isInstructor = options.isInstructor === true;
  var avatar =
    options.avatarHtml ||
    '<span class="user-menu__avatar" aria-hidden="true">' +
      escapeHtml((options.fullName || 'م').charAt(0)) +
      '</span>';

  var menuClasses = 'user-menu';
  if (isAdmin) menuClasses += ' is-admin';
  if (isInstructor) menuClasses += ' is-instructor';

  var instructorItem = isInstructor
    ? '<a href="instructor.html" class="user-menu__item user-menu__item--instructor" role="menuitem">لوحة المدرب</a>'
    : '';

  var adminItem = isAdmin
    ? '<a href="admin.html" class="user-menu__item user-menu__item--admin" role="menuitem" data-admin-only>لوحة الإدارة</a>'
    : '';

  /* Always shown when logged in (per account-menu workflow) */
  var joinItem =
    '<a href="#" class="user-menu__item user-menu__item--join" role="menuitem" data-join-instructor>' +
    'انضم إلينا كمدرب' +
    '</a>';

  var midItems = instructorItem + adminItem + joinItem;

  return (
    '<div class="' +
    menuClasses +
    '" id="userMenu">' +
    accountToggleHtml(avatar) +
    '<div class="user-menu__dropdown" id="userMenuDropdown" role="menu" hidden>' +
    '<div class="user-menu__info" role="none">' +
    '<span class="user-menu__info-name">' +
    fullName +
    '</span>' +
    (email ? '<span class="user-menu__info-email" dir="ltr">' + email + '</span>' : '') +
    '</div>' +
    '<div class="user-menu__divider" role="separator"></div>' +
    midItems +
    '<div class="user-menu__divider" role="separator"></div>' +
    '<a href="#" class="user-menu__item user-menu__item--logout" role="menuitem" data-auth-logout>تسجيل خروج</a>' +
    '</div>' +
    '</div>'
  );
}

function loggedOutHtml(variant) {
  if (variant === 'simulator') {
    return (
      '<button type="button" class="auth-login-btn auth-login-btn--sim" data-auth-login>' +
      'تسجيل الدخول' +
      '</button>'
    );
  }
  return guestMenuHtml();
}

function loggedInHtml(user, variant, profile) {
  var firstName = getFirstName(user);

  if (variant === 'simulator') {
    return (
      '<div class="auth-user auth-user--sim" role="group" aria-label="Account">' +
      simAvatarHtml(user, firstName) +
      '<span class="auth-user__name">' +
      escapeHtml(firstName) +
      '</span>' +
      '<button type="button" class="auth-logout-btn auth-logout-btn--sim" data-auth-logout>تسجيل الخروج</button>' +
      '</div>'
    );
  }

  var email = resolveMenuEmail(user, profile);
  return userMenuHtml({
    fullName: getFullName(user, profile),
    email: email,
    avatarHtml: avatarHtml(user, firstName),
    isAdmin: isAdminUser(profile, email),
    isInstructor: isInstructorUser(profile, email),
  });
}

function resolveActiveIdentity() {
  if (lastUser) {
    return { user: lastUser, profile: lastProfile || null, source: 'firebase' };
  }
  var local = getLocalAuthUser();
  if (local) {
    return {
      user: {
        displayName: local.name,
        name: local.name,
        email: local.email,
        photoURL: local.photoURL,
      },
      profile: {
        name: local.name,
        email: local.email,
        isSubscriber: local.isSubscriber,
        isAdmin: local.isAdmin,
        isInstructor: local.isInstructor,
        role: local.role,
      },
      source: 'local',
    };
  }
  return { user: null, profile: null, source: 'none' };
}

function renderAuthSlot(slot) {
  if (!slot) return;
  var variant = slotVariant(slot);
  var identity = resolveActiveIdentity();
  slot.innerHTML = identity.user
    ? loggedInHtml(identity.user, variant, identity.profile)
    : loggedOutHtml(variant);
}

function openUserMenuDropdown() {
  var menu = document.getElementById('userMenu');
  if (!menu) return;
  var toggle = menu.querySelector('.user-menu__toggle');
  var drop = menu.querySelector('.user-menu__dropdown');
  menu.classList.add('open');
  if (toggle) toggle.setAttribute('aria-expanded', 'true');
  if (drop) drop.hidden = false;
}

function nameFromEmail(email) {
  var namePart = String(email || '')
    .split('@')[0]
    .replace(/[._]/g, ' ');
  return namePart
    .split(/\s+/)
    .filter(Boolean)
    .map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

/** Instant localStorage login used by the landing account menu. */
function loginLocalSession(options) {
  options = options || {};
  var email = normalizeEmail(options.email || readLocalSessionEmail() || 'user@fiberacademy.iq');
  if (!email || email.indexOf('@') === -1) {
    email = 'user@fiberacademy.iq';
  }
  var name = String(options.name || '').trim() || nameFromEmail(email) || 'مستخدم';
  setLocalAuthUser({
    name: name,
    email: email,
    photoURL: options.photoURL || '',
    isSubscriber: !!options.isSubscriber,
    isAdmin: options.isAdmin === true || isAdminEmail(email),
    isInstructor: !!options.isInstructor,
    role: options.role || (isAdminEmail(email) ? 'admin' : 'student'),
  });
  refreshSlots();
  notifyLocalAuthChanged({ type: 'login', email: email });
  openUserMenuDropdown();
  return email;
}

function simulateLocalLogin() {
  var preset = readLocalSessionEmail() || 'user@fiberacademy.iq';
  var email = window.prompt('أدخل بريدك الإلكتروني لتسجيل الدخول:', preset);
  if (email == null) return;
  email = normalizeEmail(email);
  if (!email || email.indexOf('@') === -1) {
    alert('يرجى إدخال بريد إلكتروني صالح.');
    return;
  }
  loginLocalSession({ email: email });
}

export async function loginWithGoogle() {
  try {
    var result = await signInWithPopup(auth, provider);
    if (result && result.user) {
      loginLocalSession({
        name: result.user.displayName || '',
        email: result.user.email || '',
        photoURL: result.user.photoURL || '',
      });
    }
  } catch (err) {
    if (err && (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request')) {
      return;
    }
    console.warn('[Auth] Google sign-in unavailable — using local session', err);
    if (!getLocalAuthUser()) simulateLocalLogin();
  }
}

/** Landing menu: flip to logged-in via localStorage and re-render instantly. */
function handleMenuSignIn() {
  if (getLocalAuthUser() || lastUser) {
    refreshSlots();
    openUserMenuDropdown();
    return;
  }
  loginLocalSession();
}

export async function logoutUser() {
  clearLocalAuthUser();
  lastUser = null;
  lastProfile = null;
  refreshSlots();
  notifyLocalAuthChanged({ type: 'logout' });
  openUserMenuDropdown();

  try {
    if (auth.currentUser) {
      await signOut(auth);
    }
  } catch (err) {
    console.error('[Auth] Sign-out failed:', err);
  }
}

function bindAuthClicks() {
  document.addEventListener('click', function (e) {
    var loginEl = e.target && e.target.closest ? e.target.closest('[data-auth-login]') : null;
    if (loginEl) {
      e.preventDefault();
      e.stopPropagation();
      var slot = loginEl.closest('[data-auth-slot]');
      var variant = slotVariant(slot);
      if (variant === 'simulator') {
        loginWithGoogle();
      } else {
        handleMenuSignIn();
      }
      return;
    }
    var logoutEl = e.target && e.target.closest ? e.target.closest('[data-auth-logout]') : null;
    if (logoutEl) {
      e.preventDefault();
      e.stopPropagation();
      logoutUser();
    }
  });
}

function initAuthUI() {
  bindAuthClicks();
  slots = Array.prototype.slice.call(document.querySelectorAll('[data-auth-slot]'));

  refreshSlots = function () {
    if (window.InstructorApps && window.InstructorApps.absorbApprovalFromUrl) {
      window.InstructorApps.absorbApprovalFromUrl();
    }
    slots.forEach(function (slot) {
      renderAuthSlot(slot);
    });
  };

  refreshSlots();

  onAuthStateChanged(auth, function (user) {
    lastUser = user || null;
    if (!user) {
      lastProfile = null;
      /* Keep local session if Firebase signed out but local auth still set */
      refreshSlots();
      notifyLocalAuthChanged({ type: getLocalAuthUser() ? 'local-session' : 'logout' });
      return;
    }

    var email = normalizeEmail(user.email || '');
    setLocalAuthUser({
      name: user.displayName || '',
      email: email,
      photoURL: user.photoURL || '',
      isAdmin: isAdminEmail(email),
      role: isAdminEmail(email) ? 'admin' : 'student',
    });
    refreshSlots();
    notifyLocalAuthChanged({ type: 'login', email: email });

    syncUserProfile(user)
      .then(function (profile) {
        lastProfile = profile;
        if (profile && profile.email) {
          setLocalAuthUser({
            name: profile.name || user.displayName || '',
            email: profile.email || user.email || '',
            photoURL: user.photoURL || profile.photo || '',
            isSubscriber: !!profile.isSubscriber,
            isAdmin: !!profile.isAdmin || isAdminEmail(profile.email || user.email),
            isInstructor: !!profile.isInstructor,
            role: profile.role || '',
          });
        }
        refreshSlots();
        notifyLocalAuthChanged({ type: 'profile-sync', email: email });
      })
      .catch(function (err) {
        console.error('[Auth] syncUserProfile failed:', err);
      });
  });

  document.addEventListener('ifa:instructor-application-submitted', refreshSlots);
  document.addEventListener('ifa:instructor-status-changed', refreshSlots);
  window.addEventListener('storage', function (e) {
    if (
      !e.key ||
      e.key === LOCAL_AUTH_KEY ||
      e.key === 'ifa_instructor_applications' ||
      e.key === 'ifa_approved_instructors' ||
      e.key === 'ifa_session_email' ||
      e.key === 'isInstructorApproved' ||
      e.key === 'approvedInstructorEmail' ||
      e.key === 'ifa_instructor_last_action' ||
      e.key.indexOf('ifa_instructor_status_') === 0
    ) {
      refreshSlots();
    }
  });
  window.addEventListener('focus', refreshSlots);
  window.addEventListener('pageshow', refreshSlots);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') refreshSlots();
  });
}

initAuthUI();
