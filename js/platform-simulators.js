/**
 * Shared 6-simulator catalog, course/plan access helpers, and public homepage gating.
 */
(function (global) {
  'use strict';

  var AUTH_KEY = 'ifa_auth_user';
  var USERS_KEY = 'ifa_admin_users';
  var SETTINGS_KEY = 'ifa_platform_settings';
  var META_KEY = 'ifa_simulators_meta';
  var ADMIN_EMAILS = ['abdulazizyassin909@gmail.com'];
  var firestorePlanCache = {};
  var warmEntitlementPromise = null;

  var SIMULATOR_CATALOG = [
    {
      id: 'ftth-simulator',
      label: 'محاكي FTTH متكامل',
      navLabel: 'FTTH Map Sim',
      href: 'simulator.html',
    },
    {
      id: 'otdr-simulator',
      label: 'مختبر OTDR (OTDR Lab)',
      navLabel: 'OTDR',
      href: 'otdr-lab.html',
    },
    {
      id: 'power-meter',
      label: 'قياس القدرة البصرية',
      navLabel: 'Power Meter',
      href: 'power-meter.html',
    },
    {
      id: 'fusion-splicer',
      label: 'مختبر لحام الألياف الضوئية (Fusion Splicer Lab)',
      navLabel: 'Fusion Splicer',
      href: 'fusion-splicer.html',
    },
    {
      id: 'fiber-anatomy',
      label: 'تشريح الألياف 3D / 2D',
      navLabel: 'Cable Anatomy',
      href: 'fiber-3d-simulator.html',
    },
    {
      id: 'patch-panel-lab',
      label: 'محاكي FTTH Network & Patch Panel',
      navLabel: 'FTTH Lab',
      href: 'ftth-lab.html',
    },
  ];

  var PAYWALL_TOAST_MSG = 'يتطلب فتح هذا المحاكي الاشتراك في باقة تدريبية';
  var PAYWALL_PLAN_KEY = 'ifa_paywall_plan';
  var PAYWALL_SIM_KEY = 'ifa_paywall_sim';

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

  function defaultSimulatorMeta() {
    return {
      'ftth-simulator': {
        title: 'محاكي FTTH متكامل',
        description:
          'صمّم واربط شبكات الألياف الضوئية من OLT حتى منزل المشترك مع محاكاة واقعية لكل مكوّن في الشبكة.',
        icon: '🌐',
        iconType: 'emoji',
      },
      'otdr-simulator': {
        title: 'مختبر OTDR (OTDR Lab)',
        description:
          'ورشة OTDR كاملة بنفس مختبر لحام الألياف: بناء الشبكة، اللحام، القطع، ثم إضافة منحنيات الانعكاس واختبارات OTDR.',
        icon: '📊',
        iconType: 'emoji',
      },
      'power-meter': {
        title: 'قياس القدرة البصرية',
        description:
          'مدرّب OPM احترافي: أطوال موجية 1310/1490/1550، تحويل dBm↔mW، مرجع الخسارة، ومؤشرات Pass/Warning/Fail وفق GPON و EPON — مع ورشة ربط مصغّرة (Patch Cord · Pigtail · Splitter) لاختبار المسارات مباشرة بجانب جهاز القياس.',
        icon: '⚡',
        iconType: 'emoji',
      },
      'fusion-splicer': {
        title: 'مختبر لحام الألياف الضوئية (Fusion Splicer Lab)',
        description:
          'تعلّم عمليات اللحام البصري (Fusion Splicing) وإدارة الكابلات والموصلات بطريقة تفاعلية خطوة بخطوة.',
        icon: '🔬',
        iconType: 'emoji',
      },
      'fiber-anatomy': {
        title: 'Fiber Optics 3D / 2D Interactive Anatomy',
        description:
          'شرّح كابلات Last Mile وFTTH حتى 288F: الغلاف → الأنابيب → 6 أو 12 ليف لكل أنبوب، مع تمييز 48F Last Mile و48F Feeder، وعلامات الشريط الأوسط لأنابيب T13–T24 في كابل 288F.',
        icon: '🧬',
        iconType: 'emoji',
      },
      'patch-panel-lab': {
        title: 'FTTH Network & Patch Panel Lab',
        description:
          'مختبر FTTH: مقسمات PLC، أسلاك Patch Cord بطرفي A وB بنفس منطق السحب اليدوي (بدون تتبع تلقائي)، يُحفظ المسار عند الإطباق (SC/APC أخضر · SC/PC أزرق)، مع تنبيه عدم التوافق وخصم خسارة إضافي دون حظر التوصيل.',
        icon: '🔌',
        iconType: 'emoji',
      },
    };
  }

  function getSimulatorMeta() {
    var stored = readJson(META_KEY, {});
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) stored = {};
    var defaults = defaultSimulatorMeta();
    var out = {};
    SIMULATOR_CATALOG.forEach(function (s) {
      var d = defaults[s.id] || {};
      var m = stored[s.id] || {};
      var iconType = m.iconType === 'image' ? 'image' : 'emoji';
      out[s.id] = {
        title: String(m.title != null ? m.title : d.title || s.label).trim() || s.label,
        description: String(m.description != null ? m.description : d.description || '').trim(),
        icon: String(m.icon != null ? m.icon : d.icon || '◆'),
        iconType: iconType,
      };
    });
    return out;
  }

  function saveSimulatorMeta(partial) {
    var current = getSimulatorMeta();
    var incoming = partial && typeof partial === 'object' ? partial : {};
    SIMULATOR_CATALOG.forEach(function (s) {
      if (!incoming[s.id]) return;
      var m = incoming[s.id];
      current[s.id] = {
        title: String(m.title != null ? m.title : current[s.id].title).trim() || current[s.id].title,
        description: String(m.description != null ? m.description : current[s.id].description),
        icon: String(m.icon != null ? m.icon : current[s.id].icon),
        iconType: m.iconType === 'image' ? 'image' : 'emoji',
      };
    });
    try {
      localStorage.setItem(META_KEY, JSON.stringify(current));
    } catch (err) {
      console.error('[PlatformSimulators] meta save failed', err);
    }
    applySimulatorMetaToCards();
    try {
      global.dispatchEvent(new CustomEvent('ifa:simulators-meta-changed', { detail: current }));
    } catch (err2) {
      /* ignore */
    }
    return current;
  }

  function iconHtml(meta) {
    if (!meta) return '◆';
    if (meta.iconType === 'image' && meta.icon) {
      return '<img class="feature-card__icon-img" src="' + escapeHtml(meta.icon) + '" alt="" />';
    }
    return escapeHtml(meta.icon || '◆');
  }

  function applySimulatorMetaToCards() {
    var metaMap = getSimulatorMeta();
    document.querySelectorAll('[data-simulator-card][data-simulator-id]').forEach(function (card) {
      var id = card.getAttribute('data-simulator-id') || '';
      var meta = metaMap[id];
      if (!meta) return;
      card.classList.remove('feature-card--power-meter');
      var iconEl = card.querySelector('.feature-card__icon');
      var titleEl = card.querySelector('.feature-card__title');
      var descEl = card.querySelector('.feature-card__desc');
      if (iconEl) iconEl.innerHTML = iconHtml(meta);
      if (titleEl) titleEl.textContent = meta.title;
      if (descEl) descEl.textContent = meta.description;
    });
  }

  function getCatalog() {
    var meta = getSimulatorMeta();
    return SIMULATOR_CATALOG.map(function (s) {
      var m = meta[s.id] || {};
      return Object.assign({}, s, {
        label: m.title || s.label,
        description: m.description || '',
        icon: m.icon,
        iconType: m.iconType,
      });
    });
  }

  function findSimulator(id) {
    var base = ALLOWED_IDS[String(id || '')] || null;
    if (!base) return null;
    var meta = getSimulatorMeta()[base.id];
    if (!meta) return Object.assign({}, base);
    return Object.assign({}, base, {
      label: meta.title || base.label,
      description: meta.description || '',
      icon: meta.icon,
      iconType: meta.iconType,
    });
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
      var sim = findSimulator(id);
      return (sim && sim.label) || ALLOWED_IDS[id].label;
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
      allowedSimulators: Array.isArray(parsed.allowedSimulators) ? parsed.allowedSimulators : [],
      trialExpiresAt: Number(parsed.trialExpiresAt) || 0,
    };
  }

  var COMING_SOON_MSG = 'هذا المحاكي قيد التطوير حالياً — سيتوفر قريباً';
  var COMING_SOON_BADGE = 'قريباً — قيد التطوير';

  function defaultPlatformSettings() {
    return { freeSimulatorIds: [], comingSoonSimulatorIds: [], freeTrialDays: 0 };
  }

  function getPlatformSettings() {
    var parsed = readJson(SETTINGS_KEY, null);
    var base = defaultPlatformSettings();
    if (!parsed || typeof parsed !== 'object') return base;
    base.freeSimulatorIds = normalizeSimulatorIds(parsed.freeSimulatorIds);
    base.comingSoonSimulatorIds = normalizeSimulatorIds(parsed.comingSoonSimulatorIds);
    var days = Number(parsed.freeTrialDays);
    base.freeTrialDays = isFinite(days) && days > 0 ? Math.min(365, Math.round(days)) : 0;
    return base;
  }

  function savePlatformSettings(patch) {
    var next = Object.assign(defaultPlatformSettings(), getPlatformSettings(), patch || {});
    next.freeSimulatorIds = normalizeSimulatorIds(next.freeSimulatorIds);
    next.comingSoonSimulatorIds = normalizeSimulatorIds(next.comingSoonSimulatorIds);
    var days = Number(next.freeTrialDays);
    next.freeTrialDays = isFinite(days) && days > 0 ? Math.min(365, Math.round(days)) : 0;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch (err) {
      console.error('[PlatformSimulators] settings save failed', err);
    }
    try {
      global.dispatchEvent(new CustomEvent('ifa:platform-settings-changed', { detail: next }));
    } catch (err2) {
      /* ignore */
    }
    return next;
  }

  function isGloballyFreeSimulator(simulatorId) {
    return getPlatformSettings().freeSimulatorIds.indexOf(String(simulatorId || '')) !== -1;
  }

  function isSimulatorUnderDevelopment(simulatorId) {
    return getPlatformSettings().comingSoonSimulatorIds.indexOf(String(simulatorId || '')) !== -1;
  }

  function trialExpiryMs(user) {
    if (!user) return 0;
    var t = user.trialExpiresAt;
    if (t == null || t === '') return 0;
    var n = typeof t === 'number' ? t : Date.parse(t);
    return isFinite(n) ? n : 0;
  }

  function hasActiveTrial(user) {
    return trialExpiryMs(user) > Date.now();
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

  function cacheFirestorePlan(planId, planData) {
    var key = String(planId || '');
    if (!key || !planData) return null;
    var plan = Object.assign({ id: key }, planData);
    firestorePlanCache[key] = plan;
    return plan;
  }

  function ensurePlanCached(planId) {
    var key = String(planId || '');
    if (!key) return Promise.resolve(null);
    var existing = findPlan(key);
    if (existing) return Promise.resolve(existing);
    if (firestorePlanCache[key]) return Promise.resolve(firestorePlanCache[key]);

    return import('./firebase-config.js')
      .then(function (mod) {
        return import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js').then(function (fs) {
          return fs.getDoc(fs.doc(mod.db, 'pricing', key)).then(function (snap) {
            if (!snap.exists()) return null;
            return cacheFirestorePlan(key, snap.data());
          });
        });
      })
      .catch(function (err) {
        console.warn('[PlatformSimulators] ensurePlanCached failed for', key, err);
        return null;
      });
  }

  function resolvePlanIdForUser(authUser, directoryUser) {
    return String(
      (directoryUser && (directoryUser.planId || directoryUser.subscribedPlanId)) ||
        (authUser && authUser.planId) ||
        ''
    );
  }

  function warmEntitlementCaches(authUser, directoryUser) {
    var planId = resolvePlanIdForUser(authUser, directoryUser);
    if (!planId) return Promise.resolve(null);
    if (warmEntitlementPromise) return warmEntitlementPromise;
    warmEntitlementPromise = ensurePlanCached(planId).finally(function () {
      warmEntitlementPromise = null;
    });
    return warmEntitlementPromise;
  }

  function findPlan(id) {
    var key = String(id || '');
    if (!key) return null;
    if (firestorePlanCache[key]) return firestorePlanCache[key];
    if (global.PlatformPlans && typeof global.PlatformPlans.findPlan === 'function') {
      var fromApi = global.PlatformPlans.findPlan(key);
      if (fromApi) return fromApi;
    }
    if (
      global.PlatformPricingFirestore &&
      typeof global.PlatformPricingFirestore.findPlan === 'function'
    ) {
      var fromFs = global.PlatformPricingFirestore.findPlan(key);
      if (fromFs) return fromFs;
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
    return PAYWALL_TOAST_MSG;
  }

  function recommendedPlanForSimulator(simulatorId) {
    var id = String(simulatorId || '');
    var plans = getPlans();
    var matches = [];
    plans.forEach(function (plan) {
      if (simulatorsFromPlan(plan).indexOf(id) !== -1) matches.push(plan);
    });
    matches.sort(function (a, b) {
      var rank = (a.accessRank || 0) - (b.accessRank || 0);
      if (rank) return rank;
      return (Number(a.price) || 0) - (Number(b.price) || 0);
    });
    if (matches.length) return matches[0];
    for (var i = 0; i < plans.length; i++) {
      if (plans[i].featured) return plans[i];
    }
    return plans[0] || null;
  }

  function currentPageFile() {
    try {
      var path = String(global.location.pathname || '').replace(/\\/g, '/');
      var file = path.split('/').pop() || '';
      if (!file && global.location.href) {
        file = String(global.location.href).split('/').pop().split('?')[0].split('#')[0];
      }
      return decodeURIComponent(file).toLowerCase();
    } catch (err) {
      return '';
    }
  }

  function currentSimulatorIdFromLocation() {
    var file = currentPageFile();
    for (var i = 0; i < SIMULATOR_CATALOG.length; i++) {
      var href = String(SIMULATOR_CATALOG[i].href || '')
        .split('?')[0]
        .split('#')[0]
        .toLowerCase();
      if (href && href === file) return SIMULATOR_CATALOG[i].id;
    }
    return '';
  }

  function showPaywallNotice(message) {
    var text = message || PAYWALL_TOAST_MSG;
    var el = document.getElementById('ifa-paywall-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ifa-paywall-toast';
      el.className = 'ifa-paywall-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('is-visible');
    if (el._hideTimer) clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(function () {
      el.classList.remove('is-visible');
    }, 3400);
  }

  function paywallRedirectUrl(simulatorId) {
    var plan = recommendedPlanForSimulator(simulatorId);
    try {
      if (plan) sessionStorage.setItem(PAYWALL_PLAN_KEY, String(plan.id));
      sessionStorage.setItem(PAYWALL_SIM_KEY, String(simulatorId || ''));
    } catch (err) {
      /* ignore */
    }
    var qs = 'needSim=' + encodeURIComponent(simulatorId || '');
    if (plan) qs += '&highlightPlan=' + encodeURIComponent(plan.id);
    return 'index.html?' + qs + '#plans';
  }

  function showSimulatorDevLock(simulatorId) {
    var id = String(simulatorId || '');
    var sim = findSimulator(id);
    var title = (sim && sim.label) || id || 'المحاكي';
    var existing = document.getElementById('ifa-sim-dev-lock');
    if (existing) {
      existing.hidden = false;
      existing.setAttribute('aria-hidden', 'false');
      document.body.classList.add('ifa-sim-dev-lock-active');
      return;
    }
    var overlay = document.createElement('div');
    overlay.id = 'ifa-sim-dev-lock';
    overlay.className = 'ifa-sim-dev-lock';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'ifa-sim-dev-lock-title');
    overlay.innerHTML =
      '<div class="ifa-sim-dev-lock__backdrop" aria-hidden="true"></div>' +
      '<div class="ifa-sim-dev-lock__card">' +
      '<span class="ifa-sim-dev-lock__badge">' +
      escapeHtml(COMING_SOON_BADGE) +
      '</span>' +
      '<h2 class="ifa-sim-dev-lock__title" id="ifa-sim-dev-lock-title">' +
      escapeHtml(title) +
      '</h2>' +
      '<p class="ifa-sim-dev-lock__message">' +
      escapeHtml(COMING_SOON_MSG) +
      '</p>' +
      '<div class="ifa-sim-dev-lock__actions">' +
      '<a class="ifa-sim-dev-lock__btn ifa-sim-dev-lock__btn--primary" href="index.html#simulators">العودة إلى المحاكيات</a>' +
      '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    document.body.classList.add('ifa-sim-dev-lock-active');
  }

  function enforceSimulatorPageAccess() {
    var id = currentSimulatorIdFromLocation();
    if (!id) return;
    if (isSimulatorUnderDevelopment(id) && !isAdminPreviewContext()) {
      showSimulatorDevLock(id);
      return;
    }
    if (isAdminPreviewContext()) return;
    if (viewerCanAccess(id)) return;
    showPaywallNotice(PAYWALL_TOAST_MSG);
    global.location.replace(paywallRedirectUrl(id));
  }

  function interceptSimulatorLaunch(simulatorId, href) {
    var id = String(simulatorId || '');
    if (isSimulatorUnderDevelopment(id) && !isAdminPreviewContext()) {
      showPaywallNotice(COMING_SOON_MSG);
      return false;
    }
    var openHref = withPreviewQuery(href || (findSimulator(id) && findSimulator(id).href) || '');
    if (viewerCanAccess(id)) {
      if (!openHref) {
        showPaywallNotice('هذا المحاكي قيد الإعداد — سيكون متاحاً قريباً');
        return false;
      }
      global.location.href = openHref;
      return true;
    }
    showPaywallNotice(PAYWALL_TOAST_MSG);
    setTimeout(function () {
      global.location.href = paywallRedirectUrl(id);
    }, 650);
    return false;
  }

  function highlightTargetPlan() {
    var pricing = document.getElementById('pricing') || document.getElementById('plans');
    if (!pricing && !document.querySelector('.pricing-card')) return;

    var params;
    try {
      params = new URLSearchParams(global.location.search);
    } catch (err) {
      params = { get: function () { return ''; } };
    }
    var planId = String(params.get('highlightPlan') || '');
    var simId = String(params.get('needSim') || '');
    try {
      if (!planId) planId = sessionStorage.getItem(PAYWALL_PLAN_KEY) || '';
      if (!simId) simId = sessionStorage.getItem(PAYWALL_SIM_KEY) || '';
    } catch (err2) {
      /* ignore */
    }
    if (!planId && simId) {
      var rec = recommendedPlanForSimulator(simId);
      planId = rec ? String(rec.id) : '';
    }
    if (!planId) return;

    var cards = document.querySelectorAll('.pricing-card[data-plan-id]');
    if (!cards.length) return;
    var target = null;
    cards.forEach(function (card) {
      var match = String(card.getAttribute('data-plan-id')) === planId;
      card.classList.toggle('pricing-card--paywall-target', match);
      if (match) target = card;
    });
    var hash = String(global.location.hash || '');
    if ((hash === '#pricing' || hash === '#plans') && target) {
      setTimeout(function () {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 80);
    }
  }

  function enrolledSwitcherSimulators() {
    var access = resolveViewerAccess();
    var current = currentSimulatorIdFromLocation();
    var ids = access.unlocked
      ? SIMULATOR_CATALOG.map(function (s) {
          return s.id;
        })
      : access.simulatorIds.slice();
    return normalizeSimulatorIds(ids).filter(function (id) {
      if (id === current) return false;
      if (isSimulatorUnderDevelopment(id)) return false;
      var sim = findSimulator(id);
      return !!(sim && sim.href);
    });
  }

  function renderSimulatorSwitchers() {
    var hosts = document.querySelectorAll('[data-sim-switcher]');
    if (!hosts.length) return;
    var items = enrolledSwitcherSimulators();
    hosts.forEach(function (host) {
      var linkClass = host.getAttribute('data-sim-switcher-class') || 'sim-switcher__link';
      host.innerHTML = items
        .map(function (id) {
          var sim = findSimulator(id);
          var href = withPreviewQuery(sim.href);
          return (
            '<a class="' +
            escapeHtml(linkClass) +
            '" href="' +
            escapeHtml(href) +
            '">' +
            escapeHtml(sim.navLabel || sim.label) +
            '</a>'
          );
        })
        .join('');
    });
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

  function getUserAllowedSimulatorIds(authUser, directoryUser) {
    var ids = [];
    var seen = {};

    function add(list) {
      normalizeSimulatorIds(list).forEach(function (id) {
        if (seen[id]) return;
        seen[id] = true;
        ids.push(id);
      });
    }

    if (authUser && Array.isArray(authUser.allowedSimulators)) {
      add(authUser.allowedSimulators);
    }
    if (directoryUser && Array.isArray(directoryUser.allowedSimulators)) {
      add(directoryUser.allowedSimulators);
    }

    var planId = resolvePlanIdForUser(authUser, directoryUser);
    if (planId || !ids.length) {
      add(collectViewerSimulatorIds(authUser, directoryUser));
    }
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
      return {
        role: 'guest',
        unlocked: false,
        simulatorIds: getPlatformSettings().freeSimulatorIds.slice(),
      };
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
      return {
        role: 'student',
        unlocked: false,
        simulatorIds: getPlatformSettings().freeSimulatorIds.slice(),
      };
    }

    var ids = getUserAllowedSimulatorIds(authUser, directoryUser);
    getPlatformSettings().freeSimulatorIds.forEach(function (id) {
      if (ids.indexOf(id) === -1) ids.push(id);
    });
    return {
      role: 'student',
      unlocked: false,
      simulatorIds: ids,
    };
  }

  function viewerCanAccess(simulatorId) {
    var id = String(simulatorId || '');
    if (isGloballyFreeSimulator(id)) return true;

    if (isAdminPreviewContext()) return true;

    var authUser = getLocalAuthUser();
    if (!authUser) return false;

    var directoryUser = findDirectoryUser(authUser.email);
    if (isPrivilegedRole(authUser, directoryUser)) return true;

    var permitted = getUserAllowedSimulatorIds(authUser, directoryUser);
    getPlatformSettings().freeSimulatorIds.forEach(function (freeId) {
      if (permitted.indexOf(freeId) === -1) permitted.push(freeId);
    });
    return permitted.indexOf(id) !== -1;
  }

  function withPreviewQuery(href) {
    if (!href) return href;
    if (!isAdminPreviewContext()) return href;
    return href + (href.indexOf('?') === -1 ? '?' : '&') + 'mode=admin-preview';
  }

  function applyPublicSimulatorGates() {
    var cards = document.querySelectorAll('[data-simulator-card][data-simulator-id]');
    if (!cards.length) return;
    applySimulatorMetaToCards();

    cards.forEach(function (card) {
      var id = card.getAttribute('data-simulator-id') || '';
      var href = card.getAttribute('data-simulator-href') || (findSimulator(id) && findSimulator(id).href) || '';
      var underDev = isSimulatorUnderDevelopment(id);
      card.classList.remove('feature-card--locked', 'feature-card--dev');
      card.classList.add('feature-card--unlocked');
      card.removeAttribute('data-simulator-locked');
      card.removeAttribute('data-simulator-dev');

      var existingSoon = card.querySelector('.feature-card__soon-badge');
      if (existingSoon) existingSoon.remove();

      var accessEl = card.querySelector('[data-simulator-access]');
      if (!accessEl) {
        accessEl = document.createElement('div');
        accessEl.className = 'feature-card__access';
        accessEl.setAttribute('data-simulator-access', '');
        card.appendChild(accessEl);
      }

      if (underDev) {
        card.classList.add('feature-card--dev');
        card.classList.remove('feature-card--unlocked');
        card.setAttribute('data-simulator-dev', '1');
        var soonBadge = document.createElement('span');
        soonBadge.className = 'feature-card__soon-badge';
        soonBadge.textContent = COMING_SOON_BADGE;
        card.insertBefore(soonBadge, card.firstChild);
        if (isAdminPreviewContext()) {
          var previewHref = withPreviewQuery(href);
          accessEl.innerHTML =
            '<a class="feature-card__open-btn" href="' +
            escapeHtml(previewHref || '#simulators') +
            '" data-simulator-launch="' +
            escapeHtml(id) +
            '">معاينة (المسؤول)</a>';
        } else {
          accessEl.innerHTML =
            '<button type="button" class="feature-card__open-btn feature-card__open-btn--soon" disabled aria-disabled="true" data-simulator-launch="' +
            escapeHtml(id) +
            '">قيد التطوير</button>';
        }
        return;
      }

      var allowed = viewerCanAccess(id);
      var openHref = withPreviewQuery(href);
      var free = isGloballyFreeSimulator(id);
      accessEl.innerHTML =
        (free
          ? '<span class="feature-card__free-badge">مجاني</span>'
          : '') +
        '<a class="feature-card__open-btn" href="' +
        escapeHtml(openHref || '#simulators') +
        '" data-simulator-launch="' +
        escapeHtml(id) +
        '">' +
        (allowed ? 'افتح المحاكي' : 'يتطلب الاشتراك بالباقة') +
        '</a>';
      if (!allowed) {
        card.classList.add('feature-card--locked');
        card.classList.remove('feature-card--unlocked');
        card.setAttribute('data-simulator-locked', '1');
      }
    });
  }

  function bindLaunchInterceptor() {
    if (document.documentElement.getAttribute('data-sim-paywall-bound') === '1') return;
    document.documentElement.setAttribute('data-sim-paywall-bound', '1');
    document.addEventListener(
      'click',
      function (e) {
        var launch = e.target && e.target.closest ? e.target.closest('[data-simulator-launch]') : null;
        if (!launch) {
          var card = e.target && e.target.closest ? e.target.closest('[data-simulator-card] .feature-card__open-btn') : null;
          if (card) {
            launch = card.closest('[data-simulator-card]');
          }
        }
        if (!launch) return;
        var cardEl = launch.closest ? launch.closest('[data-simulator-card]') : null;
        var id =
          launch.getAttribute('data-simulator-launch') ||
          (cardEl && cardEl.getAttribute('data-simulator-id')) ||
          '';
        if (!id) return;
        e.preventDefault();
        e.stopPropagation();
        var href =
          (cardEl && cardEl.getAttribute('data-simulator-href')) ||
          (findSimulator(id) && findSimulator(id).href) ||
          '';
        interceptSimulatorLaunch(id, href);
      },
      true
    );
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

  function persistAuthSubscription(planId, enrolledCourseIds, allowedSimulators) {
    var current = readJson(AUTH_KEY, null);
    if (!current || !normalizeEmail(current.email)) return null;
    current.planId = String(planId || '');
    current.enrolledCourseIds = Array.isArray(enrolledCourseIds) ? enrolledCourseIds : [];
    current.allowedSimulators = Array.isArray(allowedSimulators)
      ? normalizeSimulatorIds(allowedSimulators)
      : normalizeSimulatorIds(simulatorsFromPlan(findPlan(planId)));
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
    var simulators = simulatorsFromPlan(plan);
    persistAuthSubscription(plan.id, enrolled, simulators);
    persistDirectorySubscription(authUser.email, plan.id, enrolled);
    refreshAccessUi();
    try {
      global.dispatchEvent(
        new CustomEvent('ifa:subscription-changed', {
          detail: { planId: plan.id, allowedSimulators: simulators, enrolledCourseIds: enrolled },
        })
      );
    } catch (err) {
      /* ignore */
    }
    return { plan: plan, enrolledCourseIds: enrolled };
  }

  function refreshAccessUi() {
    applyPublicSimulatorGates();
    renderSimulatorSwitchers();
    highlightTargetPlan();
  }

  function scheduleSimulatorPageAccessCheck() {
    if (!currentSimulatorIdFromLocation()) return;
    var authUser = getLocalAuthUser();
    var directoryUser = authUser ? findDirectoryUser(authUser.email) : null;
    warmEntitlementCaches(authUser, directoryUser).then(function () {
      enforceSimulatorPageAccess();
      refreshAccessUi();
    });
  }

  function bindPublicRefresh() {
    bindLaunchInterceptor();
    refreshAccessUi();
    scheduleSimulatorPageAccessCheck();
    global.addEventListener('load', function () {
      refreshAccessUi();
      scheduleSimulatorPageAccessCheck();
    });
    global.addEventListener('hashchange', highlightTargetPlan);
    global.addEventListener('ifa:local-auth-changed', function (e) {
      refreshAccessUi();
      var type = e && e.detail ? e.detail.type : '';
      if (type === 'profile-sync' || type === 'login' || type === 'local-session') {
        scheduleSimulatorPageAccessCheck();
      }
    });
    document.addEventListener('ifa:local-auth-changed', function (e) {
      refreshAccessUi();
      var type = e && e.detail ? e.detail.type : '';
      if (type === 'profile-sync' || type === 'login' || type === 'local-session') {
        scheduleSimulatorPageAccessCheck();
      }
    });
    global.addEventListener('ifa:subscription-changed', function () {
      refreshAccessUi();
      scheduleSimulatorPageAccessCheck();
    });
    global.addEventListener('ifa:platform-courses-changed', refreshAccessUi);
    global.addEventListener('ifa:platform-plans-changed', refreshAccessUi);
    document.addEventListener('ifa:platform-plans-changed', refreshAccessUi);
    global.addEventListener('ifa:platform-settings-changed', refreshAccessUi);
    global.addEventListener('ifa:simulators-meta-changed', refreshAccessUi);
    global.addEventListener('ifa:simulators-firestore-changed', refreshAccessUi);
    document.addEventListener('ifa:simulators-firestore-changed', refreshAccessUi);
    if (global.PlatformSimulatorsFirestore && typeof global.PlatformSimulatorsFirestore.subscribe === 'function') {
      global.PlatformSimulatorsFirestore.subscribe(function () {
        refreshAccessUi();
      });
    }
    global.addEventListener('storage', function (e) {
      if (
        !e.key ||
        e.key === AUTH_KEY ||
        e.key === 'platform_courses' ||
        e.key === 'platform_plans' ||
        e.key === 'ifa_pricing_plans' ||
        e.key === USERS_KEY ||
        e.key === SETTINGS_KEY ||
        e.key === META_KEY
      ) {
        refreshAccessUi();
      }
    });
    setTimeout(highlightTargetPlan, 400);
    setTimeout(highlightTargetPlan, 1600);
    var grid = document.querySelector('#publicPricingGrid, .pricing__grid');
    if (grid && typeof MutationObserver !== 'undefined') {
      new MutationObserver(highlightTargetPlan).observe(grid, { childList: true });
    }
  }

  global.PlatformSimulators = {
    CATALOG: SIMULATOR_CATALOG,
    SETTINGS_KEY: SETTINGS_KEY,
    META_KEY: META_KEY,
    getCatalog: getCatalog,
    getSimulatorMeta: getSimulatorMeta,
    saveSimulatorMeta: saveSimulatorMeta,
    defaultSimulatorMeta: defaultSimulatorMeta,
    applySimulatorMetaToCards: applySimulatorMetaToCards,
    findSimulator: findSimulator,
    currentSimulatorIdFromLocation: currentSimulatorIdFromLocation,
    normalizeSimulatorIds: normalizeSimulatorIds,
    simulatorLabels: simulatorLabels,
    getPlatformSettings: getPlatformSettings,
    savePlatformSettings: savePlatformSettings,
    isGloballyFreeSimulator: isGloballyFreeSimulator,
    isSimulatorUnderDevelopment: isSimulatorUnderDevelopment,
    COMING_SOON_BADGE: COMING_SOON_BADGE,
    COMING_SOON_MSG: COMING_SOON_MSG,
    hasActiveTrial: hasActiveTrial,
    viewerCanAccess: viewerCanAccess,
    resolveViewerAccess: resolveViewerAccess,
    courseUnlockingSimulator: courseUnlockingSimulator,
    lockLabelForSimulator: lockLabelForSimulator,
    recommendedPlanForSimulator: recommendedPlanForSimulator,
    interceptSimulatorLaunch: interceptSimulatorLaunch,
    applyPublicSimulatorGates: applyPublicSimulatorGates,
    renderSimulatorSwitchers: renderSimulatorSwitchers,
    highlightTargetPlan: highlightTargetPlan,
    subscribeCurrentUserToPlan: subscribeCurrentUserToPlan,
    simulatorsFromCourse: simulatorsFromCourse,
    simulatorsFromPlan: simulatorsFromPlan,
    ensurePlanCached: ensurePlanCached,
    warmEntitlementCaches: warmEntitlementCaches,
    scheduleSimulatorPageAccessCheck: scheduleSimulatorPageAccessCheck,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindPublicRefresh);
  } else {
    bindPublicRefresh();
  }
})(typeof window !== 'undefined' ? window : this);
