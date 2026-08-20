/**
 * Admin CMS — إدارة موقعي (simulators, articles, FAQs, testimonials).
 */
(function () {
  'use strict';

  var editingArticleId = null;
  var editingFaqId = null;
  var editingTestimonialId = null;
  var selectedEditorImage = null;
  var resizeState = null;
  var dragState = null;

  var IMAGE_LAYOUTS = {
    inline: {
      display: 'inline-block',
      verticalAlign: 'middle',
      float: '',
      margin: '',
      shapeOutside: '',
      clear: '',
      zIndex: '',
      opacity: '',
    },
    'square-right': {
      float: 'right',
      margin: '12px',
      display: '',
      verticalAlign: '',
      shapeOutside: '',
      clear: '',
      zIndex: '',
      opacity: '',
    },
    'square-left': {
      float: 'left',
      margin: '12px',
      display: '',
      verticalAlign: '',
      shapeOutside: '',
      clear: '',
      zIndex: '',
      opacity: '',
    },
    tight: {
      float: 'right',
      margin: '8px',
      shapeOutside: 'margin-box',
      display: '',
      verticalAlign: '',
      clear: '',
      zIndex: '',
      opacity: '',
    },
    'top-bottom': {
      display: 'block',
      margin: '16px auto',
      clear: 'both',
      float: '',
      verticalAlign: '',
      shapeOutside: '',
      zIndex: '',
      opacity: '',
    },
    behind: {
      position: 'absolute',
      zIndex: '1',
      opacity: '0.6',
      pointerEvents: 'auto',
      cursor: 'move',
      float: '',
      margin: '',
      display: '',
      verticalAlign: '',
      shapeOutside: '',
      clear: '',
    },
    front: {
      position: 'absolute',
      zIndex: '10',
      pointerEvents: 'auto',
      float: '',
      margin: '',
      display: '',
      verticalAlign: '',
      shapeOutside: '',
      clear: '',
      opacity: '',
    },
  };

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

  function statusBadge(status, type) {
    if (type === 'testimonial') {
      return status === 'hidden'
        ? '<span class="cms-status cms-status--draft">مخفي</span>'
        : '<span class="cms-status cms-status--published">منشور</span>';
    }
    return status === 'draft'
      ? '<span class="cms-status cms-status--draft">مسودة</span>'
      : '<span class="cms-status cms-status--published">منشور</span>';
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

  function readFileAsDataUrl(file, done) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      done(String(reader.result || ''));
    };
    reader.readAsDataURL(file);
  }

  function reloadSitePreview() {
    var frame = $('site-preview-frame');
    if (!frame) return;
    try {
      frame.contentWindow.location.reload();
    } catch (err) {
      var src = frame.getAttribute('src') || 'index.html?mode=admin-preview';
      frame.src = src.split('#')[0] + '&_=' + Date.now();
    }
  }

  var MAX_SIM_ICON_BYTES = 512000;

  function simIconPreviewHtml(meta) {
    if (meta && meta.iconType === 'image' && meta.icon) {
      return (
        '<img src="' +
        String(meta.icon).replace(/"/g, '&quot;') +
        '" alt="" />'
      );
    }
    return escapeHtml((meta && meta.icon) || '◆');
  }

  /* ---------- Simulators ---------- */
  function renderSimulatorEditors() {
    var host = $('cmsSimulatorsGrid');
    if (!host || !window.PlatformSimulators) return;
    var catalog = window.PlatformSimulators.getCatalog();
    var meta = window.PlatformSimulators.getSimulatorMeta();
    var defaults = window.PlatformSimulators.defaultSimulatorMeta();
    host.innerHTML = catalog
      .map(function (sim) {
        var m = meta[sim.id] || {};
        var d = defaults[sim.id] || {};
        return (
          '<article class="cms-sim-card" data-sim-editor="' +
          escapeHtml(sim.id) +
          '">' +
          '<div class="cms-sim-card__head">' +
          '<div class="cms-sim-card__icon" data-sim-icon-preview aria-hidden="true">' +
          simIconPreviewHtml(m) +
          '</div>' +
          '<div><strong>' +
          escapeHtml(m.title || sim.label) +
          '</strong><code>' +
          escapeHtml(sim.id) +
          '</code></div>' +
          '</div>' +
          '<label class="admin-field"><span class="admin-field__label">العنوان</span>' +
          '<input class="admin-field__input" data-sim-title value="' +
          escapeHtml(m.title || '') +
          '" /></label>' +
          '<label class="admin-field"><span class="admin-field__label">الوصف</span>' +
          '<textarea class="admin-field__input admin-field__textarea" data-sim-desc rows="4">' +
          escapeHtml(m.description || '') +
          '</textarea></label>' +
          '<div class="admin-field">' +
          '<span class="admin-field__label">أيقونة المحاكي</span>' +
          '<input type="hidden" data-sim-icon-value />' +
          '<input type="hidden" data-sim-icon-type />' +
          '<input type="hidden" data-sim-icon-default value="' +
          escapeHtml(d.icon || '◆') +
          '" />' +
          '<div class="cms-sim-icon-actions">' +
          '<label class="cms-file-btn">رفع أيقونة مخصصة (PNG / SVG / WebP)' +
          '<input type="file" data-sim-icon-file accept="image/png,image/svg+xml,image/webp,image/jpeg" hidden /></label>' +
          '<button class="admin-btn admin-btn--ghost" type="button" data-sim-icon-reset>استعادة الافتراضي</button>' +
          '</div>' +
          '<span class="admin-field__hint">تُعرض الأيقونة على بطاقة المحاكي في الصفحة الرئيسية. الحد الأقصى ~500 كيلوبايت.</span>' +
          '</div>' +
          '<button class="admin-btn admin-btn--primary" type="button" data-sim-save="' +
          escapeHtml(sim.id) +
          '">حفظ البطاقة</button>' +
          '</article>'
        );
      })
      .join('');

    host.querySelectorAll('[data-sim-editor]').forEach(function (card) {
      var simId = card.getAttribute('data-sim-editor');
      var m = meta[simId] || {};
      var iconValue = card.querySelector('[data-sim-icon-value]');
      var iconType = card.querySelector('[data-sim-icon-type]');
      if (iconValue) iconValue.value = m.icon || '';
      if (iconType) iconType.value = m.iconType === 'image' ? 'image' : 'emoji';
    });
  }

  function updateSimIconPreview(card) {
    if (!card) return;
    var preview = card.querySelector('[data-sim-icon-preview]');
    var iconValue = card.querySelector('[data-sim-icon-value]');
    var iconType = card.querySelector('[data-sim-icon-type]');
    if (!preview || !iconValue || !iconType) return;
    var meta = {
      icon: iconValue.value,
      iconType: iconType.value === 'image' ? 'image' : 'emoji',
    };
    preview.innerHTML = simIconPreviewHtml(meta);
  }

  function resetSimIcon(card) {
    if (!card) return;
    var iconValue = card.querySelector('[data-sim-icon-value]');
    var iconType = card.querySelector('[data-sim-icon-type]');
    var iconDefault = card.querySelector('[data-sim-icon-default]');
    if (!iconValue || !iconType) return;
    iconValue.value = iconDefault ? iconDefault.value : '◆';
    iconType.value = 'emoji';
    var fileInput = card.querySelector('[data-sim-icon-file]');
    if (fileInput) fileInput.value = '';
    updateSimIconPreview(card);
  }

  function saveSimulatorCard(id, card) {
    var title = card.querySelector('[data-sim-title]');
    var desc = card.querySelector('[data-sim-desc]');
    var iconValue = card.querySelector('[data-sim-icon-value]');
    var iconType = card.querySelector('[data-sim-icon-type]');
    var current = window.PlatformSimulators.getSimulatorMeta()[id] || {};
    var icon = iconValue ? iconValue.value : current.icon;
    var type = iconType && iconType.value === 'image' ? 'image' : 'emoji';
    if (!icon) {
      var defaults = window.PlatformSimulators.defaultSimulatorMeta();
      icon = (defaults[id] && defaults[id].icon) || '◆';
      type = 'emoji';
    } else if (type === 'image' && icon.indexOf('data:') !== 0 && current.iconType === 'image') {
      icon = current.icon || icon;
    }
    var patch = {};
    patch[id] = {
      title: title ? title.value : current.title,
      description: desc ? desc.value : current.description,
      icon: icon,
      iconType: type,
    };
    window.PlatformSimulators.saveSimulatorMeta(patch);
    toast('تم حفظ بطاقة المحاكي');
    renderSimulatorEditors();
    reloadSitePreview();
  }

  /* ---------- Landing page statistics ---------- */
  function renderStatsEditor() {
    if (!window.PlatformStats) return;
    var stats = window.PlatformStats.getStats();
    var enrolled = $('cmsStatEnrolledStudents');
    var km = $('cmsStatSimulatedKm');
    var projects = $('cmsStatTrainingProjects');
    var satisfaction = $('cmsStatSatisfaction');
    if (enrolled) enrolled.value = String(stats.enrolledStudents);
    if (km) km.value = String(stats.simulatedKilometers);
    if (projects) projects.value = String(stats.trainingProjects);
    if (satisfaction) satisfaction.value = String(stats.satisfactionRate);
    renderStatsPreview(stats);
  }

  function renderStatsPreview(stats) {
    var host = $('cmsStatsPreview');
    if (!host || !window.PlatformStats) return;
    var s = stats || window.PlatformStats.getStats();
    var fmt = window.PlatformStats.formatStatNumber;
    host.innerHTML =
      '<div class="cms-stats-preview__item"><span class="cms-stats-preview__value">' +
      escapeHtml(fmt(s.enrolledStudents)) +
      '</span><span class="cms-stats-preview__label">طالب مسجّل</span></div>' +
      '<div class="cms-stats-preview__item"><span class="cms-stats-preview__value">' +
      escapeHtml(fmt(s.simulatedKilometers)) +
      '</span><span class="cms-stats-preview__label">كيلومتر محاكى</span></div>' +
      '<div class="cms-stats-preview__item"><span class="cms-stats-preview__value">' +
      escapeHtml(fmt(s.trainingProjects)) +
      '</span><span class="cms-stats-preview__label">مشروع تدريبي</span></div>' +
      '<div class="cms-stats-preview__item"><span class="cms-stats-preview__value">' +
      escapeHtml(fmt(s.satisfactionRate)) +
      '%</span><span class="cms-stats-preview__label">رضا الطلاب</span></div>';
  }

  function saveStatsFromForm() {
    if (!window.PlatformStats) return;
    var saved = window.PlatformStats.saveStats({
      enrolledStudents: $('cmsStatEnrolledStudents') && $('cmsStatEnrolledStudents').value,
      simulatedKilometers: $('cmsStatSimulatedKm') && $('cmsStatSimulatedKm').value,
      trainingProjects: $('cmsStatTrainingProjects') && $('cmsStatTrainingProjects').value,
      satisfactionRate: $('cmsStatSatisfaction') && $('cmsStatSatisfaction').value,
    });
    renderStatsPreview(saved);
    var status = $('cmsStatsSaveStatus');
    if (status) {
      status.textContent =
        'تم الحفظ — طلاب: ' +
        window.PlatformStats.formatStatNumber(saved.enrolledStudents) +
        ' · كم: ' +
        window.PlatformStats.formatStatNumber(saved.simulatedKilometers);
    }
    toast('تم حفظ إحصائيات الموقع');
    reloadSitePreview();
  }

  function resetStatsToDefaults() {
    if (!window.PlatformStats) return;
    if (!window.confirm('استعادة الإحصائيات الافتراضية؟')) return;
    var defaults = window.PlatformStats.DEFAULTS;
    window.PlatformStats.saveStats(defaults);
    renderStatsEditor();
    toast('تمت استعادة الإحصائيات الافتراضية');
    reloadSitePreview();
  }

  function bindStatsEditor() {
    var form = $('cmsStatsForm');
    if (!form || !window.PlatformStats) return;
    renderStatsEditor();
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      saveStatsFromForm();
    });
    var resetBtn = $('cmsStatsReset');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        resetStatsToDefaults();
      });
    }
    ['cmsStatEnrolledStudents', 'cmsStatSimulatedKm', 'cmsStatTrainingProjects', 'cmsStatSatisfaction'].forEach(
      function (id) {
        var el = $(id);
        if (!el) return;
        el.addEventListener('input', function () {
          renderStatsPreview(
            window.PlatformStats.normalizeStats({
              enrolledStudents: $('cmsStatEnrolledStudents') && $('cmsStatEnrolledStudents').value,
              simulatedKilometers: $('cmsStatSimulatedKm') && $('cmsStatSimulatedKm').value,
              trainingProjects: $('cmsStatTrainingProjects') && $('cmsStatTrainingProjects').value,
              satisfactionRate: $('cmsStatSatisfaction') && $('cmsStatSatisfaction').value,
            })
          );
        });
      }
    );
  }

  /* ---------- Hero content slider ---------- */
  var heroSlidesDraft = [];

  function loadHeroSlidesDraft() {
    if (!window.PlatformHeroSlideshow) {
      heroSlidesDraft = [];
      return;
    }
    var config = window.PlatformHeroSlideshow.getConfig();
    heroSlidesDraft = config.slides.length
      ? config.slides.slice()
      : window.PlatformHeroSlideshow.defaultSlides().slice();
  }

  function collectHeroSlideFromCard(card) {
    var id = card.getAttribute('data-hero-slide-id');
    var existing = null;
    heroSlidesDraft.forEach(function (s) {
      if (s.id === id) existing = s;
    });
    var imageInput = card.querySelector('[data-hero-field="image"]');
    var visualTypeSelect = card.querySelector('[data-hero-field="visualType"]');
    return window.PlatformHeroSlideshow.normalizeSlide({
      id: id,
      visualType: visualTypeSelect ? visualTypeSelect.value : 'image',
      image: imageInput ? imageInput.value : existing && existing.image,
      title: card.querySelector('[data-hero-field="title"]') && card.querySelector('[data-hero-field="title"]').value,
      description:
        card.querySelector('[data-hero-field="description"]') &&
        card.querySelector('[data-hero-field="description"]').value,
      buttonText:
        card.querySelector('[data-hero-field="buttonText"]') &&
        card.querySelector('[data-hero-field="buttonText"]').value,
      buttonHref:
        card.querySelector('[data-hero-field="buttonHref"]') &&
        card.querySelector('[data-hero-field="buttonHref"]').value,
      secondaryButtonText:
        card.querySelector('[data-hero-field="secondaryButtonText"]') &&
        card.querySelector('[data-hero-field="secondaryButtonText"]').value,
      secondaryButtonHref:
        card.querySelector('[data-hero-field="secondaryButtonHref"]') &&
        card.querySelector('[data-hero-field="secondaryButtonHref"]').value,
      textColor:
        card.querySelector('[data-hero-field="textColor"]') &&
        card.querySelector('[data-hero-field="textColor"]').value,
      bgTint:
        card.querySelector('[data-hero-field="bgTint"]') && card.querySelector('[data-hero-field="bgTint"]').value,
      badge: card.querySelector('[data-hero-field="badge"]') && card.querySelector('[data-hero-field="badge"]').value,
      showTrust: !!(card.querySelector('[data-hero-field="showTrust"]') && card.querySelector('[data-hero-field="showTrust"]').checked),
    });
  }

  function syncHeroSlidesDraftFromDom() {
    var list = $('cmsHeroSlidesList');
    if (!list) return;
    heroSlidesDraft = [];
    list.querySelectorAll('[data-hero-slide-id]').forEach(function (card) {
      heroSlidesDraft.push(collectHeroSlideFromCard(card));
    });
  }

  function renderHeroSlideshowEditor() {
    if (!window.PlatformHeroSlideshow) return;
    var config = window.PlatformHeroSlideshow.getConfig();
    var interval = $('cmsHeroInterval');
    if (interval) interval.value = String(config.intervalSeconds);
    if (!heroSlidesDraft.length) loadHeroSlidesDraft();
    renderHeroSlidesList();
  }

  function renderHeroSlideCard(slide, index, total) {
    var preview = slide.image
      ? '<img class="cms-hero-editor__preview" src="' + String(slide.image).replace(/"/g, '&quot;') + '" alt="" />'
      : '<div class="cms-hero-editor__preview cms-hero-editor__preview--empty">بدون صورة — مخطط الشبكة</div>';
    return (
      '<article class="cms-hero-editor-card" data-hero-slide-id="' +
      escapeHtml(slide.id) +
      '">' +
      '<header class="cms-hero-editor-card__head">' +
      '<strong>شريحة #' +
      (index + 1) +
      '</strong>' +
      '<div class="cms-hero-editor-card__order">' +
      '<button type="button" class="admin-btn admin-btn--ghost" data-hero-slide-up="' +
      escapeHtml(slide.id) +
      '" ' +
      (index === 0 ? 'disabled' : '') +
      '>↑</button>' +
      '<button type="button" class="admin-btn admin-btn--ghost" data-hero-slide-down="' +
      escapeHtml(slide.id) +
      '" ' +
      (index === total - 1 ? 'disabled' : '') +
      '>↓</button>' +
      '<button type="button" class="admin-btn admin-btn--danger" data-hero-slide-remove="' +
      escapeHtml(slide.id) +
      '">حذف</button>' +
      '</div></header>' +
      '<div class="cms-hero-editor-card__body">' +
      '<div class="cms-hero-editor-card__media">' +
      preview +
      '<label class="cms-file-btn">رفع صورة<input type="file" data-hero-slide-file="' +
      escapeHtml(slide.id) +
      '" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden /></label>' +
      '<input type="hidden" data-hero-field="image" value="" />' +
      '</div>' +
      '<div class="cms-hero-editor-card__fields">' +
      '<label class="admin-field"><span class="admin-field__label">نوع المرئي</span>' +
      '<select class="admin-field__input" data-hero-field="visualType">' +
      '<option value="image"' +
      (slide.visualType === 'image' ? ' selected' : '') +
      '>صورة مرفوعة</option>' +
      '<option value="network"' +
      (slide.visualType === 'network' ? ' selected' : '') +
      '>مخطط شبكة FTTH</option>' +
      '</select></label>' +
      '<label class="admin-field"><span class="admin-field__label">شارة علوية (Badge)</span>' +
      '<input class="admin-field__input" data-hero-field="badge" value="' +
      escapeHtml(slide.badge || '') +
      '" /></label>' +
      '<label class="admin-field"><span class="admin-field__label">العنوان (Title)</span>' +
      '<input class="admin-field__input" data-hero-field="title" value="' +
      escapeHtml(slide.title || '') +
      '" /></label>' +
      '<label class="admin-field"><span class="admin-field__label">الوصف (Description)</span>' +
      '<textarea class="admin-field__input admin-field__textarea" data-hero-field="description" rows="3">' +
      escapeHtml(slide.description || '') +
      '</textarea></label>' +
      '<div class="admin-form-grid">' +
      '<label class="admin-field"><span class="admin-field__label">نص الزر الرئيسي</span>' +
      '<input class="admin-field__input" data-hero-field="buttonText" value="' +
      escapeHtml(slide.buttonText || '') +
      '" /></label>' +
      '<label class="admin-field"><span class="admin-field__label">رابط الزر الرئيسي</span>' +
      '<input class="admin-field__input" data-hero-field="buttonHref" value="' +
      escapeHtml(slide.buttonHref || '') +
      '" /></label>' +
      '<label class="admin-field"><span class="admin-field__label">نص الزر الثانوي</span>' +
      '<input class="admin-field__input" data-hero-field="secondaryButtonText" value="' +
      escapeHtml(slide.secondaryButtonText || '') +
      '" /></label>' +
      '<label class="admin-field"><span class="admin-field__label">رابط الزر الثانوي</span>' +
      '<input class="admin-field__input" data-hero-field="secondaryButtonHref" value="' +
      escapeHtml(slide.secondaryButtonHref || '') +
      '" /></label>' +
      '</div>' +
      '<div class="admin-form-grid">' +
      '<label class="admin-field"><span class="admin-field__label">لون النص</span>' +
      '<input class="admin-field__input" type="color" data-hero-field="textColor" value="' +
      escapeHtml(slide.textColor || '#ffffff') +
      '" /></label>' +
      '<label class="admin-field"><span class="admin-field__label">لون الخلفية (Tint)</span>' +
      '<input class="admin-field__input" type="color" data-hero-field="bgTint" value="' +
      escapeHtml(slide.bgTint || '#0b1220') +
      '" /></label>' +
      '</div>' +
      '<label class="admin-field admin-field--inline">' +
      '<input type="checkbox" data-hero-field="showTrust" ' +
      (slide.showTrust ? 'checked' : '') +
      ' />' +
      '<span class="admin-field__label">إظهار نقاط الثقة (Trust badges)</span></label>' +
      '</div></div></article>'
    );
  }

  function renderHeroSlidesList() {
    var list = $('cmsHeroSlidesList');
    if (!list) return;
    if (!heroSlidesDraft.length) {
      list.innerHTML = '<p class="admin-empty-cell">لا توجد شرائح — أضف شريحة جديدة أو استعد الافتراضي.</p>';
      return;
    }
    list.innerHTML = heroSlidesDraft
      .map(function (slide, index) {
        return renderHeroSlideCard(slide, index, heroSlidesDraft.length);
      })
      .join('');
    list.querySelectorAll('[data-hero-slide-id]').forEach(function (card) {
      var id = card.getAttribute('data-hero-slide-id');
      var slide = null;
      heroSlidesDraft.forEach(function (s) {
        if (s.id === id) slide = s;
      });
      var imageInput = card.querySelector('[data-hero-field="image"]');
      if (imageInput && slide) imageInput.value = slide.image || '';
    });
  }

  function moveHeroSlide(id, dir) {
    syncHeroSlidesDraftFromDom();
    var idx = -1;
    heroSlidesDraft.forEach(function (s, i) {
      if (s.id === id) idx = i;
    });
    var next = idx + dir;
    if (idx < 0 || next < 0 || next >= heroSlidesDraft.length) return;
    var tmp = heroSlidesDraft[idx];
    heroSlidesDraft[idx] = heroSlidesDraft[next];
    heroSlidesDraft[next] = tmp;
    renderHeroSlidesList();
  }

  function saveHeroSlideshowFromForm() {
    if (!window.PlatformHeroSlideshow) return;
    syncHeroSlidesDraftFromDom();
    var saved = window.PlatformHeroSlideshow.saveConfig({
      intervalSeconds: $('cmsHeroInterval') && $('cmsHeroInterval').value,
      slides: heroSlidesDraft,
    });
    heroSlidesDraft = saved.slides.slice();
    renderHeroSlidesList();
    var status = $('cmsHeroSlideshowSaveStatus');
    if (status) {
      status.textContent = 'تم الحفظ — ' + saved.slides.length + ' شريحة · كل ' + saved.intervalSeconds + ' ثانية';
    }
    toast('تم حفظ الصفحة الرئيسية');
    reloadSitePreview();
  }

  function resetHeroSlideshow() {
    if (!window.confirm('استعادة الشرائح الافتراضية؟ سيتم استبدال جميع الشرائح الحالية.')) return;
    heroSlidesDraft = window.PlatformHeroSlideshow.defaultSlides().slice();
    renderHeroSlidesList();
    toast('تمت استعادة الشرائح الافتراضية — اضغط حفظ لتطبيقها');
  }

  function bindHeroSlideshowEditor() {
    var form = $('cmsHeroSlideshowForm');
    if (!form || !window.PlatformHeroSlideshow) return;
    renderHeroSlideshowEditor();
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      saveHeroSlideshowFromForm();
    });
    var resetBtn = $('cmsHeroSlideshowReset');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        resetHeroSlideshow();
      });
    }
    var addBtn = $('cmsHeroAddSlide');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        syncHeroSlidesDraftFromDom();
        if (heroSlidesDraft.length >= window.PlatformHeroSlideshow.MAX_SLIDES) {
          toast('الحد الأقصى ' + window.PlatformHeroSlideshow.MAX_SLIDES + ' شرائح', true);
          return;
        }
        heroSlidesDraft.push(window.PlatformHeroSlideshow.blankSlide());
        renderHeroSlidesList();
      });
    }

    form.addEventListener('click', function (e) {
      var up = e.target.closest ? e.target.closest('[data-hero-slide-up]') : null;
      if (up) {
        moveHeroSlide(up.getAttribute('data-hero-slide-up'), -1);
        return;
      }
      var down = e.target.closest ? e.target.closest('[data-hero-slide-down]') : null;
      if (down) {
        moveHeroSlide(down.getAttribute('data-hero-slide-down'), 1);
        return;
      }
      var removeBtn = e.target.closest ? e.target.closest('[data-hero-slide-remove]') : null;
      if (removeBtn) {
        syncHeroSlidesDraftFromDom();
        var removeId = removeBtn.getAttribute('data-hero-slide-remove');
        heroSlidesDraft = heroSlidesDraft.filter(function (s) {
          return s.id !== removeId;
        });
        renderHeroSlidesList();
      }
    });

    form.addEventListener('change', function (e) {
      var fileInput = e.target.closest ? e.target.closest('[data-hero-slide-file]') : null;
      if (!fileInput || !fileInput.files || !fileInput.files[0]) return;
      var file = fileInput.files[0];
      if (file.size > window.PlatformHeroSlideshow.MAX_IMAGE_BYTES) {
        toast('حجم الصورة كبير جداً', true);
        fileInput.value = '';
        return;
      }
      var slideId = fileInput.getAttribute('data-hero-slide-file');
      readFileAsDataUrl(file, function (url) {
        var card = form.querySelector('[data-hero-slide-id="' + slideId + '"]');
        if (!card) return;
        var hidden = card.querySelector('[data-hero-field="image"]');
        var visual = card.querySelector('[data-hero-field="visualType"]');
        if (hidden) hidden.value = url;
        if (visual) visual.value = 'image';
        heroSlidesDraft.forEach(function (s) {
          if (s.id === slideId) {
            s.image = url;
            s.visualType = 'image';
          }
        });
        renderHeroSlidesList();
        fileInput.value = '';
      });
    });
  }

  /* ---------- Rich editor / image engine ---------- */
  function clearImageSelection() {
    if (selectedEditorImage) {
      selectedEditorImage.classList.remove('cms-img-selected', 'is-selected');
      selectedEditorImage = null;
    }
    var handles = $('articleImgHandles');
    var menu = $('articleImgContextMenu');
    var trigger = $('articleImgLayoutTrigger');
    if (handles) handles.hidden = true;
    if (menu) menu.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }

  function hideImageLayoutMenu() {
    var menu = $('articleImgContextMenu');
    var trigger = $('articleImgLayoutTrigger');
    if (menu) menu.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }

  function positionImageLayoutMenu() {
    var menu = $('articleImgContextMenu');
    var wrap = $('articleEditorBodyWrap');
    var handles = $('articleImgHandles');
    if (!menu || !wrap || !handles || menu.hidden || handles.hidden) return;
    var wrapRect = wrap.getBoundingClientRect();
    var handleRect = handles.getBoundingClientRect();
    var left = handleRect.right - wrapRect.left + wrap.scrollLeft - 8;
    var top = handleRect.top - wrapRect.top + wrap.scrollTop + 34;
    var maxLeft = wrap.clientWidth - menu.offsetWidth - 8;
    if (left > maxLeft) left = Math.max(8, maxLeft);
    if (left < 8) left = 8;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }

  function syncImageLayoutMenuActive() {
    var menu = $('articleImgContextMenu');
    if (!menu || !selectedEditorImage) return;
    var layout = selectedEditorImage.getAttribute('data-cms-layout') || '';
    var position = selectedEditorImage.getAttribute('data-cms-position') || 'flow';
    menu.querySelectorAll('[data-img-layout]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-img-layout') === layout);
    });
    menu.querySelectorAll('[data-img-position]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-img-position') === position);
    });
  }

  function showImageLayoutMenu() {
    var menu = $('articleImgContextMenu');
    var trigger = $('articleImgLayoutTrigger');
    if (!menu || !selectedEditorImage) return;
    menu.hidden = false;
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    syncImageLayoutMenuActive();
    positionImageLayoutMenu();
  }

  function toggleImageLayoutMenu() {
    var menu = $('articleImgContextMenu');
    if (!menu) return;
    if (menu.hidden) showImageLayoutMenu();
    else hideImageLayoutMenu();
  }

  function resetImageStyles(img) {
    var props = [
      'display',
      'verticalAlign',
      'float',
      'margin',
      'shapeOutside',
      'clear',
      'zIndex',
      'opacity',
      'position',
      'top',
      'left',
      'right',
      'pointerEvents',
      'cursor',
      'userSelect',
    ];
    props.forEach(function (p) {
      img.style[p] = '';
    });
  }

  function applyImageLayout(img, layoutKey) {
    if (!img) return;
    resetImageStyles(img);
    img.classList.remove('img-behind-text', 'img-front-text', 'is-selected');
    var layout = IMAGE_LAYOUTS[layoutKey];
    if (!layout) return;
    Object.keys(layout).forEach(function (key) {
      if (layout[key] !== '') img.style[key] = layout[key];
    });
    img.setAttribute('data-cms-layout', layoutKey);
    if (layoutKey === 'behind') {
      img.classList.add('img-behind-text');
      img.style.userSelect = 'none';
      if (!img.style.left) img.style.left = '12px';
      if (!img.style.top) img.style.top = '12px';
      ensureArticleTextLayer(img.parentElement);
    }
    if (layoutKey === 'front') img.classList.add('img-front-text');
    var pos = img.getAttribute('data-cms-position');
    if (pos === 'fixed') applyImagePosition(img, 'fixed');
  }

  function ensureArticleTextLayer(editor) {
    if (!editor) return;
    var kids = [].slice.call(editor.childNodes);
    var hasLooseText = false;
    kids.forEach(function (n) {
      if (n.nodeType === 1 && (n.tagName === 'IMG' || n.classList.contains('article-text-layer'))) return;
      hasLooseText = true;
    });
    if (!hasLooseText) return;
    var layer = editor.querySelector(':scope > .article-text-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'article-text-layer';
      editor.appendChild(layer);
    }
    kids.forEach(function (n) {
      if (n.nodeType === 1 && n.tagName === 'IMG') return;
      if (n === layer) return;
      layer.appendChild(n);
    });
  }

  function applyImagePosition(img, mode) {
    if (!img) return;
    img.setAttribute('data-cms-position', mode);
    if (mode === 'fixed') {
      if (img.getAttribute('data-cms-layout') !== 'behind' && img.getAttribute('data-cms-layout') !== 'front') {
        img.style.position = 'sticky';
      }
      img.style.top = '20px';
    } else {
      var layout = img.getAttribute('data-cms-layout');
      if (layout === 'behind' || layout === 'front') return;
      img.style.position = 'relative';
      img.style.top = '';
    }
  }

  function positionImageHandles() {
    var wrap = $('articleEditorBodyWrap');
    var handles = $('articleImgHandles');
    if (!wrap || !handles || !selectedEditorImage || handles.hidden) return;
    var wrapRect = wrap.getBoundingClientRect();
    var imgRect = selectedEditorImage.getBoundingClientRect();
    handles.style.left = imgRect.left - wrapRect.left + wrap.scrollLeft + 'px';
    handles.style.top = imgRect.top - wrapRect.top + wrap.scrollTop + 'px';
    handles.style.width = imgRect.width + 'px';
    handles.style.height = imgRect.height + 'px';
    positionImageLayoutMenu();
  }

  function selectEditorImage(img) {
    if (!img || img.tagName !== 'IMG') return;
    clearImageSelection();
    selectedEditorImage = img;
    img.classList.add('cms-img-selected', 'is-selected');
    var handles = $('articleImgHandles');
    if (handles) {
      handles.hidden = false;
      positionImageHandles();
    }
    hideImageLayoutMenu();
  }

  function showImageContextMenu() {
    /* Kept for compatibility — layout menu opens only via floating trigger. */
    showImageLayoutMenu();
  }

  function insertImageIntoBody(src) {
    var body = $('articleEditorBody');
    if (!body || !src) return;
    var img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
    img.setAttribute('data-cms-layout', 'inline');
    img.setAttribute('data-cms-position', 'flow');
    applyImageLayout(img, 'inline');
    body.appendChild(img);
    body.appendChild(document.createElement('p'));
    selectEditorImage(img);
  }

  function execAlign(align) {
    var body = $('articleEditorBody');
    if (!body) return;
    body.focus();
    var cmdMap = { right: 'justifyRight', center: 'justifyCenter', left: 'justifyLeft', justify: 'justifyFull' };
    var cmd = cmdMap[align];
    try {
      if (cmd) document.execCommand(cmd, false, null);
    } catch (err) {
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      var node = sel.anchorNode;
      var block = node && node.nodeType === 3 ? node.parentElement : node;
      while (block && block !== body && !/^(P|DIV|H[1-6]|LI|BLOCKQUOTE)$/i.test(block.tagName)) {
        block = block.parentElement;
      }
      if (block && block !== body) block.style.textAlign = align;
    }
  }

  function execDir(dir) {
    var body = $('articleEditorBody');
    if (!body) return;
    body.setAttribute('dir', dir);
    body.focus();
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var node = sel.anchorNode;
    var block = node && node.nodeType === 3 ? node.parentElement : node;
    while (block && block !== body && !/^(P|DIV|H[1-6]|LI|BLOCKQUOTE)$/i.test(block.tagName)) {
      block = block.parentElement;
    }
    if (block && block !== body) block.setAttribute('dir', dir);
  }

  function onResizePointerDown(e) {
    var handle = e.target.closest ? e.target.closest('.cms-img-handle') : null;
    if (!handle || !selectedEditorImage) return;
    e.preventDefault();
    e.stopPropagation();
    var dir = handle.getAttribute('data-handle');
    resizeState = {
      handle: dir,
      startX: e.clientX,
      startY: e.clientY,
      startW: selectedEditorImage.offsetWidth,
      startH: selectedEditorImage.offsetHeight,
    };
    document.addEventListener('pointermove', onResizePointerMove);
    document.addEventListener('pointerup', onResizePointerUp);
  }

  function onResizePointerMove(e) {
    if (!resizeState || !selectedEditorImage) return;
    var dx = e.clientX - resizeState.startX;
    var dy = e.clientY - resizeState.startY;
    var w = resizeState.startW;
    var h = resizeState.startH;
    var handle = resizeState.handle;
    if (handle.indexOf('e') !== -1) w = Math.max(40, resizeState.startW + dx);
    if (handle.indexOf('w') !== -1) w = Math.max(40, resizeState.startW - dx);
    if (handle.indexOf('s') !== -1) h = Math.max(30, resizeState.startH + dy);
    if (handle.indexOf('n') !== -1) h = Math.max(30, resizeState.startH - dy);
    if (handle.length === 2) {
      selectedEditorImage.style.width = w + 'px';
      selectedEditorImage.style.height = h + 'px';
    } else if (handle === 'e' || handle === 'w') {
      selectedEditorImage.style.width = w + 'px';
      selectedEditorImage.style.height = 'auto';
    } else {
      selectedEditorImage.style.height = h + 'px';
      selectedEditorImage.style.width = 'auto';
    }
    positionImageHandles();
  }

  function onResizePointerUp() {
    resizeState = null;
    document.removeEventListener('pointermove', onResizePointerMove);
    document.removeEventListener('pointerup', onResizePointerUp);
  }

  function isBehindImage(img) {
    return !!(
      img &&
      (img.classList.contains('img-behind-text') || img.getAttribute('data-cms-layout') === 'behind')
    );
  }

  function findBehindImageAtPoint(body, clientX, clientY) {
    if (!body || !document.elementsFromPoint) return null;
    var stack = document.elementsFromPoint(clientX, clientY);
    var i;
    for (i = 0; i < stack.length; i++) {
      var el = stack[i];
      if (el && el.tagName === 'IMG' && body.contains(el) && isBehindImage(el)) return el;
    }
    return null;
  }

  function onBehindDragMove(e) {
    if (!dragState || !dragState.img) return;
    e.preventDefault();
    dragState.moved = true;
    var body = dragState.body;
    var rect = body.getBoundingClientRect();
    var left = e.clientX - rect.left + body.scrollLeft - dragState.offsetX;
    var top = e.clientY - rect.top + body.scrollTop - dragState.offsetY;
    var maxLeft = Math.max(0, body.clientWidth - dragState.img.offsetWidth);
    var maxTop = Math.max(0, body.scrollHeight - dragState.img.offsetHeight);
    if (left < 0) left = 0;
    if (top < 0) top = 0;
    if (left > maxLeft) left = maxLeft;
    if (top > maxTop) top = maxTop;
    dragState.img.style.left = left + 'px';
    dragState.img.style.top = top + 'px';
    dragState.img.style.right = 'auto';
    positionImageHandles();
  }

  function onBehindDragEnd() {
    if (dragState && dragState.img) {
      dragState.img.style.zIndex = '1';
      dragState.img.classList.add('is-selected', 'cms-img-selected');
    }
    dragState = null;
    document.removeEventListener('mousemove', onBehindDragMove);
    document.removeEventListener('mouseup', onBehindDragEnd);
  }

  function startBehindDrag(e, img, body) {
    if (!isBehindImage(img)) return false;
    if (e.button != null && e.button !== 0) return false;
    e.preventDefault();
    e.stopPropagation();
    selectEditorImage(img);
    var imgRect = img.getBoundingClientRect();
    dragState = {
      img: img,
      body: body,
      offsetX: e.clientX - imgRect.left,
      offsetY: e.clientY - imgRect.top,
      moved: false,
    };
    img.style.position = 'absolute';
    img.style.zIndex = '5';
    img.classList.add('is-selected', 'cms-img-selected');
    document.addEventListener('mousemove', onBehindDragMove);
    document.addEventListener('mouseup', onBehindDragEnd);
    return true;
  }

  function initRichEditor() {
    var body = $('articleEditorBody');
    var wrap = $('articleEditorBodyWrap');
    var handles = $('articleImgHandles');
    var menu = $('articleImgContextMenu');
    if (!body || !wrap) return;

    body.addEventListener('mousedown', function (e) {
      if (e.target.closest && e.target.closest('.cms-img-handle')) return;
      var img = e.target.closest ? e.target.closest('img') : null;
      if (!img || !body.contains(img) || !isBehindImage(img)) {
        img = findBehindImageAtPoint(body, e.clientX, e.clientY);
      }
      if (img) startBehindDrag(e, img, body);
    });

    body.addEventListener('mouseleave', function () {
      if (dragState) onBehindDragEnd();
    });

    body.addEventListener('click', function (e) {
      if (dragState) return;
      if (e.target.closest && e.target.closest('#articleImgLayoutTrigger')) return;
      if (e.target.closest && e.target.closest('#articleImgContextMenu')) return;
      var img = e.target.closest ? e.target.closest('img') : null;
      if (!img) img = findBehindImageAtPoint(body, e.clientX, e.clientY);
      if (img && body.contains(img)) {
        e.preventDefault();
        selectEditorImage(img);
        return;
      }
      clearImageSelection();
    });

    body.addEventListener('scroll', positionImageHandles);
    wrap.addEventListener('scroll', positionImageHandles);

    if (handles) {
      handles.addEventListener('pointerdown', onResizePointerDown);
    }

    var layoutTrigger = $('articleImgLayoutTrigger');
    if (layoutTrigger) {
      layoutTrigger.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!selectedEditorImage) return;
        toggleImageLayoutMenu();
      });
      layoutTrigger.addEventListener('mousedown', function (e) {
        e.preventDefault();
        e.stopPropagation();
      });
    }

    if (menu) {
      menu.addEventListener('click', function (e) {
        var layoutBtn = e.target.closest ? e.target.closest('[data-img-layout]') : null;
        if (layoutBtn && selectedEditorImage) {
          applyImageLayout(selectedEditorImage, layoutBtn.getAttribute('data-img-layout'));
          selectedEditorImage.classList.add('cms-img-selected', 'is-selected');
          positionImageHandles();
          hideImageLayoutMenu();
          return;
        }
        var posBtn = e.target.closest ? e.target.closest('[data-img-position]') : null;
        if (posBtn && selectedEditorImage) {
          applyImagePosition(selectedEditorImage, posBtn.getAttribute('data-img-position'));
          positionImageHandles();
          hideImageLayoutMenu();
        }
      });
      menu.addEventListener('mousedown', function (e) {
        e.stopPropagation();
      });
    }

    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) {
        clearImageSelection();
        return;
      }
      if (
        selectedEditorImage &&
        !e.target.closest('#articleImgContextMenu') &&
        !e.target.closest('#articleImgLayoutTrigger') &&
        !e.target.closest('#articleImgHandles') &&
        !(e.target.closest && e.target.closest('img') === selectedEditorImage)
      ) {
        hideImageLayoutMenu();
      }
    });

    var insertBtn = $('articleEditorInsertImage');
    var bodyFile = $('articleEditorBodyImageFile');
    if (insertBtn && bodyFile) {
      insertBtn.addEventListener('click', function () {
        bodyFile.click();
      });
      bodyFile.addEventListener('change', function () {
        if (!bodyFile.files || !bodyFile.files[0]) return;
        readFileAsDataUrl(bodyFile.files[0], function (url) {
          insertImageIntoBody(url);
          bodyFile.value = '';
        });
      });
    }

    document.querySelectorAll('[data-cms-align]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        execAlign(btn.getAttribute('data-cms-align'));
      });
    });

    document.querySelectorAll('[data-cms-dir]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        execDir(btn.getAttribute('data-cms-dir'));
      });
    });

    var fullscreenBtn = document.querySelector('.ql-fullscreen');
    if (fullscreenBtn) {
      fullscreenBtn.addEventListener('click', function () {
        var modal = document.getElementById('articleEditorModal');
        var inner =
          document.getElementById('article-modal') ||
          document.querySelector('.ql-container') ||
          wrap;
        var container = modal || inner;
        if (!container) return;
        var on = !container.classList.contains('quill-fullscreen-mode');
        container.classList.toggle('quill-fullscreen-mode', on);
        if (inner && inner !== container) inner.classList.toggle('quill-fullscreen-mode', on);
        fullscreenBtn.classList.toggle('is-active', container.classList.contains('quill-fullscreen-mode'));
        fullscreenBtn.setAttribute(
          'title',
          container.classList.contains('quill-fullscreen-mode') ? 'خروج من ملء الشاشة' : 'ملء الشاشة'
        );
      });
    }
  }

  function sanitizeEditorHtml(html) {
    if (window.PlatformArticles && typeof window.PlatformArticles.sanitizeArticleHtml === 'function') {
      return window.PlatformArticles.sanitizeArticleHtml(html);
    }
    return html;
  }

  /* ---------- Articles ---------- */
  function renderArticlesTable() {
    var body = $('cmsArticlesBody');
    if (!body || !window.PlatformArticles) return;
    var list = window.PlatformArticles.getArticles();
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="5" class="admin-empty-cell">لا توجد مقالات.</td></tr>';
      return;
    }
    body.innerHTML = list
      .map(function (a) {
        return (
          '<tr><td>' +
          escapeHtml(a.title) +
          '</td><td>' +
          escapeHtml(a.category) +
          '</td><td>' +
          statusBadge(a.status) +
          '</td><td>' +
          escapeHtml(a.tags) +
          '</td><td class="admin-table__actions">' +
          '<button class="admin-btn admin-btn--ghost" type="button" data-article-toggle="' +
          escapeHtml(a.id) +
          '">' +
          (a.status === 'published' ? 'إلغاء النشر' : 'نشر') +
          '</button>' +
          '<button class="admin-btn admin-btn--ghost" type="button" data-article-edit="' +
          escapeHtml(a.id) +
          '">تعديل</button>' +
          '<button class="admin-btn admin-btn--danger" type="button" data-article-delete="' +
          escapeHtml(a.id) +
          '">حذف</button>' +
          '</td></tr>'
        );
      })
      .join('');
  }

  function openArticleModal(article) {
    editingArticleId = article && article.id ? article.id : null;
    clearImageSelection();
    $('articleEditorId').value = editingArticleId || '';
    $('articleEditorTitle').value = article ? article.title : '';
    $('articleEditorCategory').value = article ? article.category : '';
    $('articleEditorTags').value = article ? article.tags : '';
    $('articleEditorExcerpt').value = article ? article.excerpt : '';
    $('articleEditorMeta').value = article ? article.meta : '';
    $('articleEditorStatus').value = article ? article.status || 'draft' : 'draft';
    $('articleEditorImageUrl').value =
      article && article.image && article.image.indexOf('data:') !== 0 ? article.image : '';
    $('articleEditorImageData').value = article && article.image ? article.image : '';
    var preview = $('articleEditorImagePreview');
    if (preview) {
      preview.hidden = !article || !article.image;
      preview.src = article && article.image ? article.image : '';
    }
    var body = $('articleEditorBody');
    if (body) {
      body.innerHTML = article ? article.body || '' : '';
      body.style.fontFamily = article && article.fontFamily ? article.fontFamily : '';
      body.style.fontSize = article && article.fontSize ? article.fontSize : '';
      body.style.color = article && article.textColor ? article.textColor : '';
    }
    $('articleEditorFontFamily').value = article && article.fontFamily ? article.fontFamily : '';
    $('articleEditorFontSize').value = article && article.fontSize ? article.fontSize : '1rem';
    $('articleEditorTextColor').value = article && article.textColor ? article.textColor : '#e2e8f0';
    $('articleEditorTitleLabel').textContent = editingArticleId ? 'تعديل مقال' : 'مقال جديد';
    $('articleEditorModal').hidden = false;
  }

  function closeArticleModal() {
    var modal = $('articleEditorModal') || $('article-modal');
    if (modal) {
      modal.hidden = true;
      modal.classList.remove('quill-fullscreen-mode');
    }
    editingArticleId = null;
    clearImageSelection();
  }

  function saveArticleFromForm() {
    var body = $('articleEditorBody');
    clearImageSelection();
    var imageData = $('articleEditorImageData').value || $('articleEditorImageUrl').value;
    var rawBody = body ? body.innerHTML : '';
    window.PlatformArticles.upsertArticle({
      id: $('articleEditorId').value || (window.PlatformArticles.uid && window.PlatformArticles.uid()),
      title: $('articleEditorTitle').value,
      category: $('articleEditorCategory').value,
      tags: $('articleEditorTags').value,
      excerpt: $('articleEditorExcerpt').value,
      meta: $('articleEditorMeta').value,
      image: imageData,
      body: sanitizeEditorHtml(rawBody),
      fontFamily: $('articleEditorFontFamily').value,
      fontSize: $('articleEditorFontSize').value,
      textColor: $('articleEditorTextColor').value,
      status: $('articleEditorStatus').value,
    });
    toast('تم حفظ المقال');
    closeArticleModal();
    renderArticlesTable();
    reloadSitePreview();
  }

  function toggleArticleStatus(id) {
    var list = window.PlatformArticles.getArticles();
    var item = null;
    list.forEach(function (a) {
      if (a.id === id) item = a;
    });
    if (!item) return;
    item.status = item.status === 'published' ? 'draft' : 'published';
    window.PlatformArticles.saveArticles(list);
    renderArticlesTable();
    reloadSitePreview();
    toast(item.status === 'published' ? 'تم نشر المقال' : 'تم تحويل المقال إلى مسودة');
  }

  /* ---------- FAQ ---------- */
  function renderFaqTable() {
    var body = $('cmsFaqBody');
    if (!body || !window.PlatformFaqs) return;
    var list = window.PlatformFaqs.getFaqs();
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="4" class="admin-empty-cell">لا توجد أسئلة.</td></tr>';
      return;
    }
    body.innerHTML = list
      .map(function (f, index) {
        return (
          '<tr data-faq-row="' +
          escapeHtml(f.id) +
          '"><td>' +
          escapeHtml(f.question) +
          '</td><td>' +
          escapeHtml(f.answer).slice(0, 80) +
          (f.answer.length > 80 ? '…' : '') +
          '</td><td>' +
          statusBadge(f.status) +
          '</td><td class="admin-table__actions">' +
          '<button class="admin-btn admin-btn--ghost" type="button" data-faq-toggle="' +
          escapeHtml(f.id) +
          '">' +
          (f.status === 'published' ? 'مسودة' : 'نشر') +
          '</button>' +
          '<button class="admin-btn admin-btn--ghost" type="button" data-faq-up="' +
          index +
          '" ' +
          (index === 0 ? 'disabled' : '') +
          '>↑</button>' +
          '<button class="admin-btn admin-btn--ghost" type="button" data-faq-down="' +
          index +
          '" ' +
          (index === list.length - 1 ? 'disabled' : '') +
          '>↓</button>' +
          '<button class="admin-btn admin-btn--ghost" type="button" data-faq-edit="' +
          escapeHtml(f.id) +
          '">تعديل</button>' +
          '<button class="admin-btn admin-btn--danger" type="button" data-faq-delete="' +
          escapeHtml(f.id) +
          '">حذف</button>' +
          '</td></tr>'
        );
      })
      .join('');
  }

  function openFaqModal(faq) {
    editingFaqId = faq && faq.id ? faq.id : null;
    $('faqEditorId').value = editingFaqId || '';
    $('faqEditorQuestion').value = faq ? faq.question : '';
    $('faqEditorAnswer').value = faq ? faq.answer : '';
    $('faqEditorStatus').value = faq ? faq.status || 'draft' : 'draft';
    $('faqEditorTitleLabel').textContent = editingFaqId ? 'تعديل سؤال' : 'سؤال جديد';
    $('faqEditorModal').hidden = false;
  }

  function closeFaqModal() {
    $('faqEditorModal').hidden = true;
    editingFaqId = null;
  }

  function saveFaqFromForm() {
    var list = window.PlatformFaqs.getFaqs();
    var item = {
      id: $('faqEditorId').value || window.PlatformFaqs.uid(),
      question: $('faqEditorQuestion').value,
      answer: $('faqEditorAnswer').value,
      status: $('faqEditorStatus').value,
    };
    var idx = -1;
    list.forEach(function (f, i) {
      if (f.id === item.id) idx = i;
    });
    if (idx === -1) list.push(item);
    else list[idx] = item;
    window.PlatformFaqs.saveFaqs(list);
    toast('تم حفظ السؤال');
    closeFaqModal();
    renderFaqTable();
    reloadSitePreview();
  }

  function toggleFaqStatus(id) {
    var list = window.PlatformFaqs.getFaqs();
    list.forEach(function (f) {
      if (f.id === id) f.status = f.status === 'published' ? 'draft' : 'published';
    });
    window.PlatformFaqs.saveFaqs(list);
    renderFaqTable();
    reloadSitePreview();
    toast('تم تحديث حالة السؤال');
  }

  function moveFaq(index, dir) {
    var list = window.PlatformFaqs.getFaqs();
    var next = index + dir;
    if (next < 0 || next >= list.length) return;
    var tmp = list[index];
    list[index] = list[next];
    list[next] = tmp;
    window.PlatformFaqs.saveFaqs(list);
    renderFaqTable();
    reloadSitePreview();
  }

  /* ---------- Testimonials ---------- */
  function renderTestimonialsTable() {
    var body = $('cmsTestimonialsBody');
    if (!body || !window.PlatformTestimonials) return;
    var list = window.PlatformTestimonials.getTestimonials();
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="5" class="admin-empty-cell">لا توجد آراء.</td></tr>';
      return;
    }
    body.innerHTML = list
      .map(function (t) {
        return (
          '<tr><td>' +
          escapeHtml(t.name) +
          '</td><td>' +
          escapeHtml(t.role) +
          '</td><td>' +
          escapeHtml(window.PlatformTestimonials.stars(t.rating)) +
          '</td><td>' +
          statusBadge(t.status, 'testimonial') +
          '</td><td class="admin-table__actions">' +
          '<button class="admin-btn admin-btn--ghost" type="button" data-tst-toggle="' +
          escapeHtml(t.id) +
          '">' +
          (t.status === 'published' ? 'إخفاء' : 'نشر') +
          '</button>' +
          '<button class="admin-btn admin-btn--ghost" type="button" data-tst-edit="' +
          escapeHtml(t.id) +
          '">تعديل</button>' +
          '<button class="admin-btn admin-btn--danger" type="button" data-tst-delete="' +
          escapeHtml(t.id) +
          '">حذف</button>' +
          '</td></tr>'
        );
      })
      .join('');
  }

  function openTestimonialModal(item) {
    editingTestimonialId = item && item.id ? item.id : null;
    $('tstEditorId').value = editingTestimonialId || '';
    $('tstEditorName').value = item ? item.name : '';
    $('tstEditorRole').value = item ? item.role : '';
    $('tstEditorText').value = item ? item.text : '';
    $('tstEditorRating').value = item ? String(item.rating || 5) : '5';
    $('tstEditorStatus').value = item ? item.status || 'published' : 'published';
    $('tstEditorAvatarData').value = item && item.avatar ? item.avatar : '';
    var preview = $('tstEditorAvatarPreview');
    if (preview) {
      preview.hidden = !item || !item.avatar;
      preview.src = item && item.avatar ? item.avatar : '';
    }
    $('tstEditorTitleLabel').textContent = editingTestimonialId ? 'تعديل رأي' : 'رأي جديد';
    $('tstEditorModal').hidden = false;
  }

  function closeTestimonialModal() {
    $('tstEditorModal').hidden = true;
    editingTestimonialId = null;
  }

  function saveTestimonialFromForm() {
    var list = window.PlatformTestimonials.getTestimonials();
    var item = {
      id: $('tstEditorId').value || window.PlatformTestimonials.uid(),
      name: $('tstEditorName').value,
      role: $('tstEditorRole').value,
      text: $('tstEditorText').value,
      rating: Number($('tstEditorRating').value) || 5,
      avatar: $('tstEditorAvatarData').value,
      status: $('tstEditorStatus').value,
    };
    var idx = -1;
    list.forEach(function (t, i) {
      if (t.id === item.id) idx = i;
    });
    if (idx === -1) list.push(item);
    else list[idx] = item;
    window.PlatformTestimonials.saveTestimonials(list);
    toast('تم حفظ الرأي');
    closeTestimonialModal();
    renderTestimonialsTable();
    reloadSitePreview();
  }

  function toggleTestimonialStatus(id) {
    var list = window.PlatformTestimonials.getTestimonials();
    list.forEach(function (t) {
      if (t.id === id) t.status = t.status === 'published' ? 'hidden' : 'published';
    });
    window.PlatformTestimonials.saveTestimonials(list);
    renderTestimonialsTable();
    reloadSitePreview();
    toast('تم تحديث حالة الرأي');
  }

  function bind() {
    if (!$('cmsSimulatorsGrid') && !$('cmsStatsForm') && !$('cmsHeroSlideshowForm')) return;

    renderSimulatorEditors();
    bindStatsEditor();
    bindHeroSlideshowEditor();
    renderArticlesTable();
    renderFaqTable();
    renderTestimonialsTable();
    initRichEditor();

    document.addEventListener('click', function (e) {
      var simSave = e.target.closest ? e.target.closest('[data-sim-save]') : null;
      if (simSave) {
        var editor = simSave.closest('[data-sim-editor]');
        if (editor) saveSimulatorCard(simSave.getAttribute('data-sim-save'), editor);
        return;
      }
      var simIconReset = e.target.closest ? e.target.closest('[data-sim-icon-reset]') : null;
      if (simIconReset) {
        var resetCard = simIconReset.closest('[data-sim-editor]');
        if (resetCard) resetSimIcon(resetCard);
        return;
      }
      if (e.target.closest && e.target.closest('[data-article-add]')) {
        openArticleModal(null);
        return;
      }
      var artToggle = e.target.closest ? e.target.closest('[data-article-toggle]') : null;
      if (artToggle) {
        toggleArticleStatus(artToggle.getAttribute('data-article-toggle'));
        return;
      }
      var artEdit = e.target.closest ? e.target.closest('[data-article-edit]') : null;
      if (artEdit) {
        var articles = window.PlatformArticles.getArticles();
        var found = null;
        articles.forEach(function (a) {
          if (a.id === artEdit.getAttribute('data-article-edit')) found = a;
        });
        if (found) openArticleModal(found);
        return;
      }
      var artDel = e.target.closest ? e.target.closest('[data-article-delete]') : null;
      if (artDel) {
        if (window.confirm('حذف هذا المقال؟')) {
          window.PlatformArticles.deleteArticle(artDel.getAttribute('data-article-delete'));
          renderArticlesTable();
          reloadSitePreview();
          toast('تم حذف المقال');
        }
        return;
      }
      if (e.target.closest && e.target.closest('[data-close-article-modal]')) {
        closeArticleModal();
        return;
      }
      if (e.target.closest && e.target.closest('[data-faq-add]')) {
        openFaqModal(null);
        return;
      }
      var faqToggle = e.target.closest ? e.target.closest('[data-faq-toggle]') : null;
      if (faqToggle) {
        toggleFaqStatus(faqToggle.getAttribute('data-faq-toggle'));
        return;
      }
      var faqEdit = e.target.closest ? e.target.closest('[data-faq-edit]') : null;
      if (faqEdit) {
        var faqs = window.PlatformFaqs.getFaqs();
        var faq = null;
        faqs.forEach(function (f) {
          if (f.id === faqEdit.getAttribute('data-faq-edit')) faq = f;
        });
        if (faq) openFaqModal(faq);
        return;
      }
      var faqDel = e.target.closest ? e.target.closest('[data-faq-delete]') : null;
      if (faqDel) {
        if (window.confirm('حذف هذا السؤال؟')) {
          window.PlatformFaqs.saveFaqs(
            window.PlatformFaqs.getFaqs().filter(function (f) {
              return f.id !== faqDel.getAttribute('data-faq-delete');
            })
          );
          renderFaqTable();
          reloadSitePreview();
          toast('تم حذف السؤال');
        }
        return;
      }
      var faqUp = e.target.closest ? e.target.closest('[data-faq-up]') : null;
      if (faqUp) {
        moveFaq(Number(faqUp.getAttribute('data-faq-up')), -1);
        return;
      }
      var faqDown = e.target.closest ? e.target.closest('[data-faq-down]') : null;
      if (faqDown) {
        moveFaq(Number(faqDown.getAttribute('data-faq-down')), 1);
        return;
      }
      if (e.target.closest && e.target.closest('[data-close-faq-modal]')) {
        closeFaqModal();
        return;
      }
      if (e.target.closest && e.target.closest('[data-tst-add]')) {
        openTestimonialModal(null);
        return;
      }
      var tstToggle = e.target.closest ? e.target.closest('[data-tst-toggle]') : null;
      if (tstToggle) {
        toggleTestimonialStatus(tstToggle.getAttribute('data-tst-toggle'));
        return;
      }
      var tstEdit = e.target.closest ? e.target.closest('[data-tst-edit]') : null;
      if (tstEdit) {
        var tlist = window.PlatformTestimonials.getTestimonials();
        var tst = null;
        tlist.forEach(function (t) {
          if (t.id === tstEdit.getAttribute('data-tst-edit')) tst = t;
        });
        if (tst) openTestimonialModal(tst);
        return;
      }
      var tstDel = e.target.closest ? e.target.closest('[data-tst-delete]') : null;
      if (tstDel) {
        if (window.confirm('حذف هذا الرأي؟')) {
          window.PlatformTestimonials.saveTestimonials(
            window.PlatformTestimonials.getTestimonials().filter(function (t) {
              return t.id !== tstDel.getAttribute('data-tst-delete');
            })
          );
          renderTestimonialsTable();
          reloadSitePreview();
          toast('تم حذف الرأي');
        }
        return;
      }
      if (e.target.closest && e.target.closest('[data-close-tst-modal]')) {
        closeTestimonialModal();
        return;
      }
    });

    document.addEventListener('change', function (e) {
      var simIconFile = e.target.closest ? e.target.closest('[data-sim-icon-file]') : null;
      if (simIconFile && simIconFile.files && simIconFile.files[0]) {
        var file = simIconFile.files[0];
        var card = simIconFile.closest('[data-sim-editor]');
        if (!card) return;
        if (file.size > MAX_SIM_ICON_BYTES) {
          toast('حجم الأيقونة كبير جداً — الحد الأقصى 500 كيلوبايت', true);
          simIconFile.value = '';
          return;
        }
        readFileAsDataUrl(file, function (url) {
          var iconValue = card.querySelector('[data-sim-icon-value]');
          var iconType = card.querySelector('[data-sim-icon-type]');
          if (iconValue) iconValue.value = url;
          if (iconType) iconType.value = 'image';
          updateSimIconPreview(card);
        });
        return;
      }
      if (e.target.id === 'articleEditorImageFile' && e.target.files && e.target.files[0]) {
        readFileAsDataUrl(e.target.files[0], function (url) {
          $('articleEditorImageData').value = url;
          $('articleEditorImagePreview').hidden = false;
          $('articleEditorImagePreview').src = url;
        });
        return;
      }
      if (e.target.id === 'tstEditorAvatarFile' && e.target.files && e.target.files[0]) {
        readFileAsDataUrl(e.target.files[0], function (url) {
          $('tstEditorAvatarData').value = url;
          $('tstEditorAvatarPreview').hidden = false;
          $('tstEditorAvatarPreview').src = url;
        });
      }
    });

    var articleForm = $('articleEditorForm');
    if (articleForm) {
      articleForm.addEventListener('submit', function (e) {
        e.preventDefault();
        saveArticleFromForm();
      });
    }
    var faqForm = $('faqEditorForm');
    if (faqForm) {
      faqForm.addEventListener('submit', function (e) {
        e.preventDefault();
        saveFaqFromForm();
      });
    }
    var tstForm = $('tstEditorForm');
    if (tstForm) {
      tstForm.addEventListener('submit', function (e) {
        e.preventDefault();
        saveTestimonialFromForm();
      });
    }

    ['articleEditorFontFamily', 'articleEditorFontSize', 'articleEditorTextColor'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('input', function () {
        var body = $('articleEditorBody');
        if (!body) return;
        if (id === 'articleEditorFontFamily') body.style.fontFamily = el.value;
        if (id === 'articleEditorFontSize') body.style.fontSize = el.value;
        if (id === 'articleEditorTextColor') body.style.color = el.value;
      });
    });

    var imageUrl = $('articleEditorImageUrl');
    if (imageUrl) {
      imageUrl.addEventListener('change', function () {
        if (!imageUrl.value) return;
        $('articleEditorImageData').value = imageUrl.value;
        $('articleEditorImagePreview').hidden = false;
        $('articleEditorImagePreview').src = imageUrl.value;
      });
    }

    window.renderAdminSiteCms = function () {
      renderSimulatorEditors();
      renderStatsEditor();
      renderHeroSlideshowEditor();
      renderArticlesTable();
      renderFaqTable();
      renderTestimonialsTable();
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
