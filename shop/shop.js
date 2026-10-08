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

  // Online checkout (checkout.php): PayPal's buttons. The server re-checks stock and price when PayPal opens
  // (create) and again before taking the money (capture), and answers { problems } when something changed.
  var pp = document.getElementById('paypal-buttons');
  if (pp && pp.dataset.client) {
    var form = document.querySelector('[data-checkout-form]');
    var box = document.querySelector('[data-checkout-problems]');
    var show = function (problems, reload) {
      box.innerHTML = '<strong>Please check your order:</strong><ul>' + problems.map(function (p) {
        var li = document.createElement('li'); li.textContent = p; return li.outerHTML;
      }).join('') + '</ul>' + (reload ? '<p><a class="button primary" href="/shop/checkout">Review the updated order</a></p>' : '');
      box.hidden = false;
      box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    var details = function () {
      return { name: form.name.value, email: form.email.value, phone: form.phone.value };
    };
    var post = function (url, body) {
      return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json(); });
    };
    var s = document.createElement('script');
    s.src = 'https://www.paypal.com/sdk/js?client-id=' + encodeURIComponent(pp.dataset.client) + '&currency=USD&intent=capture';
    s.onerror = function () { pp.innerHTML = '<p class="kiosk-problems">PayPal didn’t load. Check your connection and refresh the page.</p>'; };
    s.onload = function () {
      pp.innerHTML = '';
      window.paypal.Buttons({
        style: { layout: 'vertical', shape: 'pill', label: 'pay' },
        // Name and email are needed before PayPal opens (the receipt goes to that email).
        onClick: function (data, actions) {
          box.hidden = true;
          if (!form.reportValidity()) return actions.reject();
          return actions.resolve();
        },
        createOrder: function () {
          return post('/shop/checkout/create', details()).then(function (d) {
            if (d.problems) { show(d.problems, d.reload); throw new Error('checkout-problems'); }
            return d.id;
          });
        },
        onApprove: function (data, actions) {
          pp.classList.add('is-busy');
          return post('/shop/checkout/capture', { id: data.orderID }).then(function (d) {
            if (d.redirect) { location.href = d.redirect; return; }
            pp.classList.remove('is-busy');
            if (d.retry && actions.restart) return actions.restart(); // declined: let them pick another way to pay
            show(d.problems || ['Something went wrong. You weren’t charged; please try again.'], d.reload);
          });
        },
        onError: function (err) {
          if (err && String(err.message || err).indexOf('checkout-problems') !== -1) return;
          show(['PayPal ran into a problem. You weren’t charged; please try again.']);
        }
      }).render('#paypal-buttons');
    };
    document.head.appendChild(s);
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
