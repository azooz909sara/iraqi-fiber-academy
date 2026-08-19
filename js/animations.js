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

  function animateCounter(element) {
    var target = parseInt(element.getAttribute('data-target'), 10);
    var duration = 2000;
    var startTime = performance.now();
    var isPercentage = element.closest('.stat-card').querySelector('.stat-card__label').textContent.includes('%');

    function updateCounter(currentTime) {
      var progress = Math.min((currentTime - startTime) / duration, 1);
      var current = Math.floor((1 - Math.pow(1 - progress, 3)) * target);
      element.textContent = isPercentage ? current + '%' : (current >= 1000 ? current.toLocaleString('ar-SA') : current);
      if (progress < 1) requestAnimationFrame(updateCounter);
      else element.textContent = isPercentage ? target + '%' : (target >= 1000 ? target.toLocaleString('ar-SA') : target);
    }

    requestAnimationFrame(updateCounter);
  }

  var statsSection = document.getElementById('stats');
  if (statsSection) {
    var statsObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && !countersAnimated) {
          countersAnimated = true;
          Array.prototype.forEach.call(statNumbers, animateCounter);
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
