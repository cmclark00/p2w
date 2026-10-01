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

  // Empty boxes stay out of the URL (?min=&max=).
  document.querySelectorAll('.shop-filters form, .shop-search').forEach(function (form) {
    form.addEventListener('submit', function () {
      form.querySelectorAll('input, select').forEach(function (field) {
        if (field.name && field.value === '') field.disabled = true;
      });
    });
  });
})();
