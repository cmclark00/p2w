# Play2Win Games — Website

Static HTML/CSS/vanilla-JS site for Play2Win Games, a retro video game & TCG shop
in Knoxville, TN. No build step, no framework, no bundler — edit files directly.

> **Team guide:** Non-developer edit instructions for the shop team live in
> [`TEAM-GUIDE.md`](TEAM-GUIDE.md) (common edits, GitHub web-editor walkthrough,
> what to do when something breaks, external-services worksheet, emergency
> contact, "using Claude as a backup dev"). **Keep it in sync** when site
> structure changes meaningfully — e.g., new pricing groups, new pages,
> new external services, hours/pricing conventions changing. Devs work from
> this file (`CLAUDE.md`); the team works from `TEAM-GUIDE.md`.
>
> **Printable version** of the team guide lives at
> [`team-guide-print.html`](team-guide-print.html), built by
> `python3 scripts/build-team-guide-print.py` (needs `pip install markdown`).
> Re-run that script after any substantive `TEAM-GUIDE.md` edit so the
> printable handout stays current.
>
> A second build script, `scripts/build-website-agreement-print.py`,
> regenerates `website-agreement-print.html` from the private
> `WEBSITE-AGREEMENT.md`. **Both source and output are git-ignored —
> never commit either.** The script itself is safe to commit (no
> agreement content embedded). Use when it's time to print a clean
> copy to sign.

## Hosting & deploy

- **Currently:** GitHub Pages at `https://cmclark00.github.io/p2w/`, deployed by
  `.github/workflows/deploy.yml` (Pages source must be set to "GitHub Actions").
  It triggers on push to `main`, after the events-sync workflow completes
  (`workflow_run`), and manually.
- **Migrating to:** GoDaddy hosting at **play2wingames.com**, and the repo
  transfers to the shop's GitHub. See **Migration runbook** below for the
  full step-by-step.

## Migration runbook (Play2Win handoff — do at cutover)

Migration is three independent things people lump together: the **repo**, the
**connected services**, and the **hosting**. Do them in order. Items marked
🔑 can only be done by the account owner (Corey / shop), not from the codebase.

### Phase 1 — Transfer the repo

- 🔑 GitHub → repo **Settings → General → Danger Zone → Transfer ownership**,
  send `cmclark00/p2w` → **`play2wingames/p2w`** (the shop's GitHub at
  https://github.com/play2wingames). Preserves history; GitHub auto-redirects
  the old URL so nothing breaks mid-flight.
- Requires repo-owner role + push access to the destination.
- Actions secrets *do* carry over on transfer, but rotate them anyway under
  the shop's control (Phase 2) — don't rely on inherited secrets.
- `WEBSITE-AGREEMENT.md` is git-ignored, so it does **not** travel with the
  repo (intended — signed copy kept privately, never committed).

### Phase 2 — Move connected services to the shop's accounts

These are independent of GitHub and owned by Corey's accounts today:

| Service | Powers | Action |
|---|---|---|
| Google Calendar + service account | `sync-events.yml` → `events.json` | 🔑 Reissue a service account under the **shop's** Google account, share the shop calendar to it, reset repo secrets `GOOGLE_SERVICE_ACCOUNT_JSON` + `GOOGLE_CALENDAR_ID`. |
| Firebase (`p2w-leaderboard`) | Konami leaderboard | 🔑 Add shop's Google account as Owner on the Firebase project, remove Corey's. Config in `konami.js` is public by design — no code change. Keep the locked Firestore rules. |
| Formspree (`xaqvrbjn`, `xjglnaew`) | Upgrade + event-inquiry forms | 🔑 Recreate both forms under the shop's Formspree account → **new endpoint IDs** → update them in `assets/files/intake-form.js` and `event-inquiry.html`. |
| Domain `play2wingames.com` | — | 🔑 Confirm it's in the shop's GoDaddy account. |

### Phase 3 — Hosting cutover (Pages → GoDaddy)

GoDaddy hosting is **not** GitHub Pages, so `deploy.yml` stops being the
deploy path.

- **Decision — how files reach GoDaddy:** no-build static site, so options are
  (a) manual cPanel/File-Manager upload, (b) SFTP, or (c) an FTP-deploy GitHub
  Action on push to `main`. **(c) recommended** — keeps the current
  "push = live" workflow. (Workflow file not yet written; can be staged with
  GoDaddy creds as repo secrets.)
- **URL sweep — one pass, all files.** Replace
  `https://cmclark00.github.io/p2w/` → `https://play2wingames.com/` in: all
  HTML files (canonical, `og:url`, `og:image`, JSON-LD `url`/`image`),
  `sitemap.xml`, `robots.txt`, and the privacy.html effective/updated date.
  As of this writing: **57 occurrences across 13 HTML files + sitemap.xml +
  robots.txt**. ⚠️ **Exclude `.claude/settings.json`** — local tooling
  config, not part of the site, never committed.
- 🔑 DNS/SSL at GoDaddy: point domain at hosting (usually auto-wired when
  domain + hosting are both GoDaddy), enable the free SSL cert, set a
  www↔non-www redirect so only one canonical host is live.
- After verified, turn GitHub Pages off (or keep as a private staging mirror).

### Phase 4 — Verify

`play2wingames.com` loads over HTTPS · submit **both** forms and confirm they
hit the shop inbox · leaderboard reads + writes · let the events cron run once
and confirm `events.json` updates · re-run Lighthouse + Google Rich Results on
the new URLs.

### Cutover branch (pre-staged — **keep in parity with `main`**)

A `cutover` branch exists on origin (`origin/cutover`) with the
cutover-day state already prepared:

- **URL sweep applied** — `https://cmclark00.github.io/p2w/` →
  `https://play2wingames.com/` across all HTML, `sitemap.xml`,
  `robots.txt` (77 occurrences as of branch creation).
- **`.github/workflows/deploy.yml` replaced** — Pages workflow swapped
  for an FTP-deploy (`SamKirkland/FTP-Deploy-Action`) targeting GoDaddy
  `public_html/`. Requires three repo secrets to be set on cutover
  day: `GODADDY_FTP_HOST`, `GODADDY_FTP_USER`, `GODADDY_FTP_PASSWORD`.
- **Cutover-day flip:** set the three secrets → merge `cutover` → `main`
  → next push deploys to GoDaddy.

⚠️ **PARITY RULE:** every non-trivial change on `main` must be
reflected on `cutover`, or cutover-day will require last-minute
firefighting. After landing work on `main`, run:

```sh
git checkout cutover
git rebase main          # replays the sweep + workflow on top of new commits
# (If new HTML files were added: rerun the URL sweep against them.)
git push --force-with-lease origin cutover
git checkout main
```

The URL sweep is idempotent so re-running it on a freshly-rebased
branch is safe.

## Pages

| File | Purpose |
|---|---|
| `index.html` | Home. Has `GameStore` JSON-LD. |
| `about.html` | About the shop; links to team page. |
| `sell-trade.html` | Buy/sell/trade info **+ merged showcase galleries** (Video Games / TCG / Toys-to-Life) with lightbox. |
| `events.html` | Event calendar — JS-rendered from `events.json`, next **7 days** only, game filter tabs, injects `Event` JSON-LD. Host-an-event CTA. |
| `event-inquiry.html` | Event-hosting inquiry form → Formspree `xjglnaew` (inline form). |
| `repairs.html` | Repair services, ballpark pricing across multiple service groups (Controller Sticks, HDMI Port, Charging Port, Battery, Deep Clean, Thermal Service, PS2 Optical, Disc Resurfacing), 3-step process ($30 non-refundable diagnosis fee that applies to final cost), "Meet your repair techs" (bio pending), Google review prompt at bottom. |
| `mods.html` | Handheld upgrade before/after showcase **+ Upgrade Pricing section** (GB family / GBA SP / DS Lite / add-ons); CTA → upgrade-request. |
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
- **iOS safe-area:** every page except `404.html` has
  `viewport-fit=cover`. `--page-x` folds `env(safe-area-inset-left/right)`
  into its `max()`; header (base + mobile) and footer (base + mobile) carry
  `env(safe-area-inset-*)` top/side/bottom insets. All additive via
  `calc()`/`max()` so `env()` = `0px` off-iPhone → byte-identical layout
  elsewhere. **Don't strip the `env()`** — it's the notch/home-bar fix; the
  full-bleed `.showcase-band` re-pads with the same `--page-x` so it stays
  self-consistent.
- **Cross-browser (verified safe — don't "fix" these):** `events.html`
  builds dates with the ISO `T` separator (`dateStr + "T00:00:00"`), which
  is Safari/Firefox-safe — never change to space-separated. Scroll-reveal is
  progressive enhancement: `nav.js` *adds* the `.reveal` (opacity:0) class
  and early-returns if `IntersectionObserver`/reduced-motion — so JS-off or
  old browsers show content. Don't put `.reveal` in the HTML.
  Perplexity Comet / Arc / Dia are Chromium — nothing engine-specific.
- **Hero image:** `index.html` uses `<picture>` with
  `assets/store-collage.{avif,webp,jpg}` + a preload of the `.webp`. If you
  ever swap the hero, re-export all three formats (≤1600px long edge,
  AVIF q70, WebP q82) and keep filenames in lockstep.
- **Form spam:** both Formspree forms have a hidden `_gotcha` honeypot
  input (Formspree's documented anti-bot field). Don't remove it.
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
- **Pricing formula** (applies to both `repairs.html` and `mods.html` pricing
  rows): **labor is $60/hr, parts are billed at our cost + 20%**. Disclosed
  publicly in the `.pricing-disclaimer` block on `repairs.html`. New pricing
  rows must follow this formula so quotes and the page agree. (Deep-clean has
  a documented exception — liquid-metal service uses the *non-bundled* $60
  clean rate, not the $30 bundled rate, by owner choice.)
- **Google review CTA** points to `https://g.page/r/CSxEUPh9daG2EAE/review`
  from 3 places: the home "What people say" section, the `.review-prompt`
  band on `repairs.html`, and the `.review-prompt` band on `sell-trade.html`.
  One URL to update if the GBP ever migrates.
- **Board games are sell-only.** The shop carries a board game selection
  but does **not** buy or take them in trade. Board games appears in
  sell-framed copy (home "What we carry" 5th card, home split-section
  "carries...", home meta/og/JSON-LD descriptions) and must **not** be
  added to `sell-trade.html` (trade-in list) or any "buying, selling,
  trading" framing on other pages.
- **Hero sizing.** All `.page-hero` blocks share `min-height: clamp(460px,
  64vh, 600px)` — same curve as the home `.hero` — so every page reads
  at the same visual weight regardless of content length. Content
  centered via `display: flex; flex-direction: column; justify-content:
  center`. Bare `.button` children get `align-self: flex-start` so they
  don't stretch full-width (events.html bug). Don't lower the min-height
  thinking the shorter pages look "too tall" — they need the floor to
  match the longer pages.
- **Category grid variants.** `.category-grid` is `repeat(4, 1fr)` by
  default; `.category-grid--three` and `.category-grid--five` variants
  exist for pages that need different card counts (home uses `--five`
  for the 5-card "What we carry"; sell-trade uses `--three`). When adding
  cards to a grid, pick or add the variant rather than overriding the
  base.
- Contact: 865-910-8357 · admin@play2wingames.com ·
  facebook.com/P2WGames · discord.gg/m44gYFFSd8 (Discord is a non-vanity but
  never-expire invite).
- TCG inventory is external: https://playtowingames.crystalcommerce.com/
- Parked feature ideas pending vendor answers: surfacing Fulcrum POS video-game
  inventory, and a custom CrystalCommerce TCG search/deckbuilder with bulk
  cart hand-off.
