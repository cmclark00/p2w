(function () {
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', String(open));
    });

    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        nav.classList.remove('nav-open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Scroll-reveal: fade and lift content blocks as they enter the viewport
  if (!('IntersectionObserver' in window) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  var revealSelector = [
    '.quick-info article',
    '.category-grid article',
    '.split-section .section-copy',
    '.split-section .image-frame',
    '.split-section .mascot-img',
    '.inventory-band',
    '.section-heading',
    '.gallery-card',
    '.upgrade-card',
    '.review-card',
    '.showcase-band',
    '.contact-panel',
    '.events-cta',
    '.showcase-cta',
    '.repairs-cta',
    '.map-section'
  ].join(',');

  var targets = document.querySelectorAll(revealSelector);
  targets.forEach(function (el, i) {
    el.classList.add('reveal');
    el.style.transitionDelay = Math.min(i * 40, 240) + 'ms';
  });

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

  targets.forEach(function (el) { io.observe(el); });
})();
