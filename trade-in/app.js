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
// Hardware can also be CIB or New, priced from the PriceCharting product attached to the line.
const HW_PC_CONDITIONS = { cib: 'CIB', new: 'New' };
const isPcCondition = (c) => c in HW_PC_CONDITIONS;
// PriceCharting hardware (special editions with no buying-guide row) can also be bought for Parts.
const isHwCat = (cat) => ['console', 'handheld', 'accessory'].includes(cat);
// A third-party version of a buying-guide controller pays a % of the first-party Working price.
const THIRD_PARTY = 'thirdparty';
const CONTROLLER_RE = /\b(controller|joy ?cons?|remote|nunchuk|joystick|pad|zapper)\b/;
const NOT_CONTROLLER_RE = /\b(memory|adapter|3rd party|third party)\b/;
const takesThirdParty = (hw) => hw.category === 'accessory' && hw.unit != null
  && CONTROLLER_RE.test(norm(hw.name)) && !NOT_CONTROLLER_RE.test(norm(hw.name));
const thirdPartyPrice = (hw, s = settings) => Math.round((hw.unit * (Number(s.thirdPartyPct) || 0)) / 100);
// The guide item behind a hardware line, or the prices saved on the line if it was deleted since.
const lineHw = (line) => hwItem(line) || { ...line.hwPrices, name: line.name, category: line.category };

// PriceCharting returns every price as an integer number of pennies.
const PC_FIELDS = {
  'retail-buy': { loose: 'retail-loose-buy', cib: 'retail-cib-buy', new: 'retail-new-buy' },
  market: { loose: 'loose-price', cib: 'cib-price', new: 'new-price' },
};
const PRICE_KEYS = [...Object.values(PC_FIELDS['retail-buy']), ...Object.values(PC_FIELDS.market)];

// PriceCharting console names for disc-based systems (the guide's "disc only" rules apply to these).
const DISC_PLATFORM_RE = /^(pal |jp )?(playstation( [2-5])?|psp|xbox( 360| one| series x)?|gamecube|wii( u)?|sega (cd|saturn|dreamcast)|turbografx cd|3do|neo geo cd|jaguar cd)$/;

// Games: store credit = 105% of PriceCharting (Game Buying Guide), cash = 70% of PriceCharting,
// so store credit is 50% more than cash.
const GAME_CREDIT_PCT = 105;
const GAME_CASH_PCT = 70;
// The version 4 game cash (70% of the store credit), for migrating saves that still use it.
const V4_GAME_CASH_PCT = GAME_CREDIT_PCT * 0.7;
// The version 3 game rule (credit 100%, cash = credit ÷ 1.5), for migrating saves that still use it.
const V3_GAME_CASH_PCT = 100 / 1.5;
// Slow-seller flags only matter on items worth this much (cents); cheap items get the guide's flat prices.
const SLOW_SELLER_MIN_VALUE = 1000;
// Trade-ins worth this much or less (cents) get no scratch/resurfacing deduction.
const SCRATCH_FREE_MAX = 50;

// Pricing and rules from the shop's Game Buying Guide (Google Sheet) and pricing policy.
const DEFAULT_SETTINGS = {
  version: 8,
  defaultCondition: 'loose',
  rules: {
    game:      { basis: 'retail-buy', cashPct: GAME_CASH_PCT, creditPct: GAME_CREDIT_PCT },
    pokemon:   { basis: 'market', cashPct: 50, creditPct: 75 },
    console:   { cashPct: 100, creditPct: 120 },
    handheld:  { cashPct: 100, creditPct: 120 },
    accessory: { cashPct: 100, creditPct: 120 },
    other:     { cashPct: 100, creditPct: 100 },
  },
  roundMode: 'down',
  roundStep: 1,   // cents
  lowValue: 100,  // cents - flag items whose cash offer is under this
  slowSalesPerYear: 50, // flag items selling fewer copies a year than this on PriceCharting (0 = off)
  thirdPartyPct: 20, // third-party controllers: % of the first-party controller's guide Working price
  boxedStepPct: 10, // guide controllers: CIB pays at least Working + this %, New at least CIB + this %
  // Steering wheels and the like: anything whose name has one of these phrases pays a flat amount (cents),
  // cash and credit, in any condition.
  flatItems: {
    amount: 500,
    keywords: ['Racing Wheel', 'Steering Wheel', 'Speed Wheel', 'Driving Force', 'Speed Force', 'Pedals', 'Flight Stick', 'HOTAS'],
  },
  partsPctOfLoose: 15, // PriceCharting hardware (special editions) on Parts: % of loose price, min = regular model's Parts price
  // Floor Pricing: the shop's premium on certain games (owner, Oct 2026: "real eBay sold listings, as well as
  // premiums on certain games, like Pokemon"). A % on top of the automatic shelf price for names containing the
  // phrase; the most specific (longest) matching phrase wins, so "pokemon x" at 0 exempts one game. A line can
  // name a system ("Pokemon @ Nintendo DS = 0"), and beats the same phrase without one. Fit Oct 7 2026 on the
  // live tool (Amazon included) against the shop's loose prices for 19 Pokemon games + Conker: older-system
  // Pokemon +25%, DS/3DS Pokemon none (the shop prices those at the sales / GameStop), Conker +15% took it
  // from 5 to 13 of 20 within $10 (avg miss $24 -> $14). Other systems keep the earlier +10% (no data).
  // The per-game lines (owner request, same day) put the other 6 exactly on the shop's price; a negative %
  // lowers the price. "Pokemon Black Version 2 = 0" keeps the "Pokemon Black" line off Black 2.
  floorPremiums: [
    { phrase: 'Pokemon', pct: 10 },
    { phrase: 'Pokemon', system: 'GameBoy', pct: 25 }, // also matches GameBoy Color / Advance
    { phrase: 'Pokemon', system: 'Nintendo 64', pct: 25 },
    { phrase: 'Pokemon', system: 'Gamecube', pct: 25 },
    { phrase: 'Pokemon', system: 'Nintendo DS', pct: 0 },
    { phrase: 'Pokemon', system: 'Nintendo 3DS', pct: 0 },
    { phrase: "Conker's Bad Fur Day", pct: 15 },
    { phrase: 'Pokemon Colosseum Bonus Disc', pct: 52 }, // $400
    { phrase: 'Pokemon Red', system: 'GameBoy', pct: -5 }, // $125
    { phrase: 'Pokemon LeafGreen', pct: 10 }, // $175
    { phrase: 'Pokemon Black', system: 'Nintendo DS', pct: -14 }, // $120
    { phrase: 'Pokemon Black Version 2', pct: 0 },
    { phrase: 'Pokemon SoulSilver', pct: 13 }, // $200
    { phrase: 'Hey You Pikachu', pct: 80 }, // $35
  ],
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
    { id: 'modded', label: 'Modded', amount: 6000, appliesTo: 'hardware' },
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
    // Standard-color Joy-Cons, named exactly as PriceCharting lists them so scans match (see hardwareMatch).
    // One entry covers PriceCharting's [Left]/[Right] and PAL versions. Singles $10 / pairs $20; Switch 2
    // singles $20 / pairs $40. Special editions (Zelda, Pikachu & Eevee, etc.) stay on PriceCharting pricing.
    ['Joy-Con Neon Blue', 10, 2], ['Joy-Con Neon Red', 10, 2], ['Joy-Con Neon Green', 10, 2], ['Joy-Con Neon Yellow', 10, 2],
    ['Joy-Con Gray', 10, 2], ['Joy-Con Grey', 10, 2], ['Joy-Con Red', 10, 2], ['Joy-Con Pink', 10, 2], ['Joy-Con Pastel Pink', 10, 2],
    ['Joy-Con Neon Red & Neon Blue', 20, 4], ['Joy-Con Neon Pink & Neon Green', 20, 4], ['Joy-Con Neon Green & Neon Pink', 20, 4],
    ['Joy-Con Neon Purple & Neon Orange', 20, 4], ['Joy-Con Blue & Yellow', 20, 4],
    ['Joy-Con Pastel Pink & Pastel Yellow', 20, 4], ['Joy-Con Pastel Purple & Pastel Green', 20, 4],
    ['Joy Con 2 Light Blue', 20, 2], ['Joy Con 2 Light Red', 20, 2], ['Joy Con 2 Light Blue & Light Red', 40, 4],
    ['Nintendo Switch 2 Joy-Con 2 Light Purple / Light Green', 40, 4], ['Nintendo Switch 2 Joy Cons', 40, 4],
  ],
};

// Fake sample products used until an API token is saved (same shape as the PriceCharting API).
const DEMO_PRODUCTS = [
  { id: 'demo-1', 'product-name': 'Super Mario 64', 'console-name': 'Nintendo 64', upc: '045496870010', genre: 'Platformer', 'sales-volume': 6709, 'gamestop-trade-price': 1540, 'gamestop-price': 5499, 'loose-price': 3150, 'cib-price': 8900, 'new-price': 52000, 'retail-loose-buy': 1900, 'retail-cib-buy': 5300, 'retail-new-buy': 31000 },
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
  { id: 'demo-13', 'product-name': 'Super Mario 64 [Not for Resale]', 'console-name': 'Nintendo 64', upc: '045496870034', genre: 'Platformer', 'sales-volume': 14, 'loose-price': 17235, 'cib-price': 45000, 'new-price': 120000, 'retail-loose-buy': 9000, 'retail-cib-buy': 25000, 'retail-new-buy': 70000 },
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
  for (const k of ['defaultCondition', 'roundMode', 'roundStep', 'lowValue', 'slowSalesPerYear', 'partsPctOfLoose', 'thirdPartyPct', 'boxedStepPct', 'shopName', 'quoteFooter']) {
    if (saved[k] !== undefined) s[k] = saved[k];
  }
  if (saved.flatItems && typeof saved.flatItems === 'object') Object.assign(s.flatItems, saved.flatItems);
  if (Array.isArray(saved.floorPremiums)) s.floorPremiums = saved.floorPremiums;
  if (saved.version >= 2) { // version 1 saves used a different percentage format - keep the new defaults
    for (const cat of Object.keys(s.rules)) Object.assign(s.rules[cat], saved.rules?.[cat] || {});
    if (Array.isArray(saved.deductions)) s.deductions = saved.deductions;
    Object.assign(s.guide, saved.guide || {});
  }
  // Version 3: game cash changed from half of the PriceCharting price to the price ÷ 1.5.
  const game = s.rules.game;
  if (saved.version < 3 && game.cashPct === 50) game.cashPct = V3_GAME_CASH_PCT;
  // Version 4: games follow the buying guide's 105% store credit unless a manager set custom numbers.
  if (saved.version < 4 && game.creditPct === 100 && Math.abs(game.cashPct - V3_GAME_CASH_PCT) < 0.001) {
    Object.assign(game, { cashPct: GAME_CASH_PCT, creditPct: GAME_CREDIT_PCT });
  }
  // Version 5: game cash changed from 70% of the store credit (73.5%) to 70% of PriceCharting.
  if (saved.version < 5 && game.creditPct === GAME_CREDIT_PCT && Math.abs(game.cashPct - V4_GAME_CASH_PCT) < 0.001) {
    game.cashPct = GAME_CASH_PCT;
  }
  // Version 6: new "Modded" hardware deduction ($60) joins saved deduction lists.
  if (saved.version < 6 && !s.deductions.some((d) => d.id === 'modded')) {
    s.deductions.push(clone(DEFAULT_SETTINGS.deductions.find((d) => d.id === 'modded')));
  }
  // Versions 7-8: per-system Pokemon premiums + Conker (v7), then per-game lines (v8), replace an untouched
  // earlier default list (v6: Pokemon = 10; v7: the first 7 lines of today's list).
  const premiumKey = (list) => JSON.stringify(list.map((p) => [p.phrase, p.system || '', Number(p.pct)]));
  const oldDefaults = [[{ phrase: 'Pokemon', pct: 10 }], DEFAULT_SETTINGS.floorPremiums.slice(0, 7)].map(premiumKey);
  if (saved.version < 8 && oldDefaults.includes(premiumKey(s.floorPremiums))) {
    s.floorPremiums = clone(DEFAULT_SETTINGS.floorPremiums);
  }
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
// The shop's Amazon SP-API keys are saved on the server (Settings), and whether they're the sandbox app's.
let amazonSet = false;
let amazonSandbox = false;
let hwDirty = false;
let currentView = 'trade';
// auth.enabled is true on the website (api.php), false on the shop PC's local server.
const auth = { enabled: false, role: null, mode: 'login' };
const isManager = () => auth.role === 'manager';
const trade = store.get('p2w-trade', null) || { customer: '', staff: '', lines: [] };
trade.lines = trade.lines.filter((l) => !l.pending); // drop lookups interrupted by a reload
// Split payouts used to be cash-only ({ cash }); now staff type either part ({ by, amount }).
if (trade.split && !trade.split.by) trade.split = { by: 'cash', amount: trade.split.cash ?? null };

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
    throw Object.assign(new Error(data?.['error-message'] || `Request failed (HTTP ${res.status})`), { status: res.status, data });
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

// PriceCharting redirects /game/<product id> to that product's page.
const pcUrl = (id) => `https://www.pricecharting.com/game/${encodeURIComponent(id)}`;
function pcLink(id, text, cls = '') {
  const c = cls ? ` class="${cls}"` : '';
  if (!/^\d+$/.test(id || '')) return `<span${c}>${esc(text)}</span>`; // demo items have no real page
  return `<a${c} href="${esc(pcUrl(id))}" target="_blank" rel="noopener noreferrer" title="Open on PriceCharting">${esc(text)}</a>`;
}

function slimProduct(p) {
  const prices = {};
  for (const k of PRICE_KEYS) if (p[k] != null && p[k] !== '') prices[k] = Number(p[k]);
  const positive = (v) => (Number(v) > 0 ? Number(v) : null); // PriceCharting uses 0 for "GameStop doesn't carry it"
  return {
    id: String(p.id), name: p['product-name'] || 'Unknown item', platform: p['console-name'] || '',
    upc: p.upc || '', genre: p.genre || '', prices,
    salesVolume: p['sales-volume'] != null && p['sales-volume'] !== '' ? Number(p['sales-volume']) : null, // units sold per year
    gamestop: { trade: positive(p['gamestop-trade-price']), sell: positive(p['gamestop-price']) }, // trade = GameStop's cash offer
  };
}

function guessCategory(name) {
  const n = name.toLowerCase();
  if (flatItemMatch(name)) return 'accessory';
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

// The shop's premium for a game on the shelf ({ phrase, system?, pct }), or null. The longest matching phrase
// wins; for the same phrase, a line naming the game's system beats one without (system = PriceCharting console).
// A negative pct lowers the price; 0 exempts the game from shorter lines.
function floorPremium(name, system = '', s = settings) {
  const text = norm(name);
  const sys = norm(system);
  const rank = (pr) => norm(pr.phrase).length * 2 + (pr.system ? 1 : 0);
  let best = null;
  for (const pr of s.floorPremiums || []) {
    if (!hasPhrase(text, pr.phrase) || (pr.system && !hasPhrase(sys, pr.system))) continue;
    if (!best || rank(pr) > rank(best)) best = pr;
  }
  return best && best.pct !== 0 ? best : null;
}
// "Pokemon on GameBoy premium +25%" / "Pokemon Red on GameBoy discount −5%"
const premiumText = (pr) => `${pr.system ? `${pr.phrase} on ${pr.system}` : pr.phrase} ${pr.pct > 0 ? 'premium +' : 'discount −'}${pctText(Math.abs(pr.pct))}%`;

// Settings text <-> premiums: one "phrase = 10" or "phrase @ system = -5" per line (more than -100).
const premiumsText = (list) => (list || []).map((p) => `${p.phrase}${p.system ? ` @ ${p.system}` : ''} = ${pctText(p.pct)}`).join('\n');
function premiumsFromText(text) {
  return lines(text).map((l) => l.match(/^(.*?)\s*[=:]\s*([-−]?\d+(?:\.\d+)?)\s*%?$/)).filter((m) => m && m[1].trim())
    .map((m) => {
      const [phrase, system] = m[1].split('@').map((x) => x.trim());
      const pct = Number(m[2].replace('−', '-'));
      return system ? { phrase, system, pct } : { phrase, pct };
    })
    .filter((p) => p.phrase && p.pct > -100);
}

// The flat-price phrase (steering wheels etc.) an item's name contains, or undefined.
const flatItemMatch = (name, s = settings) => {
  const text = norm(name);
  return (s.flatItems?.keywords || []).find((k) => hasPhrase(text, k));
};

// Applies the flat-price items rule to any scanned/guide item, then the Game Buying Guide to a PriceCharting game line.
// Returns null (price normally), { dontBuy, note }, { flat, note } (fixed offer in cents), or { info, note }.
function guideCheck(line, s) {
  const flatKey = (line.source === 'pc' || line.source === 'hw') && flatItemMatch(line.name, s);
  if (flatKey) return { flat: s.flatItems.amount, note: `${flatKey} → ${money(s.flatItems.amount)}` };
  const g = s.guide;
  if (!g.enabled || line.source !== 'pc' || !isGameCat(line.category)) return null;
  if (/\bpc games?\b/.test(norm(line.platform))) return { dontBuy: true, note: "PC game – we don't buy PC games" };
  const title = baseTitle(line.name);
  if (g.deadGames.some((t) => baseTitle(t) === title)) return { dontBuy: true, note: 'Dead game – do not buy' };

  const reason = shitboxReason(line, g);
  const loose = line.prices?.['loose-price'];
  const condMarket = line.prices?.[PC_FIELDS.market[line.condition]];
  const discOnly = line.condition === 'loose' && DISC_PLATFORM_RE.test(norm(line.platform));

  // The guide's "outliers" (outlier: true) are divided by 5 when the disc needs resurfacing.
  if (discOnly) {
    if (loose > 2000) return reason ? { info: true, note: `${reason}, but over $20 – priced normally` } : null;
    if (reason) return { flat: 10, outlier: true, note: `Disc-only ${reason} → $0.10` };
    if (loose > 0 && loose < 1000) return { flat: 50, outlier: true, note: 'Disc-only under $10 → $0.50' };
    if (loose >= 1000) return { flat: 100, outlier: true, note: 'Disc-only $10–$20 → $1.00' };
    return null;
  }
  if (reason && line.condition !== 'loose') {
    if (condMarket > 2000) return { info: true, note: `${reason}, but over $20 – priced normally` };
    return { flat: 25, outlier: true, note: `${reason} in box → $0.25` };
  }
  return null;
}

/* ================================================================== pricing */

const hwItem = (line) => hardware.find((h) => h.id === line.hwId);

const pcPriceKey = (line, rule, condition = line.condition) => PC_FIELDS[rule.basis || 'retail-buy'][condition];

// Buying-guide names use short system names ("PS4 Controller"); PriceCharting spells systems out.
const SYSTEM_ALIASES = {
  playstation: 'ps1 psone', 'playstation 2': 'ps2', 'playstation 3': 'ps3', 'playstation 4': 'ps4', 'playstation 5': 'ps5',
  psp: 'playstation portable', 'playstation vita': 'ps vita', 'nintendo 64': 'n64', 'super nintendo': 'snes',
  nes: 'nintendo entertainment system', gamecube: 'gc', gameboy: 'game boy', 'gameboy color': 'game boy color gbc',
  'gameboy advance': 'game boy advance gba', 'nintendo switch': 'switch', 'nintendo switch 2': 'switch 2',
  xbox: 'xbox original og', 'xbox series x': 'xbox series',
};
const MATCH_FILLER = new Set(['the', 'of', 'and', 'edition', 'w', 'with']);
const matchWords = (s) => new Set(norm(s).split(' ').filter((w) => w && !MATCH_FILLER.has(w)));

// The regular buying-guide model behind a PriceCharting hardware item (e.g. a special edition):
// the same-type guide item whose name shares the most words with it (ties go to the lower Parts price).
// Numbers only count from the system name: "Splatoon 2" must not match "Switch 2 Pro Controller".
function regularModel(line) {
  const have = matchWords(`${line.platform} ${SYSTEM_ALIASES[norm(line.platform)] || ''}`);
  for (const w of matchWords(line.name)) if (!/^\d+$/.test(w)) have.add(w);
  let best = null;
  for (const h of hardware) {
    if (h.category !== line.category || h.parts == null || !h.name) continue;
    const want = matchWords(h.name);
    let shared = 0;
    for (const w of want) if (have.has(w)) shared += 1;
    const score = shared - (want.size - shared) / 2;
    if (shared >= 2 && (!best || score > best.score || (score === best.score && h.parts < best.hw.parts))) best = { hw: h, score };
  }
  return best?.hw || null;
}

// PriceCharting hardware on Parts: a % of the loose price, never below the regular model's guide Parts price.
function pcPartsPrice(line, s = settings) {
  const loose = line.prices?.['loose-price'];
  const pct = loose > 0 ? Math.round((loose * (Number(s.partsPctOfLoose) || 0)) / 100) : null;
  const regular = regularModel(line);
  if (pct == null && !regular) return null;
  return { price: Math.max(pct ?? 0, regular?.parts ?? 0), pct, regular };
}

// A guide controller bought CIB/New: PriceCharting's price, but CIB at least Working + boxedStepPct
// and New at least that CIB + boxedStepPct, so boxed never pays less than loose.
function boxedPrice(prices, unit, category, condition, s = settings) {
  const rule = s.rules[category] || s.rules.other;
  const pc = (c) => { const v = prices?.[PC_FIELDS[rule.basis || 'retail-buy'][c]]; return v > 0 ? v : null; };
  if (category !== 'accessory' || unit == null) return pc(condition);
  const step = 1 + (Number(s.boxedStepPct) || 0) / 100;
  const cib = Math.max(pc('cib') ?? 0, Math.round(unit * step));
  return condition === 'cib' ? cib : Math.max(pc('new') ?? 0, Math.round(cib * step));
}

function autoBase(line, rule, s = settings) {
  if (line.source === 'bulk') return line.bulkTotal ?? null;
  if (line.source === 'pc' && line.condition === 'parts') return pcPartsPrice(line, s)?.price ?? null;
  if (line.source === 'hw' && isPcCondition(line.condition)) return boxedPrice(line.prices, lineHw(line).unit, line.category, line.condition, s);
  if (line.source === 'pc') {
    const v = line.prices?.[pcPriceKey(line, rule)];
    return v > 0 ? v : null;
  }
  if (line.source === 'hw') {
    const hw = lineHw(line);
    if (line.condition === THIRD_PARTY) return hw.unit != null ? thirdPartyPrice(hw, s) : null;
    return hw[line.condition] ?? null;
  }
  return null;
}

// Hardware bought for parts is a flat parts price: missing cables/controllers don't matter,
// and there's no store credit bump (credit = cash).
const isPartsLine = (line) => (line.source === 'hw' || line.source === 'pc') && line.condition === 'parts';
// Custom items: the typed cash is the final offer, so there's nothing for a deduction to come off.
const takesDeductions = (line) => !isPartsLine(line) && line.source !== 'bulk' && line.source !== 'custom';

function lineDeductions(line, s = settings) {
  if (!takesDeductions(line)) return []; // kept on the line in case it's switched back from Parts
  return (line.deductions || []).map((id) => s.deductions.find((d) => d.id === id)).filter(Boolean);
}

function roundOffer(cents, s) {
  const step = Number(s.roundStep) || 1;
  const fn = s.roundMode === 'nearest' ? Math.round : Math.floor;
  return fn(cents / step + 1e-9) * step;
}

// Staff can type a line's cash offer (line.cashOverride, cents each). It is the final cash for the item, and
// store credit keeps the line's normal credit-to-cash ratio. Management can also give one item a custom
// store credit: credit = cash + line.creditBonus %.
function priceLine(line, s = settings) {
  let p = priceBeforeCredit(line, s);
  if (line.cashOverride != null && !line.pending && !line.failed) {
    const ratio = 1 + normalCreditBonusOf(line, p, s) / 100;
    // Custom items are always priced this way, so they don't get the "Cash edited" flag.
    p = { ...p, cash: line.cashOverride, credit: roundOffer(line.cashOverride * ratio, s), dontBuy: false, cashEdited: line.source !== 'custom', guideDontBuy: p.dontBuy };
  }
  if (line.creditBonus == null || p.cash == null || p.dontBuy) return p;
  return { ...p, credit: roundOffer((p.cash * (100 + line.creditBonus)) / 100, s), customCredit: true };
}

// The line's normal credit bump (% more than cash), e.g. 50 for games, 20 for hardware.
function normalCreditBonus(line, s = settings) {
  return Math.round(normalCreditBonusOf(line, priceBeforeCredit(line, s), s));
}

// Exact, from the category rule: flat guide prices, Parts, and TCG bulk pay the same in cash and credit.
function normalCreditBonusOf(line, p, s) {
  if (isPartsLine(line) || line.source === 'bulk' || p.flat) return 0;
  const rule = s.rules[line.category] || s.rules.other;
  return rule.cashPct > 0 ? (rule.creditPct / rule.cashPct - 1) * 100 : 0;
}

// A trade-in worth SCRATCH_FREE_MAX or less without its scratch (resurfacing) deductions isn't docked for them.
// The guide's outlier prices ($0.10 / $0.25 / $0.50 / $1) always take their ÷5 instead: that is the guide's
// resurfacing rule for them, and the waiver would otherwise cancel it on every tier but $1.
function priceBeforeCredit(line, s = settings) {
  const deds = lineDeductions(line, s);
  const out = priceWith(line, s, deds);
  if (!deds.some((d) => d.resurface)) return out;
  const clean = priceWith(line, s, deds.filter((d) => !d.resurface));
  if (!clean.dontBuy && !clean.guide?.outlier && clean.cash != null && clean.cash <= SCRATCH_FREE_MAX) {
    return { ...clean, scratchWaived: true };
  }
  return out;
}

// value = item value (PriceCharting price or guide price) minus deductions; cash/credit = value x category %.
// Guide flat amounts (disc-only, shitbox, $0.25 stack) are paid as-is in both cash and credit.
function priceWith(line, s, deds) {
  const out = { base: null, cash: null, credit: null, guide: null, flat: false, dontBuy: false };
  if (line.pending || line.failed) return out;
  const rule = s.rules[line.category] || s.rules.other;
  out.base = line.override ?? autoBase(line, rule, s);
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
    if (out.guide.outlier && deds.some((d) => d.resurface)) {
      flat = Math.floor(flat / 5);
      out.guide = { ...out.guide, note: `${out.guide.note}, ÷5 for resurfacing = ${money(flat)}` };
    }
    Object.assign(out, { cash: flat, credit: flat, flat: true });
    return out;
  }
  if (out.base == null) return out;
  if (line.source === 'bulk') { // TCG bulk rates are flat: cash and store credit pay the same
    Object.assign(out, { cash: out.base, credit: out.base });
    return out;
  }
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

const isPlain = (l) => l.override == null && l.cashOverride == null && !(l.deductions || []).length && !l.guideFlag && l.creditBonus == null;

function placeLine(line, replaceId) {
  const i = replaceId ? trade.lines.findIndex((l) => l.id === replaceId) : -1;
  if (i >= 0) trade.lines[i] = line;
  else trade.lines.unshift(line);
}

// A PriceCharting item whose name matches a Hardware Prices item uses the buying-guide price instead.
// An exact name wins; otherwise [bracket]/(paren) tags are ignored, so "Joy-Con Neon Blue [Left]"
// matches an item named "Joy-Con Neon Blue". The console name may be included either side of the name.
// Spaces and hyphens are ignored too, so "Joycon", "Joy Con", and "Joy-Con" all match.
function hardwareMatch(raw) {
  const name = raw['product-name'] || '';
  const system = raw['console-name'] || '';
  const squash = (s) => s.replace(/ /g, '');
  const variants = [name, `${system} ${name}`, `${name} ${system}`];
  const exact = variants.map((v) => squash(norm(v)));
  const loose = variants.map((v) => squash(baseTitle(v)));
  return hardware.find((h) => h.name && exact.includes(squash(norm(h.name))))
    || hardware.find((h) => h.name && loose.includes(squash(baseTitle(h.name))))
    || null;
}

// PriceCharting lines already in the trade (added before a matching Hardware Prices item existed,
// or before an update) switch to the buying-guide price. Lines with a typed-in value are left alone.
function applyHardwareMatches() {
  let changed = false;
  trade.lines = trade.lines.map((l) => {
    if (l.source !== 'pc' || l.override != null) return l;
    const hw = hardwareMatch({ 'product-name': l.name, 'console-name': l.platform });
    if (!hw) return l;
    changed = true;
    return {
      id: l.id, source: 'hw', hwId: hw.id, name: hw.name, category: hw.category, condition: hwConditionFor(hw, l.condition),
      qty: l.qty, override: null, deductions: [], hwPrices: { complete: hw.complete, unit: hw.unit, parts: hw.parts }, matchedFrom: l.name, matchedPcId: l.pcId,
      prices: l.prices, cashOverride: l.cashOverride, creditBonus: l.creditBonus, // an agreed price or credit % stays
    };
  });
  if (changed) saveTrade();
}

// Custom items used to take their price in the Value box, with deductions off it. Convert any still on a
// saved trade to the typed cash they came to, so their offer doesn't change.
function migrateCustomLines() {
  let changed = false;
  for (const l of trade.lines) {
    if (l.source !== 'custom' || l.override == null) continue;
    const rule = settings.rules[l.category] || settings.rules.other;
    const ded = (l.deductions || []).reduce((sum, id) => sum + (settings.deductions.find((d) => d.id === id)?.amount || 0), 0);
    if (l.cashOverride == null) l.cashOverride = Math.max(0, Math.round(l.override - (ded * rule.cashPct) / 100));
    Object.assign(l, { override: null, deductions: [] });
    changed = true;
  }
  if (changed) saveTrade();
}

// PriceCharting condition -> buying-guide condition: accessories are "Working"; loose consoles are "Console only".
function hwConditionFor(hw, pcCondition) {
  if (pcCondition === 'parts' && hw.parts != null) return 'parts';
  const want = hw.category === 'accessory' || pcCondition === 'loose' ? 'unit' : 'complete';
  return want in hwConditionLabels(hw.category) && hw[want] != null ? want : defaultHwCondition(hw);
}

function addPcProduct(raw, condition, replaceId = null) {
  const hw = hardwareMatch(raw);
  if (hw) {
    addHardware(hw, hwConditionFor(hw, condition), replaceId, pcInfo(raw));
    return;
  }
  const p = slimProduct(raw);
  const same = trade.lines.find((l) => l.source === 'pc' && l.pcId === p.id && l.condition === condition && isPlain(l) && l.id !== replaceId);
  if (same) {
    same.qty += 1;
    // An item added again moves to the top of the list.
    trade.lines = [same, ...trade.lines.filter((l) => l !== same && l.id !== replaceId)];
    commit();
    flash(same.id);
    return;
  }
  const line = {
    id: replaceId || uid(), source: 'pc', pcId: p.id, name: p.name, platform: p.platform, upc: p.upc, genre: p.genre,
    prices: p.prices, salesVolume: p.salesVolume, gamestop: p.gamestop,
    condition, category: guessCategory(p.name), qty: 1, override: null, deductions: [],
  };
  placeLine(line, replaceId);
  commit();
  flash(line.id);
}

function defaultHwCondition(hw) {
  return Object.keys(hwConditionLabels(hw.category)).find((f) => hw[f] != null) || Object.keys(hwConditionLabels(hw.category))[0];
}

// The parts of a PriceCharting product a hardware line keeps, for its CIB/New prices and link.
const pcInfo = (raw) => ({ id: String(raw.id), name: raw['product-name'] || '', prices: slimProduct(raw).prices });

// pc: the PriceCharting product ({ id, name, prices }) when a scanned/searched item was matched to this hardware item.
function addHardware(hw, condition = defaultHwCondition(hw), replaceId = null, pc = null) {
  const same = trade.lines.find((l) => l.source === 'hw' && l.hwId === hw.id && l.condition === condition && isPlain(l) && l.id !== replaceId
    && (!isPcCondition(condition) || l.matchedPcId === pc?.id));
  if (same) {
    same.qty += 1;
    // An item added again moves to the top of the list.
    trade.lines = [same, ...trade.lines.filter((l) => l !== same && l.id !== replaceId)];
    commit();
    flash(same.id);
    return;
  }
  const line = {
    id: replaceId || uid(), source: 'hw', hwId: hw.id, name: hw.name, category: hw.category, condition, qty: 1, override: null, deductions: [],
    hwPrices: { complete: hw.complete, unit: hw.unit, parts: hw.parts },
    matchedFrom: pc?.name || null, matchedPcId: pc?.id || null, prices: pc?.prices,
  };
  placeLine(line, replaceId);
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

// Search results may lack some price fields; fetch the full product when they do.
async function withFullPrices(raw) {
  if (!tokenSet || PRICE_KEYS.every((k) => k in raw)) return raw;
  return { ...raw, ...(await PC.byId(raw.id)) };
}

async function addFromSearch(raw, condition) {
  if (!tokenSet || PRICE_KEYS.every((k) => k in raw)) {
    addPcProduct(raw, condition);
    return;
  }
  const pending = addPending(`Loading ${raw['product-name'] || 'item'}…`);
  let full = raw;
  try {
    full = await withFullPrices(raw);
  } catch (err) {
    toast(`Couldn't load full prices: ${err.message}`, 'error');
  }
  if (trade.lines.some((l) => l.id === pending.id)) addPcProduct(full, condition, pending.id);
}

// A buying-guide item added as CIB/New from a matched PriceCharting search result.
async function addHardwareFromSearch(hw, raw, condition) {
  let full = raw;
  try {
    full = await withFullPrices(raw);
  } catch (err) {
    toast(`Couldn't load full prices: ${err.message}`, 'error');
  }
  addHardware(hw, condition, null, pcInfo(full));
}

// Attaches the PriceCharting product staff picked (see openPcPicker) to a hardware line.
async function attachPcProduct(target, raw, condition) {
  let full = raw;
  try {
    full = await withFullPrices(raw);
  } catch (err) {
    toast(`Couldn't load full prices: ${err.message}`, 'error');
  }
  const line = trade.lines.find((l) => l.id === target.lineId);
  if (!line) return; // removed meanwhile
  const pc = pcInfo(full);
  Object.assign(line, { condition, matchedFrom: pc.name, matchedPcId: pc.id, prices: pc.prices });
  commit();
  flash(line.id);
}

// A hardware line switched to CIB/New whose stored PriceCharting prices lack that condition's price
// (e.g. it came from a search result with partial prices): fetch the full product once.
async function loadLinePrices(line) {
  try {
    const full = await PC.byId(line.matchedPcId);
    if (!full) return;
    line.prices = pcInfo(full).prices;
    commit();
  } catch (err) {
    toast(`Couldn't load PriceCharting prices: ${err.message}`, 'error');
  }
}

function conditionLabel(line) {
  if (line.source === 'pc') return line.condition === 'parts' ? 'Parts' : GAME_CONDITIONS[line.condition];
  if (line.source === 'hw' && line.condition === THIRD_PARTY) return '3rd party';
  if (line.source === 'hw') return HW_PC_CONDITIONS[line.condition] ||hwConditionLabels((hwItem(line) || line).category)[line.condition] || '';
  return '';
}

function refLine(line) {
  const p = line.prices || {};
  const fmt = (basis) => Object.entries(PC_FIELDS[basis]).map(([c, k]) => `${GAME_CONDITIONS[c]} ${money(p[k] > 0 ? p[k] : null)}`).join(' · ');
  const gs = line.gamestop || {};
  const gamestop = gs.trade || gs.sell ? `<br>GameStop: pays ${money(gs.trade)} cash · sells for ${money(gs.sell)}` : '';
  return `Retail buy: ${fmt('retail-buy')}<br>Market: ${fmt('market')}${gamestop}`;
}

function conditionSelect(line) {
  const opt = ([v, label]) => `<option value="${v}"${v === line.condition ? ' selected' : ''}>${label}</option>`;
  if (line.source === 'pc') {
    const conds = Object.entries(GAME_CONDITIONS);
    if (isHwCat(line.category) || line.condition === 'parts') conds.push(['parts', 'Parts']);
    return `<select data-field="condition">${conds.map(opt).join('')}</select>`;
  }
  if (line.source === 'hw') {
    const hw = lineHw(line);
    const guide = Object.entries(hwConditionLabels(hw.category)).filter(([f]) => hw[f] != null || f === line.condition);
    if (takesThirdParty(hw) || line.condition === THIRD_PARTY) guide.push([THIRD_PARTY, '3rd party']);
    return `<select data-field="condition"><optgroup label="Buying guide">${guide.map(opt).join('')}</optgroup>
      <optgroup label="PriceCharting">${Object.entries(HW_PC_CONDITIONS).map(opt).join('')}</optgroup></select>`;
  }
  return '<span class="muted">—</span>';
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

// Store credit column: a "Custom %" button, or the custom % field once one is set.
function creditControlHtml(line) {
  if (line.creditBonus == null) {
    return '<button type="button" class="link credit-custom" data-action="credit" title="Management approved more store credit on this item">Custom %</button>';
  }
  return `<span class="chip credit-chip">+<input type="number" data-field="creditBonus" min="0" step="1" value="${line.creditBonus}"
    aria-label="Custom store credit, percent more than cash">%<button type="button" data-action="uncredit" title="Back to normal store credit" aria-label="Back to normal store credit">×</button></span>`;
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
  let typeCell = `<select data-field="category">${catOpts}</select>`;
  let qtyCell = `<input type="number" class="qty" data-field="qty" min="1" step="1" value="${line.qty}">`;
  if (line.source === 'bulk') {
    item = `<div class="item-name">${esc(line.name)}</div><div class="sub">${esc(bulkBreakdown(line.bulkItems))}</div>
      <button type="button" class="link" data-action="editbulk">Edit counts</button>`;
    typeCell = '<span class="muted">TCG bulk</span>';
    qtyCell = '<span class="muted">—</span>';
  } else if (line.source === 'custom') {
    item = `<input type="text" class="name-input" data-field="name" value="${esc(line.name)}" placeholder="Describe the item">
      <div class="sub">Type the cash offer in the Cash column</div>`;
  } else if (line.source === 'hw') {
    const fromPc = isPcCondition(line.condition);
    const pcName = line.matchedFrom ? ` · PriceCharting “${pcLink(line.matchedPcId, line.matchedFrom)}”` : '';
    let source = 'Buying guide price';
    if (fromPc) source = 'PriceCharting price';
    else if (line.condition === THIRD_PARTY) source = `3rd party: ${pctText(settings.thirdPartyPct)}% of the first-party Working price`;
    item = `<div class="item-name">${esc(line.name)}</div><div class="sub">${source}${pcName}</div>
      ${fromPc && line.prices ? `<div class="ref">${refLine(line)}</div>` : ''}`;
  } else {
    item = `<div>${pcLink(line.pcId, line.name, 'item-name')}</div>
      <div class="sub">${esc(line.platform)}${line.upc ? ` · UPC ${esc(line.upc)}` : ''}</div>
      <div class="ref">${refLine(line)}</div>`;
  }
  return `<tr data-id="${line.id}">
    <td class="item">${item}<div class="flags" data-cell="flags"></div>${adjustHtml(line)}</td>
    <td>${typeCell}</td>
    <td>${conditionSelect(line)}</td>
    <td class="num">${qtyCell}</td>
    <td class="num value-cell">${line.source === 'custom' ? '<span class="muted">—</span>' : '<span class="money-input"><span>$</span><input type="text" data-field="value" inputmode="decimal" autocomplete="off" placeholder="Price"></span><button type="button" class="reset" data-action="reset" title="Back to automatic price" hidden>↺ auto</button>'}</td>
    <td class="num cash value-cell"><span class="money-input"><span>$</span><input type="text" data-field="cash" inputmode="decimal" autocomplete="off" placeholder="Cash" aria-label="Cash offer each"></span><button type="button" class="reset" data-action="resetcash" title="Back to the calculated cash offer" hidden>↺ auto</button><small data-cell="cash-total"></small></td>
    <td class="num credit"><div data-cell="credit"></div>${creditControlHtml(line)}</td>
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
  const custom = line.source === 'custom';
  const input = $('[data-field="value"]', tr); // custom items have no Value box
  if (input) {
    if (document.activeElement !== input) input.value = plain(p.base);
    input.classList.toggle('overridden', line.override != null);
    input.classList.toggle('missing', p.cash == null);
    $('[data-action="reset"]', tr).hidden = line.override == null;
  }
  tr.classList.toggle('dont-buy', p.dontBuy);
  const cashInput = $('[data-field="cash"]', tr);
  if (document.activeElement !== cashInput) cashInput.value = plain(p.cash);
  cashInput.classList.toggle('overridden', line.cashOverride != null && !custom);
  cashInput.classList.toggle('missing', p.cash == null && custom);
  $('[data-action="resetcash"]', tr).hidden = line.cashOverride == null || custom;
  $('[data-cell="cash-total"]', tr).textContent = p.cash != null && line.qty > 1 ? `${money(p.cash * line.qty)} for ${line.qty}` : '';
  $('[data-cell="credit"]', tr).innerHTML = offerCell(p.credit, line.qty);

  const flags = [];
  if (p.cash == null) flags.push('<span class="badge warn">Needs a price</span>');
  if (p.dontBuy) flags.push(`<span class="badge danger">Don't buy: ${esc(p.guide.note)}</span>`);
  else if (p.flat) flags.push(`<span class="badge guide">Guide: ${esc(p.guide.note)}</span>`);
  else if (p.guide?.info) flags.push(`<span class="badge info">${esc(p.guide.note)}</span>`);
  if (!p.flat && !p.dontBuy && p.cash != null && p.cash < settings.lowValue) flags.push('<span class="badge low">Low value</span>');
  if (line.category === 'pokemon') flags.push('<span class="badge info">Check authenticity – fakes exist</span>');
  if (isGameCat(line.category) && p.base >= 10000) flags.push('<span class="badge info">Over $100: anything missing or damaged? Ask Keith or Mark</span>');
  // Front End Processes: expensive, slow-selling, or rare items get checked against eBay sold listings.
  if (line.salesVolume != null && line.salesVolume < settings.slowSalesPerYear && p.base >= SLOW_SELLER_MIN_VALUE && !p.flat && !p.dontBuy) {
    flags.push(`<span class="badge slow">Slow seller: ${line.salesVolume} sold/yr – check eBay solds</span>`);
  }
  if (line.source === 'pc' && line.condition === 'parts' && line.override == null && !p.flat) {
    const parts = pcPartsPrice(line);
    const pct = parts?.pct != null ? `${pctText(settings.partsPctOfLoose)}% of loose = ${money(parts.pct)}` : 'no loose price';
    const min = parts?.regular ? `min ${money(parts.regular.parts)} (${esc(parts.regular.name)} parts)` : 'no regular model found – no minimum';
    flags.push(`<span class="badge info">Parts: ${pct} · ${min}</span>`);
  }
  if (line.condition === THIRD_PARTY) flags.push('<span class="badge info">Premium brand (8BitDo, Hori, Scuf, Nacon…)? Search PriceCharting instead</span>');
  if (p.scratchWaived) flags.push(`<span class="badge guide">${money(SCRATCH_FREE_MAX)} or less – no scratch deduction</span>`);
  if (line.source === 'hw' && isPcCondition(line.condition) && line.override == null && !p.flat && p.base != null) {
    const pcValue = line.prices?.[pcPriceKey(line, settings.rules[line.category] || settings.rules.other)];
    if (!(pcValue >= p.base)) { // the controller minimum beat PriceCharting's price
      const from = line.condition === 'cib' ? 'Working' : 'CIB';
      flags.push(`<span class="badge info">${HW_PC_CONDITIONS[line.condition]} minimum: ${from} +${pctText(settings.boxedStepPct)}%</span>`);
    }
  }
  if (p.cashEdited) flags.push('<span class="badge edited">Cash edited</span>');
  if (p.guideDontBuy) flags.push(`<span class="badge warn">Guide says don't buy: ${esc(p.guide.note)}</span>`);
  if (p.customCredit) flags.push(`<span class="badge edited">Custom store credit +${line.creditBonus}%</span>`);
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

// Trade totals (cash and credit) round to the nearest dollar: $8.50 → $9, $8.49 → $8. Items keep their cents.
const TOTAL_ROUND = 100;
const roundTotal = (cents) => Math.round(cents / TOTAL_ROUND) * TOTAL_ROUND;

// cash/credit are the rounded totals; itemsCash/itemsCredit what the items add up to.
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
  const t = { count, cash: roundTotal(cash), credit: roundTotal(credit), itemsCash: cash, itemsCredit: credit, missing, notBuying };
  // Staff typed a different cash total: store credit scales by the same ratio. The adjustment only
  // counts while the items still add up to what they did when it was typed (see renderTotals).
  const adj = trade.cashTotal;
  if (adj && adj.base === cash && cash > 0) {
    t.adjustedFrom = { cash: t.cash, credit: t.credit };
    t.cash = adj.cash;
    t.credit = roundTotal((credit * adj.cash) / cash);
  }
  return t;
}

// Explains why the totals differ from what the items add up to, or '' when they don't.
function totalsNote(t) {
  if (t.adjustedFrom) {
    return `Totals adjusted from ${money(t.adjustedFrom.cash)} cash · ${money(t.adjustedFrom.credit)} credit (store credit scaled to match).`;
  }
  if (t.itemsCash == null || (t.itemsCash === t.cash && t.itemsCredit === t.credit)) return '';
  return `Totals are rounded to the nearest dollar (items add up to ${money(t.itemsCash)} cash · ${money(t.itemsCredit)} credit).`;
}

// Staff typed a cash total: store it with what the items added up to at the time.
function setCashTotal(input) {
  const t = tradeTotals();
  const auto = t.adjustedFrom ? t.adjustedFrom.cash : t.cash;
  const cents = parseMoney(input.value);
  if (Number.isNaN(cents)) toast('Enter a cash total like 50', 'error');
  else if (cents == null || t.itemsCash <= 0 || roundTotal(cents) === auto) trade.cashTotal = null;
  else trade.cashTotal = { cash: roundTotal(cents), base: t.itemsCash };
  saveTrade();
  renderTotals();
  input.value = money(tradeTotals().cash);
}

function renderTotals() {
  let t = tradeTotals();
  if (trade.cashTotal && !t.adjustedFrom) { // items changed since the cash total was typed
    trade.cashTotal = null;
    saveTrade();
    toast('The trade changed, so the adjusted cash total was cleared.');
    t = tradeTotals();
  }
  $('#itemCount').textContent = t.count;
  const cashInput = $('#totalCash');
  if (document.activeElement !== cashInput) cashInput.value = money(t.cash);
  cashInput.classList.toggle('adjusted', !!t.adjustedFrom);
  $('#cashReset').hidden = !t.adjustedFrom;
  $('#totalCredit').textContent = money(t.credit);
  cashInput.title = totalsNote(t) || 'Type a different cash total to adjust the offer. Store credit scales to match.';
  $('#totalCredit').title = totalsNote(t);
  const notes = [];
  if (t.missing) notes.push(`${t.missing} need${t.missing === 1 ? 's' : ''} a price`);
  if (t.notBuying) notes.push(`${t.notBuying} not buying`);
  const warn = $('#needsPrice');
  warn.hidden = !notes.length;
  warn.textContent = notes.map((n) => ` · ${n}`).join('');
  renderSplit(t);
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
  if (field === 'creditBonus') {
    const n = Number(v);
    if (v.trim() !== '' && Number.isFinite(n) && n >= 0) line.creditBonus = n;
    e.target.value = line.creditBonus;
  }
  if (field === 'category') {
    line.category = v;
    const target = isGameCat(v) ? 'game' : 'hardware';
    line.deductions = (line.deductions || []).filter((id) => settings.deductions.find((d) => d.id === id)?.appliesTo === target);
    if (!isGameCat(v)) delete line.guideFlag;
    if (line.source === 'pc' && line.condition === 'parts' && !isHwCat(v)) line.condition = 'loose';
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
  } else if (field === 'cash') {
    // A typed cash offer is final for the line; typing the calculated number (or clearing it) goes back to auto.
    const auto = priceLine({ ...line, cashOverride: null, creditBonus: null }).cash;
    const cents = parseMoney(v);
    if (Number.isNaN(cents)) toast('Enter a cash offer like 12.50', 'error');
    else line.cashOverride = cents == null || cents === auto ? null : cents;
    e.target.value = plain(priceLine(line).cash);
  } else if (field === 'condition') {
    if (line.source === 'hw' && isPcCondition(v) && !line.matchedPcId) {
      // No PriceCharting product on this line yet: keep the old condition until staff pick one.
      e.target.value = line.condition;
      openPcPicker(line, v);
      return;
    }
    line.condition = v;
    if (line.source === 'hw') {
      const rule = settings.rules[line.category] || settings.rules.other;
      if (isPcCondition(v) && !(pcPriceKey(line, rule) in (line.prices || {}))) loadLinePrices(line);
      commit(); // Parts hides/shows the deduction menu; CIB/New show PriceCharting prices
      return;
    }
    if (line.source === 'pc') { commit(); return; } // Parts hides/shows the deduction menu
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
  } else if (action === 'resetcash') {
    line.cashOverride = null;
    saveTrade();
    updateRow(tr, line);
    renderTotals();
  } else if (action === 'credit') {
    line.creditBonus = normalCreditBonus(line);
    commit();
    $(`#lineBody tr[data-id="${line.id}"] [data-field="creditBonus"]`)?.select();
  } else if (action === 'uncredit') {
    delete line.creditBonus;
    commit();
  } else if (action === 'editbulk') {
    editBulkLine(line);
  }
}

/* ================================================================== scan / search box */

// attachTo: { lineId, name, category, unit, condition } while picking a PriceCharting product for a hardware line's CIB/New price.
const search = { q: '', hw: [], pc: null, loading: false, error: null, active: -1, items: [], seq: 0, attachTo: null };

function focusScan() {
  if (currentView === 'trade') $('#scanInput').focus();
}

// "joycons" -> "joycon", "joy-cons" -> "joy-con". Only words over 3 letters ending in a single "s".
const singular = (q) => q.split(/\s+/).map((w) => (w.length > 3 && /[^s]s$/i.test(w) ? w.slice(0, -1) : w)).join(' ');

// Buying-guide items for the dropdown. Spaces, hyphens, and a trailing "s" don't matter,
// so "joycons", "joy cons", and "Joy-Con" all find "Joy-Con Neon Blue".
function matchHardware(q) {
  const words = norm(q).split(' ').filter(Boolean);
  if (!words.length) return [];
  return hardware
    .filter((h) => {
      if (!h.name) return false;
      const hay = norm(`${h.name} ${CATEGORIES[h.category] || ''}`).replace(/ /g, '');
      return words.every((w) => hay.includes(w) || hay.includes(singular(w)));
    })
    .slice(0, 25);
}

function closeResults() {
  search.seq += 1;
  Object.assign(search, { q: '', hw: [], pc: null, loading: false, error: null, active: -1, attachTo: null });
  renderResults();
}

// PriceCharting search for a buying-guide name: "PS4 (PlayStation 4)" -> "PS4 console".
// Its search is fuzzy, so the (parenthetical) mostly pulls in games; "console" pulls in consoles.
function pcQuery(hw) {
  const q = hw.name.replace(/\([^)]*\)/g, ' ').replace(/[–/]/g, ' ').replace(/\s+/g, ' ').trim();
  return hw.category === 'console' && !/\b(console|system)\b/i.test(q) ? `${q} console` : q;
}

// A hardware line switched to CIB/New without a PriceCharting product: search PriceCharting
// in the scan box so staff pick the exact product (model, color, bundle) to price it from.
function openPcPicker(line, condition) {
  const input = $('#scanInput');
  const q = pcQuery(line);
  input.value = q;
  input.focus();
  input.scrollIntoView({ block: 'nearest' });
  runPcSearch(q);
  search.attachTo = { lineId: line.id, name: line.name, category: line.category, unit: lineHw(line).unit, condition };
  renderResults();
}

async function runPcSearch(q) {
  const seq = ++search.seq;
  Object.assign(search, { q, hw: matchHardware(q), pc: null, loading: true, error: null, active: -1, alt: null });
  renderResults();
  try {
    let results = await PC.search(q);
    if (seq !== search.seq) return;
    // PriceCharting's search doesn't match plurals ("joycons" finds 2 items, "joycon" finds 80+),
    // so when a plural search comes back thin, also search the singular and add those results.
    const alt = singular(q);
    if (results.length < 5 && alt.toLowerCase() !== q.toLowerCase()) {
      const more = await PC.search(alt);
      if (seq !== search.seq) return;
      const seen = new Set(results.map((p) => String(p.id)));
      const added = more.filter((p) => !seen.has(String(p.id)));
      if (added.length) {
        results = [...results, ...added];
        search.alt = alt;
      }
    }
    search.pc = results;
  } catch (err) {
    if (seq !== search.seq) return;
    search.error = err.message;
  }
  search.loading = false;
  renderResults();
}

function basisPrice(raw, cond, category = guessCategory(raw['product-name'] || '')) {
  if (flatItemMatch(raw['product-name'])) return settings.flatItems.amount; // steering wheels etc.
  const rule = settings.rules[category] || settings.rules.game;
  const v = raw[PC_FIELDS[rule.basis || 'retail-buy'][cond]];
  return v > 0 ? Number(v) : null;
}

// Result buttons show the flat price for steering wheels etc., which pay the same in any condition.
const flatOr = (name, price) => (flatItemMatch(name) ? settings.flatItems.amount : price);
const condBtn = (cond, label, price) => `<button type="button" class="cond-btn" data-cond="${cond}">${label} <b>${money(price)}</b></button>`;
const thirdPartyBtn = (hw) => (takesThirdParty(hw) ? condBtn(THIRD_PARTY, '3rd party', flatOr(hw.name, thirdPartyPrice(hw))) : '');
// CIB/New buttons for hardware, priced from a PriceCharting product (with the controller minimums when unit is given).
const pcCondBtns = (p, category, unit = null) => Object.entries(HW_PC_CONDITIONS).map(([c, label]) => condBtn(c, label,
  flatOr(p['product-name'], boxedPrice(slimProduct(p).prices, unit, category, c)))).join('');

function renderResults() {
  const el = $('#results');
  const attach = search.attachTo;
  search.items = [];
  let html = '';

  if (attach) {
    html += `<div class="results-note picker">Pick the PriceCharting product for <strong>${esc(attach.name)}</strong> to price it
      ${esc(HW_PC_CONDITIONS[attach.condition])}. Not the right results? Edit the search and press <kbd>Enter</kbd>, or <kbd>Esc</kbd> to cancel.</div>`;
  } else if (search.hw.length) {
    html += '<div class="results-group">Buying guide <span>cash prices · click a condition to add</span></div>';
    for (const h of search.hw) {
      const i = search.items.push({ kind: 'hw', hw: h }) - 1;
      const conds = Object.entries(hwConditionLabels(h.category)).filter(([f]) => h[f] != null)
        .map(([f, label]) => condBtn(f, label, flatOr(h.name, h[f]))).join('') + thirdPartyBtn(h);
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
    html += `<div class="results-group">PriceCharting <span>${search.alt ? `including results for “${esc(search.alt)}” · ` : ''}click a condition to ${attach ? 'use' : 'add'}</span></div>`;
    if (!search.pc.length) html += `<div class="results-note">No matches. Try fewer words${attach ? '' : ', or add it as a custom item'}.</div>`;
    for (const p of search.pc) {
      const sub = `<div class="r-main"><div class="r-name">${esc(p['product-name'])}</div><div class="sub">${esc(p['console-name'])}`;
      if (attach) {
        const i = search.items.push({ kind: 'pc', product: p }) - 1;
        html += `<div class="result" data-i="${i}">${sub}</div></div><div class="r-conds">${pcCondBtns(p, attach.category, attach.unit)}</div></div>`;
        continue;
      }
      const hw = hardwareMatch(p);
      if (hw) { // priced from the buying guide, plus CIB/New from PriceCharting
        const i = search.items.push({ kind: 'hw', hw, product: p }) - 1;
        const conds = Object.entries(hwConditionLabels(hw.category)).filter(([f]) => hw[f] != null)
          .map(([f, label]) => condBtn(f, label, flatOr(hw.name, hw[f]))).join('') + thirdPartyBtn(hw);
        html += `<div class="result" data-i="${i}">${sub} · buying guide price (${esc(hw.name)})</div></div>
          <div class="r-conds">${conds}${pcCondBtns(p, hw.category, hw.unit)}</div></div>`;
        continue;
      }
      const i = search.items.push({ kind: 'pc', product: p }) - 1;
      let conds = Object.entries(GAME_CONDITIONS).map(([c, label]) => condBtn(c, label, basisPrice(p, c))).join('');
      const category = guessCategory(p['product-name'] || '');
      if (isHwCat(category)) {
        const parts = pcPartsPrice({ name: p['product-name'], platform: p['console-name'], category, prices: slimProduct(p).prices });
        conds += condBtn('parts', 'Parts', flatOr(p['product-name'], parts?.price ?? null));
      }
      html += `<div class="result" data-i="${i}">${sub}</div></div><div class="r-conds">${conds}</div></div>`;
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
  const attach = search.attachTo;
  const input = $('#scanInput');
  input.value = '';
  closeResults();
  input.focus();
  if (attach) {
    attachPcProduct(attach, item.product, isPcCondition(condition) ? condition : attach.condition);
  } else if (item.kind === 'hw') {
    const cond = condition || defaultHwCondition(item.hw);
    if (isPcCondition(cond)) addHardwareFromSearch(item.hw, item.product, cond);
    else addHardware(item.hw, cond, null, item.product ? pcInfo(item.product) : null);
  } else {
    addFromSearch(item.product, condition || settings.defaultCondition);
  }
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
  const missing = missingBuiltIns().length;
  $('#hwBuiltIn').hidden = !missing;
  $('#hwBuiltIn').textContent = `+ ${missing} built-in item${missing === 1 ? '' : 's'}`;
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
    applyHardwareMatches();
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

// Built-in items whose name isn't on the saved list yet (compared the same loose way as hardwareMatch).
function missingBuiltIns() {
  const key = (name) => norm(name).replace(/ /g, '');
  const have = new Set(hardware.map((h) => key(h.name)));
  return seedHardware().filter((h) => !have.has(key(h.name)));
}

function addBuiltIns() {
  const add = missingBuiltIns();
  if (!add.length) return;
  hardware.push(...add);
  sortHardware();
  $('#hwFilter').value = '';
  setHwDirty(true);
  renderHardware();
  refreshComputed();
  toast(`${add.length} built-in item${add.length === 1 ? '' : 's'} added. Click Save changes to keep them.`);
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
      // The box shows 4 decimals; keep the exact stored value (e.g. 66.666…%) if it wasn't changed.
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
    const { cash, credit } = priceLine({ source: 'example', category: cat, override: 1000, qty: 1 }, s);
    $(`#rulesBody [data-example="${cat}"]`).textContent = `${money(cash)} cash · ${money(credit)} credit`;
  }
}

function basisCell(cat, rule) {
  if (isGameCat(cat)) {
    return `<select name="basis-${cat}">
      <option value="retail-buy"${rule.basis === 'retail-buy' ? ' selected' : ''}>PriceCharting retail buy</option>
      <option value="market"${rule.basis === 'market' ? ' selected' : ''}>PriceCharting market</option></select>`;
  }
  return '<span class="muted">Buying guide price · CIB/New: PriceCharting retail buy</span>';
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

// Unsaved edits in the Settings form: kept when switching tabs (the form isn't refilled), and the
// page warns before closing.
let settingsDirty = false;
function setSettingsDirty(dirty) {
  settingsDirty = dirty;
  $('#settingsStatus').textContent = dirty ? 'Unsaved changes' : '';
  $('#settingsStatus').classList.toggle('warn-text', dirty);
}

// s = the live settings, or a saved version from Change history (which then still needs saving).
function fillSettingsForm(s = settings) {
  const f = $('#settingsForm').elements;
  f.defaultCondition.value = s.defaultCondition;
  f.roundMode.value = s.roundMode;
  f.roundStep.value = String(s.roundStep);
  f.lowValue.value = plain(s.lowValue);
  f.slowSalesPerYear.value = s.slowSalesPerYear;
  f.partsPctOfLoose.value = pctText(s.partsPctOfLoose);
  f.thirdPartyPct.value = pctText(s.thirdPartyPct);
  f.boxedStepPct.value = pctText(s.boxedStepPct);
  f.flatKeywords.value = s.flatItems.keywords.join('\n');
  f.flatAmount.value = plain(s.flatItems.amount);
  f.floorPremiums.value = premiumsText(s.floorPremiums);
  f.shopName.value = s.shopName;
  f.quoteFooter.value = s.quoteFooter;
  f.guideEnabled.checked = s.guide.enabled;
  for (const key of GUIDE_LISTS) f[key].value = s.guide[key].join('\n');
  $('#rulesBody').innerHTML = Object.entries(s.rules).map(([cat, rule]) => `<tr>
    <td>${esc(CATEGORIES[cat])}</td>
    <td>${basisCell(cat, rule)}</td>
    <td class="num"><span class="pct-input"><input type="number" min="0" step="any" name="cashPct-${cat}" value="${pctText(rule.cashPct)}"><span>%</span></span></td>
    <td class="num"><span class="pct-input"><input type="number" min="0" step="any" name="creditPct-${cat}" value="${pctText(rule.creditPct)}"><span>%</span></span></td>
    <td class="num muted" data-example="${cat}"></td>
  </tr>`).join('');
  $('#dedBody').innerHTML = s.deductions.map(dedRowHtml).join('');
  renderRuleExamples();
  renderTokenStatus();
  renderAmazonStatus();
  setSettingsDirty(s !== settings); // a version loaded from Change history still needs saving
}

async function saveSettings(e) {
  e.preventDefault();
  const f = e.target.elements;
  const lowValue = parseMoney(f.lowValue.value);
  const flatAmount = parseMoney(f.flatAmount.value);
  const guide = { enabled: f.guideEnabled.checked };
  for (const key of GUIDE_LISTS) guide[key] = lines(f[key].value);
  const next = {
    ...settings,
    defaultCondition: f.defaultCondition.value,
    roundMode: f.roundMode.value,
    roundStep: Number(f.roundStep.value),
    lowValue: Number.isNaN(lowValue) || lowValue == null ? 0 : lowValue,
    slowSalesPerYear: Math.max(0, Math.round(Number(f.slowSalesPerYear.value) || 0)),
    partsPctOfLoose: Math.max(0, Number(f.partsPctOfLoose.value) || 0),
    thirdPartyPct: Math.max(0, Number(f.thirdPartyPct.value) || 0),
    boxedStepPct: Math.max(0, Number(f.boxedStepPct.value) || 0),
    flatItems: {
      amount: Number.isNaN(flatAmount) || flatAmount == null ? settings.flatItems.amount : flatAmount,
      keywords: lines(f.flatKeywords.value),
    },
    floorPremiums: premiumsFromText(f.floorPremiums.value),
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

function renderAmazonStatus(extra = '') {
  $('#amzSandbox').checked = amazonSandbox;
  $('#amzStatus').textContent = extra || (amazonSet
    ? `Amazon keys are saved${amazonSandbox ? ' (sandbox app: sample data only)' : ''}. Paste new ones to replace them.`
    : 'No Amazon keys saved. Floor Pricing leaves Amazon out until they are.');
}

async function saveAmazonKeys() {
  const body = {
    clientId: $('#amzClientId').value.trim(), clientSecret: $('#amzClientSecret').value.trim(),
    refreshToken: $('#amzRefresh').value.trim(), sandbox: $('#amzSandbox').checked,
  };
  if (!amazonSet && !(body.clientId && body.clientSecret && body.refreshToken)) {
    renderAmazonStatus('Fill in all three boxes the first time.');
    return;
  }
  try {
    const r = await api('amazon', { method: 'PUT', body });
    amazonSet = !!r.amazonSet;
    amazonSandbox = !!r.amazonSandbox;
    ['#amzClientId', '#amzClientSecret', '#amzRefresh'].forEach((sel) => { $(sel).value = ''; });
    floorAmazonCache.clear();
    renderAmazonStatus(amazonSet ? 'Amazon keys saved ✓ Click “Test connection” to check them.' : 'Saved, but a key is still missing.');
  } catch (err) {
    toast(`Couldn't save the Amazon keys: ${err.message}`, 'error');
  }
}

async function testAmazonKeys() {
  if (!amazonSet) { renderAmazonStatus('Save the Amazon keys first.'); return; }
  renderAmazonStatus('Testing…');
  try {
    const r = await api('amazon/test');
    renderAmazonStatus(r.sandbox
      ? 'Connected ✓ These are sandbox keys, so Amazon only answers with sample data. Swap in the production app’s keys for real prices.'
      : 'Connected ✓ Amazon accepted the keys.');
  } catch (err) {
    renderAmazonStatus(`Connection failed: ${err.message}`);
  }
}

async function clearAmazonKeys() {
  if (!amazonSet || !confirm('Remove the Amazon keys? Floor Pricing will stop checking Amazon.')) return;
  try {
    await api('amazon', { method: 'PUT', body: { clear: true } });
    amazonSet = false;
    amazonSandbox = false;
    floorAmazonCache.clear();
    renderAmazonStatus('Amazon keys removed.');
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ================================================================== change history (settings, hardware) */

// The server keeps the last 50 saves of each (api.php add_history). Each row says what changed from the
// save before it, and an older version can be loaded back in for a manager to check and save.
const historyLists = { settings: [], hardware: [] };

const SETTING_LABELS = {
  defaultCondition: 'Default condition', roundMode: 'Rounding', roundStep: 'Rounding step', lowValue: 'Low-offer flag',
  slowSalesPerYear: 'Slow-seller flag', partsPctOfLoose: 'Special-edition Parts %', thirdPartyPct: 'Third-party controller %',
  boxedStepPct: 'Boxed controller minimums', flatItems: 'Flat-price items', floorPremiums: 'Floor price premiums',
  shopName: 'Shop name', quoteFooter: 'Quote footer', deductions: 'Deductions', guide: 'Buying guide rules',
};

// What changed from an older settings save (a) to a newer one (b).
function settingsChanges(a, b) {
  if (!a) return ['Oldest saved version'];
  const out = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k === 'version' || JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
    if (k !== 'rules') { out.push(SETTING_LABELS[k] || k); continue; }
    for (const [cat, rule] of Object.entries(b.rules || {})) {
      const old = a.rules?.[cat] || {};
      const name = CATEGORIES[cat] || cat;
      if (old.cashPct !== rule.cashPct) out.push(`${name} cash ${pctText(old.cashPct)}% → ${pctText(rule.cashPct)}%`);
      if (old.creditPct !== rule.creditPct) out.push(`${name} credit ${pctText(old.creditPct)}% → ${pctText(rule.creditPct)}%`);
      if ((old.basis || '') !== (rule.basis || '')) out.push(`${name} value source`);
    }
  }
  return out.length ? out : ['No changes'];
}

// What changed from an older hardware price list (a) to a newer one (b), by item name.
function hardwareChanges(a, b) {
  if (!a) return ['Oldest saved version'];
  const byName = (list) => new Map((list || []).map((h) => [norm(h.name), h]));
  const A = byName(a);
  const B = byName(b);
  const few = (names) => `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}`;
  const added = [...B.entries()].filter(([k]) => !A.has(k)).map(([, h]) => h.name);
  const removed = [...A.entries()].filter(([k]) => !B.has(k)).map(([, h]) => h.name);
  const changed = [...B.entries()].filter(([k, h]) => A.has(k) && ['category', ...HW_FIELDS].some((f) => A.get(k)[f] !== h[f])).map(([, h]) => h.name);
  const out = [];
  if (changed.length) out.push(`Changed: ${few(changed)}`);
  if (added.length) out.push(`Added: ${few(added)}`);
  if (removed.length) out.push(`Removed: ${few(removed)}`);
  return out.length ? out : ['No changes'];
}

async function showHistory(of) {
  const box = $(`#${of}History`);
  box.hidden = false;
  box.innerHTML = '<p class="muted"><span class="spinner"></span>Loading…</p>';
  try {
    historyLists[of] = (await api('history', { params: { of } })) || [];
  } catch (err) {
    box.innerHTML = `<p class="error-text">${esc(err.message)}</p>`;
    return;
  }
  const list = historyLists[of];
  if (!list.length) { box.innerHTML = '<p class="muted">No saves recorded yet. History starts with the next save.</p>'; return; }
  const diff = of === 'settings' ? settingsChanges : hardwareChanges;
  box.innerHTML = `<table class="history"><thead><tr><th>Saved</th><th>By</th><th>What changed</th><th></th></tr></thead><tbody>${list.map((h, i) => {
    const changes = diff(list[i + 1]?.data, h.data);
    return `<tr><td class="nowrap">${esc(fmtTime(h.time))}</td><td>${esc(h.role === 'before history' ? '—' : `${h.role || ''} login`)}</td>
      <td>${changes.map(esc).join('<br>')}</td>
      <td>${i === 0 ? '<span class="muted">Current</span>' : `<button type="button" class="btn small" data-restore="${of}:${i}">Load this version</button>`}</td></tr>`;
  }).join('')}</tbody></table>`;
}

function restoreHistory(of, i) {
  const h = historyLists[of][i];
  if (!h) return;
  if (of === 'settings') {
    fillSettingsForm(mergeSettings(h.data)); // migrates an old version to today's format; still needs Save
    $('#settingsForm').scrollIntoView({ behavior: 'smooth' });
  } else {
    if (hwDirty && !confirm('Replace your unsaved hardware price changes with this older version?')) return;
    hardware = clone(h.data);
    setHwDirty(true);
    renderHardware();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  toast(`Loaded the version saved ${fmtTime(h.time)}. Check it, then save to put it back.`);
}

/* ================================================================== print */

const fmtTime = (iso) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

function payoutText(p) {
  if (!p) return '';
  if (p.type === 'cash') return `${money(p.cash)} cash`;
  if (p.type === 'credit') return `${money(p.credit)} store credit`;
  return `${money(p.cash)} cash + ${money(p.credit)} store credit`;
}

// Snapshot of the current trade's lines, in the same shape the trade log stores.
function tradeItems() {
  return trade.lines.filter((l) => !l.pending && !l.failed).map((l) => {
    const p = priceLine(l);
    return {
      name: l.name || 'Custom item', platform: l.platform || '', type: CATEGORIES[l.category] || '', condition: conditionLabel(l),
      qty: l.qty, cash: p.cash, credit: p.credit, dontBuy: p.dontBuy || undefined,
      deductions: lineDeductions(l).filter((d) => !(p.scratchWaived && d.resurface)).map((d) => d.label), note: p.guide?.note || undefined, upc: l.upc || undefined, serial: l.serial || undefined,
      creditBonus: p.customCredit ? l.creditBonus : undefined,
      cashEdited: p.cashEdited || undefined,
      ...(l.source === 'bulk' ? { type: 'TCG bulk', condition: '', detail: bulkBreakdown(l.bulkItems) } : {}),
    };
  });
}

const creditBonusText = (it) => (it.creditBonus != null ? `Custom store credit +${it.creditBonus}%` : '');

// One printed sheet for both quotes (current trade) and receipts (a logged trade).
function printSheet({ receipt, time, customer, items, totals, payout, staff, id }) {
  const rows = items.map((it) => {
    const detail = [it.detail, it.platform, it.condition, ...(it.deductions || []), creditBonusText(it), it.serial ? `Serial ${it.serial}` : ''].filter(Boolean).join(' · ');
    const cell = (c) => (it.dontBuy ? 'Not buying' : c == null ? '—' : money(c * it.qty));
    return `<tr><td>${esc(it.name)}${detail ? `<div class="sub">${esc(detail)}</div>` : ''}</td>
      <td class="num">${it.qty}</td><td class="num">${cell(it.cash)}</td><td class="num">${cell(it.credit)}</td></tr>`;
  }).join('');
  const meta = [receipt ? 'Trade-in receipt' : 'Trade-in quote', receipt && id ? `Trade #${id}` : '', fmtTime(time), customer, receipt && staff ? `Bought in by ${staff}` : ''].filter(Boolean);
  $('#printArea').innerHTML = `
    <h1>${esc(settings.shopName)}</h1>
    <p class="print-meta">${meta.map(esc).join(' · ')}</p>
    <table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Cash</th><th class="num">Store credit</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td>Total (${totals.count} items)</td><td></td><td class="num">${money(totals.cash)}</td><td class="num">${money(totals.credit)}</td></tr></tfoot></table>
    ${totalsNote(totals) ? `<p class="print-meta">${esc(totalsNote(totals))}</p>` : ''}
    ${payout ? `<p class="print-payout">${receipt ? 'Paid' : 'Customer is taking'}: <strong>${esc(payoutText(payout))}</strong></p>` : ''}
    ${receipt ? '<p class="print-sign">Customer signature: ______________________________</p>' : ''}
    ${settings.quoteFooter ? `<p class="print-footer">${esc(settings.quoteFooter)}</p>` : ''}`;
  window.print();
}

function printQuote() {
  const items = tradeItems();
  if (!items.length) { toast('Add some items first.'); return; }
  const t = tradeTotals();
  const split = trade.split ? splitPayout(t, trade.split.amount ?? 0, trade.split.by) : null;
  printSheet({
    time: new Date().toISOString(), customer: trade.customer, items, totals: t,
    payout: split ? { type: 'split', ...split } : null,
  });
}

/* ================================================================== split payout */

// Customer takes part in cash; the rest becomes store credit in proportion
// (credit rates differ by category, so this keeps every item's cash/credit ratio).
// Staff type either part (by = 'cash' or 'credit'); the other is worked out from it.
// Both parts round to whole dollars, like the totals.
function splitPayout(t, amount, by = 'cash') {
  const other = by === 'cash' ? 'credit' : 'cash';
  if (amount == null || Number.isNaN(amount) || t[by] <= 0) return null;
  const typed = roundTotal(Math.min(Math.max(0, amount), t[by]));
  return { [by]: typed, [other]: roundTotal(t[other] * (1 - typed / t[by])) };
}

const SPLIT_INPUTS = { cash: '#splitCash', credit: '#splitCredit' };
const PAY_SPLIT_INPUTS = { cash: '#paySplitCash', credit: '#paySplitCredit' };

// What a split box shows: the typed part as typed, the other part worked out from it.
function splitShown(t, k) {
  const { by, amount } = trade.split;
  if (k === by) return plain(amount);
  const s = splitPayout(t, amount ?? 0, by);
  return plain(s ? s[k] : null);
}

function renderSplit(t) {
  const open = !!trade.split;
  $('#splitBtn').hidden = open;
  $('#splitBox').hidden = !open;
  if (!open) return;
  for (const [k, sel] of Object.entries(SPLIT_INPUTS)) {
    const input = $(sel);
    if (document.activeElement !== input) input.value = splitShown(t, k);
  }
}

/* ================================================================== complete trade + trade log */

const SERIAL_CATEGORIES = ['console', 'handheld'];

function openComplete() {
  const t = tradeTotals();
  const lines = trade.lines.filter((l) => !l.pending && !l.failed);
  if (!lines.length) { toast('Add some items first.'); return; }
  if (trade.lines.some((l) => l.pending)) { toast('Wait for the lookups to finish.'); return; }
  if (t.missing) { toast(`${t.missing} item${t.missing === 1 ? '' : 's'} still need a price.`, 'error'); return; }
  const f = $('#completeForm').elements;
  $('#payCash').textContent = money(t.cash);
  $('#payCredit').textContent = money(t.credit);
  f.payout.value = trade.split ? 'split' : 'credit';
  dialogSplitBy = trade.split?.by || 'cash';
  $(PAY_SPLIT_INPUTS[dialogSplitBy]).value = plain(trade.split?.amount ?? null);
  updateDialogSplit();
  // Staff and customer names belong to this trade only: both start blank on every new trade.
  $('#staffName').value = trade.staff || '';
  $('#completeCustomer').value = trade.customer || '';
  $('#completeNotes').value = '';
  const serialLines = lines.filter((l) => SERIAL_CATEGORIES.includes(l.category));
  $('#serialFields').innerHTML = serialLines.map((l) => `<label>Serial number – ${esc(l.name)}${l.qty > 1 ? ` (×${l.qty}, separate with commas)` : ''}
    <input type="text" data-serial="${l.id}" value="${esc(l.serial || '')}" autocomplete="off" spellcheck="false"></label>`).join('');
  $('#idCheckRow').hidden = !serialLines.length;
  $('#idChecked').checked = false;
  $('#completeError').textContent = '';
  $('#completeDialog').showModal();
  $(!trade.staff ? '#staffName' : !trade.customer ? '#completeCustomer' : '#completeSave').focus();
}

// The dialog's split part staff typed last ('cash' or 'credit'); the other box is worked out from it.
let dialogSplitBy = 'cash';

function updateDialogSplit() {
  const other = dialogSplitBy === 'cash' ? 'credit' : 'cash';
  const s = splitPayout(tradeTotals(), parseMoney($(PAY_SPLIT_INPUTS[dialogSplitBy]).value) ?? 0, dialogSplitBy);
  $(PAY_SPLIT_INPUTS[other]).value = plain(s ? s[other] : null);
}

// True while a completed trade is being sent, so a double-click can't log it twice.
let completing = false;

async function saveCompleted(print) {
  if (completing) return;
  const error = $('#completeError');
  error.textContent = '';
  const t = tradeTotals();
  const staff = $('#staffName').value.trim();
  const customer = $('#completeCustomer').value.trim();
  if (!staff) { error.textContent = 'Enter your name.'; $('#staffName').focus(); return; }
  if (!customer) { error.textContent = "Enter the customer's name."; $('#completeCustomer').focus(); return; }
  let payout;
  const type = $('#completeForm').elements.payout.value;
  if (type === 'cash') payout = { type, cash: t.cash, credit: 0 };
  else if (type === 'credit') payout = { type, cash: 0, credit: t.credit };
  else {
    const s = splitPayout(t, parseMoney($(PAY_SPLIT_INPUTS[dialogSplitBy]).value), dialogSplitBy);
    if (!s) { error.textContent = 'Enter how much of it is cash or store credit.'; return; }
    payout = { type: 'split', ...s };
  }
  $$('#serialFields [data-serial]').forEach((input) => {
    const line = trade.lines.find((l) => l.id === input.dataset.serial);
    if (line) line.serial = input.value.trim();
  });
  const needsId = !$('#idCheckRow').hidden;
  if (needsId && !$('#idChecked').checked) { error.textContent = "Check the customer's photo ID before buying consoles or handhelds."; return; }
  Object.assign(trade, { staff, customer });
  saveTrade();
  const record = {
    staff, customer, payout, totals: { cash: t.cash, credit: t.credit, count: t.count, adjustedFrom: t.adjustedFrom },
    idChecked: needsId || undefined, notes: $('#completeNotes').value.trim() || undefined, items: tradeItems(),
  };
  let saved;
  const buttons = $$('#completeSave, #completePrint');
  completing = true;
  buttons.forEach((b) => { b.disabled = true; });
  try {
    saved = await api('trades', { method: 'POST', body: record });
  } catch (err) {
    error.textContent = `Couldn't save the trade: ${err.message}`;
    return;
  } finally {
    completing = false;
    buttons.forEach((b) => { b.disabled = false; });
  }
  $('#completeDialog').close();
  if (print) printSheet({ ...record, receipt: true, time: saved.time, id: saved.id });
  resetTrade();
  toast(`Trade${saved?.id ? ` #${saved.id}` : ''} saved to the trade log.`);
}

// New trade: empty list, and the staff and customer names start blank again.
function resetTrade() {
  Object.assign(trade, { lines: [], customer: '', staff: '', split: null, cashTotal: null, bulk: { counts: {}, lineId: null } });
  $('#customerName').value = '';
  commit();
  focusScan();
}

/* ---------------------------------------------------------------- held trades */

// Hold the current trade (the customer is still shopping, or went to get more games) and start another.
// Held trades live on this computer only (localStorage), with the prices they had when held.
const HELD_KEY = 'p2w-held-trades';
let heldTrades = store.get(HELD_KEY, []);

const heldEntry = () => ({ id: uid(), heldAt: new Date().toISOString(), trade: clone(trade) });

function holdTrade() {
  if (trade.lines.some((l) => l.pending)) { toast('Wait for the lookups to finish.'); return; }
  if (!trade.lines.some((l) => !l.failed)) { toast('Add some items first.'); return; }
  const who = trade.customer.trim() || 'The trade';
  heldTrades.unshift(heldEntry());
  store.set(HELD_KEY, heldTrades);
  resetTrade();
  renderHeld();
  toast(`${who} is on hold. Pick it from “Held trades” to finish it.`);
}

function resumeHeld(id) {
  const i = heldTrades.findIndex((h) => h.id === id);
  if (i < 0) return;
  if (trade.lines.some((l) => l.pending)) { toast('Wait for the lookups to finish.'); return; }
  const [h] = heldTrades.splice(i, 1);
  if (trade.lines.length) heldTrades.unshift(heldEntry()); // swap: the open trade goes on hold instead
  store.set(HELD_KEY, heldTrades);
  Object.assign(trade, { customer: '', staff: '', split: null, cashTotal: null, bulk: { counts: {}, lineId: null } }, h.trade);
  $('#customerName').value = trade.customer || '';
  commit();
  renderHeld();
  focusScan();
  toast(`Back to ${trade.customer || 'the held trade'}.`);
}

function renderHeld() {
  const sel = $('#heldSelect');
  sel.hidden = !heldTrades.length;
  const items = (t) => t.lines.filter((l) => !l.pending && !l.failed).reduce((n, l) => n + (l.qty || 1), 0);
  sel.innerHTML = `<option value="">Held trades (${heldTrades.length})…</option>${heldTrades.map((h) => `<option value="${esc(h.id)}">
    ${esc(h.trade.customer || 'No name')} · ${items(h.trade)} item${items(h.trade) === 1 ? '' : 's'} · held ${esc(fmtTime(h.heldAt))}</option>`).join('')}`;
}

/* ---------------------------------------------------------------- trade log */

let logRecords = [];
let logQuery = {}; // what the shown records were loaded with (for the export's file name)

// A local calendar day (YYYY-MM-DD, from a date box) -> the UTC time it starts at, in the trade log's format.
function dayStartIso(day, addDays = 0) {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + addDays);
  return d.toISOString().replace(/\.\d{3}Z$/, '+00:00');
}
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function loadLog() {
  const q = $('#logSearch').value.trim();
  const from = $('#logFrom').value;
  const to = $('#logTo').value;
  if (from && to && to < from) { toast('The "To" date is before the "From" date.', 'error'); return; }
  const params = {};
  if (q) params.q = q;
  if (from) params.from = dayStartIso(from);
  if (to) params.to = dayStartIso(to, 1); // through the end of that day
  $('#logNote').textContent = 'Loading…';
  try {
    logRecords = (await api('trades', { params })) || [];
  } catch (err) {
    $('#logNote').textContent = err.message;
    return;
  }
  // The shop PC's offline server ignores from/to, so the range is applied here too.
  const inRange = (r) => (!params.from || new Date(r.time) >= new Date(params.from)) && (!params.to || new Date(r.time) < new Date(params.to));
  logRecords = logRecords.filter(inRange);
  logQuery = { q, from, to };
  $('#logBody').innerHTML = logRecords.map((r, i) => `<tr class="log-row" data-i="${i}">
      <td>${esc(fmtTime(r.time))}${r.id ? `<div class="sub">#${esc(r.id)}</div>` : ''}</td><td>${esc(r.customer || '—')}</td><td>${esc(r.staff || '')}</td>
      <td class="num">${r.totals?.count ?? (r.items || []).length}</td><td>${esc(payoutText(r.payout))}</td></tr>`).join('')
    || `<tr><td colspan="5" class="empty-cell">${q || from || to ? 'No trades match.' : 'No trades yet. They show up here after “Complete trade”.'}</td></tr>`;
  renderLogSummary(from || to);
  const cap = from || to ? 2000 : 100;
  $('#logNote').textContent = logRecords.length >= cap
    ? `Showing the newest ${cap}.${from || to ? ' Pick a shorter date range to see them all.' : ' Pick dates or search to find older trades.'}` : '';
}

// Totals of what was actually paid out (the payout chosen at "Complete trade"), for the trades shown.
function logTotals(records) {
  return records.reduce((t, r) => ({
    trades: t.trades + 1,
    items: t.items + (r.totals?.count ?? (r.items || []).length),
    cash: t.cash + (r.payout?.cash || 0),
    credit: t.credit + (r.payout?.credit || 0),
  }), { trades: 0, items: 0, cash: 0, credit: 0 });
}

function renderLogSummary(show) {
  const el = $('#logSummary');
  el.hidden = !show || !logRecords.length;
  if (el.hidden) return;
  const t = logTotals(logRecords);
  el.innerHTML = `<strong>${t.trades}</strong> trade${t.trades === 1 ? '' : 's'} · ${t.items} item${t.items === 1 ? '' : 's'} · `
    + `<strong>${money(t.cash)}</strong> cash paid out · <strong>${money(t.credit)}</strong> store credit issued`;
}

// One row per trade, for a spreadsheet or the bookkeeper.
function exportLog() {
  if (!logRecords.length) { toast('Search or pick dates first, then export what is shown.'); return; }
  const cell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const dollars = (c) => (c == null ? '' : (c / 100).toFixed(2));
  const rows = logRecords.map((r) => [
    fmtTime(r.time), r.id || '', r.customer || '', r.staff || '', r.totals?.count ?? (r.items || []).length,
    r.payout?.type || '', dollars(r.payout?.cash || 0), dollars(r.payout?.credit || 0),
    dollars(r.totals?.cash), dollars(r.totals?.credit), r.idChecked ? 'yes' : '',
    (r.items || []).map((it) => `${it.qty > 1 ? `${it.qty} × ` : ''}${it.name}${it.platform ? ` (${it.platform})` : ''}${it.serial ? ` [serial ${it.serial}]` : ''}`).join('; '),
    r.notes || '',
  ]);
  const head = ['Date', 'Trade #', 'Customer', 'Staff', 'Items', 'Payout', 'Cash paid', 'Store credit issued', 'Cash offer', 'Store credit offer', 'Photo ID checked', 'Items list', 'Notes'];
  const csv = [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const { from, to } = logQuery;
  const name = `trade-log${from ? `-${from}` : ''}${to && to !== from ? `-to-${to}` : ''}.csv`;
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv' })), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function logDetailHtml(r, i) {
  const items = (r.items || []).map((it) => {
    const detail = [it.detail, it.platform, it.type, it.condition, ...(it.deductions || []), creditBonusText(it), it.cashEdited ? 'Cash edited' : '', it.serial ? `Serial ${it.serial}` : '', it.note].filter(Boolean).join(' · ');
    const cell = (c) => (it.dontBuy ? 'Not buying' : money(c == null ? null : c * it.qty));
    return `<tr><td>${esc(it.name)}<div class="sub">${esc(detail)}</div></td><td class="num">${it.qty}</td><td class="num">${cell(it.cash)}</td><td class="num">${cell(it.credit)}</td></tr>`;
  }).join('');
  const facts = [r.idChecked ? 'Photo ID checked' : '', r.notes ? `Notes: ${r.notes}` : '', `Logged by ${r.staff}${r.role ? ` (${r.role} login)` : ''}`].filter(Boolean);
  return `<tr class="log-detail"><td colspan="5">
    <table class="log-items"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Cash</th><th class="num">Credit</th></tr></thead><tbody>${items}</tbody></table>
    <p class="muted small-print">${facts.map(esc).join(' · ')}</p>
    <button type="button" class="btn small" data-reprint="${i}">Print receipt</button></td></tr>`;
}

function onLogClick(e) {
  const reprint = e.target.closest('[data-reprint]');
  if (reprint) {
    const r = logRecords[Number(reprint.dataset.reprint)];
    printSheet({ ...r, receipt: true });
    return;
  }
  const row = e.target.closest('tr.log-row');
  if (!row) return;
  const open = row.nextElementSibling?.classList.contains('log-detail');
  $$('#logBody tr.log-detail').forEach((d) => d.remove());
  $$('#logBody tr.log-row').forEach((r) => r.classList.remove('open'));
  if (!open) {
    row.insertAdjacentHTML('afterend', logDetailHtml(logRecords[Number(row.dataset.i)], row.dataset.i));
    row.classList.add('open');
  }
}

/* ================================================================== views + init */

/* ================================================================== TCG bulk tab */

// Rates come from the website's assets/bulk-rates.json (also shown on bulk-rates.html).
// price is dollars per `per` cards: per 1000 for per-1k rates, per 1 for per-card rates.
let bulkRates = null;
let bulkError = '';
// Counts being entered; lineId is set while editing a bulk line already on the trade.
trade.bulk = trade.bulk || { counts: {}, lineId: null };

const bulkRateText = (it) => (Number(it.per) === 1 ? `${money(Math.round(it.price * 100))} each`
  : `${money(Math.round(it.price * 100))} / ${Number(it.per) === 1000 ? '1k' : it.per}`);
const bulkItemTotal = (it, count) => Math.round((count * Math.round(it.price * 100)) / Number(it.per || 1));
// "2,350 × Pokémon – Commons"; Other TCGs items already name their game.
const bulkBreakdown = (items) => (items || []).map((i) => `${Number(i.count).toLocaleString('en-US')} × ${i.groupId === 'other' || !i.group ? i.name : `${i.group} – ${i.name}`}`).join(' · ');

async function loadBulkRates() {
  bulkError = '';
  try {
    const res = await fetch('../assets/bulk-rates.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    bulkRates = await res.json();
  } catch (err) {
    bulkError = `Couldn't load the bulk rates (${err.message}).`;
  }
  renderBulk();
}

function bulkGroups() {
  return (bulkRates?.groups || []).filter((g) => g.items?.length);
}

function renderBulk() {
  const box = $('#bulkGroups');
  if (bulkError) {
    box.innerHTML = `<div class="panel"><p class="error">${esc(bulkError)}</p><button type="button" class="btn" data-bulk-retry>Try again</button></div>`;
  } else if (!bulkRates) {
    box.innerHTML = '<p class="muted"><span class="spinner"></span>Loading bulk rates…</p>';
  } else {
    const counts = trade.bulk.counts;
    box.innerHTML = bulkGroups().map((g) => `<div class="table-wrap bulk-group">
      <table>
        <caption>${esc(g.name)}${g.note ? `<span class="muted">${esc(g.note)}</span>` : ''}</caption>
        <thead><tr><th>Item</th><th class="num">Rate</th><th class="num">Cards</th><th class="num">Pays</th></tr></thead>
        <tbody>${g.items.map((it) => `<tr>
          <td>${esc(it.name)}</td>
          <td class="num muted">${esc(bulkRateText(it))}</td>
          <td class="num"><input type="number" class="bulk-count" data-bulk="${esc(it.id)}" min="0" step="1" inputmode="numeric"
            value="${counts[it.id] || ''}" placeholder="0" aria-label="${esc(it.name)} cards"></td>
          <td class="num" data-bulk-total="${esc(it.id)}"></td></tr>`).join('')}</tbody>
      </table></div>`).join('');
  }
  updateBulkTotals();
}

// The rate items with a count, snapshotted (name/rate/total) so a logged trade keeps today's rates.
function bulkSelection() {
  const counts = trade.bulk.counts;
  return bulkGroups().flatMap((g) => g.items
    .filter((it) => counts[it.id] > 0)
    .map((it) => ({ id: it.id, name: it.name, group: g.name, groupId: g.id, count: counts[it.id], price: it.price, per: it.per, total: bulkItemTotal(it, counts[it.id]) })));
}

function updateBulkTotals() {
  for (const g of bulkGroups()) {
    for (const it of g.items) {
      const cell = $(`[data-bulk-total="${CSS.escape(it.id)}"]`);
      const n = trade.bulk.counts[it.id] || 0;
      if (cell) cell.innerHTML = n ? money(bulkItemTotal(it, n)) : '<span class="muted">—</span>';
    }
  }
  const sel = bulkSelection();
  const total = sel.reduce((sum, i) => sum + i.total, 0);
  const cards = sel.reduce((sum, i) => sum + i.count, 0);
  $('#bulkTotal').textContent = money(total);
  $('#bulkCount').textContent = cards ? `${cards.toLocaleString('en-US')} cards` : '';
  const editing = trade.lines.some((l) => l.id === trade.bulk.lineId);
  const btn = $('#bulkAdd');
  btn.textContent = editing ? 'Update trade line' : 'Add to trade';
  btn.disabled = total <= 0;
}

function addBulkToTrade() {
  const items = bulkSelection();
  const total = items.reduce((sum, i) => sum + i.total, 0);
  if (total <= 0) return;
  const i = trade.lines.findIndex((l) => l.id === trade.bulk.lineId);
  const existing = trade.lines[i];
  const line = {
    id: existing?.id || uid(), source: 'bulk', name: 'TCG bulk', category: 'other', qty: 1, override: null, deductions: [],
    bulkItems: items, bulkTotal: total, creditBonus: existing?.creditBonus,
  };
  if (existing) trade.lines[i] = line; // editing keeps its place (and any custom store credit %)
  else trade.lines.unshift(line);
  trade.bulk = { counts: {}, lineId: null };
  saveTrade();
  showView('trade');
  flash(line.id);
  toast(`${existing ? 'Updated' : 'Added'} TCG bulk: ${money(total)}`);
}

function editBulkLine(line) {
  const counts = {};
  for (const i of line.bulkItems || []) counts[i.id] = i.count;
  trade.bulk = { counts, lineId: line.id };
  saveTrade();
  showView('bulk');
}

function onBulkInput(e) {
  const id = e.target.dataset.bulk;
  if (!id) return;
  const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
  if (n) trade.bulk.counts[id] = n;
  else delete trade.bulk.counts[id];
  saveTrade();
  updateBulkTotals();
}

function showBulk() {
  if (!bulkRates && !bulkError) loadBulkRates();
  else renderBulk();
}

/* ================================================================== floor pricing */

// Game Pricing Guide (the Google Sheet tab), made hands-free: the sales PriceCharting lists are eBay
// sold listings, so they stand in for "eBay highest sold" at any price. Modern systems take the highest
// of GameStop's pre-owned price, Amazon's lowest offer, and that sale (owner's choice).
// Systems are PriceCharting console names (norm()'d, without a PAL/JP prefix).
const FLOOR_TIERS = [
  {
    id: 'retro', rule: "Top recent eBay sales (from PriceCharting), never below GameStop's pre-owned price, nudged toward Amazon when it's higher",
    systems: ['playstation', 'playstation 2', 'xbox', 'nes', 'super nintendo', 'nintendo 64', 'wii', 'wii u', 'gameboy',
      'gameboy color', 'gameboy advance', 'nintendo ds', 'nintendo 3ds', 'sega genesis', 'sega dreamcast', 'gamecube',
      'playstation 3', 'xbox 360'],
  },
  {
    id: 'modern', gamestop: true, amazon: true,
    rule: "Highest of GameStop's pre-owned price, Amazon's lowest offer, and the top recent eBay sales",
    systems: ['playstation 4', 'playstation 5', 'xbox one', 'xbox series x', 'nintendo switch', 'nintendo switch 2'],
  },
];
const FLOOR_OTHER = { id: 'other', rule: 'Not in the Game Pricing Guide: top recent eBay sales (from PriceCharting), nudged toward Amazon. Double-check it' };
// The sale the price comes from: the 90th percentile of the condition's normal recent sales (about the
// 4th highest of 30). Checked against a month of the shop's own shelf prices (140 PS2/GameCube games,
// Sept 2026): the single highest sale ran ~$12 high on average and was within $5 only 40% of the time;
// the 90th percentile was within $5 65% of the time with no overall bias. Skipping one-off highs did worse.
// Expensive games are priced nearer the top, though: once the 90th-percentile sale reaches FLOOR_HIGH, the
// second-highest normal sale is used instead. Same backtest: games the shop priced at $60+ went from 46% to
// 71% within 10%, and all games from 68% to 72% within 10% (avg miss $8.05 -> $7.76).
const FLOOR_PCT = 0.9;
const FLOOR_HIGH = 8000;
const FLOOR_FEW_SALES = 3;         // fewer non-odd sales than this: ask staff to double-check
const FLOOR_STALE_DAYS = 180;      // newest sale older than this: ask staff to double-check
const FLOOR_REVIEW = 10000;        // shelf price this high or more (cents): ask staff to double-check (owner request)
const FLOOR_MIN = 1000; // only shitbox games go on the shelf at $5
const FLOOR_MIN_SHITBOX = 500;
const FLOOR_STEP = 500; // suggested prices round up to the next $5
// Older systems and Amazon (owner's rules, Oct 2026), for systems that don't take Amazon's price outright:
//  - When Amazon's typical offer (the middle of the offers Amazon returns, shipping included) is above the
//    eBay/GameStop price, go halfway toward it, but at most FLOOR_AMAZON_PULL above. Typical, not lowest: one
//    cheap "Acceptable" copy shouldn't sink it (Pokemon Diamond, DS, loose: lowest $54.01, typical $84.80,
//    GameStop $64.99 -> $75, the shop's price; Diddy Kong Racing, N64, loose: GameStop $39.99 -> shop $45).
//    The cap keeps inflated third-party asking prices from setting the shelf price.
//  - When Amazon lists the game but has no offers in that condition, copies are scarce: price from the
//    highest normal sale plus FLOOR_SCARCE_MARKUP. Pokemon Emerald (GBA, loose): $275 (second-highest)
//    -> highest sale $314.95 + 10% -> $350, the shop's price.
const FLOOR_AMAZON_PULL = 0.25;
const FLOOR_SCARCE_MARKUP = 0.10;
// Sales whose listing title suggests it isn't a normal copy: shown, but never picked automatically.
const ODD_SALE_RE = /\b(lot|lots|bundle|bundled|graded|wata|vga|cgc|repro|reproduction|case only|box only|manual only|empty case|no game|art only|insert only|choose|pick|signed|autographed|autograph|\d+ (more )?games)\b/i;
// "Disc only" / "cart only" is exactly what a loose game is; it's only odd for CIB and New sales (Oct 2026: it was
// odd everywhere, which threw out 26 of Pokemon Colosseum's 30 loose sales).
const NOT_COMPLETE_RE = /\b(disc only|disk only|cart only|cartridge only|game only)\b/i;
// A loose game sold with the accessory it shipped with (Hey You Pikachu's VRU/mic, HeartGold's Pokewalker,
// Stadium's Transfer Pak): odd for loose, since a loose copy on the shelf doesn't have it.
const LOOSE_EXTRAS_RE = /\b(vru|microphone|mic|pokewalker|poke ?walker|transfer pak|rumble pak|expansion pak)\b/i;
const SEALED_RE = /\b(sealed|brand new|new in box|nib)\b/i;
// The game sold together with a console or handheld ("DS Lite Onyx Black + Pokemon Diamond + Charger"): odd too.
// Kept narrow on purpose: compatibility lists ("Nintendo DS Lite DSi XL 3DS 2DS Game") and "Entertainment
// System" are normal game listings, so hardware only counts next to a "+", and "console/system" only after "with".
const BUNDLE_HW = String.raw`(?:nintendo |new )?(?:ds ?lite|dsi(?: xl)?|[23]ds(?: xl)?|game ?boy(?: advance| color| pocket| sp)?|gba(?: sp)?|psp|ps ?vita|console|system|handheld)`;
// A specific handheld model first, then "with"/"w/" ("Nintendo DS Lite w/ Pokemon Diamond"); not plain platform
// names, which normal listings start with ("Nintendo Game Boy Advance Pokemon Emerald CIB w/ poster").
const BUNDLE_MODEL = String.raw`(?:nintendo |new )?(?:ds ?lite|dsi(?: xl)?|[23]ds(?: xl)?|(?:game ?boy advance|gba) sp|psp|ps ?vita)`;
const BUNDLE_RE = new RegExp(String.raw`\b(charger|charging cable|power (cord|supply)|ac adapter)\b|\b(with|w\/) ?(the |a )?(console|system|handheld)\b|^${BUNDLE_HW}\b[^+]*\+|\+ ?${BUNDLE_HW}\b|^${BUNDLE_MODEL}\b.*?(\bwith\b|\bw\/)`
  // "GameCube Console Tested With Controller And Cords", "Console With Cables", "+ controller"
  + String.raw`|\bconsole\b.*\b(controllers?|cables?|cords?)\b|\b(with|w\/|\+) ?(a |the )?(controllers?|cables|cords)\b`, 'i');

function floorTier(platform) {
  const p = norm(platform).replace(/^(pal|jp) /, '');
  return FLOOR_TIERS.find((t) => t.systems.includes(p)) || FLOOR_OTHER;
}

// Missing manual on a CIB game: by its normal CIB shelf price.
function manualDeduction(price) {
  if (price <= 2000) return 0;
  if (price <= 5000) return 500;
  if (price <= 10000) return 1000;
  if (price <= 20000) return 2000;
  return Math.round((price * 0.1) / 500) * 500; // $205+: 10%, to the nearest $5
}

// Basis (cents) -> shelf price: round up to the next $5, the $10 floor ($5 for shitbox games),
// then the missing-manual deduction.
// Never below GameStop's pre-owned price (gs, owner's rule), even after the missing-manual deduction;
// rounded up to the next $5 like everything else. Typed prices pass gs = null (staff get a warning instead).
// premium ({ phrase, pct } from floorPremium) goes on the basis before rounding; typed prices pass none.
function floorPrice(basis, { shitbox, manualMissing, gs = null, premium = null }) {
  if (basis == null) return null;
  const min = shitbox ? FLOOR_MIN_SHITBOX : FLOOR_MIN;
  const premiumBasis = premium ? Math.round(basis * (1 + premium.pct / 100)) : basis;
  const full = Math.max(min, Math.ceil(premiumBasis / FLOOR_STEP) * FLOOR_STEP);
  const ded = manualMissing ? manualDeduction(full) : 0;
  const gsFloor = gs > 0 ? Math.ceil(gs / FLOOR_STEP) * FLOOR_STEP : 0;
  const price = Math.max(full - ded, gsFloor);
  return { full, ded, price, min, gsRaised: price > full - ded ? gsFloor : 0, premium, premiumBasis };
}

// GameStop's pre-owned price for the game being priced, or null (PriceCharting uses 0 when GameStop doesn't carry it).
const floorGs = (p) => (Number(p['gamestop-price']) > 0 ? Number(p['gamestop-price']) : null);

const floorOdd = (sale, condition) => ODD_SALE_RE.test(sale.title) || BUNDLE_RE.test(sale.title)
  || (condition === 'loose' ? LOOSE_EXTRAS_RE.test(sale.title) : NOT_COMPLETE_RE.test(sale.title))
  || (condition !== 'new' && SEALED_RE.test(sale.title));

// Links for double-checking a price on eBay, GameStop, Amazon, or PriceCharting.
function floorLinks(p, condition) {
  const name = baseTitle(p['product-name']) || p['product-name'];
  const sys = p['console-name'] || '';
  const extra = { cib: ' complete', new: ' sealed', loose: '' }[condition];
  const q = (s) => encodeURIComponent(s.replace(/\s+/g, ' ').trim());
  return {
    ebay: `https://www.ebay.com/sch/i.html?_nkw=${q(`${name} ${sys}${extra}`)}&_sacat=139973&LH_Sold=1&LH_Complete=1&_sop=16`,
    gamestop: `https://www.gamestop.com/search/?q=${q(name)}`,
    amazon: `https://www.amazon.com/s?k=${q(`${name} ${sys}`)}`,
    pc: /^\d+$/.test(String(p.id)) ? pcUrl(p.id) : '',
  };
}

// The list being priced. Kept in this browser so a refresh doesn't lose it; saved to the server by name.
const floor = Object.assign({ id: null, name: '', staff: '', items: [], dirty: false, savedAt: null }, store.get('p2w-floor', {}));
const saveFloorLocal = () => store.set('p2w-floor', floor);
// The game being priced right now: { product, condition, manualMissing, sales, salesError, pick, typed }.
let floorCur = null;
const floorSearch = { q: '', results: null, loading: false, error: null, seq: 0 };
const floorSalesCache = new Map(); // product id -> { loose, cib, new }
const floorAmazonCache = new Map(); // "upc|used" or "upc|new" -> amazon/offers response
// Amazon has no Loose/CIB split: Loose and CIB games compare with its Used offers.
const amazonCond = (condition) => (condition === 'new' ? 'new' : 'used');
const AMZ_SUB = { new: 'New', mint: 'Mint', like_new: 'Like new', very_good: 'Very good', good: 'Good', acceptable: 'Acceptable', poor: 'Poor', club: 'Club', oem: 'OEM', warranty: 'Warranty', refurbished_warranty: 'Refurbished', refurbished: 'Refurbished', open_box: 'Open box', other: 'Other' };

function showFloor() {
  $('#floorName').value = floor.name;
  $('#floorStaff').value = floor.staff;
  renderFloorList();
  renderFloorPricer();
  loadFloorSessions();
  $('#floorScan').focus();
}

/* ---------------------------------------------------------------- search */

function closeFloorResults() {
  floorSearch.seq += 1;
  Object.assign(floorSearch, { results: null, loading: false, error: null });
  renderFloorResults();
}

async function runFloorSearch(q) {
  const seq = ++floorSearch.seq;
  Object.assign(floorSearch, { q, results: null, loading: true, error: null });
  renderFloorResults();
  try {
    const results = await PC.search(q);
    if (seq !== floorSearch.seq) return;
    floorSearch.results = results;
  } catch (err) {
    if (seq !== floorSearch.seq) return;
    floorSearch.error = err.message;
  }
  floorSearch.loading = false;
  renderFloorResults();
}

async function floorScanUpc(upc) {
  closeFloorResults();
  try {
    pickFloorGame(await PC.byUpc(upc));
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderFloorResults() {
  const el = $('#floorResults');
  let html = '';
  if (floorSearch.loading) html = '<div class="results-note"><span class="spinner"></span>Searching PriceCharting…</div>';
  else if (floorSearch.error) html = `<div class="results-note error">${esc(floorSearch.error)}</div>`;
  else if (floorSearch.results) {
    html = '<div class="results-group">PriceCharting <span>click a game to price it</span></div>';
    if (!floorSearch.results.length) html += '<div class="results-note">No matches. Try fewer words.</div>';
    floorSearch.results.forEach((p, i) => {
      html += `<div class="result" data-i="${i}"><div class="r-main"><div class="r-name">${esc(p['product-name'])}</div>
        <div class="sub">${esc(p['console-name'])}</div></div>
        <div class="r-offer muted">CIB ${money(Number(p['cib-price']) || null)}</div></div>`;
    });
  }
  el.innerHTML = html;
  el.hidden = !html;
}

/* ---------------------------------------------------------------- pricing one game */

function pickFloorGame(product) {
  $('#floorScan').value = '';
  closeFloorResults();
  floorCur = { product, condition: 'cib', manualMissing: false, sales: null, salesError: null, pick: null, typed: null, showAll: false };
  renderFloorPricer();
  loadFloorSales(product);
  const tier = floorTier(product['console-name']);
  const needsFull = !('gamestop-price' in product) || (amazonSet && !product.upc);
  if (needsFull && tokenSet) {
    PC.byId(product.id).then((full) => {
      if (floorCur?.product !== product || !full) return;
      product['gamestop-price'] = full['gamestop-price'];
      product.upc = product.upc || full.upc || '';
      renderFloorPricer();
      loadFloorAmazon();
    }).catch(() => {});
  } else {
    loadFloorAmazon();
  }
}

// Amazon's offers for the game being priced, loaded for every game. Modern systems (tier.amazon) take
// Amazon's lowest offer outright; older systems go partway toward it, and treat "no offers" as scarcity
// (see FLOOR_AMAZON_PULL). Retro Amazon listings are third-party asking prices, often well above what
// copies actually sell for, hence only partway.
async function loadFloorAmazon() {
  const cur = floorCur;
  if (!cur || !amazonSet) return;
  const upc = firstUpc(cur.product.upc);
  const cond = amazonCond(cur.condition);
  if (!floorAmazonCache.has(`${upc}|${cond}`)) { cur.amazon = { loading: true }; renderFloorPricer(); }
  try {
    const d = await fetchFloorAmazon(upc, cond);
    if (floorCur === cur && amazonCond(cur.condition) === cond) cur.amazon = d;
  } catch (err) {
    if (floorCur === cur) cur.amazon = { error: err.message };
  }
  if (floorCur === cur) renderFloorPricer();
}

// Amazon's offers for a barcode in a condition ('used' / 'new'), cached for this page.
const firstUpc = (upc) => String(upc || '').split(/[,\s]+/)[0];
async function fetchFloorAmazon(upc, cond) {
  if (!/^\d{8,14}$/.test(upc)) throw new Error('No barcode for this game on PriceCharting, so Amazon can’t be matched.');
  const key = `${upc}|${cond}`;
  if (!floorAmazonCache.has(key)) floorAmazonCache.set(key, await api('amazon/offers', { params: { upc, cond } }));
  return floorAmazonCache.get(key);
}

// A game's recent sales ({ loose, cib, new }), cached for this page.
async function fetchFloorSales(id) {
  if (floorSalesCache.has(id)) return floorSalesCache.get(id);
  const d = await api('pc/sales', { params: { id } });
  const sales = d?.sales || {};
  if (!['loose', 'cib', 'new'].some((c) => sales[c]?.length)) throw new Error('PriceCharting shows no recent sales for this game.');
  floorSalesCache.set(id, sales);
  return sales;
}

async function loadFloorSales(product) {
  const id = String(product.id);
  if (!/^\d+$/.test(id)) { // demo products have no PriceCharting page
    floorCur.salesError = 'Demo mode: no recent sales until a PriceCharting token is added.';
    renderFloorPricer();
    return;
  }
  try {
    const sales = await fetchFloorSales(id);
    if (floorCur?.product === product) floorCur.sales = sales;
  } catch (err) {
    if (floorCur?.product === product) floorCur.salesError = err.message;
  }
  if (floorCur?.product === product) renderFloorPricer();
}

// The condition's sales, highest first, each with its index into that list.
function floorSales(cur = floorCur) {
  return (cur.sales?.[cur.condition] || []).map((s, i) => ({ ...s, i, odd: floorOdd(s, cur.condition) }))
    .sort((a, b) => b.price - a.price);
}

// The sale the tool goes by (see FLOOR_PCT and FLOOR_HIGH; the highest when copies are scarce). sales are
// highest first; odd listings never count.
function floorAutoSale(sales, scarce = false) {
  const normal = sales.filter((s) => !s.odd);
  if (!normal.length) return { sale: null, count: 0 };
  if (scarce) return { sale: normal[0], count: normal.length, high: true };
  const asc = [...normal].reverse();
  const p90 = asc[Math.min(asc.length - 1, Math.round(FLOOR_PCT * (asc.length - 1)))];
  const sale = p90.price >= FLOOR_HIGH && normal.length > 1 ? normal[1] : p90;
  return { sale, count: normal.length, high: sale !== p90 };
}

// What sets the price: { basis (cents) | null, from: 'sale'|'gamestop'|'amazon'|'amazonMid'|'typed', sale, checks,
// need, pull, scarce }. checks = reasons staff should glance at it; need = what to do when there's nothing to go by.
// pull = { base, baseFrom, amazon, capped } when an older system's price was nudged toward Amazon.
function floorBasis(cur = floorCur) {
  const tier = floorTier(cur.product['console-name']);
  const sales = floorSales(cur);
  const amzInfo = cur.amazon?.found ? cur.amazon : null;
  // Amazon matched the game but has no offers in this condition: scarce (older systems, automatic price only).
  const scarce = !tier.amazon && cur.pick == null && !!amzInfo && !(amzInfo.offers || []).length;
  const auto = floorAutoSale(sales, scarce);
  const sale = cur.pick != null ? sales.find((s) => s.i === cur.pick) : auto.sale;
  const gs = floorGs(cur.product); // a minimum on every system; GameStop is never cheaper
  const checks = [];
  if (cur.pick == null) {
    if (cur.sales && auto.count && auto.count < FLOOR_FEW_SALES) checks.push(`Only ${auto.count} recent sale${auto.count === 1 ? '' : 's'} to go by`);
    const newest = sales.reduce((d, s) => (s.date > d ? s.date : d), '');
    const cutoff = new Date(Date.now() - FLOOR_STALE_DAYS * 864e5).toISOString().slice(0, 10);
    if (newest && newest < cutoff) checks.push(`Newest sale is from ${newest}`);
  }
  if (cur.typed != null) return { basis: cur.typed, from: 'typed', sale, checks: [] };
  const amz = amzInfo && amzInfo.lowest > 0 ? amzInfo.lowest : null;
  // Older systems compare with Amazon's typical offer: the (lower) middle of the offers, which come lowest first.
  const amzOffers = (amzInfo?.offers || []).filter((o) => o.price > 0);
  const amzMidIndex = amzOffers.length ? Math.floor((amzOffers.length - 1) / 2) : -1;
  const amzTypical = amzMidIndex >= 0 ? amzOffers[amzMidIndex].price : null;
  const waiting = amazonSet && cur.amazon?.loading; // don't let staff add it before Amazon answers
  const options = [[sale?.price, 'sale'], [gs, 'gamestop'], [tier.amazon ? amz : null, 'amazon']].filter(([v]) => v > 0);
  if (options.length) {
    const [basis, from] = options.reduce((a, b) => (b[0] > a[0] ? b : a));
    // Older systems: halfway toward a higher Amazon price, at most FLOOR_AMAZON_PULL above (automatic price only).
    if (!tier.amazon && cur.pick == null && amzTypical > basis) {
      const half = Math.round((basis + amzTypical) / 2);
      const cap = Math.round(basis * (1 + FLOOR_AMAZON_PULL));
      const pull = { base: basis, baseFrom: from, amazon: amzTypical, index: amzMidIndex, capped: cap < half };
      return { basis: Math.min(half, cap), from: 'amazonMid', sale, checks, waiting, pull };
    }
    // Scarce copies: the highest sale plus FLOOR_SCARCE_MARKUP.
    if (scarce && from === 'sale') return { basis: Math.round(basis * (1 + FLOOR_SCARCE_MARKUP)), from, sale, checks, waiting, scarce: { base: basis } };
    return { basis, from, sale, checks, waiting };
  }
  if (!cur.sales && !cur.salesError) return { basis: null, sale, checks: [] }; // still loading
  return { basis: null, sale, checks: [], need: 'No sales to go by. Check the links and type a price.' };
}

// Consoles, controllers and other hardware can be floor priced too, but the game rules (the $5 shitbox
// floor, the missing-manual deduction) don't apply to them.
const floorIsHardware = (p) => !isGameCat(guessCategory(p['product-name'] || '')) || /^(systems?|consoles?|accessor)/i.test(p.genre || '');

// The shelf price for a game being priced (or re-checked): { b: floorBasis, r: floorPrice, shitbox, premium, hw }.
function floorResult(cur) {
  const p = cur.product;
  const hw = floorIsHardware(p);
  const shitbox = hw ? null : autoShitboxReason({ name: p['product-name'], genre: p.genre });
  const b = floorBasis(cur);
  const typed = b.from === 'typed';
  const premium = typed ? null : floorPremium(p['product-name'], p['console-name']);
  const r = floorPrice(b.basis, { shitbox: !!shitbox, manualMissing: !hw && cur.condition === 'cib' && cur.manualMissing, gs: typed ? null : floorGs(p), premium });
  return { b, r, shitbox, premium, hw };
}

function renderFloorPricer() {
  const el = $('#floorPricer');
  el.hidden = !floorCur;
  if (!floorCur) { el.innerHTML = ''; return; }
  const cur = floorCur;
  const p = cur.product;
  const tier = floorTier(p['console-name']);
  const links = floorLinks(p, cur.condition);
  const { b, r: result, shitbox, premium, hw } = floorResult(cur);
  const belowGs = b.from === 'typed' && result && floorGs(p) && result.price < floorGs(p);
  const pcPrices = Object.entries(GAME_CONDITIONS).map(([c, label]) => `${label} ${money(Number(p[PC_FIELDS.market[c]]) || null)}`).join(' · ');
  const gs = Number(p['gamestop-price']) > 0 ? ` · GameStop pre-owned ${money(Number(p['gamestop-price']))}` : '';

  const condBtns = Object.entries(GAME_CONDITIONS).map(([c, label]) => `<button type="button" class="seg${c === cur.condition ? ' on' : ''}" data-floor-cond="${c}">${label}</button>`).join('');
  const sales = floorSales(cur);
  let salesHtml;
  if (!cur.sales && !cur.salesError) salesHtml = '<p class="muted"><span class="spinner"></span>Reading recent sales from PriceCharting…</p>';
  else if (cur.salesError) salesHtml = `<p class="muted">${esc(cur.salesError)}${links.pc ? ` <a href="${esc(links.pc)}" target="_blank" rel="noopener noreferrer">Open the PriceCharting page</a> to see its sales.` : ''}</p>`;
  else if (!sales.length) salesHtml = `<p class="muted">No recent ${esc(GAME_CONDITIONS[cur.condition])} sales on PriceCharting.</p>`;
  else {
    const shown = cur.showAll ? sales : sales.slice(0, 8);
    salesHtml = `<table class="floor-sales"><tbody>${shown.map((s) => `<tr data-sale="${s.i}" class="${(b.from === 'sale' || b.pull?.baseFrom === 'sale') && b.sale && s.i === b.sale.i ? 'picked' : ''}${s.odd ? ' odd' : ''}">
        <td class="num">${money(s.price)}</td>
        <td>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || 'Sale')}</a>` : esc(s.title || 'Sale')}${s.odd ? ' <span class="badge info">odd listing</span>' : ''}</td>
        <td class="muted nowrap">${esc(s.date)}</td></tr>`).join('')}</tbody></table>
      ${sales.length > shown.length ? `<button type="button" class="link" data-floor-act="all">Show all ${sales.length} sales</button>` : ''}
      <p class="muted small-print">The price goes by the highlighted sale: the high end of normal sales (90th percentile; the second-highest sale for games selling around $80 and up), so one lucky sale doesn't set it. Click any sale to use it instead. Lots, sealed copies, and other odd listings never count.</p>`;
  }

  const showTyped = !!b.need || cur.typed != null;
  el.innerHTML = `
    <div class="floor-head">
      <div>
        <div class="item-name">${pcLink(p.id, p['product-name'])}</div>
        <div class="sub">${esc(p['console-name'])} · PriceCharting ${pcPrices}${gs}</div>
        <div class="floor-rule">${esc(tier.rule)}</div>
        ${shitbox ? `<span class="badge guide">${esc(shitbox)}: can go on the shelf at $5</span>` : ''}
        ${hw ? '<span class="badge info">Hardware: priced from sales, no game rules</span>' : ''}
        ${premium ? `<span class="badge guide">${esc(premiumText(premium))}</span>` : ''}
      </div>
      <button type="button" class="icon-btn" data-floor-act="close" title="Close" aria-label="Close">×</button>
    </div>
    <div class="floor-controls">
      <div class="segs" role="group" aria-label="Condition">${condBtns}</div>
      ${cur.condition === 'cib' && !hw ? `<label class="check"><input type="checkbox" data-floor-field="manual"${cur.manualMissing ? ' checked' : ''}> Manual missing</label>` : ''}
      <span class="floor-links">
        <a href="${esc(links.ebay)}" target="_blank" rel="noopener noreferrer">eBay sold ↗</a>
        ${tier.id !== 'retro' ? `<a href="${esc(links.gamestop)}" target="_blank" rel="noopener noreferrer">GameStop ↗</a>
        <a href="${esc(cur.amazon?.url || links.amazon)}" target="_blank" rel="noopener noreferrer">Amazon ↗</a>` : ''}
        ${links.pc ? `<a href="${esc(links.pc)}" target="_blank" rel="noopener noreferrer">PriceCharting ↗</a>` : ''}
      </span>
    </div>
    <div class="floor-body">
      <div class="floor-sales-wrap">
        <div class="eyebrow">Recent ${esc(GAME_CONDITIONS[cur.condition])} eBay sales (from PriceCharting)</div>
        ${salesHtml}
        ${floorAmazonHtml(cur, tier, b)}
      </div>
      <div class="floor-result">
        ${b.need ? `<p class="floor-need">${esc(b.need)}</p>` : ''}
        ${b.checks.map((c) => `<p class="floor-need">Double-check: ${esc(c)}</p>`).join('')}
        ${result && result.price >= FLOOR_REVIEW ? `<p class="floor-need">Double-check: $${FLOOR_REVIEW / 100} or more. Look over the sales and links before it goes on the shelf.</p>` : ''}
        ${b.scarce ? `<p class="muted small-print">No ${amazonCond(cur.condition)} copies on Amazon right now, so this goes by the highest normal sale plus ${Math.round(FLOOR_SCARCE_MARKUP * 100)}%.</p>` : ''}
        ${belowGs ? `<p class="floor-need">Below GameStop's pre-owned price (${money(floorGs(p))}). Our price shouldn't be under GameStop's.</p>` : ''}
        <label${showTyped ? '' : ' hidden'}>Your price
          <span class="money-input"><span>$</span><input type="text" inputmode="decimal" autocomplete="off" data-floor-field="typed" value="${esc(plain(cur.typed))}" placeholder="0.00"></span>
        </label>
        ${!showTyped ? '<button type="button" class="link" data-floor-act="type">Type a different price</button>' : '<button type="button" class="link" data-floor-act="auto">Back to the automatic price</button>'}
        ${result ? `<div class="floor-math muted">${esc(floorMath(b, result))}</div>` : ''}
        <div class="floor-price"><span class="eyebrow">Shelf price</span><strong>${result ? money(result.price) : '—'}</strong></div>
        ${b.waiting ? '<p class="muted small-print"><span class="spinner"></span>Checking Amazon…</p>' : ''}
        <button type="button" class="btn primary" data-floor-act="add"${result && !b.waiting ? '' : ' disabled'}>Add to list</button>
      </div>
    </div>`;
}

// Amazon's offers for the game: shown for modern systems automatically, elsewhere on request.
function floorAmazonHtml(cur, tier, b) {
  if (!amazonSet) return '';
  const a = cur.amazon;
  const label = `Amazon ${amazonCond(cur.condition) === 'new' ? 'new' : 'used'} offers`;
  if (!a) return `<button type="button" class="link floor-amz-check" data-floor-act="amazon">Check Amazon ${amazonCond(cur.condition) === 'new' ? 'new' : 'used'} offers</button>`;
  if (a.loading) return `<div class="eyebrow floor-amz-head">${label}</div><p class="muted"><span class="spinner"></span>Checking Amazon…</p>`;
  if (a.error) return `<div class="eyebrow floor-amz-head">${label}</div><p class="muted">${esc(a.error)}</p>`;
  if (!a.found) return `<div class="eyebrow floor-amz-head">${label}</div><p class="muted">This game isn't on Amazon (no match for its barcode).</p>`;
  const offers = a.offers || [];
  const usedAt = b.from === 'amazon' ? 0 : b.from === 'amazonMid' ? b.pull.index : -1; // the offer the price went by
  const head = `<div class="eyebrow floor-amz-head">${label} · <a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.title || 'Amazon page')} ↗</a></div>`;
  if (!offers.length) return `${head}<p class="muted">No ${a.condition === 'New' ? 'new' : 'used'} offers on Amazon right now.</p>`;
  const more = a.count > offers.length ? `<p class="muted small-print">Showing Amazon's ${offers.length} lowest of ${a.count} offers.</p>` : '';
  return `${head}<table class="floor-sales"><tbody>${offers.map((o, i) => `<tr class="${i === usedAt ? 'picked' : ''}">
      <td class="num">${money(o.price)}</td><td>${esc(AMZ_SUB[o.sub] || o.sub || '')}${o.fba ? ' <span class="badge info">Prime</span>' : ''}</td><td class="muted nowrap">${i === 0 ? 'lowest' : !tier.amazon && i === Math.floor((offers.length - 1) / 2) ? 'typical' : ''}</td></tr>`).join('')}</tbody></table>
    <p class="muted small-print">Prices include shipping.${tier.amazon ? '' : ` Older games go halfway toward Amazon's typical offer (the middle of this list) when it's higher, at most ${Math.round(FLOOR_AMAZON_PULL * 100)}% more.`}${amazonSandbox ? ' Sandbox keys: sample data, not real prices.' : ''}</p>${more}`;
}

function floorMath(b, r) {
  const parts = b.pull
    ? [`${FROM_LABELS[b.pull.baseFrom] || ''} ${money(b.pull.base)}`,
      `${b.pull.capped ? `toward Amazon's typical ${money(b.pull.amazon)}, capped at +${Math.round(FLOOR_AMAZON_PULL * 100)}%` : `halfway to Amazon's typical ${money(b.pull.amazon)}`}: ${money(b.basis)}`]
    : b.scarce
      ? [`${FROM_LABELS[b.from] || ''} ${money(b.scarce.base)}`, `+${Math.round(FLOOR_SCARCE_MARKUP * 100)}% (scarce): ${money(b.basis)}`]
      : [`${FROM_LABELS[b.from] || ''} ${money(b.basis)}`];
  if (r.premium) parts.push(`${premiumText(r.premium)}: ${money(r.premiumBasis)}`);
  if (r.full !== r.premiumBasis) parts.push(r.full === r.min && r.premiumBasis < r.min ? `minimum ${money(r.min)}` : `rounded up ${money(r.full)}`);
  if (r.ded) parts.push(`manual missing −${money(r.ded)}`);
  if (r.gsRaised) parts.push(`raised to GameStop's ${money(r.gsRaised)}`);
  return parts.join(' → ');
}

// Where a list item's price came from (kept on the item; shown in the "Based on" column).
const floorBasisInfo = (b) => ({
  basis: b.scarce ? b.scarce.base : b.basis, from: b.from,
  saleDate: b.from === 'sale' || b.pull?.baseFrom === 'sale' ? b.sale?.date || '' : '',
});

function addFloorItem() {
  const cur = floorCur;
  const p = cur.product;
  const { b, r, hw } = floorResult(cur);
  if (!r) return;
  const manualMissing = !hw && cur.condition === 'cib' && !!cur.manualMissing;
  const same = floor.items.find((x) => x.pcId === String(p.id) && x.condition === cur.condition && !!x.manualMissing === manualMissing);
  if (same && !confirm(`${p['product-name']} (${GAME_CONDITIONS[cur.condition]}${manualMissing ? ', no manual' : ''}) is already on this list at ${money(same.price)}. Add it again?`)) return;
  floor.items.unshift({
    id: uid(), pcId: String(p.id), name: p['product-name'], platform: p['console-name'] || '', condition: cur.condition,
    manualMissing, ...floorBasisInfo(b), price: r.price, edited: false,
  });
  floor.dirty = true;
  saveFloorLocal();
  floorCur = null;
  renderFloorPricer();
  renderFloorList();
  $('#floorScan').focus();
}

function onFloorPricerClick(e) {
  if (!floorCur) return;
  const cond = e.target.closest('[data-floor-cond]')?.dataset.floorCond;
  if (cond) {
    const amazonChanged = amazonCond(cond) !== amazonCond(floorCur.condition);
    Object.assign(floorCur, { condition: cond, pick: null, typed: null, showAll: false });
    if (cond !== 'cib') floorCur.manualMissing = false;
    if (amazonChanged && floorCur.amazon) { floorCur.amazon = null; loadFloorAmazon(); }
    renderFloorPricer();
    return;
  }
  const act = e.target.closest('[data-floor-act]')?.dataset.floorAct;
  if (act === 'close') { floorCur = null; renderFloorPricer(); $('#floorScan').focus(); return; }
  if (act === 'add') { addFloorItem(); return; }
  if (act === 'all') { floorCur.showAll = true; renderFloorPricer(); return; }
  if (act === 'auto') { floorCur.typed = null; renderFloorPricer(); return; }
  if (act === 'amazon') { loadFloorAmazon(); return; }
  if (act === 'type') {
    floorCur.typed = floorBasis().basis;
    renderFloorPricer();
    $('#floorPricer [data-floor-field="typed"]')?.select();
    return;
  }
  const row = e.target.closest('tr[data-sale]');
  if (row && !e.target.closest('a')) {
    floorCur.pick = Number(row.dataset.sale);
    floorCur.typed = null;
    renderFloorPricer();
  }
}

function onFloorPricerChange(e) {
  if (!floorCur) return;
  const field = e.target.dataset.floorField;
  if (field === 'manual') floorCur.manualMissing = e.target.checked;
  if (field === 'typed') {
    const cents = parseMoney(e.target.value);
    if (Number.isNaN(cents)) { toast('Enter a price like 24.99', 'error'); return; }
    floorCur.typed = cents;
  }
  renderFloorPricer();
}

/* ---------------------------------------------------------------- the list */

const FROM_LABELS = { sale: 'eBay sale', gamestop: 'GameStop', amazon: 'Amazon', amazonMid: 'Toward Amazon', ebay: 'eBay', typed: 'Typed' };

// A re-check's suggestion that differs from the list price (it.recheck = { price, basis, from, saleDate, at } or { error }).
const recheckChanged = (it) => it.recheck?.price != null && it.recheck.price !== it.price;

function recheckHtml(it) {
  const rc = it.recheck;
  if (!rc) return '';
  if (rc.error) return `<div class="sub warn-text" title="${esc(rc.error)}">Couldn't re-check</div>`;
  if (!recheckChanged(it)) return '<div class="sub">✓ Still this price</div>';
  const up = rc.price > it.price;
  return `<div class="sub recheck ${up ? 'up' : 'down'}">Now ${money(rc.price)} ${up ? '▲' : '▼'}
    <button type="button" class="link" data-floor-use>Use</button><button type="button" class="link" data-floor-keep>Keep</button></div>`;
}

function renderFloorList() {
  const items = floor.items;
  $('#floorBody').innerHTML = items.map((it) => `<tr data-id="${esc(it.id)}">
      <td class="item"><div class="item-name">${pcLink(it.pcId, it.name)}</div></td>
      <td>${esc(it.platform)}</td>
      <td>${esc(GAME_CONDITIONS[it.condition] || it.condition)}${it.manualMissing ? '<div class="sub">Manual missing</div>' : ''}</td>
      <td class="muted">${it.basis != null ? `${esc(FROM_LABELS[it.from] || '')} ${money(it.basis)}` : '—'}${it.saleDate ? `<div class="sub">${esc(it.saleDate)}</div>` : ''}</td>
      <td class="num"><span class="money-input"><span>$</span><input type="text" inputmode="decimal" autocomplete="off" data-floor-price value="${esc(plain(it.price))}"${it.edited ? ' class="overridden" title="Edited by hand"' : ''} aria-label="Shelf price"></span>${recheckHtml(it)}</td>
      <td><button type="button" class="icon-btn" data-floor-remove title="Remove" aria-label="Remove">×</button></td>
    </tr>`).join('');
  $('#floorEmpty').hidden = items.length > 0;
  const total = items.reduce((sum, it) => sum + (it.price || 0), 0);
  $('#floorCount').textContent = items.length ? `${items.length} game${items.length === 1 ? '' : 's'} · ${money(total)} on the shelf` : '';
  const changes = items.filter((it) => recheckChanged(it) && !it.edited).length;
  $('#floorUseAll').hidden = !changes || floorRecheck.running;
  $('#floorUseAll').textContent = `Use ${changes} new price${changes === 1 ? '' : 's'}`;
  $('#floorRecheck').textContent = floorRecheck.running ? `Stop (${floorRecheck.done} of ${floorRecheck.total})` : 'Re-check prices';
  $('#floorRecheck').disabled = !items.length;
  renderFloorStatus();
}

/* ---------------------------------------------------------------- re-checking a saved list */

// Prices go stale: re-run every game on the list through today's sales, GameStop and Amazon, one at a time
// (the server keeps PriceCharting and Amazon to their rate limits). Changes are suggestions until staff
// press Use (or "Use N new prices", which skips prices edited by hand).
const floorRecheck = { running: false, stop: false, done: 0, total: 0 };
let floorEpoch = 0;

async function recheckFloorPrices() {
  if (floorRecheck.running) { floorRecheck.stop = true; return; }
  const items = floor.items.filter((it) => /^\d+$/.test(it.pcId || ''));
  if (!items.length) { toast('Nothing on the list can be re-checked.'); return; }
  Object.assign(floorRecheck, { running: true, stop: false, done: 0, total: items.length });
  renderFloorList();
  const epoch = floorEpoch; // opening or starting another session bumps it
  for (const it of items) {
    if (floorRecheck.stop || floorEpoch !== epoch) break;
    try {
      const product = await PC.byId(it.pcId);
      const sales = await fetchFloorSales(it.pcId);
      let amazon = null;
      if (amazonSet) amazon = await fetchFloorAmazon(firstUpc(product.upc), amazonCond(it.condition)).catch((err) => ({ error: err.message }));
      const { b, r } = floorResult({ product, condition: it.condition, manualMissing: it.manualMissing, sales, pick: null, typed: null, amazon });
      it.recheck = r ? { price: r.price, ...floorBasisInfo(b), at: new Date().toISOString() } : { error: 'no sales to go by' };
    } catch (err) {
      it.recheck = { error: err.message };
    }
    if (floorEpoch !== epoch) break;
    floorRecheck.done += 1;
    floor.dirty = true;
    saveFloorLocal();
    renderFloorList();
  }
  const stopped = floorRecheck.stop || floorEpoch !== epoch;
  Object.assign(floorRecheck, { running: false, stop: false });
  renderFloorList();
  const changed = floor.items.filter(recheckChanged).length;
  toast(`${stopped ? 'Stopped after' : 'Re-checked'} ${floorRecheck.done} game${floorRecheck.done === 1 ? '' : 's'}: ${changed ? `${changed} price${changed === 1 ? '' : 's'} changed` : 'no price changes'}.`);
}

function useRecheck(it) {
  if (!recheckChanged(it)) return;
  const { price, basis, from, saleDate } = it.recheck;
  Object.assign(it, { price, basis, from, saleDate, edited: false });
  delete it.recheck;
}

function useAllRechecks() {
  const todo = floor.items.filter((it) => recheckChanged(it) && !it.edited);
  todo.forEach(useRecheck);
  const skipped = floor.items.filter(recheckChanged).length;
  floor.dirty = true;
  saveFloorLocal();
  renderFloorList();
  toast(`Updated ${todo.length} price${todo.length === 1 ? '' : 's'}.${skipped ? ` ${skipped} edited by hand ${skipped === 1 ? 'was' : 'were'} left for you to decide.` : ''}`);
}

/* ---------------------------------------------------------------- shelf labels */

// Price labels on Avery 5160-size sheets (30 per letter page, 2⅝" × 1"), in list order.
function printFloorLabels() {
  if (!floor.items.length) { toast('Nothing to print yet.'); return; }
  const labels = floor.items.map((it) => `<div class="label">
      <div class="label-name">${esc(it.name)}</div>
      <div class="label-sub">${esc([it.platform, `${GAME_CONDITIONS[it.condition] || it.condition}${it.manualMissing ? ', no manual' : ''}`].filter(Boolean).join(' · '))}</div>
      <div class="label-price">${money(it.price)}</div>
    </div>`);
  const pages = [];
  for (let i = 0; i < labels.length; i += 30) pages.push(`<div class="label-page">${labels.slice(i, i + 30).join('')}</div>`);
  $('#printArea').innerHTML = pages.join('');
  window.print();
}

function renderFloorStatus(msg) {
  const el = $('#floorStatus');
  if (msg) { el.textContent = msg; return; }
  if (floor.dirty) el.textContent = floor.id ? 'Unsaved changes' : (floor.items.length ? 'Not saved yet' : '');
  else el.textContent = floor.savedAt ? `Saved ${fmtTime(floor.savedAt)}` : '';
  $('#floorDelete').hidden = !floor.id;
}

function onFloorListChange(e) {
  const tr = e.target.closest('tr[data-id]');
  const it = tr && floor.items.find((x) => x.id === tr.dataset.id);
  if (!it || !e.target.matches('[data-floor-price]')) return;
  const cents = parseMoney(e.target.value);
  if (Number.isNaN(cents) || cents == null) { toast('Enter a price like 20', 'error'); e.target.value = plain(it.price); return; }
  if (cents !== it.price) Object.assign(it, { price: cents, edited: true });
  floor.dirty = true;
  saveFloorLocal();
  renderFloorList();
}

function onFloorListClick(e) {
  const tr = e.target.closest('tr[data-id]');
  const it = tr && floor.items.find((x) => x.id === tr.dataset.id);
  if (it && (e.target.closest('[data-floor-use]') || e.target.closest('[data-floor-keep]'))) {
    if (e.target.closest('[data-floor-use]')) useRecheck(it);
    else delete it.recheck;
    floor.dirty = true;
    saveFloorLocal();
    renderFloorList();
    return;
  }
  if (!e.target.closest('[data-floor-remove]')) return;
  const id = tr.dataset.id;
  floor.items = floor.items.filter((x) => x.id !== id);
  floor.dirty = true;
  saveFloorLocal();
  renderFloorList();
}

function floorListText() {
  const rows = floor.items.map((it) => [it.name, it.platform, `${GAME_CONDITIONS[it.condition] || it.condition}${it.manualMissing ? ' (no manual)' : ''}`, plain(it.price)]);
  return [['Game', 'System', 'Condition', 'Price'], ...rows].map((r) => r.join('\t')).join('\n');
}

async function copyFloorList() {
  if (!floor.items.length) { toast('Nothing to copy yet.'); return; }
  try {
    await navigator.clipboard.writeText(floorListText());
    toast('Copied. Paste it into a spreadsheet.');
  } catch {
    toast("Couldn't copy here. Use Print list instead.", 'error');
  }
}

function printFloorList() {
  if (!floor.items.length) { toast('Nothing to print yet.'); return; }
  const rows = floor.items.map((it) => `<tr><td>${esc(it.name)}${it.manualMissing ? '<div class="sub">Manual missing</div>' : ''}</td><td>${esc(it.platform)}</td>
    <td>${esc(GAME_CONDITIONS[it.condition] || it.condition)}</td><td class="num">${money(it.price)}</td></tr>`).join('');
  const meta = ['Floor pricing', floor.name, floor.staff, fmtTime(new Date().toISOString())].filter(Boolean);
  $('#printArea').innerHTML = `<h1>${esc(settings.shopName)}</h1><p class="print-meta">${meta.map(esc).join(' · ')}</p>
    <table><thead><tr><th>Game</th><th>System</th><th>Condition</th><th class="num">Price</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td colspan="3">${floor.items.length} games</td><td class="num">${money(floor.items.reduce((s, it) => s + it.price, 0))}</td></tr></tfoot></table>`;
  window.print();
}

/* ---------------------------------------------------------------- saved sessions */

async function loadFloorSessions() {
  const sel = $('#floorOpen');
  try {
    const list = (await api('floor-sessions')) || [];
    sel.innerHTML = `<option value="">${list.length ? 'Open a saved session…' : 'No saved sessions yet'}</option>${list.map((s) => `<option value="${esc(s.id)}"${s.id === floor.id ? ' selected' : ''}>${esc(s.name)} · ${s.count} game${s.count === 1 ? '' : 's'} · ${esc(fmtTime(s.updated))}${s.staff ? ` · ${esc(s.staff)}` : ''}</option>`).join('')}`;
    sel.disabled = false;
  } catch (err) {
    sel.innerHTML = '<option value="">Saved sessions unavailable</option>';
    sel.disabled = true;
    sel.title = err.message;
  }
}

async function saveFloorSession() {
  floor.name = $('#floorName').value.trim();
  floor.staff = $('#floorStaff').value.trim();
  if (!floor.name) { toast('Name the session first.', 'error'); $('#floorName').focus(); return; }
  if (!floor.items.length) { toast('Price some games first.'); return; }
  renderFloorStatus('Saving…');
  try {
    // baseUpdated: the server refuses (409) if someone else saved this session since we opened or saved it.
    const r = await api('floor-sessions', { method: 'PUT', body: { id: floor.id, baseUpdated: floor.savedAt, name: floor.name, staff: floor.staff, items: floor.items } });
    Object.assign(floor, { id: r.id, savedAt: r.updated, dirty: false });
    saveFloorLocal();
    renderFloorStatus();
    toast('Session saved.');
    loadFloorSessions();
  } catch (err) {
    renderFloorStatus();
    if (err.status === 409 && err.data?.conflict) { floorSaveConflict(err.data.conflict); return; }
    toast(`Couldn't save: ${err.message}`, 'error');
  }
}

// Someone else saved this session after we opened it. Never overwrite their games: save ours as a copy.
function floorSaveConflict(c) {
  const who = c.staff ? `${c.staff} saved` : 'Someone saved';
  if (!confirm(`${who} “${floor.name}” at ${fmtTime(c.updated)}, after you opened it.\n\nOK: save your list as a separate copy, so both are kept.\nCancel: don't save (open the session again to see their version).`)) return;
  Object.assign(floor, { id: null, savedAt: null, name: `${floor.name} (copy)` });
  $('#floorName').value = floor.name;
  saveFloorSession();
}

function floorUnsavedOk() {
  const ok = !floor.dirty || !floor.items.length || confirm('This list has unsaved changes. Continue without saving them?');
  if (ok) floorEpoch += 1; // a re-check in progress belongs to the list being closed
  return ok;
}

async function openFloorSession(id) {
  if (!id) return;
  if (!floorUnsavedOk()) { $('#floorOpen').value = floor.id || ''; return; }
  try {
    const s = await api('floor-sessions', { params: { id } });
    Object.assign(floor, { id: s.id, name: s.name, staff: s.staff || '', items: s.items || [], dirty: false, savedAt: s.updated });
    saveFloorLocal();
    floorCur = null;
    showFloor();
  } catch (err) {
    toast(err.message, 'error');
    loadFloorSessions();
  }
}

function newFloorSession() {
  if (!floorUnsavedOk()) return;
  Object.assign(floor, { id: null, name: '', staff: '', items: [], dirty: false, savedAt: null });
  saveFloorLocal();
  floorCur = null;
  showFloor();
  $('#floorName').focus();
}

async function deleteFloorSession() {
  if (!floor.id || !confirm(`Delete the saved session "${floor.name}"? This can't be undone.`)) return;
  try {
    await api('floor-sessions', { method: 'DELETE', body: {}, params: { id: floor.id } });
    Object.assign(floor, { id: null, dirty: floor.items.length > 0, savedAt: null });
    saveFloorLocal();
    toast('Session deleted. The list is still here until you start a new one.');
    renderFloorStatus();
    loadFloorSessions();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function wireFloor() {
  const scan = $('#floorScan');
  const go = () => {
    const q = scan.value.trim();
    if (!q) return;
    if (/^\d{8,14}$/.test(q)) { scan.value = ''; floorScanUpc(q); return; }
    // Enter again on the same search picks the top result (handy right after a search).
    if (floorSearch.results?.length && floorSearch.q === q) { pickFloorGame(floorSearch.results[0]); return; }
    runFloorSearch(q);
  };
  scan.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); go(); }
    if (e.key === 'Escape') { scan.value = ''; closeFloorResults(); }
  });
  scan.addEventListener('input', () => { if (floorSearch.results || floorSearch.error) closeFloorResults(); });
  $('#floorSearchBtn').addEventListener('click', () => { go(); scan.focus(); });
  $('#floorResults').addEventListener('click', (e) => {
    const r = e.target.closest('.result');
    if (r) pickFloorGame(floorSearch.results[Number(r.dataset.i)]);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.floor-scan') && !$('#floorResults').hidden) closeFloorResults(); });

  const pricer = $('#floorPricer');
  pricer.addEventListener('click', onFloorPricerClick);
  pricer.addEventListener('change', onFloorPricerChange);
  pricer.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-floor-field="typed"]')) {
      e.preventDefault();
      e.target.dispatchEvent(new Event('change', { bubbles: true }));
      if (floorBasis().basis != null) addFloorItem();
    }
  });

  $('#floorBody').addEventListener('change', onFloorListChange);
  $('#floorBody').addEventListener('click', onFloorListClick);
  $('#floorBody').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input')) e.target.blur(); });
  $('#floorName').addEventListener('input', (e) => { floor.name = e.target.value; floor.dirty = true; saveFloorLocal(); renderFloorStatus(); });
  $('#floorStaff').addEventListener('input', (e) => { floor.staff = e.target.value; saveFloorLocal(); });
  $('#floorSave').addEventListener('click', saveFloorSession);
  $('#floorNew').addEventListener('click', newFloorSession);
  $('#floorDelete').addEventListener('click', deleteFloorSession);
  $('#floorOpen').addEventListener('change', (e) => openFloorSession(e.target.value));
  $('#floorCopy').addEventListener('click', copyFloorList);
  $('#floorPrint').addEventListener('click', printFloorList);
  $('#floorLabels').addEventListener('click', printFloorLabels);
  $('#floorRecheck').addEventListener('click', recheckFloorPrices);
  $('#floorUseAll').addEventListener('click', useAllRechecks);
}

const VIEWS = ['trade', 'bulk', 'floor', 'log', 'hardware', 'settings'];

function showView(name) {
  currentView = name;
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== name;
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  $('#totalsBar').hidden = name !== 'trade';
  if (name === 'log') loadLog();
  if (name === 'hardware') renderHardware();
  if (name === 'settings') {
    if (settingsDirty) { renderTokenStatus(); renderAmazonStatus(); } else fillSettingsForm(); // keep unsaved edits
  }
  if (name === 'bulk') showBulk();
  if (name === 'floor') showFloor();
  if (name === 'trade') { renderLines(); focusScan(); }
}

function wireEvents() {
  wireFloor();
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
  // The condition menu that opens the PriceCharting picker must not close it again.
  document.addEventListener('click', (e) => { if (!e.target.closest('.scan, [data-field="condition"]') && !$('#results').hidden) closeResults(); });

  const body = $('#lineBody');
  body.addEventListener('change', onLineChange);
  body.addEventListener('click', onLineClick);
  body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input')) { e.target.blur(); focusScan(); }
  });

  $('#customerName').value = trade.customer || '';
  $('#customerName').addEventListener('input', (e) => { trade.customer = e.target.value; saveTrade(); });

  $('#printBtn').addEventListener('click', printQuote);
  $('#holdBtn').addEventListener('click', holdTrade);
  $('#heldSelect').addEventListener('change', (e) => { const id = e.target.value; e.target.value = ''; resumeHeld(id); });
  renderHeld();
  $('#clearBtn').addEventListener('click', () => {
    if (trade.lines.length && !confirm('Clear this trade and start a new one?')) return;
    resetTrade();
  });

  // TCG bulk tab
  const bulkBox = $('#bulkGroups');
  bulkBox.addEventListener('input', onBulkInput);
  bulkBox.addEventListener('click', (e) => { if (e.target.closest('[data-bulk-retry]')) loadBulkRates(); });
  bulkBox.addEventListener('keydown', (e) => { // Enter moves to the next count, then to "Add to trade"
    if (e.key !== 'Enter' || !e.target.dataset.bulk) return;
    e.preventDefault();
    const all = $$('.bulk-count');
    (all[all.indexOf(e.target) + 1] || $('#bulkAdd')).focus();
  });
  $('#bulkAdd').addEventListener('click', addBulkToTrade);
  $('#bulkClear').addEventListener('click', () => {
    trade.bulk.counts = {};
    saveTrade();
    renderBulk();
  });

  // Editable cash total (totals bar)
  const cashTotal = $('#totalCash');
  cashTotal.addEventListener('focus', () => cashTotal.select());
  cashTotal.addEventListener('change', () => setCashTotal(cashTotal));
  cashTotal.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { cashTotal.blur(); focusScan(); }
    if (e.key === 'Escape') { cashTotal.value = money(tradeTotals().cash); cashTotal.blur(); focusScan(); }
  });
  $('#cashReset').addEventListener('click', () => {
    trade.cashTotal = null;
    saveTrade();
    renderTotals();
    cashTotal.value = money(tradeTotals().cash);
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
  $('#hwBuiltIn').addEventListener('click', addBuiltIns);
  $('#hwPasteToggle').addEventListener('click', () => { $('#hwPastePanel').hidden = false; $('#hwPasteText').focus(); });
  $('#hwPasteCancel').addEventListener('click', () => { $('#hwPastePanel').hidden = true; });
  $('#hwPasteApply').addEventListener('click', applyPaste);

  $('#settingsForm').addEventListener('submit', saveSettings);
  $('#settingsForm').addEventListener('input', () => setSettingsDirty(true));
  $('#settingsForm').addEventListener('change', () => setSettingsDirty(true));
  $('#rulesBody').addEventListener('input', renderRuleExamples);
  $('#rulesBody').addEventListener('change', renderRuleExamples);
  $('#dedAdd').addEventListener('click', () => {
    $('#dedBody').insertAdjacentHTML('beforeend', dedRowHtml({ id: uid(), label: '', appliesTo: 'game', amount: 0, resurface: false }));
    $('#dedBody tr:last-child [data-k="label"]').focus();
    setSettingsDirty(true);
  });
  $('#dedBody').addEventListener('click', (e) => {
    const row = e.target.closest('[data-action="del-ded"]')?.closest('tr');
    if (row) { row.remove(); setSettingsDirty(true); }
  });
  $('#settingsDiscard').addEventListener('click', () => fillSettingsForm());
  $$('[data-history]').forEach((b) => b.addEventListener('click', () => showHistory(b.dataset.history)));
  $$('.history-list').forEach((box) => box.addEventListener('click', (e) => {
    const [of, i] = (e.target.closest('[data-restore]')?.dataset.restore || '').split(':');
    if (of) restoreHistory(of, Number(i));
  }));
  $('#tokenSave').addEventListener('click', saveToken);
  $('#amzSave').addEventListener('click', saveAmazonKeys);
  $('#amzTest').addEventListener('click', testAmazonKeys);
  $('#amzClear').addEventListener('click', clearAmazonKeys);
  $('#tokenTest').addEventListener('click', testToken);
  $('#passwordSave').addEventListener('click', changePasswords);
  $('#authForm').addEventListener('submit', submitAuth);
  $('#logoutBtn').addEventListener('click', logout);

  // Split payout (totals bar)
  $('#splitBtn').addEventListener('click', () => {
    trade.split = { by: 'cash', amount: null };
    saveTrade();
    renderTotals();
    $('#splitCash').focus();
  });
  // Type the cash or the store credit the customer wants; the other box fills in.
  for (const [by, sel] of Object.entries(SPLIT_INPUTS)) {
    $(sel).addEventListener('input', (e) => {
      const cents = parseMoney(e.target.value);
      if (!Number.isNaN(cents)) trade.split = { by, amount: cents };
      saveTrade();
      renderTotals();
    });
    $(sel).addEventListener('change', (e) => {
      const t = tradeTotals();
      if (trade.split.by === by && trade.split.amount != null) {
        if (trade.split.amount > t[by]) {
          trade.split.amount = t[by];
          toast(by === 'cash' ? `Cash can't be more than the ${money(t.cash)} cash total.`
            : `Store credit can't be more than the ${money(t.credit)} store credit total.`);
        }
        trade.split.amount = roundTotal(trade.split.amount);
      }
      e.target.value = splitShown(t, by);
      saveTrade();
      renderTotals();
    });
    $(sel).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.target.blur(); focusScan(); } });
  }
  $('#splitClear').addEventListener('click', () => {
    trade.split = null;
    saveTrade();
    renderTotals();
    focusScan();
  });

  // Complete trade dialog
  $('#completeBtn').addEventListener('click', openComplete);
  $('#completeSave').addEventListener('click', () => saveCompleted(false));
  $('#completePrint').addEventListener('click', () => saveCompleted(true));
  $('#completeDialog [data-close]').addEventListener('click', () => $('#completeDialog').close());
  // Keep what was typed if the dialog is cancelled and reopened; the customer box mirrors the top bar's.
  $('#staffName').addEventListener('input', (e) => { trade.staff = e.target.value; saveTrade(); });
  $('#completeCustomer').addEventListener('input', (e) => {
    trade.customer = e.target.value;
    $('#customerName').value = e.target.value;
    saveTrade();
  });
  $('#completeDialog').addEventListener('close', focusScan);
  for (const [by, sel] of Object.entries(PAY_SPLIT_INPUTS)) {
    $(sel).addEventListener('input', () => {
      dialogSplitBy = by;
      $('#completeForm').elements.payout.value = 'split';
      updateDialogSplit();
    });
    $(sel).addEventListener('change', (e) => { // show the whole-dollar amount that will be paid
      if (dialogSplitBy !== by) return;
      const s = splitPayout(tradeTotals(), parseMoney(e.target.value), by);
      if (s) e.target.value = plain(s[by]);
    });
  }

  // Trade log
  $('#logSearchBtn').addEventListener('click', loadLog);
  $$('#logSearch, #logFrom, #logTo').forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadLog(); }));
  $('#logToday').addEventListener('click', () => {
    $('#logFrom').value = $('#logTo').value = localDay();
    loadLog();
  });
  $('#logExport').addEventListener('click', exportLog);
  $('#logBody').addEventListener('click', onLogClick);

  window.addEventListener('beforeunload', (e) => { if (hwDirty || settingsDirty) { e.preventDefault(); e.returnValue = ''; } });
}

/* ================================================================== login (website only) */

function showAuth(mode) {
  auth.mode = mode;
  currentView = 'auth';
  for (const v of VIEWS) $(`#view-${v}`).hidden = true;
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
  $$('.history-panel').forEach((p) => { p.hidden = !(auth.enabled && manager); }); // the shop PC's server keeps no history
}

/* ================================================================== startup */

async function startApp(status) {
  auth.role = status.role;
  tokenSet = !!status.tokenSet;
  amazonSet = !!status.amazonSet;
  amazonSandbox = !!status.amazonSandbox;
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
  migrateCustomLines();
  applyHardwareMatches();
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
