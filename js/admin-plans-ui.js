/**
 * Admin UI — manage pricing plans (platform_plans).
 */
(function () {
  'use strict';

  var Plans = null;
  var editingId = null;

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(message, isError) {
    var el = $('adminToast');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    el.classList.toggle('admin-toast--error', !!isError);
    el.classList.toggle('admin-toast--success', !isError);
    window.clearTimeout(toast._t);
    toast._t = window.setTimeout(function () {
      el.hidden = true;
    }, 2800);
  }

  function featuresToText(features) {
    return (features || [])
      .map(function (f) {
        var mark = f.included === false ? '✗ ' : '';
        return mark + (f.text || '');
      })
      .join('\n');
  }

  function textToFeatures(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map(function (line) {
        var t = line.trim();
        if (!t) return null;
        var included = true;
        if (/^[✗xX×]\s*/.test(t)) {
          included = false;
          t = t.replace(/^[✗xX×]\s*/, '');
        } else if (/^[-–]\s*/.test(t)) {
          included = false;
          t = t.replace(/^[-–]\s*/, '');
        }
        if (!t) return null;
        return { text: t, included: included };
      })
      .filter(Boolean);
  }

  function accessLabel(level) {
    var meta =
      Plans && typeof Plans.getAccessMeta === 'function'
        ? Plans.getAccessMeta(level)
        : null;
    if (meta && meta.label) return meta.label;
    if (level === 'free') return 'مجاني';
    if (level === 'professional') return 'احترافي';
    return 'قياسي';
  }

  function readCategoriesFromForm() {
    var cats = [];
    if ($('planCatIndividual') && $('planCatIndividual').checked) cats.push('individual');
    if ($('planCatProgram') && $('planCatProgram').checked) cats.push('program');
    if ($('planCatMaster') && $('planCatMaster').checked) cats.push('master');
    return cats.length ? cats : ['individual'];
  }

  function writeCategoriesToForm(categories) {
    var set = {};
    (categories || []).forEach(function (c) {
      set[c] = true;
    });
    if ($('planCatIndividual')) $('planCatIndividual').checked = !!set.individual || !categories || !categories.length;
    if ($('planCatProgram')) $('planCatProgram').checked = !!set.program;
    if ($('planCatMaster')) $('planCatMaster').checked = !!set.master;
  }

  function countLinkedCourses(plan) {
    if (!plan || !window.PlatformCourses) return 0;
    var courses = window.PlatformCourses.getPublished
      ? window.PlatformCourses.getPublished()
      : [];
    if (Plans && typeof Plans.countCoursesForPlan === 'function') {
      return Plans.countCoursesForPlan(plan, courses);
    }
    return courses.filter(function (c) {
      return c && String(c.requiredPlanId || '') === String(plan.id);
    }).length;
  }

  function renderPlansList() {
    var list = $('adminPlansList');
    if (!list || !Plans) return;
    var plans = Plans.getPlans();
    if (!plans.length) {
      list.innerHTML =
        '<div class="admin-empty" role="status"><p>لا توجد باقات بعد. أضف باقة جديدة.</p></div>';
      return;
    }
    list.innerHTML = plans
      .map(function (plan) {
        var priceLabel =
          Number(plan.price) === 0
            ? 'مجاناً'
            : escapeHtml(plan.price) + ' ' + escapeHtml(plan.currency || 'ر.س');
        var linked = countLinkedCourses(plan);
        return (
          '<article class="admin-plan-card' +
          (plan.featured ? ' admin-plan-card--featured' : '') +
          '" data-plan-id="' +
          escapeHtml(plan.id) +
          '">' +
          '<div class="admin-plan-card__top">' +
          '<div>' +
          '<h3 class="admin-plan-card__name">' +
          escapeHtml(plan.name) +
          (plan.featured
            ? ' <span class="admin-plan-card__badge">' +
              escapeHtml(plan.badge || 'مميزة') +
              '</span>'
            : '') +
          '</h3>' +
          '<p class="admin-plan-card__desc">' +
          escapeHtml(plan.description || '—') +
          '</p>' +
          '<p class="admin-plan-card__meta">مستوى: ' +
          escapeHtml(accessLabel(plan.accessLevel)) +
          ' · ' +
          linked +
          ' كورس منشور</p>' +
          '</div>' +
          '<div class="admin-plan-card__price">' +
          '<strong>' +
          priceLabel +
          '</strong>' +
          '<span>' +
          escapeHtml(plan.period || '') +
          '</span>' +
          '</div>' +
          '</div>' +
          '<ul class="admin-plan-card__features">' +
          (plan.features || [])
            .slice(0, 6)
            .map(function (f) {
              return (
                '<li class="' +
                (f.included === false ? 'is-disabled' : '') +
                '">' +
                (f.included === false ? '✗ ' : '✓ ') +
                escapeHtml(f.text) +
                '</li>'
              );
            })
            .join('') +
          '</ul>' +
          '<div class="admin-plan-card__actions">' +
          '<button type="button" class="admin-btn admin-btn--ghost admin-btn--sm" data-edit-plan="' +
          escapeHtml(plan.id) +
          '">تعديل</button>' +
          '<button type="button" class="admin-btn admin-btn--danger admin-btn--sm" data-delete-plan="' +
          escapeHtml(plan.id) +
          '">حذف</button>' +
          '</div>' +
          '</article>'
        );
      })
      .join('');
  }

  function openModal(plan) {
    editingId = plan ? String(plan.id) : null;
    var modal = $('planEditorModal');
    var title = $('planEditorTitle');
    if (!modal) return;
    if (title) title.textContent = plan ? 'تعديل الباقة' : 'إضافة باقة جديدة';
    $('planEditorName').value = plan ? plan.name : '';
    $('planEditorDescription').value = plan ? plan.description || '' : '';
    $('planEditorPrice').value = plan ? String(plan.price) : '0';
    $('planEditorCurrency').value = plan ? plan.currency || 'ر.س' : 'ر.س';
    $('planEditorPeriod').value = plan ? plan.period || '' : 'شهرياً';
    $('planEditorAccessLevel').value = plan ? plan.accessLevel || 'standard' : 'standard';
    $('planEditorCta').value = plan ? plan.ctaLabel || 'اشترك الآن' : 'اشترك الآن';
    $('planEditorCtaStyle').value = plan && plan.ctaStyle === 'primary' ? 'primary' : 'outline';
    $('planEditorFeatured').checked = !!(plan && plan.featured);
    $('planEditorBadge').value = plan ? plan.badge || '' : '';
    $('planEditorFeatures').value = plan ? featuresToText(plan.features) : '';
    writeCategoriesToForm(plan ? plan.courseCategories : ['individual']);
    modal.hidden = false;
    var scroll = modal.querySelector('.admin-modal__scroll');
    if (scroll) scroll.scrollTop = 0;
  }

  function closeModal() {
    var modal = $('planEditorModal');
    if (modal) modal.hidden = true;
    editingId = null;
  }

  function collectPayload() {
    return {
      name: $('planEditorName').value.trim(),
      description: $('planEditorDescription').value.trim(),
      price: Number($('planEditorPrice').value) || 0,
      currency: $('planEditorCurrency').value.trim() || 'ر.س',
      period: $('planEditorPeriod').value.trim(),
      accessLevel: $('planEditorAccessLevel').value || 'standard',
      courseCategories: readCategoriesFromForm(),
      ctaLabel: $('planEditorCta').value.trim() || 'اشترك الآن',
      ctaStyle: $('planEditorCtaStyle').value,
      featured: $('planEditorFeatured').checked,
      badge: $('planEditorBadge').value.trim(),
      features: textToFeatures($('planEditorFeatures').value),
    };
  }

  function onSubmit(e) {
    e.preventDefault();
    if (!Plans) return;
    var payload = collectPayload();
    try {
      if (editingId) {
        Plans.updatePlan(editingId, payload);
        toast('تم تحديث الباقة — ستظهر على الموقع فوراً');
      } else {
        Plans.addPlan(payload);
        toast('تمت إضافة الباقة — ستظهر على الموقع فوراً');
      }
      closeModal();
      renderPlansList();
    } catch (err) {
      toast((err && err.message) || 'تعذّر الحفظ', true);
    }
  }

  function handleDeletePlan(id) {
    var key = String(id || '').trim();
    if (!key || !Plans) return;
    if (!window.confirm('حذف هذه الباقة من الموقع؟')) return;

    // Optimistic DOM removal for instant feedback
    document.querySelectorAll('.admin-plan-card[data-plan-id]').forEach(function (card) {
      if (String(card.getAttribute('data-plan-id')) === key && card.parentNode) {
        card.parentNode.removeChild(card);
      }
    });

    try {
      Plans.deletePlan(key);
      toast('تم حذف الباقة');
      renderPlansList();
    } catch (err) {
      toast((err && err.message) || 'تعذّر الحذف', true);
      renderPlansList();
    }
  }

  function handleEditPlan(id) {
    var plan = Plans.findPlan(id);
    if (plan) openModal(plan);
  }

  function bind() {
    Plans = window.PlatformPlans;
    if (!Plans) {
      console.warn('[AdminPlans] PlatformPlans missing');
      return;
    }

    var addBtn = $('addPlanBtn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        openModal(null);
      });
    }

    var form = $('planEditorForm');
    if (form) form.addEventListener('submit', onSubmit);

    document.querySelectorAll('[data-close-plan-modal]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        closeModal();
      });
    });

    // Single document-level delegation (survives re-renders)
    document.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || typeof target.closest !== 'function') return;
      var delBtn = target.closest('#adminPlansList [data-delete-plan]');
      if (delBtn) {
        e.preventDefault();
        e.stopPropagation();
        handleDeletePlan(delBtn.getAttribute('data-delete-plan'));
        return;
      }
      var editBtn = target.closest('#adminPlansList [data-edit-plan]');
      if (editBtn) {
        e.preventDefault();
        handleEditPlan(editBtn.getAttribute('data-edit-plan'));
      }
    });

    document.addEventListener('ifa:platform-plans-changed', renderPlansList);
    window.addEventListener('ifa:platform-plans-changed', renderPlansList);
    document.addEventListener('ifa:platform-courses-changed', renderPlansList);
    window.addEventListener('storage', function (e) {
      if (!e.key || e.key === 'platform_plans' || e.key === 'platform_courses') renderPlansList();
    });

    renderPlansList();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
