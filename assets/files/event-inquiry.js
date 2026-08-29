/* ============================================
   Play2Win Games — Event Inquiry Form
   event-inquiry.js
   ============================================
   Uses the form's action attribute as the Formspree
   destination so HTML remains the single source of truth.
   ============================================ */

function initEventInquiryForm() {
  const form = document.getElementById('ptw-event-form');
  const submitBtn = document.getElementById('ptw-event-submit');
  const successEl = document.getElementById('ptw-event-success');
  const errorEl = document.getElementById('ptw-event-error');
  const errorBody = document.getElementById('ptw-event-error-body');

  if (!form || !submitBtn) return;

  form.querySelectorAll('.ptw-upgrade-check input[type="checkbox"]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      checkbox.closest('.ptw-upgrade-check')?.classList.toggle('checked', checkbox.checked);
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    successEl.style.display = 'none';
    errorEl.style.display = 'none';

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';
    form.setAttribute('aria-busy', 'true');

    try {
      const response = await fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { Accept: 'application/json' }
      });

      if (!response.ok) {
        let message = 'Please try again or call the shop at (865) 910-8357.';
        try {
          const data = await response.json();
          if (data.errors && data.errors.length) {
            message = data.errors.map((err) => err.message).join(' ');
          }
        } catch (_) {}
        throw new Error(message);
      }

      form.reset();
      successEl.style.display = 'block';
      successEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
      errorBody.textContent = error.message || 'Please try again or call the shop at (865) 910-8357.';
      errorEl.style.display = 'block';
      errorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } finally {
      form.removeAttribute('aria-busy');
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });
}

document.addEventListener('DOMContentLoaded', initEventInquiryForm);
