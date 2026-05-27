/* ============================================
   Play2Win Games — Careers Application Form
   careers.js
   ============================================
   Mirrors the event-inquiry / intake-form pattern:
   intercept submit, POST to Formspree as JSON,
   show inline success/error instead of navigating.
   ============================================ */

const CAREERS_FORMSPREE_ENDPOINT = 'https://formspree.io/f/mvzyvwzb';

function initCareersForm() {
  const form = document.getElementById('ptw-careers-form');
  const submitBtn = document.getElementById('ptw-careers-submit');
  const successEl = document.getElementById('ptw-careers-success');
  const errorEl = document.getElementById('ptw-careers-error');
  const errorBody = document.getElementById('ptw-careers-error-body');

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
      const response = await fetch(CAREERS_FORMSPREE_ENDPOINT, {
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
      form.querySelectorAll('.ptw-upgrade-check.checked').forEach((el) => el.classList.remove('checked'));
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

document.addEventListener('DOMContentLoaded', initCareersForm);
