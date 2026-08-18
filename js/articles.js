/**
 * Public technical articles — localStorage CMS (ifa_platform_articles).
 */
(function (global) {
  'use strict';

  var KEY = 'ifa_platform_articles';

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

  function getArticles() {
    var list = readJson(null);
    if (!list) return defaultArticles();
    return list.map(normalizeArticle);
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
      body: String(a.body || ''),
      fontFamily: String(a.fontFamily || ''),
      fontSize: String(a.fontSize || ''),
      textColor: String(a.textColor || ''),
      meta: String(a.meta || '').trim(),
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
      '<article class="article-card fade-in" data-article-id="' +
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

  function renderPublic() {
    var grid = document.querySelector('.articles__grid');
    if (!grid) return;
    var list = getArticles();
    grid.innerHTML = list.length
      ? list.map(cardHtml).join('')
      : '<p class="section__subtitle">لا توجد مقالات بعد.</p>';
  }

  function bindPublic() {
    renderPublic();
    global.addEventListener('storage', function (e) {
      if (!e.key || e.key === KEY) renderPublic();
    });
    global.addEventListener('ifa:platform-articles-changed', renderPublic);
  }

  global.PlatformArticles = {
    KEY: KEY,
    uid: uid,
    getArticles: getArticles,
    saveArticles: saveArticles,
    upsertArticle: upsertArticle,
    deleteArticle: deleteArticle,
    defaultArticles: defaultArticles,
    renderPublic: renderPublic,
    bodyStyle: bodyStyle,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindPublic);
  } else {
    bindPublic();
  }
})(typeof window !== 'undefined' ? window : this);
