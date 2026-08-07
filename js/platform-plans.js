/**
 * Unified pricing plans database (localStorage).
 * Primary key: platform_plans
 * Shared by Admin Dashboard and public homepage.
 * Plans expose accessLevel ranks used by courses for access gating.
 */
(function (global) {
  'use strict';

  var PLANS_KEY = 'platform_plans';
  var SEED_FLAG_KEY = 'platform_plans_initialized';
  var SEED_VERSION_KEY = 'platform_plans_seed_version';
  var SEED_VERSION = '2';

  var ACCESS_LEVELS = {
    free: { key: 'free', rank: 0, label: 'مجاني' },
    standard: { key: 'standard', rank: 1, label: 'قياسي' },
    professional: { key: 'professional', rank: 2, label: 'احترافي' },
  };

  function uid(prefix) {
    return (prefix || 'plan') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

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
      return true;
    } catch (err) {
      console.error('[PlatformPlans] set failed', key, err);
      return false;
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
    return storageSet(key, JSON.stringify(value));
  }

  function normalizeAccessLevel(value) {
    var key = String(value || '')
      .trim()
      .toLowerCase();
    if (key === 'pro') key = 'professional';
    if (key === 'basic') key = 'free';
    if (ACCESS_LEVELS[key]) return key;
    return 'standard';
  }

  function getAccessMeta(level) {
    var key = normalizeAccessLevel(level);
    return ACCESS_LEVELS[key] || ACCESS_LEVELS.standard;
  }

  function normalizeCategories(list) {
    if (!Array.isArray(list)) return [];
    var allowed = { individual: 1, program: 1, master: 1 };
    var out = [];
    list.forEach(function (c) {
      var key = String(c || '')
        .trim()
        .toLowerCase();
      if (allowed[key] && out.indexOf(key) === -1) out.push(key);
    });
    return out;
  }

  function normalizeFeatures(features) {
    if (!Array.isArray(features)) return [];
    return features
      .map(function (f) {
        if (typeof f === 'string') {
          return { text: String(f).trim(), included: true };
        }
        if (!f || typeof f !== 'object') return null;
        var text = String(f.text || f.label || '').trim();
        if (!text) return null;
        return {
          text: text,
          included: f.included !== false && f.included !== 0 && f.included !== 'false',
        };
      })
      .filter(Boolean);
  }

  function defaultCategoriesForLevel(level) {
    var key = normalizeAccessLevel(level);
    if (key === 'free') return ['individual'];
    if (key === 'standard') return ['individual', 'program'];
    return ['individual', 'program', 'master'];
  }

  function normalizePlan(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var price = Number(raw.price);
    if (!isFinite(price) || price < 0) price = 0;
    var accessLevel = normalizeAccessLevel(
      raw.accessLevel || raw.tier || (raw.id === 'plan_free' ? 'free' : raw.id === 'plan_pro' ? 'professional' : '')
    );
    var categories = normalizeCategories(raw.courseCategories);
    if (!categories.length) categories = defaultCategoriesForLevel(accessLevel);
    var meta = getAccessMeta(accessLevel);
    return {
      id: String(raw.id || uid('plan')),
      name: String(raw.name || '').trim(),
      description: String(raw.description || '').trim(),
      price: price,
      currency: String(raw.currency || 'ر.س').trim() || 'ر.س',
      period: String(raw.period || '').trim(),
      ctaLabel: String(raw.ctaLabel || 'اشترك الآن').trim() || 'اشترك الآن',
      ctaStyle: raw.ctaStyle === 'primary' ? 'primary' : 'outline',
      featured: !!raw.featured,
      badge: String(raw.badge || '').trim(),
      features: normalizeFeatures(raw.features),
      accessLevel: accessLevel,
      accessRank: meta.rank,
      courseCategories: categories,
      sortOrder: isFinite(Number(raw.sortOrder)) ? Number(raw.sortOrder) : 0,
      updatedAt: raw.updatedAt || new Date().toISOString(),
      createdAt: raw.createdAt || new Date().toISOString(),
    };
  }

  function seedPlans() {
    return [
      normalizePlan({
        id: 'plan_free',
        name: 'المجانية',
        description: 'للمبتدئين والتجربة الأولى',
        price: 0,
        currency: 'ر.س',
        period: 'مجاناً للأبد',
        ctaLabel: 'ابدأ مجاناً',
        ctaStyle: 'outline',
        featured: false,
        accessLevel: 'free',
        courseCategories: ['individual'],
        sortOrder: 0,
        features: [
          { text: 'الوصول للدروس الأساسية', included: true },
          { text: '3 سيناريوهات محاكاة', included: true },
          { text: 'منتدى المجتمع', included: true },
          { text: 'محاكي OTDR', included: false },
          { text: 'شهادة معتمدة', included: false },
        ],
      }),
      normalizePlan({
        id: 'plan_standard',
        name: 'القياسية',
        description: 'للفنيين والمهتمين بالتخصص',
        price: 149,
        currency: 'ر.س',
        period: 'شهرياً',
        ctaLabel: 'اشترك الآن',
        ctaStyle: 'primary',
        featured: true,
        badge: 'الأكثر شعبية',
        accessLevel: 'standard',
        courseCategories: ['individual', 'program'],
        sortOrder: 1,
        features: [
          { text: 'كل مميزات المجانية', included: true },
          { text: 'محاكي FTTH كامل', included: true },
          { text: '20 سيناريو تدريبي', included: true },
          { text: 'محاكي OTDR أساسي', included: true },
          { text: 'دعم فني عبر البريد', included: true },
        ],
      }),
      normalizePlan({
        id: 'plan_pro',
        name: 'الاحترافية',
        description: 'للمهندسين ومديري المشاريع',
        price: 349,
        currency: 'ر.س',
        period: 'شهرياً',
        ctaLabel: 'اشترك الآن',
        ctaStyle: 'outline',
        featured: false,
        accessLevel: 'professional',
        courseCategories: ['individual', 'program', 'master'],
        sortOrder: 2,
        features: [
          { text: 'كل مميزات القياسية', included: true },
          { text: 'جميع المحاكيات المتقدمة', included: true },
          { text: 'سيناريوهات غير محدودة', included: true },
          { text: 'جلسات مع المدربين', included: true },
          { text: 'شهادة احتراف معتمدة', included: true },
        ],
      }),
    ];
  }

  function migratePlanFields(list) {
    return (list || []).map(normalizePlan).filter(Boolean);
  }

  function ensureSeeded() {
    var initialized = storageGet(SEED_FLAG_KEY) === '1';
    var version = storageGet(SEED_VERSION_KEY);
    var current = readJson(PLANS_KEY, null);

    // First visit only — never re-seed after the admin clears the list.
    if (!initialized && (!Array.isArray(current) || !current.length)) {
      writeJson(PLANS_KEY, seedPlans());
      storageSet(SEED_FLAG_KEY, '1');
      storageSet(SEED_VERSION_KEY, SEED_VERSION);
      return;
    }

    if (!Array.isArray(current)) {
      writeJson(PLANS_KEY, []);
      storageSet(SEED_FLAG_KEY, '1');
      storageSet(SEED_VERSION_KEY, SEED_VERSION);
      return;
    }

    if (version !== SEED_VERSION) {
      // Soft migrate existing plans (add accessLevel etc.) without restoring deleted ones.
      writeJson(PLANS_KEY, migratePlanFields(current));
      storageSet(SEED_FLAG_KEY, '1');
      storageSet(SEED_VERSION_KEY, SEED_VERSION);
    } else if (!initialized) {
      storageSet(SEED_FLAG_KEY, '1');
    }
  }

  function emitChanged(list, detail) {
    writeJson(PLANS_KEY, list);
    storageSet(SEED_FLAG_KEY, '1');
    var payload = Object.assign({ count: list.length, key: PLANS_KEY }, detail || {});
    try {
      var evt = new CustomEvent('ifa:platform-plans-changed', { detail: payload, bubbles: true });
      global.dispatchEvent(evt);
      if (global.document) global.document.dispatchEvent(evt);
    } catch (err) {
      /* ignore */
    }
  }

  function getPlans() {
    ensureSeeded();
    var list = readJson(PLANS_KEY, []);
    return migratePlanFields(Array.isArray(list) ? list : []).sort(function (a, b) {
      return (a.sortOrder || 0) - (b.sortOrder || 0);
    });
  }

  function savePlans(list, detail) {
    var normalized = (list || [])
      .map(normalizePlan)
      .filter(Boolean)
      .map(function (p, index) {
        return Object.assign({}, p, { sortOrder: index, updatedAt: new Date().toISOString() });
      });
    emitChanged(normalized, detail);
    return normalized;
  }

  function findPlan(id) {
    var key = String(id || '');
    if (!key) return null;
    var list = getPlans();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === key) return list[i];
    }
    return null;
  }

  function findPlanByAccessLevel(level) {
    var key = normalizeAccessLevel(level);
    var list = getPlans();
    for (var i = 0; i < list.length; i++) {
      if (list[i].accessLevel === key) return list[i];
    }
    return null;
  }

  function updatePlan(id, patch) {
    var key = String(id || '');
    var list = getPlans();
    var found = null;
    list = list.map(function (p) {
      if (String(p.id) !== key) return p;
      found = normalizePlan(
        Object.assign({}, p, patch || {}, {
          id: p.id,
          createdAt: p.createdAt,
          updatedAt: new Date().toISOString(),
        })
      );
      if (!found.name) throw new Error('اسم الباقة مطلوب');
      return found;
    });
    if (!found) throw new Error('الباقة غير موجودة');
    savePlans(list, { type: 'update', id: key });
    return found;
  }

  function addPlan(payload) {
    var list = getPlans();
    var plan = normalizePlan(
      Object.assign({}, payload || {}, {
        id: uid('plan'),
        sortOrder: list.length,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    );
    if (!plan.name) throw new Error('اسم الباقة مطلوب');
    list.push(plan);
    savePlans(list, { type: 'add', id: plan.id });
    return plan;
  }

  function deletePlan(id) {
    var key = String(id || '').trim();
    if (!key) throw new Error('معرّف الباقة غير صالح');
    ensureSeeded();
    var list = readJson(PLANS_KEY, []);
    if (!Array.isArray(list)) list = [];
    var next = list.filter(function (p) {
      return p && String(p.id) !== key;
    });
    if (next.length === list.length) {
      // Retry against normalized getPlans ids
      var normalized = getPlans();
      next = normalized.filter(function (p) {
        return String(p.id) !== key;
      });
      if (next.length === normalized.length) throw new Error('الباقة غير موجودة');
    }
    savePlans(next, { type: 'delete', id: key });
    return true;
  }

  function formatPrice(plan) {
    if (!plan) return '—';
    var amount = Number(plan.price) || 0;
    var currency = plan.currency || 'ر.س';
    if (amount === 0) return 'مجاناً';
    return amount + ' ' + currency;
  }

  function planUnlocksCategory(plan, category) {
    if (!plan) return false;
    var cat = String(category || 'individual').toLowerCase();
    var cats = plan.courseCategories || [];
    return cats.indexOf(cat) !== -1;
  }

  function courseMatchesPlan(course, plan) {
    if (!course || !plan) return false;
    if (course.requiredPlanId && String(course.requiredPlanId) === String(plan.id)) return true;
    var courseLevel = normalizeAccessLevel(course.accessLevel || course.requiredAccessLevel || 'free');
    var courseRank = getAccessMeta(courseLevel).rank;
    return plan.accessRank >= courseRank && planUnlocksCategory(plan, course.category);
  }

  function countCoursesForPlan(plan, courses) {
    if (!plan) return 0;
    var list = Array.isArray(courses) ? courses : [];
    return list.filter(function (c) {
      return c && !c.softDeleted && c.status === 'published' && courseMatchesPlan(c, plan);
    }).length;
  }

  function getAccessLevels() {
    return [
      { key: 'free', rank: 0, label: 'مجاني' },
      { key: 'standard', rank: 1, label: 'قياسي' },
      { key: 'professional', rank: 2, label: 'احترافي' },
    ];
  }

  ensureSeeded();

  global.PlatformPlans = {
    PLANS_KEY: PLANS_KEY,
    getPlans: getPlans,
    savePlans: savePlans,
    findPlan: findPlan,
    findPlanByAccessLevel: findPlanByAccessLevel,
    addPlan: addPlan,
    updatePlan: updatePlan,
    deletePlan: deletePlan,
    formatPrice: formatPrice,
    normalizePlan: normalizePlan,
    normalizeAccessLevel: normalizeAccessLevel,
    getAccessMeta: getAccessMeta,
    getAccessLevels: getAccessLevels,
    planUnlocksCategory: planUnlocksCategory,
    courseMatchesPlan: courseMatchesPlan,
    countCoursesForPlan: countCoursesForPlan,
  };
})(typeof window !== 'undefined' ? window : this);
