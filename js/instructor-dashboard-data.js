/**
 * Instructor dashboard data (localStorage), scoped per instructor email.
 * Strictly isolated from admin dashboard data/keys.
 */
(function (global) {
  'use strict';

  var CONTENT_KEY = 'ifa_instructor_content';
  var APPS = global.InstructorApps;

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function readAll() {
    try {
      var raw = localStorage.getItem(CONTENT_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      console.warn('[InstructorDash] read failed', err);
      return {};
    }
  }

  function writeAll(data) {
    try {
      localStorage.setItem(CONTENT_KEY, JSON.stringify(data));
    } catch (err) {
      console.error('[InstructorDash] write failed', err);
    }
  }

  function currentInstructorEmail() {
    if (APPS) {
      return normalizeEmail(
        APPS.getApprovedInstructorEmail() ||
          APPS.getSessionEmail() ||
          ''
      );
    }
    try {
      return normalizeEmail(localStorage.getItem('approvedInstructorEmail') || '');
    } catch (e) {
      return '';
    }
  }

  function isInstructorAllowed() {
    try {
      if (localStorage.getItem('isInstructorApproved') === 'true') return true;
    } catch (e) {
      /* ignore */
    }
    if (APPS && typeof APPS.getInstructorApprovedFlag === 'function') {
      return !!APPS.getInstructorApprovedFlag();
    }
    return false;
  }

  function ensureBucket(email) {
    var key = normalizeEmail(email);
    var all = readAll();
    if (!all[key]) {
      all[key] = {
        email: key,
        courses: [],
        updatedAt: new Date().toISOString(),
      };
      writeAll(all);
    }
    return all[key];
  }

  function getCourses(email) {
    var bucket = ensureBucket(email || currentInstructorEmail());
    return Array.isArray(bucket.courses) ? bucket.courses : [];
  }

  function saveCourses(email, courses) {
    var key = normalizeEmail(email || currentInstructorEmail());
    var all = readAll();
    all[key] = {
      email: key,
      courses: courses,
      updatedAt: new Date().toISOString(),
    };
    writeAll(all);
  }

  function findCourse(courses, courseId) {
    for (var i = 0; i < courses.length; i++) {
      if (courses[i].id === courseId) return courses[i];
    }
    return null;
  }

  function findLesson(course, lessonId) {
    if (!course || !Array.isArray(course.lessons)) return null;
    for (var i = 0; i < course.lessons.length; i++) {
      if (course.lessons[i].id === lessonId) return course.lessons[i];
    }
    return null;
  }

  function addCourse(email, payload) {
    var key = normalizeEmail(email || currentInstructorEmail());
    var courses = getCourses(key);
    var course = {
      id: uid('course'),
      instructorEmail: key,
      title: String(payload.title || '').trim(),
      description: String(payload.description || '').trim(),
      enrolledCount: Number(payload.enrolledCount) || 0,
      views: Number(payload.views) || 0,
      createdAt: new Date().toISOString(),
      lessons: [],
    };
    if (!course.title) throw new Error('عنوان الكورس مطلوب');
    courses.unshift(course);
    saveCourses(key, courses);
    return course;
  }

  function updateCourse(email, courseId, patch) {
    var key = normalizeEmail(email || currentInstructorEmail());
    var courses = getCourses(key);
    var course = findCourse(courses, courseId);
    if (!course || course.instructorEmail !== key) throw new Error('غير مصرح بتعديل هذا الكورس');
    if (patch.title != null) course.title = String(patch.title).trim();
    if (patch.description != null) course.description = String(patch.description).trim();
    if (patch.enrolledCount != null) course.enrolledCount = Number(patch.enrolledCount) || 0;
    saveCourses(key, courses);
    return course;
  }

  function deleteCourse(email, courseId) {
    var key = normalizeEmail(email || currentInstructorEmail());
    var courses = getCourses(key).filter(function (c) {
      return !(c.id === courseId && c.instructorEmail === key);
    });
    saveCourses(key, courses);
  }

  function addLesson(email, courseId, payload) {
    var key = normalizeEmail(email || currentInstructorEmail());
    var courses = getCourses(key);
    var course = findCourse(courses, courseId);
    if (!course || course.instructorEmail !== key) throw new Error('غير مصرح');
    var lesson = {
      id: uid('lesson'),
      title: String(payload.title || '').trim(),
      videoTitle: String(payload.videoTitle || '').trim(),
      videoFileName: String(payload.videoFileName || '').trim(),
      templateFiles: Array.isArray(payload.templateFiles) ? payload.templateFiles : [],
      quiz: { questions: [] },
      comments: [],
      views: Number(payload.views) || 0,
      completions: Number(payload.completions) || 0,
      createdAt: new Date().toISOString(),
    };
    if (!lesson.title) throw new Error('عنوان الحلقة مطلوب');
    course.lessons = course.lessons || [];
    course.lessons.push(lesson);
    saveCourses(key, courses);
    return lesson;
  }

  function updateLesson(email, courseId, lessonId, patch) {
    var key = normalizeEmail(email || currentInstructorEmail());
    var courses = getCourses(key);
    var course = findCourse(courses, courseId);
    if (!course || course.instructorEmail !== key) throw new Error('غير مصرح');
    var lesson = findLesson(course, lessonId);
    if (!lesson) throw new Error('الحلقة غير موجودة');
    ['title', 'videoTitle', 'videoFileName'].forEach(function (f) {
      if (patch[f] != null) lesson[f] = String(patch[f]).trim();
    });
    if (patch.templateFiles) lesson.templateFiles = patch.templateFiles;
    saveCourses(key, courses);
    return lesson;
  }

  function deleteLesson(email, courseId, lessonId) {
    var key = normalizeEmail(email || currentInstructorEmail());
    var courses = getCourses(key);
    var course = findCourse(courses, courseId);
    if (!course || course.instructorEmail !== key) throw new Error('غير مصرح');
    course.lessons = (course.lessons || []).filter(function (l) {
      return l.id !== lessonId;
    });
    saveCourses(key, courses);
  }

  function setLessonQuiz(email, courseId, lessonId, questions) {
    var key = normalizeEmail(email || currentInstructorEmail());
    var courses = getCourses(key);
    var course = findCourse(courses, courseId);
    if (!course || course.instructorEmail !== key) throw new Error('غير مصرح');
    var lesson = findLesson(course, lessonId);
    if (!lesson) throw new Error('الحلقة غير موجودة');
    lesson.quiz = { questions: Array.isArray(questions) ? questions : [] };
    saveCourses(key, courses);
    return lesson.quiz;
  }

  function addComment(email, courseId, lessonId, payload) {
    var key = normalizeEmail(email || currentInstructorEmail());
    var courses = getCourses(key);
    var course = findCourse(courses, courseId);
    if (!course || course.instructorEmail !== key) throw new Error('غير مصرح');
    var lesson = findLesson(course, lessonId);
    if (!lesson) throw new Error('الحلقة غير موجودة');
    var comment = {
      id: uid('cmt'),
      studentName: String(payload.studentName || 'طالب').trim(),
      text: String(payload.text || '').trim(),
      createdAt: new Date().toISOString(),
      reply: null,
    };
    lesson.comments = lesson.comments || [];
    lesson.comments.unshift(comment);
    saveCourses(key, courses);
    return comment;
  }

  function replyToComment(email, courseId, lessonId, commentId, replyText) {
    var key = normalizeEmail(email || currentInstructorEmail());
    var courses = getCourses(key);
    var course = findCourse(courses, courseId);
    if (!course || course.instructorEmail !== key) throw new Error('غير مصرح');
    var lesson = findLesson(course, lessonId);
    if (!lesson) throw new Error('الحلقة غير موجودة');
    var comments = lesson.comments || [];
    for (var i = 0; i < comments.length; i++) {
      if (comments[i].id === commentId) {
        comments[i].reply = {
          text: String(replyText || '').trim(),
          at: new Date().toISOString(),
        };
        saveCourses(key, courses);
        return comments[i];
      }
    }
    throw new Error('التعليق غير موجود');
  }

  function getAnalytics(email) {
    var courses = getCourses(email);
    var lessons = 0;
    var views = 0;
    var completions = 0;
    var enrolled = 0;
    var unanswered = 0;
    var quizCount = 0;

    courses.forEach(function (c) {
      enrolled += Number(c.enrolledCount) || 0;
      views += Number(c.views) || 0;
      (c.lessons || []).forEach(function (l) {
        lessons += 1;
        views += Number(l.views) || 0;
        completions += Number(l.completions) || 0;
        if (l.quiz && l.quiz.questions && l.quiz.questions.length) quizCount += 1;
        (l.comments || []).forEach(function (cm) {
          if (!cm.reply) unanswered += 1;
        });
      });
    });

    var completionRate = views > 0 ? Math.round((completions / views) * 100) : 0;
    return {
      courses: courses.length,
      lessons: lessons,
      enrolled: enrolled,
      views: views,
      completions: completions,
      completionRate: Math.min(100, completionRate),
      unanswered: unanswered,
      quizCount: quizCount,
    };
  }

  function seedDemoIfEmpty(email) {
    var key = normalizeEmail(email || currentInstructorEmail());
    if (!key) return;
    var courses = getCourses(key);
    if (courses.length) return;

    var course = addCourse(key, {
      title: 'أساسيات شبكات FTTH',
      description: 'كورس تعريفي للمدرب — يمكنك تعديله أو حذفه.',
      enrolledCount: 24,
      views: 180,
    });
    var lesson = addLesson(key, course.id, {
      title: 'الحلقة 1: مقدمة إلى الألياف الضوئية',
      videoTitle: 'مقدمة FTTH',
      videoFileName: 'ftth-intro.mp4',
      templateFiles: [{ name: 'worksheet-01.pdf' }],
      views: 120,
      completions: 86,
    });
    setLessonQuiz(key, course.id, lesson.id, [
      {
        id: uid('q'),
        text: 'ما معنى FTTH؟',
        options: ['Fiber To The Home', 'File To The Host', 'Fast Transfer Protocol', 'Field Test Tool'],
        correctIndex: 0,
      },
    ]);
    addComment(key, course.id, lesson.id, {
      studentName: 'سارة العلي',
      text: 'هل يمكن توضيح الفرق بين splitter و OLT؟',
    });
    addComment(key, course.id, lesson.id, {
      studentName: 'محمد حسن',
      text: 'ممتاز! هل توجد حلقة عن OTDR قريباً؟',
    });
  }

  global.InstructorDash = {
    CONTENT_KEY: CONTENT_KEY,
    currentInstructorEmail: currentInstructorEmail,
    isInstructorAllowed: isInstructorAllowed,
    getCourses: getCourses,
    addCourse: addCourse,
    updateCourse: updateCourse,
    deleteCourse: deleteCourse,
    addLesson: addLesson,
    updateLesson: updateLesson,
    deleteLesson: deleteLesson,
    setLessonQuiz: setLessonQuiz,
    addComment: addComment,
    replyToComment: replyToComment,
    getAnalytics: getAnalytics,
    seedDemoIfEmpty: seedDemoIfEmpty,
    findCourse: findCourse,
    findLesson: findLesson,
  };
})(typeof window !== 'undefined' ? window : globalThis);
