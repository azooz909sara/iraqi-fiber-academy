/**
 * Admin users directory + archive (localStorage).
 * Keys: ifa_admin_users, ifa_admin_users_archive
 */
(function (global) {
  'use strict';

  var USERS_KEY = 'ifa_admin_users';
  var ARCHIVE_KEY = 'ifa_admin_users_archive';
  var SEED_VERSION_KEY = 'ifa_admin_users_seed_version';
  /* Bump to force-reset mock data for all browsers with old rows. */
  var SEED_VERSION = '3';

  var ROLE_LABELS = {
    student: 'طالب',
    instructor: 'مدرب',
    admin: 'مسؤول',
  };

  var STATUS_LABELS = {
    active: 'نشط',
    suspended: 'موقوف',
    pending: 'قيد المراجعة',
    expired: 'منتهي',
  };

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      console.error('[AdminUsers] localStorage set failed:', key, err);
    }
  }

  function readJson(key, fallback) {
    try {
      var raw = storageGet(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (err) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    storageSet(key, JSON.stringify(value));
  }

  function uid() {
    return 'usr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function seedUsers() {
    return [
      {
        id: 'usr_example_1',
        name: 'أحمد الطالب',
        email: 'ahmed.student@example.com',
        role: 'student',
        status: 'active',
        createdAt: '2026-06-01T10:00:00.000Z',
        subscriptionEndsAt: '2026-12-31T23:59:59.000Z',
        planId: 'plan_standard',
        enrolledCourseIds: [],
      },
      {
        id: 'usr_example_2',
        name: 'سارة المتعلمة',
        email: 'sara.learner@example.com',
        role: 'student',
        status: 'active',
        createdAt: '2026-07-15T10:00:00.000Z',
        subscriptionEndsAt: '2026-11-30T23:59:59.000Z',
        planId: 'plan_free',
        enrolledCourseIds: [],
      },
    ];
  }

  function ensureSeeded() {
    var version = storageGet(SEED_VERSION_KEY);
    if (version !== SEED_VERSION) {
      writeJson(USERS_KEY, seedUsers());
      writeJson(ARCHIVE_KEY, []);
      storageSet(SEED_VERSION_KEY, SEED_VERSION);
      return;
    }
    /* Do not re-seed when the list is empty — deletion must persist. */
    if (!Array.isArray(readJson(USERS_KEY, null))) {
      writeJson(USERS_KEY, []);
    }
    if (!Array.isArray(readJson(ARCHIVE_KEY, null))) {
      writeJson(ARCHIVE_KEY, []);
    }
  }

  function getUsers() {
    ensureSeeded();
    var list = readJson(USERS_KEY, []);
    return Array.isArray(list) ? list : [];
  }

  function saveUsers(list) {
    writeJson(USERS_KEY, list);
  }

  function getArchivedUsers() {
    ensureSeeded();
    var list = readJson(ARCHIVE_KEY, []);
    return Array.isArray(list) ? list : [];
  }

  function saveArchivedUsers(list) {
    writeJson(ARCHIVE_KEY, list);
  }

  function findUser(id) {
    var list = getActiveUsers();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function findUserByEmail(email) {
    var key = normalizeEmail(email);
    if (!key) return null;
    var list = getActiveUsers();
    for (var i = 0; i < list.length; i++) {
      if (normalizeEmail(list[i].email) === key) return list[i];
    }
    return null;
  }

  function refreshExpiredStatuses(list) {
    var now = Date.now();
    var changed = false;
    list.forEach(function (user) {
      if (
        user.role === 'student' &&
        user.status === 'active' &&
        user.subscriptionEndsAt &&
        new Date(user.subscriptionEndsAt).getTime() < now
      ) {
        user.status = 'expired';
        changed = true;
      }
    });
    return changed;
  }

  function getActiveUsers() {
    var list = getUsers();
    if (refreshExpiredStatuses(list)) saveUsers(list);
    return list;
  }

  function formatDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('ar-IQ', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch (err) {
      return String(iso);
    }
  }

  function roleLabel(role) {
    return ROLE_LABELS[role] || role || '—';
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || status || '—';
  }

  function addUser(payload) {
    var name = String((payload && payload.name) || '').trim();
    var email = normalizeEmail(payload && payload.email);
    var role = (payload && payload.role) || 'student';
    if (!name) throw new Error('الاسم مطلوب');
    if (!email) throw new Error('البريد مطلوب');

    var exists = getUsers().some(function (u) {
      return normalizeEmail(u.email) === email;
    });
    if (exists) throw new Error('البريد مستخدم مسبقاً');

    var user = {
      id: uid(),
      name: name,
      email: email,
      role: role,
      status: (payload && payload.status) || 'active',
      createdAt: new Date().toISOString(),
      subscriptionEndsAt:
        role === 'student'
          ? (payload && payload.subscriptionEndsAt) ||
            new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
          : null,
      planId: String((payload && payload.planId) || ''),
      enrolledCourseIds: Array.isArray(payload && payload.enrolledCourseIds)
        ? payload.enrolledCourseIds
        : [],
      trialExpiresAt: (function () {
        if (payload && payload.trialExpiresAt) return Number(payload.trialExpiresAt) || Date.parse(payload.trialExpiresAt) || 0;
        if (role !== 'student') return 0;
        try {
          var raw = localStorage.getItem('ifa_platform_settings');
          var days = raw ? Number(JSON.parse(raw).freeTrialDays) : 0;
          if (isFinite(days) && days > 0) return Date.now() + days * 24 * 60 * 60 * 1000;
        } catch (err) {
          /* ignore */
        }
        return 0;
      })(),
    };
    var list = getUsers();
    list.unshift(user);
    saveUsers(list);
    return user;
  }

  function updateUser(id, patch) {
    var list = getUsers();
    var found = null;
    list = list.map(function (u) {
      if (u.id !== id) return u;
      found = Object.assign({}, u, patch || {}, { id: u.id });
      if (found.email) found.email = normalizeEmail(found.email);
      return found;
    });
    if (!found) throw new Error('المستخدم غير موجود');
    saveUsers(list);
    return found;
  }

  function setUserStatus(id, status) {
    return updateUser(id, { status: status });
  }

  function toggleSuspend(id) {
    var user = findUser(id);
    if (!user) throw new Error('المستخدم غير موجود');
    if (user.status === 'suspended') {
      var next = user.role === 'student' && isSubscriptionEnded(user) ? 'expired' : 'active';
      return setUserStatus(id, next);
    }
    return setUserStatus(id, 'suspended');
  }

  function isSubscriptionEnded(user) {
    if (!user || !user.subscriptionEndsAt) return user && user.status === 'expired';
    return new Date(user.subscriptionEndsAt).getTime() < Date.now();
  }

  function renewSubscription(id, days) {
    var addDays = typeof days === 'number' && days > 0 ? days : 90;
    var ends = new Date(Date.now() + addDays * 24 * 60 * 60 * 1000).toISOString();
    return updateUser(id, {
      subscriptionEndsAt: ends,
      status: 'active',
    });
  }

  function archiveUsers(ids) {
    var idSet = {};
    (ids || []).forEach(function (id) {
      idSet[id] = true;
    });
    var list = getUsers();
    var archive = getArchivedUsers();
    var kept = [];
    var moved = [];
    list.forEach(function (user) {
      if (idSet[user.id]) {
        var copy = Object.assign({}, user, { archivedAt: new Date().toISOString() });
        archive.unshift(copy);
        moved.push(copy);
      } else {
        kept.push(user);
      }
    });
    saveUsers(kept);
    saveArchivedUsers(archive);
    return moved;
  }

  function archiveUser(id) {
    return archiveUsers([id])[0];
  }

  function restoreUser(id) {
    var archive = getArchivedUsers();
    var found = null;
    var nextArchive = [];
    archive.forEach(function (user) {
      if (user.id === id) found = user;
      else nextArchive.push(user);
    });
    if (!found) throw new Error('العنصر غير موجود في الأرشيف');

    var restored = Object.assign({}, found);
    delete restored.archivedAt;
    if (restored.role === 'student' && isSubscriptionEnded(restored) && restored.status !== 'suspended') {
      restored.status = 'expired';
    } else if (restored.status === 'expired' && !isSubscriptionEnded(restored)) {
      restored.status = 'active';
    }

    var list = getUsers();
    list.unshift(restored);
    saveUsers(list);
    saveArchivedUsers(nextArchive);
    return restored;
  }

  function permanentDeleteUser(id) {
    var list = getUsers();
    var inActive = null;
    var nextActive = [];
    list.forEach(function (user) {
      if (user.id === id) inActive = user;
      else nextActive.push(user);
    });
    if (inActive) {
      saveUsers(nextActive);
      return inActive;
    }

    var archive = getArchivedUsers();
    var inArchive = null;
    var nextArchive = [];
    archive.forEach(function (user) {
      if (user.id === id) inArchive = user;
      else nextArchive.push(user);
    });
    if (!inArchive) throw new Error('المستخدم غير موجود');
    saveArchivedUsers(nextArchive);
    return inArchive;
  }

  function permanentDeleteUsers(ids) {
    var results = [];
    (ids || []).forEach(function (id) {
      try {
        results.push(permanentDeleteUser(id));
      } catch (err) {
        /* skip */
      }
    });
    return results;
  }

  ensureSeeded();

  global.AdminUsers = {
    getUsers: getActiveUsers,
    getArchivedUsers: getArchivedUsers,
    findUser: findUser,
    findUserByEmail: findUserByEmail,
    addUser: addUser,
    updateUser: updateUser,
    setUserStatus: setUserStatus,
    toggleSuspend: toggleSuspend,
    renewSubscription: renewSubscription,
    archiveUser: archiveUser,
    archiveUsers: archiveUsers,
    restoreUser: restoreUser,
    permanentDeleteUser: permanentDeleteUser,
    permanentDeleteUsers: permanentDeleteUsers,
    formatDate: formatDate,
    roleLabel: roleLabel,
    statusLabel: statusLabel,
    isSubscriptionEnded: isSubscriptionEnded,
    ROLE_LABELS: ROLE_LABELS,
    STATUS_LABELS: STATUS_LABELS,
  };
})(typeof window !== 'undefined' ? window : this);
