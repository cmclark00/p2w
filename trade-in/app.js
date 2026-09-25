'use strict';

/* ================================================================== constants */

const CATEGORIES = {
  game: 'Video Game',
  pokemon: 'Pokémon Game',
  console: 'Console',
  handheld: 'Handheld',
  accessory: 'Accessory / Controller',
  other: 'Other',
};
const GAME_CATEGORIES = ['game', 'pokemon'];
const HW_CATEGORIES = ['console', 'handheld', 'accessory', 'other'];
const GAME_CONDITIONS = { loose: 'Loose', cib: 'CIB', new: 'New' };
const HW_FIELDS = ['complete', 'unit', 'parts'];
const isGameCat = (cat) => GAME_CATEGORIES.includes(cat);
const hwConditionLabels = (cat) => (cat === 'accessory'
  ? { unit: 'Working', parts: 'Parts' }
  : { complete: 'Complete', unit: 'Console only', parts: 'Parts' });

// PriceCharting returns every price as an integer number of pennies.
const PC_FIELDS = {
  'retail-buy': { loose: 'retail-loose-buy', cib: 'retail-cib-buy', new: 'retail-new-buy' },
  market: { loose: 'loose-price', cib: 'cib-price', new: 'new-price' },
};
const PRICE_KEYS = [...Object.values(PC_FIELDS['retail-buy']), ...Object.values(PC_FIELDS.market)];

// PriceCharting console names for disc-based systems (the guide's "disc only" rules apply to these).
const DISC_PLATFORM_RE = /^(pal |jp )?(playstation( [2-5])?|psp|xbox( 360| one| series x)?|gamecube|wii( u)?|sega (cd|saturn|dreamcast)|turbografx cd|3do|neo geo cd|jaguar cd)$/;

// Game cash = PriceCharting price ÷ 1.5 (store credit is 50% more than cash). Kept exact, not 66.67.
const GAME_CASH_PCT = 100 / 1.5;

// Pricing and rules from the shop's Game Buying Guide (Google Sheet) and pricing policy.
const DEFAULT_SETTINGS = {
  version: 3,
  defaultCondition: 'loose',
  rules: {
    game:      { basis: 'retail-buy', cashPct: GAME_CASH_PCT, creditPct: 100 },
    pokemon:   { basis: 'market', cashPct: 50, creditPct: 75 },
    console:   { cashPct: 100, creditPct: 120 },
    handheld:  { cashPct: 100, creditPct: 120 },
    accessory: { cashPct: 100, creditPct: 120 },
    other:     { cashPct: 100, creditPct: 100 },
  },
  roundMode: 'down',
  roundStep: 1,   // cents
  lowValue: 100,  // cents - flag items whose cash offer is under this
  deductions: [
    { id: 'scratch-light', label: 'Light scratching (resurface)', amount: 200, appliesTo: 'game', resurface: true },
    { id: 'scratch-heavy', label: 'Heavy scratching (resurface)', amount: 300, appliesTo: 'game', resurface: true },
    { id: 'broken-case', label: 'Broken case', amount: 300, appliesTo: 'game', resurface: false },
    { id: 'no-av', label: 'Missing AV/HDMI cable', amount: 1500, appliesTo: 'hardware' },
    { id: 'no-power', label: 'Missing power cable', amount: 1500, appliesTo: 'hardware' },
    { id: 'no-ctrl', label: 'Missing controller (standard)', amount: 3000, appliesTo: 'hardware' },
    { id: 'no-ctrl-ps5', label: 'Missing controller (PS5)', amount: 5000, appliesTo: 'hardware' },
    { id: 'no-joycon-s2', label: 'Missing Joy-Cons (Switch 2)', amount: 11000, appliesTo: 'hardware' },
    { id: 'no-joycon-s1', label: 'Missing Joy-Cons (Switch 1)', amount: 6500, appliesTo: 'hardware' },
    { id: 'no-ctrl-xone', label: 'Missing controller (Xbox One)', amount: 4000, appliesTo: 'hardware' },
    { id: 'no-ctrl-xseries', label: 'Missing controller (Xbox Series)', amount: 5000, appliesTo: 'hardware' },
    { id: 'no-ctrl-vb', label: 'Missing controller (Virtual Boy)', amount: 14500, appliesTo: 'hardware' },
    { id: 'no-gamepad-wiiu', label: 'Missing Wii U GamePad or console', amount: 7000, appliesTo: 'hardware' },
  ],
  guide: {
    enabled: true,
    deadGames: [
      'Final Fantasy XI', 'Final Fantasy XI Online', 'MAG', 'SOCOM U.S. Navy SEALs Confrontation', 'SOCOM Confrontation',
      'Defiance', 'Lawbreakers', 'Starblood Arena', 'Battleborn', 'Evolve', "Babylon's Fall", 'The Crew',
      'The Crew Wild Run Edition', 'Rocket Arena', 'Anthem', 'Concord',
    ],
    lowValueTitles: ['Destiny'],
    accessoryKeywords: ['Kinect', 'PlayStation Move', 'EyeToy', 'Wii Fit', 'DJ Hero', 'Band Hero', 'SingStar', 'Karaoke'],
    sportsKeywords: ['Madden', 'FIFA', 'NBA', 'NFL', 'NHL', 'MLB', 'NCAA', 'PGA', 'Tiger Woods', 'NASCAR',
      'Football', 'Basketball', 'Baseball', 'Hockey', 'Golf', 'Soccer'],
    sportsExceptions: ['Wii Sports', 'NFL Street', 'NBA Street', 'NFL Blitz'],
  },
  shopName: 'Play2Win Games',
  quoteFooter: 'Offer valid today only and subject to inspection. A valid photo ID is required for any console or handheld with a serial number.',
};

// Cash prices from the Game Buying Guide. Consoles/handhelds: [name, complete, console only, parts].
// Accessories: [name, working, parts].
const SEED_HARDWARE = {
  console: [
    ['PS1 / PSOne (PlayStation 1)', 35, 15, 5], ['PS2 Fat / Slim (PlayStation 2)', 65, 20, 5],
    ['PS3 2 USB Port (PlayStation 3)', 55, 25, 5], ['PS3 Backwards Compatible 4 USB Port – A (PlayStation 3)', 200, 150, 20],
    ['PS3 Backwards Compatible 4 USB Port – E (PlayStation 3)', 150, 100, 15], ['PS4 (PlayStation 4)', 45, 25, 5],
    ['PS4 Pro (PlayStation 4)', 65, 45, 5], ['PS5 Digital (PlayStation 5)', 210, 90, 20], ['PS5 Disc (PlayStation 5)', 250, 120, 30],
    ['Xbox Original', 60, 30, 10], ['Xbox 360 Fat – HDMI', 40, 15, 5], ['Xbox 360 Fat – Non-HDMI', 15, 10, 5],
    ['Xbox 360 Slim / E', 45, 20, 5], ['Xbox One', 25, 10, 5], ['Xbox One S', 65, 35, 5], ['Xbox One X', 75, 45, 5],
    ['Xbox Series S', 160, 100, 30], ['Xbox Series X', 225, 160, 40],
    ['NES Top Loader (Nintendo)', 70, 50, 5], ['NES (Nintendo Entertainment System)', 40, 20, 5],
    ['SNES Jr. (Super Nintendo)', 50, 30, 5], ['SNES (Super Nintendo)', 40, 20, 5], ['N64 (Nintendo 64)', 30, 15, 5],
    ['GameCube', 65, 40, 5], ['Wii – GameCube Compatible', 60, 20, 5], ['Wii – Non-GameCube', 50, 15, 5], ['Wii Mini', 50, 15, 5],
    ['Wii U (GamePad + System)', 75, 25, 5], ['Nintendo Switch', 75, 20, 5], ['Nintendo Switch OLED', 100, 30, 10],
    ['Nintendo Switch 2', 260, 60, 30], ['Nintendo Virtual Boy', 175, 30, 10],
    ['Sega Genesis', 25, 10, 5], ['Sega Dreamcast', 60, 30, 5], ['Sega Saturn', 80, 50, 5], ['Sega CD Model 1', 140, 120, 20],
    ['Sega CD Model 2', 70, 50, 10], ['Sega 32X', 70, 50, 5], ['Sega Master System 1', 40, 20, 5], ['Sega Master System 2', 50, 30, 5],
    ['Atari 2600', 30, 10, 5], ['Atari 5200', 50, 10, 5], ['Atari 7800', 50, 10, 5], ['Atari Jaguar', 180, 140, 5],
    ['ColecoVision', 50, 10, 5], ['Intellivision', 50, 40, 5], ['TurboGrafx-16', 130, 40, 5], ['Vectrex', 225, 100, 25],
  ],
  handheld: [
    ['PS Portal (PlayStation)', 65, 50, 5], ['PSP (PlayStation Portable)', 50, 35, 5], ['PS Vita (PlayStation Vita)', 80, 65, 5],
    ['Nintendo Switch Lite', 60, 40, 5], ['Game Boy Original (DMG)', 30, 30, 5], ['Game Boy Pocket', 30, 30, 5],
    ['Game Boy Color (GBC)', 40, 40, 5], ['Game Boy Advance (GBA)', 40, 40, 5], ['Game Boy Advance SP (GBA SP)', 50, 35, 5],
    ['Game Boy Micro', 75, 70, 5], ['Nintendo DS', 40, 25, 5], ['Nintendo DS Lite', 40, 25, 5], ['Nintendo DSi', 30, 15, 5],
    ['Nintendo DSi XL', 50, 35, 5], ['Nintendo 2DS', 60, 45, 5], ['Nintendo 2DS XL', 70, 55, 5], ['Nintendo 3DS', 100, 85, 5],
    ['Nintendo 3DS XL', 130, 115, 5], ['New Nintendo 2DS XL', 100, 85, 5], ['New Nintendo 3DS', 140, 125, 5],
    ['New Nintendo 3DS XL', 150, 135, 5], ['Sega Nomad', 125, 75, 5], ['Sega Game Gear', 25, 25, 5], ['Atari Lynx / Lynx 2', 80, 80, 5],
  ],
  accessory: [
    ['PS5 Controller (DualSense)', 20, 2], ['PS4 Controller (DualShock 4)', 15, 2], ['PS3 Controller (DualShock 3)', 15, 2],
    ['PS2 Wired Controller (DualShock 2)', 15, 1], ['PS1 Standard Wired Controller', 5, 1], ['PS1 DualShock Wired Controller', 10, 1],
    ['Xbox Series Controller', 20, 2], ['Xbox Elite Series 2 Controller', 25, 3], ['Xbox Elite Series 1 Controller', 20, 2],
    ['Xbox One Wireless Controller', 15, 2], ['Xbox 360 Wireless Controller', 15, 1], ['Xbox Original Controller (OG)', 10, 1],
    ['GameCube Controller (GC)', 20, 1], ['GameCube WaveBird Controller w/ Dongle', 40, 1], ['Switch 2 Pro Controller', 35, 4],
    ['Switch Pro Controller', 15, 2], ['Switch 2 Joy-Con (1)', 20, 2], ['Switch Joy-Con (1)', 10, 2],
    ['Switch GameCube Controller', 35, 5], ['Wii Remote', 10, 2], ['Wii Remote Motion Plus (M+)', 15, 2],
    ['Wii Motion Plus Adapter (M+)', 5, 1], ['Wii Nunchuk', 5, 0], ['Wii Classic Controller', 10, 1], ['Wii U Pro Controller', 5, 1],
    ['N64 Controller', 10, 1], ['SNES Controller', 5, 1], ['NES Controller', 3, 0], ['NES Zapper', 3, 1],
    ['Dreamcast Controller', 20, 1], ['Saturn Controller', 20, 1], ['Genesis 3-Button Controller', 3, 0],
    ['Genesis 6-Button Controller', 4, 1], ['Atari Joystick', 5, 1], ['TurboGrafx-16 Turbo Pad', 10, 1], ['PC Engine Controller', 10, 1],
    ['GameCube Memory Card', 5, 0], ['GameCube Memory Card (3rd Party)', 5, 0], ['N64 Memory Card (Controller Pak)', 5, 0],
    ['N64 Memory Card (3rd Party)', 5, 0], ['PS1 Memory Card', 5, 0], ['PS1 Memory Card (3rd Party)', 5, 0],
    ['PS2 Memory Card', 5, 0], ['PS2 Memory Card (3rd Party)', 5, 0], ['PSP Memory Card / Stick', 5, 0],
    ['PS Vita Memory Card', 5, 0], ['Xbox Memory Unit', 5, 0], ['Dreamcast Memory Card', 5, 0], ['Dreamcast VMU', 15, 1],
    ['N64 Rumble Pak', 5, 0], ['N64 Expansion Pak', 20, 2], ['N64 Transfer Pak', 5, 1], ['Super Game Boy', 10, 1],
    ['Game Boy Player (GameCube)', 15, 0],
  ],
};

// Fake sample products used until an API token is saved (same shape as the PriceCharting API).
const DEMO_PRODUCTS = [
  { id: 'demo-1', 'product-name': 'Super Mario 64', 'console-name': 'Nintendo 64', upc: '045496870010', genre: 'Platformer', 'loose-price': 3150, 'cib-price': 8900, 'new-price': 52000, 'retail-loose-buy': 1900, 'retail-cib-buy': 5300, 'retail-new-buy': 31000 },
  { id: 'demo-2', 'product-name': 'Zelda Ocarina of Time', 'console-name': 'Nintendo 64', upc: '045496870027', genre: 'Action & Adventure', 'loose-price': 3800, 'cib-price': 11500, 'new-price': 61000, 'retail-loose-buy': 2300, 'retail-cib-buy': 6900, 'retail-new-buy': 36500 },
  { id: 'demo-3', 'product-name': 'Pokemon Emerald', 'console-name': 'GameBoy Advance', upc: '045496736897', genre: 'RPG', 'loose-price': 11000, 'cib-price': 29500, 'new-price': 98000, 'retail-loose-buy': 6600, 'retail-cib-buy': 17700, 'retail-new-buy': 58800 },
  { id: 'demo-4', 'product-name': 'Halo 3', 'console-name': 'Xbox 360', upc: '882224445508', genre: 'FPS', 'loose-price': 450, 'cib-price': 800, 'new-price': 2600, 'retail-loose-buy': 200, 'retail-cib-buy': 450, 'retail-new-buy': 1500 },
  { id: 'demo-5', 'product-name': 'Grand Theft Auto V', 'console-name': 'Playstation 4', upc: '710425474506', genre: 'Action & Adventure', 'loose-price': 1100, 'cib-price': 1400, 'new-price': 2400, 'retail-loose-buy': 600, 'retail-cib-buy': 800, 'retail-new-buy': 1400 },
  { id: 'demo-6', 'product-name': 'Mario Kart 8 Deluxe', 'console-name': 'Nintendo Switch', upc: '045496590420', genre: 'Racing', 'loose-price': 3100, 'cib-price': 3500, 'new-price': 4600, 'retail-loose-buy': 1900, 'retail-cib-buy': 2100, 'retail-new-buy': 2800 },
  { id: 'demo-7', 'product-name': 'Madden NFL 08', 'console-name': 'Playstation 2', upc: '014633154765', genre: 'Football', 'loose-price': 150, 'cib-price': 250, 'new-price': 1200, 'retail-loose-buy': 50, 'retail-cib-buy': 100, 'retail-new-buy': 700 },
  { id: 'demo-8', 'product-name': 'Wii Sports', 'console-name': 'Wii', upc: '045496901134', genre: 'Sports', 'loose-price': 500, 'cib-price': 900, 'new-price': 3500, 'retail-loose-buy': 250, 'retail-cib-buy': 500, 'retail-new-buy': 2100 },
  { id: 'demo-9', 'product-name': 'Kingdom Hearts', 'console-name': 'Playstation 2', upc: '662248900971', genre: 'RPG', 'loose-price': 900, 'cib-price': 1600, 'new-price': 6500 },
  { id: 'demo-10', 'product-name': 'God of War', 'console-name': 'Playstation 2', upc: '711719735728', genre: 'Action & Adventure', 'loose-price': 1450, 'cib-price': 2100, 'new-price': 9000, 'retail-loose-buy': 800, 'retail-cib-buy': 1200, 'retail-new-buy': 5400 },
  { id: 'demo-11', 'product-name': 'Kinect Adventures', 'console-name': 'Xbox 360', upc: '885370201915', genre: 'Party', 'loose-price': 300, 'cib-price': 500, 'new-price': 1500, 'retail-loose-buy': 100, 'retail-cib-buy': 250, 'retail-new-buy': 900 },
  { id: 'demo-12', 'product-name': 'Anthem', 'console-name': 'Playstation 4', upc: '014633736977', genre: 'Action & Adventure', 'loose-price': 250, 'cib-price': 350, 'new-price': 900, 'retail-loose-buy': 100, 'retail-cib-buy': 150, 'retail-new-buy': 500 },
];

/* ================================================================== helpers */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const clone = (o) => JSON.parse(JSON.stringify(o));
const money = (c) => (c == null ? '—' : (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
const plain = (c) => (c == null ? '' : (c / 100).toFixed(2));
const pctText = (n) => Number(Number(n).toFixed(4)); // 66.666… -> 66.6667 for display
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = (text) => String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

// Dollars text -> cents. Empty -> null, garbage -> NaN.
function parseMoney(str) {
  const s = String(str ?? '').replace(/[$,\s]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
}

// Title matching: lowercase, no accents or punctuation. baseTitle also drops [edition] / (variant) text.
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const baseTitle = (s) => norm(String(s || '').replace(/\[[^\]]*\]|\([^)]*\)/g, ' '));
const hasPhrase = (text, phrase) => { const p = norm(phrase); return !!p && ` ${text} `.includes(` ${p} `); };

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage unavailable - trade just won't survive a refresh */ }
  },
};

function mergeSettings(saved) {
  const s = clone(DEFAULT_SETTINGS);
  if (!saved || typeof saved !== 'object') return s;
  for (const k of ['defaultCondition', 'roundMode', 'roundStep', 'lowValue', 'shopName', 'quoteFooter']) {
    if (saved[k] !== undefined) s[k] = saved[k];
  }
  if (saved.version >= 2) { // version 1 saves used a different percentage format - keep the new defaults
    for (const cat of Object.keys(s.rules)) Object.assign(s.rules[cat], saved.rules?.[cat] || {});
    if (Array.isArray(saved.deductions)) s.deductions = saved.deductions;
    Object.assign(s.guide, saved.guide || {});
  }
  // Version 3: game cash changed from half of the PriceCharting price to the price ÷ 1.5.
  if (saved.version < 3 && s.rules.game.cashPct === 50) s.rules.game.cashPct = GAME_CASH_PCT;
  return s;
}

let toastTimer;
function toast(msg, kind = 'info') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, kind === 'error' ? 6000 : 2500);
}

/* ================================================================== state */

let settings = clone(DEFAULT_SETTINGS);
let hardware = [];
let tokenSet = false;
let hwDirty = false;
let currentView = 'trade';
// auth.enabled is true on the website (api.php), false on the shop PC's local server.
const auth = { enabled: false, role: null, mode: 'login' };
const isManager = () => auth.role === 'manager';
const trade = store.get('p2w-trade', null) || { customer: '', lines: [] };
trade.lines = trade.lines.filter((l) => !l.pending); // drop lookups interrupted by a reload

/* ================================================================== server + PriceCharting */

// Both servers answer at api.php?route=... (the local PowerShell server maps it too).
async function api(route, { method = 'GET', body, params } = {}) {
  const query = new URLSearchParams({ route, ...params });
  let res;
  try {
    res = await fetch(`api.php?${query}`, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(auth.enabled
      ? 'Cannot reach the website. Check the internet connection.'
      : 'Cannot reach the calculator server. Is the "Start Trade-In Calculator" window still open?');
  }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }
  if (res.status === 401 && auth.enabled && route !== 'login') {
    auth.role = null;
    showAuth('login');
    throw new Error('Your login expired. Please log in again.');
  }
  if (!res.ok || data?.status === 'error') {
    throw new Error(data?.['error-message'] || `Request failed (HTTP ${res.status})`);
  }
  return data;
}

const Demo = {
  async byUpc(upc) {
    await delay(350);
    const p = DEMO_PRODUCTS.find((d) => d.upc === upc);
    if (!p) throw new Error('No product matches that UPC (demo data).');
    return p;
  },
  async byId(id) { await delay(350); return DEMO_PRODUCTS.find((d) => d.id === id); },
  async search(q) {
    await delay(350);
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return DEMO_PRODUCTS.filter((p) => words.every((w) => `${p['product-name']} ${p['console-name']}`.toLowerCase().includes(w)));
  },
};

const PC = {
  async byUpc(upc) {
    if (!tokenSet) return Demo.byUpc(upc);
    const d = await api('pc/product', { params: { upc } });
    if (!d?.id) throw new Error('No PriceCharting product matches that UPC.');
    return d;
  },
  async byId(id) {
    if (!tokenSet) return Demo.byId(id);
    return api('pc/product', { params: { id } });
  },
  async search(q) {
    if (!tokenSet) return Demo.search(q);
    const d = await api('pc/products', { params: { q } });
    return d?.products || [];
  },
};

function slimProduct(p) {
  const prices = {};
  for (const k of PRICE_KEYS) if (p[k] != null && p[k] !== '') prices[k] = Number(p[k]);
  return {
    id: String(p.id), name: p['product-name'] || 'Unknown item', platform: p['console-name'] || '',
    upc: p.upc || '', genre: p.genre || '', prices,
  };
}

function guessCategory(name) {
  const n = name.toLowerCase();
  if (/\b(controller|joy-?cons?|remote|nunchuk|memory card|adapter|cable|charger|headset|dock)\b/.test(n)) return 'accessory';
  if (/\b(console|system)\b/.test(n)) {
    return /game ?boy|\bds\b|\b[23]ds\b|\bdsi\b|psp|vita|game gear|switch lite/.test(n) ? 'handheld' : 'console';
  }
  return /pok[eé]mon/.test(n) ? 'pokemon' : 'game';
}

/* ================================================================== buying guide */

// Why a game counts as a low-value ("shitbox") game per the guide, or null.
function autoShitboxReason(line, g = settings.guide) {
  const text = norm(line.name);
  if (g.lowValueTitles.some((t) => hasPhrase(text, t))) return 'guide-list game';
  const acc = g.accessoryKeywords.find((k) => hasPhrase(text, k));
  if (acc) return `${acc} game`;
  const sportsGenre = /sport|football|basketball|baseball|hockey|golf|soccer/i.test(line.genre || '');
  const sportsName = g.sportsKeywords.some((k) => hasPhrase(text, k));
  const exception = g.sportsExceptions.some((t) => { const n = norm(t); return n && (text === n || text.startsWith(`${n} `)); });
  if ((sportsGenre || sportsName) && !exception) return 'sports game';
  return null;
}

function shitboxReason(line, g) {
  if (line.guideFlag === 'normal') return null;
  if (line.guideFlag === 'shitbox') return 'shitbox game';
  return autoShitboxReason(line, g);
}

// Applies the Game Buying Guide to a PriceCharting game line.
// Returns null (price normally), { dontBuy, note }, { flat, note } (fixed offer in cents), or { info, note }.
function guideCheck(line, s) {
  const g = s.guide;
  if (!g.enabled || line.source !== 'pc' || !isGameCat(line.category)) return null;
  if (/\bpc games?\b/.test(norm(line.platform))) return { dontBuy: true, note: "PC game – we don't buy PC games" };
  const title = baseTitle(line.name);
  if (g.deadGames.some((t) => baseTitle(t) === title)) return { dontBuy: true, note: 'Dead game – do not buy' };

  const reason = shitboxReason(line, g);
  const loose = line.prices?.['loose-price'];
  const condMarket = line.prices?.[PC_FIELDS.market[line.condition]];
  const discOnly = line.condition === 'loose' && DISC_PLATFORM_RE.test(norm(line.platform));

  if (discOnly) {
    if (loose > 2000) return reason ? { info: true, note: `${reason}, but over $20 – priced normally` } : null;
    if (reason) return { flat: 10, note: `Disc-only ${reason} → $0.10` };
    if (loose > 0 && loose < 1000) return { flat: 50, note: 'Disc-only under $10 → $0.50' };
    if (loose >= 1000) return { flat: 100, note: 'Disc-only $10–$20 → $1.00' };
    return null;
  }
  if (reason && line.condition !== 'loose') {
    if (condMarket > 2000) return { info: true, note: `${reason}, but over $20 – priced normally` };
    return { flat: 25, note: `${reason} in box → $0.25` };
  }
  return null;
}

/* ================================================================== pricing */

const hwItem = (line) => hardware.find((h) => h.id === line.hwId);

function autoBase(line, rule) {
  if (line.source === 'pc') {
    const v = line.prices?.[PC_FIELDS[rule.basis || 'retail-buy'][line.condition]];
    return v > 0 ? v : null;
  }
  if (line.source === 'hw') {
    const v = (hwItem(line) || line.hwPrices || {})[line.condition];
    return v ?? null;
  }
  return null;
}

// Hardware bought for parts is a flat parts price: missing cables/controllers don't matter,
// and there's no store credit bump (credit = cash).
const isPartsLine = (line) => line.source === 'hw' && line.condition === 'parts';
const takesDeductions = (line) => !isPartsLine(line);

function lineDeductions(line, s = settings) {
  if (!takesDeductions(line)) return []; // kept on the line in case it's switched back from Parts
  return (line.deductions || []).map((id) => s.deductions.find((d) => d.id === id)).filter(Boolean);
}

function roundOffer(cents, s) {
  const step = Number(s.roundStep) || 1;
  const fn = s.roundMode === 'nearest' ? Math.round : Math.floor;
  return fn(cents / step + 1e-9) * step;
}

// value = item value (PriceCharting price or guide price) minus deductions; cash/credit = value x category %.
// Guide flat amounts (disc-only, shitbox, $0.25 stack) are paid as-is in both cash and credit.
function priceLine(line, s = settings) {
  const out = { base: null, cash: null, credit: null, guide: null, flat: false, dontBuy: false };
  if (line.pending || line.failed) return out;
  const rule = s.rules[line.category] || s.rules.other;
  out.base = line.override ?? autoBase(line, rule);
  const deds = lineDeductions(line, s);
  const dedTotal = deds.reduce((sum, d) => sum + d.amount, 0);
  // Guide rules run first: their tiers use the market price, so they work even without a retail buy price.
  out.guide = line.override == null ? guideCheck(line, s) : null;

  if (out.guide?.dontBuy) {
    Object.assign(out, { cash: 0, credit: 0, dontBuy: true });
    return out;
  }
  if (out.guide?.flat != null) {
    // Guide: outliers that need resurfacing are divided by 5.
    let flat = out.guide.flat;
    if (deds.some((d) => d.resurface)) {
      flat = Math.floor(flat / 5);
      out.guide = { ...out.guide, note: `${out.guide.note}, ÷5 for resurfacing = ${money(flat)}` };
    }
    Object.assign(out, { cash: flat, credit: flat, flat: true });
    return out;
  }
  if (out.base == null) return out;
  const value = out.base - dedTotal;
  if (isGameCat(line.category) && dedTotal > 0 && value < 25) {
    out.guide = { note: 'Deductions exceed value → $0.25 stack' };
    Object.assign(out, { cash: 25, credit: 25, flat: true });
    return out;
  }
  out.cash = roundOffer((Math.max(0, value) * rule.cashPct) / 100, s);
  out.credit = isPartsLine(line) ? out.cash : roundOffer((Math.max(0, value) * rule.creditPct) / 100, s);
  return out;
}

/* ================================================================== trade lines */

function saveTrade() { store.set('p2w-trade', trade); }

function commit() {
  saveTrade();
  renderLines();
}

function flash(id) {
  const tr = $(`#lineBody tr[data-id="${id}"]`);
  if (!tr) return;
  tr.classList.remove('flash');
  void tr.offsetWidth;
  tr.classList.add('flash');
}

const isPlain = (l) => l.override == null && !(l.deductions || []).length && !l.guideFlag;

function placeLine(line, replaceId) {
  const i = replaceId ? trade.lines.findIndex((l) => l.id === replaceId) : -1;
  if (i >= 0) trade.lines[i] = line;
  else trade.lines.unshift(line);
}

function addPcProduct(raw, condition, replaceId = null) {
  const p = slimProduct(raw);
  const same = trade.lines.find((l) => l.source === 'pc' && l.pcId === p.id && l.condition === condition && isPlain(l) && l.id !== replaceId);
  if (same) {
    same.qty += 1;
    if (replaceId) trade.lines = trade.lines.filter((l) => l.id !== replaceId);
    commit();
    flash(same.id);
    return;
  }
  const line = {
    id: replaceId || uid(), source: 'pc', pcId: p.id, name: p.name, platform: p.platform, upc: p.upc, genre: p.genre,
    prices: p.prices, condition, category: guessCategory(p.name), qty: 1, override: null, deductions: [],
  };
  placeLine(line, replaceId);
  commit();
  flash(line.id);
}

function defaultHwCondition(hw) {
  return Object.keys(hwConditionLabels(hw.category)).find((f) => hw[f] != null) || Object.keys(hwConditionLabels(hw.category))[0];
}

function addHardware(hw, condition = defaultHwCondition(hw)) {
  const same = trade.lines.find((l) => l.source === 'hw' && l.hwId === hw.id && l.condition === condition && isPlain(l));
  if (same) {
    same.qty += 1;
    commit();
    flash(same.id);
    return;
  }
  const line = {
    id: uid(), source: 'hw', hwId: hw.id, name: hw.name, category: hw.category, condition, qty: 1, override: null, deductions: [],
    hwPrices: { complete: hw.complete, unit: hw.unit, parts: hw.parts },
  };
  trade.lines.unshift(line);
  commit();
  flash(line.id);
}

function addCustom() {
  const line = { id: uid(), source: 'custom', name: '', category: 'other', qty: 1, override: null, deductions: [] };
  trade.lines.unshift(line);
  commit();
  $(`#lineBody tr[data-id="${line.id}"] [data-field="name"]`)?.focus();
}

function addPending(label) {
  const line = { id: uid(), pending: true, name: label, qty: 1, category: 'game' };
  trade.lines.unshift(line);
  commit();
  return line;
}

async function scanUpc(code) {
  const pending = addPending(`Looking up ${code}…`);
  try {
    let product;
    try {
      product = await PC.byUpc(code);
    } catch (err) {
      // EAN-13 barcodes with a leading 0 are UPC-A codes with an extra digit.
      if (code.length === 13 && code.startsWith('0')) product = await PC.byUpc(code.slice(1));
      else throw err;
    }
    if (!trade.lines.some((l) => l.id === pending.id)) return; // trade was cleared meanwhile
    addPcProduct(product, settings.defaultCondition, pending.id);
  } catch (err) {
    const line = trade.lines.find((l) => l.id === pending.id);
    if (!line) return;
    Object.assign(line, { pending: false, failed: true, name: `No match for UPC ${code}`, error: err.message });
    commit();
  }
}

// Search results may lack some price fields; fetch the full product before adding.
async function addFromSearch(raw, condition) {
  if (!tokenSet || PRICE_KEYS.every((k) => k in raw)) {
    addPcProduct(raw, condition);
    return;
  }
  const pending = addPending(`Loading ${raw['product-name'] || 'item'}…`);
  let full = raw;
  try {
    full = { ...raw, ...(await PC.byId(raw.id)) };
  } catch (err) {
    toast(`Couldn't load full prices: ${err.message}`, 'error');
  }
  if (trade.lines.some((l) => l.id === pending.id)) addPcProduct(full, condition, pending.id);
}

function conditionLabel(line) {
  if (line.source === 'pc') return GAME_CONDITIONS[line.condition];
  if (line.source === 'hw') return hwConditionLabels((hwItem(line) || line).category)[line.condition] || '';
  return '';
}

function refLine(line) {
  const p = line.prices || {};
  const fmt = (basis) => Object.entries(PC_FIELDS[basis]).map(([c, k]) => `${GAME_CONDITIONS[c]} ${money(p[k] > 0 ? p[k] : null)}`).join(' · ');
  return `Retail buy: ${fmt('retail-buy')}<br>Market: ${fmt('market')}`;
}

function conditionSelect(line) {
  let opts;
  if (line.source === 'pc') {
    opts = GAME_CONDITIONS;
  } else if (line.source === 'hw') {
    const hw = hwItem(line) || { ...line.hwPrices, category: line.category };
    opts = Object.fromEntries(Object.entries(hwConditionLabels(hw.category)).filter(([f]) => hw[f] != null || f === line.condition));
  } else {
    return '<span class="muted">—</span>';
  }
  return `<select data-field="condition">${Object.entries(opts)
    .map(([v, label]) => `<option value="${v}"${v === line.condition ? ' selected' : ''}>${label}</option>`).join('')}</select>`;
}

function adjustHtml(line) {
  const chips = lineDeductions(line).map((d) => `<span class="chip">${esc(d.label)} −${money(d.amount)}<button type="button" data-action="undeduct" data-ded="${esc(d.id)}" aria-label="Remove">×</button></span>`);
  if (line.guideFlag) {
    chips.push(`<span class="chip">${line.guideFlag === 'shitbox' ? 'Marked as shitbox game' : 'Priced normally'}<button type="button" data-action="unflag" aria-label="Undo">×</button></span>`);
  }
  const applied = new Set(line.deductions || []);
  const target = isGameCat(line.category) ? 'game' : 'hardware';
  const dedOpts = settings.deductions.filter((d) => takesDeductions(line) && d.appliesTo === target && !applied.has(d.id))
    .map((d) => `<option value="ded:${esc(d.id)}">${esc(d.label)} (−${money(d.amount)})</option>`).join('');
  let guideOpt = '';
  if (line.source === 'pc' && isGameCat(line.category) && settings.guide.enabled && !line.guideFlag) {
    guideOpt = autoShitboxReason(line)
      ? '<option value="flag:normal">Not a shitbox game – price normally</option>'
      : '<option value="flag:shitbox">Mark as shitbox game</option>';
  }
  const select = dedOpts || guideOpt
    ? `<select class="adjust-select" data-field="adjust" aria-label="Add deduction or adjustment"><option value="">+ Deduction…</option>${dedOpts ? `<optgroup label="Deductions">${dedOpts}</optgroup>` : ''}${guideOpt ? `<optgroup label="Buying guide">${guideOpt}</optgroup>` : ''}</select>`
    : '';
  return `<div class="adjust">${chips.join('')}${select}</div>`;
}

function rowHtml(line) {
  const removeBtn = '<button type="button" class="icon-btn" data-action="remove" title="Remove" aria-label="Remove">×</button>';
  if (line.pending) {
    return `<tr data-id="${line.id}" class="pending"><td colspan="7"><span class="spinner"></span>${esc(line.name)}</td><td>${removeBtn}</td></tr>`;
  }
  if (line.failed) {
    return `<tr data-id="${line.id}" class="failed"><td colspan="7"><strong>${esc(line.name)}</strong>
      <div class="sub">${esc(line.error)} Try typing the name instead.</div></td><td>${removeBtn}</td></tr>`;
  }
  const catOpts = Object.entries(CATEGORIES)
    .map(([v, label]) => `<option value="${v}"${v === line.category ? ' selected' : ''}>${esc(label)}</option>`).join('');
  let item;
  if (line.source === 'custom') {
    item = `<input type="text" class="name-input" data-field="name" value="${esc(line.name)}" placeholder="Describe the item">`;
  } else if (line.source === 'hw') {
    item = `<div class="item-name">${esc(line.name)}</div><div class="sub">Buying guide price</div>`;
  } else {
    item = `<div class="item-name">${esc(line.name)}</div>
      <div class="sub">${esc(line.platform)}${line.upc ? ` · UPC ${esc(line.upc)}` : ''}</div>
      <div class="ref">${refLine(line)}</div>`;
  }
  return `<tr data-id="${line.id}">
    <td class="item">${item}<div class="flags" data-cell="flags"></div>${adjustHtml(line)}</td>
    <td><select data-field="category">${catOpts}</select></td>
    <td>${conditionSelect(line)}</td>
    <td class="num"><input type="number" class="qty" data-field="qty" min="1" step="1" value="${line.qty}"></td>
    <td class="num value-cell"><span class="money-input"><span>$</span><input type="text" data-field="value" inputmode="decimal" autocomplete="off" placeholder="Price"></span><button type="button" class="reset" data-action="reset" title="Back to automatic price" hidden>↺ auto</button></td>
    <td class="num cash" data-cell="cash"></td>
    <td class="num credit" data-cell="credit"></td>
    <td>${removeBtn}</td>
  </tr>`;
}

function offerCell(each, qty) {
  if (each == null) return '<span class="muted">—</span>';
  return qty > 1 ? `${money(each * qty)}<small>${money(each)} ea.</small>` : money(each);
}

function updateRow(tr, line) {
  if (line.pending || line.failed) return;
  const p = priceLine(line);
  const input = $('[data-field="value"]', tr);
  if (document.activeElement !== input) input.value = plain(p.base);
  input.classList.toggle('overridden', line.override != null);
  input.classList.toggle('missing', p.cash == null);
  $('[data-action="reset"]', tr).hidden = line.override == null;
  tr.classList.toggle('dont-buy', p.dontBuy);
  $('[data-cell="cash"]', tr).innerHTML = offerCell(p.cash, line.qty);
  $('[data-cell="credit"]', tr).innerHTML = offerCell(p.credit, line.qty);

  const flags = [];
  if (p.cash == null) flags.push('<span class="badge warn">Needs a price</span>');
  if (p.dontBuy) flags.push(`<span class="badge danger">Don't buy: ${esc(p.guide.note)}</span>`);
  else if (p.flat) flags.push(`<span class="badge guide">Guide: ${esc(p.guide.note)}</span>`);
  else if (p.guide?.info) flags.push(`<span class="badge info">${esc(p.guide.note)}</span>`);
  if (!p.flat && !p.dontBuy && p.cash != null && p.cash < settings.lowValue) flags.push('<span class="badge low">Low value</span>');
  if (line.category === 'pokemon') flags.push('<span class="badge info">Check authenticity – fakes exist</span>');
  if (isGameCat(line.category) && p.base >= 10000) flags.push('<span class="badge info">Over $100: anything missing or damaged? Ask Keith or Mark</span>');
  if (line.override != null) flags.push('<span class="badge edited">Price edited</span>');
  $('[data-cell="flags"]', tr).innerHTML = flags.join('');
}

function renderLines() {
  const body = $('#lineBody');
  body.innerHTML = trade.lines.map(rowHtml).join('');
  for (const line of trade.lines) {
    const tr = $(`tr[data-id="${line.id}"]`, body);
    if (tr) updateRow(tr, line);
  }
  $('#emptyState').hidden = trade.lines.length > 0;
  renderTotals();
}

function refreshComputed() {
  for (const line of trade.lines) {
    const tr = $(`#lineBody tr[data-id="${line.id}"]`);
    if (tr) updateRow(tr, line);
  }
  renderTotals();
}

function tradeTotals() {
  let count = 0, cash = 0, credit = 0, missing = 0, notBuying = 0;
  for (const l of trade.lines) {
    if (l.pending || l.failed) continue;
    const p = priceLine(l);
    if (p.dontBuy) { notBuying += 1; continue; }
    count += l.qty;
    if (p.cash == null) { missing += 1; continue; }
    cash += p.cash * l.qty;
    credit += p.credit * l.qty;
  }
  return { count, cash, credit, missing, notBuying };
}

function renderTotals() {
  const t = tradeTotals();
  $('#itemCount').textContent = t.count;
  $('#totalCash').textContent = money(t.cash);
  $('#totalCredit').textContent = money(t.credit);
  const notes = [];
  if (t.missing) notes.push(`${t.missing} need${t.missing === 1 ? 's' : ''} a price`);
  if (t.notBuying) notes.push(`${t.notBuying} not buying`);
  const warn = $('#needsPrice');
  warn.hidden = !notes.length;
  warn.textContent = notes.map((n) => ` · ${n}`).join('');
}

function onLineChange(e) {
  const tr = e.target.closest('tr[data-id]');
  const line = tr && trade.lines.find((l) => l.id === tr.dataset.id);
  const field = e.target.dataset.field;
  if (!line || !field) return;
  const v = e.target.value;
  if (field === 'adjust') {
    const i = v.indexOf(':');
    const kind = v.slice(0, i);
    const val = v.slice(i + 1);
    if (kind === 'ded') line.deductions = [...(line.deductions || []), val];
    if (kind === 'flag') line.guideFlag = val;
    commit();
    return;
  }
  if (field === 'category') {
    line.category = v;
    const target = isGameCat(v) ? 'game' : 'hardware';
    line.deductions = (line.deductions || []).filter((id) => settings.deductions.find((d) => d.id === id)?.appliesTo === target);
    if (!isGameCat(v)) delete line.guideFlag;
    commit();
    return;
  }
  if (field === 'qty') {
    line.qty = Math.max(1, parseInt(v, 10) || 1);
    e.target.value = line.qty;
  } else if (field === 'value') {
    const auto = autoBase(line, settings.rules[line.category] || settings.rules.other);
    const cents = parseMoney(v);
    if (Number.isNaN(cents)) toast('Enter a price like 12.50', 'error');
    else line.override = cents == null || cents === auto ? null : cents;
    e.target.value = plain(line.override ?? auto);
  } else if (field === 'condition') {
    line.condition = v;
    if (line.source === 'hw') { commit(); return; } // Parts hides/shows the deduction menu
  } else if (field === 'name') {
    line.name = v.trim();
  }
  saveTrade();
  updateRow(tr, line);
  renderTotals();
}

function onLineClick(e) {
  const btn = e.target.closest('[data-action]');
  const tr = btn?.closest('tr[data-id]');
  if (!tr) return;
  const line = trade.lines.find((l) => l.id === tr.dataset.id);
  const action = btn.dataset.action;
  if (action === 'remove') {
    trade.lines = trade.lines.filter((l) => l.id !== tr.dataset.id);
    commit();
    focusScan();
    return;
  }
  if (!line) return;
  if (action === 'reset') {
    line.override = null;
    saveTrade();
    updateRow(tr, line);
    renderTotals();
  } else if (action === 'undeduct') {
    line.deductions = (line.deductions || []).filter((id) => id !== btn.dataset.ded);
    commit();
  } else if (action === 'unflag') {
    delete line.guideFlag;
    commit();
  }
}

/* ================================================================== scan / search box */

const search = { q: '', hw: [], pc: null, loading: false, error: null, active: -1, items: [], seq: 0 };

function focusScan() {
  if (currentView === 'trade') $('#scanInput').focus();
}

function matchHardware(q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return hardware
    .filter((h) => h.name && words.every((w) => `${h.name} ${CATEGORIES[h.category] || ''}`.toLowerCase().includes(w)))
    .slice(0, 10);
}

function closeResults() {
  search.seq += 1;
  Object.assign(search, { q: '', hw: [], pc: null, loading: false, error: null, active: -1 });
  renderResults();
}

async function runPcSearch(q) {
  const seq = ++search.seq;
  Object.assign(search, { q, hw: matchHardware(q), pc: null, loading: true, error: null, active: -1 });
  renderResults();
  try {
    const results = await PC.search(q);
    if (seq !== search.seq) return;
    search.pc = results;
  } catch (err) {
    if (seq !== search.seq) return;
    search.error = err.message;
  }
  search.loading = false;
  renderResults();
}

function basisPrice(raw, cond) {
  const rule = settings.rules[guessCategory(raw['product-name'] || '')] || settings.rules.game;
  const v = raw[PC_FIELDS[rule.basis || 'retail-buy'][cond]];
  return v > 0 ? Number(v) : null;
}

function renderResults() {
  const el = $('#results');
  search.items = [];
  let html = '';

  if (search.hw.length) {
    html += '<div class="results-group">Buying guide <span>cash prices · click a condition to add</span></div>';
    for (const h of search.hw) {
      const i = search.items.push({ kind: 'hw', hw: h }) - 1;
      const conds = Object.entries(hwConditionLabels(h.category)).filter(([f]) => h[f] != null)
        .map(([f, label]) => `<button type="button" class="cond-btn" data-cond="${f}">${label} <b>${money(h[f])}</b></button>`).join('');
      html += `<div class="result" data-i="${i}">
        <div class="r-main"><div class="r-name">${esc(h.name)}</div><div class="sub">${esc(CATEGORIES[h.category])}</div></div>
        <div class="r-conds">${conds || '<span class="badge warn">No price yet</span>'}</div></div>`;
    }
  }

  if (search.loading) {
    html += '<div class="results-group">PriceCharting</div><div class="results-note"><span class="spinner"></span>Searching…</div>';
  } else if (search.error) {
    html += `<div class="results-group">PriceCharting</div><div class="results-note error">${esc(search.error)}</div>`;
  } else if (search.pc) {
    html += '<div class="results-group">PriceCharting <span>click a condition to add</span></div>';
    if (!search.pc.length) html += '<div class="results-note">No matches. Try fewer words, or add it as a custom item.</div>';
    for (const p of search.pc) {
      const i = search.items.push({ kind: 'pc', product: p }) - 1;
      const conds = Object.entries(GAME_CONDITIONS)
        .map(([c, label]) => `<button type="button" class="cond-btn" data-cond="${c}">${label} <b>${money(basisPrice(p, c))}</b></button>`).join('');
      html += `<div class="result" data-i="${i}">
        <div class="r-main"><div class="r-name">${esc(p['product-name'])}</div><div class="sub">${esc(p['console-name'])}</div></div>
        <div class="r-conds">${conds}</div></div>`;
    }
  } else if (search.q.length >= 2 && !/^\d+$/.test(search.q)) {
    html += `<div class="results-hint">Press <kbd>Enter</kbd> to search PriceCharting for “${esc(search.q)}”</div>`;
  }

  el.innerHTML = html;
  el.hidden = !html;
  $$('.result', el).forEach((r) => r.classList.toggle('active', Number(r.dataset.i) === search.active));
  $('.result.active', el)?.scrollIntoView({ block: 'nearest' });
}

function choose(item, condition) {
  const input = $('#scanInput');
  input.value = '';
  closeResults();
  input.focus();
  if (item.kind === 'hw') addHardware(item.hw, condition || defaultHwCondition(item.hw));
  else addFromSearch(item.product, condition || settings.defaultCondition);
}

function onScanKeydown(e) {
  const input = e.target;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!search.items.length) return;
    e.preventDefault();
    const n = search.items.length;
    search.active = e.key === 'ArrowDown' ? (search.active + 1) % n : (search.active - 1 + n) % n;
    renderResults();
  } else if (e.key === 'Escape') {
    input.value = '';
    closeResults();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const q = input.value.trim();
    if (search.active >= 0 && search.items[search.active]) { choose(search.items[search.active]); return; }
    if (!q) return;
    if (/^\d{8,14}$/.test(q)) {
      input.value = '';
      closeResults();
      scanUpc(q);
      return;
    }
    runPcSearch(q);
  }
}

function onScanInput(e) {
  const q = e.target.value.trim();
  search.seq += 1;
  Object.assign(search, {
    q, pc: null, loading: false, error: null, active: -1,
    hw: q.length >= 2 && !/^\d+$/.test(q) ? matchHardware(q) : [],
  });
  renderResults();
}

function onResultsClick(e) {
  const row = e.target.closest('.result');
  if (!row) return;
  const item = search.items[Number(row.dataset.i)];
  if (item) choose(item, e.target.closest('.cond-btn')?.dataset.cond);
}

/* ================================================================== hardware tab */

function hwMoneyInput(h, field, placeholder) {
  return `<span class="money-input"><span>$</span><input type="text" data-field="${field}" inputmode="decimal" value="${plain(h[field])}" placeholder="${placeholder}"></span>`;
}

function hwRowHtml(h) {
  const catOpts = HW_CATEGORIES.map((c) => `<option value="${c}"${c === h.category ? ' selected' : ''}>${esc(CATEGORIES[c])}</option>`).join('');
  const accessory = h.category === 'accessory';
  return `<tr data-id="${h.id}">
    <td><input type="text" class="name-input" data-field="name" value="${esc(h.name)}" placeholder="Item name"></td>
    <td><select data-field="category">${catOpts}</select></td>
    <td class="num">${accessory ? '<span class="muted">—</span>' : hwMoneyInput(h, 'complete', '—')}</td>
    <td class="num">${hwMoneyInput(h, 'unit', '—')}</td>
    <td class="num">${hwMoneyInput(h, 'parts', '—')}</td>
    <td><button type="button" class="icon-btn" data-action="delete" title="Delete" aria-label="Delete">×</button></td>
  </tr>`;
}

function renderHardware() {
  const words = $('#hwFilter').value.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = hardware.filter((h) => words.every((w) => `${h.name} ${CATEGORIES[h.category]}`.toLowerCase().includes(w)));
  $('#hwBody').innerHTML = shown.map(hwRowHtml).join('')
    || '<tr><td colspan="6" class="empty-cell">No items match. Use “+ Add item” to create one.</td></tr>';
  const r = settings.rules.console;
  $('#hwRuleNote').textContent = `Store credit is ${r.creditPct}% of these prices and cash is ${r.cashPct}% (change on the Settings tab). Parts pay the same in cash and credit.`;
  $('#hwSave').disabled = !hwDirty;
}

function setHwDirty(dirty) {
  hwDirty = dirty;
  $('#hwSave').disabled = !dirty;
  $('#hwSave').textContent = dirty ? 'Save changes •' : 'Save changes';
}

function onHwChange(e) {
  const tr = e.target.closest('tr[data-id]');
  const h = tr && hardware.find((x) => x.id === tr.dataset.id);
  const field = e.target.dataset.field;
  if (!h || !field) return;
  if (HW_FIELDS.includes(field)) {
    const cents = parseMoney(e.target.value);
    if (Number.isNaN(cents)) toast('Enter a price like 45.00', 'error');
    else h[field] = cents;
    e.target.value = plain(h[field]);
  } else if (field === 'name') {
    h.name = e.target.value.trim();
  } else if (field === 'category') {
    h.category = e.target.value;
    if (h.category === 'accessory') h.complete = null;
    tr.outerHTML = hwRowHtml(h);
  }
  setHwDirty(true);
  refreshComputed();
}

function sortHardware() {
  hardware.sort((a, b) => HW_CATEGORIES.indexOf(a.category) - HW_CATEGORIES.indexOf(b.category) || a.name.localeCompare(b.name));
}

async function saveHardware() {
  hardware = hardware.filter((h) => h.name);
  sortHardware();
  try {
    await api('hardware', { method: 'PUT', body: hardware });
    setHwDirty(false);
    toast('Hardware prices saved');
  } catch (err) {
    toast(`Save failed: ${err.message}`, 'error');
  }
  renderHardware();
}

function categoryFromText(s) {
  const t = String(s || '').toLowerCase();
  if (/hand/.test(t)) return 'handheld';
  if (/access|control|periph|memory/.test(t)) return 'accessory';
  if (/console|system/.test(t)) return 'console';
  if (/other|misc/.test(t)) return 'other';
  return null;
}

// Rows: Name, [Category], prices... Consoles take Complete, Console only, Parts; accessories take Working, Parts.
function applyPaste() {
  let added = 0, updated = 0, skipped = 0;
  for (const row of lines($('#hwPasteText').value)) {
    const parts = (row.includes('\t') ? row.split('\t') : row.split(',')).map((p) => p.trim());
    const name = parts.shift();
    const category = parts.length && Number.isNaN(parseMoney(parts[0])) ? categoryFromText(parts.shift()) : null;
    const nums = parts.slice(0, 3).map(parseMoney);
    if (!name || !nums.length || nums.some(Number.isNaN) || nums.every((n) => n == null)) { skipped += 1; continue; }
    let item = hardware.find((h) => h.name.toLowerCase() === name.toLowerCase());
    if (item) {
      updated += 1;
    } else {
      item = { id: uid(), name, category: category || categoryFromText(name) || 'console', complete: null, unit: null, parts: null };
      hardware.push(item);
      added += 1;
    }
    if (category) item.category = category;
    const fields = item.category === 'accessory' ? ['unit', 'parts'] : HW_FIELDS;
    fields.forEach((f, i) => { if (nums[i] !== undefined) item[f] = nums[i]; });
  }
  sortHardware();
  setHwDirty(added + updated > 0 || hwDirty);
  $('#hwPasteText').value = '';
  $('#hwPastePanel').hidden = true;
  renderHardware();
  refreshComputed();
  toast(`${added} added, ${updated} updated${skipped ? `, ${skipped} skipped (no price found)` : ''}. Click Save changes to keep them.`);
}

function seedHardware() {
  return Object.entries(SEED_HARDWARE).flatMap(([category, rows]) => rows.map(([name, ...dollars]) => {
    const cents = dollars.map((d) => Math.round(d * 100));
    const [complete, unit, parts] = category === 'accessory' ? [null, ...cents] : cents;
    return { id: uid(), name, category, complete, unit, parts };
  }));
}

/* ================================================================== settings tab */

const GUIDE_LISTS = ['deadGames', 'lowValueTitles', 'accessoryKeywords', 'sportsKeywords', 'sportsExceptions'];

function rulesFromForm() {
  const rules = clone(settings.rules);
  for (const cat of Object.keys(rules)) {
    for (const key of ['cashPct', 'creditPct']) {
      const n = Number($(`#rulesBody [name="${key}-${cat}"]`).value);
      // The box shows 4 decimals; keep the exact stored value (e.g. 100/1.5) if it wasn't changed.
      if (Number.isFinite(n) && n >= 0 && n !== pctText(rules[cat][key])) rules[cat][key] = n;
    }
    const basis = $(`#rulesBody [name="basis-${cat}"]`);
    if (basis) rules[cat].basis = basis.value;
  }
  return rules;
}

function renderRuleExamples() {
  const s = { ...settings, rules: rulesFromForm() };
  for (const cat of Object.keys(s.rules)) {
    const { cash, credit } = priceLine({ source: 'custom', category: cat, override: 1000, qty: 1 }, s);
    $(`#rulesBody [data-example="${cat}"]`).textContent = `${money(cash)} cash · ${money(credit)} credit`;
  }
}

function basisCell(cat, rule) {
  if (isGameCat(cat)) {
    return `<select name="basis-${cat}">
      <option value="retail-buy"${rule.basis === 'retail-buy' ? ' selected' : ''}>PriceCharting retail buy</option>
      <option value="market"${rule.basis === 'market' ? ' selected' : ''}>PriceCharting market</option></select>`;
  }
  return `<span class="muted">${cat === 'other' ? 'Value you type in' : 'Buying guide price'}</span>`;
}

function dedRowHtml(d) {
  return `<tr data-id="${esc(d.id)}">
    <td><input type="text" class="name-input" data-k="label" value="${esc(d.label)}" placeholder="Deduction name"></td>
    <td><select data-k="appliesTo">
      <option value="game"${d.appliesTo === 'game' ? ' selected' : ''}>Games</option>
      <option value="hardware"${d.appliesTo === 'hardware' ? ' selected' : ''}>Hardware</option></select></td>
    <td class="num"><span class="money-input"><span>−$</span><input type="text" data-k="amount" inputmode="decimal" value="${plain(d.amount)}"></span></td>
    <td class="center"><input type="checkbox" data-k="resurface"${d.resurface ? ' checked' : ''} aria-label="Counts as resurfacing"></td>
    <td><button type="button" class="icon-btn" data-action="del-ded" title="Delete" aria-label="Delete">×</button></td>
  </tr>`;
}

function deductionsFromForm() {
  return $$('#dedBody tr[data-id]').map((tr) => ({
    id: tr.dataset.id,
    label: $('[data-k="label"]', tr).value.trim(),
    appliesTo: $('[data-k="appliesTo"]', tr).value,
    amount: parseMoney($('[data-k="amount"]', tr).value) || 0,
    resurface: $('[data-k="resurface"]', tr).checked,
  })).filter((d) => d.label);
}

function fillSettingsForm() {
  const f = $('#settingsForm').elements;
  f.defaultCondition.value = settings.defaultCondition;
  f.roundMode.value = settings.roundMode;
  f.roundStep.value = String(settings.roundStep);
  f.lowValue.value = plain(settings.lowValue);
  f.shopName.value = settings.shopName;
  f.quoteFooter.value = settings.quoteFooter;
  f.guideEnabled.checked = settings.guide.enabled;
  for (const key of GUIDE_LISTS) f[key].value = settings.guide[key].join('\n');
  $('#rulesBody').innerHTML = Object.entries(settings.rules).map(([cat, rule]) => `<tr>
    <td>${esc(CATEGORIES[cat])}</td>
    <td>${basisCell(cat, rule)}</td>
    <td class="num"><span class="pct-input"><input type="number" min="0" step="any" name="cashPct-${cat}" value="${pctText(rule.cashPct)}"><span>%</span></span></td>
    <td class="num"><span class="pct-input"><input type="number" min="0" step="any" name="creditPct-${cat}" value="${pctText(rule.creditPct)}"><span>%</span></span></td>
    <td class="num muted" data-example="${cat}"></td>
  </tr>`).join('');
  $('#dedBody').innerHTML = settings.deductions.map(dedRowHtml).join('');
  renderRuleExamples();
  renderTokenStatus();
}

async function saveSettings(e) {
  e.preventDefault();
  const f = e.target.elements;
  const lowValue = parseMoney(f.lowValue.value);
  const guide = { enabled: f.guideEnabled.checked };
  for (const key of GUIDE_LISTS) guide[key] = lines(f[key].value);
  const next = {
    ...settings,
    defaultCondition: f.defaultCondition.value,
    roundMode: f.roundMode.value,
    roundStep: Number(f.roundStep.value),
    lowValue: Number.isNaN(lowValue) || lowValue == null ? 0 : lowValue,
    shopName: f.shopName.value.trim(),
    quoteFooter: f.quoteFooter.value.trim(),
    rules: rulesFromForm(),
    deductions: deductionsFromForm(),
    guide,
  };
  try {
    await api('settings', { method: 'PUT', body: next });
    settings = next;
    fillSettingsForm();
    renderLines();
    $('#settingsStatus').textContent = 'Saved ✓';
    setTimeout(() => { $('#settingsStatus').textContent = ''; }, 2500);
  } catch (err) {
    toast(`Save failed: ${err.message}`, 'error');
  }
}

function renderTokenStatus(extra = '') {
  $('#tokenStatus').textContent = extra || (tokenSet ? 'A token is saved. Paste a new one to replace it, or save a blank box to remove it.' : 'No token saved. The calculator is using demo data.');
  $('#demoBanner').hidden = tokenSet;
  $('#demoBanner [data-goto]').hidden = !isManager();
}

async function saveToken() {
  const input = $('#tokenInput');
  const token = input.value.trim();
  // PriceCharting tokens are 40 letters/numbers - catch paths or other clipboard leftovers before saving.
  if (token && !/^[A-Za-z0-9]+$/.test(token)) {
    renderTokenStatus(`That doesn't look like a PriceCharting token. It should be 40 letters and numbers, but this has ${token.length} characters including symbols or spaces${/[\\/:]/.test(token) ? ' (it looks like a file path)' : ''}. Copy the token from PriceCharting again and paste it here.`);
    return;
  }
  try {
    const r = await api('token', { method: 'PUT', body: { token } });
    tokenSet = !!r.tokenSet;
    input.value = '';
    const lengthNote = token && token.length !== 40 ? ` Note: it's ${token.length} characters; PriceCharting tokens are usually 40.` : '';
    renderTokenStatus(tokenSet ? `Token saved ✓ Click “Test connection” to check it.${lengthNote}` : 'Token removed.');
  } catch (err) {
    toast(`Couldn't save token: ${err.message}`, 'error');
  }
}

async function testToken() {
  if (!tokenSet) { renderTokenStatus('Save a token first.'); return; }
  renderTokenStatus('Testing…');
  try {
    const results = await PC.search('super mario');
    renderTokenStatus(`Connected ✓ PriceCharting returned ${results.length} results for “super mario”.`);
  } catch (err) {
    renderTokenStatus(`Connection failed: ${err.message}`);
  }
}

/* ================================================================== print */

function printQuote() {
  const items = trade.lines.filter((l) => !l.pending && !l.failed);
  if (!items.length) { toast('Add some items first.'); return; }
  const t = tradeTotals();
  const rows = items.map((l) => {
    const p = priceLine(l);
    const detail = [l.platform, conditionLabel(l), ...lineDeductions(l).map((d) => d.label)].filter(Boolean).join(' · ');
    const cell = (c) => (p.dontBuy ? 'Not buying' : c == null ? '—' : money(c * l.qty));
    return `<tr><td>${esc(l.name || 'Custom item')}${detail ? `<div class="sub">${esc(detail)}</div>` : ''}</td>
      <td class="num">${l.qty}</td><td class="num">${cell(p.cash)}</td><td class="num">${cell(p.credit)}</td></tr>`;
  }).join('');
  const now = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  $('#printArea').innerHTML = `
    <h1>${esc(settings.shopName)}</h1>
    <p class="print-meta">Trade-in quote · ${esc(now)}${trade.customer ? ` · ${esc(trade.customer)}` : ''}</p>
    <table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Cash</th><th class="num">Store credit</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td>Total (${t.count} items)</td><td></td><td class="num">${money(t.cash)}</td><td class="num">${money(t.credit)}</td></tr></tfoot></table>
    ${settings.quoteFooter ? `<p class="print-footer">${esc(settings.quoteFooter)}</p>` : ''}`;
  window.print();
}

/* ================================================================== views + init */

function showView(name) {
  currentView = name;
  for (const v of ['trade', 'hardware', 'settings']) $(`#view-${v}`).hidden = v !== name;
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  $('#totalsBar').hidden = name !== 'trade';
  if (name === 'hardware') renderHardware();
  if (name === 'settings') fillSettingsForm();
  if (name === 'trade') { renderLines(); focusScan(); }
}

function wireEvents() {
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
  $$('[data-goto]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.goto)));

  const scan = $('#scanInput');
  scan.addEventListener('keydown', onScanKeydown);
  scan.addEventListener('input', onScanInput);
  $('#searchBtn').addEventListener('click', () => {
    const q = scan.value.trim();
    if (/^\d{8,14}$/.test(q)) { scan.value = ''; closeResults(); scanUpc(q); } else if (q) runPcSearch(q);
    scan.focus();
  });
  $('#results').addEventListener('click', onResultsClick);
  $('#customBtn').addEventListener('click', addCustom);
  document.addEventListener('click', (e) => { if (!e.target.closest('.scan') && !$('#results').hidden) closeResults(); });

  const body = $('#lineBody');
  body.addEventListener('change', onLineChange);
  body.addEventListener('click', onLineClick);
  body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input')) { e.target.blur(); focusScan(); }
  });

  $('#customerName').value = trade.customer || '';
  $('#customerName').addEventListener('input', (e) => { trade.customer = e.target.value; saveTrade(); });

  $('#printBtn').addEventListener('click', printQuote);
  $('#clearBtn').addEventListener('click', () => {
    if (trade.lines.length && !confirm('Clear this trade and start a new one?')) return;
    trade.lines = [];
    trade.customer = '';
    $('#customerName').value = '';
    commit();
    focusScan();
  });

  // A barcode scanner types like a keyboard - if focus drifted off an input, send keystrokes to the scan box.
  document.addEventListener('keydown', (e) => {
    if (currentView !== 'trade' || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    if (e.target.closest?.('input, select, textarea')) return;
    scan.focus();
  });

  $('#hwFilter').addEventListener('input', renderHardware);
  $('#hwBody').addEventListener('change', onHwChange);
  $('#hwBody').addEventListener('click', (e) => {
    const tr = e.target.closest('[data-action="delete"]')?.closest('tr[data-id]');
    if (!tr) return;
    hardware = hardware.filter((h) => h.id !== tr.dataset.id);
    setHwDirty(true);
    renderHardware();
  });
  $('#hwAdd').addEventListener('click', () => {
    const h = { id: uid(), name: '', category: 'console', complete: null, unit: null, parts: null };
    hardware.unshift(h);
    $('#hwFilter').value = '';
    setHwDirty(true);
    renderHardware();
    $(`#hwBody tr[data-id="${h.id}"] [data-field="name"]`).focus();
  });
  $('#hwSave').addEventListener('click', saveHardware);
  $('#hwPasteToggle').addEventListener('click', () => { $('#hwPastePanel').hidden = false; $('#hwPasteText').focus(); });
  $('#hwPasteCancel').addEventListener('click', () => { $('#hwPastePanel').hidden = true; });
  $('#hwPasteApply').addEventListener('click', applyPaste);

  $('#settingsForm').addEventListener('submit', saveSettings);
  $('#rulesBody').addEventListener('input', renderRuleExamples);
  $('#rulesBody').addEventListener('change', renderRuleExamples);
  $('#dedAdd').addEventListener('click', () => {
    $('#dedBody').insertAdjacentHTML('beforeend', dedRowHtml({ id: uid(), label: '', appliesTo: 'game', amount: 0, resurface: false }));
    $('#dedBody tr:last-child [data-k="label"]').focus();
  });
  $('#dedBody').addEventListener('click', (e) => { e.target.closest('[data-action="del-ded"]')?.closest('tr').remove(); });
  $('#tokenSave').addEventListener('click', saveToken);
  $('#tokenTest').addEventListener('click', testToken);
  $('#passwordSave').addEventListener('click', changePasswords);
  $('#authForm').addEventListener('submit', submitAuth);
  $('#logoutBtn').addEventListener('click', logout);

  window.addEventListener('beforeunload', (e) => { if (hwDirty) { e.preventDefault(); e.returnValue = ''; } });
}

/* ================================================================== login (website only) */

function showAuth(mode) {
  auth.mode = mode;
  currentView = 'auth';
  for (const v of ['trade', 'hardware', 'settings']) $(`#view-${v}`).hidden = true;
  $('#view-auth').hidden = false;
  $('.tabs').hidden = true;
  $('#totalsBar').hidden = true;
  $('#demoBanner').hidden = true;
  $('#account').hidden = true;
  $('#authTitle').textContent = mode === 'setup' ? 'First-time setup' : 'Staff login';
  $('#setupFields').hidden = mode !== 'setup';
  $('#loginFields').hidden = mode !== 'login';
  $('#authSubmit').textContent = mode === 'setup' ? 'Finish setup' : 'Log in';
  $(mode === 'setup' ? '#setupCode' : '#loginPassword').focus();
}

async function submitAuth(e) {
  e.preventDefault();
  const f = e.target.elements;
  const error = $('#authError');
  error.textContent = '';
  try {
    if (auth.mode === 'setup') {
      if (f.managerPassword.value !== f.managerPassword2.value) throw new Error("The two manager passwords don't match.");
      await api('setup', {
        method: 'POST',
        body: { code: f.setupCode.value, managerPassword: f.managerPassword.value, staffPassword: f.staffPassword.value, token: f.setupToken.value.trim() },
      });
    } else {
      await api('login', { method: 'POST', body: { password: f.loginPassword.value } });
    }
    e.target.reset();
    await startApp(await api('status'));
  } catch (err) {
    error.textContent = err.message;
  }
}

async function logout() {
  if (hwDirty && !confirm('You have unsaved hardware price changes. Log out anyway?')) return;
  try { await api('logout', { method: 'POST', body: {} }); } catch { /* cookie is cleared server-side; show login regardless */ }
  auth.role = null;
  setHwDirty(false);
  showAuth('login');
}

async function changePasswords() {
  const staffPassword = $('#newStaffPassword').value;
  const managerPassword = $('#newManagerPassword').value;
  const status = $('#passwordStatus');
  try {
    await api('passwords', { method: 'PUT', body: { staffPassword, managerPassword } });
    $('#newStaffPassword').value = '';
    $('#newManagerPassword').value = '';
    status.textContent = 'Passwords changed ✓ Every other device will need to log in again with the new password.';
  } catch (err) {
    status.textContent = err.message;
  }
}

// Staff can run trade-ins; only managers see the Hardware Prices and Settings tabs.
function applyRole() {
  const manager = isManager();
  $$('.tabs button[data-view="hardware"], .tabs button[data-view="settings"]').forEach((b) => { b.hidden = !manager; });
  $('.tabs').hidden = false;
  $('#account').hidden = !auth.enabled;
  $('#accountRole').textContent = manager ? 'Manager' : 'Staff';
  $('#passwordPanel').hidden = !(auth.enabled && manager);
}

/* ================================================================== startup */

async function startApp(status) {
  auth.role = status.role;
  tokenSet = !!status.tokenSet;
  const [saved, hw] = await Promise.all([api('settings'), api('hardware')]);
  settings = mergeSettings(saved);
  // First run (or a list saved before per-condition prices existed): load the Game Buying Guide prices.
  if (Array.isArray(hw) && hw.length && hw.every((h) => 'unit' in h)) {
    hardware = hw;
  } else {
    hardware = seedHardware();
    if (isManager()) await api('hardware', { method: 'PUT', body: hardware });
  }
  $('#view-auth').hidden = true;
  applyRole();
  renderTokenStatus();
  showView('trade');
}

async function init() {
  wireEvents();
  try {
    const status = await api('status');
    auth.enabled = !!status.auth;
    if (status.setupNeeded) showAuth('setup');
    else if (auth.enabled && !status.role) showAuth('login');
    else await startApp(status);
  } catch (err) {
    toast(err.message, 'error');
  }
}

init();
