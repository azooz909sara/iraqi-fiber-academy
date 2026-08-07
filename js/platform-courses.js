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
  var SEED_VERSION = '3';
  var INSTRUCTOR_CONTENT_KEY = 'ifa_instructor_content';

  var ACADEMY_EMAIL = '';
  var ACADEMY_NAME = 'أكاديمية الفايبر العراقية';

  var VALID_STATUS = { draft: true, published: true, suspended: true };
  var VALID_CATEGORY = { individual: true, program: true, master: true };

  var INDIVIDUAL_MODULE_TITLES = [
    'أساسيات الألياف الضوئية',
    'أساسيات FTTH',
    'المعدات والأدوات الميدانية',
    'توزيع الكيبلات والبنية التحتية',
    'Fusion Splicing & Closures',
    'Power Meter & VFL',
    'OTDR Professional',
    'QGIS L1',
    'QGIS L2',
    'QGIS L3',
    'QC & Inspection Engineering',
    'Troubleshooting & Maintenance',
  ];

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

  function normalizeCategory(category) {
    var c = String(category || '').toLowerCase();
    return VALID_CATEGORY[c] ? c : 'individual';
  }

  function isAcademyAssignment(email, name) {
    var key = normalizeEmail(email);
    if (!key) return true;
    var n = String(name || '').trim();
    return n === ACADEMY_NAME || key === 'academy' || key === '__academy__';
  }

  function lessonsFromTitles(titles) {
    return (titles || []).map(function (title, index) {
      return {
        id: 'lesson_mod_' + (index + 1),
        title: title,
        description: '',
        videoUrl: '',
        videoFileName: '',
        order: index + 1,
        createdAt: new Date().toISOString(),
      };
    });
  }

  function buildPresets() {
    var individuals = [
      {
        id: 'preset_fiber_basics',
        title: 'أساسيات الألياف الضوئية',
        description:
          'مبادئ الضوء، أنواع الألياف (SM/MM)، الموجات الطولية، ومكوّنات الكابلات البصرية الأساسية.',
        durationHours: 16,
        durationWeeks: 2,
      },
      {
        id: 'preset_ftth_basics',
        title: 'أساسيات FTTH',
        description: 'مقدمة في شبكات FTTH ومعمارية GPON/EPON ومسار الإشارة من OLT إلى ONT.',
        durationHours: 20,
        durationWeeks: 2,
      },
      {
        id: 'preset_field_tools',
        title: 'المعدات والأدوات الميدانية',
        description: 'التعرّف على الأدوات الميدانية واستخدامها الآمن في أعمال الألياف الضوئية.',
        durationHours: 16,
        durationWeeks: 2,
      },
      {
        id: 'preset_cable_infra',
        title: 'توزيع الكيبلات والبنية التحتية',
        description: 'تخطيط مسارات الكيبلات، المجاري، والصناديق والبنية التحتية لشبكات FTTH.',
        durationHours: 24,
        durationWeeks: 3,
      },
      {
        id: 'preset_fusion_splicing',
        title: 'Fusion Splicing & Closures',
        description: 'لحام الألياف الضوئية وإدارة الـ Closures ومعايير جودة اللحام.',
        durationHours: 24,
        durationWeeks: 3,
      },
      {
        id: 'preset_power_vfl',
        title: 'Power Meter & VFL',
        description: 'قياس القدرة البصرية وتتبع الأعطال باستخدام Power Meter و VFL.',
        durationHours: 16,
        durationWeeks: 2,
      },
      {
        id: 'preset_otdr_pro',
        title: 'OTDR Professional',
        description: 'قراءة وتحليل منحنيات OTDR وتحديد مواقع الأعطال والخسائر باحتراف.',
        durationHours: 28,
        durationWeeks: 3,
      },
      {
        id: 'preset_qgis_l1',
        title: 'QGIS L1',
        description: 'أساسيات نظم المعلومات الجغرافية وتطبيقات QGIS لمشاريع FTTH.',
        durationHours: 20,
        durationWeeks: 2,
      },
      {
        id: 'preset_qgis_l2',
        title: 'QGIS L2',
        description: 'تحليل الطبقات، الرقمنة، وإعداد خرائط شبكات FTTH المتقدمة في QGIS.',
        durationHours: 24,
        durationWeeks: 3,
      },
      {
        id: 'preset_qgis_l3',
        title: 'QGIS L3',
        description: 'نمذجة شبكات FTTH المتقدمة، التقارير الهندسية، وسير عمل GIS الاحترافي.',
        durationHours: 28,
        durationWeeks: 3,
      },
      {
        id: 'preset_qc_inspection',
        title: 'QC & Inspection Engineering',
        description: 'هندسة الجودة والفحص الميداني ومعايير القبول في مشاريع الألياف.',
        durationHours: 20,
        durationWeeks: 2,
      },
      {
        id: 'preset_troubleshooting',
        title: 'Troubleshooting & Maintenance',
        description: 'تشخيص أعطال الشبكات البصرية وخطط الصيانة والتشغيل المستمر.',
        durationHours: 24,
        durationWeeks: 3,
      },
    ].map(function (p) {
      return Object.assign({}, p, {
        category: 'individual',
        categoryLabel: 'الكورسات المنفردة',
        weeklySchedule: 'جلستان أسبوعياً',
        lessons: lessonsFromTitles([p.title]),
        status: 'draft',
        source: 'admin',
        instructorEmail: ACADEMY_EMAIL,
        instructorName: ACADEMY_NAME,
      });
    });

    var programs = [
      {
        id: 'preset_prog_fiber_optics',
        title: 'Fiber Optics Professional Program (فني أو مهندس FTTH ميداني)',
        description:
          'برنامج احترافي ميداني يغطي أساسيات الألياف وFTTH والمعدات والتوزيع واللحام.',
        moduleIndexes: [0, 1, 2, 3, 4],
        durationHours: 80,
        durationWeeks: 8,
      },
      {
        id: 'preset_prog_fiber_testing',
        title: 'Fiber Testing Professional Program (مهندس فحص واختبارات ألياف ضوئية)',
        description: 'برنامج متخصص في Power Meter وVFL وOTDR وفحص الجودة الميداني.',
        moduleIndexes: [5, 6, 10],
        durationHours: 64,
        durationWeeks: 6,
      },
      {
        id: 'preset_prog_ftth_gis',
        title: 'FTTH GIS Professional Program (مصمم شبكات FTTH باستخدام GIS)',
        description: 'برنامج تصميم شبكات FTTH باستخدام QGIS من المستوى الأول حتى الثالث.',
        moduleIndexes: [7, 8, 9],
        durationHours: 72,
        durationWeeks: 7,
      },
      {
        id: 'preset_prog_ftth_ops',
        title: 'FTTH Operations Professional Program (مهندس جودة وصيانة وتشغيل)',
        description: 'برنامج تشغيل وصيانة يشمل QC والفحص والصيانة واستكشاف الأعطال.',
        moduleIndexes: [10, 11, 5, 6],
        durationHours: 68,
        durationWeeks: 7,
      },
    ].map(function (p) {
      var titles = p.moduleIndexes.map(function (i) {
        return INDIVIDUAL_MODULE_TITLES[i];
      });
      return {
        id: p.id,
        title: p.title,
        description: p.description,
        category: 'program',
        categoryLabel: 'البرامج الاحترافية المجمعة',
        durationHours: p.durationHours,
        durationWeeks: p.durationWeeks,
        weeklySchedule: 'ثلاث جلسات أسبوعياً',
        lessons: lessonsFromTitles(titles),
        status: 'draft',
        source: 'admin',
        instructorEmail: ACADEMY_EMAIL,
        instructorName: ACADEMY_NAME,
      };
    });

    var master = {
      id: 'preset_master_ftth',
      title: 'FTTH Master Professional Program (FTTH Master Engineer)',
      description:
        'الكورس الشامل لمهندس FTTH Master — يشمل جميع الوحدات الـ 12 من الأساسيات حتى التشغيل والصيانة.',
      category: 'master',
      categoryLabel: 'الكورس الشامل',
      durationHours: 160,
      durationWeeks: 16,
      weeklySchedule: 'مسار شامل — وحدات أسبوعية متتابعة',
      lessons: lessonsFromTitles(INDIVIDUAL_MODULE_TITLES),
      status: 'draft',
      source: 'admin',
      instructorEmail: ACADEMY_EMAIL,
      instructorName: ACADEMY_NAME,
    };

    return individuals.concat(programs, [master]);
  }

  var COURSE_PRESETS = buildPresets();

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
    var name = String(raw.instructorName || '').trim();
    var academy = isAcademyAssignment(email, name);
    if (academy) {
      email = ACADEMY_EMAIL;
      name = ACADEMY_NAME;
    }
    return {
      id: raw.id || uid('course'),
      title: String(raw.title || '').trim(),
      description: String(raw.description || '').trim(),
      status: normalizeStatus(raw.status),
      category: normalizeCategory(raw.category),
      instructorEmail: email,
      instructorName: name,
      isAcademy: academy,
      durationHours: Number(raw.durationHours) || 0,
      durationWeeks: Number(raw.durationWeeks) || 0,
      weeklySchedule: String(raw.weeklySchedule || '').trim(),
      lessons: normalizeLessons(raw.lessons),
      enrolledCount: Number(raw.enrolledCount) || 0,
      views: Number(raw.views) || 0,
      source: raw.source === 'instructor' ? 'instructor' : 'admin',
      softDeleted: !!raw.softDeleted,
      previousStatus: raw.previousStatus ? normalizeStatus(raw.previousStatus) : '',
      deletedAt: raw.deletedAt || '',
      createdAt: raw.createdAt || new Date().toISOString(),
      updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
    };
  }

  function seedCourses() {
    return COURSE_PRESETS.map(function (preset) {
      return normalizeCourse(
        Object.assign({}, preset, {
          status: preset.id === 'preset_fiber_basics' || preset.id === 'preset_ftth_basics'
            ? 'published'
            : 'draft',
          createdAt: '2026-06-01T10:00:00.000Z',
          updatedAt: '2026-06-01T10:00:00.000Z',
        })
      );
    });
  }

  function mergeMissingPresets(list) {
    var byId = {};
    var byTitle = {};
    (list || []).forEach(function (c) {
      if (!c) return;
      if (c.id) byId[c.id] = c;
      if (c.title) byTitle[String(c.title).trim()] = c;
    });

    COURSE_PRESETS.forEach(function (preset) {
      if (byId[preset.id] || byTitle[preset.title]) return;
      byId[preset.id] = normalizeCourse(
        Object.assign({}, preset, {
          status: 'draft',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );
    });

    return Object.keys(byId).map(function (id) {
      return byId[id];
    });
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
      base = mergeMissingPresets(base);
      writeJson(COURSES_KEY, base);
      storageSet(SEED_VERSION_KEY, SEED_VERSION);
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
      return c.status === 'published' && !c.softDeleted;
    });
  }

  function getDrafts() {
    return getCourses().filter(function (c) {
      return c.status === 'draft' || c.softDeleted;
    });
  }

  function getActiveCourses() {
    return getCourses().filter(function (c) {
      return !c.softDeleted && c.status !== 'draft';
    });
  }

  function getByInstructor(email) {
    var key = normalizeEmail(email);
    if (!key) return [];
    return getCourses().filter(function (c) {
      return !c.softDeleted && normalizeEmail(c.instructorEmail) === key;
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
    if (isAcademyAssignment(email, fallback)) return ACADEMY_NAME;
    var key = normalizeEmail(email);
    if (fallback) return String(fallback).trim();
    if (!key) return ACADEMY_NAME;
    if (global.InstructorApps && typeof global.InstructorApps.findActiveInstructor === 'function') {
      var inst = global.InstructorApps.findActiveInstructor(key);
      if (inst && inst.fullName) return inst.fullName;
    }
    return key;
  }

  function findPreset(presetId) {
    for (var i = 0; i < COURSE_PRESETS.length; i++) {
      if (COURSE_PRESETS[i].id === presetId) return COURSE_PRESETS[i];
    }
    return null;
  }

  function getPresetsGrouped() {
    return {
      individual: COURSE_PRESETS.filter(function (p) {
        return p.category === 'individual';
      }),
      program: COURSE_PRESETS.filter(function (p) {
        return p.category === 'program';
      }),
      master: COURSE_PRESETS.filter(function (p) {
        return p.category === 'master';
      }),
      all: COURSE_PRESETS.slice(),
    };
  }

  function addCourse(payload) {
    var list = getCourses();
    var instructorEmail = normalizeEmail(payload && payload.instructorEmail);
    var instructorName = resolveInstructorName(instructorEmail, payload && payload.instructorName);
    var course = normalizeCourse({
      id: uid('course'),
      title: payload && payload.title,
      description: payload && payload.description,
      status: (payload && payload.status) || 'draft',
      category: payload && payload.category,
      instructorEmail: instructorEmail,
      instructorName: instructorName,
      durationHours: payload && payload.durationHours,
      durationWeeks: payload && payload.durationWeeks,
      weeklySchedule: payload && payload.weeklySchedule,
      lessons: payload && payload.lessons,
      enrolledCount: payload && payload.enrolledCount,
      views: payload && payload.views,
      source: (payload && payload.source) || 'admin',
      softDeleted: false,
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
          softDeleted: patch && patch.softDeleted != null ? !!patch.softDeleted : c.softDeleted,
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
    var next = normalizeStatus(status);
    return updateCourse(id, {
      status: next,
      softDeleted: false,
      deletedAt: '',
      previousStatus: '',
    });
  }

  /** Soft-delete: move course into Drafts (مسودة) instead of permanent removal. */
  function softDeleteCourse(id) {
    var course = findCourse(id);
    if (!course) throw new Error('الكورس غير موجود');
    return updateCourse(id, {
      previousStatus: course.status === 'draft' ? course.previousStatus || 'published' : course.status,
      status: 'draft',
      softDeleted: true,
      deletedAt: new Date().toISOString(),
    });
  }

  /** Restore a soft-deleted / draft course back to its previous active status. */
  function restoreCourse(id) {
    var course = findCourse(id);
    if (!course) throw new Error('الكورس غير موجود');
    var nextStatus = course.previousStatus || 'published';
    if (nextStatus === 'draft') nextStatus = 'published';
    return updateCourse(id, {
      status: nextStatus,
      softDeleted: false,
      deletedAt: '',
      previousStatus: '',
    });
  }

  /** Permanent delete from platform_courses. */
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

  function getDraftCount() {
    return getDrafts().length;
  }

  function toInstructorShape(course) {
    var c = normalizeCourse(course);
    return Object.assign({}, c, {
      platformManaged: c.source === 'admin' || c.isAcademy,
      instructorEmail: c.instructorEmail,
    });
  }

  ensureSeeded();

  global.PlatformCourses = {
    COURSES_KEY: COURSES_KEY,
    ACADEMY_NAME: ACADEMY_NAME,
    ACADEMY_EMAIL: ACADEMY_EMAIL,
    COURSE_PRESETS: COURSE_PRESETS,
    getPresetsGrouped: getPresetsGrouped,
    findPreset: findPreset,
    getCourses: getCourses,
    getPublished: getPublished,
    getDrafts: getDrafts,
    getActiveCourses: getActiveCourses,
    getByInstructor: getByInstructor,
    findCourse: findCourse,
    addCourse: addCourse,
    updateCourse: updateCourse,
    setCourseStatus: setCourseStatus,
    softDeleteCourse: softDeleteCourse,
    restoreCourse: restoreCourse,
    deleteCourse: deleteCourse,
    formatDuration: formatDuration,
    getPublishedCount: getPublishedCount,
    getDraftCount: getDraftCount,
    toInstructorShape: toInstructorShape,
    normalizeCourse: normalizeCourse,
    isAcademyAssignment: isAcademyAssignment,
  };
})(typeof window !== 'undefined' ? window : this);
