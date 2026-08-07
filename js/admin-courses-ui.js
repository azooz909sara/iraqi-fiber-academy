/**
 * Admin courses management UI for admin.html
 * Catalog presets, drafts soft-delete, academy instructor assignment.
 */
(function () {
  'use strict';

  var searchQuery = '';
  var statusFilter = 'active';
  var lessonDrafts = [];
  var uploadTimer = null;
  var toastTimer = null;
  var dragCourseId = null;
  var dragRowEl = null;
  var dragBound = false;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalize(email) {
    return String(email || '').trim().toLowerCase();
  }

  function academyName() {
    return (window.PlatformCourses && window.PlatformCourses.ACADEMY_NAME) ||
      'أكاديمية الفايبر العراقية';
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
    var selected = normalize(selectedEmail);
    var academySelected = !selected ? ' selected' : '';
    var html =
      '<option value=""' +
      academySelected +
      '>' +
      escapeHtml(academyName()) +
      '</option>';
    instructors.forEach(function (inst) {
      var isSelected = normalize(inst.email) === selected ? ' selected' : '';
      html +=
        '<option value="' +
        escapeHtml(inst.email) +
        '"' +
        isSelected +
        '>' +
        escapeHtml(inst.fullName + ' (' + inst.email + ')') +
        '</option>';
    });
    select.innerHTML = html;
  }

  function fillPresetSelect() {
    var select = document.getElementById('coursePresetSelect');
    if (!select || !window.PlatformCourses) return;
    var grouped = window.PlatformCourses.getPresetsGrouped();
    var html = '<option value="">— اختر لتعبئة النموذج فوراً —</option>';

    function addGroup(label, items) {
      if (!items || !items.length) return;
      html += '<optgroup label="' + escapeHtml(label) + '">';
      items.forEach(function (p) {
        html +=
          '<option value="' +
          escapeHtml(p.id) +
          '">' +
          escapeHtml(p.title) +
          '</option>';
      });
      html += '</optgroup>';
    }

    addGroup('الكورسات المنفردة', grouped.individual);
    addGroup('البرامج الاحترافية المجمعة', grouped.program);
    addGroup('الكورس الشامل', grouped.master);
    select.innerHTML = html;
  }

  function fillRequiredPlanSelect(selectedId, category) {
    var select = document.getElementById('courseEditorRequiredPlan');
    if (!select) return;
    var plans =
      window.PlatformPlans && typeof window.PlatformPlans.getPlans === 'function'
        ? window.PlatformPlans.getPlans()
        : [];
    var preferredLevel = 'free';
    if (category === 'program') preferredLevel = 'standard';
    if (category === 'master') preferredLevel = 'professional';

    var html = '<option value="">— تلقائي حسب فئة الكورس (' + preferredLevel + ') —</option>';
    plans.forEach(function (plan) {
      html +=
        '<option value="' +
        escapeHtml(plan.id) +
        '">' +
        escapeHtml(plan.name) +
        ' — ' +
        escapeHtml(
          window.PlatformPlans.formatPrice
            ? window.PlatformPlans.formatPrice(plan)
            : String(plan.price)
        ) +
        ' (' +
        escapeHtml(plan.accessLevel || '') +
        ')</option>';
    });
    select.innerHTML = html;

    if (selectedId && plans.some(function (p) { return p.id === selectedId; })) {
      select.value = selectedId;
    } else {
      // Prefer plan matching category access level
      var match =
        window.PlatformPlans && window.PlatformPlans.findPlanByAccessLevel
          ? window.PlatformPlans.findPlanByAccessLevel(preferredLevel)
          : null;
      select.value = match ? match.id : '';
    }
  }

  function applyPreset(presetId) {
    if (!window.PlatformCourses || !presetId) return;
    var preset = window.PlatformCourses.findPreset(presetId);
    if (!preset) return;

    document.getElementById('courseEditorName').value = preset.title || '';
    document.getElementById('courseEditorDescription').value = preset.description || '';
    document.getElementById('courseEditorHours').value = preset.durationHours || '';
    document.getElementById('courseEditorWeeks').value = preset.durationWeeks || '';
    document.getElementById('courseEditorPrice').value =
      preset.price != null && preset.price !== '' ? preset.price : '';
    document.getElementById('courseEditorCurrency').value = preset.currency || 'ر.س';
    document.getElementById('courseEditorSchedule').value = preset.weeklySchedule || '';
    document.getElementById('courseEditorCategory').value = preset.category || 'individual';
    document.getElementById('courseEditorStatus').value = 'draft';
    fillRequiredPlanSelect(preset.requiredPlanId || '', preset.category || 'individual');
    fillInstructorSelect('');

    lessonDrafts = (preset.lessons || []).map(function (l, index) {
      return cloneLessonDraft(l, index);
    });
    renderLessonDrafts();
    showToast('تم تعبئة النموذج من الكتالوج — راجع ثم احفظ', 'info');
  }

  function emptyQuiz() {
    return { questions: [] };
  }

  function cloneLessonDraft(l, index) {
    var quiz = l && l.quiz && typeof l.quiz === 'object' ? l.quiz : emptyQuiz();
    var questions = Array.isArray(quiz.questions)
      ? quiz.questions.map(function (q) {
          var opts = Array.isArray(q.options) ? q.options.slice(0, 4) : [];
          while (opts.length < 4) opts.push('');
          return {
            id: q.id || 'q_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
            text: q.text || '',
            options: opts,
            correctIndex: typeof q.correctIndex === 'number' ? q.correctIndex : 0,
            createdAt: q.createdAt || new Date().toISOString(),
          };
        })
      : [];
    return {
      id: (l && l.id) || 'lesson_' + Date.now().toString(36) + '_' + (index || 0),
      title: (l && l.title) || '',
      description: (l && l.description) || '',
      videoUrl: (l && l.videoUrl) || '',
      videoFileName: (l && l.videoFileName) || '',
      videoTitle: (l && l.videoTitle) || '',
      templateFiles: (l && Array.isArray(l.templateFiles) ? l.templateFiles : []) || [],
      quiz: { questions: questions },
      comments: (l && Array.isArray(l.comments) ? l.comments : []) || [],
      order: (l && l.order) || (index || 0) + 1,
      createdAt: (l && l.createdAt) || new Date().toISOString(),
    };
  }

  function renderLessonQuiz(lesson, index) {
    var questions = (lesson.quiz && lesson.quiz.questions) || [];
    var listHtml = questions.length
      ? questions
          .map(function (q, qIdx) {
            var letters = ['أ', 'ب', 'ج', 'د'];
            var opts = (q.options || [])
              .map(function (o, i) {
                return (
                  '<div class="admin-lesson-quiz__option' +
                  (i === q.correctIndex ? ' is-correct' : '') +
                  '">' +
                  (i === q.correctIndex ? '✓ ' : '') +
                  escapeHtml(letters[i] || String(i + 1)) +
                  ') ' +
                  escapeHtml(o) +
                  '</div>'
                );
              })
              .join('');
            return (
              '<div class="admin-lesson-quiz__item" data-quiz-question-id="' +
              escapeHtml(q.id) +
              '">' +
              '<div class="admin-lesson-quiz__item-head">' +
              '<strong>س' +
              (qIdx + 1) +
              ':</strong> ' +
              escapeHtml(q.text) +
              '<button type="button" class="admin-btn admin-btn--danger admin-btn--sm" data-remove-quiz-question="' +
              index +
              '" data-question-id="' +
              escapeHtml(q.id) +
              '">حذف</button>' +
              '</div>' +
              '<div class="admin-lesson-quiz__options">' +
              opts +
              '</div>' +
              '</div>'
            );
          })
          .join('')
      : '<p class="admin-lesson-quiz__empty">لا أسئلة بعد — أضف أول سؤال MCQ أدناه</p>';

    return (
      '<div class="admin-lesson-quiz" data-lesson-quiz="' +
      index +
      '">' +
      '<div class="admin-lesson-quiz__header">' +
      '<h5 class="admin-lesson-quiz__title">امتحان الحلقة / الاختبار</h5>' +
      '<span class="admin-lesson-quiz__count">' +
      questions.length +
      ' سؤال</span>' +
      '</div>' +
      '<div class="admin-lesson-quiz__list">' +
      listHtml +
      '</div>' +
      '<div class="admin-lesson-quiz__builder">' +
      '<label class="admin-field">' +
      '<span class="admin-field__label">نص السؤال</span>' +
      '<input class="admin-field__input" type="text" placeholder="اكتب السؤال هنا..." data-quiz-field="text" data-lesson-index="' +
      index +
      '" />' +
      '</label>' +
      '<div class="admin-lesson-quiz__opts-grid">' +
      '<label class="admin-field"><span class="admin-field__label">خيار أ</span>' +
      '<input class="admin-field__input" type="text" data-quiz-field="opt0" data-lesson-index="' +
      index +
      '" /></label>' +
      '<label class="admin-field"><span class="admin-field__label">خيار ب</span>' +
      '<input class="admin-field__input" type="text" data-quiz-field="opt1" data-lesson-index="' +
      index +
      '" /></label>' +
      '<label class="admin-field"><span class="admin-field__label">خيار ج</span>' +
      '<input class="admin-field__input" type="text" data-quiz-field="opt2" data-lesson-index="' +
      index +
      '" /></label>' +
      '<label class="admin-field"><span class="admin-field__label">خيار د</span>' +
      '<input class="admin-field__input" type="text" data-quiz-field="opt3" data-lesson-index="' +
      index +
      '" /></label>' +
      '</div>' +
      '<div class="admin-lesson-quiz__builder-row">' +
      '<label class="admin-field">' +
      '<span class="admin-field__label">الإجابة الصحيحة</span>' +
      '<select class="admin-field__input" data-quiz-field="correct" data-lesson-index="' +
      index +
      '">' +
      '<option value="0">أ</option><option value="1">ب</option><option value="2">ج</option><option value="3">د</option>' +
      '</select>' +
      '</label>' +
      '<button type="button" class="admin-btn admin-btn--primary admin-btn--sm" data-add-quiz-question="' +
      index +
      '">إضافة السؤال للامتحان</button>' +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  function statusBadge(course) {
    if (course.softDeleted) {
      return '<span class="admin-badge admin-badge--pending">مسودة (محذوف)</span>';
    }
    if (course.status === 'published') {
      return '<span class="admin-badge admin-badge--active">منشور</span>';
    }
    if (course.status === 'suspended') {
      return '<span class="admin-badge admin-badge--suspended">معلّق</span>';
    }
    return '<span class="admin-badge admin-badge--pending">مسودة</span>';
  }

  function categoryLabel(category) {
    if (category === 'program') return 'برنامج احترافي';
    if (category === 'master') return 'كورس شامل';
    return 'كورس منفرد';
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
        '<p class="admin-lessons-empty">لا توجد دروس بعد. أضف درساً بعنوان وفيديو وامتحان اختياري.</p>';
      return;
    }
    wrap.innerHTML = lessonDrafts
      .map(function (lesson, index) {
        if (!lesson.quiz) lesson.quiz = emptyQuiz();
        var qCount = (lesson.quiz.questions || []).length;
        return (
          '<div class="admin-lesson-card" data-lesson-index="' +
          index +
          '">' +
          '<div class="admin-lesson-card__head">' +
          '<span class="admin-lesson-card__order">درس ' +
          (index + 1) +
          (qCount ? ' · ' + qCount + ' سؤال' : '') +
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
          renderLessonQuiz(lesson, index) +
          '</div>'
        );
      })
      .join('');
  }

  function openCourseModal(course) {
    var modal = document.getElementById('courseEditorModal');
    var titleEl = document.getElementById('courseEditorTitle');
    if (!modal) return;

    fillPresetSelect();
    document.getElementById('coursePresetSelect').value = '';
    document.getElementById('courseEditorId').value = course ? course.id : '';
    document.getElementById('courseEditorName').value = course ? course.title : '';
    document.getElementById('courseEditorDescription').value = course ? course.description : '';
    document.getElementById('courseEditorHours').value = course ? course.durationHours || '' : '';
    document.getElementById('courseEditorWeeks').value = course ? course.durationWeeks || '' : '';
    document.getElementById('courseEditorPrice').value =
      course && course.price != null && course.price !== '' ? course.price : '';
    document.getElementById('courseEditorCurrency').value = course ? course.currency || 'ر.س' : 'ر.س';
    document.getElementById('courseEditorSchedule').value = course ? course.weeklySchedule || '' : '';
    document.getElementById('courseEditorStatus').value = course
      ? course.softDeleted
        ? 'draft'
        : course.status || 'draft'
      : 'draft';
    document.getElementById('courseEditorCategory').value = course
      ? course.category || 'individual'
      : 'individual';
    fillRequiredPlanSelect(
      course ? course.requiredPlanId || '' : '',
      course ? course.category || 'individual' : 'individual'
    );

    fillInstructorSelect(course && !course.isAcademy ? course.instructorEmail : '');
    lessonDrafts =
      course && Array.isArray(course.lessons)
        ? course.lessons.map(function (l, index) {
            return cloneLessonDraft(l, index);
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
      if (!lesson.quiz || typeof lesson.quiz !== 'object') lesson.quiz = emptyQuiz();
      if (!Array.isArray(lesson.quiz.questions)) lesson.quiz.questions = [];
      lesson.order = index + 1;
    });
    return lessonDrafts;
  }

  function readQuizBuilderFields(index) {
    function val(field) {
      var el = document.querySelector(
        '[data-quiz-field="' + field + '"][data-lesson-index="' + index + '"]'
      );
      return el ? String(el.value || '').trim() : '';
    }
    return {
      text: val('text'),
      options: [val('opt0'), val('opt1'), val('opt2'), val('opt3')],
      correctIndex: Number(val('correct')) || 0,
    };
  }

  function addQuizQuestionToLesson(index) {
    collectLessonDraftsFromDom();
    var lesson = lessonDrafts[index];
    if (!lesson) return;
    var draft = readQuizBuilderFields(index);
    if (!draft.text) {
      alert('نص السؤال مطلوب');
      return;
    }
    if (draft.options.some(function (o) { return !o; })) {
      alert('يجب تعبئة الخيارات الأربعة');
      return;
    }
    if (!lesson.quiz) lesson.quiz = emptyQuiz();
    lesson.quiz.questions.push({
      id: 'q_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      text: draft.text,
      options: draft.options,
      correctIndex: Math.max(0, Math.min(3, draft.correctIndex)),
      createdAt: new Date().toISOString(),
    });
    renderLessonDrafts();
  }

  function removeQuizQuestionFromLesson(index, questionId) {
    collectLessonDraftsFromDom();
    var lesson = lessonDrafts[index];
    if (!lesson || !lesson.quiz) return;
    lesson.quiz.questions = (lesson.quiz.questions || []).filter(function (q) {
      return q.id !== questionId;
    });
    renderLessonDrafts();
  }

  function syncTabsUi() {
    var tabs = document.querySelectorAll('[data-courses-tab]');
    tabs.forEach(function (tab) {
      var key = tab.getAttribute('data-courses-tab');
      var active = key === statusFilter || (statusFilter === 'draft' && key === 'draft');
      if (statusFilter === 'published' || statusFilter === 'suspended' || statusFilter === 'all') {
        active = key === 'active';
      }
      if (statusFilter === 'draft') active = key === 'draft';
      if (statusFilter === 'active') active = key === 'active';
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    var filter = document.getElementById('coursesStatusFilter');
    if (filter && filter.value !== statusFilter) filter.value = statusFilter;

    var countEl = document.getElementById('coursesDraftCount');
    if (countEl && window.PlatformCourses) {
      countEl.textContent = String(window.PlatformCourses.getDraftCount());
    }
  }

  function setCoursesView(view) {
    statusFilter = view || 'active';
    syncTabsUi();
    renderCoursesTable();
  }

  function collectVisibleCourseIds() {
    var body = document.getElementById('coursesTableBody');
    if (!body) return [];
    return Array.prototype.slice
      .call(body.querySelectorAll('tr[data-course-id]'))
      .map(function (row) {
        return row.getAttribute('data-course-id');
      })
      .filter(Boolean);
  }

  function clearDragState() {
    dragCourseId = null;
    dragRowEl = null;
    var body = document.getElementById('coursesTableBody');
    if (!body) return;
    body.querySelectorAll('tr.is-dragging, tr.is-drag-over').forEach(function (row) {
      row.classList.remove('is-dragging', 'is-drag-over');
    });
  }

  function moveDraggedRowBeforeTarget(body, targetRow, clientY) {
    if (!dragRowEl || !targetRow || dragRowEl === targetRow || !body.contains(targetRow)) return;
    var rect = targetRow.getBoundingClientRect();
    var placeAfter = clientY > rect.top + rect.height / 2;
    if (placeAfter) {
      var next = targetRow.nextElementSibling;
      if (next === dragRowEl) return;
      body.insertBefore(dragRowEl, next);
    } else {
      if (targetRow.previousElementSibling === dragRowEl) return;
      body.insertBefore(dragRowEl, targetRow);
    }
  }

  function persistDomCourseOrder() {
    if (!window.PlatformCourses || typeof window.PlatformCourses.reorderCourses !== 'function') {
      return false;
    }
    var ids = collectVisibleCourseIds();
    if (ids.length < 1) return false;
    window.PlatformCourses.reorderCourses(ids);
    return true;
  }

  function bindCourseDragAndDrop() {
    var body = document.getElementById('coursesTableBody');
    if (!body || dragBound) return;
    dragBound = true;

    body.addEventListener('dragstart', function (e) {
      var row = e.target.closest ? e.target.closest('tr[data-course-id]') : null;
      if (!row || !body.contains(row)) return;
      if (e.target.closest && e.target.closest('button, a, input, select, textarea, label')) {
        e.preventDefault();
        return;
      }
      if (e.target.closest && e.target.closest('.admin-table__actions')) {
        e.preventDefault();
        return;
      }

      dragCourseId = row.getAttribute('data-course-id');
      dragRowEl = row;
      row.classList.add('is-dragging');
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragCourseId || '');
      } catch (err) {
        /* ignore */
      }
    });

    body.addEventListener('dragend', function () {
      clearDragState();
    });

    body.addEventListener('dragover', function (e) {
      if (!dragRowEl && !dragCourseId) return;
      e.preventDefault();
      try {
        e.dataTransfer.dropEffect = 'move';
      } catch (err) {
        /* ignore */
      }

      var row = e.target.closest ? e.target.closest('tr[data-course-id]') : null;
      if (!row || row === dragRowEl) return;

      body.querySelectorAll('tr.is-drag-over').forEach(function (r) {
        if (r !== row) r.classList.remove('is-drag-over');
      });
      row.classList.add('is-drag-over');
      moveDraggedRowBeforeTarget(body, row, e.clientY);
    });

    body.addEventListener('dragleave', function (e) {
      var row = e.target.closest ? e.target.closest('tr[data-course-id]') : null;
      if (!row) return;
      if (e.relatedTarget && row.contains(e.relatedTarget)) return;
      row.classList.remove('is-drag-over');
    });

    body.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();

      var targetRow = e.target.closest ? e.target.closest('tr[data-course-id]') : null;
      if (targetRow && dragRowEl && targetRow !== dragRowEl) {
        moveDraggedRowBeforeTarget(body, targetRow, e.clientY);
      }

      try {
        var saved = persistDomCourseOrder();
        clearDragState();
        if (saved) {
          renderCoursesTable();
          showToast('تم حفظ ترتيب الكورسات', 'success');
        }
      } catch (err) {
        clearDragState();
        alert((err && err.message) || 'تعذر حفظ الترتيب');
        renderCoursesTable();
      }
    });
  }

  function renderCoursesTable() {
    var body = document.getElementById('coursesTableBody');
    var meta = document.getElementById('coursesMeta');
    var publishedStat = document.getElementById('statPublishedCourses');
    if (!body || !window.PlatformCourses) return;

    var list = window.PlatformCourses.getCourses().slice();
    if (typeof window.PlatformCourses.sortByDisplayOrder === 'function') {
      list.sort(window.PlatformCourses.sortByDisplayOrder);
    }

    var filtered = list.filter(function (c) {
      if (statusFilter === 'active') {
        if (c.softDeleted || c.status === 'draft') return false;
      } else if (statusFilter === 'draft') {
        if (!(c.status === 'draft' || c.softDeleted)) return false;
      } else if (statusFilter === 'published') {
        if (c.status !== 'published' || c.softDeleted) return false;
      } else if (statusFilter === 'suspended') {
        if (c.status !== 'suspended' || c.softDeleted) return false;
      }

      if (!searchQuery) return true;
      var hay =
        String(c.title || '').toLowerCase() +
        ' ' +
        String(c.description || '').toLowerCase() +
        ' ' +
        String(c.instructorName || '').toLowerCase() +
        ' ' +
        String(c.instructorEmail || '').toLowerCase() +
        ' ' +
        String(c.category || '').toLowerCase();
      return hay.indexOf(searchQuery) !== -1;
    });

    if (publishedStat) publishedStat.textContent = String(window.PlatformCourses.getPublishedCount());
    if (typeof window.refreshAdminOverviewStats === 'function') {
      window.refreshAdminOverviewStats();
    }
    syncTabsUi();

    if (meta) {
      meta.textContent =
        'عرض ' +
        filtered.length +
        ' · منشور: ' +
        window.PlatformCourses.getPublishedCount() +
        ' · مسودة: ' +
        window.PlatformCourses.getDraftCount() +
        ' · اسحب ⋮⋮ لإعادة الترتيب';
    }

    if (!filtered.length) {
      var emptyMsg =
        statusFilter === 'draft'
          ? 'لا توجد مسودات حالياً.'
          : list.length
            ? 'لا نتائج مطابقة للتصفية أو البحث.'
            : 'لا توجد كورسات. أضف كورساً أو اختر من الكتالوج.';
      body.innerHTML =
        '<tr><td colspan="9" class="admin-empty-cell">' + emptyMsg + '</td></tr>';
      return;
    }

    var draftsView = statusFilter === 'draft';

    body.innerHTML = filtered
      .map(function (course) {
        var id = escapeHtml(course.id);
        var lessonsCount = Array.isArray(course.lessons) ? course.lessons.length : 0;
        var instructorLabel =
          course.isAcademy || !course.instructorEmail
            ? academyName()
            : course.instructorName || course.instructorEmail || '—';
        var sourceLabel = course.source === 'instructor' ? 'مدرب' : 'إدارة';
        var actions = '';

        if (draftsView) {
          actions =
            '<button class="admin-btn admin-btn--ghost admin-btn--sm" type="button" data-edit-course="' +
            id +
            '">تعديل</button>' +
            '<button class="admin-btn admin-btn--primary admin-btn--sm" type="button" data-restore-course="' +
            id +
            '">استعادة</button>' +
            '<button class="admin-btn admin-btn--danger admin-btn--sm" type="button" data-purge-course="' +
            id +
            '">حذف نهائي</button>';
        } else {
          var publishLabel = course.status === 'published' ? 'إلغاء النشر' : 'نشر';
          var publishCls =
            course.status === 'published'
              ? 'admin-btn admin-btn--ghost admin-btn--sm'
              : 'admin-btn admin-btn--primary admin-btn--sm';
          var suspendLabel = course.status === 'suspended' ? 'إلغاء التعليق' : 'تعليق';
          actions =
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
            (course.status === 'suspended' ? 'published' : 'suspended') +
            '">' +
            suspendLabel +
            '</button>' +
            '<button class="admin-btn admin-btn--danger admin-btn--sm" type="button" data-delete-course="' +
            id +
            '">حذف</button>';
        }

        return (
          '<tr class="admin-course-row" draggable="true" data-course-id="' +
          id +
          '">' +
          '<td class="admin-table__drag-cell">' +
          '<span class="admin-drag-handle" title="اسحب لإعادة الترتيب" aria-hidden="true">⋮⋮</span>' +
          '</td>' +
          '<td>' +
          '<div class="admin-user-cell__name">' +
          escapeHtml(course.title) +
          '</div>' +
          '<div class="admin-user-cell__email">' +
          lessonsCount +
          ' درس · ' +
          escapeHtml(categoryLabel(course.category)) +
          ' · ' +
          escapeHtml(sourceLabel) +
          '</div>' +
          '</td>' +
          '<td>' +
          escapeHtml(instructorLabel) +
          '</td>' +
          '<td><span class="admin-course-price">' +
          escapeHtml(
            window.PlatformCourses.formatPrice
              ? window.PlatformCourses.formatPrice(course)
              : course.price
                ? course.price + ' ' + (course.currency || 'ر.س')
                : 'مجاناً'
          ) +
          '</span>' +
          '<div class="admin-user-cell__email">' +
          escapeHtml(
            window.PlatformCourses.formatCourseAccessLabel
              ? window.PlatformCourses.formatCourseAccessLabel(course)
              : course.accessLevel || '—'
          ) +
          '</div></td>' +
          '<td>' +
          escapeHtml(window.PlatformCourses.formatDuration(course)) +
          '</td>' +
          '<td><div class="admin-cell-clamp">' +
          escapeHtml(course.weeklySchedule || '—') +
          '</div></td>' +
          '<td>' +
          statusBadge(course) +
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
          actions +
          '</div>' +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    bindCourseDragAndDrop();
  }

  function resolveInstructorFromForm() {
    var instructorSelect = document.getElementById('courseEditorInstructor');
    var instructorEmail = instructorSelect ? instructorSelect.value : '';
    var instructorName = academyName();
    if (instructorEmail && instructorSelect && instructorSelect.selectedIndex >= 0) {
      var opt = instructorSelect.options[instructorSelect.selectedIndex];
      instructorName = String(opt.textContent || '').split(' (')[0];
    } else {
      instructorEmail = '';
      instructorName = academyName();
    }
    return { instructorEmail: instructorEmail, instructorName: instructorName };
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
        setCoursesView(filter.value || 'active');
      });
    }

    document.querySelectorAll('[data-courses-tab]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        setCoursesView(tab.getAttribute('data-courses-tab') || 'active');
      });
    });

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

    var presetSelect = document.getElementById('coursePresetSelect');
    if (presetSelect) {
      presetSelect.addEventListener('change', function () {
        if (presetSelect.value) applyPreset(presetSelect.value);
      });
    }

    var addLessonBtn = document.getElementById('addCourseLessonBtn');
    if (addLessonBtn) {
      addLessonBtn.addEventListener('click', function () {
        collectLessonDraftsFromDom();
        lessonDrafts.push(
          cloneLessonDraft(
            {
              id: 'lesson_' + Date.now().toString(36),
              title: '',
              description: '',
              videoUrl: '',
              videoFileName: '',
              quiz: emptyQuiz(),
              order: lessonDrafts.length + 1,
              createdAt: new Date().toISOString(),
            },
            lessonDrafts.length
          )
        );
        renderLessonDrafts();
      });
    }

    var form = document.getElementById('courseEditorForm');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!window.PlatformCourses) return;
        var id = (document.getElementById('courseEditorId') || {}).value || '';
        var instructor = resolveInstructorFromForm();
        var payload = {
          title: (document.getElementById('courseEditorName') || {}).value,
          description: (document.getElementById('courseEditorDescription') || {}).value,
          durationHours: (document.getElementById('courseEditorHours') || {}).value,
          durationWeeks: (document.getElementById('courseEditorWeeks') || {}).value,
          price: (document.getElementById('courseEditorPrice') || {}).value,
          currency: (document.getElementById('courseEditorCurrency') || {}).value || 'ر.س',
          requiredPlanId: (document.getElementById('courseEditorRequiredPlan') || {}).value || '',
          accessLevel: (function () {
            var planId = (document.getElementById('courseEditorRequiredPlan') || {}).value || '';
            if (planId && window.PlatformPlans && window.PlatformPlans.findPlan) {
              var p = window.PlatformPlans.findPlan(planId);
              if (p) return p.accessLevel;
            }
            var cat = (document.getElementById('courseEditorCategory') || {}).value || 'individual';
            if (cat === 'master') return 'professional';
            if (cat === 'program') return 'standard';
            return 'free';
          })(),
          weeklySchedule: (document.getElementById('courseEditorSchedule') || {}).value,
          status: (document.getElementById('courseEditorStatus') || {}).value,
          category: (document.getElementById('courseEditorCategory') || {}).value || 'individual',
          instructorEmail: instructor.instructorEmail,
          instructorName: instructor.instructorName,
          lessons: collectLessonDraftsFromDom(),
          softDeleted: false,
          deletedAt: '',
          source: 'admin',
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

      var addQuizBtn = e.target.closest ? e.target.closest('[data-add-quiz-question]') : null;
      if (addQuizBtn) {
        e.preventDefault();
        addQuizQuestionToLesson(Number(addQuizBtn.getAttribute('data-add-quiz-question')));
        return;
      }

      var removeQuizBtn = e.target.closest ? e.target.closest('[data-remove-quiz-question]') : null;
      if (removeQuizBtn) {
        e.preventDefault();
        removeQuizQuestionFromLesson(
          Number(removeQuizBtn.getAttribute('data-remove-quiz-question')),
          removeQuizBtn.getAttribute('data-question-id')
        );
        return;
      }

      if (!window.PlatformCourses) return;

      var editBtn = e.target.closest ? e.target.closest('[data-edit-course]') : null;
      var toggleBtn = e.target.closest ? e.target.closest('[data-toggle-course-status]') : null;
      var deleteBtn = e.target.closest ? e.target.closest('[data-delete-course]') : null;
      var restoreBtn = e.target.closest ? e.target.closest('[data-restore-course]') : null;
      var purgeBtn = e.target.closest ? e.target.closest('[data-purge-course]') : null;

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
          else showToast('تم نقل الكورس إلى المسودة', 'info');
        } catch (err) {
          alert((err && err.message) || 'تعذر تحديث حالة النشر');
        }
        return;
      }

      if (restoreBtn) {
        try {
          window.PlatformCourses.restoreCourse(restoreBtn.getAttribute('data-restore-course'));
          renderCoursesTable();
          showToast('تمت استعادة الكورس', 'success');
        } catch (err) {
          alert((err && err.message) || 'تعذر استعادة الكورس');
        }
        return;
      }

      if (purgeBtn) {
        if (!window.confirm('حذف هذا الكورس نهائياً من المنصة؟ لا يمكن التراجع.')) return;
        try {
          window.PlatformCourses.deleteCourse(purgeBtn.getAttribute('data-purge-course'));
          renderCoursesTable();
          showToast('تم الحذف النهائي من المنصة', 'info');
        } catch (err) {
          alert((err && err.message) || 'تعذر الحذف النهائي');
        }
        return;
      }

      if (deleteBtn) {
        if (!window.confirm('نقل هذا الكورس إلى المسودات؟ يمكن استعادته لاحقاً.')) return;
        try {
          window.PlatformCourses.softDeleteCourse(deleteBtn.getAttribute('data-delete-course'));
          renderCoursesTable();
          showToast('تم نقل الكورس إلى المسودة', 'info');
        } catch (err) {
          alert((err && err.message) || 'تعذر نقل الكورس للمسودة');
        }
      }
    });

    document.addEventListener('change', function (e) {
      if (!e.target || !e.target.getAttribute) return;
      var fileIndex = e.target.getAttribute('data-lesson-file');
      if (fileIndex == null) return;
      var lessonIdx = Number(fileIndex);
      var file = e.target.files && e.target.files[0];
      if (!file || isNaN(lessonIdx) || !lessonDrafts[lessonIdx]) return;
      collectLessonDraftsFromDom();
      simulateVideoUpload(file.name, function () {
        lessonDrafts[lessonIdx].videoFileName = file.name;
        var nameInput = document.querySelector(
          '[data-lesson-field="videoFileName"][data-lesson-index="' + lessonIdx + '"]'
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

    fillPresetSelect();
    renderCoursesTable();
  }

  window.renderAdminCoursesTable = renderCoursesTable;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
