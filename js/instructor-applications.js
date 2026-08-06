/**
 * Instructor applications — localStorage shared between index.html and admin.html.
 */
(function (global) {
  'use strict';

  var APPS_KEY = 'ifa_instructor_applications';
  var APPROVED_KEY = 'ifa_approved_instructors';
  var SESSION_EMAIL_KEY = 'ifa_session_email';

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (err) {
      console.warn('[InstructorApps] read failed:', err);
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.error('[InstructorApps] write failed:', err);
    }
  }

  function uid() {
    return 'app_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function getApplications() {
    var list = readJson(APPS_KEY, []);
    return Array.isArray(list) ? list : [];
  }

  function saveApplications(list) {
    writeJson(APPS_KEY, list);
  }

  function getApprovedMap() {
    var map = readJson(APPROVED_KEY, {});
    return map && typeof map === 'object' ? map : {};
  }

  function saveApprovedMap(map) {
    writeJson(APPROVED_KEY, map);
  }

  function getPendingApplications() {
    return getApplications().filter(function (a) {
      return a && a.status === 'pending';
    });
  }

  function findByEmail(email) {
    var target = normalizeEmail(email);
    if (!target) return null;
    var list = getApplications();
    for (var i = list.length - 1; i >= 0; i--) {
      if (normalizeEmail(list[i].email) === target) return list[i];
    }
    return null;
  }

  function isApprovedInstructor(email) {
    var key = normalizeEmail(email);
    if (!key) return false;
    var map = getApprovedMap();
    if (map[key]) return true;
    var app = findByEmail(key);
    return !!(app && app.status === 'approved');
  }

  function hasPendingApplication(email) {
    var app = findByEmail(email);
    return !!(app && app.status === 'pending');
  }

  function submitApplication(payload) {
    var email = normalizeEmail(payload.email);
    if (!email) throw new Error('البريد الإلكتروني مطلوب');

    var existing = findByEmail(email);
    if (existing && existing.status === 'pending') {
      throw new Error('لديك طلب قيد المراجعة بالفعل.');
    }
    if (isApprovedInstructor(email)) {
      throw new Error('هذا البريد معتمد بالفعل كمدرب.');
    }

    var app = {
      id: uid(),
      fullName: String(payload.fullName || '').trim(),
      email: email,
      bio: String(payload.bio || '').trim(),
      cvLink: String(payload.cvLink || '').trim(),
      cvFileName: String(payload.cvFileName || '').trim(),
      courses: String(payload.courses || '').trim(),
      status: 'pending',
      createdAt: new Date().toISOString(),
      reviewedAt: null,
    };

    if (!app.fullName) throw new Error('الاسم الكامل مطلوب');
    if (!app.bio) throw new Error('نبذة تعريفية مطلوبة');
    if (!app.courses) throw new Error('الكورسات المقترحة مطلوبة');
    if (!app.cvLink && !app.cvFileName) {
      throw new Error('يرجى إرفاق السيرة الذاتية أو إضافة رابط لها');
    }

    var list = getApplications();
    list.unshift(app);
    saveApplications(list);
    setSessionEmail(email);
    return app;
  }

  function updateStatus(id, status) {
    var list = getApplications();
    var found = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        list[i].status = status;
        list[i].reviewedAt = new Date().toISOString();
        found = list[i];
        break;
      }
    }
    if (!found) throw new Error('الطلب غير موجود');

    saveApplications(list);

    var map = getApprovedMap();
    var key = normalizeEmail(found.email);
    if (status === 'approved') {
      map[key] = {
        fullName: found.fullName,
        email: key,
        applicationId: found.id,
        approvedAt: found.reviewedAt,
      };
    } else if (status === 'rejected') {
      delete map[key];
    }
    saveApprovedMap(map);
    return found;
  }

  function approveApplication(id) {
    return updateStatus(id, 'approved');
  }

  function rejectApplication(id) {
    return updateStatus(id, 'rejected');
  }

  function setSessionEmail(email) {
    var key = normalizeEmail(email);
    if (key) localStorage.setItem(SESSION_EMAIL_KEY, key);
  }

  function getSessionEmail() {
    return normalizeEmail(localStorage.getItem(SESSION_EMAIL_KEY) || '');
  }

  function formatDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('ar-IQ', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch (e) {
      return iso;
    }
  }

  global.InstructorApps = {
    getApplications: getApplications,
    getPendingApplications: getPendingApplications,
    submitApplication: submitApplication,
    approveApplication: approveApplication,
    rejectApplication: rejectApplication,
    isApprovedInstructor: isApprovedInstructor,
    hasPendingApplication: hasPendingApplication,
    setSessionEmail: setSessionEmail,
    getSessionEmail: getSessionEmail,
    findByEmail: findByEmail,
    formatDate: formatDate,
    normalizeEmail: normalizeEmail,
  };
})(typeof window !== 'undefined' ? window : globalThis);
