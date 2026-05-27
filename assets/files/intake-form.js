/* ============================================
   Play 2 Win Games — Handheld Upgrades Form
   intake-form.js
   ============================================
   Configuration:
     Set FORMSPREE_ENDPOINT below to your
     Formspree form URL after signing up at
     https://formspree.io
   ============================================ */

const FORMSPREE_ENDPOINT = 'https://formspree.io/f/xaqvrbjn';

/* ------ Device & upgrade data ------ */

const DEVICES = [
  {
    id: 'gbc',
    label: 'Game Boy / GBC',
    colors: ['Gray', 'Purple', 'Teal', 'Atomic', 'Kiwi', 'Clear', 'Other'],
    groups: [
      { title: 'Display',  upgrades: ['IPS backlight screen', 'Screen lens replacement'] },
      { title: 'Power',    upgrades: ['USB-C charging upgrade', 'New battery', 'Capacitor replacement'] },
      { title: 'Cosmetic', upgrades: ['Shell replacement', 'Button & pad replacement'] },
      { title: 'Audio',    upgrades: ['Speaker replacement', 'Amplifier (CleanAmp) install'] }
    ]
  },
  {
    id: 'gba',
    label: 'GBA',
    colors: ['Indigo', 'Black', 'Glacier', 'Spice Orange', 'Arctic', 'Other'],
    groups: [
      { title: 'Display',  upgrades: ['IPS screen upgrade', 'Screen lens replacement', 'Brightness control upgrade'] },
      { title: 'Power',    upgrades: ['New battery', 'USB-C charging upgrade'] },
      { title: 'Cosmetic', upgrades: ['Shell replacement', 'Button & pad replacement'] },
      { title: 'Audio',    upgrades: ['Speaker replacement'] }
    ]
  },
  {
    id: 'gbasp',
    label: 'GBA SP',
    colors: ['Cobalt Blue', 'Pearl Pink', 'Onyx', 'Flame', 'Platinum', 'Pearl Green', 'Other'],
    groups: [
      { title: 'Display',  upgrades: ['IPS screen (AGS-001)', 'IPS screen (AGS-101)', 'Screen lens replacement'] },
      { title: 'Power',    upgrades: ['USB-C charging upgrade', 'New battery', 'Charge port repair'] },
      { title: 'Cosmetic', upgrades: ['Shell replacement', 'Button & pad replacement', 'Hinge repair'] },
      { title: 'Audio',    upgrades: ['Speaker replacement', 'Headphone jack upgrade (AGS-101)'] }
    ]
  },
  {
    id: 'gbm',
    label: 'GBM / Micro',
    colors: ['Silver', 'Black', 'Famicom edition', 'Other'],
    groups: [
      { title: 'Display',  upgrades: ['IPS screen upgrade', 'Screen lens replacement'] },
      { title: 'Power',    upgrades: ['USB-C charging upgrade', 'New battery'] },
      { title: 'Cosmetic', upgrades: ['Faceplate replacement'] }
    ]
  },
  {
    id: 'ds',
    label: 'DS Lite',
    colors: ['White', 'Black', 'Cobalt/Black', 'Crimson/Black', 'Polar White', 'Other'],
    groups: [
      { title: 'Display',  upgrades: ['IPS top screen', 'IPS bottom screen', 'Both screens — IPS'] },
      { title: 'Power',    upgrades: ['New battery', 'USB-C charging upgrade'] },
      { title: 'Cosmetic', upgrades: ['Shell replacement', 'Button replacement', 'Hinge repair'] },
      { title: 'Audio',    upgrades: ['Speaker replacement'] }
    ]
  },
  {
    id: 'dsi',
    label: 'DSi / DSi XL',
    colors: ['White', 'Black', 'Blue', 'Red', 'Pink', 'Yellow', 'Other'],
    groups: [
      { title: 'Display',  upgrades: ['IPS top screen', 'IPS bottom screen', 'Both screens — IPS'] },
      { title: 'Power',    upgrades: ['New battery', 'USB-C charging upgrade'] },
      { title: 'Cosmetic', upgrades: ['Shell replacement', 'Button replacement'] }
    ]
  },
  {
    id: 'psp',
    label: 'PSP',
    colors: ['Black', 'White', 'Blue', 'Red', 'Silver', 'Piano Black', 'Other'],
    groups: [
      { title: 'Display',  upgrades: ['LCD screen replacement', 'Screen lens replacement'] },
      { title: 'Drive',    upgrades: ['UMD drive replacement', 'UMD drive cleaning'] },
      { title: 'Power',    upgrades: ['USB-C charging upgrade', 'Battery replacement'] },
      { title: 'Cosmetic', upgrades: ['Shell/faceplate replacement', 'Analog stick replacement', 'Button replacement'] },
      { title: 'Software', upgrades: ['CFW / HEN install'] }
    ]
  },
  {
    id: 'vita',
    label: 'PS Vita',
    colors: ['Black', 'White', 'Aqua Blue', 'Light Pink', 'Other'],
    groups: [
      { title: 'Display',  upgrades: ['OLED screen replacement (1000)', 'LCD screen replacement (2000/Slim)'] },
      { title: 'Controls', upgrades: ['Analog stick replacement', 'Trigger button repair'] },
      { title: 'Power',    upgrades: ['Battery replacement'] },
      { title: 'Software', upgrades: ['HENkaku / CFW setup'] }
    ]
  }
];

/* ------ Build the form UI ------ */

function buildForm() {
  buildDeviceTabs();
  buildUpgradePanels();
}

function buildDeviceTabs() {
  const tabsEl    = document.getElementById('ptw-device-tabs');
  const panelsEl  = document.getElementById('ptw-upgrades-panels');
  const colorWrap = document.getElementById('ptw-color-wrap');
  const colorRow  = document.getElementById('ptw-color-row');

  if (!tabsEl || !panelsEl) return;

  DEVICES.forEach(dev => {
    /* Tab button */
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ptw-device-tab';
    btn.textContent = dev.label;
    btn.dataset.deviceId = dev.id;
    btn.addEventListener('click', () => selectDevice(dev, btn));
    tabsEl.appendChild(btn);
  });
}

function buildUpgradePanels() {
  const panelsEl = document.getElementById('ptw-upgrades-panels');
  if (!panelsEl) return;

  DEVICES.forEach(dev => {
    const panel = document.createElement('div');
    panel.id = 'ptw-panel-' + dev.id;
    panel.className = 'ptw-upgrades-panel';

    dev.groups.forEach(grp => {
      const groupEl = document.createElement('div');
      groupEl.className = 'ptw-upgrade-group';

      const titleEl = document.createElement('div');
      titleEl.className = 'ptw-upgrade-group-title';
      titleEl.textContent = grp.title;
      groupEl.appendChild(titleEl);

      const grid = document.createElement('div');
      grid.className = 'ptw-upgrade-checks';

      grp.upgrades.forEach(upgrade => {
        const lbl = document.createElement('label');
        lbl.className = 'ptw-upgrade-check';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.name = 'upgrades';
        cb.value = dev.label + ' — ' + upgrade;
        cb.addEventListener('change', () => lbl.classList.toggle('checked', cb.checked));

        const span = document.createElement('span');
        span.textContent = upgrade;

        lbl.appendChild(cb);
        lbl.appendChild(span);
        grid.appendChild(lbl);
      });

      groupEl.appendChild(grid);
      panel.appendChild(groupEl);
    });

    panelsEl.appendChild(panel);
  });
}

function selectDevice(dev, btn) {
  /* Tabs */
  document.querySelectorAll('.ptw-device-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  /* Hidden device field */
  const deviceField = document.getElementById('ptw-device-value');
  if (deviceField) deviceField.value = dev.label;

  /* Panels */
  document.querySelectorAll('.ptw-upgrades-panel').forEach(p => p.classList.remove('visible'));
  const panel = document.getElementById('ptw-panel-' + dev.id);
  if (panel) panel.classList.add('visible');

  /* Color picker */
  const colorWrap = document.getElementById('ptw-color-wrap');
  const colorRow  = document.getElementById('ptw-color-row');
  if (colorWrap && colorRow) {
    colorWrap.classList.remove('hidden');
    colorRow.innerHTML = '';
    dev.colors.forEach(color => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ptw-color-btn';
      b.textContent = color;
      b.addEventListener('click', () => {
        colorRow.querySelectorAll('.ptw-color-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        const colorField = document.getElementById('ptw-color-value');
        if (colorField) colorField.value = color;
      });
      colorRow.appendChild(b);
    });
  }
}

/* ------ Condition buttons ------ */

function initConditionBtns() {
  document.querySelectorAll('.ptw-condition-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ptw-condition-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const field = document.getElementById('ptw-condition-value');
      if (field) field.value = btn.dataset.condition;
    });
  });
}

/* ------ Form submission ------ */

async function handleSubmit(e) {
  e.preventDefault();

  const authCheck = document.getElementById('ptw-auth-check');
  if (!authCheck || !authCheck.checked) {
    showError('Please check the authorization box before submitting.');
    return;
  }

  const submitBtn = document.getElementById('ptw-submit-btn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';
  }

  hideMessages();

  /* Collect checked upgrades */
  const checkedUpgrades = Array.from(
    document.querySelectorAll('.ptw-upgrade-check input[type="checkbox"]:checked')
  ).map(cb => cb.value);

  /* Build form data */
  const form = document.getElementById('ptw-intake-form');
  const data = new FormData(form);

  /* Replace the raw checkbox entries with a clean comma-separated list */
  data.delete('upgrades');
  data.append('upgrades', checkedUpgrades.length ? checkedUpgrades.join(', ') : 'None selected');

  try {
    const res = await fetch(FORMSPREE_ENDPOINT, {
      method: 'POST',
      body: data,
      headers: { Accept: 'application/json' }
    });

    if (res.ok) {
      form.reset();
      document.querySelectorAll('.ptw-device-tab, .ptw-condition-btn, .ptw-color-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.ptw-upgrades-panel').forEach(p => p.classList.remove('visible'));
      document.querySelectorAll('.ptw-upgrade-check').forEach(l => l.classList.remove('checked'));
      document.getElementById('ptw-color-wrap')?.classList.add('hidden');
      showSuccess();
    } else {
      const json = await res.json().catch(() => ({}));
      const msg = json?.errors?.map(e => e.message).join(', ') || 'Something went wrong. Please try again or call us.';
      showError(msg);
    }
  } catch {
    showError('Could not send the form. Please check your connection and try again.');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit intake form';
    }
  }
}

function showSuccess() {
  const el = document.getElementById('ptw-success');
  if (el) { el.style.display = 'block'; el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
}

function showError(msg) {
  const el = document.getElementById('ptw-error');
  if (el) {
    el.style.display = 'block';
    const body = el.querySelector('.ptw-error-body');
    if (body) body.textContent = msg;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function hideMessages() {
  ['ptw-success', 'ptw-error'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

/* ------ Init ------ */

document.addEventListener('DOMContentLoaded', () => {
  buildForm();
  initConditionBtns();

  const form = document.getElementById('ptw-intake-form');
  if (form) form.addEventListener('submit', handleSubmit);
});
