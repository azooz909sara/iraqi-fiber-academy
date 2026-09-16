/**
 * Public homepage: load published courses from shared localStorage
 * (`platform_courses`) and render a live-updating cards grid.
 */
(function () {
  'use strict';

  var COURSES_KEY = 'platform_courses';
  var LEGACY_KEY = 'ifa_platform_courses';
  var GRID_ID = 'publicCoursesGrid';
  var lastSignature = '';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function readRawList(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  /**
   * Fetch all courses from the shared localStorage database.
   * Prefers PlatformCourses API when available; falls back to direct key read.
   */
  function fetchCoursesFromLocalStorage() {
    if (window.PlatformCourses && typeof window.PlatformCourses.getCourses === 'function') {
      return window.PlatformCourses.getCourses();
    }
    var list = readRawList(COURSES_KEY);
    if (!list) list = readRawList(LEGACY_KEY);
    return list || [];
  }

  function isCoursesDataLoading() {
    if (window.PlatformCourses && typeof window.PlatformCourses.isFirestoreBootstrapping === 'function') {
      return window.PlatformCourses.isFirestoreBootstrapping();
    }
    var FS = window.PlatformCoursesFirestore;
    if (!FS) return false;
    if (typeof FS.isReady === 'function' && !FS.isReady()) return true;
    if (typeof FS.isSeeding === 'function' && FS.isSeeding()) return true;
    return false;
  }

  function getPublishedCourses() {
    if (window.PlatformCourses && typeof window.PlatformCourses.getPublished === 'function') {
      return window.PlatformCourses.getPublished().slice();
    }
    return fetchCoursesFromLocalStorage().filter(function (c) {
      return c && String(c.status || '').toLowerCase() === 'published';
    });
  }

  function formatDurationLabel(course) {
    if (window.PlatformCourses && typeof window.PlatformCourses.formatDuration === 'function') {
      var label = window.PlatformCourses.formatDuration(course);
      if (label && label !== '—') return label;
    }
    if (course.durationWeeks) return course.durationWeeks + ' أسبوع';
    if (course.durationHours) return course.durationHours + ' ساعة';
    return 'كورس تدريبي';
  }

  function courseSignature(courses) {
    return courses
      .map(function (c) {
        return [
          c.id,
          c.title,
          c.status,
          c.updatedAt || '',
          c.instructorName || '',
          c.durationHours || 0,
          c.durationWeeks || 0,
          c.price || 0,
          c.requiredPlanId || '',
          c.accessLevel || '',
          c.sortOrder != null ? c.sortOrder : '',
        ].join(':');
      })
      .join('|');
  }

  function revealCards(grid) {
    var cards = grid.querySelectorAll('.public-course-card');
    cards.forEach(function (card, index) {
      window.setTimeout(function () {
        card.classList.add('is-visible');
      }, Math.min(index * 60, 360));
    });
  }

  function renderLoadingState(grid) {
    grid.innerHTML =
      '<div class="public-courses-empty" role="status">' +
      '<div class="public-courses-empty__icon" aria-hidden="true">⏳</div>' +
      '<h3 class="public-courses-empty__title">جاري تحميل الكورسات…</h3>' +
      '<p class="public-courses-empty__text">يتم جلب الكورسات من قاعدة البيانات.</p>' +
      '</div>';
  }

  function renderEmptyState(grid) {
    grid.innerHTML =
      '<div class="public-courses-empty" role="status">' +
      '<div class="public-courses-empty__icon" aria-hidden="true">📚</div>' +
      '<h3 class="public-courses-empty__title">لا توجد كورسات منشورة حالياً</h3>' +
      '<p class="public-courses-empty__text">ستظهر الكورسات هنا تلقائياً فور نشرها من لوحة الإدارة أو المدربين.</p>' +
      '</div>';
  }

  function formatCoursePrice(course) {
    if (window.PlatformCourses && typeof window.PlatformCourses.formatPrice === 'function') {
      return window.PlatformCourses.formatPrice(course);
    }
    var amount = Number(course && course.price);
    if (!isFinite(amount) || amount <= 0) return 'مجاناً';
    var label =
      course && (course.currency === 'USD' || course.currency === '$') ? '$' : 'د.ع';
    return amount + ' ' + label;
  }

  function accessPlanLabel(course) {
    if (window.PlatformCourses && typeof window.PlatformCourses.formatCourseAccessLabel === 'function') {
      return window.PlatformCourses.formatCourseAccessLabel(course);
    }
    return '';
  }

  function renderCourseCard(course, index) {
    var instructor = course.instructorName || course.instructorEmail || '';
    var lessonCount = Array.isArray(course.lessons) ? course.lessons.length : 0;
    var priceLabel = formatCoursePrice(course);
    var planLabel = accessPlanLabel(course);
    var planChip = planLabel
      ? '<span class="public-course-card__plan" title="باقة الوصول">' +
        escapeHtml(planLabel) +
        '</span>'
      : '';

    var footer =
      '<footer class="public-course-card__footer">' +
      '<div class="public-course-card__instructor">' +
      '<span class="public-course-card__footer-label">المدرب</span>' +
      '<span class="public-course-card__footer-value">' +
      escapeHtml(instructor || 'الأكاديمية') +
      '</span>' +
      '</div>' +
      '<div class="public-course-card__meta">' +
      '<span class="public-course-card__price">' +
      escapeHtml(priceLabel) +
      '</span>' +
      '<span class="public-course-card__episodes">' +
      (lessonCount ? lessonCount + ' حلقة' : 'قريباً') +
      '</span>' +
      '</div>' +
      '</footer>';

    return (
      '<a class="public-course-card-link" href="course-details.html?id=' +
      encodeURIComponent(course.id) +
      '">' +
      '<article class="public-course-card" data-course-id="' +
      escapeHtml(course.id) +
      '" data-access-level="' +
      escapeHtml(course.accessLevel || '') +
      '" data-required-plan="' +
      escapeHtml(course.requiredPlanId || '') +
      '" style="--card-index:' +
      index +
      '">' +
      '<div class="public-course-card__header">' +
      '<span class="public-course-card__badge">منشور</span>' +
      planChip +
      '<span class="public-course-card__duration">⏱ ' +
      escapeHtml(formatDurationLabel(course)) +
      '</span>' +
      '</div>' +
      '<div class="public-course-card__body">' +
      '<h3 class="public-course-card__title">' +
      escapeHtml(course.title || 'كورس بدون عنوان') +
      '</h3>' +
      '<p class="public-course-card__desc">' +
      escapeHtml(course.description || 'لا يوجد وصف لهذا الكورس بعد.') +
      '</p>' +
      '</div>' +
      footer +
      '</article>' +
      '</a>'
    );
  }

  /** Render published courses into #publicCoursesGrid (or legacy timeline id). */
  function renderPublicCourses() {
    var grid =
      document.getElementById(GRID_ID) || document.getElementById('publicCoursesTimeline');
    if (!grid) return;

    if (isCoursesDataLoading()) {
      lastSignature = '__loading__';
      renderLoadingState(grid);
      return;
    }

    var courses = getPublishedCourses();
    courses.sort(function (a, b) {
      if (window.PlatformCourses && typeof window.PlatformCourses.sortByDisplayOrder === 'function') {
        return window.PlatformCourses.sortByDisplayOrder(a, b);
      }
      var ao = a.sortOrder != null ? Number(a.sortOrder) : Number.MAX_SAFE_INTEGER;
      var bo = b.sortOrder != null ? Number(b.sortOrder) : Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });

    var signature = courseSignature(courses);
    if (signature === lastSignature && grid.childElementCount) return;
    lastSignature = signature;

    if (!courses.length) {
      renderEmptyState(grid);
      return;
    }

    grid.innerHTML = courses.map(renderCourseCard).join('');
    revealCards(grid);
  }

  function bindLiveSync() {
    window.addEventListener('storage', function (e) {
      if (
        !e.key ||
        e.key === COURSES_KEY ||
        e.key === LEGACY_KEY ||
        e.key === 'platform_plans'
      ) {
        renderPublicCourses();
      }
    });

    document.addEventListener('ifa:platform-courses-changed', renderPublicCourses);
    window.addEventListener('ifa:platform-courses-changed', renderPublicCourses);
    document.addEventListener('ifa:courses-firestore-changed', renderPublicCourses);
    window.addEventListener('ifa:courses-firestore-changed', renderPublicCourses);
    document.addEventListener('ifa:platform-plans-changed', renderPublicCourses);
    window.addEventListener('ifa:platform-plans-changed', renderPublicCourses);
    document.addEventListener('ifa:pricing-firestore-changed', renderPublicCourses);
    window.addEventListener('ifa:pricing-firestore-changed', renderPublicCourses);

    (function waitForCoursesFirestoreSubscribe(attempts) {
      if (window.PlatformCoursesFirestore && typeof window.PlatformCoursesFirestore.subscribe === 'function') {
        window.PlatformCoursesFirestore.subscribe(function () {
          renderPublicCourses();
        });
        return;
      }
      if (attempts > 40) return;
      window.setTimeout(function () {
        waitForCoursesFirestoreSubscribe(attempts + 1);
      }, 50);
    })(0);

    /* Lightweight same-origin poll so publish from another tab/window
       still updates even if a browser skips the storage event. */
    window.setInterval(function () {
      var next = courseSignature(getPublishedCourses());
      if (next !== lastSignature) renderPublicCourses();
    }, 1500);
  }

  function initPublicCourses() {
    renderPublicCourses();
    bindLiveSync();
    renderCourseDetailsPage();
  }

  function readAuthUser() {
    try {
      var raw = localStorage.getItem('ifa_auth_user');
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && parsed.email ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  function isFreeTierCourse(course) {
    if (!course) return false;
    var price = Number(course.price);
    if (isFinite(price) && price <= 0) return true;
    var level = String(course.accessLevel || '').toLowerCase();
    return level === 'free';
  }

  function userHasActiveTrial(user) {
    if (!user) return false;
    if (window.IFAAuth && typeof window.IFAAuth.hasActiveTrial === 'function' && window.IFAAuth.hasActiveTrial(user)) {
      return true;
    }
    return Number(user.trialExpiresAt) > Date.now();
  }

  function viewerHasCourseAccess(course) {
    if (window.PlatformSimulators && typeof window.PlatformSimulators.isAdminPreviewContext === 'function') {
      /* ignore */
    }
    try {
      if (new URLSearchParams(window.location.search).get('mode') === 'admin-preview') return true;
    } catch (err) {
      /* ignore */
    }
    var user = readAuthUser();
    if (!user) return false;
    if (user.isAdmin || user.isInstructor || String(user.role || '').toLowerCase() === 'admin') return true;
    if (userHasActiveTrial(user) && isFreeTierCourse(course)) return true;

    if (!course) return false;

    var enrolled = Array.isArray(user.enrolledCourseIds)
      ? user.enrolledCourseIds.map(function (id) {
          return String(id);
        })
      : [];
    if (enrolled.indexOf(String(course.id)) !== -1) return true;

    var requiredPlanId = String(course.requiredPlanId || '').trim();
    if (requiredPlanId && String(user.planId || '') === requiredPlanId) return true;

    return false;
  }

  function youtubeEmbed(url) {
    var m = String(url || '').match(
      /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/
    );
    return m ? 'https://www.youtube.com/embed/' + m[1] : '';
  }

  function lessonCanPlay(lesson, course) {
    if (lesson && lesson.isFreePreview) return true;
    return viewerHasCourseAccess(course);
  }

  function renderLessonPlayer(lesson) {
    var yt = youtubeEmbed(lesson.videoUrl);
    if (yt) {
      return (
        '<div class="course-details__player">' +
        '<iframe src="' +
        escapeHtml(yt) +
        '" title="' +
        escapeHtml(lesson.title || 'فيديو') +
        '" allowfullscreen></iframe>' +
        '</div>'
      );
    }
    if (lesson.videoUrl) {
      return (
        '<div class="course-details__player">' +
        '<video controls src="' +
        escapeHtml(lesson.videoUrl) +
        '"></video>' +
        '</div>'
      );
    }
    return '<p class="course-details__no-video">لا يوجد فيديو مرفوع لهذه الحلقة بعد.</p>';
  }

  function renderCourseDetailsPage() {
    var root = document.getElementById('courseDetailsRoot');
    if (!root) return;
    var courseId = '';
    try {
      courseId = String(new URLSearchParams(window.location.search).get('id') || '');
    } catch (err) {
      courseId = '';
    }
    var courses = fetchCoursesFromLocalStorage();
    var course = null;
    for (var i = 0; i < courses.length; i++) {
      if (String(courses[i].id) === courseId) {
        course = courses[i];
        break;
      }
    }
    if (!course) {
      root.innerHTML =
        '<p class="course-details__empty">الكورس غير موجود. <a href="index.html#courses">العودة للكورسات</a></p>';
      return;
    }

    var lessons = Array.isArray(course.lessons) ? course.lessons.slice() : [];
    lessons.sort(function (a, b) {
      return (Number(a.order) || 0) - (Number(b.order) || 0);
    });
    var subscribed = viewerHasCourseAccess(course);
    var activeId = '';
    try {
      activeId = String(new URLSearchParams(window.location.search).get('lesson') || '');
    } catch (err2) {
      activeId = '';
    }
    var active = null;
    for (var j = 0; j < lessons.length; j++) {
      if (String(lessons[j].id) === activeId) {
        active = lessons[j];
        break;
      }
    }
    if (!active) {
      for (var k = 0; k < lessons.length; k++) {
        if (lessonCanPlay(lessons[k], course)) {
          active = lessons[k];
          break;
        }
      }
    }
    if (!active && lessons.length) active = lessons[0];

    var listHtml = lessons.length
      ? lessons
          .map(function (lesson) {
            var free = !!lesson.isFreePreview;
            var canPlay = lessonCanPlay(lesson, course);
            var isActive = active && String(active.id) === String(lesson.id);
            var href =
              'course-details.html?id=' +
              encodeURIComponent(course.id) +
              '&lesson=' +
              encodeURIComponent(lesson.id);
            var badge = free
              ? '<span class="course-lesson__badge course-lesson__badge--free">معاينة مجانية</span>'
              : canPlay
                ? ''
                : '<span class="course-lesson__badge course-lesson__badge--lock">🔒 يتطلب الاشتراك بالباقة</span>';
            if (canPlay) {
              return (
                '<a class="course-lesson' +
                (isActive ? ' is-active' : '') +
                '" href="' +
                href +
                '">' +
                '<span class="course-lesson__title">' +
                escapeHtml(lesson.title || 'حلقة') +
                '</span>' +
                badge +
                '</a>'
              );
            }
            return (
              '<div class="course-lesson course-lesson--locked">' +
              '<span class="course-lesson__title">' +
              escapeHtml(lesson.title || 'حلقة') +
              '</span>' +
              badge +
              '<a class="course-lesson__plans" href="index.html#plans">عرض الباقات</a>' +
              '</div>'
            );
          })
          .join('')
      : '<p class="course-details__empty">لا توجد حلقات بعد.</p>';

    var playerHtml = '';
    if (active && lessonCanPlay(active, course)) {
      playerHtml =
        '<h2 class="course-details__lesson-title">' +
        escapeHtml(active.title || '') +
        (active.isFreePreview ? ' <span class="course-lesson__badge course-lesson__badge--free">معاينة مجانية</span>' : '') +
        '</h2>' +
        (active.description ? '<p class="course-details__lesson-desc">' + escapeHtml(active.description) + '</p>' : '') +
        renderLessonPlayer(active);
    } else if (active) {
      playerHtml =
        '<div class="course-details__locked-panel">' +
        '<p>🔒 يتطلب الاشتراك بالباقة</p>' +
        '<a class="btn btn--primary" href="index.html#plans">عرض الباقات</a>' +
        '</div>';
    }

    root.innerHTML =
      '<header class="course-details__header">' +
      '<p class="course-details__back"><a href="index.html#courses">← العودة للكورسات</a></p>' +
      '<h1 class="course-details__title">' +
      escapeHtml(course.title || '') +
      '</h1>' +
      '<p class="course-details__desc">' +
      escapeHtml(course.description || '') +
      '</p>' +
      (subscribed ? '' : '<p class="course-details__hint">يمكنك مشاهدة الحلقات المحددة كمعاينة مجانية. بقية المحتوى يتطلب الاشتراك.</p>') +
      '</header>' +
      '<div class="course-details__layout">' +
      '<aside class="course-details__curriculum">' +
      '<h2>المنهج</h2>' +
      listHtml +
      '</aside>' +
      '<section class="course-details__stage">' +
      playerHtml +
      '</section>' +
      '</div>';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPublicCourses);
  } else {
    initPublicCourses();
  }

  window.renderPublicCourses = renderPublicCourses;
  window.fetchCoursesFromLocalStorage = fetchCoursesFromLocalStorage;
  window.renderCourseDetailsPage = renderCourseDetailsPage;
})();
