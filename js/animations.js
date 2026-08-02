(function () {
  'use strict';

  const fadeElements = document.querySelectorAll('.fade-in');
  const revealObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

  fadeElements.forEach(function (el) { revealObserver.observe(el); });

  const statNumbers = document.querySelectorAll('.stat-card__number[data-target]');
  let countersAnimated = false;

  function animateCounter(element) {
    const target = parseInt(element.getAttribute('data-target'), 10);
    const duration = 2000;
    const startTime = performance.now();
    const isPercentage = element.closest('.stat-card').querySelector('.stat-card__label').textContent.includes('%');

    function updateCounter(currentTime) {
      const progress = Math.min((currentTime - startTime) / duration, 1);
      const current = Math.floor((1 - Math.pow(1 - progress, 3)) * target);
      element.textContent = isPercentage ? current + '%' : (current >= 1000 ? current.toLocaleString('ar-SA') : current);
      if (progress < 1) requestAnimationFrame(updateCounter);
      else element.textContent = isPercentage ? target + '%' : (target >= 1000 ? target.toLocaleString('ar-SA') : target);
    }

    requestAnimationFrame(updateCounter);
  }

  const statsSection = document.getElementById('stats');
  if (statsSection) {
    const statsObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && !countersAnimated) {
          countersAnimated = true;
          statNumbers.forEach(animateCounter);
          statsObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.3 });
    statsObserver.observe(statsSection);
  }

  function staggerChildren(parentSelector, childSelector, delay) {
    document.querySelectorAll(parentSelector).forEach(function (parent) {
      parent.querySelectorAll(childSelector).forEach(function (child, index) {
        child.style.transitionDelay = (index * delay) + 'ms';
      });
    });
  }

  staggerChildren('.features__grid', '.feature-card', 100);
  staggerChildren('.testimonials__grid', '.testimonial-card', 150);
  staggerChildren('.pricing__grid', '.pricing-card', 120);
  staggerChildren('.faq__list', '.faq-item', 80);
})();
