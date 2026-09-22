/**
 * Admin dashboard shell — hash router, sidebar, overview stats.
 */
(function () {
  'use strict';

  function bind() {
    var sidebar = document.getElementById('adminSidebar');
    var overlay = document.getElementById('adminOverlay');
    var toggle = document.getElementById('adminMenuToggle');
    var navLinks = document.querySelectorAll('.admin-nav__link, .admin-nav__sublink');
    var topbarTitle = document.querySelector('.admin-topbar__title');
    var topbarSubtitle = document.querySelector('.admin-topbar__subtitle');

    var SITE_VIEWS = {
      'site-simulator-showcase': true,
      'site-hero-slideshow': true,
      'site-articles': true,
      'site-faq': true,
      'site-testimonials': true,
      'site-preview': true,
      'site-footer': true,
    };

    var VIEW_META = {
      overview: { title: 'نظرة عامة', subtitle: 'ENGINEER PATH °360 Admin — منصة المسار المهني الهندسي' },
      users: { title: 'إدارة المستخدمين', subtitle: 'عرض وإدارة حسابات الطلاب' },
      'site-stats': { title: 'إدارة الإحصائيات', subtitle: 'Website Statistics — أرقام قسم الإحصائيات على الصفحة الرئيسية' },
      instructors: { title: 'إدارة المدربين', subtitle: 'طلبات الانضمام وحسابات المدربين' },
      courses: { title: 'الكورسات', subtitle: 'إنشاء وإدارة ونشر الكورسات التعليمية' },
      plans: { title: 'الباقات والأسعار', subtitle: 'إدارة خطط الاشتراك المعروضة على الموقع' },
      orders: { title: 'طلبات الشراء', subtitle: 'مراجعة أواصر الدفع اليدوي وقبول أو رفض الطلبات' },
      'settings-checkout': {
        title: 'إعدادات الدفع والإشعارات',
        subtitle: 'بريد الإشعارات وأرقام الدفع اليدوي لصفحة الشراء',
      },
      'site-simulator-showcase': {
        title: 'إدارة المحاكيات',
        subtitle: 'بطاقات الشبكة وعرض الدوران على الصفحة الرئيسية',
      },
      simulators: {
        title: 'إدارة موقعي',
        subtitle: 'إدارة المحاكيات — بطاقات الشبكة وعرض الدوران',
      },
      'site-hero-slideshow': { title: 'إدارة موقعي', subtitle: 'الصفحة الرئيسية — Homepage' },
      'site-articles': { title: 'المقالات التقنية', subtitle: 'إضافة وتعديل المقالات المعروضة في الصفحة الرئيسية' },
      'site-faq': { title: 'الأسئلة الشائعة', subtitle: 'إدارة الأسئلة والأجوبة في الصفحة الرئيسية' },
      'site-testimonials': { title: 'آراء المستخدمين', subtitle: 'إدارة آراء وتقييمات المستخدمين' },
      'site-preview': { title: 'معاينة الموقع', subtitle: 'معاينة الموقع المباشر' },
      'site-footer': { title: 'إدارة موقعي', subtitle: 'Footer Settings — وصف العلامة وروابط التواصل' },
      settings: { title: 'الإعدادات', subtitle: 'إعدادات النظام' },
    };

    function closeSidebar() {
      sidebar.classList.remove('open');
      overlay.classList.remove('visible');
    }

    function openSidebar() {
      sidebar.classList.add('open');
      overlay.classList.add('visible');
    }

    function showAdminView(sectionId) {
      var id = VIEW_META[sectionId] ? sectionId : 'overview';
      if (id === 'simulators') id = 'site-simulator-showcase';
      document.querySelectorAll('[data-admin-view]').forEach(function (view) {
        view.hidden = view.getAttribute('data-admin-view') !== id;
      });
      navLinks.forEach(function (link) {
        var section = link.getAttribute('data-section');
        var active = section === id;
        if (link.hasAttribute('data-site-parent')) {
          active = !!SITE_VIEWS[id];
        }
        link.classList.toggle('active', active);
      });
      var meta = VIEW_META[id];
      if (topbarTitle) topbarTitle.textContent = meta.title;
      if (topbarSubtitle) topbarSubtitle.textContent = meta.subtitle;
      try {
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, '', '#' + id);
        } else {
          window.location.hash = id;
        }
      } catch (err) {
        /* ignore */
      }
      if (id === 'overview' && typeof window.refreshAdminOverviewStats === 'function') {
        window.refreshAdminOverviewStats();
      }
      if (id === 'courses' && typeof window.renderAdminCoursesTable === 'function') {
        window.renderAdminCoursesTable();
      }
      if (id === 'orders' && typeof window.renderAdminOrdersTable === 'function') {
        window.renderAdminOrdersTable();
      }
      if (id === 'settings-checkout' && typeof window.loadAdminCheckoutSettings === 'function') {
        window.loadAdminCheckoutSettings();
      }
      if ((SITE_VIEWS[id] || id.indexOf('site-') === 0) && typeof window.renderAdminSiteCms === 'function') {
        window.renderAdminSiteCms();
      }
      document.body.classList.toggle('admin-body--site-preview', id === 'site-preview');
    }

    function escapeOverviewHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    window.refreshAdminOverviewStats = function () {
      var publishedEl = document.getElementById('statPublishedCourses');
      var totalCoursesEl = document.getElementById('statTotalCourses');
      var coursesTrendEl = document.getElementById('statCoursesTrend');
      var totalUsersEl = document.getElementById('statTotalUsers');
      var activeUsersEl = document.getElementById('statActiveUsers');
      var summaryEl = document.getElementById('overviewCoursesSummary');

      if (window.PlatformCourses) {
        var allCourses = window.PlatformCourses.getCourses();
        var published = window.PlatformCourses.getPublishedCount();
        var drafts = typeof window.PlatformCourses.getDraftCount === 'function'
          ? window.PlatformCourses.getDraftCount()
          : allCourses.filter(function (c) {
              return c.status === 'draft' || c.softDeleted;
            }).length;
        if (publishedEl) publishedEl.textContent = String(published);
        if (totalCoursesEl) totalCoursesEl.textContent = String(allCourses.length);
        if (coursesTrendEl) coursesTrendEl.textContent = drafts + ' مسودة';

        if (summaryEl) {
          if (!allCourses.length) {
            summaryEl.innerHTML = '<p class="admin-empty-cell">لا توجد كورسات بعد.</p>';
          } else {
            var latest = allCourses.slice().sort(function (a, b) {
              return String(b.updatedAt || b.createdAt || '').localeCompare(
                String(a.updatedAt || a.createdAt || '')
              );
            }).slice(0, 5);
            summaryEl.innerHTML =
              '<ul class="admin-overview-courses__list">' +
              latest
                .map(function (c) {
                  return (
                    '<li>' +
                    '<div>' +
                    '<strong>' +
                    escapeOverviewHtml(c.title) +
                    '</strong>' +
                    '<span>' +
                    escapeOverviewHtml(window.PlatformCourses.formatDuration(c)) +
                    (c.instructorName || c.instructorEmail
                      ? ' · ' + escapeOverviewHtml(c.instructorName || c.instructorEmail)
                      : '') +
                    '</span>' +
                    '</div>' +
                    '<span class="admin-badge ' +
                    (c.status === 'published' ? 'admin-badge--active' : 'admin-badge--pending') +
                    '">' +
                    (c.status === 'published' ? 'منشور' : 'مسودة') +
                    '</span>' +
                    '</li>'
                  );
                })
                .join('') +
              '</ul>';
          }
        }
      }

      if (window.AdminUsers) {
        var users = window.AdminUsers.getUsers();
        var active = users.filter(function (u) {
          return u.status === 'active';
        }).length;
        if (totalUsersEl) totalUsersEl.textContent = String(users.length);
        if (activeUsersEl) activeUsersEl.textContent = String(active);
        var usersTrend = document.getElementById('statUsersTrend');
        var activeTrend = document.getElementById('statActiveUsersTrend');
        if (usersTrend) usersTrend.textContent = users.length ? 'محدّث' : '—';
        if (activeTrend) activeTrend.textContent = active ? 'نشط' : '—';
      }
    };

    if (toggle) {
      toggle.addEventListener('click', function () {
        if (sidebar.classList.contains('open')) closeSidebar();
        else openSidebar();
      });
    }

    if (overlay) overlay.addEventListener('click', closeSidebar);

    navLinks.forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        var section = link.getAttribute('data-section') || 'overview';
        showAdminView(section);
        if (window.innerWidth <= 900) closeSidebar();
      });
    });

    document.addEventListener('click', function (e) {
      var go = e.target.closest ? e.target.closest('[data-goto-section]') : null;
      if (!go) return;
      e.preventDefault();
      showAdminView(go.getAttribute('data-goto-section') || 'overview');
    });

    document.addEventListener('ifa:platform-courses-changed', function () {
      if (typeof window.refreshAdminOverviewStats === 'function') {
        window.refreshAdminOverviewStats();
      }
    });

    window.addEventListener('hashchange', function () {
      var hash = (window.location.hash || '#overview').replace(/^#/, '') || 'overview';
      showAdminView(hash);
    });

    var initialHash = (window.location.hash || '#overview').replace(/^#/, '') || 'overview';
    showAdminView(initialHash);
    window.refreshAdminOverviewStats();
    bindPlatformSettingsForm();
    bindAdminFtthLabConfigPanel();
    bindLabConfigPreviewForwarder();
  }

  function bindLabConfigPreviewForwarder() {
    if (window.__ifaLabConfigPreviewForwarderBound) return;
    window.__ifaLabConfigPreviewForwarderBound = true;

    function forwardLabConfigMessage(data) {
      if (!data || data.type !== 'ifa:lab-config-apply' || data._ifaRouted) return;
      var payload = Object.assign({}, data, { _ifaRouted: true });
      document.querySelectorAll('iframe').forEach(function (frame) {
        if (!frame.contentWindow) return;
        try {
          frame.contentWindow.postMessage(payload, '*');
        } catch (err) { /* ignore */ }
      });
    }

    window.addEventListener('message', function (ev) {
      forwardLabConfigMessage(ev.data);
    });
    window.addEventListener('ifa:lab-config-apply-local', function (ev) {
      forwardLabConfigMessage((ev && ev.detail) || null);
    });
  }

  function bindAdminFtthLabConfigPanel() {
    if (!window.FtthLabSettingsCms ||
        typeof FtthLabSettingsCms.mountAdminEmbeddedPanel !== 'function') {
      return;
    }
    FtthLabSettingsCms.mountAdminEmbeddedPanel('admin-ftth-lab-config-root');
  }

  function bindPlatformSettingsForm() {
    var form = document.getElementById('platformSettingsForm');
    var list = document.getElementById('settingsFreeSimulators');
    var comingSoonList = document.getElementById('settingsComingSoonSimulators');
    var daysInput = document.getElementById('settingsFreeTrialDays');
    var statusEl = document.getElementById('settingsSaveStatus');
    if (!form || !window.PlatformSimulators) return;

    var catalog =
      typeof window.PlatformSimulators.getCatalog === 'function'
        ? window.PlatformSimulators.getCatalog()
        : [];
    var settings =
      typeof window.PlatformSimulators.getPlatformSettings === 'function'
        ? window.PlatformSimulators.getPlatformSettings()
        : { freeSimulatorIds: [], comingSoonSimulatorIds: [], freeTrialDays: 0 };
    var selected = {};
    (settings.freeSimulatorIds || []).forEach(function (id) {
      selected[id] = true;
    });
    var comingSoonSelected = {};
    (settings.comingSoonSimulatorIds || []).forEach(function (id) {
      comingSoonSelected[id] = true;
    });

    function renderChecklist(host, name, selectedMap) {
      if (!host) return;
      host.innerHTML = catalog
        .map(function (sim) {
          return (
            '<label>' +
            '<input type="checkbox" name="' +
            name +
            '" value="' +
            String(sim.id).replace(/"/g, '') +
            '"' +
            (selectedMap[sim.id] ? ' checked' : '') +
            ' />' +
            '<span>' +
            String(sim.label || sim.id) +
            ' <code>' +
            String(sim.id) +
            '</code></span>' +
            '</label>'
          );
        })
        .join('');
    }

    renderChecklist(list, 'freeSimulator', selected);
    renderChecklist(comingSoonList, 'comingSoonSimulator', comingSoonSelected);
    if (daysInput) daysInput.value = String(settings.freeTrialDays || 0);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var ids = [];
      form.querySelectorAll('input[name="freeSimulator"]:checked').forEach(function (input) {
        if (input.value) ids.push(input.value);
      });
      var comingSoonIds = [];
      form.querySelectorAll('input[name="comingSoonSimulator"]:checked').forEach(function (input) {
        if (input.value) comingSoonIds.push(input.value);
      });
      var days = daysInput ? Number(daysInput.value) : 0;
      var saved = window.PlatformSimulators.savePlatformSettings({
        freeSimulatorIds: ids,
        comingSoonSimulatorIds: comingSoonIds,
        freeTrialDays: isFinite(days) && days > 0 ? days : 0,
      });
      if (statusEl) {
        statusEl.textContent =
          'تم الحفظ — تجربة ' +
          (saved.freeTrialDays || 0) +
          ' يوم، مجاني: ' +
          (saved.freeSimulatorIds.length || 0) +
          '، قيد التطوير: ' +
          (saved.comingSoonSimulatorIds.length || 0);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
