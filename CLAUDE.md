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

- **LIVE on GoDaddy at `https://play2wingames.com` (hosting cutover done
  2026-06-06).** `.github/workflows/deploy.yml` is an `lftp mirror` FTP
  deploy: push to `main` (or the nightly events-sync `workflow_run`, or
  manual dispatch) uploads the site to the GoDaddy docroot. Deploy creds
  are repo secrets `GODADDY_FTP_HOST` (the apex IP `107.180.117.156` —
  `ftp.play2wingames.com` has an A record now but the secret stays on the
  IP), `GODADDY_FTP_USER` (`deploy@play2wingames.com`, a dedicated cPanel
  FTP account chrooted to `public_html`), `GODADDY_FTP_PASSWORD`. The
  mirror target is `./` (login lands in the docroot); `--delete` prunes
  stale files but excludes the host-managed `.well-known/` and `cgi-bin/`.
  See [[ftp-deploy-wrong-docroot]] for the war story (old creds hit a
  different non-serving account).
- **`.htaccess` is tracked in the repo** and deploys like any other file —
  it holds the canonical-host rules (www→apex + force-HTTPS, proxy-aware)
  **and a `Cache-Control: no-cache` header for all `.html`** (revalidate
  every load; ETag/304 keeps unchanged pages cheap). The no-cache rule is
  load-bearing: without it Apache sends no Cache-Control and browsers
  heuristic-cache HTML, which repeatedly served stale inline JS on
  `pairings-admin.html` mid-tournament even through hard refreshes. Edit it
  in the repo, not on the server, or a deploy will overwrite your
  server-side change.
- **Remaining 🔑 handoff items** (don't block the live site): turn off
  GitHub Pages, move Formspree/Calendar/Firebase to shop accounts, transfer
  the repo to `play2wingames/p2w`, set up Google Search Console. See the
  **Migration runbook** below (Phases 1, 2, 5) for the step-by-step.

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
| Firebase (`p2w-leaderboard`) | Konami leaderboard **+ tournament pairings** | 🔑 Add shop's Google account as Owner on the Firebase project, remove Corey's. Config in `konami.js` (and inlined on `pairings.html`/`pairings-admin.html`) is public by design — no code change. Keep the locked `scores` Firestore rules **and** the `pairings` create-only rule (which holds the pairings passphrase — see **Tournament pairings**). |
| Formspree (`xaqvrbjn`, `xjglnaew`, `mvzyvwzb`) | Upgrade, event-inquiry, careers forms | Careers endpoint `mvzyvwzb` was confirmed under the shop's `admin@play2wingames.com` account on Aug. 28, 2026. Verify ownership/routing of the other two endpoints during handoff. Endpoint IDs live in each form's HTML `action` attribute. |
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
  As of this writing: **81 occurrences across 17 HTML files + sitemap.xml +
  robots.txt**. ⚠️ **Exclude `.claude/settings.json`** — local tooling
  config, not part of the site, never committed.
- 🔑 DNS/SSL at GoDaddy: point domain at hosting (usually auto-wired when
  domain + hosting are both GoDaddy), enable the free SSL cert, set a
  www↔non-www redirect so only one canonical host is live.
- After verified, turn GitHub Pages off (or keep as a private staging mirror).
- **Restore the Discord events post footer URL.** In
  `.github/scripts/post_events_to_discord.py`, change the embed footer
  text from `'Updated daily'` back to
  `'Updated daily · Full schedule: play2wingames.com/events'` — the URL
  was stripped pre-cutover because the domain wasn't live; see the
  `TODO @ cutover` comment right above that line.

### Phase 4 — Verify

`play2wingames.com` loads over HTTPS · submit **both** forms and confirm they
hit the shop inbox · leaderboard reads + writes · let the events cron run once
and confirm `events.json` updates · re-run Lighthouse + Google Rich Results on
the new URLs.

### Phase 5 — Google Search Console

Sets up the shop's SEO dashboard. **DNS verification can happen before
cutover** (doesn't need the site live); sitemap submission and structured-
data checks happen after.

**Verify ownership (any time DNS is editable):**

1. 🔑 Sign in to [search.google.com/search-console](https://search.google.com/search-console)
   with the **shop's** Google account (the one tied to
   `admin@play2wingames.com` — not Corey's personal account, so the shop
   keeps access).
2. **Add property → Domain** type → enter `play2wingames.com`. (Domain
   property covers all subdomains/protocols; URL-prefix is narrower.
   Domain is the right choice for a single-domain shop.)
3. Google gives a TXT record like `google-site-verification=abc123…`.
4. 🔑 In **GoDaddy → DNS Management for play2wingames.com**, add:
   - Type: `TXT`, Name/Host: `@`, Value: the verification string, TTL: 1h.
5. Wait 5–15 min for propagation, then click **Verify** in GSC. Leave the
   TXT record in place permanently — that's how Google rechecks.

**Submit the sitemap (after the site is live at the new domain):**

1. In GSC → **Sitemaps** in left sidebar → enter `sitemap.xml`.
2. Google reads `https://play2wingames.com/sitemap.xml` — the cutover
   branch's URL sweep already updated every entry there. Within 24–48h,
   GSC reports discovered/indexed URLs.

**Verify structured data is being picked up (~1–2 weeks after first
submission):**

- **Enhancements** in left sidebar → look for **FAQ**, **Breadcrumbs**,
  and (eventually) **Sitelinks searchbox** sections. These come from the
  JSON-LD already on the pages — they should populate automatically as
  Google crawls. If they're missing after 2 weeks, the markup may have an
  issue (or Google just hasn't picked it up yet — give it more time).
- **URL Inspection** (top search bar) → paste any URL → **Request
  indexing** to nudge Google to crawl sooner.

**Don'ts:**

- Don't verify a personal Google account — must be the shop's account so
  ownership stays with the shop if Corey is unavailable.
- Don't verify the old `cmclark00.github.io/p2w` URL in the shop's GSC.
  If it was ever verified under a personal account in the past, use the
  **Change of address** tool there to point the SEO signal forward.
- Don't confuse `google-site-verification` with `og:url` or
  `canonical` — different things.

### Cutover branch (done — merged & removed 2026-06-06)

The `cutover` branch was merged into `main` at hosting cutover and then
deleted (local + `origin`). Its payload now lives on `main`: the URL sweep
(`cmclark00.github.io/p2w` → `play2wingames.com`), the FTP-deploy workflow,
and the restored Discord footer URL. No parity rule anymore — `main` is the
single source of truth and every push deploys straight to GoDaddy. (The
`SamKirkland/FTP-Deploy-Action` mentioned in older notes was replaced by the
`lftp mirror` deploy described under **Hosting & deploy**.)

## Pages

| File | Purpose |
|---|---|
| `index.html` | Home. Has `GameStore` JSON-LD. |
| `about.html` | About the shop; links to team page. Its **"Meet the mascot" Bulky split-section** carries a `.coin-hunt-teaser` card (cut-out coin + copy) linking to `bulky-coin-hunt.html`. |
| `bulky-coin-hunt.html` | **Bulky's Coin Hunt** — every Saturday Bulky loses a coin within a 5-mile radius of the shop; find it + bring it in = **$50 store credit**. Bad weather = Bulky stays indoors, no coin that week. Floating hero coin, 3 "how it works" cards (reuses `.community-first`/`.cf-rules` styling), and a `.weather-note` rain-check callout. Reached from the about-page teaser; not in primary nav. |
| `sell-trade.html` | Buy/sell/trade info **+ merged showcase galleries** (Video Games / TCG / Toys-to-Life) with lightbox. |
| `bulk-rates.html` | Standalone buylist page — what we pay for English TCG bulk (Pokémon full breakdown, per-1k rates for MTG, YGO, Lorcana, One Piece, Riftbound, Digimon, Gundam, FAB, and **graded slab** bulk rates). Promoted to its own primary nav item. **The rate cards are rendered by an inline script from `assets/bulk-rates.json`**, the single source of truth shared with the trade-in calculator's TCG Bulk tab. Edit rates there, never in this page. Shape: `groups[] → { id, name, note?, items[] → { id, name, price (dollars), per (1000 or 1) } }`. Item `id`s must stay stable (the calculator snapshots them on trade lines). Groups with no items are hidden. On fetch failure it shows a call-us message. |
| `card-conditions.html` | Standalone card condition guide — Near Mint / LP / MP / HP / Damaged with photo reference and criteria for each grade. Reachable from the FAQ ("How do you grade card condition?"). Not in the primary nav. Images live in `assets/conditions/`. |
| `events.html` | Event calendar — JS-rendered from `events.json`, next **7 days** only, game filter tabs, injects `Event` JSON-LD. Host-an-event CTA. |
| `community-first.html` | Community First Release Program — regulars get new core set product at **true MSRP**. The four program rules (one item/person, consistent in-store players, must be present, seal cut at pickup) + "ask staff" footer. Reached from the **header CTA pill** (`.header-cta`) on every standard page. Was originally a section on `events.html`; moved to its own page. |
| `event-inquiry.html` | Event-hosting inquiry form → Formspree `xjglnaew` (inline form). |
| `repairs.html` | Repair services, ballpark pricing across multiple service groups (Controller Sticks, HDMI Port, Charging Port, Battery, Deep Clean, Thermal Service, PS2 Optical, Disc Resurfacing), 3-step process ($30 non-refundable diagnosis fee that applies to final cost), "Meet your repair techs" (Keith + Corey, bios in), Google review prompt at bottom. |
| `upgrades.html` | Handheld upgrade before/after showcase **+ Upgrade Pricing section** (GB family / GBA SP / DS Lite / add-ons) **+ interactive cost estimator** (`.upgrade-calc`, inline JS — ranges mirror the pricing table on the same page); CTA → upgrade-request. (Renamed from `mods.html` — old URL is a redirect file.) |
| `mods.html` | Redirect → `upgrades.html` (kept for old links). |
| `upgrade-request.html` | Handheld upgrade intake form. Uses `assets/files/intake-form.css` + `intake-form.js` (Formspree `xaqvrbjn`). |
| `team.html` | Owners + managers with staff photos and bios. |
| `faq.html` | 2-column accordion FAQ + `FAQPage` JSON-LD. |
| `contact.html` | Store info (phone, email, Facebook, Discord), hours, **click-to-load** Google Map. |
| `careers.html` | Application page for shop hires. Formspree form (endpoint `mvzyvwzb`, owned by the shop's `admin@play2wingames.com` account) + separate "Email your resume" mailto button (Formspree free tier doesn't accept attachments). Linked from every page's footer. Uses `assets/files/intake-form.css` styling. |
| `privacy.html` | Privacy policy (GDPR/CCPA-style). `.legal` styling. |
| `showcase.html` | Redirect → `sell-trade.html#showcase` (kept for old links). |
| `pairings.html` | **Player-facing tournament pairings view** — the fixed URL the table QR code points to. Full standard site chrome (header + CFP pill + nav + footer, `nav.js`/`konami.js`) since customers see it. Reads the newest `pairings` Firestore doc: extracted pairings render as a searchable gold-badged match-card list, else the screenshot big + tap-to-zoom; event name / Round N / "updated X min ago"; auto-refreshes every 25s. ⚠ Its inline Firebase uses a **named app** (`initializeApp(cfg, 'pairings')`) because `konami.js` on the same page lazily initializes the default app — a second default init throws `app/duplicate-app`. Still `noindex`, not in nav, not in sitemap. See **Tournament pairings** below. |
| `pairings-admin.html` | **Hidden staff page** to post pairings. Passphrase + event + round + required Masters/Open screenshot + optional Junior/Senior screenshots (compressed client-side), publishes one new `pairings` Firestore doc. `noindex`, not in nav, not in sitemap. Link kept to staff only. |
| `trade-in/` | **Hidden staff trade-in calculator** (`index.html` + `app.js` + `styles.css` + PHP back end `api.php`). Scan/search games (PriceCharting API) and consoles/controllers (Game Buying Guide prices) → cash + store credit per line, plus a **Floor Pricing** tab for shelf prices. Staff/manager logins. `noindex` (meta + `X-Robots-Tag` in `trade-in/.htaccess`), not in nav, not in sitemap. See **Trade-in calculator** below. |
| `shop/` | **Native storefront (PREVIEW)** for the CrystalCommerce inventory: `/shop`, `/shop/search`, `/shop/category/<type>`, `/shop/product/<id>-<slug>`, routed by the root `.htaccess` to `shop/index.php`. `noindex` and out of the nav until the owners approve (`SHOP_PREVIEW` in `index.php`). Also runs the **in-store kiosks** (`shop/kiosk.php`, `/shop/kiosk/...`). See **Shop (CrystalCommerce)** below. |
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
  time24:"HH:MM", startISO, endISO, entry:"$X.XX"|"Free"|"TBA", format,
  capacity, registered, registerUrl, facebookUrl, recurring, prizing, description }
```

Calendar descriptions may be HTML (Google's web editor wraps lines in
`<br>`/`<div>`); `sync_events.py` flattens that to text before splitting the
`---` metadata block, so both plain-text and rich-text events parse.

`game` ∈ pokemon | magic | yugioh | lorcana | digimon | gundam | riftbound | other.

## Tournament pairings (staff post → player QR view)

Lets staff push the current round's Pokémon (or any TCG) pairings to players via a
QR code on the play tables — no backend, reusing the **same Firebase project** as
the Konami leaderboard (`p2w-leaderboard`).

- **Two pages:** `pairings-admin.html` (hidden staff uploader) and `pairings.html`
  (the QR target players scan). Both are `noindex`, out of the nav, and out of
  `sitemap.xml`. Both load Firebase with the **same dynamic-import pattern and
  public `FIREBASE_CONFIG`** as `konami.js` (config inlined on each page).
  `pairings.html` carries the full standard site chrome (customers see it) and
  therefore loads `konami.js` — its inline Firebase init uses a **named app**
  (`'pairings'`) to avoid `app/duplicate-app` if the easter egg's leaderboard
  loads on the same page. `pairings-admin.html` stays chrome-less (internal
  staff tool, default app name is fine there — no `konami.js`).
- **Storage:** a new Firestore collection **`pairings`**. Each publish is **one new
  doc** — nothing is ever updated or deleted, matching the existing "read all;
  create-only; no update/delete" rule philosophy. The player page reads the newest
  doc (`orderBy('ts','desc'), limit(1)`). Doc shape:

  ```js
  { event:"Friday Night Pokémon", round:3, img:"data:image/webp;base64,…",
    pairs:[{table:1, p1:"Alice Smith", p2:"Bob Jones"}, …],
    pubkey:"<passphrase>", ts: serverTimestamp() }
  ```

  `img` remains a string for Firestore-rule compatibility. A normal one-photo
  publish stores the legacy data URL directly. When Junior or Senior photos are
  included, `img` stores a compact JSON string shaped like
  `{v:1, main:"data:image/…", junior:"data:image/…", senior:"data:image/…"}`.
  The player page accepts both forms, so all older documents still render.

  The rule *as documented* below doesn't restrict the doc to specific fields,
  so `pairs` should need no rule change — but the **live console rule may be
  stricter than this doc** (e.g. a `hasOnly([...])` field allowlist someone
  added when first wiring this up), in which case the extra `pairs` field
  makes the whole `allow create` fail and Firestore returns a generic
  `permission-denied` — which reads to staff as "wrong passphrase" even
  though it isn't. `pairings-admin.html`'s publish handler defends against
  this: it tries the doc **with** `pairs` first, and if that's specifically
  denied, silently retries **without** `pairs` (photo-only) so staff are
  never blocked from publishing — the status message says "photo only...
  ask a dev" in that case. **The permanent fix is a 🔑 console change**: open
  Firebase Console → `p2w-leaderboard` → Firestore → Rules, find the
  `pairings` match block, and make sure `pairs` isn't excluded by any
  `hasOnly()`/field-count check (add it to the allowlist if one exists).

- **Auto-extracted pairings table (OCR).** `pairings-admin.html` runs
  **Tesseract.js** (loaded on demand from jsDelivr as an ESM module, same
  dynamic-`import()` pattern as Firebase — no bundler, no npm dependency) on
  the selected photo, on a **separate, higher-res canvas** from the
  Firestore-bound compressed copy (OCR accuracy degrades badly on the heavily
  compressed publish image). The worker is set to **PSM 11 (sparse text)** —
  Tesseract's default `AUTO` layout analysis was silently dropping ~2/3 of a
  real bordered-table export's rows (misclassifying them during its own
  page-segmentation before recognition even ran, not a bug in our merging
  logic — confirmed via the console diagnostics below). Sparse mode just
  finds every text blob without trying to be clever about columns/tables,
  which is fine since we do our own row reconstruction from bboxes.
  Recognition also requests bounding boxes (`worker.recognize(canvas, {}, {
  blocks: true })`); `reconstructRows`
  rebuilds each table row by **merging Tesseract's own per-cell Line objects
  across columns using vertical bbox overlap** (forgiving of cross-column
  baseline/padding jitter — an earlier version clustered on exact word
  centers, which fragmented rows across columns instead of helping), then
  joins them left-to-right by x-position. Gridlines in bordered "Table |
  Name | Opponent" style exports otherwise make Tesseract split/merge cells
  inconsistently row to row and silently drop most rows. Falls back to plain
  `data.text` line-splitting if no lines come back. `runOcr` also
  `console.log`s the reconstructed lines and parsed rows — check DevTools
  console first when tuning this further, rather than guessing blind
  (bbox-clustering heuristics are hard to get right without seeing the
  actual OCR geometry for the image at hand).
  `parsePairingLines` is a **heuristic parser, not a general one** — it splits
  on the "vs"/"v." separator first (the one reliable signal across formats
  seen so far) and keeps the row even with **no leading table number**,
  since real console output showed isolated single/double-digit table
  numbers get dropped by Tesseract on a large fraction of rows even when
  the rest of that same row OCRs fine (short, context-free glyphs are
  exactly what Tesseract struggles with — this isn't fixable by better
  row-reconstruction, since the number was never recognized as text at
  all). A leading table number is pulled off opportunistically if present.
  Lines with no "vs" fall back to the older "table# then two names,
  multi-space-split" heuristic, for formats without an explicit separator
  word (e.g. the Pokémon Play app). **Don't make table-number capture
  mandatory again** — that regressed recall badly (only ~7 of 24 real rows
  survived) versus keeping rows with a blank table number for staff to fill
  in. `cleanCell` only trims OCR junk off cell edges — the "(record) -
  division" parenthetical (e.g. "(1/1/0 (3) - MA)") is **deliberately kept**
  in displayed names (owner wants records + JR/SR/MA labels visible to
  players; an earlier version stripped it and that was reversed by request).
  Missing table numbers get **three recovery passes**, in order:
  (1) `recoverTableNumbers` — a second, targeted OCR pass per missing row:
  the row's table cell (everything left of the name column, located via the
  median x0 of the digit-dropped rows) is cropped from the pass-1 canvas,
  upscaled 2–6×, **contrast-stretched and binarized to pure black/white**
  (thin digit strokes survive much better without anti-aliasing gray;
  near-blank crops skip the threshold), has **gridlines erased**
  (near-full-height black columns / near-full-width black rows are borders,
  never digits — binarization otherwise turns the table's left border into
  a stroke that digits-only OCR reads as a phantom leading "1"; real
  failure: 5 → "15", 3 → "13" on both mirror copies at once, which also
  poisoned the sequence-fill deduction with fake absent values), and is
  re-recognized in digits-only single-line mode (`tessedit_char_whitelist:
  '0123456789'`, PSM 7) — isolated small digits that the page-scale pass
  drops are an easy problem at cell scale. Crop reads are **validated
  against a cap** (half the pair rows, or the page pass's highest table if
  larger): an over-cap read with a leading "1" is salvaged by dropping that
  digit if the remainder lands in range, and otherwise discarded — a wrong
  table number is worse than a blank one. The worker's whitelist/PSM are restored to full-page
  settings afterwards (same worker is reused across photos in a session).
  (2) `mirrorFillTables` — the export lists every pairing twice (sides
  swapped), so a still-blank table number is recovered from its mirror row,
  matched via `nameKey` (parentheticals stripped, case/whitespace
  normalized, since the record text can OCR differently between the two
  rows even when both names read fine). (3) `sequenceFillTables` — a
  no-OCR deterministic backstop: tables run 1..N with each number on
  exactly two mirrored rows, so when exactly one number is **fully absent**
  from every parsed row, the remaining blanks (≤2) can only be that value
  (the classic case: a lone "1" — a single thin stroke — dropped on *both*
  of table 1's rows, which OCR is worst at). Keyed off fully-absent values
  deliberately: a number seen only once (its other copy lost to a
  malformed/unparsed row) must not poison the deduction, because that
  missing copy isn't one of the blank rows and couldn't be filled anyway —
  an earlier version counted all under-represented values and bailed as
  "ambiguous" in exactly that situation. The expected N comes **only from
  the row count** (half the pair rows — each pairing is listed twice),
  never from the highest number seen: a single misread digit (a "7"
  crop-read as "77") would inflate a max-based range and flood `absent`
  with phantom values, vetoing an otherwise-certain fill (this happened
  in a real run). It fills nothing when two+ values are absent or blanks
  exceed one table's two rows (genuinely ambiguous — staff decide).
  `runOcr` logs a build tag (`OCR_BUILD` — bump it on every pipeline
  change; it's how a console paste proves whether the browser is running
  current or cached code), the blank-table count after each recovery stage
  (`table# blanks after …`), the sequence-fill decision with its `absent`
  list, and a compact per-row tables line — so a failing stage or stray
  misread digit can be read straight off a console paste. Parsed rows
  carry `y0/y1/x0` geometry from `reconstructRows` to make the crop pass
  possible; geometry never reaches Firestore (`collectRows` reads only the
  DOM inputs). Lines matching neither pattern are
  silently skipped rather than added as junk rows. Results populate an **editable
  review table** (`#pa-rows-card`) — staff must eyeball/fix names and table
  numbers, delete misreads, or add rows the OCR missed (`+ Add row`) before
  publishing; nothing auto-publishes from OCR alone. `pairs` is sent to
  Firestore as whatever's in that table at publish time (can be an empty
  array if OCR found nothing and staff added nothing — in which case the
  player page just falls back to the photo). **Don't try to make the regex
  parser "smarter" for every possible screenshot layout** — the editable
  table is the correctness backstop by design, so a good-enough heuristic +
  human review beats a fragile do-everything parser.
- **Player page rendering.** `pairings.html` shows a **searchable match-card
  list** (`#pr-table-section` → `div#pr-matches` containing one or more lists) when the newest doc has a
  non-empty `pairs` array, styled in the site's card language (surface card +
  hairline border + 4px gold left edge, like `.event-card`; eyebrow +
  Space Grotesk head; gold "TABLE n" badge per card, dashed placeholder chip
  when a table number is blank). Each player renders as a bold display-type
  name with the "(record - div)" suffix split onto a small muted line
  (display-only split at `' ('` — the stored `p1`/`p2` strings are
  unchanged). When any pairing name ends in a recognized `- JR` or `- SR`
  division marker, the player page automatically groups the full list into
  **Junior**, **Senior**, and **Masters / Open** sections. `- MA` rows go to
  Masters; unmarked rows are kept in Masters / Open so no pairing is lost.
  Events without JR/SR markers retain the original flat list. This is a
  display-only grouping and does not change the Firestore document shape.
  The pill "Find your name" input (`#pr-search`) filters cards
  client-side by substring on `p1`+`p2` **and gold-highlights the matched
  name** (`.pr-hit`) so your own row jumps out of the pair; an empty result
  shows `#pr-nomatch`. The list is only rebuilt when the doc id changes —
  the 25s auto-refresh must not clear a search someone is mid-typing.
  Falls back to the **original image view** (unchanged tap-to-zoom
  `#pr-figure`) when `pairs` is empty/absent, so older docs and any round
  where OCR/staff didn't produce rows still display fine. The source photo
  is never discarded even in card mode — a "View original photo" link
  (`#pr-photo-toggle`) opens the same zoom overlay from `doc.img`.

- **Image handling:** pairings screenshots are stored **inline in the existing
  `img` string** (no Firebase Storage). `pairings-admin.html` downscales to
  ≤1400px and re-encodes WebP→JPEG, stepping quality/size down until all selected
  screenshots share a combined ~800 000-character budget and stay clear of
  Firestore's 1 MB/doc limit. A one-photo publish remains a plain data URL; a
  multi-photo publish uses the JSON-string envelope described above. If the
  screenshots cannot fit, crop them tighter — or, longer term, move to Firebase
  Storage. If a stricter live rule rejects the JSON-string envelope, the admin
  page retries with the legacy Masters/Open photo only and clearly reports that
  the optional division photos were not published, so a round is never blocked.
- **Passphrase / access:** publishing requires a passphrase that lives **only in
  the Firestore security rule** (server-side), never in the page source. The admin
  page sends whatever staff type as the `pubkey` field; a wrong/blank one is
  rejected by the rule (`permission-denied`). It's remembered per-device in
  `localStorage` (`p2w-pair-pass`). This is a soft gate (keeps casual/accidental
  posts out), not real auth — keep the admin URL staff-only.
- **🔑 Firestore rule (Firebase console — not in repo).** Add a `pairings` match
  block *alongside* the `scores` rules (don't touch `scores`). The `pubkey ==`
  check is the passphrase enforcement — set the string here:

  ```
  match /pairings/{id} {
    allow read: if true;
    allow create: if request.resource.data.pubkey == "CHOOSE_A_PASSPHRASE"
      && request.resource.data.img is string
      && request.resource.data.img.size() < 950000
      && request.resource.data.round is number
      && request.resource.data.event is string;
    allow update, delete: if false;
  }
  ```

- **🔑 QR code (one-time):** generate a QR for `https://play2wingames.com/pairings.html`
  with any free generator, print it, place it on the tables. The URL is fixed
  (content updates each round), so the QR never needs reprinting. Point any
  NFC/printed signage at the same URL. (If a shorter URL is wanted later, add a
  `/pairings/` redirect folder mirroring `discord/index.html`.)

## Trade-in calculator (staff tool, `trade-in/`)

The site's **only server-side code**. Everything else is static.

- **Why PHP:** the PriceCharting API token must never reach a browser.
  `api.php` proxies PriceCharting (keeps to its 1 call/sec limit with a
  file lock, caches successful lookups for 30 min) and stores settings and
  prices. GoDaddy cPanel runs it natively; the code avoids PHP 8-only
  syntax so it works on 7.4+.
- **Private data lives OUTSIDE the docroot** in
  `<home>/p2w-trade-in-data/`, next to `public_html`. It holds
  `config.json` (bcrypt password hashes, cookie-signing secret, token,
  Amazon SP-API keys),
  `settings.json`, `hardware.json` (each with a `.bak`), and `cache/`.
  Two reasons, both load-bearing:
  1. The repo is public.
  2. The deploy's `lftp mirror --delete` prunes anything in `public_html`
     that isn't in the repo; the FTP account is chrooted there and can't
     reach the data folder.

  **Never commit tokens or passwords, and never move this data into the
  repo.** Override the location with the `P2W_TRADEIN_DATA` env var (used
  for local testing).
- **Auth:** two roles, **staff** (run trade-ins) and **manager** (also edit
  Hardware Prices, Settings, token, and passwords).
  - The login cookie is HMAC-signed (`payload.sig`, 30 days, HttpOnly,
    Secure on HTTPS, `SameSite=Strict`, path `/trade-in/`). There are no
    PHP sessions, so shared-host session GC can't log staff out.
  - Changing a password bumps `sessionVersion`, which logs out every device.
  - Login and setup are limited to 8 failures per IP per 15 minutes
    (`login-attempts.json`).
  - Writes must be JSON (`415` otherwise), and `Sec-Fetch-Site: cross-site`
    is refused.
- **First-time setup** needs a one-time setup code. Only its SHA-256 is in
  `api.php` (`SETUP_CODE_SHA256`); the code was given to the owner. Setup
  locks itself once `config.json` exists. **To reset everything:** delete
  `p2w-trade-in-data/config.json` in cPanel File Manager, put a new code's
  hash in `SETUP_CODE_SHA256` (SHA-256 of the code, uppercase, no dashes),
  and deploy.
- **`trade-in/.htaccess` must not contain `RewriteEngine`.** A per-directory
  rewrite block stops the root `.htaccess` HTTPS/www rules from applying to
  these URLs. It only sets headers (`noindex` + `no-cache` on html/js/css).
- **Same front end runs offline on the shop PC.** The
  `TradeInCalculator` folder (outside this repo) runs a PowerShell server
  (`server.ps1`) with no logins (`status.auth: false`, role `manager`).
  - It answers the same `api.php?route=…` URLs.
  - The front end uses `../assets/…` paths, which resolve to the site's
    `/assets` online and to the local copy's `/assets` offline.
  - `index.html`, `app.js`, and `styles.css` are byte-identical in both
    places. **Keep them in sync** when editing; this repo is the source of
    truth.
- **Floor Pricing tab** (`#view-floor`, both roles): shelf prices for
  games, per the sheet's **Game Pricing Guide** tab.
  - **Hands-free by design** (owner request). PriceCharting's listed
    sales *are* eBay sold listings, so they stand in for the sheet's
    "eBay highest sold" at every price; there's no eBay step (eBay's
    sold-data API is closed to new users and its sold pages need a
    login as of Aug 2026; Amazon's API needs 10 affiliate sales/30 days,
    so Amazon is links only).
  - **Tiers** (`FLOOR_TIERS`, by PriceCharting console name; PAL/JP
    prefixes ignored): every guide system prices from the sales; modern
    systems (PS4/PS5/Xbox One/Series/Switch/Switch 2, `gamestop: true`,
    `amazon: true`) take the **highest of GameStop's pre-owned price**
    (`gamestop-price` from the API; loaded with `PC.byId` if search
    results lack it), **Amazon's lowest offer** (see **Amazon** below),
    **and the sale** (owner's choice). "Add to list" waits while Amazon
    is still loading so the price can't be added low. Systems not in the guide
    (`FLOOR_OTHER`) price from the sales too, with a "double-check" rule.
  - **Which sale: the 90th percentile** of the condition's normal sales
    (`FLOOR_PCT`, `floorAutoSale()`), not the single highest. Backtested
    on the shop's own Sept 2026 sold list (140 PS2/GameCube games): max
    sale was ~$12 high on average and within $5 only 40% of the time;
    p90 was within $5 65% (within 10% 68%) with no bias. Outlier-skipping
    did worse. **Expensive games use the second-highest normal sale**
    once the p90 sale reaches `FLOOR_HIGH` ($80): the shop prices them
    nearer the top (games priced $60+: 46% → 71% within 10%; all games
    68% → 72%, avg miss $8.05 → $7.76). **Re-run that comparison
    before changing `FLOOR_PCT`/`FLOOR_HIGH`.** Sold data can't explain
    prices above every recent sale (e.g. Conker loose $275 vs NTSC sales
    ≤ $190): those come from current eBay asking prices, which need the
    eBay Browse API (active listings). `floorBasis()` adds "Double-check"
    notes for under `FLOOR_FEW_SALES` sales or a newest sale older than
    `FLOOR_STALE_DAYS`. Staff can click any sale or type a price.
  - **Sales source.** The API has no
    sales data ("historic sales are not supported"), so **`GET
    api.php?route=pc/sales&id=…` reads the sold-listings tables off the
    public page `pricecharting.com/game/<id>`** (`pc_sales()`: parses
    `div.completed-auctions-{used,cib,new}` → date/price/title/eBay url,
    about 30 per condition, cached 6 h in `cache/sales-<id>.json`, shares
    the PriceCharting throttle lock). **Fragile by nature:** if
    PriceCharting changes that markup, the route returns empty lists and
    the tab asks for a typed price; fix the regexes in
    `pc_sales()`. Sales whose title matches `ODD_SALE_RE` (lot, bundle,
    graded, repro, box/manual only…) or looks sealed on a non-New
    condition are shown dimmed and never auto-picked; staff can click any
    sale to use it.
  - **Never below GameStop** (owner's rule, every system): GameStop's
    pre-owned price (`floorGs()`, PriceCharting `gamestop-price`; 0 = not
    carried) is one of the basis options for every tier, and
    `floorPrice()` also holds the final price at GameStop rounded up to
    $5 *after* the missing-manual deduction ("raised to GameStop's $X").
    Typed prices aren't forced up, but show a "Below GameStop's
    pre-owned price" warning.
  - **Price math** (`floorPrice()`): basis → round **up** to the next $5
    (`FLOOR_STEP`, owner's choice) → at least $10 (`FLOOR_MIN`), or $5
    for shitbox games (`autoShitboxReason()`) → minus the guide's
    missing-manual amount (`manualDeduction()`: CIB $10–$20 $0, $25–$50
    $5, $55–$100 $10, $105–$200 $20, $205+ 10% to the nearest $5).
    Prices in the list are editable (`edited` flag).
  - **Saved sessions** (`GET/PUT/DELETE api.php?route=floor-sessions`):
    named lists stored in `p2w-trade-in-data/floor-sessions.json` (one
    file, flock'd; the oldest drop off past `MAX_FLOOR_SESSIONS` = 300).
    The open list is also kept in `localStorage` (`p2w-floor`) so a
    refresh doesn't lose it. Copy list (TSV) and Print list.
  - **Amazon (SP-API).** The shop has a Professional seller account,
    so it uses its own **private SP-API app** (registered in Amazon's
    Solution Provider Portal with only the Pricing + Product Listing
    roles). Keys: LWA **client id, client secret, refresh token**
    (self-authorized), saved by a manager in **Settings → Amazon** via
    `PUT api.php?route=amazon` into `config.json` → `amazon` (blank
    fields keep the saved value; `{clear:true}` removes them; never sent
    back to the browser). No AWS/SigV4 needed (Amazon dropped it in
    2023). `amazon_access_token()` trades them for an hour-long access
    token cached in `amazon-token.json`; `amazon_get()` calls
    `sellingpartnerapi-na.amazon.com` (or the sandbox host when the
    "sandbox keys" box is ticked; sandbox only returns Amazon's canned
    sample data) one call at a time, ≥2.1 s apart (`getItemOffers` is
    0.5 req/s). `GET api.php?route=amazon/offers&upc=…&cond=used|new`:
    Catalog Items `2022-04-01` UPC search → ASIN, then Product Pricing
    `getItemOffers` for that condition → offers (price **including
    shipping**, sub-condition, Prime/FBA), sorted low→high, plus the
    total offer count; cached 6 h as `cache/amz-<upc>-<cond>.json`.
    **Amazon only returns its ~20 lowest offers per condition** (no API
    lists more); the tab shows them all and "N lowest of M". Renewed
    copies are separate ASINs, so they never appear. Loose/CIB compare
    with **Used**, New with **New**. **Loaded automatically for every
    game**, but **only modern systems use it in the price**; older
    systems show it "for reference only" and price from eBay sales
    (owner's choice — retro Amazon listings are third-party asking
    prices, often far above actual sales). The game
    needs a UPC on PriceCharting to match. `GET amazon/test` checks the
    keys (token exchange only). For local testing, `P2W_AMAZON_LWA` /
    `P2W_AMAZON_HOST` env vars point the server at a fake Amazon.
  - **Shop PC offline copy:** `server.ps1` doesn't have the `pc/sales`,
    `amazon/*`, or
    `floor-sessions` routes, so offline the tab shows the PriceCharting
    link instead of sales and can't save sessions. Add the routes there
    if the shop wants them offline.
- **TCG Bulk tab** (`#view-bulk`, both roles): loads
  `../assets/bulk-rates.json` (same file as the public Bulk Rates page).
  Staff type card counts per rate item. Each row pays count × price ÷
  per, rounded to cents. **Add to trade** puts one `source: 'bulk'` line
  on the trade. It carries `bulkItems` (a snapshot of name/group/
  count/price/total, so logged trades keep that day's rates) and
  `bulkTotal`. It pays flat, cash = credit, with no deductions and no
  qty or type editing; custom store credit % and a typed price still
  work. The line's **Edit counts** reopens the tab with its counts, and
  saving replaces that line in place. Draft counts live in `trade.bulk`
  (`{ counts, lineId }`), which New trade and Complete trade reset. The
  breakdown ("2,350 × Pokémon – Commons …") shows on the line, the
  printout and the log (`item.detail`). **The shop PC's offline copy
  also needs `assets/bulk-rates.json`** in its local `assets` folder.
- **Trade log** (`POST`/`GET api.php?route=trades`): "Complete trade" saves
  a JSON record per trade to `p2w-trade-in-data/trades/YYYY-MM.jsonl`.
  - Each file holds one object per line, one file per UTC month.
  - The log is **append-only by design** (no edit or delete route).
  - The server adds `id`, `time` (UTC ISO), and `role`. The client sends
    staff name and customer (**both required**; stored per trade as
    `trade.staff`/`trade.customer` and cleared by `resetTrade()` on New
    trade and after Complete, so they're never carried over from the last
    trade or remembered per device), payout (`cash` / `credit` / `split` with cents),
    totals, per-item snapshot (incl. serials), `idChecked`, and notes.
  - Search is a case-insensitive substring match on the raw JSON line,
    newest first. It returns at most 100 results from the last 36 months.
  - Both roles can read and write it.
  - It holds customer names, so it lives with the other private data. Don't
    add ID numbers or DOBs to it; only an "ID checked" flag is stored.
  - The shop PC's `server.ps1` implements the same two routes with its own
    `data\trades` folder, so the offline log is separate from the website's.
- **Split payouts** are proportional (`splitPayout()`): taking $X of the
  cash total converts the rest at the trade's own credit/cash ratio, so
  mixed categories (games +50%, hardware +20%) stay fair.
- **Editable cash total** (`#totalCash` input, `trade.cashTotal`): staff
  can type a different cash total in the totals bar. It rounds to whole
  dollars. Store credit then scales by the same ratio (items' credit ×
  typed ÷ items' cash). Item prices stay as they are; `tradeTotals()`
  returns the adjusted cash/credit plus `adjustedFrom`. Split payout, the
  Complete dialog, the printout (with a "Totals adjusted from…" note) and
  the trade log (`totals.adjustedFrom`) all use the adjusted totals.
  `trade.cashTotal` stores `base`, the items' cash when it was typed.
  Once the items no longer add up to that (added, removed, repriced),
  `renderTotals()` drops the adjustment with a toast so it can't go
  stale. "↺ auto" resets it, and so does typing the calculated total.
- **Editable line cash** (per item, `line.cashOverride`, cents each):
  every line's Cash column is an input. A typed amount is the **final**
  cash offer for that item (deductions and guide flat prices are already
  behind it). Store credit keeps the line's normal ratio
  (`normalCreditBonusOf()`: exact from the category rule, 0 for flat
  guide prices, Parts and TCG bulk), unless a custom store credit % is
  set. Typing cash on a "don't buy" line buys it at that price, with a
  "Guide says don't buy" badge kept as a reminder. "↺ auto" (or typing
  the calculated number) clears it. It shows a "Cash edited" badge and
  goes in the trade log (`cashEdited`), but not on the customer printout
  (a typed Value isn't printed either). It is separate from the Value
  column's `line.override`, which is the item value *before* the
  percentages and deductions.
- **Custom store credit %** (per item, `line.creditBonus`): its own
  **Custom %** button under the line's store credit (not in the
  "+ Deduction…" menu). It becomes an editable "+N%" chip, starting at
  the line's normal bump (`normalCreditBonus()`: 50 for games, 20 for
  hardware, 0 for Parts). Credit becomes cash × (100 + %)/100, and cash is
  unchanged. `priceLine()` applies it last, after the typed cash and
  `priceBeforeCredit()` (normal pricing and scratch rule). It's skipped
  for not-buying items. It shows
  as a badge, on the printout and in the trade log (`creditBonus` on the
  item). Lines with it don't merge on re-add (`isPlain`). Both roles can
  use it; it's meant for when management approves more credit.
- **Totals round to whole dollars** (`roundTotal()`, `TOTAL_ROUND`).
  `tradeTotals()` returns cash/credit rounded to the nearest $1 (.50 rounds
  up), plus `itemsCash`/`itemsCredit` (the exact item sums). Rounding
  happens on the **trade total only**, by owner choice, so individual
  items keep their cents and cheap items aren't zeroed out. Split payouts
  round both parts too. The rounded totals are what's shown, printed, and
  logged. A "Totals are rounded…" note (`roundingNote()`) goes on the
  printout and in the totals' tooltip. The Settings "Round offers" option
  still rounds each item's offer separately.
- **PriceCharting extras** kept on each line:
  - `sales-volume` (units sold per year) drives the "Slow seller" badge
    (`settings.slowSalesPerYear`, default 50, only on items worth $10+).
  - `gamestop-trade-price` / `gamestop-price` (GameStop's cash trade and
    pre-owned sell price) show on the reference line. PriceCharting uses
    `0` when GameStop doesn't carry an item, so those are hidden.
  - Item names on trade lines link to `pricecharting.com/game/<id>`
    (PriceCharting redirects that to the product page). Hardware lines
    with a PriceCharting product keep the id as `matchedPcId` and link the
    PriceCharting name. Demo items (non-numeric ids) aren't linked.
- **Pricing rules live in `app.js`** as `DEFAULT_SETTINGS` and
  `SEED_HARDWARE` (transcribed from the shop's Game Buying Guide Google
  Sheet). Once a manager saves, the server copy wins. Code defaults only
  seed a fresh install.
  - Games (from the Game Buying Guide): credit = 105% of PriceCharting
    retail buy (`GAME_CREDIT_PCT`), cash = 70% of PriceCharting
    (`GAME_CASH_PCT`, owner's choice over the guide's "70% of store
    credit"). Credit is therefore exactly 50% more than cash, which is
    the public "50% more" copy. (Settings v3: credit 100%, cash ÷ 1.5;
    v4: cash 73.5%.)
  - Pokémon games: credit 75% of market, cash 50% (credit ÷ 1.5).
  - **PriceCharting → hardware matching:** `hardwareMatch()` sends a
    scanned/searched PriceCharting item to a Hardware Prices item with the
    same name (normalized; exact first, then ignoring [bracket]/(paren)
    tags; console name allowed before/after). Loose → Console only, CIB/New
    → Complete, accessories → Working. This is how managers override
    PriceCharting for specific products (e.g. every Joy-Con color).
  - **Hardware CIB / New** (`HW_PC_CONDITIONS`): hardware lines offer
    CIB and New next to the guide conditions, priced from a PriceCharting
    product attached to the line (`matchedPcId`/`matchedFrom`/`prices`)
    through the category rule. Consoles use PriceCharting retail buy at
    100% cash and 120% credit, the same as an unmatched PriceCharting
    console. Scan-matched lines already carry the product. A guide line
    without one opens a **picker** instead (`openPcPicker`), which fills
    the scan box via `pcQuery()` (e.g. "PS4 console") and runs a
    PriceCharting search. Staff pick the exact product. Nothing is
    remembered between lines. Scans still default to the guide condition
    (`hwConditionFor`), so the guide price wins unless staff pick CIB or New.
    **Controller minimums** (`boxedPrice()`, `settings.boxedStepPct`,
    default 10%): for guide **accessories**, CIB pays at least Working +
    10% and New at least that CIB + 10%. PriceCharting is used when higher,
    because PC's buy price for some colors was below the Working price. A
    "CIB/New minimum" badge shows when the minimum wins. Consoles are
    unaffected. Search/picker buttons show the same numbers.
  - **Special-edition Parts** (PriceCharting hardware with no guide row):
    PriceCharting lines typed console/handheld/accessory also offer
    **Parts**. The price is `settings.partsPctOfLoose` (default 15%,
    editable in Settings) of PriceCharting's loose price. It never goes
    below the **regular model's** guide Parts price (`pcPartsPrice()`).
    `regularModel()` finds that model among same-type guide items by word
    overlap, with `SYSTEM_ALIASES` mapping "Playstation 4" → "ps4" and so
    on. Numbers count only from the system name, so "Splatoon 2" can't
    match "Switch 2". A badge shows the % figure and which model set the
    minimum. Like guide Parts: no deductions, and credit = cash.
  - **Third-party controllers** (`THIRD_PARTY` condition): guide
    accessories that are controllers (`takesThirdParty()`, a name regex that
    excludes memory cards, adapters, and existing "3rd Party" rows) get a
    **3rd party** button/condition. It pays `settings.thirdPartyPct`
    (default 20%, editable in Settings) of that controller's guide
    **Working** price, then the normal accessory rule (+20% credit).
    Deductions apply. Premium brands (8BitDo, Hori, Scuf…) are meant to be
    searched on PriceCharting instead, and a badge on the line says so.
  - **Flat-price items** (`settings.flatItems`): steering wheels and the
    like pay a flat **$5** in cash and credit. It applies in any condition
    and ignores deductions. A name matches if it contains a listed phrase
    (`flatItemMatch()` → the first check in `guideCheck()`), for both
    PriceCharting and guide lines. Defaults are Racing/Steering/Speed
    Wheel, Driving Force, Speed Force, Pedals, Flight Stick, and HOTAS.
    Plain "wheel" is left out so "Wheel of Fortune" isn't caught. Matches
    are also typed Accessory by `guessCategory()`. It runs even with the
    game guide switched off, and an empty phrase list turns it off.
    Managers edit the phrases and amount under Settings → Flat-price items.
    A typed price still wins.
  - **New built-in items reach live sites via a button, not automatically.**
    Adding rows to `SEED_HARDWARE` only seeds fresh installs; the Hardware
    tab's "+ N built-in items" button (`missingBuiltIns()`) appends seed
    items whose name isn't on the saved list, for a manager to Save.
  - Hardware: guide cash price, credit +20%. **Parts** is a flat parts
    price: no deductions (`takesDeductions()`) and no credit bump
    (credit = cash, via `isPartsLine()`).
  - **Custom items** (`+ Custom item`): no Value box. Staff type the cash
    offer in the **Cash column** (`line.cashOverride`, same as any line's
    typed cash, but with no "Cash edited" badge or ↺ auto). Credit keeps
    the category's credit ÷ cash ratio (Other = same as cash, Video Game =
    +50%, consoles = +20%). No deductions (`takesDeductions()`), since the
    typed cash is final. `migrateCustomLines()` converts custom lines on a
    saved trade from the old Value-box format (override minus deductions ×
    cash %) so their offer doesn't change.
  - **Hardware matches keep agreed prices:** when `applyHardwareMatches()`
    turns a PriceCharting line into a guide line, it carries over
    `cashOverride` and `creditBonus`.
  - Buying-guide flat rules: dead games, disc-only tiers, shitbox games, the
    ÷5 resurfacing rule, and the $0.25 stack. **Scratches are free at
    $0.50 or less** (`SCRATCH_FREE_MAX`): `priceLine()` prices the line
    without its resurface deductions first, and if that cash offer is
    ≤ $0.50 it uses that price (`scratchWaived`, badge, and the waived
    deduction is left off the receipt). **The guide's "outliers" are exempt
    from that waiver** (`guideCheck()` tags them `outlier: true`): disc-only
    sports $0.10, sports in box $0.25, disc-only under $10 $0.50, disc-only
    $10–$20 $1 always take the guide's ÷5 when resurfacing is ticked
    ($0.02 / $0.05 / $0.10 / $0.20). Without the exemption the waiver
    cancelled ÷5 on every tier but $1. Disc-only over $20 is priced
    normally with the $2/$3 deduction, as the guide says ("use price
    charting").
  - Saved settings carry a `version`. `mergeSettings` migrates older saves
    (v2 → v3 moved game cash from 50% to ÷ 1.5, v3 → v4 moved games to
    credit 105%, v4 → v5 moved game cash from 73.5% to 70%; each only when
    a manager hadn't set custom numbers). Bump `version` and add a migration line when a
    default policy changes, or live saved settings keep the old number.

## Shop (CrystalCommerce) — `shop/`, PREVIEW

Native browsing on play2wingames.com for the CrystalCommerce inventory;
**CrystalCommerce stays the source of truth and handles cart/checkout.**

- **Data source today: CrystalCommerce's Core2 API**
  (`https://core2-api.crystalcommerce.com`). Play2Win is marketplace
  **#1584 "Playtowingames", organization #2020**. `GET
  /api/listings?organization_id=2020&per_page=500&page=N` (listings come
  grouped by store location) and `GET /api/v2/products/{id}` answer
  **without a login**, although the published docs mark Core2 as JWT —
  **verified Oct 2026 against the live storefront** (Jellicent ex: Core2
  `ally_agreement_price` 313 / quantity 9 = storefront $3.13 / 9). If
  CrystalCommerce locks that down, switch the sync to the documented
  classic **Admin API** (`https://playtowingames-admin.crystalcommerce.com/api/v1`,
  headers `X-API-PROXY-SECRET` / `X-API-USERNAME` / `X-API-SCOPES:
  admin:read-inventory`; categories → variants/products per category,
  `activity_logs` for changes). Docs: crystal-service.readme.io
  (`/llms.txt` lists every page). **Neither API has search by name**, so
  the shop searches its own index.
- **`shop/sync.php`** (public URL; only reads public data, one run at a
  time via `sync.lock`, listings re-read at most every 10 min) writes the
  private index to `<home>/p2w-shop-data/` (outside the docroot, like the
  trade-in data; override with `P2W_SHOP_DATA`): `listings.json` (in-stock
  only: quantity − reserved > 0, priced, org 2020), `products.json`
  (photo, set, product-type slug per product — Core2 has **no batch
  product endpoint**, so details are fetched 6 at a time on a time budget
  and cached forever), `index.json` (what pages read), `state.json`.
  `.github/workflows/shop-sync.yml` calls it every 15 min and repeats
  until `missing` is 0. Can also run from cPanel cron: `php
  public_html/shop/sync.php`.
- **`shop/index.php`** renders every page server-side (Google can read
  it; works without JS) with the site's header/footer copied in and
  **`<base href="/">`** so the shared relative links (`assets/…`,
  `about.html`, konami.js) work on `/shop/...` paths — so shop links must
  be root-relative (`/shop/...`) and the skip link uses the full path.
  Search, filters (game & type, set, condition, price), sorting and
  pagination are `shop_query()` in `shop/lib.php`. Game/type comes from
  Core2's product type ("Pokemon Singles" → game Pokemon, kind Singles).
- **Buying:** each product's **Buy on our online store** opens the
  CrystalCommerce storefront search for that exact product name
  (`shop_buy_url()`), where it's listed with its add-to-cart button.
  Core2 ids don't match the storefront's own product/variant ids (Core2
  product 8044547 = storefront product 627069 / variant 7931543), so a
  cart on our site with one-click handoff needs the **classic Admin API**
  (variant ids) **plus a custom CrystalCommerce storefront page** that
  adds items via the storefront's own `/api/v1/cart/line_items` (it needs
  the CC session + CSRF token, so only a page on the CC domain can call
  it). Core2's own carts/checkout need CrystalCommerce-issued app
  credentials and an online payment gateway on the Core2 org (it has
  none: `has_online_payment_gateway: false`).
- **Admin API (classic) — verified Oct 2026 with the shop's proxy
  secret** (`CC_API_PROXY_SECRET` in `<home>/p2w-shop-data/.env`;
  base `https://playtowingames-admin.crystalcommerce.com/api/v1`,
  `X-API-USERNAME: playtowingames`). `shop/admin-check.php` is a
  read-only diagnostic (statuses, counts, field names; no customer data;
  cached 10 min). Findings:
  - Variants give the **storefront variant id** (the cart's id) and
    `product_catalog_id`, which **equals the Core2 product id** — so
    Core2 products map to sellable storefront variants. Products carry
    `catalog_links.en.href` (the storefront product page).
  - Orders/customers readable (`admin:read-orders` /
    `admin:read-customers`); `admin:read-prefs` is refused; the
    `activity_logs` endpoint returned HTTP 500.
  - **Creating an order works** (`POST /orders`, scope
    `admin:read-orders` — `admin:write-orders` is refused). Test order
    **#277127** (Oct 3 2026, Grookey $0.15, owner's customer 202607,
    labelled TEST, to be cancelled) was accepted after learning the
    required shape: `origin` must be one of CC's values — this store's
    orders use **`Direct`** (own online sales), `TcgPlayer`, `Ebay`;
    `customer_attributes: {id}` of an **existing** customer (the API
    can't create customers); `ship_rate_attributes: {method_id}` — the
    store's ship methods are USPS static ids (133 Ground Advantage, 121
    Priority, 114 Priority Flat Rate Envelope, 144 Media Mail, …) and
    **custom method 1 = "In Store" pickup**; `shipping_address_attributes`
    and `billing_address_attributes` are both required and **`address2`
    can't be blank**; `line_items_attributes` must be a JSON **object**
    keyed "0", "1", … (not a list); `status: "Payment Received"` +
    `payment_attributes`. The one-time test script was removed after.
  - **No unpaid orders via the API** (test #2, Oct 3 2026, order
    **#277128**, Beedrill $0.23, TEST, to be cancelled). A create without
    `payment_attributes` is refused ("Payment Attributes is required").
    Any status other than `Payment Received` gets a detail-less 422
    `invalid_resource`: Awaiting Payment, Processing and In Checkout,
    with payment status Pending/pending/Failed/Received, $0 or the full
    amount, or no status. `PUT /orders/{id}` with `{status: "Awaiting
    Payment"}` returns 200 but **silently leaves the status unchanged**,
    and the owner couldn't move it back by hand in CC's admin either, so
    CC doesn't allow going from Payment Received back to Awaiting Payment.
    So kiosk (pay-at-register) orders must be created as `Payment
    Received` and marked unpaid some other way (comments, employee name,
    our own open-orders list).
  - **Emails:** CC sends **nothing when an order is created through the
    API**. It **does** email the order's customer when staff change the
    status in CC's admin: the owner's manual status change on #277128
    sent a "payment received" email right away. So online checkout must
    send its own confirmation at order time, and CC's emails will follow
    staff status changes (e.g. shipped). Kiosk orders should sit under a
    shop-owned CC customer, so those status emails go to the shop.
  - Live orders use these statuses: Shipped, In Checkout, Payment
    Received, Abandoned, Void, Awaiting Payment.
  - `GET /orders/{id}/available_shipping` **works** (it was 503 once).
    It returns live prices for In Store (`method_id` 1, $0) and the USPS
    `service_id`s (142, 143, 144, 133, 121, 114, 119, 128, 132), so
    checkout can quote CC's real rates.
  - Payment: the CC store takes online payments through **PayPal**, so a
    native checkout would use PayPal (REST app keys
    `PAYPAL_{SANDBOX,LIVE}_{CLIENT_ID,SECRET}` in the same `.env`), then
    create the CC order as `Payment Received`. Tax: 9.25% on pickup/TN,
    0% out of state (owner's choice). Shipping: copy CC's options.
- **In-store kiosks — `shop/kiosk.php`, routes `/shop/kiosk/...`
  (built Oct 2026, in TEST mode until the owner switches it).** Two
  kiosks (headless Linux, locked-down Chrome kiosk mode) on the store's
  public IP **162.81.197.116** browse the normal shop pages with a cart;
  every order is **in-store pickup, paid at the register**. Staff ring
  kiosk orders up in **Fulcrum** as "TCG singles" (Fulcrum doesn't track
  TCG stock; that lives only in CrystalCommerce, so the CC order is what
  holds the cards), then complete the order in CC.
  - **Off until `KIOSK_KEY` is set.** A browser becomes a kiosk by
    opening `/shop/kiosk/start?key=KIOSK_KEY` (HMAC-signed `p2w_kiosk`
    cookie, path `/shop`, 400 days; also empties the cart, so it's the
    kiosk's Chrome start page). Without the cookie every kiosk URL is a
    404 and the shop looks as usual. `/shop/kiosk/exit` turns it off.
  - **Kiosk pages:** own header (logo → `/shop`, "Pick up & pay at the
    register" pill, cart button), no site nav/footer links/konami, so
    there's no way off the shop. Product pages get **Add to cart** per
    condition (`kiosk_add_form()` in `index.php`; "Ask at the register"
    when the listing has no CC variant id). Cart = a signed cookie
    (`p2w_kcart`: listing id, qty, confirmed price), 40 lines, 10 per item.
  - **Checkout** (`kiosk_place_order()`): name only. Re-checks every line
    live with `GET /variants/{id}` (stock + price, in parallel); sold-out,
    short, or re-priced lines update the cart and ask the customer to
    review before resubmitting. A one-time form token makes a double tap
    show the same order. **`KIOSK_MODE=test` (default)** stops there and
    records the order on our side only (numbers `T1`, `T2`…; works from any
    IP). **`KIOSK_MODE=live`** only from `KIOSK_IPS`, then `POST /orders`
    with the proven shape: origin Direct, status Payment Received,
    employee name **"KIOSK - NOT PAID"**, NOT PAID comments and payment
    description, In Store method 1, customer **`KIOSK_CUSTOMER_ID`
    (222309, shop-owned)**, store address with the customer's name, tax 0
    (Fulcrum charges tax at the register). The order number shown is CC's.
  - **Order placed screen** (`/shop/kiosk/done/<num>`, 30 min): huge order
    number, items, auto-return after 60 s. **Idle reset** (`shop.js`):
    120 s without a touch → "Still shopping?" with a 20 s countdown (only
    when the cart has items) → `/shop/kiosk/reset` empties the cart.
  - **Staff list** `/shop/kiosk/orders` (opened once per device with
    `/shop/kiosk/staff?key=KIOSK_STAFF_KEY`, 30-day cookie): open orders
    oldest first, flagged red after 2 h, "Open in CrystalCommerce" link
    (`<admin host>/orders/<id>`, unverified URL pattern), **Paid & picked
    up** / **Cancelled** buttons (our list only: staff still complete or
    cancel in CC). Refreshes every 30 s. Stored in
    `p2w-shop-data/kiosk-orders.json` (flock'd; open orders always kept,
    last 300 closed). `/shop/kiosk/status` (kiosk or staff) shows the
    mode, the IP seen, whether this kiosk can order, and the variant-map
    match count.
  - **Variant ids:** `sync.php` maps every listing to CC's variant id
    (`variants.json`) by product (`product_catalog_id` = Core2 product
    id) + normalized condition + other descriptors, falling back to the
    only variant of a product. It's the **last** sync step (after
    `index.json` is saved) and wrapped in try/catch, and one pass is
    **spread over several runs**: variants pages are read 6 at a time,
    slimmed immediately, and saved in `variants-progress.json` until the
    queue is empty (a page that fails 3 times abandons the pass and keeps
    the old map). A new pass starts once the listings are newer than the
    last finished map. (The first version read every page at once and
    made `sync.php` return HTTP 500 on the live server, likely memory, so
    don't go back to that.) A new pass starts at most hourly
    (`VARIANT_MIN_MINUTES`; a full pass is ~256 slow pages / ~47k
    variants, including out-of-stock ones), and `shop-sync.yml` keeps
    calling until `variants.pending` is gone. The status page's "matched
    N of M" is the health check, with `unmatchedExamples` (condition +
    descriptor spellings on each side) listed under it. First live pass
    (Oct 3 2026): 3,957 of 4,346 matched (322 via the only-variant
    fallback), 389 unmatched → "Ask at the register".
- **Secrets:** `.env.example` lists the settings; real values go in
  `<home>/p2w-shop-data/.env` (never in the repo — `.env*` is
  git-ignored and excluded from the deploy): `CC_API_PROXY_SECRET`,
  `KIOSK_KEY`, `KIOSK_STAFF_KEY`, `KIOSK_MODE`.
- **Go-live checklist:** set `SHOP_PREVIEW = false`; point the nav's
  "TCG Inventory" button (`nav-cta`, every page) and the other
  CrystalCommerce links at `/shop`; add `/shop` to `sitemap.xml`; update
  TEAM-GUIDE.md (incl. a kiosk section: the staff key link, the register
  steps, and cancelling unclaimed orders in CC).

## Konami easter egg (BULKY-TRIS)

- `konami.js` loaded (deferred) on all standard pages. Code
  `↑ ↑ ↓ ↓ ← → ← → B A` opens a Tetris modal.
- **Level select** (`showLevelSelect`) shows before each game (on open and on
  replay): pick a start level 1–10 by click, digit key, or ← → + ENTER. The
  choice is remembered in `localStorage` (`p2w-bt-startlevel`) and sets both the
  initial drop speed and the level floor (`level = startLevel + lines/10`).
- **Scoring follows the modern Tetris Guideline** (don't "simplify" these):
  line clears `100/300/500/800 × level` (single/double/triple/tetris), soft drop
  `1 ×` cells, hard drop `2 ×` cells, **combo `50 × combo × level`** where
  `combo` starts at −1 and increments on every consecutive line-clearing
  placement (so the bonus starts on the 2nd clear in a row; any placement that
  clears nothing resets it). **10 lines per level.** The live **Combo** counter
  is the `#kn-combo` stat tile — dim "0" when idle, red glowing "×N" + pulse
  (`.kn-combo-live`/`.kn-combo-pulse`) while a streak is active.
- **T-spins & Back-to-Back.** `detectTSpin` uses the 3-corner rule (last action
  a rotation + T piece + ≥3 box corners blocked; "mini" when only one front
  corner is blocked). T-spin clears score `400` (spin only) / `800` / `1200` /
  `1600 × level` (mini: `100`/`200`/`400`). A Tetris **or** any T-spin line
  clear is "difficult" and feeds the **Back-to-Back** chain — chaining two
  difficult clears with no normal clear between is `×1.5`, shown by the `#kn-b2b`
  badge under the Combo tile. Notable clears flash the `.kn-callout` over the
  board (TETRIS / T-SPIN / B2B …).
- **Lock delay & input feel.** Grounded pieces wait `LOCK_DELAY` (500ms),
  refreshed by move/rotate up to `LOCK_RESET_MAX` (15) per row, so last-moment
  slides/tucks work (hard drop still locks instantly; soft drop doesn't
  force-lock). Keyboard movement is loop-driven `DAS`/`ARR` (250/40ms), not OS
  key-repeat. Don't reintroduce instant soft-drop lock or per-keydown movement.
- **Juice & options.** A `READY 3·2·1·GO!` countdown (`runCountdown`, gates
  gravity/input) precedes each game; Tetris/T-spin clears trigger a board
  flash + shake (`flashBigClear`); Bulky cheers on the NEW HIGH SCORE screen.
  Three toggles in the actions bar, each remembered in `localStorage`:
  **SOUND** (`p2w-bt-muted`), **MUSIC** (`p2w-bt-music`, off by default — a
  looping public-domain Korobeiniki melody synthesized on the shared
  AudioContext, independent of the SFX mute), and **LABELS** (`p2w-bt-cb`,
  colorblind mode stamping each block's letter). All juice animations honor
  `prefers-reduced-motion` (CSS media query + a JS guard in `flashBigClear`).
- Global leaderboard via **Firebase Firestore** (config in `konami.js`, project
  `p2w-leaderboard`). Firestore security rules are locked to a strict schema
  (read all; create-only with validated fields; no update/delete) — **keep them
  that way.** Profanity blocklist is the `BLOCKED` set in `konami.js`. The table
  shows rank/name/score **+ Lv + Lines** (all already stored per score).
- **Local personal best** kept in `localStorage` (`p2w-bt-best`) — shown in the
  `#kn-best` side tile (teal; pulses green on a new best) and as a "NEW BEST!"
  note on the game-over screen, so there's a target even offline.

## Forms

Three via **Formspree** (endpoints are public client-side by design):
- Upgrade request: form action in `upgrade-request.html` →
  `formspree.io/f/xaqvrbjn` (→ `repairs@`).
- Event inquiry: form action in `event-inquiry.html` →
  `formspree.io/f/xjglnaew` (→ `inquiries@`).
- Careers application: form action in `careers.html` →
  `formspree.io/f/mvzyvwzb` (confirmed in the shop's `admin@` account).
- The JavaScript submit handlers read `form.action`; do not duplicate endpoint
  constants in JavaScript.
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
- **Header CTA pill (`.header-cta`).** The purple→black "Community First
  Program" pill links to `community-first.html` and lives in every standard
  page's `<header>` between `.brand` and `.header-phone`. It's deliberately
  **size/shape-matched to `.header-phone`** (same `padding: 8px 14px`,
  `font: 700 0.95rem`, `border-radius: 999px`, and a CSS-forced `16px` icon)
  so the two pills read as a matched set — keep them in lockstep if you
  restyle either. The desktop bar (header is `nowrap`, padding-inline =
  `clamp(18px, 4vw, 54px)` so the logo stays near the left edge — not capped
  to the body width, by owner preference) is **logo (left) · then a
  right-hand cluster of CFP pill · phone · nav**. The cluster is grouped to
  the right by `margin-left: auto` on `.header-cta` (so the logo sits alone
  on the left, conventional logo-left / nav-right). The pill is sized to its
  text (`flex: 0 0 auto`); `.header-phone` is `flex-shrink: 0` + `white-space:
  nowrap` so the number never wraps; and `.nav` has **no width cap** +
  `justify-content: center`, so its 9 links stay on **one row on large
  displays (~1580px+) and only wrap to two centered tiers on smaller
  screens** — that responsive collapse is the point, don't re-add a
  `max-width` cap (it would force two tiers at every width). Don't remove the
  phone's `flex-shrink:0`/`white-space:nowrap` either, or the number wraps.
  (Caveat: in the ~700–1100px tablet band the cluster squeezes the nav to 3
  short tiers until the `≤680px` hamburger kicks in — acceptable, but if it
  bothers you raise the mobile-nav breakpoint.) `.header-phone`'s
  `margin-left:auto` is restored only in the `≤680px` mobile block, where the
  pill instead becomes its own full-width row under the logo/phone/hamburger
  bar. If you add the pill to a new page,
  copy the exact `.header-cta` markup from any standard page (15 share it
  identically).
- `nav.js`: mobile nav toggle + IntersectionObserver scroll-reveal.
- Accessibility: skip links, `main#main`, visible `:focus-visible` rings.
- SEO: canonical tags, OG tags + `assets/og-image.jpg` share card, `sitemap.xml`,
  `robots.txt`, JSON-LD (GameStore/FAQPage/Event).

## Pending content (placeholders, marked with HTML comments)

- `team.html`: **all in** — every individual plus the full-crew group shot
  (`assets/team/full-crew.jpg`) have real photos, and **all bios are written**
  (Mark, Josiah, Nick, Justin, Corey, Travis, Keith). Keith's bio also appears
  on `repairs.html` (same text in both spots).
- **`showcase/` partially re-shot; `upgrades/` restored from the old shots.**
  All photos were originally deleted to be re-shot (saved ~50 MB); each card
  keeps the original `<img>` in an HTML comment below its placeholder.
  To restore: drop the new photo into `assets/upgrades/` or
  `assets/showcase/`, delete that card's `.upgrade-placeholder` /
  `.showcase-photo-placeholder` div, and uncomment the `<img>`.
  **Optimize first: resize ≤1600px long edge, ~q82.**
  - `sell-trade.html` showcase — **10 of 12 cards now have real photos**:
    `vg-handhelds`, `vg-nintendo`, `vg-playstation`, `vg-xbox`,
    `ttl-collection`, and all 5 TCG cards (`tcg-pokemon-holos`/`-vintage`,
    `tcg-magic`, `tcg-yugioh`, `tcg-sealed`). **Still pending:** `vg-retro`
    and `ttl-animal-crossing`. ⚠️ The TCG shots are **landscape** (3:2) card
    spreads, so the TCG showcase grid (`[data-cat="tcg"]` in `styles.css`) has
    its own **landscape layout** (3-up, `aspect-ratio: 7/5` cells, trailing
    pair centered; steps to 2-up then 1-up) — distinct from the VG grid's
    5-col portrait cells. Keep new TCG shots landscape, or revisit the grid.
  - `upgrades.html` — **all 8 cards restored** from the old pre-re-shoot
    photos (recovered from git history `d5af5b0^:assets/mods/`, re-optimized
    into `assets/upgrades/`). These are the *original* shots, not re-shoots —
    swap in better ones later if/when they're taken. Cards 1–6 are
    before/after hover pairs, 7–8 are static single shots.

## Notes

- `WEBSITE-AGREEMENT.md` is **git-ignored** (private handoff/portfolio agreement
  between Corey Clark and owners Mark Spears & Josiah Miller) — never commit it.
- **Pricing formula** (applies to both `repairs.html` and `upgrades.html` pricing
  rows): **labor is $60/hr, parts are billed at our cost + 20%**. Disclosed
  publicly in the `.pricing-disclaimer` block on `repairs.html`. New pricing
  rows must follow this formula so quotes and the page agree. (Deep-clean has
  a documented exception — liquid-metal service uses the *non-bundled* $60
  clean rate, not the $30 bundled rate, by owner choice.) **The `upgrades.html`
  cost estimator (`.upgrade-calc`) hard-codes the same ranges in its inline
  `HANDHELDS`/`ADDONS` JS object — when an upgrade price row changes, update
  both the `.pricing` table and the calculator's JS or they'll disagree.**
- **`/discord` redirect.** `discord/index.html` is a self-contained
  redirect page that bounces to the Discord invite
  (`discord.gg/m44gYFFSd8`) via JS + meta-refresh + manual fallback,
  with `noindex` so search engines don't index it. **Point NFC tags,
  QR codes, printed signage, and any external "join our Discord"
  reference at `play2wingames.com/discord`** rather than the
  `discord.gg/...` URL directly — that way if the Discord invite ever
  rotates, only this one file needs updating; no re-printing signage
  or re-programming tags.
- **Google review CTA** points to `https://g.page/r/CSxEUPh9daG2EAE/review`
  from 3 places: the home "What people say" section, the `.review-prompt`
  band on `repairs.html`, and the `.review-prompt` band on `sell-trade.html`.
  One URL to update if the GBP ever migrates.
- **Mascot (Bulky) lives in specific places, by design.** Source asset
  is `assets/shop-header.png` (large); a smaller `assets/bulky-mascot.webp`
  (~35 KB, 360×404) is used for the lighter placements. Current footprint:
  hero collage (center tile), home split-section (`shop-header.png` as
  `.mascot-img`), Konami modal, **footer mascot** on all 15 pages
  (`.footer-mascot`, 44px), **events-empty state** (`.events-empty-mascot`,
  140px), and the **"Meet the mascot" split-section on `about.html`**.
  **Don't add Bulky to every page-hero or service section** — mascots earn
  their keep in *empty states, brand stamps, and narrative intros*, not as
  gratuitous decoration. The current set is deliberate; expand only with a
  reason. (Separate asset: `assets/bulky-coin.webp` — a background-removed
  cut-out of the 3D-printed Play2Win Bulky coin, used in the about-page
  `.coin-hunt-teaser` and as the floating hero on `bulky-coin-hunt.html`.
  It was cut from a photo with a feathered circular PIL mask, not rembg.)
- **Trade-in store-credit bumps (tiered).** Store credit pays more than
  cash on trade-ins, by category: **video games 50% more**, **consoles &
  handhelds 20% more**, **TCG singles/sealed/graded 10% more**, **TCG
  bulk is flat** (cash = store credit). Visible in: `faq.html` "Cash or
  store credit" entry (visible + JSON-LD), `sell-trade.html` step 3 of
  the How-it-works flow, `bulk-rates.html` centered disclaimer (the
  "flat" half of the rule). All four must stay in sync if the numbers
  ever change. The `trade-in/` calculator uses the same games rule
  (credit = 105% of PriceCharting retail buy, cash = 70%), so
  update its Settings defaults too.
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
- **Team photo frames (`team.html`).** All `.person-photo-frame` use a
  `4/5` portrait crop, `object-fit: cover` anchored `center top` so the
  crop comes off the bottom and tops of heads are never clipped. Owner
  cards (`.person-photo-frame--lg`) share that same `4/5` ratio (they used
  to be square `1/1`, which chopped top+bottom) but override
  `object-position: center 30%` — their shots have extra headroom and they
  hold prop "weapons", so nudging the crop down pulls the frame top toward
  their heads and shows more of the weapon. Don't reset owners to `center
  top` or back to `1/1`.
- **Team photo hover-swap (`team.html`).** A card can carry a second "fun"
  portrait that fades in on hover/focus. Opt in by adding
  `.person-photo-frame--swap` to the frame and giving it **two** imgs: the
  real `.photo-base` (normal `alt`) and a decorative `.photo-hover`
  (`alt=""` + `aria-hidden="true"` + `loading="lazy"`) that's absolutely
  positioned over it at `opacity:0`, → `opacity:1` on `:hover`/`:focus-within`
  (crossfade honors `prefers-reduced-motion`). Hover/focus-only by design —
  touch + screen readers just get the base. Currently on **Travis**
  (`tcg-manager-hover.jpg`) and **Keith** (`keith-hover.jpg`); the
  frontend-manager card is now Corey with no hover shot (so
  `frontend-manager-hover.jpg` is orphaned). The hover shots are framed with the same
  4/5 top-crop as the base. Keep it sparing — it's a playful touch, not a
  default for every card. (Owner **Mark** previously had a sword/gun swap;
  the gun shot was dropped by owner request, so his `--lg` card now shows
  only the single sword photo as `owner-1.jpg`.)
- Contact: 865-910-8357 · inquiries@play2wingames.com (general) ·
  careers@play2wingames.com (hiring) · facebook.com/P2WGames ·
  discord.gg/m44gYFFSd8 (Discord is a non-vanity but never-expire invite).
- TCG inventory is external: https://playtowingames.crystalcommerce.com/
- Parked feature ideas pending vendor answers: surfacing Fulcrum POS video-game
  inventory, and a custom CrystalCommerce TCG search/deckbuilder with bulk
  cart hand-off.
