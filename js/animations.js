(function () {
  'use strict';

  var revealObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

  function reobserveAnimations(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var nodes = scope.querySelectorAll
      ? scope.querySelectorAll('.fade-in:not(.visible)')
      : [];
    if (root && root.classList && root.classList.contains('fade-in') && !root.classList.contains('visible')) {
      revealObserver.observe(root);
    }
    Array.prototype.forEach.call(nodes, function (el) {
      revealObserver.observe(el);
    });
  }

  window.reobserveAnimations = reobserveAnimations;

  reobserveAnimations(document);

  var statNumbers = document.querySelectorAll('.stat-card__number[data-target]');
  var countersAnimated = false;

  function formatCounterValue(value, suffix) {
    if (window.PlatformStats && typeof window.PlatformStats.formatStatNumber === 'function') {
      return window.PlatformStats.formatStatNumber(value) + (suffix || '');
    }
    var n = Math.round(Number(value) || 0);
    var formatted = n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    return formatted + (suffix || '');
  }

  function animateCounter(element) {
    var target = parseInt(element.getAttribute('data-target'), 10);
    if (!isFinite(target)) return;
    var duration = 2000;
    var startTime = performance.now();
    var suffix = element.getAttribute('data-stat-suffix') || '';
    var isPercentage =
      suffix === '%' ||
      element.getAttribute('data-stat-key') === 'satisfactionRate';

    function updateCounter(currentTime) {
      var progress = Math.min((currentTime - startTime) / duration, 1);
      var current = Math.floor((1 - Math.pow(1 - progress, 3)) * target);
      element.textContent = formatCounterValue(current, isPercentage ? '%' : '');
      if (progress < 1) requestAnimationFrame(updateCounter);
      else element.textContent = formatCounterValue(target, isPercentage ? '%' : '');
    }

    requestAnimationFrame(updateCounter);
  }

  function startStatCounters() {
    statNumbers = document.querySelectorAll('.stat-card__number[data-target]');
    if (!statNumbers.length || countersAnimated) return;
    countersAnimated = true;
    Array.prototype.forEach.call(statNumbers, animateCounter);
  }

  function resetStatCounters() {
    countersAnimated = false;
    statNumbers = document.querySelectorAll('.stat-card__number[data-target]');
    Array.prototype.forEach.call(statNumbers, function (el) {
      el.textContent = '0';
    });
  }

  window.addEventListener('ifa:platform-stats-changed', function () {
    if (window.PlatformStats && typeof window.PlatformStats.applyLandingStats === 'function') {
      window.PlatformStats.applyLandingStats(document);
    }
    resetStatCounters();
    if (statsSection) {
      var rect = statsSection.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        startStatCounters();
      }
    }
  });

  var statsSection = document.getElementById('stats');
  if (statsSection) {
    var statsObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && !countersAnimated) {
          startStatCounters();
          statsObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.3 });
    statsObserver.observe(statsSection);
  }

  function staggerChildren(parentSelector, childSelector, delay) {
    document.querySelectorAll(parentSelector).forEach(function (parent) {
      parent.querySelectorAll(childSelector).forEach(function (child, index) {
        child.style.transitionDelay = index * delay + 'ms';
      });
    });
  }

  staggerChildren('.features__grid', '.feature-card', 100);
  staggerChildren('.testimonials__grid', '.testimonial-card', 150);
  staggerChildren('.pricing__grid', '.pricing-card', 120);
  staggerChildren('.faq__list', '.faq-item', 80);

  document.addEventListener('DOMContentLoaded', function () {
    reobserveAnimations(document);
  });
  window.addEventListener('load', function () {
    reobserveAnimations(document);
  });
})();
