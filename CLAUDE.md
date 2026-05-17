# Play2Win Games — Website

Static HTML/CSS/vanilla-JS site for Play2Win Games, a retro video game & TCG shop
in Knoxville, TN. No build step, no framework, no bundler — edit files directly.

## Hosting & deploy

- **Currently:** GitHub Pages at `https://cmclark00.github.io/p2w/`, deployed by
  `.github/workflows/deploy.yml` (Pages source must be set to "GitHub Actions").
  It triggers on push to `main`, after the events-sync workflow completes
  (`workflow_run`), and manually.
- **Migrating to:** GoDaddy hosting at **play2wingames.com**.
  ⚠️ **At cutover**, find/replace `https://cmclark00.github.io/p2w/` →
  `https://play2wingames.com/` across: canonical tags, `og:url`, `og:image`,
  `sitemap.xml`, `robots.txt`, JSON-LD `url`/`image`, and the privacy effective
  date. One pass, all pages.

## Pages

| File | Purpose |
|---|---|
| `index.html` | Home. Has `GameStore` JSON-LD. |
| `about.html` | About the shop; links to team page. |
| `sell-trade.html` | Buy/sell/trade info **+ merged showcase galleries** (Video Games / TCG / Toys-to-Life) with lightbox. |
| `events.html` | Event calendar — JS-rendered from `events.json`, next **7 days** only, game filter tabs, injects `Event` JSON-LD. Host-an-event CTA. |
| `event-inquiry.html` | Event-hosting inquiry form → Formspree `xjglnaew` (inline form). |
| `repairs.html` | Repair services, ballpark pricing, 3-step process ($30 non-refundable diagnosis fee that applies to final cost), "Meet your repair techs". |
| `mods.html` | Handheld upgrade before/after showcase; CTA → upgrade-request. |
| `upgrade-request.html` | Handheld upgrade intake form. Uses `assets/files/intake-form.css` + `intake-form.js` (Formspree `xaqvrbjn`). |
| `team.html` | Owners + managers. Names filled; **bios & photos still placeholders.** |
| `faq.html` | 2-column accordion FAQ + `FAQPage` JSON-LD. |
| `contact.html` | Store info (phone, email, Facebook, Discord), hours, **click-to-load** Google Map. |
| `privacy.html` | Privacy policy (GDPR/CCPA-style). `.legal` styling. |
| `showcase.html` | Redirect → `sell-trade.html#showcase` (kept for old links). |
| `404.html` | Custom retro NES/Zelda easter-egg page. **Do not modify** (owner request). Uses Google's "Press Start 2P" font (the only remaining Google Fonts call). |

## Events (Google Calendar → events.json)

To add/edit an event, **create/edit it in the shop's Google Calendar** — do not
hand-edit `events.json`.

- `.github/workflows/sync-events.yml`: nightly cron (`0 6 * * *` UTC) + manual
  dispatch. Runs `.github/scripts/sync_events.py`, which reads Google Calendar
  (GitHub secrets `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_CALENDAR_ID`) and writes
  `events.json`, committing with `[skip ci]`. `deploy.yml` redeploys after it via
  `workflow_run` (the `[skip ci]` would otherwise skip a push-triggered deploy).
- See `sync_events.py` for the Calendar→JSON field mapping (don't assume it).
- `events.json` record shape consumed by `events.html`:

```js
{ id, title, game, gameLabel, date:"YYYY-MM-DD", time:"H:MM AM/PM",
  time24:"HH:MM", entry:"$X.XX"|"Free"|"TBA", format, capacity, registered,
  registerUrl, recurring, description }
```

`game` ∈ pokemon | magic | yugioh | lorcana | digimon | gundam | riftbound | other.

## Konami easter egg (BULKY-TRIS)

- `konami.js` loaded (deferred) on all standard pages. Code
  `↑ ↑ ↓ ↓ ← → ← → B A` opens a Tetris modal.
- Global leaderboard via **Firebase Firestore** (config in `konami.js`, project
  `p2w-leaderboard`). Firestore security rules are locked to a strict schema
  (read all; create-only with validated fields; no update/delete) — **keep them
  that way.** Profanity blocklist is the `BLOCKED` set in `konami.js`.

## Forms

Both via **Formspree** (endpoints are public client-side by design):
- Upgrade request: `assets/files/intake-form.js` →
  `FORMSPREE_ENDPOINT = formspree.io/f/xaqvrbjn`.
- Event inquiry: inline form in `event-inquiry.html` →
  `formspree.io/f/xjglnaew`.
- Form styling: `assets/files/intake-form.css` (dark theme, scoped to
  `.ptw-form-page` / `.ptw-form-card`).

## CSS / assets

- Single `styles.css`. Design tokens + `--page-x` (gutter that also centers
  content at ~1500px) in `:root`.
- **Self-hosted fonts** — variable woff2 in `assets/fonts/`
  (`inter-latin`, `inter-latin-ext`, `spacegrotesk-latin`, `spacegrotesk-latin-ext`);
  `@font-face` block at top of `styles.css`. No Google Fonts requests anywhere
  except `404.html`.
- `nav.js`: mobile nav toggle + IntersectionObserver scroll-reveal.
- Accessibility: skip links, `main#main`, visible `:focus-visible` rings.
- SEO: canonical tags, OG tags + `assets/og-image.jpg` share card, `sitemap.xml`,
  `robots.txt`, JSON-LD (GameStore/FAQPage/Event).

## Pending content (placeholders, marked with HTML comments)

- `assets/team/*.jpg` photos + manager/owner bios on `team.html`.
- `assets/repair-techs.jpg` + Keith Stevens' bio on `repairs.html`.
- About-page copy rewrite (owner direction needed).
- **All `mods/` + `showcase/` photos were deleted** (being re-shot; saved
  ~50 MB). Every card on `mods.html` and `sell-trade.html` now shows the
  standard placeholder, with the original `<img>` preserved in an HTML
  comment right below it. To restore: drop the new photo into
  `assets/mods/` or `assets/showcase/`, delete that card's
  `.mod-placeholder` / `.showcase-photo-placeholder` div, and uncomment
  the `<img>`. **Optimize the new shots first: resize ≤1600px long edge,
  ~q82.** (Includes the never-shot `ttl-collection.jpg` +
  `ttl-animal-crossing.jpg` on `sell-trade.html`.)

## Notes

- `WEBSITE-AGREEMENT.md` is **git-ignored** (private handoff/portfolio agreement
  between Corey Clark and owners Mark Spears & Josiah Miller) — never commit it.
- Contact: 865-910-8357 · admin@play2wingames.com ·
  facebook.com/P2WGames · discord.gg/m44gYFFSd8 (Discord is a non-vanity but
  never-expire invite).
- TCG inventory is external: https://playtowingames.crystalcommerce.com/
- Parked feature ideas pending vendor answers: surfacing Fulcrum POS video-game
  inventory, and a custom CrystalCommerce TCG search/deckbuilder with bulk
  cart hand-off.
