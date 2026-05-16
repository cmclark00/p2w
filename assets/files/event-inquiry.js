/* ============================================
   Play2Win Games — Event Inquiry Form
   event-inquiry.js
   ============================================
   Uses the same Formspree endpoint pattern as the
   handheld upgrade request form. Replace this URL
   with a dedicated Formspree form if desired.
   ============================================ */

const EVENT_FORMSPREE_ENDPOINT = 'https://formspree.io/f/xaqvrbjn';

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

    try {
      const response = await fetch(EVENT_FORMSPREE_ENDPOINT, {
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
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });
}

document.addEventListener('DOMContentLoaded', initEventInquiryForm);
