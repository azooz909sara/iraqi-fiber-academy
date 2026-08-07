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

  function renderEmptyState(grid) {
    grid.innerHTML =
      '<div class="public-courses-empty" role="status">' +
      '<div class="public-courses-empty__icon" aria-hidden="true">📚</div>' +
      '<h3 class="public-courses-empty__title">لا توجد كورسات منشورة حالياً</h3>' +
      '<p class="public-courses-empty__text">ستظهر الكورسات هنا تلقائياً فور نشرها من لوحة الإدارة أو المدربين.</p>' +
      '</div>';
  }

  function renderCourseCard(course, index) {
    var instructor = course.instructorName || course.instructorEmail || '';
    var lessonCount = Array.isArray(course.lessons) ? course.lessons.length : 0;

    var footer =
      '<footer class="public-course-card__footer">' +
      '<div class="public-course-card__instructor">' +
      '<span class="public-course-card__footer-label">المدرب</span>' +
      '<span class="public-course-card__footer-value">' +
      escapeHtml(instructor || 'الأكاديمية') +
      '</span>' +
      '</div>' +
      '<div class="public-course-card__episodes">' +
      '<span class="public-course-card__footer-value">' +
      (lessonCount ? lessonCount + ' حلقة' : 'قريباً') +
      '</span>' +
      '</div>' +
      '</footer>';

    return (
      '<article class="public-course-card" data-course-id="' +
      escapeHtml(course.id) +
      '" style="--card-index:' +
      index +
      '">' +
      '<div class="public-course-card__header">' +
      '<span class="public-course-card__badge">منشور</span>' +
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
      '</article>'
    );
  }

  /** Render published courses into #publicCoursesGrid (or legacy timeline id). */
  function renderPublicCourses() {
    var grid =
      document.getElementById(GRID_ID) || document.getElementById('publicCoursesTimeline');
    if (!grid) return;

    var courses = getPublishedCourses();
    courses.sort(function (a, b) {
      return String(b.updatedAt || b.createdAt || '').localeCompare(
        String(a.updatedAt || a.createdAt || '')
      );
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
      if (!e.key || e.key === COURSES_KEY || e.key === LEGACY_KEY) {
        renderPublicCourses();
      }
    });

    document.addEventListener('ifa:platform-courses-changed', renderPublicCourses);
    window.addEventListener('ifa:platform-courses-changed', renderPublicCourses);

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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPublicCourses);
  } else {
    initPublicCourses();
  }

  window.renderPublicCourses = renderPublicCourses;
  window.fetchCoursesFromLocalStorage = fetchCoursesFromLocalStorage;
})();
