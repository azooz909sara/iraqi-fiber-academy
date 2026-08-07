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

    var modal = document.getElementById('instructorModal');
    var form = document.getElementById('instructorApplyForm');
    var errorEl = document.getElementById('instructorFormError');
    var successEl = document.getElementById('instructorFormSuccess');
    var successAlert = document.getElementById('instructorSuccessAlert');
    var cvFileInput = document.getElementById('instructorCvFile');
    var cvFileNameEl = document.getElementById('instructorCvFileName');
    var selectedCvName = '';

    function resetInstructorForm() {
      if (form) form.reset();
      selectedCvName = '';
      if (cvFileNameEl) cvFileNameEl.textContent = 'لم يتم اختيار ملف';
      if (errorEl) {
        errorEl.hidden = true;
        errorEl.textContent = '';
      }
      if (successEl) {
        successEl.hidden = true;
        successEl.textContent = '';
      }
    }

    function openInstructorModal() {
      if (!modal) return;
      modal.hidden = false;
      modal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      if (errorEl) {
        errorEl.hidden = true;
        errorEl.textContent = '';
      }
      if (successEl) {
        successEl.hidden = true;
        successEl.textContent = '';
      }
      var nameInput = document.getElementById('instructorFullName');
      if (nameInput) nameInput.focus();
    }

    function closeInstructorModal() {
      if (!modal) return;
      modal.hidden = true;
      modal.setAttribute('aria-hidden', 'true');
      if (!successAlert || successAlert.hidden) {
        document.body.style.overflow = '';
      }
    }

    function openSuccessAlert() {
      if (!successAlert) return;
      successAlert.hidden = false;
      successAlert.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      var okBtn = document.getElementById('instructorSuccessOk');
      if (okBtn) okBtn.focus();
    }

    function closeSuccessAlert() {
      if (!successAlert) return;
      successAlert.hidden = true;
      successAlert.setAttribute('aria-hidden', 'true');
      resetInstructorForm();
      closeInstructorModal();
      document.body.style.overflow = '';
    }

    window.openInstructorModal = openInstructorModal;
    window.closeInstructorModal = closeInstructorModal;

    if (cvFileInput && cvFileNameEl) {
      cvFileInput.addEventListener('change', function () {
        selectedCvName = cvFileInput.files && cvFileInput.files[0] ? cvFileInput.files[0].name : '';
        cvFileNameEl.textContent = selectedCvName || 'لم يتم اختيار ملف';
      });
    }

    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-instructor-success-ok]')) {
        closeSuccessAlert();
        return;
      }

      if (e.target.closest && e.target.closest('[data-instructor-modal-close]')) {
        closeInstructorModal();
        return;
      }

      var panelLink = e.target.closest ? e.target.closest('[data-panel]') : null;
      if (panelLink) {
        e.preventDefault();
        if (panelLink.getAttribute('data-instructor-locked') != null || panelLink.classList.contains('is-locked')) {
          alert('لوحة المدرب مقفلة. قدّم طلب انضمام وانتظر موافقة الإدارة.');
          return;
        }
        const panel = panelLink.getAttribute('data-panel');
        if (panel === 'student') return;
        if (panel === 'instructor') {
          window.location.href = 'instructor.html';
          return;
        }
        const routes = {
          login: '/auth/login',
          admin: 'admin.html',
        };
        alert('سيتم ربط هذه الواجهة بلوحة التحكم قريباً.\nالوجهة: ' + (routes[panel] || panel));
        return;
      }

      var joinInstructor = e.target.closest ? e.target.closest('[data-join-instructor]') : null;
      if (joinInstructor) {
        e.preventDefault();
        openInstructorModal();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (successAlert && !successAlert.hidden) {
        closeSuccessAlert();
        return;
      }
      if (modal && !modal.hidden) closeInstructorModal();
    });

    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!window.InstructorApps) {
          alert('تعذر حفظ الطلب. أعد تحميل الصفحة.');
          return;
        }

        if (errorEl) {
          errorEl.hidden = true;
          errorEl.textContent = '';
        }
        if (successEl) {
          successEl.hidden = true;
          successEl.textContent = '';
        }

        try {
          var app = window.InstructorApps.submitApplication({
            fullName: document.getElementById('instructorFullName').value,
            email: document.getElementById('instructorEmail').value,
            bio: document.getElementById('instructorBio').value,
            cvLink: document.getElementById('instructorCvLink').value,
            cvFileName: selectedCvName,
            courses: document.getElementById('instructorCourses').value,
          });

          document.dispatchEvent(
            new CustomEvent('ifa:instructor-application-submitted', { detail: app })
          );

          closeInstructorModal();
          openSuccessAlert();
        } catch (err) {
          if (errorEl) {
            errorEl.textContent = (err && err.message) || 'تعذر إرسال الطلب.';
            errorEl.hidden = false;
          }
        }
      });
    }

    document.querySelectorAll('[data-plan]').forEach(function (button) {
      button.addEventListener('click', function () {
        const plans = { free: 'المجانية', standard: 'القياسية', professional: 'الاحترافية' };
        alert('سيتم ربط هذه الواجهة بنظام الاشتراكات قريباً.\nالباقة المختارة: ' + (plans[this.getAttribute('data-plan')] || ''));
      });
    });

    document.querySelectorAll('.demo__mock-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.demo__mock-btn').forEach(function (b) {
          b.classList.remove('demo__mock-btn--active');
        });
        this.classList.add('demo__mock-btn--active');
      });
    });
  });
})();
