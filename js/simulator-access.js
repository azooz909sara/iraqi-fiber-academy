/**
 * Restrict simulator pages to authenticated users with tier-scoped simulator access.
 * Overlay only — never removes canvas / workspace DOM.
 * Local file:// / localhost: full bypass (no gate).
 */
import { auth } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { syncUserProfile, fetchUserProfile } from './db-manager.js';
import { loginWithGoogle } from './auth-manager.js';

function shouldBypassAccessControl() {
  if (typeof window !== 'undefined' && window.IFA_ENV && typeof window.IFA_ENV.shouldBypassAccessControl === 'function') {
    return window.IFA_ENV.shouldBypassAccessControl();
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

function getGate() {
  return document.getElementById('subscriber-gate');
}

function setGateVisible(visible, reason) {
  var gate = getGate();
  if (!gate) return;

  if (visible) {
    gate.hidden = false;
    gate.setAttribute('aria-hidden', 'false');
    gate.classList.add('subscriber-gate--visible');
    document.body.classList.add('subscriber-gate-active');
  } else {
    gate.hidden = true;
    gate.setAttribute('aria-hidden', 'true');
    gate.classList.remove('subscriber-gate--visible');
    document.body.classList.remove('subscriber-gate-active');
  }

  var statusEl = gate.querySelector('[data-subscriber-gate-status]');
  if (statusEl) {
    if (!visible) {
      statusEl.textContent = '';
    } else if (reason === 'loading') {
      statusEl.textContent = 'جاري التحقق من حالة الاشتراك…';
    } else if (reason === 'logged-out') {
      statusEl.textContent = 'يرجى تسجيل الدخول بحساب Google للمتابعة.';
    } else if (reason === 'not-subscriber') {
      statusEl.textContent = 'حسابك مسجّل لكن الاشتراك غير مفعّل بعد.';
    } else if (reason === 'simulator-locked') {
      statusEl.textContent = 'هذا المحاكي غير مشمول في باقتك الحالية. راجع الباقات للترقية.';
    } else {
      statusEl.textContent = '';
    }
  }
}

function currentSimulatorIdFromPage() {
  if (window.PlatformSimulators && typeof window.PlatformSimulators.currentSimulatorIdFromLocation === 'function') {
    return window.PlatformSimulators.currentSimulatorIdFromLocation();
  }
  var file = '';
  try {
    file = decodeURIComponent(String(window.location.pathname || '').split('/').pop() || '').toLowerCase();
  } catch (err) {
    file = '';
  }
  var catalog =
    window.PlatformSimulators && typeof window.PlatformSimulators.getCatalog === 'function'
      ? window.PlatformSimulators.getCatalog()
      : [];
  for (var i = 0; i < catalog.length; i++) {
    var href = String(catalog[i].href || '').toLowerCase();
    if (href && href === file) return String(catalog[i].id || '');
  }
  return '';
}

function readEntitlementsCache(uid) {
  var id = String(uid || '').trim();
  if (!id) return null;
  try {
    var raw = localStorage.getItem('ifa_entitlements_cache_v1');
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    if (!parsed || String(parsed.uid || '') !== id) return null;
    var data = parsed.data;
    if (!data || typeof data !== 'object') return null;
    return {
      enrolledCourseIds: Array.isArray(data.enrolledCourseIds) ? data.enrolledCourseIds.slice() : [],
      allowedSimulators: Array.isArray(data.allowedSimulators) ? data.allowedSimulators.slice() : [],
      isSubscriber: !!data.isSubscriber,
      planId: data.planId != null ? String(data.planId) : '',
      trialExpiresAtMs: typeof data.trialExpiresAtMs === 'number' ? data.trialExpiresAtMs : 0,
      trialExpiresAt: data.trialExpiresAt,
    };
  } catch (err) {
    return null;
  }
}

function mergeProfileEntitlementsWithLocal(localBefore, profile, uid) {
  var cached = readEntitlementsCache(uid);
  var profileSubscriber = !!(profile && profile.isSubscriber === true);
  var profileEnrolled =
    profile && Array.isArray(profile.enrolledCourseIds) ? profile.enrolledCourseIds.slice() : [];
  var profileAllowed =
    profile && Array.isArray(profile.allowedSimulators) ? profile.allowedSimulators.slice() : [];
  var profilePlanId = profile && profile.planId != null ? String(profile.planId) : '';

  var isSubscriber =
    profileSubscriber ||
    !!(localBefore && localBefore.isSubscriber) ||
    !!(cached && cached.isSubscriber);
  var enrolledCourseIds = profileEnrolled.length
    ? profileEnrolled
    : localBefore && Array.isArray(localBefore.enrolledCourseIds) && localBefore.enrolledCourseIds.length
      ? localBefore.enrolledCourseIds.slice()
      : cached && Array.isArray(cached.enrolledCourseIds)
        ? cached.enrolledCourseIds.slice()
        : [];
  var allowedSimulators = profileAllowed.length
    ? profileAllowed
    : localBefore && Array.isArray(localBefore.allowedSimulators) && localBefore.allowedSimulators.length
      ? localBefore.allowedSimulators.slice()
      : cached && Array.isArray(cached.allowedSimulators)
        ? cached.allowedSimulators.slice()
        : [];
  var planId = profilePlanId || (localBefore && localBefore.planId) || (cached && cached.planId) || '';

  var trialExpiresAt =
    localBefore && localBefore.trialExpiresAt != null && localBefore.trialExpiresAt !== ''
      ? localBefore.trialExpiresAt
      : cached && cached.trialExpiresAtMs > 0
        ? cached.trialExpiresAtMs
        : cached && cached.trialExpiresAt != null
          ? cached.trialExpiresAt
          : profile && profile.trialExpiresAt != null
            ? profile.trialExpiresAt
            : 0;

  return {
    isSubscriber: isSubscriber,
    planId: planId,
    enrolledCourseIds: enrolledCourseIds,
    allowedSimulators: allowedSimulators,
    trialExpiresAt: trialExpiresAt,
  };
}

function isAdminSimulatorBypass(localUser) {
  if (localUser && String(localUser.role || '').toLowerCase() === 'admin') return true;
  if (localUser && localUser.isAdmin === true) return true;
  if (window.IFAAuth && typeof window.IFAAuth.isAdminUser === 'function') {
    if (window.IFAAuth.isAdminUser(localUser)) return true;
    if (typeof window.IFAAuth.getAuthState === 'function') {
      var state = window.IFAAuth.getAuthState();
      if (window.IFAAuth.isAdminUser(state && state.profile)) return true;
    }
  }
  return false;
}

function tryKickOutExpiredTrial(simulatorId, localUser) {
  if (!window.PlatformSimulators) return false;
  if (
    typeof window.PlatformSimulators.isTrialTierSimulator !== 'function' ||
    !window.PlatformSimulators.isTrialTierSimulator(simulatorId)
  ) {
    return false;
  }
  var settings =
    typeof window.PlatformSimulators.getPlatformSettings === 'function'
      ? window.PlatformSimulators.getPlatformSettings()
      : null;
  var expMs =
    window.IFAAuth && typeof window.IFAAuth.getTrialExpiryMs === 'function'
      ? window.IFAAuth.getTrialExpiryMs(localUser, settings)
      : 0;
  if (!(expMs > 0 && Date.now() >= expMs)) return false;
  if (typeof window.PlatformSimulators.kickOutTrialExpiredUser === 'function') {
    window.PlatformSimulators.kickOutTrialExpiredUser(simulatorId);
    return true;
  }
  return false;
}

async function evaluateAccess(user) {
  if (shouldBypassAccessControl()) {
    setGateVisible(false);
    return;
  }

  setGateVisible(true, 'loading');

  if (!user) {
    setGateVisible(true, 'logged-out');
    return;
  }

  var simulatorId = currentSimulatorIdFromPage();
  if (!simulatorId) {
    console.error('[SimulatorAccess] Could not resolve simulator id for page:', window.location.pathname);
    setGateVisible(true, 'simulator-locked');
    return;
  }

  var localBefore =
    window.IFAAuth && typeof window.IFAAuth.getLocalAuthUser === 'function'
      ? window.IFAAuth.getLocalAuthUser()
      : null;
  if (isAdminSimulatorBypass(localBefore)) {
    setGateVisible(false);
    if (
      window.PlatformSimulators &&
      typeof window.PlatformSimulators.armTrialExpiryWatch === 'function'
    ) {
      window.PlatformSimulators.armTrialExpiryWatch();
    }
    return;
  }

  try {
    await syncUserProfile(user);

    var profile = await fetchUserProfile(user.uid);
    var mergedEntitlements = mergeProfileEntitlementsWithLocal(localBefore, profile, user.uid);
    if (profile && window.IFAAuth && typeof window.IFAAuth.setLocalAuthUser === 'function') {
      window.IFAAuth.setLocalAuthUser(
        {
          name: (localBefore && localBefore.name) || user.displayName || '',
          email: user.email || (localBefore && localBefore.email) || '',
          photoURL: user.photoURL || (localBefore && localBefore.photoURL) || '',
          isSubscriber: mergedEntitlements.isSubscriber,
          planId: mergedEntitlements.planId,
          enrolledCourseIds: mergedEntitlements.enrolledCourseIds,
          allowedSimulators: mergedEntitlements.allowedSimulators,
          trialExpiresAt: mergedEntitlements.trialExpiresAt,
          role:
            localBefore && String(localBefore.role || '').toLowerCase() === 'admin'
              ? localBefore.role
              : localBefore && localBefore.role
                ? localBefore.role
                : profile && profile.role
                  ? profile.role
                  : '',
          isAdmin:
            isAdminSimulatorBypass(localBefore) ||
            !!(profile && String(profile.role || '').toLowerCase() === 'admin'),
          isInstructor: !!(localBefore && localBefore.isInstructor),
        },
        profile
      );
    } else if (profile && window.IFAAuth && typeof window.IFAAuth.applyEntitlements === 'function') {
      window.IFAAuth.applyEntitlements(
        {
          isSubscriber: mergedEntitlements.isSubscriber,
          planId: mergedEntitlements.planId,
          enrolledCourseIds: mergedEntitlements.enrolledCourseIds,
          allowedSimulators: mergedEntitlements.allowedSimulators,
        },
        user.email
      );
    }

    var localUser =
      window.IFAAuth && typeof window.IFAAuth.getLocalAuthUser === 'function'
        ? window.IFAAuth.getLocalAuthUser()
        : null;
    if (
      window.PlatformSimulators &&
      typeof window.PlatformSimulators.warmEntitlementCaches === 'function'
    ) {
      await window.PlatformSimulators.warmEntitlementCaches(localUser, null);
    }

    if (
      window.PlatformSimulators &&
      typeof window.PlatformSimulators.viewerCanAccess === 'function' &&
      window.PlatformSimulators.viewerCanAccess(simulatorId)
    ) {
      setGateVisible(false);
      if (typeof window.PlatformSimulators.armTrialExpiryWatch === 'function') {
        window.PlatformSimulators.armTrialExpiryWatch();
      }
      return;
    }

    var enrolled =
      profile && Array.isArray(profile.enrolledCourseIds) ? profile.enrolledCourseIds.slice() : [];
    var courseAllowed =
      window.PlatformSimulators &&
      typeof window.PlatformSimulators.simulatorsFromEnrolledCourseIds === 'function'
        ? window.PlatformSimulators.simulatorsFromEnrolledCourseIds(enrolled)
        : [];
    if (courseAllowed.indexOf(simulatorId) !== -1) {
      setGateVisible(false);
      return;
    }
    if (tryKickOutExpiredTrial(simulatorId, localUser)) {
      return;
    }
    console.error(
      '[SimulatorAccess] Access denied — simulator "' +
        simulatorId +
        '" not permitted for enrolled courses:',
      enrolled
    );
    setGateVisible(true, 'simulator-locked');
  } catch (err) {
    console.error('[SimulatorAccess] access check failed:', err);
    var catchUser =
      window.IFAAuth && typeof window.IFAAuth.getLocalAuthUser === 'function'
        ? window.IFAAuth.getLocalAuthUser()
        : localBefore;
    if (isAdminSimulatorBypass(catchUser)) {
      setGateVisible(false);
      return;
    }
    if (
      window.PlatformSimulators &&
      typeof window.PlatformSimulators.viewerCanAccess === 'function' &&
      window.PlatformSimulators.viewerCanAccess(simulatorId)
    ) {
      setGateVisible(false);
      return;
    }
    if (tryKickOutExpiredTrial(simulatorId, catchUser)) {
      return;
    }
    setGateVisible(true, 'simulator-locked');
  }
}

function bindGateActions() {
  var gate = getGate();
  if (!gate || gate.dataset.bound === '1') return;
  gate.dataset.bound = '1';

  gate.addEventListener('click', function (e) {
    var loginBtn = e.target.closest('[data-subscriber-login]');
    if (loginBtn) {
      e.preventDefault();
      loginWithGoogle();
      return;
    }
    var homeBtn = e.target.closest('[data-subscriber-home]');
    if (homeBtn) {
      e.preventDefault();
      window.location.href = 'index.html';
    }
  });
}

function initSimulatorAccess() {
  bindGateActions();

  if (shouldBypassAccessControl()) {
    setGateVisible(false);
    document.documentElement.setAttribute('data-ifa-access', 'local-bypass');
    return;
  }

  document.documentElement.setAttribute('data-ifa-access', 'enforced');
  setGateVisible(true, 'loading');

  onAuthStateChanged(auth, function (user) {
    evaluateAccess(user);
  });
}

initSimulatorAccess();
