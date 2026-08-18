/**
 * Shared 6-simulator catalog, course/plan access helpers, and public homepage gating.
 */
(function (global) {
  'use strict';

  var AUTH_KEY = 'ifa_auth_user';
  var USERS_KEY = 'ifa_admin_users';
  var ADMIN_EMAILS = ['abdulazizyassin909@gmail.com'];

  var SIMULATOR_CATALOG = [
    {
      id: 'ftth-simulator',
      label: 'محاكي FTTH متكامل',
      href: 'simulator.html',
    },
    {
      id: 'otdr-simulator',
      label: 'محاكي OTDR افتراضي',
      href: '',
    },
    {
      id: 'power-meter',
      label: 'قياس القدرة البصرية',
      href: 'power-meter.html',
    },
    {
      id: 'fusion-splicer',
      label: 'مختبر Fusion Splicer',
      href: '',
    },
    {
      id: 'fiber-anatomy',
      label: 'تشريح الألياف 3D / 2D',
      href: 'fiber-3d-simulator.html',
    },
    {
      id: 'patch-panel-lab',
      label: 'محاكي FTTH Network & Patch Panel',
      href: 'ftth-lab.html',
    },
  ];

  var ALLOWED_IDS = {};
  SIMULATOR_CATALOG.forEach(function (s) {
    ALLOWED_IDS[s.id] = s;
  });

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeEmail(email) {
    return String(email || '')
      .trim()
      .toLowerCase();
  }

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (err) {
      return fallback;
    }
  }

  function getCatalog() {
    return SIMULATOR_CATALOG.slice();
  }

  function findSimulator(id) {
    return ALLOWED_IDS[String(id || '')] || null;
  }

  function normalizeSimulatorIds(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    var seen = {};
    list.forEach(function (item) {
      var id = String(item || '').trim();
      if (!ALLOWED_IDS[id] || seen[id]) return;
      seen[id] = true;
      out.push(id);
    });
    return out;
  }

  function simulatorLabels(ids) {
    return normalizeSimulatorIds(ids).map(function (id) {
      return ALLOWED_IDS[id].label;
    });
  }

  function isAdminPreviewContext() {
    try {
      if (global.self !== global.top) return true;
    } catch (err) {
      return true;
    }
    try {
      return new URLSearchParams(global.location.search).get('mode') === 'admin-preview';
    } catch (err2) {
      return false;
    }
  }

  function getLocalAuthUser() {
    if (global.IFAAuth && typeof global.IFAAuth.getLocalAuthUser === 'function') {
      return global.IFAAuth.getLocalAuthUser();
    }
    var parsed = readJson(AUTH_KEY, null);
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
      enrolledCourseIds: Array.isArray(parsed.enrolledCourseIds) ? parsed.enrolledCourseIds : [],
    };
  }

  function findDirectoryUser(email) {
    var key = normalizeEmail(email);
    if (!key) return null;
    if (global.AdminUsers && typeof global.AdminUsers.getUsers === 'function') {
      var fromAdmin = global.AdminUsers.getUsers();
      for (var i = 0; i < fromAdmin.length; i++) {
        if (normalizeEmail(fromAdmin[i].email) === key) return fromAdmin[i];
      }
    }
    var list = readJson(USERS_KEY, []);
    if (!Array.isArray(list)) return null;
    for (var j = 0; j < list.length; j++) {
      if (normalizeEmail(list[j] && list[j].email) === key) return list[j];
    }
    return null;
  }

  function isPrivilegedRole(authUser, directoryUser) {
    var role = String(
      (directoryUser && directoryUser.role) || (authUser && authUser.role) || ''
    ).toLowerCase();
    if (role === 'admin' || role === 'instructor') return true;
    if (authUser && (authUser.isAdmin || authUser.isInstructor)) {
      if (directoryUser && String(directoryUser.role || '').toLowerCase() === 'student') {
        return false;
      }
      return true;
    }
    var email = normalizeEmail((directoryUser && directoryUser.email) || (authUser && authUser.email));
    return ADMIN_EMAILS.indexOf(email) !== -1;
  }

  function getPublishedCourses() {
    if (global.PlatformCourses && typeof global.PlatformCourses.getPublished === 'function') {
      return global.PlatformCourses.getPublished();
    }
    var list = readJson('platform_courses', []);
    if (!Array.isArray(list)) return [];
    return list.filter(function (c) {
      return c && c.status === 'published' && !c.softDeleted;
    });
  }

  function getPlans() {
    if (global.PlatformPlans && typeof global.PlatformPlans.getPlans === 'function') {
      return global.PlatformPlans.getPlans();
    }
    var primary = readJson('platform_plans', null);
    var alias = readJson('ifa_pricing_plans', null);
    var list = Array.isArray(primary) && primary.length ? primary : alias;
    return Array.isArray(list) ? list : [];
  }

  function findPlan(id) {
    var key = String(id || '');
    if (!key) return null;
    if (global.PlatformPlans && typeof global.PlatformPlans.findPlan === 'function') {
      return global.PlatformPlans.findPlan(key);
    }
    var plans = getPlans();
    for (var i = 0; i < plans.length; i++) {
      if (String(plans[i].id) === key) return plans[i];
    }
    return null;
  }

  function findCourse(id) {
    var key = String(id || '');
    if (!key) return null;
    if (global.PlatformCourses && typeof global.PlatformCourses.findCourse === 'function') {
      return global.PlatformCourses.findCourse(key);
    }
    var list = getPublishedCourses();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === key) return list[i];
    }
    return null;
  }

  function simulatorsFromCourse(course) {
    if (!course) return [];
    return normalizeSimulatorIds(course.allowedSimulators);
  }

  function simulatorsFromPlan(plan) {
    if (!plan) return [];
    var fromPlan = normalizeSimulatorIds(plan.allowedSimulators);
    if (fromPlan.length) return fromPlan;
    var union = [];
    var seen = {};
    getPublishedCourses().forEach(function (course) {
      var linked =
        course.requiredPlanId && String(course.requiredPlanId) === String(plan.id);
      var matches =
        linked ||
        (global.PlatformPlans &&
          typeof global.PlatformPlans.courseMatchesPlan === 'function' &&
          global.PlatformPlans.courseMatchesPlan(course, plan));
      if (!matches) return;
      simulatorsFromCourse(course).forEach(function (id) {
        if (seen[id]) return;
        seen[id] = true;
        union.push(id);
      });
    });
    return union;
  }

  function courseUnlockingSimulator(simulatorId) {
    var id = String(simulatorId || '');
    var courses = getPublishedCourses();
    for (var i = 0; i < courses.length; i++) {
      if (simulatorsFromCourse(courses[i]).indexOf(id) !== -1) return courses[i];
    }
    var all =
      global.PlatformCourses && typeof global.PlatformCourses.getCourses === 'function'
        ? global.PlatformCourses.getCourses()
        : readJson('platform_courses', []);
    if (!Array.isArray(all)) return null;
    for (var j = 0; j < all.length; j++) {
      var c = all[j];
      if (!c || c.softDeleted) continue;
      if (simulatorsFromCourse(c).indexOf(id) !== -1) return c;
    }
    return null;
  }

  function lockLabelForSimulator(simulatorId) {
    var course = courseUnlockingSimulator(simulatorId);
    var sim = findSimulator(simulatorId);
    var name = (course && course.title) || (sim && sim.label) || 'مناسب';
    return 'مغلق - يتطلب الاشتراك في كورس ' + name;
  }

  function collectViewerSimulatorIds(authUser, directoryUser) {
    var ids = [];
    var seen = {};

    function add(list) {
      normalizeSimulatorIds(list).forEach(function (id) {
        if (seen[id]) return;
        seen[id] = true;
        ids.push(id);
      });
    }

    var planId = String(
      (directoryUser && (directoryUser.planId || directoryUser.subscribedPlanId)) ||
        (authUser && authUser.planId) ||
        ''
    );
    var plan = findPlan(planId);
    if (plan) add(simulatorsFromPlan(plan));

    var enrolled = [];
    if (directoryUser && Array.isArray(directoryUser.enrolledCourseIds)) {
      enrolled = enrolled.concat(directoryUser.enrolledCourseIds);
    }
    if (authUser && Array.isArray(authUser.enrolledCourseIds)) {
      enrolled = enrolled.concat(authUser.enrolledCourseIds);
    }
    enrolled.forEach(function (courseId) {
      add(simulatorsFromCourse(findCourse(courseId)));
    });

    return ids;
  }

  function resolveViewerAccess() {
    if (isAdminPreviewContext()) {
      return {
        role: 'admin',
        unlocked: true,
        simulatorIds: SIMULATOR_CATALOG.map(function (s) {
          return s.id;
        }),
      };
    }

    var authUser = getLocalAuthUser();
    if (!authUser) {
      return { role: 'guest', unlocked: false, simulatorIds: [] };
    }

    var directoryUser = findDirectoryUser(authUser.email);
    if (isPrivilegedRole(authUser, directoryUser)) {
      return {
        role: String((directoryUser && directoryUser.role) || authUser.role || 'admin').toLowerCase(),
        unlocked: true,
        simulatorIds: SIMULATOR_CATALOG.map(function (s) {
          return s.id;
        }),
      };
    }

    var studentActive = true;
    if (directoryUser) {
      if (String(directoryUser.status || '').toLowerCase() === 'suspended') studentActive = false;
      if (
        global.AdminUsers &&
        typeof global.AdminUsers.isSubscriptionEnded === 'function' &&
        global.AdminUsers.isSubscriptionEnded(directoryUser)
      ) {
        studentActive = false;
      } else if (directoryUser.subscriptionEndsAt) {
        studentActive = new Date(directoryUser.subscriptionEndsAt).getTime() >= Date.now();
      }
    }

    if (!studentActive) {
      return { role: 'student', unlocked: false, simulatorIds: [] };
    }

    return {
      role: 'student',
      unlocked: false,
      simulatorIds: collectViewerSimulatorIds(authUser, directoryUser),
    };
  }

  function viewerCanAccess(simulatorId) {
    var access = resolveViewerAccess();
    if (access.unlocked) return true;
    return access.simulatorIds.indexOf(String(simulatorId || '')) !== -1;
  }

  function withPreviewQuery(href) {
    if (!href) return href;
    if (!isAdminPreviewContext()) return href;
    return href + (href.indexOf('?') === -1 ? '?' : '&') + 'mode=admin-preview';
  }

  function applyPublicSimulatorGates() {
    var cards = document.querySelectorAll('[data-simulator-card][data-simulator-id]');
    if (!cards.length) return;
    var access = resolveViewerAccess();

    cards.forEach(function (card) {
      var id = card.getAttribute('data-simulator-id') || '';
      var href = card.getAttribute('data-simulator-href') || (findSimulator(id) && findSimulator(id).href) || '';
      var allowed = access.unlocked || access.simulatorIds.indexOf(id) !== -1;
      card.classList.toggle('feature-card--locked', !allowed);
      card.classList.toggle('feature-card--unlocked', allowed);
      card.setAttribute('data-simulator-locked', allowed ? '0' : '1');

      var accessEl = card.querySelector('[data-simulator-access]');
      if (!accessEl) {
        accessEl = document.createElement('div');
        accessEl.className = 'feature-card__access';
        accessEl.setAttribute('data-simulator-access', '');
        card.appendChild(accessEl);
      }

      if (allowed) {
        var openHref = withPreviewQuery(href);
        accessEl.innerHTML = openHref
          ? '<a class="feature-card__open-btn" href="' +
            escapeHtml(openHref) +
            '">افتح المحاكي</a>'
          : '<span class="feature-card__open-btn feature-card__open-btn--soon">افتح المحاكي</span>';
      } else {
        accessEl.innerHTML =
          '<span class="feature-card__lock-badge">' +
          escapeHtml(lockLabelForSimulator(id)) +
          '</span>';
      }
    });
  }

  function enrolledCourseIdsForPlan(plan) {
    if (!plan) return [];
    return getPublishedCourses()
      .filter(function (course) {
        if (course.requiredPlanId && String(course.requiredPlanId) === String(plan.id)) return true;
        return (
          global.PlatformPlans &&
          typeof global.PlatformPlans.courseMatchesPlan === 'function' &&
          global.PlatformPlans.courseMatchesPlan(course, plan)
        );
      })
      .map(function (c) {
        return c.id;
      });
  }

  function persistAuthSubscription(planId, enrolledCourseIds) {
    var current = readJson(AUTH_KEY, null);
    if (!current || !normalizeEmail(current.email)) return null;
    current.planId = String(planId || '');
    current.enrolledCourseIds = Array.isArray(enrolledCourseIds) ? enrolledCourseIds : [];
    current.isSubscriber = true;
    try {
      localStorage.setItem(AUTH_KEY, JSON.stringify(current));
    } catch (err) {
      console.error('[PlatformSimulators] auth subscription save failed', err);
    }
    if (global.IFAAuth && typeof global.IFAAuth.setLocalAuthUser === 'function') {
      global.IFAAuth.setLocalAuthUser(current);
    }
    return current;
  }

  function persistDirectorySubscription(email, planId, enrolledCourseIds) {
    var key = normalizeEmail(email);
    if (!key) return;
    if (global.AdminUsers && typeof global.AdminUsers.getUsers === 'function') {
      var users = global.AdminUsers.getUsers();
      var match = null;
      users.forEach(function (u) {
        if (normalizeEmail(u.email) === key) match = u;
      });
      if (match && typeof global.AdminUsers.updateUser === 'function') {
        global.AdminUsers.updateUser(match.id, {
          planId: String(planId || ''),
          enrolledCourseIds: enrolledCourseIds || [],
          status: 'active',
        });
        return;
      }
    }
    var list = readJson(USERS_KEY, []);
    if (!Array.isArray(list)) return;
    var changed = false;
    list = list.map(function (u) {
      if (normalizeEmail(u && u.email) !== key) return u;
      changed = true;
      return Object.assign({}, u, {
        planId: String(planId || ''),
        enrolledCourseIds: enrolledCourseIds || [],
        status: 'active',
      });
    });
    if (!changed) return;
    try {
      localStorage.setItem(USERS_KEY, JSON.stringify(list));
    } catch (err) {
      /* ignore */
    }
  }

  function subscribeCurrentUserToPlan(planId) {
    var plan = findPlan(planId);
    if (!plan) throw new Error('الباقة غير موجودة');
    var authUser = getLocalAuthUser();
    if (!authUser) throw new Error('يرجى تسجيل الدخول أولاً للاشتراك');
    var enrolled = enrolledCourseIdsForPlan(plan);
    persistAuthSubscription(plan.id, enrolled);
    persistDirectorySubscription(authUser.email, plan.id, enrolled);
    applyPublicSimulatorGates();
    try {
      global.dispatchEvent(
        new CustomEvent('ifa:subscription-changed', { detail: { planId: plan.id } })
      );
    } catch (err) {
      /* ignore */
    }
    return { plan: plan, enrolledCourseIds: enrolled };
  }

  function bindPublicRefresh() {
    if (!document.querySelector('[data-simulator-card]')) return;
    applyPublicSimulatorGates();
    global.addEventListener('load', applyPublicSimulatorGates);
    global.addEventListener('ifa:local-auth-changed', applyPublicSimulatorGates);
    global.addEventListener('ifa:subscription-changed', applyPublicSimulatorGates);
    global.addEventListener('ifa:platform-courses-changed', applyPublicSimulatorGates);
    global.addEventListener('ifa:platform-plans-changed', applyPublicSimulatorGates);
    global.addEventListener('storage', function (e) {
      if (
        !e.key ||
        e.key === AUTH_KEY ||
        e.key === 'platform_courses' ||
        e.key === 'platform_plans' ||
        e.key === 'ifa_pricing_plans' ||
        e.key === USERS_KEY
      ) {
        applyPublicSimulatorGates();
      }
    });
  }

  global.PlatformSimulators = {
    CATALOG: SIMULATOR_CATALOG,
    getCatalog: getCatalog,
    findSimulator: findSimulator,
    normalizeSimulatorIds: normalizeSimulatorIds,
    simulatorLabels: simulatorLabels,
    viewerCanAccess: viewerCanAccess,
    resolveViewerAccess: resolveViewerAccess,
    courseUnlockingSimulator: courseUnlockingSimulator,
    lockLabelForSimulator: lockLabelForSimulator,
    applyPublicSimulatorGates: applyPublicSimulatorGates,
    subscribeCurrentUserToPlan: subscribeCurrentUserToPlan,
    simulatorsFromCourse: simulatorsFromCourse,
    simulatorsFromPlan: simulatorsFromPlan,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindPublicRefresh);
  } else {
    bindPublicRefresh();
  }
})(typeof window !== 'undefined' ? window : this);
