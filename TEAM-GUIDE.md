# Editing the Play2Win Games website — a guide for the team

This guide is for the **shop team** (Mark, Josiah, Nick, Corey, Travis,
Justin, Keith) to keep the website current. **You don't need to know HTML,
CSS, or anything about web development.** You do need a GitHub account and
about 10 minutes of practice the first time.

Every change you make goes live in about **90 seconds** automatically.
Every change can be **undone in two clicks** if something goes wrong. There
is nothing here you can permanently break.

---

## Table of contents

- [Before you start](#before-you-start)
- [GitHub basics — the editor you'll use](#github-basics)
- **Common tasks** (the meat of this guide)
  - [Change store hours](#change-store-hours)
  - [Update or add a repair price](#update-or-add-a-repair-price)
  - [Update or add a handheld upgrade price](#update-or-add-a-handheld-upgrade-price)
  - [Update TCG bulk rates](#update-tcg-bulk-rates)
  - [Update a team member or add a new one](#update-a-team-member)
  - [Update an FAQ answer](#update-an-faq-answer)
  - [Add or edit a calendar event](#add-or-edit-a-calendar-event)
  - [Post tournament pairings for players](#post-tournament-pairings)
  - [Edit the careers page](#edit-the-careers-page)
  - [Swap out a featured Google review](#swap-out-a-featured-google-review)
  - [Update the Google review link](#update-the-google-review-link)
  - [Update contact info — phone, email, address](#update-contact-info)
  - [Update the TCG inventory link](#update-the-tcg-inventory-link)
- [When something is wrong](#when-something-is-wrong)
- [External services — what depends on what](#external-services)
- [Things you should NOT touch](#things-you-should-not-touch)
- [Using Claude when this guide isn't enough](#using-claude)
- [Emergency contact](#emergency-contact)

---

## Before you start

1. **Get a GitHub account.** Free. Sign up at [github.com](https://github.com).
2. **Get added as a collaborator.** Ask Corey (or whoever owns the repo
   currently) to add your GitHub username to the `cmclark00/p2w` repo with
   "Write" access. You'll get an email invite. Accept it.
3. **Bookmark this guide.** It currently lives at
   `github.com/cmclark00/p2w/blob/main/TEAM-GUIDE.md`. After the repo
   migration it'll be at
   **`github.com/play2wingames/p2w/blob/main/TEAM-GUIDE.md`** — same
   file, new home. **Prefer paper?** Open
   [`team-guide-print.html`](team-guide-print.html) in any browser and
   press Ctrl + P (⌘ P on Mac) — it's the same content formatted for
   clean printing or PDF export.
4. **Practice on something small first.** The first time, try changing a
   tiny thing (a typo, a comma) so you've done the round-trip from edit
   → commit → live site once before you need to do it for real.

---

## GitHub basics

You will only ever use **the GitHub website**. You do **not** need to
install anything, learn the command line, or download the code.

### Logging in and finding the repo

1. Go to [github.com](https://github.com) and sign in.
2. Go to **github.com/cmclark00/p2w** (bookmark this).
3. You're looking at a list of files. The site lives here.

### Opening a file to edit

1. **Click the file name** in the list (e.g., `repairs.html`).
2. You'll see the file's contents on a colorful background.
3. In the **top-right corner of the file**, look for a small **pencil
   icon** (✏️). Click it. Hover-tip says "Edit this file."
4. The file opens in an editor. You can now click anywhere in the text
   and type.

### Searching within one file

While editing a file, press **Ctrl + F** (Windows) or **⌘ + F** (Mac).
A search box appears in the top right of the editor. Type what you're
looking for and press Enter to jump to it.

### Searching across all files

This is important for things that appear in multiple files (like store
hours).

1. At the top of the GitHub page, in the **search bar**, type what you're
   looking for inside quotes, e.g., `"11 AM – 9 PM"`.
2. Press Enter.
3. Click **Code** in the left sidebar of the search results.
4. You'll see every file that contains that text, with the matching
   line. Click each one to edit it.

### Saving your change (called "committing")

1. Scroll to the **very bottom of the editor**, or click the green
   **"Commit changes…"** button in the **top-right corner**.
2. A box appears asking for a description of what you changed. Type
   something honest and short, like:
   - *"Updated Switch battery price"*
   - *"Fixed typo on FAQ page"*
   - *"Closed Thursday for holiday"*
3. Leave **"Commit directly to the `main` branch"** selected.
4. Click the green **"Commit changes"** button.

### What happens after you commit

- Within **90 seconds**, the live website updates automatically. Open
  `play2wingames.com` (or `cmclark00.github.io/p2w` until cutover) in
  another tab to verify.
- If you don't see your change after 2 minutes, do a **hard refresh**:
  **Ctrl + Shift + R** (Windows) or **⌘ + Shift + R** (Mac).

### Undoing a mistake

Every change is recorded forever. If something looks wrong after you
commit:

1. Go back to the repo home: **github.com/cmclark00/p2w**
2. Click **"Commits"** (just under the green Code button, with a clock
   icon).
3. Find your bad commit (yours will say your username and the
   description you typed).
4. Click the **"<>"** button next to it — that opens "Browse the
   repository at this point in time."
5. **The easier path:** click the three-dot menu **"…"** on the commit
   row → **"Revert"** → this creates a new commit that undoes the bad
   one. Click through and commit the revert.

When in doubt: **ask before reverting**. Reverting is safe but if
multiple people have edited since then, the revert can collide.

---

## Common tasks

### Change store hours

**When to do this:** Permanent hours change, holiday closure for a
specific day, special hours for an event.

**The catch:** Hours appear in **5 places** that all have to be updated
together, or the website will contradict itself. Use GitHub's
**search-across-all-files** for this one.

Search for the exact current hours text, for example: `Sun 11&ndash;7`
(the `&ndash;` is the website's way of writing a dash — copy it
exactly).

Files that contain the hours, and where:

| File | What it is |
|---|---|
| `contact.html` | The big "Store Hours" list customers see on the Contact page |
| Every other HTML page's `<footer>` | The mini "Visit" block in the footer |
| `index.html` | The Google-readable hours block (search-engine data) |
| `faq.html` | The "What are your hours?" answer — **AND** the same answer inside the JSON-LD block at the top |

**Step-by-step:**

1. **Search the repo** for `Sun &middot;` (use the across-all-files
   search described above). This finds the footer line on every page.
2. **One file at a time**, change the times. Commit each file with a
   description like *"Updated Sunday hours in footer"*.
3. **Then visit `contact.html`** and update the **Store Hours** list
   there. (Look for `<dl class="hours-list">`.)
4. **Then visit `index.html`** and find the block that starts with
   `"openingHoursSpecification"` — update the times there. They look
   like `"opens": "11:00", "closes": "19:00"`. **Use 24-hour time**
   here (so 7 PM = 19:00, 9 PM = 21:00, 11 PM = 23:00).
5. **Then visit `faq.html`** and update both:
   - The visible answer (search for `"What are your hours?"`)
   - The same answer inside the JSON-LD block near the top of the file
     (also containing `"What are your hours?"`)

**Verify:** Visit the live site. Check the footer of any page, then
visit `contact.html`, then `faq.html`. Hours should agree everywhere.

---

### Update or add a repair price

**When to do this:** Parts cost or labor rate changed; you added a
new repair service.

**File to edit:** `repairs.html` (only).

#### Updating an existing price

1. Open `repairs.html` in the GitHub editor.
2. **Ctrl + F** and search for the current price (e.g., `$70`) or the
   service name (e.g., `Switch internal battery`).
3. Change the number. Leave everything else exactly as it is.
4. Commit.

**Example.** To change the Switch battery from $70 to $80:

```html
<div class="price-row"><dt>Nintendo Switch &middot; Lite &middot; OLED internal battery</dt><dd>from $70</dd></div>
```

becomes:

```html
<div class="price-row"><dt>Nintendo Switch &middot; Lite &middot; OLED internal battery</dt><dd>from $80</dd></div>
```

Only the `$70` changed. **Do not** change `&middot;` or any other
symbols — those are HTML codes, not typos.

#### Adding a new row to an existing pricing group

1. Find the group you want to add to (e.g., `<h3>Battery Service</h3>`).
2. Find any existing `<div class="price-row">…</div>` line inside that
   group.
3. **Copy that whole line** (one line, even if it's long).
4. **Paste it directly below the line you copied.** Now there are two
   identical rows.
5. In the **new** row, change the description (between `<dt>` and
   `</dt>`) and the price (between `<dd>` and `</dd>`).
6. Commit with a message like *"Added new battery service row"*.

#### Adding a whole new pricing group

This is bigger. Best to ask the technical contact unless you're
comfortable. If you do it yourself:

1. Find an existing `<div class="pricing-group">…</div>` block —
   typically takes about 6 lines.
2. Copy the entire block (from the opening `<div class="pricing-group">`
   to the closing `</div>` after the `</dl>`).
3. Paste below it.
4. In the new copy, change the `<h3>` heading and the rows.
5. Commit.

**Pricing rules to keep consistent (already on the page):** labor is
billed at **$60/hour**, parts at **our cost + 20%**. If you change the
labor rate or the markup, also update the disclaimer paragraph at the
top of the pricing section.

---

### Update or add a handheld upgrade price

**When to do this:** Parts cost shifted; you added a new upgrade.

**File to edit:** `upgrades.html` (only).

Same pattern as the repairs page. Look for the **`<section
class="pricing">`** block. Each console family has its own
`<div class="pricing-group">` with a list of rows.

Same rule applies: parts cost + 20%, labor at $60/hour, totals shown as
ranges (e.g., `$128&ndash;$184`).

**Math reminder.** If a part costs you $30 and the install takes 1
hour, the customer price is:

> ($30 × 1.20) + $60 = **$36 + $60 = $96**

For ranges (e.g., labor 30–60 min): low end = parts + (low labor), high
end = parts + (high labor).

---

### Update TCG bulk rates

**When to do this:** Market shifted on a TCG, you want to bump or drop
what we pay for a category, or a new TCG launched and you want to
publish a rate for it.

**File to edit:** `bulk-rates.html` (only).

The page has **two** `<div class="pricing-group">` blocks: **Pokémon**
(the long one — bulk per-1k rates plus per-card rates for things like
Vstar/Vmax and EX/GX/V) and **Other TCGs (per 1000)** (one flat per-1k
rate per game).

#### Changing an existing rate

1. Open `bulk-rates.html` in the GitHub editor.
2. **Ctrl + F** and search for the game name (e.g., `Lorcana`) or the
   current price (e.g., `$5`).
3. Change the number between `<dd>` and `</dd>`. Leave everything else
   alone.
4. Commit.

**Example.** To bump Lorcana from $5 to $7 per 1000:

```html
<div class="price-row"><dt>Lorcana</dt><dd>$5</dd></div>
```

becomes:

```html
<div class="price-row"><dt>Lorcana</dt><dd>$7</dd></div>
```

#### Adding a new game to the "Other TCGs" card

1. Find any existing row in the **Other TCGs** group (e.g., the
   `<div class="price-row"><dt>Digimon</dt>…` line).
2. **Copy that whole line** and paste it below.
3. Change the game name and the price in the new row.
4. Keep the list sorted by **price descending** (highest pay rate at
   the top). If multiple games share a price, group them together.
5. Commit with a message like *"Bulk rates: add Star Wars Unlimited at $5/1k"*.

**Important — units convention.** The "Other TCGs" header says
**"(per 1000)"**, so each row only writes the dollar amount (e.g.,
`$5`, not `$5 / 1k`). Pokémon rows are mixed (some are per-1k like
`$15 / 1k`, others are per-card like `$0.70 each`) so each row
**must** spell out its unit. Match the style of the rows already there.

#### Removing a game

Delete the entire `<div class="price-row">…</div>` line for that game.
Commit.

---

### Update a team member

**When to do this:** Someone joined, left, changed roles, or you finally
have photos and bios to fill in.

**File to edit:** `team.html`.

The page is organized into sections: **Owners**, **Managers**. Each
person has a card.

#### To change a name or role:

1. Open `team.html`.
2. **Ctrl + F** the current name.
3. Edit the name and/or role text. Leave the surrounding `<h3>` and
   `<p>` tags alone.
4. Commit.

#### To add a real photo and bio (replacing the placeholder):

The HTML for each placeholder card looks roughly like this:

```html
<div class="person-photo-placeholder">
  <svg …>…</svg>
</div>
<!-- <img src="assets/team/owner-1.jpg" alt="Mark Spears, co-owner"> -->
```

To swap in a real photo:

1. **First, upload the photo file** to GitHub:
   - From the repo home, navigate into the `assets/team/` folder. If it
     doesn't exist, you can create it.
   - Click **"Add file" → "Upload files"**.
   - Drag the photo file in. **Name it the same as the commented `<img
     src=…>` line above.** For example, if the comment says
     `assets/team/owner-1.jpg`, the file should be named `owner-1.jpg`.
   - Click **"Commit changes"**.
   - **Photo size tip:** crop/resize the photo to roughly **600×800 pixels**
     before uploading. Anything bigger slows the site. Free tools:
     [squoosh.app](https://squoosh.app) (drag, drop, download).
2. **Then, edit `team.html`:**
   - Find the person's card.
   - **Delete** the entire `<div class="person-photo-placeholder">…</div>`
     block (the icon).
   - **Uncomment** the `<img>` line just below it — change `<!-- <img
     src=… -->` to just `<img src=…>` (remove the `<!--` at the start
     and the `-->` at the end).
3. **Update the bio:** find the placeholder paragraph (`<p
   class="person-bio-placeholder">…</p>` or similar) and replace its
   text with the real bio.
4. Commit.

#### To add a brand-new person card:

1. Find any existing card (e.g., one of the manager cards).
2. Copy the whole `<article class="person-card">…</article>` block.
3. Paste it below the last card in the same section (Owners or
   Managers).
4. Edit the name, role, photo path, and bio.
5. Commit.

---

### Update an FAQ answer

**When to do this:** A question's answer changed, you want to add a new
question, or a price/policy mentioned in the FAQ changed.

**File to edit:** `faq.html`.

**The critical gotcha:** every FAQ answer appears in the file **TWICE**
— once in the visible page, once in a hidden block at the top called
"JSON-LD" that tells Google what's on the page. **Both must match.** If
they don't, Google might show outdated info in search results.

#### To change an existing answer:

1. Open `faq.html`.
2. **Ctrl + F** the question text. You'll find it **twice**:
   - First, inside a `"name":` line near the top (JSON-LD block).
     The matching `"acceptedAnswer"` is the answer Google sees.
   - Second, inside a `<summary>` line in the body. The matching `<p>`
     tag below it is the answer customers see.
3. **Update both copies of the answer.** Keep them identical.
4. Commit.

#### To add a new FAQ:

Easier to copy an existing one in both places. Ask the technical
contact the first time if you're not sure — the JSON-LD format is
fussy about commas.

---

### Add or edit a calendar event

**When to do this:** New tournament, league night, release party,
or you want to change an existing one (price, time, description,
cancel it).

**Where to edit:** **Google Calendar.** Do **not** edit
`events.json` directly — a nightly automation pulls events from
the shop's Google Calendar and rewrites `events.json` to match.
Whatever's in Calendar wins.

**What appears on the site:** the next **7 days** of events.
Anything farther out exists in Calendar but doesn't render on
the events page yet.

#### The basics

1. Open the shop's Google Calendar.
2. Create a normal event — title, date, start time.
3. If it repeats (weekly locals, monthly tournament), use
   Google Calendar's built-in **"Repeat"** dropdown ("Weekly on
   Monday," "Monthly on the first Friday," etc.). Don't make
   ten separate events.
4. The event title controls which **game filter tab** the event
   shows up on. The script auto-detects from the title:
   - "Pokemon" / "Pokémon" → Pokémon tab
   - "Magic" / "MTG" / "FNM" / "Friday Night Magic" → Magic tab
   - "Yu-Gi-Oh" / "yugioh" → Yu-Gi-Oh! tab
   - "Lorcana", "Digimon", "Gundam", "Smash", "Riftbound" → matching tabs
   - Anything else → "Other" tab

   So a title like **"Monday Pokemon Locals"** lands on the
   Pokémon tab automatically — no extra steps.

#### The description box (this is where the structured info goes)

The description has **two parts** separated by a single line
containing only `---`:

- **Above the `---`:** free-form description that shows up on the
  card (what the event is, who it's for, what to bring).
- **Below the `---`:** structured fields the website reads to
  render the entry fee, format, capacity, register button, and
  "recurring" badge.

**Paste-ready template:**

```
Casual + competitive Pokémon TCG locals every Monday night.
All skill levels welcome — bring sleeves, dice, and a deck
list (we'll print one for you if needed).

---
entry: $5
format: Casual & Competitive
recurring: Every Monday
```

That description, paired with the title `Monday Pokemon Locals`,
produces a card that says:

- Game: **Pokémon** (auto-detected from title)
- Entry: **$5 entry fee**
- Format: **Casual & Competitive**
- Badge: **🔁 Every Monday**
- Description body: the paragraph above the `---`

#### All the structured fields you can use

| Field | What it shows | Example | Notes |
|---|---|---|---|
| `entry` | Entry-fee line on the card | `entry: $5` | Use a literal `$`, or write `Free` or `TBA`. Defaults to **TBA** if missing. |
| `format` | Format line under the time | `format: Swiss, 3 rounds` | Free text. Defaults to **"See description"**. |
| `prizing` | 🏆 prize line on the card | `prizing: Packs to top 4 + promos` | Free text — describe the prize support. Omit it and the line just doesn't show. |
| `capacity` | Used with `registered` to show "X of Y spots open" progress bar | `capacity: 24` | Must be a number. Does nothing alone — needs `registered` too. |
| `registered` | Current sign-ups (drives the progress bar) | `registered: 8` | Must be a number. |
| `registerUrl` | Link the **"Register Now"** button points at | `registerUrl: https://www.facebook.com/events/12345` | If missing, the card shows a **"More Info"** button instead (see `facebookUrl`). |
| `facebookUrl` | Link the **"More Info"** button points at — use the event's Facebook event page | `facebookUrl: https://www.facebook.com/events/12345` | Only shows when there's **no** `registerUrl`. If both are missing, "More Info" links to the main Facebook page. Worth adding for bigger events that have their own Facebook event. |
| `recurring` | "🔁 Every Monday" badge on the card | `recurring: Every Monday` | **This is just a label.** The actual repetition still has to be set in Google Calendar's Repeat dropdown. |
| `game` | Force the game-filter tab | `game: pokemon` | **Usually skip this** — the title auto-detects. Only set if the title doesn't include a recognized game name. Valid: `pokemon`, `magic`, `yugioh`, `lorcana`, `digimon`, `gundam`, `smash`, `riftbound`, `other`. |
| `gameLabel` | Custom game-tag display text | `gameLabel: Magic: The Gathering` | Usually skip — auto-set from `game`. |

#### Gotchas

- **The `---` must be alone on its own line** — no spaces before
  or after. If it's wrong, the metadata won't parse and you'll
  get default values everywhere.
- **Space after the colon matters.** Write `entry: $5`, not
  `entry:$5`. The latter silently fails.
- **Skip a field if you don't have a value.** Leaving
  `registerUrl:` blank with nothing after it is the same as not
  including it. Don't write `registerUrl: TBA` — that becomes a
  broken link.
- **No `---` at all = the whole description shows verbatim.**
  Entry fee, format, etc. all fall back to defaults ("TBA",
  "See description"). Fine if you don't have the details yet.

#### How long until it shows up on the site?

The events automation runs **once a night** (early morning UTC).
After you add/edit/cancel an event in Calendar, it typically
shows up on the site by next morning. To push it live sooner,
ask the dev to manually trigger the **"Sync events from Google
Calendar"** workflow in GitHub Actions — it takes about a minute.

---

### Post tournament pairings for players <a id="post-tournament-pairings"></a>

**When to do this:** You're running a Pokémon (or any TCG) tournament and
want players to see each round's pairings by scanning the QR code on the
tables — instead of everyone crowding the counter.

**This is NOT the GitHub editor.** It's a simple web page on the site. You
don't need a GitHub account for this one.

**One-time setup (ask the dev / manager):**
- A **passphrase** is set up in the Firebase settings. You type it to post;
  it stops random people from posting fake pairings. Get it from a manager.
- A **QR code** pointing at `play2wingames.com/pairings.html` is printed and
  placed on the tables. That QR never changes — only what it shows changes.

**Each round, from your phone or the shop tablet:**

1. In the Pokémon Play app, get the pairings on screen and take a
   **screenshot** (or a clear photo).
2. Go to **`play2wingames.com/pairings-admin.html`** (bookmark it — it's not
   linked anywhere on the site on purpose).
3. Type the **passphrase** (it's remembered on that device after the first
   time), the **event name** (e.g. "Friday Night Pokémon"), and the
   **round number**.
4. Tap **"Pairings screenshot"** and pick the screenshot (or snap a photo).
   Wait a second for the preview to appear.
5. Tap **"Publish to players."** You'll see "Published! Players can see
   Round N now."

That's it. Players who scan the table QR now see that screenshot, and it
updates within about 25 seconds (or they can tap Refresh). For the next
round, just repeat — you never delete anything, the newest post always wins.

**Tips & gotchas:**
- **Keep the screenshot readable.** A tight crop of just the pairings looks
  better zoomed-in than a full, cluttered screen.
- **"Rejected — check the passphrase"** means the passphrase was wrong, or
  the image was too big. Re-type the passphrase, or crop the screenshot
  tighter and try again.
- Players can't search their name in an image — they scan, then pinch/tap to
  zoom and find their table. That's expected.

---

### Edit the careers page

**When to do this:** You want to change the listed roles, the
intro copy, the "what we look for" blurb, or you want to pause
hiring temporarily.

**File to edit:** `careers.html`.

**Where applications land.** Submitted applications go to
**`careers@play2wingames.com`** (separate inbox from the general
`inquiries@`). Resumes come in two ways — either via the **Send
Resume** button (a mailto link that opens the applicant's mail
app) or as a follow-up email from the applicant after submitting
the form. Formspree's free tier can't accept file attachments
through the form itself, so the two-step flow is intentional.

#### Change the listed roles

1. Open `careers.html`. Search (**Ctrl + F**) for
   **`Roles we're currently hiring`** to find the role cards
   section.
2. Each role is an `<article>` with an `<h3>` (role title) and a
   `<p>` (one-line description). Edit the text or copy/paste an
   article to add a role.
3. **Also update the role-interest checkboxes** in the form
   itself — search for `name="role_interest"`. Each role listed
   above should have a matching checkbox here. Add/remove
   `<label class="ptw-upgrade-check">…</label>` lines to match.
4. Commit with a message like
   *"Careers: add Repair tech apprentice role"*.

#### Pause hiring temporarily

The cleanest way is to **replace the role cards section with a
short message and hide the form**:

1. In `careers.html`, find the `<section class="careers-form-section">`
   line.
2. Either delete that entire section, **or** wrap it in a
   `<!-- … -->` HTML comment to hide without losing the markup.
3. In the **"Roles we're currently hiring"** section above it,
   replace the role cards with a one-line message like
   *"We're not actively hiring right now — check back soon, or
   email careers@play2wingames.com if you'd like us to keep
   your résumé on file."*
4. Commit. To re-enable hiring later: uncomment the form section
   and restore the role cards (use **Revert** on the original
   commit, see [Undoing a mistake](#undoing-a-mistake)).

#### Change the receiving email

The form action and the Send Resume button both reference
`careers@play2wingames.com`. To route to a different address:

1. Search across all files for `careers@play2wingames.com`.
2. Update each occurrence to the new address.
3. **Separately** — log into the shop's Formspree account and
   update the form's notification email there too. The page-side
   change alone won't reroute submissions; Formspree decides
   where the email goes.

---

### Swap out a featured Google review

**When to do this:** A new amazing review came in that's better than
one of the three currently featured on the home page.

**File to edit:** `index.html`.

1. Open `index.html`.
2. **Ctrl + F** `"review-card"` — there are three blocks, one per
   featured review.
3. Pick the one you want to replace.
4. **Inside that block:**
   - Change the text between `<p>"…"</p>` to the new review's text.
     Keep the curly quotes (`&ldquo;…&rdquo;`).
   - Change the `<span class="review-author">First L.</span>` to the
     new reviewer's first name + last initial.
   - Change the `<span class="review-when">…</span>` to the new
     reviewer's date (e.g., "1 month ago").
5. Commit.

**What makes a good featured review:** mentions a specific service
(repair, trade, TCG); sounds like a real person, not a template; recent
(under a year); first name attaches a face to the words.

---

### Update the Google review link

**When to do this:** Almost never — but if you ever rebuild the Google
Business Profile or it migrates accounts.

**Files to edit:** `index.html`, `repairs.html`, `sell-trade.html` —
**three places**, same link.

1. Use the **search across all files** to find the current link:
   `g.page/r/CSxEUPh9daG2EAE/review`.
2. In each of the three files, change the link to the new URL.
3. Commit each file.

---

### Update contact info

Phone, email, and address appear in **many places**. Use search across
all files for each one.

| What | Current value | Where it appears |
|---|---|---|
| Phone | `865-910-8357` (or `+18659108357` in some links) | Every page's header + footer, `contact.html`, `index.html` JSON-LD, `privacy.html` |
| Email (general) | `inquiries@play2wingames.com` | Every page's footer, `contact.html`, `index.html` JSON-LD, `privacy.html` |
| Email (careers) | `careers@play2wingames.com` | `careers.html` (Send Resume button + form-success copy) |
| Address | `3903 Western Avenue` | Every page's footer, `contact.html`, `index.html` JSON-LD, `privacy.html`, map link |

**Rule:** if you change one, search across all files for the **old**
value and update everywhere it appears.

---

### Update the TCG inventory link

**When to do this:** The CrystalCommerce site URL changes (rare).

**Search across all files** for `playtowingames.crystalcommerce.com`.
There are several places (the "TCG Inventory" button in every page's
header, the home-page inventory band, etc.). Update each.

---

## When something is wrong

### The site is down ("page not found")

1. Open [github.com/cmclark00/p2w/actions](https://github.com/cmclark00/p2w/actions)
   in a browser. (Or `play2wingames/p2w/actions` after the move.)
2. Look at the most recent run at the top.
3. **Green checkmark** = deploy succeeded; the issue is probably DNS or
   browser cache. Wait 5 minutes, hard-refresh.
4. **Red X** = deploy failed. Click into it; the error message is
   usually clear. **If you can't tell what to do, contact the dev.**

### A page looks broken (jumbled text, weird layout)

A recent edit probably introduced a typo in the HTML. Best move:

1. Go to **github.com/cmclark00/p2w/commits/main**.
2. Find the most recent commit before the break.
3. Click the **"…"** menu → **Revert**.
4. Confirm. The site will return to the working version within 90
   seconds.

### Forms stopped sending email

The forms run through a service called **Formspree**.

1. Sign in at [formspree.io](https://formspree.io) with the shop's
   Formspree account (credentials should be in the shared password
   manager — see [External services](#external-services)).
2. Look at the Upgrade Request, Event Inquiry, and Careers forms —
   is the account active? Are there submissions piling up?
3. Often the cause is a paused or out-of-quota Formspree account.

### Events aren't updating on the events page

The events page reads from `events.json`, which is updated nightly by
a workflow that talks to Google Calendar.

1. Open [github.com/cmclark00/p2w/actions](https://github.com/cmclark00/p2w/actions).
2. Look at the **"Sync events from Google Calendar"** workflow. Did it
   fail recently?
3. The most common cause is an expired Google credential. **Contact
   the dev** for this one — it requires re-issuing a service account
   key in Google Cloud.

### Something else

Don't guess. **Use the [Emergency contact](#emergency-contact)
section** at the bottom of this guide.

---

## External services

The website depends on these outside services. **The shop's owners
should have credentials for each in a shared password manager** (1Password,
Bitwarden, Apple Passwords shared with family, etc.).

| Service | What it does | Where to manage | Account holder |
|---|---|---|---|
| **GitHub** | Hosts the code; "Pages" hosts the website itself for now | Currently `github.com/cmclark00/p2w` → moving to **`github.com/play2wingames/p2w`** at migration. GitHub auto-redirects, so existing bookmarks keep working. | _{{ FILL IN owner of `play2wingames` GitHub account — usually whoever created the org }}_ |
| **GoDaddy** | Will host the website after the move; owns the domain `play2wingames.com` | godaddy.com → My Products | _{{ FILL IN }}_ |
| **Google Workspace** (the `admin@play2wingames.com` account) | Receives form emails; controls the calendar that drives events on the site | google.com → sign in as admin@play2wingames.com | _{{ FILL IN }}_ |
| **Google Calendar** | Source of truth for events shown on the site | calendar.google.com (shop calendar) | _{{ FILL IN }}_ |
| **Google Cloud / service account** | Behind-the-scenes credential that lets the website read the calendar | console.cloud.google.com | _{{ FILL IN — currently Corey's account, must transfer at handoff }}_ |
| **Firebase** | Powers the leaderboard for the hidden Konami easter-egg game | firebase.google.com → "p2w-leaderboard" project | _{{ FILL IN — currently Corey, must transfer at handoff }}_ |
| **Formspree** | Receives the two contact forms and emails them to you | formspree.io | _{{ FILL IN — currently Corey, must move at handoff }}_ |
| **Google Business Profile** | Your "Play2Win Games" listing on Google Maps; where reviews live | business.google.com | _{{ FILL IN }}_ |
| **CrystalCommerce** | External TCG inventory site (NOT part of this codebase) | playtowingames.crystalcommerce.com admin login | _{{ FILL IN }}_ |

> **Action item — owners:** schedule a 30-minute session to (a) make
> sure all the above accounts are in a shared password vault Mark and
> Josiah both have access to, and (b) confirm each one is in the
> **shop's** name and not the developer's personal account. The
> handoff details are in `CLAUDE.md` under "Migration runbook."

---

## Things you should NOT touch

These files exist for good reasons. Editing them by hand will almost
certainly break the site. **Always contact the dev for these.**

| File / area | Why | What it controls |
|---|---|---|
| `404.html` | Special easter-egg page; owner-protected | The "page not found" retro game page |
| `styles.css` | One giant file that styles everything | Colors, spacing, fonts, layout — all pages |
| `nav.js`, `konami.js`, `assets/files/intake-form.js` | JavaScript | Mobile menu, the hidden game, the upgrade-request form |
| `.github/workflows/*.yml` | The automation that deploys the site and syncs events | If broken, nothing publishes |
| `assets/fonts/` | The web fonts | Removing these breaks the look on every page |
| `sitemap.xml`, `robots.txt` | Tell Google what to index | Not user-visible but important for being found in search |
| `CLAUDE.md` | Technical-developer documentation | Not the team guide — that's this file |
| `.gitignore` | Tells Git what to skip | Editing wrong can leak private info |

**Rule of thumb:** if it doesn't end in `.html`, and you're not sure,
**ask first.**

---

## Using Claude when this guide isn't enough <a id="using-claude"></a>

The shop has a Claude subscription. Claude is the same AI that helped
build this site — and crucially, the `CLAUDE.md` file in this repo was
written specifically so a fresh Claude session can pick up where the
dev left off. It knows the conventions, what not to touch, and the
deliberate "don't fix this" rules.

**Use Claude when:**

- This guide doesn't cover what you need (a new page, a brand-new
  service, a layout change).
- The site looks broken and the [When something is wrong](#when-something-is-wrong)
  checklist didn't solve it.
- You want to add something genuinely new (e.g., "a banner for our
  10-year anniversary sale").
- The backup dev is unreachable or it's something small enough that
  you'd rather try yourself first.

**Use the rest of this guide first** when the change is something
covered here (hours, prices, team members, FAQ, reviews, contact). Don't
spend Claude budget on routine edits you can do faster yourself in the
GitHub web editor.

### How to actually do it

1. Open Claude. Whichever way the shop has it set up — the Claude
   desktop app with the repo folder open, the VS Code Claude
   extension, or Claude Code in a terminal. Whoever set up the
   subscription should show you which to launch.
2. **Point Claude at the project folder** (`p2w`). Claude needs to be
   able to read the files in the repo.
3. **Tell Claude what you want plainly.** Examples:
   - *"I need to add a new page for gift cards. We sell them in
     denominations of $25, $50, and $100. Use the same look as the
     contact page."*
   - *"The repairs page link on the home page is broken. Can you fix
     it?"*
   - *"Add a banner across the top of every page that says we're
     closed Thursday."*
4. **Claude will read `CLAUDE.md` first** (it tells Claude how this
   site is built and what the rules are). Then it'll propose changes
   and show you a diff (a colored before/after view of every file it
   wants to touch).
5. **Read every diff before approving.** This is not optional. Claude
   can misunderstand or hallucinate. If a diff includes a file you
   don't recognize, or a change that looks weird, **stop** and either
   ask Claude to explain, or contact the backup dev.
6. **Approve the changes**, let Claude commit them, and **then visit
   the live site in your browser** to confirm the result looks right.
   Hard-refresh (Ctrl + Shift + R) to bypass cache.

### Hard rules

- **Always read the diff before approving.** A junior developer's
  changes get reviewed; Claude's should too.
- **If Claude tries to do something CLAUDE.md says NOT to do** — edit
  `404.html`, remove a form honeypot, "fix" the deliberate
  non-bundled liquid metal price, etc. — **stop and contact the
  backup dev.** CLAUDE.md spells these out for a reason.
- **Don't use Claude for credential or external-service work**
  (Formspree, Firebase, Google Cloud, GoDaddy, password changes).
  Claude can't reach those systems, and those changes should always
  be done by a human with the credentials. See [External services](#external-services).
- **Don't blanket-trust prices, dates, or names Claude generates.**
  If Claude makes up a price ("the new battery is $X"), check with
  Keith. If it writes a bio, check with the person it's about.
- **One focused task at a time.** Don't open a chat and ramble — be
  specific. Saves you money and gives better results.

### What Claude can't do

- See the rendered website. It reads code, not pixels. "Does this
  look right?" is a human's job — open the live site after every
  change.
- Test that forms actually deliver to your inbox. Submit the form
  yourself after any forms-related change.
- Know about real-world changes you haven't told it. If Keith left
  the shop, Claude doesn't know — you have to say so. If a price
  changed in Keith's head but not on the page, Claude can't tell.
- Reach external services. It can edit HTML referencing a Formspree
  endpoint, but it can't log into Formspree.
- Replace a human's call on ambiguous decisions. If you're not sure
  whether something is a good idea, **don't ship it just because
  Claude said so.**

### What to do if Claude suggests something that doesn't seem right

1. Ask Claude to **explain why** — "Why did you change the hero
   height? CLAUDE.md says don't lower it."
2. **Cross-reference with `CLAUDE.md`.** Search the file for the
   topic. The notes section near the bottom has invariants Claude
   should respect.
3. If still unsure, **don't approve the change.** Save what Claude
   suggested somewhere (paste it into a doc), and ask the backup dev.
4. **Git is your safety net.** Even if you do approve something bad,
   it can be reverted — see [Undoing a mistake](#github-basics).

---

## Emergency contact

> **Primary technical contact:**
> _{{ FILL IN name }}_
> _{{ FILL IN phone or email }}_
> _{{ FILL IN preferred contact hours }}_
>
> **Backup technical contact:**
> _{{ FILL IN name }}_
> _{{ FILL IN phone or email }}_
>
> **What this person has access to:** _{{ FILL IN — typically: GitHub
> repo write access, GoDaddy account, password vault read access }}_
>
> **Service-level expectation:** _{{ FILL IN — e.g., "responds within
> 24 hours for non-emergencies; same day if the site is down" }}_

If both are unreachable and the site is on fire:

1. The site can be reverted to a known-good version by anyone with
   GitHub repo write access — see [The site is down](#when-something-is-wrong).
2. The shop continues operating regardless of website status. The
   site is a storefront and discovery channel, not a critical system.
   Customers can still call, walk in, or use the
   [external TCG inventory](https://playtowingames.crystalcommerce.com).
3. Facebook and Discord are reachable independently and can be used to
   communicate with customers if the website is down for an extended
   period.

---

*Last updated by the dev when this guide was written. If you find
something out of date, **edit this file** — it's just another file in
the repo. The dev who maintains the site should be reviewing this
guide whenever the site structure changes meaningfully.*
