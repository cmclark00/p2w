// Play2Win shop: small enhancements. Everything works without JavaScript (plain forms and links).
(function () {
  // Filters apply as soon as a menu changes; price boxes still use the Apply button.
  document.querySelectorAll('[data-autosubmit]').forEach(function (select) {
    select.addEventListener('change', function () {
      if (select.name === 'type') {
        var set = select.form.querySelector('[name="set"]'); // a set from another game wouldn't match
        if (set) set.value = '';
      }
      select.form.requestSubmit ? select.form.requestSubmit() : select.form.submit();
    });
  });

  // On phones the filters start folded up so the products come first.
  var filters = document.querySelector('.shop-filters');
  if (filters && window.matchMedia('(max-width: 860px)').matches) filters.open = false;

  // Forms that must only be sent once (kiosk "Add to cart" and "Place order"): a double tap would repeat them.
  document.querySelectorAll('form[data-once]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (form.dataset.sent) { e.preventDefault(); return; }
      form.dataset.sent = '1';
      form.querySelectorAll('button[type="submit"]').forEach(function (b) { b.setAttribute('aria-disabled', 'true'); b.classList.add('is-busy'); });
    });
  });

  // Kiosk: after a quiet spell, ask "Still shopping?", then empty the cart and go back to the start,
  // so the next customer never finds someone else's cart.
  var idle = parseInt(document.body.getAttribute('data-kiosk-idle') || '0', 10);
  if (idle > 0) {
    var prompt = document.body.getAttribute('data-kiosk-prompt') === '1';
    var timer = null;
    var overlay = null;
    var reset = function () { location.href = '/shop/kiosk/reset'; };
    var ask = function () {
      if (!prompt) { reset(); return; }
      var left = 20;
      overlay = document.createElement('div');
      overlay.className = 'kiosk-idle';
      overlay.setAttribute('role', 'alertdialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'kiosk-idle-title');
      overlay.innerHTML = '<div class="kiosk-idle-box"><h2 id="kiosk-idle-title">Still shopping?</h2>'
        + '<p>Your cart will be cleared in <strong class="kiosk-idle-left">' + left + '</strong> seconds.</p>'
        + '<button class="button primary" type="button">I’m still here</button></div>';
      document.body.appendChild(overlay);
      var count = overlay.querySelector('.kiosk-idle-left');
      var button = overlay.querySelector('button');
      button.focus();
      var tick = setInterval(function () {
        left -= 1;
        count.textContent = left;
        if (left <= 0) { clearInterval(tick); reset(); }
      }, 1000);
      button.addEventListener('click', function () {
        clearInterval(tick);
        overlay.remove();
        overlay = null;
        arm();
      });
    };
    var arm = function () {
      clearTimeout(timer);
      timer = setTimeout(ask, idle * 1000);
    };
    ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(function (type) {
      window.addEventListener(type, function () { if (!overlay) arm(); }, { passive: true });
    });
    arm();
  }

  // Empty boxes stay out of the URL (?min=&max=).
  document.querySelectorAll('.shop-filters form, .shop-search').forEach(function (form) {
    form.addEventListener('submit', function () {
      form.querySelectorAll('input, select').forEach(function (field) {
        if (field.name && field.value === '') field.disabled = true;
      });
    });
  });
})();
