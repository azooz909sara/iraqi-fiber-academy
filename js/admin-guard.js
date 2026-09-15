/**
 * Admin Panel route guard — Firestore RBAC via IFAAuth.
 * Redirects to index.html unless the user is logged in with role === 'admin'.
 */
import './auth-manager.js';

var redirecting = false;

function redirectHome() {
  if (redirecting) return;
  redirecting = true;
  window.location.replace('index.html');
}

function enforceAdminAccess(detail) {
  detail = detail || {};
  var Auth = window.IFAAuth;
  if (!Auth || !Auth.isAuthInitialized()) {
    return;
  }
  if (!Auth.isLoggedIn()) {
    redirectHome();
    return;
  }
  if (Auth.getCurrentUser() && detail.profileSynced === false) {
    return;
  }
  var profile = detail.profile != null ? detail.profile : Auth.getAuthState().profile;
  if (!Auth.isAdminUser(profile)) {
    redirectHome();
  }
}

window.IFAAuth.onAuthChange(enforceAdminAccess);
