/**
 * Public technical articles — localStorage CMS (ifa_platform_articles).
 */
(function (global) {
  'use strict';

  var KEY = 'ifa_platform_articles';

  var ALLOWED_TAGS = {
    p: 1,
    div: 1,
    span: 1,
    br: 1,
    strong: 1,
    em: 1,
    b: 1,
    i: 1,
    u: 1,
    h1: 1,
    h2: 1,
    h3: 1,
    h4: 1,
    h5: 1,
    h6: 1,
    ul: 1,
    ol: 1,
    li: 1,
    a: 1,
    img: 1,
    blockquote: 1,
  };

  var ALLOWED_ATTRS = {
    style: 1,
    class: 1,
    href: 1,
    src: 1,
    alt: 1,
    title: 1,
    width: 1,
    height: 1,
    dir: 1,
    target: 1,
    rel: 1,
    'data-cms-layout': 1,
    'data-cms-position': 1,
  };

  function uid() {
    return 'art-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isAdminPreview() {
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

  function normalizeStatus(value) {
    var s = String(value == null ? '' : value).trim().toLowerCase();
    if (s === 'draft') return 'draft';
    return 'published';
  }

  function isPublishedStatus(status) {
    var s = String(status == null ? '' : status).trim().toLowerCase();
    return !s || s === 'published';
  }

  function defaultArticles() {
    return [
      {
        id: 'art-otdr',
        title: 'أساسيات قراءة منحنى OTDR',
        category: 'دليل فني',
        tags: 'OTDR, أعطال, قياس',
        image: '',
        excerpt: 'تعرّف على كيفية تفسير الأحداث، نقاط الخسارة، والانعكاسات لتحديد مواقع الأعطال بدقة.',
        body:
          '<p>تعرّف على كيفية تفسير الأحداث، نقاط الخسارة، والانعكاسات لتحديد مواقع الأعطال بدقة.</p>',
        fontFamily: '',
        fontSize: '',
        textColor: '',
        meta: 'بقلم فريق التدريب · 8 دقائق قراءة',
        status: 'published',
      },
      {
        id: 'art-gpon',
        title: 'أفضل ممارسات تصميم شبكة GPON',
        category: 'محتوى المدربين',
        tags: 'GPON, تصميم, FTTH',
        image: '',
        excerpt: 'إرشادات من المدربين حول تخطيط التقسيم، حساب الميزانية البصرية، وتجنب الأخطاء الشائعة في الميدان.',
        body:
          '<p>إرشادات من المدربين حول تخطيط التقسيم، حساب الميزانية البصرية، وتجنب الأخطاء الشائعة في الميدان.</p>',
        fontFamily: '',
        fontSize: '',
        textColor: '',
        meta: 'بقلم المدربين · 12 دقيقة قراءة',
        status: 'published',
      },
      {
        id: 'art-splice',
        title: 'دليل اللحام البصري خطوة بخطوة',
        category: 'دليل تركيبي',
        tags: 'Fusion, لحام, تركيب',
        image: '',
        excerpt: 'شرح عملي لعملية Fusion Splicing من التحضير حتى اختبار الخسارة، مع نصائح للنتائج الاحترافية.',
        body:
          '<p>شرح عملي لعملية Fusion Splicing من التحضير حتى اختبار الخسارة، مع نصائح للنتائج الاحترافية.</p>',
        fontFamily: '',
        fontSize: '',
        textColor: '',
        meta: 'بقلم فريق الأكاديمية · 10 دقائق قراءة',
        status: 'published',
      },
    ];
  }

  function readJson(fallback) {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function sanitizeAttrValue(name, value) {
    var v = String(value == null ? '' : value);
    if (/^on/i.test(name)) return '';
    if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(v)) return '';
    return v;
  }

  function sanitizeNode(node) {
    if (!node) return null;
    if (node.nodeType === 3) return node.cloneNode(false);
    if (node.nodeType !== 1) return null;

    var tag = node.tagName ? node.tagName.toLowerCase() : '';
    if (!ALLOWED_TAGS[tag]) {
      var frag = document.createDocumentFragment();
      var children = node.childNodes;
      var i;
      for (i = 0; i < children.length; i++) {
        var child = sanitizeNode(children[i]);
        if (child) frag.appendChild(child);
      }
      return frag;
    }

    var clean = document.createElement(tag);
    var attrs = node.attributes;
    var j;
    for (j = 0; j < attrs.length; j++) {
      var attr = attrs[j];
      if (!ALLOWED_ATTRS[attr.name]) continue;
      var safeVal = sanitizeAttrValue(attr.name, attr.value);
      if (safeVal !== '') clean.setAttribute(attr.name, safeVal);
    }

    var kids = node.childNodes;
    for (j = 0; j < kids.length; j++) {
      var sanitizedChild = sanitizeNode(kids[j]);
      if (!sanitizedChild) continue;
      if (sanitizedChild.nodeType === 11) {
        while (sanitizedChild.firstChild) clean.appendChild(sanitizedChild.firstChild);
      } else {
        clean.appendChild(sanitizedChild);
      }
    }
    return clean;
  }

  function sanitizeArticleHtml(html) {
    var raw = String(html || '');
    if (!raw.trim()) return '';
    var template = document.createElement('template');
    template.innerHTML = raw;
    var out = document.createElement('div');
    var nodes = template.content.childNodes;
    var i;
    for (i = 0; i < nodes.length; i++) {
      var part = sanitizeNode(nodes[i]);
      if (!part) continue;
      if (part.nodeType === 11) {
        while (part.firstChild) out.appendChild(part.firstChild);
      } else {
        out.appendChild(part);
      }
    }
    return out.innerHTML;
  }

  function getArticles() {
    var list = readJson(null);
    if (!list) return defaultArticles();
    return list.map(normalizeArticle);
  }

  function getPublishedArticles() {
    var source = getArticles();
    var published = source.filter(function (a) {
      return isPublishedStatus(a.status);
    });
    if (published.length) return published;
    return defaultArticles().filter(function (a) {
      return isPublishedStatus(a.status);
    });
  }

  function normalizeArticle(item) {
    var a = item && typeof item === 'object' ? item : {};
    return {
      id: String(a.id || uid()),
      title: String(a.title || '').trim(),
      category: String(a.category || '').trim(),
      tags: String(a.tags || '').trim(),
      image: String(a.image || ''),
      excerpt: String(a.excerpt || '').trim(),
      body: sanitizeArticleHtml(a.body || ''),
      fontFamily: String(a.fontFamily || ''),
      fontSize: String(a.fontSize || ''),
      textColor: String(a.textColor || ''),
      meta: String(a.meta || '').trim(),
      status: normalizeStatus(a.status),
    };
  }

  function saveArticles(list) {
    var next = (Array.isArray(list) ? list : []).map(normalizeArticle);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch (err) {
      console.error('[PlatformArticles] save failed', err);
    }
    renderPublic();
    try {
      global.dispatchEvent(new CustomEvent('ifa:platform-articles-changed'));
    } catch (err2) {
      /* ignore */
    }
    return next;
  }

  function upsertArticle(article) {
    var list = getArticles();
    var item = normalizeArticle(article);
    if (!item.id) item.id = uid();
    var idx = -1;
    list.forEach(function (a, i) {
      if (a.id === item.id) idx = i;
    });
    if (idx === -1) list.unshift(item);
    else list[idx] = item;
    return saveArticles(list);
  }

  function deleteArticle(id) {
    return saveArticles(
      getArticles().filter(function (a) {
        return a.id !== String(id);
      })
    );
  }

  function excerptFrom(article) {
    if (article.excerpt) return article.excerpt;
    var text = String(article.body || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.slice(0, 160);
  }

  function bodyStyle(article) {
    var parts = [];
    if (article.fontFamily) parts.push('font-family:' + article.fontFamily);
    if (article.fontSize) parts.push('font-size:' + article.fontSize);
    if (article.textColor) parts.push('color:' + article.textColor);
    return parts.join(';');
  }

  function cardHtml(article) {
    var img = article.image
      ? '<img class="article-card__image" src="' +
        escapeHtml(article.image) +
        '" alt="' +
        escapeHtml(article.title) +
        '" />'
      : '';
    var tags = article.tags
      ? '<span class="article-card__meta">' + escapeHtml(article.tags) + '</span>'
      : '';
    return (
      '<article class="article-card fade-in visible" data-article-id="' +
      escapeHtml(article.id) +
      '">' +
      img +
      (article.category
        ? '<span class="article-card__category">' + escapeHtml(article.category) + '</span>'
        : '') +
      '<h3 class="article-card__title">' +
      escapeHtml(article.title) +
      '</h3>' +
      '<p class="article-card__desc">' +
      escapeHtml(excerptFrom(article)) +
      '</p>' +
      (article.meta ? '<span class="article-card__meta">' + escapeHtml(article.meta) + '</span>' : tags) +
      '</article>'
    );
  }

  function findPublicArticlesHost() {
    return (
      document.getElementById('articles-grid') ||
      document.querySelector('.articles-container') ||
      document.querySelector('.articles__grid') ||
      document.getElementById('publicArticlesGrid')
    );
  }

  function renderPublic() {
    var grid = findPublicArticlesHost();
    if (!grid) return;
    grid.style.display = 'grid';
    var list = getPublishedArticles();
    if (isAdminPreview()) {
      var all = getArticles();
      if (all.length) list = all;
    }
    grid.innerHTML = list.length
      ? list.map(cardHtml).join('')
      : defaultArticles().map(cardHtml).join('');
    if (typeof global.reobserveAnimations === 'function') {
      global.reobserveAnimations(grid);
    }
  }

  function loadPublicArticles() {
    renderPublic();
  }

  function bindPublic() {
    try {
      renderPublic();
    } catch (err) {
      console.error('[PlatformArticles] public render failed', err);
    }
    global.addEventListener('storage', function (e) {
      if (!e.key || e.key === KEY) renderPublic();
    });
    global.addEventListener('ifa:platform-articles-changed', renderPublic);
    global.addEventListener('load', renderPublic);
  }

  global.PlatformArticles = {
    KEY: KEY,
    uid: uid,
    getArticles: getArticles,
    getPublishedArticles: getPublishedArticles,
    saveArticles: saveArticles,
    upsertArticle: upsertArticle,
    deleteArticle: deleteArticle,
    defaultArticles: defaultArticles,
    renderPublic: renderPublic,
    loadPublicArticles: loadPublicArticles,
    bodyStyle: bodyStyle,
    sanitizeArticleHtml: sanitizeArticleHtml,
    isAdminPreview: isAdminPreview,
  };
  global.loadPublicArticles = loadPublicArticles;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindPublic);
  } else {
    bindPublic();
  }
})(typeof window !== 'undefined' ? window : this);
