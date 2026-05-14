# Play to Win Games — Handheld Upgrades Intake Form

A self-contained intake form for handheld mod/upgrade drop-offs.
Covers Game Boy / GBC, GBA, GBA SP, GBM/Micro, DS Lite, DSi/DSi XL, PSP, and PS Vita.

---

## Files

```
ptw-intake-form/
├── index.html            ← standalone page (use this as-is, or embed in your site)
├── assets/
│   ├── intake-form.css   ← all styles
│   └── intake-form.js    ← all logic + device/upgrade data
└── README.md
```

---

## Step 1 — Wire up form submissions (Formspree)

Right now submitted forms go nowhere. To receive them by email:

1. Sign up free at https://formspree.io
2. Create a new form, set the notification email to yours
3. Copy your form endpoint — it looks like:
   `https://formspree.io/f/abcdefgh`
4. Open `assets/intake-form.js` and replace the placeholder at the top:

```js
// Change this:
const FORMSPREE_ENDPOINT = 'https://formspree.io/f/YOUR_FORM_ID';

// To this (your actual endpoint):
const FORMSPREE_ENDPOINT = 'https://formspree.io/f/abcdefgh';
```

That's it — Formspree will email you each submission and has a dashboard to view them.

---

## Step 2 — Adding it to your site

### Option A — Dedicated page (recommended)
Drop the whole `ptw-intake-form/` folder into your site's file structure.
Link to `index.html` from your nav as "Book a Mod" or "Upgrade Request".

### Option B — Embed in an existing page
If your site already has a page you want the form to live on:

1. Copy the contents of `assets/intake-form.css` into your site's stylesheet
   (or keep it as a separate file and add a `<link>` tag).

2. Add this `<script>` tag before `</body>`:
   ```html
   <script src="/path/to/assets/intake-form.js"></script>
   ```

3. Paste the contents of the `<form>` block from `index.html`
   (everything between and including the `<form>` tags) into your page's HTML.

---

## Customization

### Changing colors
All colors are CSS variables at the top of `intake-form.css`:

```css
:root {
  --ptw-accent:       #534AB7;   /* purple — buttons, checkboxes, focus rings */
  --ptw-accent-hover: #443DA0;   /* darker purple on hover */
  --ptw-accent-bg:    #EEEDFE;   /* light purple chip backgrounds */
  --ptw-accent-text:  #3C3489;   /* text on light purple backgrounds */
  ...
}
```

Swap `#534AB7` for whatever your site's primary color is and everything updates automatically.

### Adding or removing devices / upgrades
All device and upgrade data lives in the `DEVICES` array near the top of `assets/intake-form.js`.
Each entry follows this shape:

```js
{
  id: 'gba',                          // unique ID, no spaces
  label: 'GBA',                       // display name on the tab
  colors: ['Indigo', 'Black', ...],   // shell color options
  groups: [
    {
      title: 'Display',
      upgrades: ['IPS screen upgrade', 'Screen lens replacement', ...]
    },
    ...
  ]
}
```

Add, remove, or reorder entries freely — the UI builds itself from this data.

---

## Notes

- No external dependencies — no jQuery, no frameworks, plain HTML/CSS/JS.
- Fully responsive down to ~320px wide.
- The form uses the native Fetch API. All modern browsers support it.
- Formspree's free tier allows 50 submissions/month. Paid plans start at $10/mo for unlimited.
  Alternatives: Netlify Forms, Web3Forms (also free), or your own backend endpoint.
