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

  /* ---------- Simulators ---------- */
  function renderSimulatorEditors() {
    var host = $('cmsSimulatorsGrid');
    if (!host || !window.PlatformSimulators) return;
    var catalog = window.PlatformSimulators.getCatalog();
    var meta = window.PlatformSimulators.getSimulatorMeta();
    host.innerHTML = catalog
      .map(function (sim) {
        var m = meta[sim.id] || {};
        return (
          '<article class="cms-sim-card" data-sim-editor="' +
          escapeHtml(sim.id) +
          '">' +
          '<div class="cms-sim-card__head">' +
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
    var current = window.PlatformSimulators.getSimulatorMeta()[id] || {};
    var patch = {};
    patch[id] = {
      title: title ? title.value : current.title,
      description: desc ? desc.value : current.description,
      icon: current.icon,
      iconType: current.iconType,
    };
    window.PlatformSimulators.saveSimulatorMeta(patch);
    toast('تم حفظ بطاقة المحاكي');
    renderSimulatorEditors();
    reloadSitePreview();
  }

  /* ---------- Rich editor / image engine ---------- */
  function clearImageSelection() {
    if (selectedEditorImage) {
      selectedEditorImage.classList.remove('cms-img-selected', 'is-selected');
      selectedEditorImage = null;
    }
    var handles = $('articleImgHandles');
    var menu = $('articleImgContextMenu');
    if (handles) handles.hidden = true;
    if (menu) menu.hidden = true;
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
  }

  function selectEditorImage(img, clientX, clientY) {
    if (!img || img.tagName !== 'IMG') return;
    clearImageSelection();
    selectedEditorImage = img;
    img.classList.add('cms-img-selected', 'is-selected');
    var handles = $('articleImgHandles');
    if (handles) {
      handles.hidden = false;
      positionImageHandles();
    }
    showImageContextMenu(clientX, clientY);
  }

  function showImageContextMenu(clientX, clientY) {
    var menu = $('articleImgContextMenu');
    var wrap = $('articleEditorBodyWrap');
    if (!menu || !wrap) return;
    menu.hidden = false;
    var wrapRect = wrap.getBoundingClientRect();
    var x = (clientX || wrapRect.left + 12) - wrapRect.left + wrap.scrollLeft;
    var y = (clientY || wrapRect.top + 12) - wrapRect.top + wrap.scrollTop;
    menu.style.left = Math.max(8, x) + 'px';
    menu.style.top = Math.max(8, y) + 'px';
    if (selectedEditorImage) {
      var layout = selectedEditorImage.getAttribute('data-cms-layout') || '';
      var position = selectedEditorImage.getAttribute('data-cms-position') || 'flow';
      menu.querySelectorAll('[data-img-layout]').forEach(function (btn) {
        btn.classList.toggle('is-active', btn.getAttribute('data-img-layout') === layout);
      });
      menu.querySelectorAll('[data-img-position]').forEach(function (btn) {
        btn.classList.toggle('is-active', btn.getAttribute('data-img-position') === position);
      });
    }
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
    selectEditorImage(img, e.clientX, e.clientY);
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
      var img = e.target.closest ? e.target.closest('img') : null;
      if (!img) img = findBehindImageAtPoint(body, e.clientX, e.clientY);
      if (img && body.contains(img)) {
        e.preventDefault();
        selectEditorImage(img, e.clientX, e.clientY);
        return;
      }
      if (!e.target.closest || !e.target.closest('#articleImgContextMenu')) {
        clearImageSelection();
      }
    });

    body.addEventListener('scroll', positionImageHandles);
    wrap.addEventListener('scroll', positionImageHandles);

    if (handles) {
      handles.addEventListener('pointerdown', onResizePointerDown);
    }

    if (menu) {
      menu.addEventListener('click', function (e) {
        var layoutBtn = e.target.closest ? e.target.closest('[data-img-layout]') : null;
        if (layoutBtn && selectedEditorImage) {
          applyImageLayout(selectedEditorImage, layoutBtn.getAttribute('data-img-layout'));
          positionImageHandles();
          showImageContextMenu();
          return;
        }
        var posBtn = e.target.closest ? e.target.closest('[data-img-position]') : null;
        if (posBtn && selectedEditorImage) {
          applyImagePosition(selectedEditorImage, posBtn.getAttribute('data-img-position'));
          positionImageHandles();
          showImageContextMenu();
        }
      });
    }

    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) clearImageSelection();
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
    if (!$('cmsSimulatorsGrid')) return;

    renderSimulatorEditors();
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
