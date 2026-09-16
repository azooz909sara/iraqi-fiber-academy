/**
 * Sync course documents to pricing plans (Udemy-style: Course = Package).
 * Paid courses → plan_course_{courseId}; free courses → delete linked plan.
 */
(function (global) {
  'use strict';

  var LEGACY_TIER_IDS = { plan_free: true, plan_standard: true, plan_pro: true };

  function planIdForCourse(courseId) {
    return 'plan_course_' + String(courseId || '').trim();
  }

  function parseCoursePrice(course) {
    if (global.PlatformPlans && typeof global.PlatformPlans.parsePrice === 'function') {
      return global.PlatformPlans.parsePrice(course && course.price);
    }
    if (global.PlatformCourses && typeof global.PlatformCourses.parsePrice === 'function') {
      return global.PlatformCourses.parsePrice(course && course.price);
    }
    var n = Number(course && course.price);
    return isFinite(n) && n > 0 ? n : 0;
  }

  function normalizeCurrency(value) {
    if (global.PlatformPlans && typeof global.PlatformPlans.normalizeCurrency === 'function') {
      return global.PlatformPlans.normalizeCurrency(value);
    }
    return String(value || 'IQD').trim() || 'IQD';
  }

  function normalizeSimulatorIds(ids) {
    if (global.PlatformPlans && typeof global.PlatformPlans.normalizeSimulatorIds === 'function') {
      return global.PlatformPlans.normalizeSimulatorIds(ids);
    }
    return Array.isArray(ids)
      ? ids
          .map(function (id) {
            return String(id || '').trim();
          })
          .filter(Boolean)
      : [];
  }

  function simulatorFeatureLines(ids) {
    if (global.PlatformPlans && typeof global.PlatformPlans.simulatorFeatureLines === 'function') {
      return global.PlatformPlans.simulatorFeatureLines(ids);
    }
    return normalizeSimulatorIds(ids).map(function (text) {
      return { text: 'محاكي: ' + text, included: true };
    });
  }

  function buildPlanFromCourse(course) {
    if (!course || !course.id) return null;
    var sims = normalizeSimulatorIds(course.allowedSimulators);
    var lessonCount = Array.isArray(course.lessons) ? course.lessons.length : 0;
    var features = [{ text: 'وصول كامل للكورس: ' + (course.title || ''), included: true }];
    if (lessonCount) {
      features.push({ text: lessonCount + ' درساً', included: true });
    }
    features = features.concat(simulatorFeatureLines(sims));

    return {
      planType: 'course',
      name: String(course.title || '').trim() || 'باقة الكورس',
      description: String(course.description || '').trim() || 'باقة وصول للكورس',
      price: parseCoursePrice(course),
      currency: normalizeCurrency(course.currency),
      period: 'شراء لمرة واحدة',
      ctaLabel: 'اشترِ الكورس',
      ctaStyle: 'primary',
      featured: false,
      badge: '',
      features: features,
      allowedSimulators: sims,
      sourceCourseId: String(course.id),
      includedCourseIds: [String(course.id)],
      courseCategories: course.category ? [course.category] : ['individual'],
    };
  }

  function usesFirestoreCourses() {
    return !!(
      global.PlatformCoursesFirestore &&
      typeof global.PlatformCoursesFirestore.isReady === 'function' &&
      global.PlatformCoursesFirestore.isReady()
    );
  }

  async function patchCourse(courseId, patch) {
    if (usesFirestoreCourses() && global.PlatformCoursesFirestore.updateCourse) {
      return global.PlatformCoursesFirestore.updateCourse(courseId, patch);
    }
    if (global.PlatformCourses && global.PlatformCourses.updateCourse) {
      return global.PlatformCourses.updateCourse(courseId, patch);
    }
    return null;
  }

  async function deletePlanIfExists(planId) {
    var FS = global.PlatformPricingFirestore;
    if (!FS || typeof FS.deletePlan !== 'function') return false;
    try {
      await FS.deletePlan(planId);
      return true;
    } catch (err) {
      return false;
    }
  }

  async function upsertPlan(planId, payload) {
    var FS = global.PlatformPricingFirestore;
    if (!FS) return null;
    if (typeof FS.upsertPlan === 'function') {
      return FS.upsertPlan(planId, payload);
    }
    if (FS.findPlan && FS.findPlan(planId)) {
      return FS.updatePlan(planId, payload);
    }
    if (typeof FS.addPlan === 'function') {
      return FS.addPlan(Object.assign({}, payload, { id: planId }));
    }
    return null;
  }

  async function syncPlanForCourse(course) {
    if (!course || !course.id) return course;

    var price = parseCoursePrice(course);
    var planId = planIdForCourse(course.id);

    if (price <= 0) {
      await deletePlanIfExists(planId);
      if (String(course.requiredPlanId || '') === planId || course.autoPricingPlan) {
        return (
          (await patchCourse(course.id, {
            requiredPlanId: '',
            autoPricingPlan: false,
          })) || course
        );
      }
      return course;
    }

    var payload = buildPlanFromCourse(course);
    if (!payload) return course;

    await upsertPlan(planId, payload);

    if (String(course.requiredPlanId || '') === planId && course.autoPricingPlan) {
      return course;
    }

    return (
      (await patchCourse(course.id, {
        requiredPlanId: planId,
        autoPricingPlan: true,
        currency: normalizeCurrency(course.currency),
      })) || course
    );
  }

  async function deletePlanForCourse(courseId) {
    var key = String(courseId || '').trim();
    if (!key) return false;
    return deletePlanIfExists(planIdForCourse(key));
  }

  function isLegacyTierPlan(plan) {
    return !!(plan && LEGACY_TIER_IDS[plan.id]);
  }

  function isCatalogPricingPlan(plan) {
    if (!plan || isLegacyTierPlan(plan)) return false;
    var price =
      global.PlatformPlans && typeof global.PlatformPlans.parsePrice === 'function'
        ? global.PlatformPlans.parsePrice(plan.price)
        : parseCoursePrice(plan);
    if (price <= 0) return false;

    var type = String(plan.planType || '').toLowerCase();
    if (type === 'course') {
      return !!String(plan.sourceCourseId || '').trim();
    }
    if (type === 'bundle') return true;
    if (String(plan.sourceCourseId || '').trim()) return true;
    if (Array.isArray(plan.includedCourseIds) && plan.includedCourseIds.length) return true;
    return !type;
  }

  global.CoursePlanSync = {
    planIdForCourse: planIdForCourse,
    buildPlanFromCourse: buildPlanFromCourse,
    syncPlanForCourse: syncPlanForCourse,
    deletePlanForCourse: deletePlanForCourse,
    isCatalogPricingPlan: isCatalogPricingPlan,
    isLegacyTierPlan: isLegacyTierPlan,
  };
})(typeof window !== 'undefined' ? window : this);
