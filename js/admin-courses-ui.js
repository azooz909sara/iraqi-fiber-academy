/**
 * Admin courses management UI for admin.html
 */
(function () {
  'use strict';

  var searchQuery = '';
  var statusFilter = 'all';
  var lessonDrafts = [];
  var uploadTimer = null;
  var toastTimer = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showToast(message, type) {
    var toast = document.getElementById('adminToast');
    if (!toast) {
      window.alert(message);
      return;
    }
    toast.textContent = message;
    toast.className = 'admin-toast admin-toast--' + (type || 'success');
    toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.hidden = true;
    }, 3200);
  }

  function setUploadProgress(visible, percent, label) {
    var status = document.getElementById('courseUploadStatus');
    var bar = document.getElementById('courseUploadBar');
    var labelEl = document.getElementById('courseUploadLabel');
    if (!status) return;
    status.hidden = !visible;
    if (labelEl && label) labelEl.textContent = label;
    if (bar) bar.style.width = Math.max(0, Math.min(100, percent || 0)) + '%';
  }

  function simulateVideoUpload(fileName, onDone) {
    if (uploadTimer) clearInterval(uploadTimer);
    var pct = 0;
    setUploadProgress(true, 0, 'جاري تحميل الفيديو... ' + (fileName || ''));
    uploadTimer = setInterval(function () {
      pct += 10 + Math.floor(Math.random() * 14);
      if (pct >= 100) {
        pct = 100;
        clearInterval(uploadTimer);
        uploadTimer = null;
        setUploadProgress(true, 100, 'اكتمل التحميل: ' + (fileName || ''));
        setTimeout(function () {
          setUploadProgress(false, 0, 'جاري تحميل الفيديو...');
          if (onDone) onDone();
        }, 450);
      } else {
        setUploadProgress(true, pct, 'جاري تحميل الفيديو... ' + pct + '%');
      }
    }, 140);
  }

  function getInstructorOptions() {
    if (!window.InstructorApps || typeof window.InstructorApps.getActiveInstructors !== 'function') {
      return [];
    }
    return window.InstructorApps.getActiveInstructors();
  }

  function fillInstructorSelect(selectedEmail) {
    var select = document.getElementById('courseEditorInstructor');
    if (!select) return;
    var instructors = getInstructorOptions();
    var html = '<option value="">— بدون مدرب —</option>';
    instructors.forEach(function (inst) {
      var selected = normalize(inst.email) === normalize(selectedEmail) ? ' selected' : '';
      html +=
        '<option value="' +
        escapeHtml(inst.email) +
        '"' +
        selected +
        '>' +
        escapeHtml(inst.fullName + ' (' + inst.email + ')') +
        '</option>';
    });
    select.innerHTML = html;
  }

  function normalize(email) {
    return String(email || '').trim().toLowerCase();
  }

  function statusBadge(status) {
    if (status === 'published') {
      return '<span class="admin-badge admin-badge--active">منشور</span>';
    }
    if (status === 'suspended') {
      return '<span class="admin-badge admin-badge--suspended">معلّق</span>';
    }
    return '<span class="admin-badge admin-badge--pending">مسودة</span>';
  }

  function closeCourseModal() {
    var modal = document.getElementById('courseEditorModal');
    if (modal) modal.hidden = true;
  }

  function renderLessonDrafts() {
    var wrap = document.getElementById('courseLessonsList');
    if (!wrap) return;
    if (!lessonDrafts.length) {
      wrap.innerHTML =
        '<p class="admin-lessons-empty">لا توجد دروس بعد. أضف درساً بعنوان ورابط أو ملف فيديو.</p>';
      return;
    }
    wrap.innerHTML = lessonDrafts
      .map(function (lesson, index) {
        return (
          '<div class="admin-lesson-card" data-lesson-index="' +
          index +
          '">' +
          '<div class="admin-lesson-card__head">' +
          '<span class="admin-lesson-card__order">درس ' +
          (index + 1) +
          '</span>' +
          '<button type="button" class="admin-btn admin-btn--danger admin-btn--sm" data-remove-lesson="' +
          index +
          '">حذف</button>' +
          '</div>' +
          '<label class="admin-field">' +
          '<span class="admin-field__label">عنوان الدرس</span>' +
          '<input class="admin-field__input" type="text" data-lesson-field="title" data-lesson-index="' +
          index +
          '" value="' +
          escapeHtml(lesson.title) +
          '" />' +
          '</label>' +
          '<label class="admin-field">' +
          '<span class="admin-field__label">وصف الدرس</span>' +
          '<textarea class="admin-field__input admin-field__textarea" rows="2" data-lesson-field="description" data-lesson-index="' +
          index +
          '">' +
          escapeHtml(lesson.description) +
          '</textarea>' +
          '</label>' +
          '<div class="admin-lesson-card__media">' +
          '<label class="admin-field">' +
          '<span class="admin-field__label">رابط الفيديو</span>' +
          '<input class="admin-field__input" type="url" placeholder="https://..." data-lesson-field="videoUrl" data-lesson-index="' +
          index +
          '" value="' +
          escapeHtml(lesson.videoUrl) +
          '" />' +
          '</label>' +
          '<label class="admin-field">' +
          '<span class="admin-field__label">ملف فيديو / مرفق</span>' +
          '<input class="admin-field__input" type="text" placeholder="اسم الملف أو المسار" data-lesson-field="videoFileName" data-lesson-index="' +
          index +
          '" value="' +
          escapeHtml(lesson.videoFileName) +
          '" />' +
          '</label>' +
          '<label class="admin-field">' +
          '<span class="admin-field__label">رفع ملف (اسم فقط)</span>' +
          '<input class="admin-field__input" type="file" accept="video/*,.mp4,.webm,.mov" data-lesson-file="' +
          index +
          '" />' +
          '</label>' +
          '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  function openCourseModal(course) {
    var modal = document.getElementById('courseEditorModal');
    var titleEl = document.getElementById('courseEditorTitle');
    if (!modal) return;

    document.getElementById('courseEditorId').value = course ? course.id : '';
    document.getElementById('courseEditorName').value = course ? course.title : '';
    document.getElementById('courseEditorDescription').value = course ? course.description : '';
    document.getElementById('courseEditorHours').value = course ? course.durationHours || '' : '';
    document.getElementById('courseEditorWeeks').value = course ? course.durationWeeks || '' : '';
    document.getElementById('courseEditorSchedule').value = course ? course.weeklySchedule || '' : '';
    document.getElementById('courseEditorStatus').value = course ? course.status || 'draft' : 'draft';

    fillInstructorSelect(course ? course.instructorEmail : '');
    lessonDrafts = course && Array.isArray(course.lessons)
      ? course.lessons.map(function (l) {
          return {
            id: l.id,
            title: l.title || '',
            description: l.description || '',
            videoUrl: l.videoUrl || '',
            videoFileName: l.videoFileName || '',
            order: l.order,
            createdAt: l.createdAt,
          };
        })
      : [];
    renderLessonDrafts();

    if (titleEl) titleEl.textContent = course ? 'تعديل كورس' : 'إضافة كورس';
    modal.hidden = false;
    var name = document.getElementById('courseEditorName');
    if (name) name.focus();
  }

  function collectLessonDraftsFromDom() {
    lessonDrafts.forEach(function (lesson, index) {
      var title = document.querySelector(
        '[data-lesson-field="title"][data-lesson-index="' + index + '"]'
      );
      var description = document.querySelector(
        '[data-lesson-field="description"][data-lesson-index="' + index + '"]'
      );
      var videoUrl = document.querySelector(
        '[data-lesson-field="videoUrl"][data-lesson-index="' + index + '"]'
      );
      var videoFileName = document.querySelector(
        '[data-lesson-field="videoFileName"][data-lesson-index="' + index + '"]'
      );
      if (title) lesson.title = title.value;
      if (description) lesson.description = description.value;
      if (videoUrl) lesson.videoUrl = videoUrl.value;
      if (videoFileName) lesson.videoFileName = videoFileName.value;
      lesson.order = index + 1;
    });
    return lessonDrafts;
  }

  function renderCoursesTable() {
    var body = document.getElementById('coursesTableBody');
    var meta = document.getElementById('coursesMeta');
    var publishedStat = document.getElementById('statPublishedCourses');
    if (!body || !window.PlatformCourses) return;

    var list = window.PlatformCourses.getCourses().slice();
    list.sort(function (a, b) {
      return String(b.updatedAt || b.createdAt || '').localeCompare(
        String(a.updatedAt || a.createdAt || '')
      );
    });

    var filtered = list.filter(function (c) {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (!searchQuery) return true;
      var hay =
        String(c.title || '').toLowerCase() +
        ' ' +
        String(c.description || '').toLowerCase() +
        ' ' +
        String(c.instructorName || '').toLowerCase() +
        ' ' +
        String(c.instructorEmail || '').toLowerCase();
      return hay.indexOf(searchQuery) !== -1;
    });

    if (publishedStat) publishedStat.textContent = String(window.PlatformCourses.getPublishedCount());
    if (typeof window.refreshAdminOverviewStats === 'function') {
      window.refreshAdminOverviewStats();
    }
    if (meta) {
      meta.textContent =
        'عرض ' +
        filtered.length +
        ' من ' +
        list.length +
        ' · منشور: ' +
        window.PlatformCourses.getPublishedCount();
    }

    if (!filtered.length) {
      body.innerHTML =
        '<tr><td colspan="7" class="admin-empty-cell">' +
        (list.length ? 'لا نتائج مطابقة للتصفية أو البحث.' : 'لا توجد كورسات. أضف كورساً للبدء.') +
        '</td></tr>';
      return;
    }

    body.innerHTML = filtered
      .map(function (course) {
        var id = escapeHtml(course.id);
        var lessonsCount = Array.isArray(course.lessons) ? course.lessons.length : 0;
        var instructorLabel = course.instructorName || course.instructorEmail || '—';
        var sourceLabel = course.source === 'instructor' ? 'مدرب' : 'إدارة';
        var publishLabel = course.status === 'published' ? 'إلغاء النشر' : 'نشر';
        var publishCls =
          course.status === 'published'
            ? 'admin-btn admin-btn--ghost admin-btn--sm'
            : 'admin-btn admin-btn--primary admin-btn--sm';
        var suspendLabel = course.status === 'suspended' ? 'إلغاء التعليق' : 'تعليق';

        return (
          '<tr data-course-id="' +
          id +
          '">' +
          '<td>' +
          '<div class="admin-user-cell__name">' +
          escapeHtml(course.title) +
          '</div>' +
          '<div class="admin-user-cell__email">' +
          lessonsCount +
          ' درس · ' +
          escapeHtml(sourceLabel) +
          '</div>' +
          '</td>' +
          '<td>' +
          escapeHtml(instructorLabel) +
          '</td>' +
          '<td>' +
          escapeHtml(window.PlatformCourses.formatDuration(course)) +
          '</td>' +
          '<td><div class="admin-cell-clamp">' +
          escapeHtml(course.weeklySchedule || '—') +
          '</div></td>' +
          '<td>' +
          statusBadge(course.status) +
          '</td>' +
          '<td>' +
          escapeHtml(
            window.InstructorApps && window.InstructorApps.formatDate
              ? window.InstructorApps.formatDate(course.updatedAt || course.createdAt)
              : course.updatedAt || '—'
          ) +
          '</td>' +
          '<td>' +
          '<div class="admin-table__actions admin-table__actions--row">' +
          '<button class="admin-btn admin-btn--ghost admin-btn--sm" type="button" data-edit-course="' +
          id +
          '">تعديل</button>' +
          '<button class="' +
          publishCls +
          '" type="button" data-toggle-course-status="' +
          id +
          '" data-next-status="' +
          (course.status === 'published' ? 'draft' : 'published') +
          '">' +
          publishLabel +
          '</button>' +
          '<button class="admin-btn admin-btn--ghost admin-btn--sm" type="button" data-toggle-course-status="' +
          id +
          '" data-next-status="' +
          (course.status === 'suspended' ? 'draft' : 'suspended') +
          '">' +
          suspendLabel +
          '</button>' +
          '<button class="admin-btn admin-btn--danger admin-btn--sm" type="button" data-delete-course="' +
          id +
          '">حذف</button>' +
          '</div>' +
          '</td>' +
          '</tr>'
        );
      })
      .join('');
  }

  function bind() {
    var search = document.getElementById('courseSearch');
    if (search) {
      search.addEventListener('input', function () {
        searchQuery = search.value.trim().toLowerCase();
        renderCoursesTable();
      });
    }

    var filter = document.getElementById('coursesStatusFilter');
    if (filter) {
      filter.addEventListener('change', function () {
        statusFilter = filter.value || 'all';
        renderCoursesTable();
      });
    }

    var addBtn = document.getElementById('addCourseBtn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        openCourseModal(null);
      });
    }

    var refreshBtn = document.getElementById('refreshCoursesBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', renderCoursesTable);
    }

    var addLessonBtn = document.getElementById('addCourseLessonBtn');
    if (addLessonBtn) {
      addLessonBtn.addEventListener('click', function () {
        collectLessonDraftsFromDom();
        lessonDrafts.push({
          id: 'lesson_' + Date.now().toString(36),
          title: '',
          description: '',
          videoUrl: '',
          videoFileName: '',
          order: lessonDrafts.length + 1,
          createdAt: new Date().toISOString(),
        });
        renderLessonDrafts();
      });
    }

    var form = document.getElementById('courseEditorForm');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!window.PlatformCourses) return;
        var id = (document.getElementById('courseEditorId') || {}).value || '';
        var instructorSelect = document.getElementById('courseEditorInstructor');
        var instructorEmail = instructorSelect ? instructorSelect.value : '';
        var instructorName = '';
        if (instructorSelect && instructorSelect.selectedIndex >= 0) {
          var opt = instructorSelect.options[instructorSelect.selectedIndex];
          if (opt && instructorEmail) {
            instructorName = String(opt.textContent || '').split(' (')[0];
          }
        }
        var payload = {
          title: (document.getElementById('courseEditorName') || {}).value,
          description: (document.getElementById('courseEditorDescription') || {}).value,
          durationHours: (document.getElementById('courseEditorHours') || {}).value,
          durationWeeks: (document.getElementById('courseEditorWeeks') || {}).value,
          weeklySchedule: (document.getElementById('courseEditorSchedule') || {}).value,
          status: (document.getElementById('courseEditorStatus') || {}).value,
          instructorEmail: instructorEmail,
          instructorName: instructorName,
          lessons: collectLessonDraftsFromDom(),
        };
        try {
          var wasPublish = payload.status === 'published';
          if (id) window.PlatformCourses.updateCourse(id, payload);
          else window.PlatformCourses.addCourse(payload);
          closeCourseModal();
          renderCoursesTable();
          if (wasPublish) showToast('تم النشر بنجاح!', 'success');
          else showToast(id ? 'تم حفظ التعديلات' : 'تم إنشاء الكورس وحفظه في المنصة', 'success');
        } catch (err) {
          alert((err && err.message) || 'تعذر حفظ الكورس');
        }
      });
    }

    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-close-course-modal]')) {
        closeCourseModal();
        return;
      }

      var removeLesson = e.target.closest ? e.target.closest('[data-remove-lesson]') : null;
      if (removeLesson) {
        collectLessonDraftsFromDom();
        var idx = Number(removeLesson.getAttribute('data-remove-lesson'));
        if (!isNaN(idx)) {
          lessonDrafts.splice(idx, 1);
          renderLessonDrafts();
        }
        return;
      }

      if (!window.PlatformCourses) return;

      var editBtn = e.target.closest ? e.target.closest('[data-edit-course]') : null;
      var toggleBtn = e.target.closest ? e.target.closest('[data-toggle-course-status]') : null;
      var deleteBtn = e.target.closest ? e.target.closest('[data-delete-course]') : null;

      if (editBtn) {
        var course = window.PlatformCourses.findCourse(editBtn.getAttribute('data-edit-course'));
        if (course) openCourseModal(course);
        return;
      }

      if (toggleBtn) {
        try {
          var target = window.PlatformCourses.findCourse(
            toggleBtn.getAttribute('data-toggle-course-status')
          );
          if (!target) return;
          var next =
            toggleBtn.getAttribute('data-next-status') ||
            (target.status === 'published' ? 'draft' : 'published');
          window.PlatformCourses.setCourseStatus(target.id, next);
          renderCoursesTable();
          if (next === 'published') showToast('تم النشر بنجاح!', 'success');
          else if (next === 'suspended') showToast('تم تعليق الكورس', 'info');
          else showToast('تم تحديث حالة الكورس', 'info');
        } catch (err) {
          alert((err && err.message) || 'تعذر تحديث حالة النشر');
        }
        return;
      }

      if (deleteBtn) {
        if (!window.confirm('حذف هذا الكورس نهائياً؟')) return;
        try {
          window.PlatformCourses.deleteCourse(deleteBtn.getAttribute('data-delete-course'));
          renderCoursesTable();
          showToast('تم حذف الكورس من المنصة', 'info');
        } catch (err) {
          alert((err && err.message) || 'تعذر حذف الكورس');
        }
      }
    });

    document.addEventListener('change', function (e) {
      if (!e.target || !e.target.getAttribute) return;
      var fileIndex = e.target.getAttribute('data-lesson-file');
      if (fileIndex == null) return;
      var idx = Number(fileIndex);
      var file = e.target.files && e.target.files[0];
      if (!file || isNaN(idx) || !lessonDrafts[idx]) return;
      collectLessonDraftsFromDom();
      simulateVideoUpload(file.name, function () {
        lessonDrafts[idx].videoFileName = file.name;
        var nameInput = document.querySelector(
          '[data-lesson-field="videoFileName"][data-lesson-index="' + idx + '"]'
        );
        if (nameInput) nameInput.value = file.name;
        showToast('تم ربط ملف الفيديو: ' + file.name, 'success');
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var modal = document.getElementById('courseEditorModal');
      if (modal && !modal.hidden) closeCourseModal();
    });

    window.addEventListener('storage', function (e) {
      if (
        e.key === 'platform_courses' ||
        e.key === 'ifa_platform_courses' ||
        e.key === 'ifa_approved_instructors'
      ) {
        renderCoursesTable();
      }
    });

    document.addEventListener('ifa:platform-courses-changed', function () {
      renderCoursesTable();
    });

    document.addEventListener('ifa:instructor-status-changed', function () {
      var modal = document.getElementById('courseEditorModal');
      if (modal && !modal.hidden) {
        fillInstructorSelect((document.getElementById('courseEditorInstructor') || {}).value);
      }
    });

    renderCoursesTable();
  }

  window.renderAdminCoursesTable = renderCoursesTable;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
