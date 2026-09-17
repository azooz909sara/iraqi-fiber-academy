/**
 * Firebase Auth (Email/Password + Google) + header UI (ES module).
 * Mount points: elements with [data-auth-slot] in index.html / simulator pages.
 *
 * Guest: "تسجيل الدخول" button → auth modal (login / sign-up).
 * Authenticated: profile dropdown with email + "تسجيل خروج".
 * Local session mirror in localStorage (`ifa_auth_user`) for profile fields / route guards.
 */
import { auth, provider } from './firebase-config.js';
import {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { syncUserProfile, createUserProfileOnSignUp } from './db-manager.js';

/**
 * RBAC: admin access is granted only when Firestore users/{uid}.role === 'admin'.
 * See js/db-manager.js for first-time admin promotion steps in Firebase Console.
 */
console.info(
  '[IFA Auth] RBAC: promote your account in Firestore → users/{uid} → set role field to "admin"'
);
var LOCAL_AUTH_KEY = 'ifa_auth_user';
var LOCAL_DEV_EMAIL = 'abdulazizyassin909@gmail.com';

var slots = [];
var lastUser = null;
var lastProfile = null;
var refreshSlots = function () {};
var authChangeListeners = [];
var authModalMode = 'login';
var authModalBound = false;
var profileSynced = true;
var authInitialized = false;

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
      planId: String(parsed.planId || ''),
      enrolledCourseIds: Array.isArray(parsed.enrolledCourseIds) ? parsed.enrolledCourseIds.slice() : [],
      allowedSimulators: Array.isArray(parsed.allowedSimulators) ? parsed.allowedSimulators.slice() : [],
      trialExpiresAt: Number(parsed.trialExpiresAt) || 0,
    };
  } catch (err) {
    return null;
  }
}

function readPlatformSettings() {
  try {
    var raw = localStorage.getItem('ifa_platform_settings');
    if (!raw) return { freeSimulatorIds: [], freeTrialDays: 0 };
    var parsed = JSON.parse(raw);
    var days = Number(parsed && parsed.freeTrialDays);
    return {
      freeSimulatorIds: Array.isArray(parsed && parsed.freeSimulatorIds) ? parsed.freeSimulatorIds : [],
      freeTrialDays: isFinite(days) && days > 0 ? Math.round(days) : 0,
    };
  } catch (err) {
    return { freeSimulatorIds: [], freeTrialDays: 0 };
  }
}

function trialExpiryMs(value) {
  if (value == null || value === '') return 0;
  var n = typeof value === 'number' ? value : Date.parse(value);
  return isFinite(n) ? n : 0;
}

function hasActiveTrial(user) {
  return trialExpiryMs(user && user.trialExpiresAt) > Date.now();
}

function resolveTrialExpiresAt(email, incoming) {
  var previous = getLocalAuthUser();
  var sameEmail = previous && normalizeEmail(previous.email) === normalizeEmail(email);
  if (incoming && trialExpiryMs(incoming) > 0) return trialExpiryMs(incoming);
  if (sameEmail && trialExpiryMs(previous.trialExpiresAt) > 0) return trialExpiryMs(previous.trialExpiresAt);
  try {
    var usersRaw = localStorage.getItem('ifa_admin_users');
    var users = usersRaw ? JSON.parse(usersRaw) : [];
    if (Array.isArray(users)) {
      for (var i = 0; i < users.length; i++) {
        if (normalizeEmail(users[i] && users[i].email) === normalizeEmail(email)) {
          var fromDir = trialExpiryMs(users[i].trialExpiresAt);
          if (fromDir) return fromDir;
          break;
        }
      }
    }
  } catch (err) {
    /* ignore */
  }
  if (sameEmail) return trialExpiryMs(previous.trialExpiresAt);
  var days = readPlatformSettings().freeTrialDays;
  if (days > 0) return Date.now() + days * 24 * 60 * 60 * 1000;
  return 0;
}

function persistDirectoryTrial(email, trialExpiresAt) {
  var key = normalizeEmail(email);
  if (!key || !trialExpiresAt) return;
  try {
    var raw = localStorage.getItem('ifa_admin_users');
    var list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return;
    var changed = false;
    list = list.map(function (u) {
      if (normalizeEmail(u && u.email) !== key) return u;
      if (trialExpiryMs(u.trialExpiresAt)) return u;
      changed = true;
      return Object.assign({}, u, { trialExpiresAt: trialExpiresAt });
    });
    if (changed) localStorage.setItem('ifa_admin_users', JSON.stringify(list));
  } catch (err) {
    /* ignore */
  }
}

function setLocalAuthUser(user) {
  if (!user || !normalizeEmail(user.email)) return;
  var previous = getLocalAuthUser();
  var sameEmail = previous && normalizeEmail(previous.email) === normalizeEmail(user.email);
  var trialExpiresAt = resolveTrialExpiresAt(user.email, user.trialExpiresAt);
  var payload = {
    name: String(user.name || user.displayName || '').trim() || normalizeEmail(user.email).split('@')[0],
    email: normalizeEmail(user.email),
    photoURL: String(user.photoURL || ''),
    isSubscriber: !!user.isSubscriber,
    isAdmin: !!user.isAdmin,
    isInstructor: !!user.isInstructor,
    role: String(user.role || ''),
    planId: user.planId != null ? String(user.planId) : sameEmail ? String(previous.planId || '') : '',
    enrolledCourseIds:
      Array.isArray(user.enrolledCourseIds)
        ? user.enrolledCourseIds.slice()
        : sameEmail && Array.isArray(previous.enrolledCourseIds)
          ? previous.enrolledCourseIds.slice()
          : [],
    allowedSimulators:
      Array.isArray(user.allowedSimulators)
        ? normalizeAllowedSimulators(user.allowedSimulators)
        : sameEmail && Array.isArray(previous.allowedSimulators)
          ? normalizeAllowedSimulators(previous.allowedSimulators)
          : [],
    trialExpiresAt: trialExpiresAt,
    loggedInAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(LOCAL_AUTH_KEY, JSON.stringify(payload));
  } catch (err) {
    console.error('[Auth] local auth save failed', err);
  }
  persistDirectoryTrial(payload.email, payload.trialExpiresAt);
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

function normalizeEnrolledCourseIds(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(function (id) {
      return String(id || '').trim();
    })
    .filter(Boolean);
}

function normalizeAllowedSimulators(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(function (id) {
      return String(id || '').trim();
    })
    .filter(Boolean);
}

function profileToEntitlements(profile, user, previous) {
  var sameEmail =
    previous && normalizeEmail(previous.email) === normalizeEmail((profile && profile.email) || (user && user.email));
  return {
    isSubscriber: !!(profile && profile.isSubscriber),
    planId: profile && profile.planId != null
      ? String(profile.planId || '')
      : sameEmail && previous
        ? String(previous.planId || '')
        : '',
    enrolledCourseIds:
      profile && Array.isArray(profile.enrolledCourseIds)
        ? normalizeEnrolledCourseIds(profile.enrolledCourseIds)
        : sameEmail && previous
          ? normalizeEnrolledCourseIds(previous.enrolledCourseIds)
          : [],
    allowedSimulators:
      profile && Array.isArray(profile.allowedSimulators)
        ? normalizeAllowedSimulators(profile.allowedSimulators)
        : sameEmail && previous
          ? normalizeAllowedSimulators(previous.allowedSimulators)
          : [],
  };
}

/** Apply Firestore entitlements to ifa_auth_user and refresh simulator gates. */
function applyEntitlements(entitlements, email) {
  var current = getLocalAuthUser();
  var key = normalizeEmail(email || (current && current.email));
  if (!key) return null;
  var payload = Object.assign({}, current || {}, entitlements || {}, { email: key });
  setLocalAuthUser(payload);
  refreshSlots();
  try {
    var evt = new CustomEvent('ifa:subscription-changed', {
      detail: {
        planId: payload.planId,
        enrolledCourseIds: payload.enrolledCourseIds,
        allowedSimulators: payload.allowedSimulators,
        isSubscriber: payload.isSubscriber,
        email: key,
      },
    });
    window.dispatchEvent(evt);
    document.dispatchEvent(evt);
  } catch (err) {
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

function startPlatformNotifications(user, profile) {
  if (!user || !user.uid) return;
  if (window.PlatformNotifications && typeof window.PlatformNotifications.start === 'function') {
    window.PlatformNotifications.start(user.uid, profile || lastProfile);
  }
}

function stopPlatformNotifications() {
  if (window.PlatformNotifications && typeof window.PlatformNotifications.stop === 'function') {
    window.PlatformNotifications.stop();
  }
}

function notifyAuthChange(user, meta) {
  meta = meta || {};
  var identity = resolveActiveIdentity();
  var payload = {
    user: user || identity.user || null,
    profile: identity.profile || null,
    isLoggedIn: !!(user || identity.user),
    email: user && user.email ? normalizeEmail(user.email) : identity.user && identity.user.email,
    profileSynced: meta.profileSynced !== undefined ? meta.profileSynced : profileSynced,
  };
  authChangeListeners.forEach(function (fn) {
    try {
      fn(payload);
    } catch (err) {
      console.error('[Auth] onAuthChange listener failed', err);
    }
  });
  try {
    window.dispatchEvent(new CustomEvent('ifa:auth-changed', { detail: payload }));
  } catch (err2) {
    /* ignore */
  }
}

function formatAuthError(err) {
  var code = err && err.code ? String(err.code) : '';
  if (code === 'auth/invalid-email') return 'البريد الإلكتروني غير صالح.';
  if (code === 'auth/user-disabled') return 'تم تعطيل هذا الحساب.';
  if (code === 'auth/user-not-found') return 'لا يوجد حساب بهذا البريد.';
  if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
    return 'البريد أو كلمة المرور غير صحيحة.';
  }
  if (code === 'auth/email-already-in-use') return 'هذا البريد مسجّل مسبقاً. جرّب تسجيل الدخول.';
  if (code === 'auth/weak-password') return 'كلمة المرور ضعيفة (6 أحرف على الأقل).';
  if (code === 'auth/too-many-requests') return 'محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.';
  if (code === 'auth/network-request-failed') return 'تعذّر الاتصال. تحقق من الشبكة.';
  return (err && err.message) || 'حدث خطأ. حاول مرة أخرى.';
}

function setAuthModalError(message) {
  var el = document.getElementById('authModalError');
  if (!el) return;
  if (!message) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = message;
}

function authText(key, fallback) {
  if (window.PlatformI18n && typeof window.PlatformI18n.t === 'function') {
    return window.PlatformI18n.t(key);
  }
  return fallback;
}

function setAuthModalMode(mode) {
  authModalMode = mode === 'signup' ? 'signup' : 'login';
  var modal = document.getElementById('authModal');
  if (!modal) return;
  modal.setAttribute('data-auth-mode', authModalMode);
  var title = modal.querySelector('[data-auth-modal-title]');
  var submit = modal.querySelector('[data-auth-submit]');
  var switchLogin = modal.querySelector('[data-auth-switch-login]');
  var switchSignup = modal.querySelector('[data-auth-switch-signup]');
  var label = authModalMode === 'signup' ? authText('auth.signup', 'إنشاء حساب') : authText('auth.login', 'تسجيل الدخول');
  if (title) title.textContent = label;
  if (submit) submit.textContent = label;
  if (switchLogin) {
    switchLogin.hidden = authModalMode === 'login';
    switchLogin.textContent = authText('auth.switchLogin', 'لديك حساب؟ تسجيل الدخول');
  }
  if (switchSignup) {
    switchSignup.hidden = authModalMode === 'signup';
    switchSignup.textContent = authText('auth.switchSignup', 'ليس لديك حساب؟ إنشاء حساب');
  }
  setAuthModalError('');
}

function ensureAuthModal() {
  if (document.getElementById('authModal')) return;
  var wrap = document.createElement('div');
  wrap.className = 'auth-modal';
  wrap.id = 'authModal';
  wrap.hidden = true;
  wrap.setAttribute('data-auth-mode', 'login');
  wrap.innerHTML =
    '<div class="auth-modal__backdrop" data-auth-modal-close tabindex="-1" aria-hidden="true"></div>' +
    '<div class="auth-modal__panel" role="dialog" aria-modal="true" aria-labelledby="authModalTitle">' +
      '<button type="button" class="auth-modal__close" data-auth-modal-close aria-label="إغلاق">&times;</button>' +
      '<h2 class="auth-modal__title" id="authModalTitle" data-auth-modal-title>تسجيل الدخول</h2>' +
      '<p class="auth-modal__hint">استخدم بريدك وكلمة المرور للوصول إلى المحاكيات واللوحات.</p>' +
      '<p class="auth-modal__error" id="authModalError" role="alert" hidden></p>' +
      '<form class="auth-modal__form" id="authModalForm" novalidate>' +
        '<label class="auth-modal__field">' +
          '<span>البريد الإلكتروني</span>' +
          '<input type="email" name="email" data-auth-email autocomplete="email" dir="ltr" required />' +
        '</label>' +
        '<label class="auth-modal__field">' +
          '<span>كلمة المرور</span>' +
          '<input type="password" name="password" data-auth-password autocomplete="current-password" minlength="6" required />' +
        '</label>' +
        '<button type="submit" class="auth-modal__submit" data-auth-submit>تسجيل الدخول</button>' +
      '</form>' +
      '<div class="auth-modal__switch">' +
        '<button type="button" class="auth-modal__switch-btn" data-auth-switch-signup>ليس لديك حساب؟ إنشاء حساب</button>' +
        '<button type="button" class="auth-modal__switch-btn" data-auth-switch-login hidden>لديك حساب؟ تسجيل الدخول</button>' +
      '</div>' +
      '<div class="auth-modal__divider" role="separator"><span>أو</span></div>' +
      '<button type="button" class="auth-modal__google" data-auth-google>متابعة بحساب Google</button>' +
    '</div>';
  document.body.appendChild(wrap);

  if (!authModalBound) {
    authModalBound = true;
    wrap.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('[data-auth-modal-close]')) {
        closeAuthModal();
      }
    });
    wrap.querySelector('[data-auth-switch-signup]').addEventListener('click', function () {
      setAuthModalMode('signup');
      var pwd = wrap.querySelector('[data-auth-password]');
      if (pwd) pwd.setAttribute('autocomplete', 'new-password');
    });
    wrap.querySelector('[data-auth-switch-login]').addEventListener('click', function () {
      setAuthModalMode('login');
      var pwd = wrap.querySelector('[data-auth-password]');
      if (pwd) pwd.setAttribute('autocomplete', 'current-password');
    });
    wrap.querySelector('[data-auth-google]').addEventListener('click', function () {
      loginWithGoogle();
    });
    wrap.querySelector('#authModalForm').addEventListener('submit', function (e) {
      e.preventDefault();
      handleAuthModalSubmit();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && wrap && !wrap.hidden) closeAuthModal();
    });
  }
}

function openAuthModal(mode) {
  ensureAuthModal();
  setAuthModalMode(mode || 'login');
  var modal = document.getElementById('authModal');
  var emailInput = modal && modal.querySelector('[data-auth-email]');
  if (modal) {
    modal.hidden = false;
    document.body.classList.add('auth-modal-open');
  }
  if (emailInput) {
    window.setTimeout(function () {
      emailInput.focus();
    }, 0);
  }
}

function closeAuthModal() {
  var modal = document.getElementById('authModal');
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove('auth-modal-open');
  setAuthModalError('');
}

function closeUserMenuDropdown() {
  var menu = document.getElementById('userMenu');
  if (!menu) return;
  menu.classList.remove('open');
  var toggle = menu.querySelector('.user-menu__toggle');
  var drop = menu.querySelector('.user-menu__dropdown');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
  if (drop) drop.hidden = true;
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

/** file:// or localhost / 127.0.0.1 — local development bypass */
function isLocalDevEnvironment() {
  if (typeof window !== 'undefined' && window.IFA_ENV && typeof window.IFA_ENV.isLocalDevEnvironment === 'function') {
    return window.IFA_ENV.isLocalDevEnvironment();
  }
  try {
    if (!window || !window.location) return false;
    if (window.location.protocol === 'file:') return true;
    var host = String(window.location.hostname || '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  } catch (err) {
    return false;
  }
}

function isProductionEnvironment() {
  if (typeof window !== 'undefined' && window.IFA_ENV && typeof window.IFA_ENV.isProductionEnvironment === 'function') {
    return window.IFA_ENV.isProductionEnvironment();
  }
  try {
    var host = String((window && window.location && window.location.hostname) || '').toLowerCase();
    return host === 'irabi-fiber-academy.web.app' || host === 'irabi-fiber-academy.firebaseapp.com';
  } catch (err) {
    return false;
  }
}

function shouldBypassAccessControl() {
  if (typeof window !== 'undefined' && window.IFA_ENV && typeof window.IFA_ENV.shouldBypassAccessControl === 'function') {
    return window.IFA_ENV.shouldBypassAccessControl();
  }
  return isLocalDevEnvironment();
}

/** Local → always show Admin + Instructor; production → admin email allow-list only */
function shouldShowDashboardLinks(_email, profile) {
  if (shouldBypassAccessControl()) return true;
  return isAdminUser(profile);
}

/** Seed / upgrade a full-privilege local session for free local development. */
function ensureLocalDevSession() {
  if (!shouldBypassAccessControl()) return null;
  var existing = getLocalAuthUser();
  if (existing && String(existing.role || '').toLowerCase() === 'student') {
    return existing;
  }
  var email = (existing && existing.email) || LOCAL_DEV_EMAIL;
  return setLocalAuthUser({
    name: (existing && existing.name) || 'Local Dev',
    email: email,
    photoURL: (existing && existing.photoURL) || '',
    isSubscriber: true,
    isAdmin: true,
    isInstructor: true,
    role: 'admin',
    planId: existing && existing.planId,
    enrolledCourseIds: existing && existing.enrolledCourseIds,
    trialExpiresAt: existing && existing.trialExpiresAt,
  });
}

function isAdminUser(profile) {
  return !!(profile && String(profile.role || '') === 'admin');
}

/** Show in-simulator CMS settings UI (الإعدادات) — admins only; does not gate read/sync listeners. */
function canShowSimulatorAdminSettingsUI() {
  var identity = resolveActiveIdentity();
  if (isAdminUser(identity.profile)) return true;
  if (shouldBypassAccessControl()) {
    var local = getLocalAuthUser();
    if (local && String(local.role || '').toLowerCase() === 'admin') return true;
  }
  return false;
}

function isInstructorUser(profile, email) {
  if (shouldBypassAccessControl()) return true;
  var Apps = typeof window !== 'undefined' ? window.InstructorApps : null;
  var checkEmail = normalizeEmail(
    email ||
      (profile && profile.email) ||
      (Apps && Apps.getSessionEmail ? Apps.getSessionEmail() : '') ||
      readLocalSessionEmail()
  );

  if (isAdminUser(profile)) return true;

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
  var showDashboards = options.showDashboards === true;
  var avatar =
    options.avatarHtml ||
    '<span class="user-menu__avatar" aria-hidden="true">' +
      escapeHtml((options.fullName || 'م').charAt(0)) +
      '</span>';

  var menuClasses = 'user-menu';
  if (showDashboards) menuClasses += ' is-admin is-instructor';
  if (shouldBypassAccessControl()) menuClasses += ' is-file-local is-local-dev';

  var instructorItem = showDashboards
    ? '<a href="instructor.html" id="instructor-dashboard" class="user-menu__item user-menu__item--instructor" role="menuitem">لوحة المدرب</a>'
    : '';

  var adminItem = showDashboards
    ? '<a href="admin.html" id="admin-dashboard" class="user-menu__item user-menu__item--admin" role="menuitem" data-admin-only>لوحة الإدارة</a>'
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
    '<a href="#" class="user-menu__item user-menu__item--logout" role="menuitem" data-auth-logout data-i18n="auth.logout">' +
    authText('auth.logout', 'تسجيل خروج') +
    '</a>' +
    '</div>' +
    '</div>'
  );
}

function loggedOutHtml(variant) {
  var btnClass = variant === 'simulator' ? 'auth-login-btn auth-login-btn--sim' : 'auth-login-btn';
  return (
    '<button type="button" class="' +
    btnClass +
    '" data-auth-login data-i18n="auth.login">' +
    authText('auth.login', 'تسجيل الدخول') +
    '</button>'
  );
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
      '<button type="button" class="auth-logout-btn auth-logout-btn--sim" data-auth-logout data-i18n="auth.logoutSim">' +
      authText('auth.logoutSim', 'تسجيل الخروج') +
      '</button>' +
      '</div>'
    );
  }

  var email = resolveMenuEmail(user, profile);
  return userMenuHtml({
    fullName: getFullName(user, profile),
    email: email,
    avatarHtml: avatarHtml(user, firstName),
    showDashboards: shouldShowDashboardLinks(email, profile),
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
        planId: local.planId || '',
        enrolledCourseIds: local.enrolledCourseIds || [],
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
  if (typeof window.applyRoleMenuVisibility === 'function') {
    try {
      window.applyRoleMenuVisibility();
    } catch (err) {
      /* ignore */
    }
  }
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
  var localBypass = shouldBypassAccessControl();
  var defaultEmail = localBypass ? LOCAL_DEV_EMAIL : 'user@fiberacademy.iq';
  var email = normalizeEmail(options.email || readLocalSessionEmail() || defaultEmail);
  if (!email || email.indexOf('@') === -1) {
    email = defaultEmail;
  }
  var name = String(options.name || '').trim() || nameFromEmail(email) || (localBypass ? 'Local Dev' : 'مستخدم');
  var directoryUser = null;
  try {
    var usersRaw = localStorage.getItem('ifa_admin_users');
    var users = usersRaw ? JSON.parse(usersRaw) : [];
    if (Array.isArray(users)) {
      for (var i = 0; i < users.length; i++) {
        if (normalizeEmail(users[i] && users[i].email) === email) {
          directoryUser = users[i];
          break;
        }
      }
    }
  } catch (err) {
    directoryUser = null;
  }
  var directoryRole = String((directoryUser && directoryUser.role) || '').toLowerCase();
  var treatAsStudent = directoryRole === 'student';
  setLocalAuthUser({
    name: (directoryUser && directoryUser.name) || name,
    email: email,
    photoURL: options.photoURL || '',
    isSubscriber: treatAsStudent
      ? directoryUser.status !== 'expired' && directoryUser.status !== 'suspended'
      : localBypass
        ? true
        : !!options.isSubscriber,
    isAdmin: treatAsStudent ? false : localBypass ? true : options.isAdmin === true,
    isInstructor: treatAsStudent ? false : localBypass ? true : !!options.isInstructor,
    role: treatAsStudent ? 'student' : localBypass ? 'admin' : options.role || 'user',
    planId: (directoryUser && directoryUser.planId) || options.planId || '',
    enrolledCourseIds: (directoryUser && directoryUser.enrolledCourseIds) || options.enrolledCourseIds || [],
    trialExpiresAt: trialExpiryMs(directoryUser && directoryUser.trialExpiresAt) || options.trialExpiresAt,
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

export async function loginWithEmailPassword(email, password) {
  var key = normalizeEmail(email);
  if (!key || key.indexOf('@') === -1) {
    throw new Error('البريد الإلكتروني غير صالح.');
  }
  if (!password || String(password).length < 6) {
    throw new Error('كلمة المرور يجب أن تكون 6 أحرف على الأقل.');
  }
  var result = await signInWithEmailAndPassword(auth, key, String(password));
  closeAuthModal();
  return result.user;
}

export async function signUpWithEmailPassword(email, password) {
  var key = normalizeEmail(email);
  if (!key || key.indexOf('@') === -1) {
    throw new Error('البريد الإلكتروني غير صالح.');
  }
  if (!password || String(password).length < 6) {
    throw new Error('كلمة المرور يجب أن تكون 6 أحرف على الأقل.');
  }
  var result = await createUserWithEmailAndPassword(auth, key, String(password));
  await createUserProfileOnSignUp(result.user);
  closeAuthModal();
  return result.user;
}

async function handleAuthModalSubmit() {
  var modal = document.getElementById('authModal');
  if (!modal) return;
  var emailInput = modal.querySelector('[data-auth-email]');
  var passwordInput = modal.querySelector('[data-auth-password]');
  var submitBtn = modal.querySelector('[data-auth-submit]');
  var email = emailInput ? emailInput.value : '';
  var password = passwordInput ? passwordInput.value : '';
  setAuthModalError('');
  if (submitBtn) submitBtn.disabled = true;
  try {
    if (authModalMode === 'signup') {
      await signUpWithEmailPassword(email, password);
    } else {
      await loginWithEmailPassword(email, password);
    }
  } catch (err) {
    setAuthModalError(formatAuthError(err));
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

export async function loginWithGoogle() {
  setAuthModalError('');
  try {
    await signInWithPopup(auth, provider);
    closeAuthModal();
  } catch (err) {
    if (err && (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request')) {
      return;
    }
    setAuthModalError(formatAuthError(err));
    console.warn('[Auth] Google sign-in failed', err);
  }
}

export async function logoutUser() {
  closeUserMenuDropdown();
  closeAuthModal();
  stopPlatformNotifications();
  try {
    if (auth.currentUser) {
      await signOut(auth);
    }
  } catch (err) {
    console.error('[Auth] Sign-out failed:', err);
  }
  clearLocalAuthUser();
  lastUser = null;
  lastProfile = null;
  refreshSlots();
  notifyLocalAuthChanged({ type: 'logout' });
  notifyAuthChange(null, { profileSynced: true });
}

function bindAuthClicks() {
  document.addEventListener('click', function (e) {
    var loginEl = e.target && e.target.closest ? e.target.closest('[data-auth-login]') : null;
    if (loginEl) {
      e.preventDefault();
      e.stopPropagation();
      if (lastUser || getLocalAuthUser()) {
        refreshSlots();
        openUserMenuDropdown();
        return;
      }
      openAuthModal('login');
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

function isSimulatorAccessManagedPage() {
  return !!document.getElementById('subscriber-gate');
}

function scheduleEnforceSimulatorPageFromAuth() {
  if (shouldBypassAccessControl()) return;
  if (isSimulatorAccessManagedPage()) return;

  var runCheck = function () {
    enforceSimulatorPageFromAuth();
  };

  if (
    window.PlatformSimulators &&
    typeof window.PlatformSimulators.warmEntitlementCaches === 'function'
  ) {
    var localUser = getLocalAuthUser();
    window.PlatformSimulators.warmEntitlementCaches(localUser, null).then(runCheck).catch(runCheck);
    return;
  }
  runCheck();
}

function enforceSimulatorPageFromAuth() {
  if (shouldBypassAccessControl()) return;
  if (isSimulatorAccessManagedPage()) return;
  try {
    if (new URLSearchParams(window.location.search).get('mode') === 'admin-preview') return;
  } catch (err) {
    /* ignore */
  }
  if (window.PlatformSimulators && typeof window.PlatformSimulators.viewerCanAccess === 'function') {
    var file = '';
    try {
      file = decodeURIComponent(String(window.location.pathname || '').split('/').pop() || '').toLowerCase();
    } catch (err2) {
      file = '';
    }
    var sim = (window.PlatformSimulators.getCatalog && window.PlatformSimulators.getCatalog()) || [];
    var match = null;
    for (var i = 0; i < sim.length; i++) {
      var href = String(sim[i].href || '').toLowerCase();
      if (href && href === file) {
        match = sim[i].id;
        break;
      }
    }
    if (!match) return;
    if (window.PlatformSimulators.viewerCanAccess(match)) return;
    window.location.replace('index.html#plans');
  }
}

function initAuthUI() {
  ensureAuthModal();
  bindAuthClicks();
  slots = Array.prototype.slice.call(document.querySelectorAll('[data-auth-slot]'));

  refreshSlots = function () {
    if (window.InstructorApps && window.InstructorApps.absorbApprovalFromUrl) {
      window.InstructorApps.absorbApprovalFromUrl();
    }
    if (shouldBypassAccessControl()) {
      ensureLocalDevSession();
    }
    slots.forEach(function (slot) {
      renderAuthSlot(slot);
    });
  };

  if (shouldBypassAccessControl()) {
    ensureLocalDevSession();
  }

  refreshSlots();

  window.addEventListener('ifa:settings-lang-changed', function () {
    refreshSlots();
    setAuthModalMode(authModalMode);
    if (window.PlatformI18n && typeof window.PlatformI18n.apply === 'function') {
      window.PlatformI18n.apply();
    }
  });

  window.addEventListener('ifa:local-auth-changed', function (e) {
    var type = e && e.detail ? e.detail.type : '';
    if (type === 'profile-sync' || type === 'login') {
      scheduleEnforceSimulatorPageFromAuth();
    }
  });
  document.addEventListener('ifa:local-auth-changed', function (e) {
    var type = e && e.detail ? e.detail.type : '';
    if (type === 'profile-sync' || type === 'login') {
      scheduleEnforceSimulatorPageFromAuth();
    }
  });
  window.addEventListener('ifa:subscription-changed', scheduleEnforceSimulatorPageFromAuth);

  onAuthStateChanged(auth, function (user) {
    authInitialized = true;
    lastUser = user || null;
    if (!user) {
      lastProfile = null;
      profileSynced = true;
      stopPlatformNotifications();
      if (shouldBypassAccessControl()) {
        ensureLocalDevSession();
      } else {
        clearLocalAuthUser();
      }
      refreshSlots();
      notifyLocalAuthChanged({ type: getLocalAuthUser() ? 'local-session' : 'logout' });
      notifyAuthChange(null, { profileSynced: true });
      return;
    }

    var email = normalizeEmail(user.email || '');
    profileSynced = false;
    setLocalAuthUser({
      name: user.displayName || '',
      email: email,
      photoURL: user.photoURL || '',
      isSubscriber: false,
      isAdmin: false,
      isInstructor: false,
      role: 'user',
    });
    refreshSlots();
    notifyLocalAuthChanged({ type: 'login', email: email });
    notifyAuthChange(user, { profileSynced: false });

    syncUserProfile(user)
      .then(function (profile) {
        lastProfile = profile || null;
        var role = String((profile && profile.role) || 'user');
        var previous = getLocalAuthUser();
        var entitlements = profileToEntitlements(profile, user, previous);
        setLocalAuthUser({
          name: (profile && profile.name) || user.displayName || '',
          email: (profile && profile.email) || user.email || '',
          photoURL: user.photoURL || (profile && profile.photo) || '',
          isSubscriber: entitlements.isSubscriber,
          isAdmin: role === 'admin',
          isInstructor: !!(profile && profile.isInstructor),
          role: role,
          planId: entitlements.planId,
          enrolledCourseIds: entitlements.enrolledCourseIds,
          allowedSimulators: entitlements.allowedSimulators,
        });
        profileSynced = true;
        refreshSlots();
        startPlatformNotifications(user, profile);
        notifyLocalAuthChanged({ type: 'profile-sync', email: email });
        notifyAuthChange(user, { profileSynced: true });
      })
      .catch(function (err) {
        profileSynced = true;
        console.error('[Auth] syncUserProfile failed:', err);
        startPlatformNotifications(user, lastProfile);
        notifyAuthChange(user, { profileSynced: true });
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

window.IFAAuth = {
  auth: auth,
  getCurrentUser: function () {
    return lastUser;
  },
  getLocalAuthUser: getLocalAuthUser,
  getAuthState: function () {
    return resolveActiveIdentity();
  },
  isAuthInitialized: function () {
    return authInitialized;
  },
  isLoggedIn: function () {
    if (lastUser) return true;
    if (shouldBypassAccessControl() && getLocalAuthUser()) return true;
    return !!getLocalAuthUser();
  },
  onAuthChange: function (callback) {
    if (typeof callback !== 'function') return function () {};
    authChangeListeners.push(callback);
    try {
      var identity = resolveActiveIdentity();
      callback({
        user: lastUser || identity.user,
        profile: lastProfile || identity.profile,
        isLoggedIn: !!(lastUser || getLocalAuthUser()),
        email: lastUser && lastUser.email ? normalizeEmail(lastUser.email) : readLocalSessionEmail(),
        profileSynced: profileSynced,
      });
    } catch (err) {
      console.error('[Auth] onAuthChange initial callback failed', err);
    }
    return function () {
      authChangeListeners = authChangeListeners.filter(function (fn) {
        return fn !== callback;
      });
    };
  },
  loginWithEmailPassword: loginWithEmailPassword,
  signUpWithEmailPassword: signUpWithEmailPassword,
  loginWithGoogle: loginWithGoogle,
  logout: logoutUser,
  openAuthModal: openAuthModal,
  setLocalAuthUser: setLocalAuthUser,
  clearLocalAuthUser: clearLocalAuthUser,
  loginLocalSession: loginLocalSession,
  hasActiveTrial: hasActiveTrial,
  isAdminUser: isAdminUser,
  canShowSimulatorAdminSettingsUI: canShowSimulatorAdminSettingsUI,
  isInstructorUser: isInstructorUser,
  applyEntitlements: applyEntitlements,
  profileToEntitlements: profileToEntitlements,
};

document.addEventListener('ifa:subscription-changed', function (e) {
  var detail = (e && e.detail) || {};
  var current = getLocalAuthUser();
  if (!current || !lastUser) return;
  if (detail.userId && detail.userId !== lastUser.uid) return;
  setLocalAuthUser(
    Object.assign({}, current, {
      isSubscriber: detail.isSubscriber !== undefined ? !!detail.isSubscriber : current.isSubscriber,
      planId: detail.planId != null ? String(detail.planId) : current.planId,
      enrolledCourseIds: Array.isArray(detail.enrolledCourseIds)
        ? normalizeEnrolledCourseIds(detail.enrolledCourseIds)
        : current.enrolledCourseIds,
      allowedSimulators: Array.isArray(detail.allowedSimulators)
        ? normalizeAllowedSimulators(detail.allowedSimulators)
        : current.allowedSimulators,
    })
  );
  refreshSlots();
});
