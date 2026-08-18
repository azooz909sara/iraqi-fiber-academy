/**
 * Admin CMS — إدارة موقعي (simulators, articles, FAQs, testimonials).
 */
(function () {
  'use strict';

  var ICON_PRESETS = ['🌐', '📊', '⚡', '🔬', '🧬', '🔌', '🛰️', '📡', '🛠️', '💡', '📈', '🧪'];
  var editingArticleId = null;
  var editingFaqId = null;
  var editingTestimonialId = null;

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

  /* ---------- Simulators ---------- */
  function renderSimulatorEditors() {
    var host = $('cmsSimulatorsGrid');
    if (!host || !window.PlatformSimulators) return;
    var catalog = window.PlatformSimulators.getCatalog();
    var meta = window.PlatformSimulators.getSimulatorMeta();
    host.innerHTML = catalog
      .map(function (sim) {
        var m = meta[sim.id] || {};
        var iconPreview =
          m.iconType === 'image' && m.icon
            ? '<img src="' + escapeHtml(m.icon) + '" alt="" />'
            : '<span>' + escapeHtml(m.icon || '◆') + '</span>';
        var presets = ICON_PRESETS.map(function (icon) {
          return (
            '<button class="cms-icon-chip' +
            (m.iconType !== 'image' && m.icon === icon ? ' is-active' : '') +
            '" type="button" data-sim-icon-preset="' +
            escapeHtml(sim.id) +
            '" data-icon="' +
            escapeHtml(icon) +
            '">' +
            escapeHtml(icon) +
            '</button>'
          );
        }).join('');
        return (
          '<article class="cms-sim-card" data-sim-editor="' +
          escapeHtml(sim.id) +
          '">' +
          '<div class="cms-sim-card__head">' +
          '<div class="cms-sim-card__icon" data-sim-icon-preview>' +
          iconPreview +
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
          '<div class="admin-field"><span class="admin-field__label">الأيقونة</span>' +
          '<div class="cms-icon-row">' +
          presets +
          '</div>' +
          '<label class="cms-file-btn">رفع أيقونة' +
          '<input type="file" accept="image/*" data-sim-icon-file hidden />' +
          '</label></div>' +
          '<button class="admin-btn admin-btn--primary" type="button" data-sim-save="' +
          escapeHtml(sim.id) +
          '">حفظ البطاقة</button>' +
          '</article>'
        );
      })
      .join('');
  }

  function saveSimulatorCard(id, card) {
    var title = card.querySelector('[data-sim-title]');
    var desc = card.querySelector('[data-sim-desc]');
    var preview = card.querySelector('[data-sim-icon-preview]');
    var current = window.PlatformSimulators.getSimulatorMeta()[id] || {};
    var patch = {};
    patch[id] = {
      title: title ? title.value : current.title,
      description: desc ? desc.value : current.description,
      icon: current.icon,
      iconType: current.iconType,
    };
    var img = preview && preview.querySelector('img');
    var span = preview && preview.querySelector('span');
    if (img && img.getAttribute('src')) {
      patch[id].icon = img.getAttribute('src');
      patch[id].iconType = 'image';
    } else if (span) {
      patch[id].icon = span.textContent.trim();
      patch[id].iconType = 'emoji';
    }
    window.PlatformSimulators.saveSimulatorMeta(patch);
    toast('تم حفظ بطاقة المحاكي');
    renderSimulatorEditors();
    reloadSitePreview();
  }

  /* ---------- Articles ---------- */
  function renderArticlesTable() {
    var body = $('cmsArticlesBody');
    if (!body || !window.PlatformArticles) return;
    var list = window.PlatformArticles.getArticles();
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="4" class="admin-empty-cell">لا توجد مقالات.</td></tr>';
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
          escapeHtml(a.tags) +
          '</td><td class="admin-table__actions">' +
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
    $('articleEditorId').value = editingArticleId || '';
    $('articleEditorTitle').value = article ? article.title : '';
    $('articleEditorCategory').value = article ? article.category : '';
    $('articleEditorTags').value = article ? article.tags : '';
    $('articleEditorExcerpt').value = article ? article.excerpt : '';
    $('articleEditorMeta').value = article ? article.meta : '';
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
    $('articleEditorModal').hidden = true;
    editingArticleId = null;
  }

  function saveArticleFromForm() {
    var body = $('articleEditorBody');
    var imageData = $('articleEditorImageData').value || $('articleEditorImageUrl').value;
    window.PlatformArticles.upsertArticle({
      id: $('articleEditorId').value || (window.PlatformArticles.uid && window.PlatformArticles.uid()),
      title: $('articleEditorTitle').value,
      category: $('articleEditorCategory').value,
      tags: $('articleEditorTags').value,
      excerpt: $('articleEditorExcerpt').value,
      meta: $('articleEditorMeta').value,
      image: imageData,
      body: body ? body.innerHTML : '',
      fontFamily: $('articleEditorFontFamily').value,
      fontSize: $('articleEditorFontSize').value,
      textColor: $('articleEditorTextColor').value,
    });
    toast('تم حفظ المقال');
    closeArticleModal();
    renderArticlesTable();
    reloadSitePreview();
  }

  /* ---------- FAQ ---------- */
  function renderFaqTable() {
    var body = $('cmsFaqBody');
    if (!body || !window.PlatformFaqs) return;
    var list = window.PlatformFaqs.getFaqs();
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="3" class="admin-empty-cell">لا توجد أسئلة.</td></tr>';
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
          '</td><td class="admin-table__actions">' +
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
      body.innerHTML = '<tr><td colspan="4" class="admin-empty-cell">لا توجد آراء.</td></tr>';
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
          '</td><td class="admin-table__actions">' +
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

  function bind() {
    if (!$('cmsSimulatorsGrid')) return;

    renderSimulatorEditors();
    renderArticlesTable();
    renderFaqTable();
    renderTestimonialsTable();

    document.addEventListener('click', function (e) {
      var preset = e.target.closest ? e.target.closest('[data-sim-icon-preset]') : null;
      if (preset) {
        var card = preset.closest('[data-sim-editor]');
        var preview = card && card.querySelector('[data-sim-icon-preview]');
        if (preview) preview.innerHTML = '<span>' + escapeHtml(preset.getAttribute('data-icon')) + '</span>';
        card.querySelectorAll('.cms-icon-chip').forEach(function (btn) {
          btn.classList.toggle('is-active', btn === preset);
        });
        return;
      }
      var simSave = e.target.closest ? e.target.closest('[data-sim-save]') : null;
      if (simSave) {
        var editor = simSave.closest('[data-sim-editor]');
        if (editor) saveSimulatorCard(simSave.getAttribute('data-sim-save'), editor);
        return;
      }
      if (e.target.closest && e.target.closest('[data-article-add]')) {
        openArticleModal(null);
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
      var simFile = e.target.closest ? e.target.closest('[data-sim-icon-file]') : null;
      if (simFile && simFile.files && simFile.files[0]) {
        var card = simFile.closest('[data-sim-editor]');
        readFileAsDataUrl(simFile.files[0], function (url) {
          var preview = card.querySelector('[data-sim-icon-preview]');
          if (preview) preview.innerHTML = '<img src="' + url + '" alt="" />';
          card.querySelectorAll('.cms-icon-chip').forEach(function (btn) {
            btn.classList.remove('is-active');
          });
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
