/**
 * Public FAQ accordion — localStorage CMS (ifa_platform_faqs).
 */
(function (global) {
  'use strict';

  var KEY = 'ifa_platform_faqs';

  function uid() {
    return 'faq-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function defaultFaqs() {
    return [
      {
        id: 'faq-1',
        question: 'ما هي أكاديمية الفايبر العراقية وما الذي تقدمه؟',
        answer:
          'أكاديمية الفايبر العراقية هي منصة تدريبية متخصصة في مجال الألياف الضوئية وشبكات FTTH. نوفر محاكيات افتراضية تفاعلية تتيح لك التعلم والتدرب على تصميم وتركيب وصيانة الشبكات البصرية دون الحاجة لمعدات ميدانية.',
      },
      {
        id: 'faq-2',
        question: 'هل أحتاج خبرة سابقة للبدء؟',
        answer:
          'لا، المسار التعليمي مصمم للبدء من الصفر. تبدأ بالمفاهيم الأساسية وتتدرج حتى المستوى الاحترافي. الباقة المجانية تتيح لك تجربة المنصة والتأكد من ملاءمتها لك قبل الاشتراك.',
      },
      {
        id: 'faq-3',
        question: 'متى سيكون المحاكي التفاعلي متاحاً؟',
        answer:
          'نعمل حالياً على تطوير المحاكي التفاعلي الكامل ونخطط لإطلاق النسخة التجريبية (Beta) خلال الربع القادم. يمكنك الانضمام لقائمة الانتظار للحصول على وصول مبكر.',
      },
      {
        id: 'faq-4',
        question: 'هل الشهادات معتمدة؟',
        answer:
          'شهادات الباقة الاحترافية معتمدة من أكاديمية الفايبر العراقية وتُثبت إتمامك للمسار التدريبي الكامل واجتياز المشاريع العملية.',
      },
      {
        id: 'faq-5',
        question: 'هل يمكنني إلغاء اشتراكي في أي وقت؟',
        answer:
          'نعم، يمكنك إلغاء اشتراكك في أي وقت من لوحة التحكم الخاصة بك. سيستمر وصولك حتى نهاية فترة الاشتراك المدفوعة.',
      },
      {
        id: 'faq-6',
        question: 'ما الأجهزة والمتصفحات المدعومة؟',
        answer:
          'المنصة تعمل على جميع الأجهزة عبر المتصفحات الحديثة (Chrome, Firefox, Edge, Safari). للمحاكي المتقدم ننصح باستخدام حاسوب مع شاشة لا تقل عن 13 بوصة.',
      },
    ];
  }

  function getFaqs() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return defaultFaqs();
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return defaultFaqs();
      return parsed.map(function (item) {
        var f = item && typeof item === 'object' ? item : {};
        return {
          id: String(f.id || uid()),
          question: String(f.question || '').trim(),
          answer: String(f.answer || '').trim(),
        };
      });
    } catch (err) {
      return defaultFaqs();
    }
  }

  function saveFaqs(list) {
    var next = (Array.isArray(list) ? list : []).map(function (f) {
      return {
        id: String(f.id || uid()),
        question: String(f.question || '').trim(),
        answer: String(f.answer || '').trim(),
      };
    });
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch (err) {
      console.error('[PlatformFaqs] save failed', err);
    }
    renderPublic();
    try {
      global.dispatchEvent(new CustomEvent('ifa:platform-faqs-changed'));
    } catch (err2) {
      /* ignore */
    }
    return next;
  }

  function itemHtml(faq) {
    return (
      '<div class="faq-item fade-in" data-faq-id="' +
      escapeHtml(faq.id) +
      '">' +
      '<button class="faq-item__question" type="button" aria-expanded="false">' +
      '<span>' +
      escapeHtml(faq.question) +
      '</span>' +
      '<span class="faq-item__icon">+</span>' +
      '</button>' +
      '<div class="faq-item__answer"><p>' +
      escapeHtml(faq.answer) +
      '</p></div>' +
      '</div>'
    );
  }

  function renderPublic() {
    var listEl = document.querySelector('.faq__list');
    if (!listEl) return;
    var list = getFaqs();
    listEl.innerHTML = list.length
      ? list.map(itemHtml).join('')
      : '<p class="section__subtitle">لا توجد أسئلة بعد.</p>';
  }

  function bindPublic() {
    renderPublic();
    global.addEventListener('storage', function (e) {
      if (!e.key || e.key === KEY) renderPublic();
    });
    global.addEventListener('ifa:platform-faqs-changed', renderPublic);
  }

  global.PlatformFaqs = {
    KEY: KEY,
    uid: uid,
    getFaqs: getFaqs,
    saveFaqs: saveFaqs,
    defaultFaqs: defaultFaqs,
    renderPublic: renderPublic,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindPublic);
  } else {
    bindPublic();
  }
})(typeof window !== 'undefined' ? window : this);
