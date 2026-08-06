(function () {
  'use strict';

  const header = document.getElementById('header');
  const nav = document.getElementById('nav');
  const navToggle = document.getElementById('navToggle');
  const navOverlay = document.getElementById('navOverlay');
  const navLinks = document.querySelectorAll('.nav__link');

  function closeMenu() {
    nav.classList.remove('open');
    navToggle.classList.remove('active');
    navOverlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  function openMenu() {
    nav.classList.add('open');
    navToggle.classList.add('active');
    navOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  navToggle.addEventListener('click', function () {
    nav.classList.contains('open') ? closeMenu() : openMenu();
  });

  navOverlay.addEventListener('click', closeMenu);

  navLinks.forEach(function (link) {
    link.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      if (href && href.startsWith('#')) {
        e.preventDefault();
        const target = document.querySelector(href);
        if (target) {
          const offset = header ? header.offsetHeight : 72;
          window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - offset, behavior: 'smooth' });
        }
        closeMenu();
      }
    });
  });

  function handleHeaderScroll() {
    if (!header) return;
    header.classList.toggle('scrolled', window.scrollY > 50);
  }

  window.addEventListener('scroll', handleHeaderScroll, { passive: true });
  handleHeaderScroll();

  const sections = document.querySelectorAll('section[id]');

  window.addEventListener('scroll', function () {
    const scrollPos = window.scrollY + (header ? header.offsetHeight + 100 : 150);
    sections.forEach(function (section) {
      if (scrollPos >= section.offsetTop && scrollPos < section.offsetTop + section.offsetHeight) {
        navLinks.forEach(function (link) {
          link.classList.toggle('active', link.getAttribute('href') === '#' + section.id);
        });
      }
    });
  }, { passive: true });

  window.addEventListener('resize', function () {
    if (window.innerWidth > 992) closeMenu();
  });

  /* User profile dropdown */
  document.addEventListener('click', function (e) {
    var toggle = e.target.closest ? e.target.closest('#userMenuToggle, .user-menu__toggle') : null;
    var menu = document.getElementById('userMenu');
    var dropdown = document.getElementById('userMenuDropdown');

    if (toggle && menu && dropdown) {
      e.preventDefault();
      e.stopPropagation();
      var isOpen = menu.classList.contains('open');
      document.querySelectorAll('.user-menu.open').forEach(function (m) {
        m.classList.remove('open');
        var t = m.querySelector('.user-menu__toggle');
        var d = m.querySelector('.user-menu__dropdown');
        if (t) t.setAttribute('aria-expanded', 'false');
        if (d) d.hidden = true;
      });
      if (!isOpen) {
        menu.classList.add('open');
        toggle.setAttribute('aria-expanded', 'true');
        dropdown.hidden = false;
      }
      return;
    }

    if (menu && !menu.contains(e.target)) {
      menu.classList.remove('open');
      var t = menu.querySelector('.user-menu__toggle');
      var d = menu.querySelector('.user-menu__dropdown');
      if (t) t.setAttribute('aria-expanded', 'false');
      if (d) d.hidden = true;
    }

    var menuItem = e.target.closest ? e.target.closest('.user-menu__item') : null;
    if (menuItem && menu) {
      menu.classList.remove('open');
      var toggleBtn = menu.querySelector('.user-menu__toggle');
      var drop = menu.querySelector('.user-menu__dropdown');
      if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
      if (drop) drop.hidden = true;
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var menu = document.getElementById('userMenu');
    if (!menu) return;
    menu.classList.remove('open');
    var t = menu.querySelector('.user-menu__toggle');
    var d = menu.querySelector('.user-menu__dropdown');
    if (t) t.setAttribute('aria-expanded', 'false');
    if (d) d.hidden = true;
  });
})();
