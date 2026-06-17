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
  it holds the canonical-host rules (www→apex + force-HTTPS, proxy-aware).
  Edit it in the repo, not on the server, or a deploy will overwrite your
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
| Firebase (`p2w-leaderboard`) | Konami leaderboard | 🔑 Add shop's Google account as Owner on the Firebase project, remove Corey's. Config in `konami.js` is public by design — no code change. Keep the locked Firestore rules. |
| Formspree (`xaqvrbjn`, `xjglnaew`, `mvzyvwzb`) | Upgrade, event-inquiry, careers forms | 🔑 Recreate all three forms under the shop's Formspree account → **new endpoint IDs** → update them in `assets/files/intake-form.js`, `event-inquiry.html`, and `careers.html`. Routing: upgrade → `repairs@`; event → `inquiries@`; careers → `careers@`. |
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
| `bulk-rates.html` | Standalone buylist page — what we pay for English TCG bulk (Pokémon full breakdown + per-1k rates for MTG, YGO, Lorcana, One Piece, Riftbound, Digimon, Gundam, FAB). Promoted to its own primary nav item. |
| `card-conditions.html` | Standalone card condition guide — Near Mint / LP / MP / HP / Damaged with photo reference and criteria for each grade. Reachable from the FAQ ("How do you grade card condition?"). Not in the primary nav. Images live in `assets/conditions/`. |
| `events.html` | Event calendar — JS-rendered from `events.json`, next **7 days** only, game filter tabs, injects `Event` JSON-LD. Host-an-event CTA. |
| `community-first.html` | Community First Release Program — regulars get new core set product at **true MSRP**. The four program rules (one item/person, consistent in-store players, must be present, seal cut at pickup) + "ask staff" footer. Reached from the **header CTA pill** (`.header-cta`) on every standard page. Was originally a section on `events.html`; moved to its own page. |
| `event-inquiry.html` | Event-hosting inquiry form → Formspree `xjglnaew` (inline form). |
| `repairs.html` | Repair services, ballpark pricing across multiple service groups (Controller Sticks, HDMI Port, Charging Port, Battery, Deep Clean, Thermal Service, PS2 Optical, Disc Resurfacing), 3-step process ($30 non-refundable diagnosis fee that applies to final cost), "Meet your repair techs" (Keith + Corey, bios in), Google review prompt at bottom. |
| `upgrades.html` | Handheld upgrade before/after showcase **+ Upgrade Pricing section** (GB family / GBA SP / DS Lite / add-ons) **+ interactive cost estimator** (`.upgrade-calc`, inline JS — ranges mirror the pricing table on the same page); CTA → upgrade-request. (Renamed from `mods.html` — old URL is a redirect file.) |
| `mods.html` | Redirect → `upgrades.html` (kept for old links). |
| `upgrade-request.html` | Handheld upgrade intake form. Uses `assets/files/intake-form.css` + `intake-form.js` (Formspree `xaqvrbjn`). |
| `team.html` | Owners + managers. Names filled; **bios & photos still placeholders.** |
| `faq.html` | 2-column accordion FAQ + `FAQPage` JSON-LD. |
| `contact.html` | Store info (phone, email, Facebook, Discord), hours, **click-to-load** Google Map. |
| `careers.html` | Application page for shop hires. Formspree form (endpoint `mvzyvwzb`, lands in `careers@play2wingames.com`) + separate "Email your resume" mailto button (Formspree free tier doesn't accept attachments). Linked from every page's footer. Uses `assets/files/intake-form.css` styling. |
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
  registerUrl, facebookUrl, recurring, prizing, description }
```

Calendar descriptions may be HTML (Google's web editor wraps lines in
`<br>`/`<div>`); `sync_events.py` flattens that to text before splitting the
`---` metadata block, so both plain-text and rich-text events parse.

`game` ∈ pokemon | magic | yugioh | lorcana | digimon | gundam | riftbound | other.

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
- Upgrade request: `assets/files/intake-form.js` →
  `FORMSPREE_ENDPOINT = formspree.io/f/xaqvrbjn` (→ `repairs@`).
- Event inquiry: inline form in `event-inquiry.html` →
  `formspree.io/f/xjglnaew` (→ `inquiries@`).
- Careers application: inline form in `careers.html` →
  `formspree.io/f/mvzyvwzb` (→ `careers@`, separate inbox).
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
  (Mark, Josiah, Nick, Justin, Mike, Travis, Keith). Keith's bio also appears
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
  ever change.
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
  (`tcg-manager-hover.jpg`), **Mike** (`frontend-manager-hover.jpg`), and
  **Keith** (`keith-hover.jpg`). The hover shots are framed with the same
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
