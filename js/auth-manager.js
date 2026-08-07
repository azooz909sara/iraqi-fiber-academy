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

/** Local testing: show بروفايل instead of sign-in in the same slot (set false for production). */
var DEV_SHOW_PROFILE_MENU = true;

/** Hard allow-list for admin dashboard access (normalized lowercase). */
var ADMIN_EMAILS = ['abdulazizyassin909@gmail.com'];

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

function getFirstName(user) {
  var full = (user && (user.displayName || user.email)) || 'User';
  return String(full).trim().split(/\s+/)[0] || 'User';
}

function getFullName(user, profile) {
  if (profile && profile.name) return String(profile.name).trim();
  if (user && user.displayName) return String(user.displayName).trim();
  if (user && user.email) return String(user.email).trim();
  return 'مستخدم';
}

function getSubscriptionLabel(profile) {
  if (profile && profile.isSubscriber === true) return 'مشترك نشط';
  return 'غير مشترك';
}

function readLocalSessionEmail() {
  try {
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

/**
 * Admin = profile flag/role OR allow-listed developer email.
 * Never grant admin to guest/test "مستخدم تجريبي" sessions.
 */
function isAdminUser(profile, email) {
  var resolved = normalizeEmail(email || (profile && profile.email) || '');
  if (isAdminEmail(resolved)) return true;
  if (!profile) return false;
  if (profile.isAdmin === true) return true;
  if (String(profile.role || '').toLowerCase() === 'admin') return true;
  return false;
}

/**
 * Instructor dashboard: approved instructor OR admin.
 * Requires a real session email / authenticated profile — not a bare guest menu.
 */
function isInstructorUser(profile, email, options) {
  var requireAuth = !options || options.requireAuth !== false;
  var Apps = typeof window !== 'undefined' ? window.InstructorApps : null;
  var checkEmail = normalizeEmail(
    email || (profile && profile.email) || (Apps && Apps.getSessionEmail ? Apps.getSessionEmail() : '') || readLocalSessionEmail()
  );

  if (isAdminUser(profile, checkEmail)) return true;

  if (requireAuth && !checkEmail && !(profile && (profile.isInstructor || profile.role))) {
    return false;
  }

  if (profile && (profile.isInstructor === true || String(profile.role || '').toLowerCase() === 'instructor')) {
    return true;
  }

  if (!Apps) return false;

  if (checkEmail && typeof Apps.isApprovedInstructor === 'function' && Apps.isApprovedInstructor(checkEmail)) {
    return true;
  }

  /* Flag alone is not enough without a matching session email (blocks guest test user). */
  if (
    checkEmail &&
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

function userMenuHtml(options) {
  var fullName = escapeHtml(options.fullName || 'مستخدم تجريبي');
  var subscription = escapeHtml(options.subscription || 'غير مشترك');
  var isAdmin = options.isAdmin === true;
  var isInstructor = options.isInstructor === true;
  var isAuthenticated = options.isAuthenticated === true;
  var avatar =
    options.avatarHtml ||
    '<span class="user-menu__avatar" aria-hidden="true">' +
      escapeHtml((options.fullName || 'ت').charAt(0)) +
      '</span>';

  /* Guests / test users never see privileged dashboards */
  if (!isAuthenticated) {
    isAdmin = false;
    isInstructor = false;
  }

  var menuClasses = 'user-menu';
  if (isAdmin) menuClasses += ' is-admin';
  if (isInstructor) menuClasses += ' is-instructor';

  /* Omit privileged links from DOM entirely when unauthorized */
  var instructorItem = isInstructor
    ? '<a href="instructor.html" class="user-menu__item user-menu__item--instructor" role="menuitem">لوحة المدرب</a>'
    : '';

  var adminItem = isAdmin
    ? '<a href="admin.html" class="user-menu__item user-menu__item--admin" role="menuitem" data-admin-only>لوحة الإدارة</a>'
    : '';

  var joinItem = isInstructor
    ? ''
    : '<a href="#" class="user-menu__item user-menu__item--join" role="menuitem" data-join-instructor>انضم إلينا كمدرب</a>';

  return (
    '<div class="' + menuClasses + '" id="userMenu"' +
      (isAuthenticated ? '' : ' data-auth-guest="1"') + '>' +
      '<button type="button" class="user-menu__toggle" id="userMenuToggle" ' +
        'aria-expanded="false" aria-haspopup="true" aria-controls="userMenuDropdown">' +
        avatar +
        '<span class="user-menu__label">Profile</span>' +
        '<svg class="user-menu__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
          'stroke="currentColor" stroke-width="2.5" aria-hidden="true">' +
          '<path d="M6 9l6 6 6-6"/>' +
        '</svg>' +
      '</button>' +
      '<div class="user-menu__dropdown" id="userMenuDropdown" role="menu" hidden>' +
        '<div class="user-menu__info" role="none">' +
          '<span class="user-menu__info-name">' + fullName + '</span>' +
          '<span class="user-menu__info-status">' + subscription + '</span>' +
        '</div>' +
        '<div class="user-menu__divider" role="separator"></div>' +
        instructorItem +
        adminItem +
        joinItem +
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

  var loginBtn =
    '<a href="#" class="header__login" data-auth-login role="button">تسجيل الدخول</a>';

  /* Same auth-slot child: profile replaces sign-in (never both).
     Guest/test profile must NOT expose admin or instructor dashboards. */
  if (DEV_SHOW_PROFILE_MENU) {
    return userMenuHtml({
      fullName: 'مستخدم تجريبي',
      subscription: 'غير مشترك',
      isAuthenticated: false,
      isAdmin: false,
      isInstructor: false,
    });
  }

  return loginBtn;
}

function loggedInHtml(user, variant, profile) {
  var firstName = getFirstName(user);

  if (variant === 'simulator') {
    return (
      '<div class="auth-user auth-user--sim" role="group" aria-label="Account">' +
      simAvatarHtml(user, firstName) +
      '<span class="auth-user__name">' + escapeHtml(firstName) + '</span>' +
      '<button type="button" class="auth-logout-btn auth-logout-btn--sim" data-auth-logout>تسجيل الخروج</button>' +
      '</div>'
    );
  }

  var email = resolveMenuEmail(user, profile);
  return userMenuHtml({
    fullName: getFullName(user, profile),
    subscription: getSubscriptionLabel(profile),
    avatarHtml: avatarHtml(user, firstName),
    isAuthenticated: true,
    isAdmin: isAdminUser(profile, email),
    isInstructor: isInstructorUser(profile, email, { requireAuth: true }),
  });
}

function renderAuthSlot(slot, user, profile) {
  if (!slot) return;
  var variant = slotVariant(slot);
  slot.innerHTML = user ? loggedInHtml(user, variant, profile) : loggedOutHtml(variant);
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
  var lastUser = null;
  var lastProfile = null;

  function refreshSlots() {
    if (window.InstructorApps && window.InstructorApps.absorbApprovalFromUrl) {
      window.InstructorApps.absorbApprovalFromUrl();
    }
    slots.forEach(function (slot) {
      renderAuthSlot(slot, lastUser, lastProfile);
    });
  }

  /* Immediate check on script load (before auth settles) */
  refreshSlots();

  onAuthStateChanged(auth, function (user) {
    lastUser = user || null;
    if (!user) {
      lastProfile = null;
      refreshSlots();
      return;
    }

    refreshSlots();

    syncUserProfile(user)
      .then(function (profile) {
        lastProfile = profile;
        if (profile && profile.email && window.InstructorApps) {
          window.InstructorApps.setSessionEmail(profile.email);
        } else if (user.email && window.InstructorApps) {
          window.InstructorApps.setSessionEmail(user.email);
        }
        refreshSlots();
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
