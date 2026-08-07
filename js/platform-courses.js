/**
 * Unified platform courses database (localStorage).
 * Shared by Admin, Instructor panel, and public homepage.
 * Primary key: platform_courses
 * Migrates legacy: ifa_platform_courses + instructor-local courses.
 */
(function (global) {
  'use strict';

  var COURSES_KEY = 'platform_courses';
  var LEGACY_KEY = 'ifa_platform_courses';
  var SEED_VERSION_KEY = 'platform_courses_seed_version';
  var SEED_VERSION = '2';
  var INSTRUCTOR_CONTENT_KEY = 'ifa_instructor_content';

  var VALID_STATUS = { draft: true, published: true, suspended: true };

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function uid(prefix) {
    return (prefix || 'course') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      console.error('[PlatformCourses] set failed', key, err);
    }
  }

  function readJson(key, fallback) {
    try {
      var raw = storageGet(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (err) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    storageSet(key, JSON.stringify(value));
  }

  function normalizeStatus(status) {
    var s = String(status || 'draft').toLowerCase();
    return VALID_STATUS[s] ? s : 'draft';
  }

  function normalizeLessons(lessons) {
    if (!Array.isArray(lessons)) return [];
    return lessons
      .map(function (l, index) {
        return {
          id: l.id || uid('lesson'),
          title: String(l.title || '').trim(),
          description: String(l.description || '').trim(),
          videoUrl: String(l.videoUrl || '').trim(),
          videoFileName: String(l.videoFileName || '').trim(),
          videoTitle: String(l.videoTitle || l.title || '').trim(),
          templateFiles: Array.isArray(l.templateFiles) ? l.templateFiles : [],
          quiz: l.quiz && typeof l.quiz === 'object' ? l.quiz : { questions: [] },
          comments: Array.isArray(l.comments) ? l.comments : [],
          views: Number(l.views) || 0,
          completions: Number(l.completions) || 0,
          order: typeof l.order === 'number' ? l.order : index + 1,
          createdAt: l.createdAt || new Date().toISOString(),
        };
      })
      .filter(function (l) {
        return !!l.title;
      });
  }

  function normalizeCourse(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var email = normalizeEmail(raw.instructorEmail);
    return {
      id: raw.id || uid('course'),
      title: String(raw.title || '').trim(),
      description: String(raw.description || '').trim(),
      status: normalizeStatus(raw.status),
      instructorEmail: email,
      instructorName: String(raw.instructorName || '').trim(),
      durationHours: Number(raw.durationHours) || 0,
      durationWeeks: Number(raw.durationWeeks) || 0,
      weeklySchedule: String(raw.weeklySchedule || '').trim(),
      lessons: normalizeLessons(raw.lessons),
      enrolledCount: Number(raw.enrolledCount) || 0,
      views: Number(raw.views) || 0,
      source: raw.source === 'instructor' ? 'instructor' : raw.source === 'admin' ? 'admin' : 'admin',
      createdAt: raw.createdAt || new Date().toISOString(),
      updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
    };
  }

  function seedCourses() {
    return [
      normalizeCourse({
        id: 'course_fiber_basics',
        title: 'أساسيات الألياف الضوئية',
        description:
          'تعرّف على مبادئ الضوء، أنواع الألياف (SM/MM)، الموجات الطولية، ومكوّنات الكابلات البصرية الأساسية.',
        status: 'published',
        durationHours: 16,
        durationWeeks: 2,
        weeklySchedule: 'سبت وثلاثاء — ساعتان لكل جلسة',
        source: 'admin',
        lessons: [
          {
            id: 'lesson_fb_1',
            title: 'مقدمة في الألياف الضوئية',
            description: 'نظرة عامة على تقنية الألياف واستخداماتها.',
            order: 1,
          },
          {
            id: 'lesson_fb_2',
            title: 'أنواع الألياف والكابلات',
            description: 'Single-mode مقابل Multi-mode ومكوّنات الكابل.',
            order: 2,
          },
        ],
        createdAt: '2026-06-01T10:00:00.000Z',
        updatedAt: '2026-06-01T10:00:00.000Z',
      }),
      normalizeCourse({
        id: 'course_ftth_install',
        title: 'تركيب وتوصيل FTTH',
        description:
          'تعلّم تصميم شبكات GPON/EPON، تركيب Splitters، توصيل ONT، وإدارة الكابلات داخل المباني.',
        status: 'published',
        durationHours: 24,
        durationWeeks: 3,
        weeklySchedule: 'أحد وخميس — 3 ساعات',
        source: 'admin',
        lessons: [
          {
            id: 'lesson_ftth_1',
            title: 'معمارية GPON',
            description: 'OLT و ODN و ONT في شبكات FTTH.',
            order: 1,
          },
        ],
        createdAt: '2026-06-10T10:00:00.000Z',
        updatedAt: '2026-06-10T10:00:00.000Z',
      }),
    ];
  }

  function migrateInstructorLocalsIntoCatalog(list) {
    var byId = {};
    list.forEach(function (c) {
      if (c && c.id) byId[c.id] = c;
    });

    var buckets = readJson(INSTRUCTOR_CONTENT_KEY, {});
    if (!buckets || typeof buckets !== 'object') return list;

    Object.keys(buckets).forEach(function (email) {
      var courses = buckets[email] && buckets[email].courses;
      if (!Array.isArray(courses)) return;
      courses.forEach(function (c) {
        if (!c || !c.id) return;
        if (byId[c.id]) {
          /* Merge richer lesson overlays into catalog entry. */
          var existing = byId[c.id];
          var mergedLessons = normalizeLessons(
            (c.lessons && c.lessons.length ? c.lessons : existing.lessons) || []
          );
          byId[c.id] = normalizeCourse(
            Object.assign({}, existing, {
              lessons: mergedLessons,
              enrolledCount: c.enrolledCount != null ? c.enrolledCount : existing.enrolledCount,
              views: c.views != null ? c.views : existing.views,
              instructorEmail: existing.instructorEmail || email,
              instructorName: existing.instructorName || '',
            })
          );
          return;
        }
        if (c.platformManaged) return;
        byId[c.id] = normalizeCourse(
          Object.assign({}, c, {
            instructorEmail: normalizeEmail(c.instructorEmail || email),
            status: c.status || 'draft',
            source: 'instructor',
          })
        );
      });
    });

    return Object.keys(byId).map(function (id) {
      return byId[id];
    });
  }

  function ensureSeeded() {
    var version = storageGet(SEED_VERSION_KEY);
    var current = readJson(COURSES_KEY, null);
    var legacy = readJson(LEGACY_KEY, null);

    if (version !== SEED_VERSION || !Array.isArray(current)) {
      var base = [];
      if (Array.isArray(current) && current.length) base = current;
      else if (Array.isArray(legacy) && legacy.length) base = legacy;
      else base = seedCourses();

      base = base.map(normalizeCourse).filter(Boolean);
      base = migrateInstructorLocalsIntoCatalog(base);
      writeJson(COURSES_KEY, base);
      storageSet(SEED_VERSION_KEY, SEED_VERSION);
      /* Keep legacy key mirrored for older listeners. */
      writeJson(LEGACY_KEY, base);
      return;
    }

    if (!Array.isArray(current)) writeJson(COURSES_KEY, []);
  }

  function emitChanged(list, detail) {
    writeJson(COURSES_KEY, list);
    writeJson(LEGACY_KEY, list);
    var payload = Object.assign({ count: list.length, key: COURSES_KEY }, detail || {});
    try {
      global.dispatchEvent(new CustomEvent('ifa:platform-courses-changed', { detail: payload }));
    } catch (err) {
      /* ignore */
    }
  }

  function getCourses() {
    ensureSeeded();
    var list = readJson(COURSES_KEY, []);
    return (Array.isArray(list) ? list : []).map(normalizeCourse).filter(Boolean);
  }

  function saveCourses(list, detail) {
    var normalized = (list || []).map(normalizeCourse).filter(Boolean);
    emitChanged(normalized, detail);
    return normalized;
  }

  function findCourse(id) {
    var list = getCourses();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function getPublished() {
    return getCourses().filter(function (c) {
      return c.status === 'published';
    });
  }

  function getByInstructor(email) {
    var key = normalizeEmail(email);
    if (!key) return [];
    return getCourses().filter(function (c) {
      return normalizeEmail(c.instructorEmail) === key;
    });
  }

  function formatDuration(course) {
    if (!course) return '—';
    var parts = [];
    if (course.durationWeeks) parts.push(course.durationWeeks + ' أسبوع');
    if (course.durationHours) parts.push(course.durationHours + ' ساعة');
    if (!parts.length && course.weeklySchedule) return course.weeklySchedule;
    return parts.length ? parts.join(' · ') : '—';
  }

  function resolveInstructorName(email, fallback) {
    var key = normalizeEmail(email);
    if (fallback) return String(fallback).trim();
    if (!key) return '';
    if (global.InstructorApps && typeof global.InstructorApps.findActiveInstructor === 'function') {
      var inst = global.InstructorApps.findActiveInstructor(key);
      if (inst && inst.fullName) return inst.fullName;
    }
    return key;
  }

  function addCourse(payload) {
    var list = getCourses();
    var instructorEmail = normalizeEmail(payload && payload.instructorEmail);
    var course = normalizeCourse({
      id: uid('course'),
      title: payload && payload.title,
      description: payload && payload.description,
      status: (payload && payload.status) || 'draft',
      instructorEmail: instructorEmail,
      instructorName: resolveInstructorName(instructorEmail, payload && payload.instructorName),
      durationHours: payload && payload.durationHours,
      durationWeeks: payload && payload.durationWeeks,
      weeklySchedule: payload && payload.weeklySchedule,
      lessons: payload && payload.lessons,
      enrolledCount: payload && payload.enrolledCount,
      views: payload && payload.views,
      source: (payload && payload.source) || 'admin',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    if (!course.title) throw new Error('عنوان الكورس مطلوب');
    list.unshift(course);
    saveCourses(list, { type: 'add', id: course.id });
    return course;
  }

  function updateCourse(id, patch) {
    var list = getCourses();
    var found = null;
    list = list.map(function (c) {
      if (c.id !== id) return c;
      var nextEmail =
        patch && patch.instructorEmail != null
          ? normalizeEmail(patch.instructorEmail)
          : c.instructorEmail;
      found = normalizeCourse(
        Object.assign({}, c, patch || {}, {
          id: c.id,
          instructorEmail: nextEmail,
          instructorName: resolveInstructorName(
            nextEmail,
            patch && patch.instructorName != null ? patch.instructorName : c.instructorName
          ),
          status: patch && patch.status != null ? patch.status : c.status,
          lessons: patch && patch.lessons != null ? patch.lessons : c.lessons,
          updatedAt: new Date().toISOString(),
          createdAt: c.createdAt,
        })
      );
      if (!found.title) throw new Error('عنوان الكورس مطلوب');
      return found;
    });
    if (!found) throw new Error('الكورس غير موجود');
    saveCourses(list, { type: 'update', id: id });
    return found;
  }

  function setCourseStatus(id, status) {
    return updateCourse(id, { status: normalizeStatus(status) });
  }

  function deleteCourse(id) {
    var list = getCourses();
    var removed = null;
    var next = [];
    list.forEach(function (c) {
      if (c.id === id) removed = c;
      else next.push(c);
    });
    if (!removed) throw new Error('الكورس غير موجود');
    saveCourses(next, { type: 'delete', id: id });
    return removed;
  }

  function getPublishedCount() {
    return getPublished().length;
  }

  /** Instructor-facing shape (compatible with existing dashboard UI). */
  function toInstructorShape(course) {
    var c = normalizeCourse(course);
    return Object.assign({}, c, {
      platformManaged: c.source === 'admin',
      instructorEmail: c.instructorEmail,
    });
  }

  ensureSeeded();

  global.PlatformCourses = {
    COURSES_KEY: COURSES_KEY,
    getCourses: getCourses,
    getPublished: getPublished,
    getByInstructor: getByInstructor,
    findCourse: findCourse,
    addCourse: addCourse,
    updateCourse: updateCourse,
    setCourseStatus: setCourseStatus,
    deleteCourse: deleteCourse,
    formatDuration: formatDuration,
    getPublishedCount: getPublishedCount,
    toInstructorShape: toInstructorShape,
    normalizeCourse: normalizeCourse,
  };
})(typeof window !== 'undefined' ? window : this);
