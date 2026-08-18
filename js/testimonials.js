/**
 * Public testimonials — localStorage CMS (ifa_platform_testimonials).
 */
(function (global) {
  'use strict';

  var KEY = 'ifa_platform_testimonials';

  function uid() {
    return 'tst-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function defaultTestimonials() {
    return [
      {
        id: 'tst-1',
        name: 'محمد العتيبي',
        role: 'مدير فني — شركة اتصالات',
        text: 'المحاكي غيّر طريقة تدريبي للفنيين الجدد. أصبح بإمكانهم ارتكاب الأخطاء والتعلم منها دون تكلفة معدات باهظة.',
        rating: 5,
        avatar: '',
      },
      {
        id: 'tst-2',
        name: 'سارة الحربي',
        role: 'مهندسة ألياف ضوئية',
        text: 'كمهندسة شبكات، أعجبني مستوى التفاصيل في محاكاة OTDR. المنحنيات واقعية جداً وساعدتني في فهم قراءة الأعطال بسرعة.',
        rating: 5,
        avatar: '',
      },
      {
        id: 'tst-3',
        name: 'عبدالله القحطاني',
        role: 'فني FTTH — مستقل',
        text: 'انتقلت من صفر معرفة إلى القدرة على تصميم شبكة FTTH كاملة خلال شهرين. المسار التعليمي منظّم وواضح جداً.',
        rating: 4,
        avatar: '',
      },
    ];
  }

  function clampRating(n) {
    var r = Number(n);
    if (!isFinite(r)) r = 5;
    r = Math.round(r);
    if (r < 1) r = 1;
    if (r > 5) r = 5;
    return r;
  }

  function stars(rating) {
    var r = clampRating(rating);
    var out = '';
    var i;
    for (i = 1; i <= 5; i++) out += i <= r ? '★' : '☆';
    return out;
  }

  function initial(name) {
    var s = String(name || '').trim();
    return s ? s.charAt(0) : '؟';
  }

  function getTestimonials() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return defaultTestimonials();
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return defaultTestimonials();
      return parsed.map(normalize);
    } catch (err) {
      return defaultTestimonials();
    }
  }

  function normalize(item) {
    var t = item && typeof item === 'object' ? item : {};
    return {
      id: String(t.id || uid()),
      name: String(t.name || '').trim(),
      role: String(t.role || '').trim(),
      text: String(t.text || '').trim(),
      rating: clampRating(t.rating),
      avatar: String(t.avatar || ''),
    };
  }

  function saveTestimonials(list) {
    var next = (Array.isArray(list) ? list : []).map(normalize);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch (err) {
      console.error('[PlatformTestimonials] save failed', err);
    }
    renderPublic();
    try {
      global.dispatchEvent(new CustomEvent('ifa:platform-testimonials-changed'));
    } catch (err2) {
      /* ignore */
    }
    return next;
  }

  function cardHtml(item) {
    var avatar = item.avatar
      ? '<img class="testimonial-card__avatar-img" src="' +
        escapeHtml(item.avatar) +
        '" alt="' +
        escapeHtml(item.name) +
        '" />'
      : escapeHtml(initial(item.name));
    return (
      '<article class="testimonial-card fade-in" data-testimonial-id="' +
      escapeHtml(item.id) +
      '">' +
      '<span class="testimonial-card__quote">"</span>' +
      '<div class="testimonial-card__stars">' +
      stars(item.rating) +
      '</div>' +
      '<p class="testimonial-card__text">' +
      escapeHtml(item.text) +
      '</p>' +
      '<div class="testimonial-card__author">' +
      '<div class="testimonial-card__avatar">' +
      avatar +
      '</div>' +
      '<div>' +
      '<div class="testimonial-card__name">' +
      escapeHtml(item.name) +
      '</div>' +
      '<div class="testimonial-card__role">' +
      escapeHtml(item.role) +
      '</div>' +
      '</div></div></article>'
    );
  }

  function renderPublic() {
    var grid = document.querySelector('.testimonials__grid');
    if (!grid) return;
    var list = getTestimonials();
    grid.innerHTML = list.length
      ? list.map(cardHtml).join('')
      : '<p class="section__subtitle">لا توجد آراء بعد.</p>';
  }

  function bindPublic() {
    renderPublic();
    global.addEventListener('storage', function (e) {
      if (!e.key || e.key === KEY) renderPublic();
    });
    global.addEventListener('ifa:platform-testimonials-changed', renderPublic);
  }

  global.PlatformTestimonials = {
    KEY: KEY,
    uid: uid,
    getTestimonials: getTestimonials,
    saveTestimonials: saveTestimonials,
    defaultTestimonials: defaultTestimonials,
    renderPublic: renderPublic,
    stars: stars,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindPublic);
  } else {
    bindPublic();
  }
})(typeof window !== 'undefined' ? window : this);
