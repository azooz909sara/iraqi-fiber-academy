/**
 * Restrict simulator.html to authenticated active subscribers.
 * Overlay only — never removes canvas / workspace DOM.
 * Local file:// / localhost: full bypass (no gate).
 * Production (irabi-fiber-academy.web.app): strict Firebase + subscription checks.
 */
import { auth } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { syncUserProfile, checkSubscriberStatus } from './db-manager.js';
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
    } else {
      statusEl.textContent = '';
    }
  }
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

  try {
    await syncUserProfile(user);
    var ok = await checkSubscriberStatus(user.uid);
    if (ok) {
      setGateVisible(false);
    } else {
      setGateVisible(true, 'not-subscriber');
    }
  } catch (err) {
    console.error('[SimulatorAccess] subscriber check failed:', err);
    setGateVisible(true, 'not-subscriber');
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
