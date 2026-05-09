# Play2Win Games — Website

Static HTML/CSS/JS site for Play2Win Games, a retro video game and TCG shop in Knoxville, TN.

## Stack

- Pure HTML, CSS, vanilla JS — no build step, no framework
- Hosted as static files
- TCG inventory via CrystalCommerce: https://playtowingames.crystalcommerce.com/
- Facebook page: https://www.facebook.com/P2WGames/

## Pages

- `index.html` — home
- `about.html` — about the shop
- `events.html` — upcoming events (JS-rendered from inline `EVENTS` array)
- `contact.html` — store hours, address, phone

## Events Page

Events are stored as a plain JS array at the bottom of `events.html`. To add or edit an event, update that array directly. Fields:

```js
{
  id: number,          // unique, increment from last
  title: string,
  game: "pokemon" | "magic" | "yugioh" | "lorcana" | "digimon" | "gundam" | "smash" | "riftbound" | "other",
  gameLabel: string,   // display name for the badge
  date: "YYYY-MM-DD",
  time: "H:MM AM/PM",
  time24: "HH:MM",     // used for .ics generation
  entry: "$X.XX" | "Free" | "TBA",
  format: string,
  capacity: number | null,
  registered: number | null,
  registerUrl: string | null,
  recurring: string | null,  // e.g. "Every Saturday"
  description: string
}
```

### Live sync with Facebook (not yet implemented)

The plan is to use **Option B: GitHub Action + static JSON** — a scheduled Action fetches events from the Facebook Graph API nightly and writes `events.json` to the repo. The events page fetches that file at load time. This keeps the site fully static and the Facebook token server-side only.

#### Getting a Facebook Page Access Token

1. Go to **developers.facebook.com** → Create App → type: Business
2. In the app dashboard: **Tools → Graph API Explorer**
3. Switch the token dropdown to the **P2WGames page** (not user token)
4. Request permission: `pages_read_engagement`
5. Click **Generate Access Token** — this is short-lived (~1 hour)

**Extend to non-expiring:**

```
GET https://graph.facebook.com/oauth/access_token
  ?grant_type=fb_exchange_token
  &client_id=APP_ID
  &client_secret=APP_SECRET
  &fb_exchange_token=SHORT_LIVED_TOKEN
```

Returns a 60-day user token. Then:

```
GET https://graph.facebook.com/me/accounts?access_token=LONG_LIVED_USER_TOKEN
```

The `access_token` for the P2WGames page in the response is **non-expiring** as long as the user doesn't revoke it.

**Events API endpoint:**

```
GET https://graph.facebook.com/v19.0/me/events
  ?access_token=PAGE_TOKEN
  &fields=name,description,start_time,end_time,cover,place
```

Store the token as a GitHub Actions secret (`FB_PAGE_TOKEN`), never in client-side JS.
