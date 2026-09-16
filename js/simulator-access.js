/**
 * Restrict simulator pages to authenticated users with tier-scoped simulator access.
 * Overlay only — never removes canvas / workspace DOM.
 * Local file:// / localhost: full bypass (no gate).
 */
import { auth } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { syncUserProfile, getUserAllowedSimulators } from './db-manager.js';
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

function isGloballyFreeSimulator(simulatorId) {
  if (window.PlatformSimulators && typeof window.PlatformSimulators.isGloballyFreeSimulator === 'function') {
    return window.PlatformSimulators.isGloballyFreeSimulator(simulatorId);
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

  if (isGloballyFreeSimulator(simulatorId)) {
    setGateVisible(false);
    return;
  }

  try {
    await syncUserProfile(user);

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
      return;
    }

    var allowed = await getUserAllowedSimulators(user.uid);
    if (allowed.indexOf(simulatorId) !== -1) {
      setGateVisible(false);
      return;
    }
    console.error(
      '[SimulatorAccess] Access denied — simulator "' +
        simulatorId +
        '" not permitted. Firestore allowedSimulators:',
      allowed
    );
    setGateVisible(true, 'simulator-locked');
  } catch (err) {
    console.error('[SimulatorAccess] access check failed:', err);
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
