/**
 * Render subscription plans on the public homepage from platform_plans.
 * Shows access-tier correlation with published courses.
 */
(function () {
  'use strict';

  var GRID_SELECTOR = '#publicPricingGrid, .pricing__grid';
  var lastSignature = '';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getPlans() {
    if (window.PlatformPlans && typeof window.PlatformPlans.getPlans === 'function') {
      return window.PlatformPlans.getPlans();
    }
    try {
      var raw = localStorage.getItem('platform_plans');
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function getPublishedCourses() {
    if (window.PlatformCourses && typeof window.PlatformCourses.getPublished === 'function') {
      return window.PlatformCourses.getPublished();
    }
    return [];
  }

  function courseCountForPlan(plan) {
    if (window.PlatformPlans && typeof window.PlatformPlans.countCoursesForPlan === 'function') {
      return window.PlatformPlans.countCoursesForPlan(plan, getPublishedCourses());
    }
    return 0;
  }

  function signature(plans) {
    var courses = getPublishedCourses();
    return (
      plans
        .map(function (p) {
          return [
            p.id,
            p.name,
            p.price,
            p.period,
            p.accessLevel || '',
            p.updatedAt || '',
            (p.features || []).length,
            courseCountForPlan(p),
          ].join(':');
        })
        .join('|') +
      '::' +
      courses.length
    );
  }

  function renderPlanCard(plan) {
    var featured = plan.featured ? ' pricing-card--featured' : '';
    var badge =
      plan.featured && plan.badge
        ? '<span class="pricing-card__badge">' + escapeHtml(plan.badge) + '</span>'
        : '';
    var amount =
      Number(plan.price) === 0
        ? '0 <span>' + escapeHtml(plan.currency || 'ر.س') + '</span>'
        : escapeHtml(String(plan.price)) +
          ' <span>' +
          escapeHtml(plan.currency || 'ر.س') +
          '</span>';
    var count = courseCountForPlan(plan);
    var accessNote =
      '<li><span class="pricing-card__check">✓</span> ' +
      (count
        ? 'يشمل ' + count + ' كورساً منشوراً'
        : 'وصول حسب مستوى الباقة') +
      '</li>';
    var features = (plan.features || [])
      .map(function (f) {
        var ok = f.included !== false;
        return (
          '<li><span class="pricing-card__check' +
          (ok ? '' : ' pricing-card__check--disabled') +
          '">' +
          (ok ? '✓' : '✗') +
          '</span> ' +
          escapeHtml(f.text) +
          '</li>'
        );
      })
      .join('');
    var btnClass =
      plan.ctaStyle === 'primary'
        ? 'pricing-card__btn pricing-card__btn--primary'
        : 'pricing-card__btn pricing-card__btn--outline';

    return (
      '<article class="pricing-card fade-in visible' +
      featured +
      '" data-plan-id="' +
      escapeHtml(plan.id) +
      '" data-access-level="' +
      escapeHtml(plan.accessLevel || '') +
      '">' +
      badge +
      '<h3 class="pricing-card__name">' +
      escapeHtml(plan.name) +
      '</h3>' +
      '<p class="pricing-card__desc">' +
      escapeHtml(plan.description || '') +
      '</p>' +
      '<div class="pricing-card__price">' +
      '<div class="pricing-card__amount">' +
      amount +
      '</div>' +
      '<div class="pricing-card__period">' +
      escapeHtml(plan.period || '') +
      '</div>' +
      '</div>' +
      '<ul class="pricing-card__features">' +
      accessNote +
      features +
      '</ul>' +
      '<button class="' +
      btnClass +
      '" type="button" data-plan="' +
      escapeHtml(plan.id) +
      '">' +
      escapeHtml(plan.ctaLabel || 'اشترك الآن') +
      '</button>' +
      '</article>'
    );
  }

  function renderPublicPlans() {
    var grid = document.querySelector(GRID_SELECTOR);
    if (!grid) return;
    var plans = getPlans();
    var sig = signature(plans);
    if (sig === lastSignature && grid.childElementCount) return;
    lastSignature = sig;

    if (!plans.length) {
      grid.innerHTML =
        '<p class="section__subtitle" style="grid-column:1/-1;text-align:center;">لا توجد باقات متاحة حالياً.</p>';
      return;
    }
    grid.innerHTML = plans.map(renderPlanCard).join('');
  }

  function bind() {
    renderPublicPlans();
    window.addEventListener('storage', function (e) {
      if (!e.key || e.key === 'platform_plans' || e.key === 'platform_courses') {
        renderPublicPlans();
      }
    });
    document.addEventListener('ifa:platform-plans-changed', renderPublicPlans);
    window.addEventListener('ifa:platform-plans-changed', renderPublicPlans);
    document.addEventListener('ifa:platform-courses-changed', renderPublicPlans);
    window.addEventListener('ifa:platform-courses-changed', renderPublicPlans);
    window.setInterval(function () {
      var next = signature(getPlans());
      if (next !== lastSignature) renderPublicPlans();
    }, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  window.renderPublicPlans = renderPublicPlans;
})();
