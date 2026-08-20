/**
 * Automatic rotating simulator showcase on the landing page (#simulatorShowcase).
 */
(function (global) {
  'use strict';

  var ROTATE_MS = 4500;
  var FADE_MS = 420;

  var SHOWCASE_CONFIG = [
    {
      id: 'ftth-simulator',
      screenTitle: 'FTTH Network Designer',
      activeTab: 'FTTH',
      theme: 'ftth',
      stats: [
        { value: '-18.5 dBm', label: 'Power Level' },
        { value: '0.02 dB', label: 'Splice Loss' },
        { value: '12.4 km', label: 'Fiber Length' },
      ],
    },
    {
      id: 'otdr-simulator',
      screenTitle: 'OTDR Trace Viewer',
      activeTab: 'OTDR',
      theme: 'otdr',
      stats: [
        { value: '2.4 km', label: 'Event @ 2.4km' },
        { value: '-0.35 dB', label: 'Splice Loss' },
        { value: '1310 nm', label: 'Wavelength' },
      ],
    },
    {
      id: 'power-meter',
      screenTitle: 'Optical Power Meter',
      activeTab: 'Power',
      theme: 'power',
      stats: [
        { value: '-22.1 dBm', label: 'RX Power' },
        { value: '1550 nm', label: 'Wavelength' },
        { value: 'PASS', label: 'GPON Check' },
      ],
    },
    {
      id: 'fusion-splicer',
      screenTitle: 'Fusion Splicer Lab',
      activeTab: 'Splice',
      theme: 'splice',
      stats: [
        { value: '0.01 dB', label: 'Est. Loss' },
        { value: '12.8 s', label: 'Arc Time' },
        { value: 'OK', label: 'Alignment' },
      ],
    },
    {
      id: 'fiber-anatomy',
      screenTitle: 'Fiber Cable Anatomy 3D',
      activeTab: 'Anatomy',
      theme: 'anatomy',
      stats: [
        { value: '288F', label: 'Max Count' },
        { value: '12F', label: 'Per Tube' },
        { value: 'T13–T24', label: 'Ribbon ID' },
      ],
    },
    {
      id: 'patch-panel-lab',
      screenTitle: 'FTTH Patch Panel Lab',
      activeTab: 'Patch',
      theme: 'patch',
      stats: [
        { value: '1:8', label: 'PLC Split' },
        { value: 'SC/APC', label: 'Connector' },
        { value: '-0.4 dB', label: 'Patch Loss' },
      ],
    },
  ];

  var TAB_LABELS = ['FTTH', 'OTDR', 'Power', 'Splice', 'Anatomy', 'Patch'];

  var timerId = null;
  var fadeTimerId = null;
  var currentIndex = 0;
  var paused = false;
  var items = [];

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getExtras(id) {
    for (var i = 0; i < SHOWCASE_CONFIG.length; i++) {
      if (SHOWCASE_CONFIG[i].id === id) return SHOWCASE_CONFIG[i];
    }
    return null;
  }

  function buildShowcaseItems() {
    if (!global.PlatformSimulators) return [];
    var catalog = global.PlatformSimulators.getCatalog();
    return catalog
      .map(function (sim) {
        var extras = getExtras(sim.id) || {};
        return {
          id: sim.id,
          title: sim.label || sim.id,
          description: sim.description || '',
          href: sim.href || '',
          icon: sim.icon || '◆',
          iconType: sim.iconType || 'emoji',
          screenTitle: extras.screenTitle || sim.navLabel || sim.label,
          activeTab: extras.activeTab || 'Sim',
          theme: extras.theme || 'ftth',
          stats: Array.isArray(extras.stats) ? extras.stats : [],
        };
      })
      .filter(function (item) {
        return !!item.id;
      });
  }

  function buildToolbarHtml(activeTab) {
    return TAB_LABELS.map(function (label) {
      return (
        '<span class="demo__mock-btn' +
        (label === activeTab ? ' demo__mock-btn--active' : '') +
        '">' +
        escapeHtml(label) +
        '</span>'
      );
    }).join('');
  }

  function buildStatsHtml(stats) {
    if (!stats.length) return '';
    return stats
      .map(function (stat) {
        return (
          '<div class="demo__mock-stat"><div class="demo__mock-stat-value">' +
          escapeHtml(stat.value) +
          '</div><div class="demo__mock-stat-label">' +
          escapeHtml(stat.label) +
          '</div></div>'
        );
      })
      .join('');
  }

  function buildVisualHtml(item) {
    var icon =
      item.iconType === 'image' && item.icon
        ? '<img class="sim-showcase__visual-icon-img" src="' + escapeHtml(item.icon) + '" alt="" />'
        : '<span class="sim-showcase__visual-icon">' + escapeHtml(item.icon) + '</span>';
    return (
      '<div class="sim-showcase__visual-inner sim-showcase__visual-inner--' +
      escapeHtml(item.theme) +
      '">' +
      icon +
      '<span class="sim-showcase__visual-label">' +
      escapeHtml(item.activeTab) +
      '</span></div>'
    );
  }

  function isUnderDevelopment(id) {
    return (
      global.PlatformSimulators &&
      typeof global.PlatformSimulators.isSimulatorUnderDevelopment === 'function' &&
      global.PlatformSimulators.isSimulatorUnderDevelopment(id)
    );
  }

  function resolveHref(item) {
    if (!item.href) return '#simulators';
    if (
      global.PlatformSimulators &&
      typeof global.PlatformSimulators.viewerCanAccess === 'function' &&
      !global.PlatformSimulators.viewerCanAccess(item.id) &&
      !isUnderDevelopment(item.id)
    ) {
      return '#simulators';
    }
    return item.href;
  }

  function applyShowcaseItem(item, animate) {
    var copy = document.getElementById('simShowcaseCopy');
    var screen = document.getElementById('simShowcaseScreen');
    var titleEl = document.getElementById('simShowcaseTitle');
    var descEl = document.getElementById('simShowcaseDesc');
    var ctaEl = document.getElementById('simShowcaseCta');
    var screenTitleEl = document.getElementById('simShowcaseScreenTitle');
    var toolbarEl = document.getElementById('simShowcaseToolbar');
    var visualEl = document.getElementById('simShowcaseVisual');
    var statsEl = document.getElementById('simShowcaseStats');
    var soonEl = document.getElementById('simShowcaseSoon');
    if (!copy || !item) return;

    function paint() {
      if (titleEl) titleEl.textContent = item.title;
      if (descEl) descEl.textContent = item.description;
      if (screenTitleEl) screenTitleEl.textContent = item.screenTitle;
      if (toolbarEl) toolbarEl.innerHTML = buildToolbarHtml(item.activeTab);
      if (visualEl) {
        visualEl.className = 'sim-showcase__visual sim-showcase__visual--' + item.theme;
        visualEl.innerHTML = buildVisualHtml(item);
      }
      if (statsEl) statsEl.innerHTML = buildStatsHtml(item.stats);
      if (ctaEl) {
        ctaEl.setAttribute('data-simulator-launch', item.id);
        ctaEl.href = resolveHref(item);
        if (isUnderDevelopment(item.id)) {
          ctaEl.textContent = 'قيد التطوير';
          ctaEl.classList.add('sim-showcase__cta--soon');
        } else {
          ctaEl.textContent = 'Try Simulator';
          ctaEl.classList.remove('sim-showcase__cta--soon');
        }
      }
      if (soonEl) soonEl.hidden = !isUnderDevelopment(item.id);
      if (screen) {
        screen.classList.toggle('sim-showcase__screen--soon', isUnderDevelopment(item.id));
      }
    }

    if (!animate) {
      paint();
      return;
    }

    copy.classList.add('is-fading');
    if (screen) screen.classList.add('is-fading');
    if (fadeTimerId) clearTimeout(fadeTimerId);
    fadeTimerId = setTimeout(function () {
      paint();
      copy.classList.remove('is-fading');
      if (screen) screen.classList.remove('is-fading');
    }, FADE_MS);
  }

  function goTo(index, animate) {
    if (!items.length) return;
    currentIndex = ((index % items.length) + items.length) % items.length;
    applyShowcaseItem(items[currentIndex], animate !== false);
  }

  function stopTimer() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function startTimer() {
    stopTimer();
    if (paused || items.length < 2) return;
    timerId = setInterval(function () {
      goTo(currentIndex + 1, true);
    }, ROTATE_MS);
  }

  function mountSimulatorShowcase() {
    var root = document.getElementById('simulatorShowcase');
    if (!root) return;

    items = buildShowcaseItems();
    if (!items.length) return;

    if (currentIndex >= items.length) currentIndex = 0;
    goTo(currentIndex, false);
    startTimer();

    if (root.dataset.bound === '1') return;
    root.dataset.bound = '1';

    root.addEventListener('mouseenter', function () {
      paused = true;
      stopTimer();
    });
    root.addEventListener('mouseleave', function () {
      paused = false;
      startTimer();
    });
  }

  global.PlatformSimulatorShowcase = {
    SHOWCASE_CONFIG: SHOWCASE_CONFIG,
    ROTATE_MS: ROTATE_MS,
    buildShowcaseItems: buildShowcaseItems,
    mountSimulatorShowcase: mountSimulatorShowcase,
  };

  function boot() {
    mountSimulatorShowcase();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.addEventListener('ifa:simulators-meta-changed', mountSimulatorShowcase);
  global.addEventListener('ifa:platform-settings-changed', mountSimulatorShowcase);
  global.addEventListener('storage', function (e) {
    if (!e.key || e.key === 'ifa_simulators_meta' || e.key === 'ifa_platform_settings') {
      mountSimulatorShowcase();
    }
  });
})(typeof window !== 'undefined' ? window : this);
