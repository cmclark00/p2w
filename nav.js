(function () {
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.nav');
  if (toggle && nav) {
    if (!nav.id) nav.id = 'main-navigation';
    toggle.setAttribute('aria-controls', nav.id);

    function setNavOpen(open, returnFocus) {
      nav.classList.toggle('nav-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
      if (!open && returnFocus) toggle.focus();
    }

    setNavOpen(false, false);

    toggle.addEventListener('click', function () {
      setNavOpen(!nav.classList.contains('nav-open'), false);
    });

    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        setNavOpen(false, false);
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('nav-open')) {
        setNavOpen(false, true);
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
