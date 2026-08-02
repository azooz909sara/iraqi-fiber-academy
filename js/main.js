(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.faq-item').forEach(function (item) {
      const question = item.querySelector('.faq-item__question');
      question.addEventListener('click', function () {
        const isActive = item.classList.contains('active');
        document.querySelectorAll('.faq-item').forEach(function (other) {
          other.classList.remove('active');
          other.querySelector('.faq-item__question').setAttribute('aria-expanded', 'false');
        });
        if (!isActive) {
          item.classList.add('active');
          question.setAttribute('aria-expanded', 'true');
        }
      });
    });

    document.querySelectorAll('[data-plan]').forEach(function (button) {
      button.addEventListener('click', function () {
        const plans = { free: 'المجانية', standard: 'القياسية', professional: 'الاحترافية' };
        alert('سيتم ربط هذه الواجهة بنظام الاشتراكات قريباً.\nالباقة المختارة: ' + (plans[this.getAttribute('data-plan')] || ''));
      });
    });

    document.querySelectorAll('[data-panel]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        const routes = { login: '/auth/login', student: '/dashboard/student', instructor: '/dashboard/instructor', admin: '/dashboard/admin' };
        const panel = this.getAttribute('data-panel');
        alert('سيتم ربط هذه الواجهة بلوحة التحكم قريباً.\nالوجهة: ' + (routes[panel] || panel));
      });
    });

    document.querySelectorAll('.demo__mock-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.demo__mock-btn').forEach(function (b) { b.classList.remove('demo__mock-btn--active'); });
        this.classList.add('demo__mock-btn--active');
      });
    });

  });
})();
