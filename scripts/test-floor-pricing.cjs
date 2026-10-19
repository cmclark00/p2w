/* Run with node scripts/test-floor-pricing.cjs [stock.csv lines.csv transactions.csv].
   Reads the real calculator functions; optional exports stay outside the repository. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../trade-in/app.js'), 'utf8');
const elements = new Map();
const element = (selector) => {
  if (!elements.has(selector)) elements.set(selector, { value: '', innerHTML: '', textContent: '', hidden: false,
    listeners: {}, addEventListener(type, handler) { this.listeners[type] = handler; }, focus() {}, scrollIntoView() {} });
  return elements.get(selector);
};
const context = vm.createContext({ console, Date, setTimeout, clearTimeout, crypto: require('node:crypto').webcrypto,
  localStorage: { getItem: () => null, setItem: () => {} },
  document: { querySelector: element, listeners: [], addEventListener(type, handler) { this.listeners.push({ type, handler }); } },
});
vm.runInContext(source.replace(/\binit\(\);\s*$/, ''), context);
const run = (js) => vm.runInContext(js, context);
const json = (js) => JSON.parse(JSON.stringify(run(js)));
const invoke = (name, ...args) => run(`${name}(...${JSON.stringify(args)})`);
let checks = 0;
function test(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
const stockHeader = 'stock_code,item_name,category,item_type,condition,sub_condition,quantity,sell_price,pc_retail_loose_sell,pc_retail_cib_sell,pc_retail_new_sell';
const lineHeader = 'transaction_number,date_local,transaction_type,line_mode,item_name,category,item_type,condition,sub_condition,quantity,line_subtotal';
const txHeader = 'transaction_number,date_local,transaction_type,purchases_total,line_count';
const item = { 'product-name': 'Example Game', 'console-name': 'Playstation 4', 'retail-cib-sell': 1999, 'cib-price': 1500, 'gamestop-price': 0 };
const cur = (product = item, extra = {}) => {
  const result = { product, condition: 'cib', manualMissing: false, sales: { cib: [{ title: `${product['product-name']} complete`, price: 1999, date: '2026-10-01' }] }, pick: null, typed: null, ...extra };
  // Normal offer fixtures have a matching catalog title; explicit empty/null titles exercise missing evidence.
  if (result.amazon?.found) result.amazon = { title: product['product-name'], ...result.amazon };
  return result;
};

test('eBay and Amazon exclude language, region, edition, extras and platform mismatches before pricing', () => {
  const titles = ['Example Game (French Version) PS4', 'Example Game - Version Française',
    'Example Game [Spanish]', 'Example Game Edición Española PS4', 'Example Game - French - PS4', 'Example Game French PS4',
    'Example Game German Edition', 'Example Game (Italian Version)', 'Example Game Japanese Import',
    'Example Game PAL UK', 'Example Game PEGI', 'Example Game NTSC-J',
    'Example Game Special Edition', 'Example Game Collectors Edition', 'Example Game Greatest Hits',
    'Example Game with bonus disc', 'Example Game + figurine', 'Example Game with soundtrack',
    'Example Game with art book', 'Example Game Bonus Disc', 'Example Game + Another Game', 'Example Game PS5'];
  for (const title of titles) {
    const example = cur(item, { sales: { cib: [{ title, price: 6000 }, { title: 'Example Game PS4 CIB', price: 1000 }] },
      amazon: { found: true, title, lowest: 7000, offers: [{ price: 7000 }] } });
    const result = invoke('floorResult', example);
    assert.equal(result.b.basis, 1000, title); assert.equal(result.r.price, 1000, title);
    assert.equal(invoke('floorAmazonLowest', example), null, title);
    assert.ok(result.b.checks.some((s) => s.includes('Amazon excluded')), title);
    assert.ok(result.b.checks.some((s) => s.includes('title/variant mismatch')), title);
  }
});

test('matching variants and ordinary packaging remain eligible while unconfirmed special editions do not', () => {
  for (const title of ['Example Game PS4 CIB with manual', 'Example Game with original case and inserts',
    'Example Game (English Version) PS4', 'Example Game USA NTSC-U ESRB', 'Example Game PS4 / PS5 compatible']) {
    assert.equal(invoke('floorListingMismatch', title, item), null, title);
  }
  assert.equal(invoke('floorListingMismatch', 'Assassins Creed Unity French Revolution PS4', { ...item, 'product-name': 'Assassins Creed Unity' }), null);
  for (const [name, system, title] of [
    ['Example Game [French Version]', 'Playstation 4', 'Example Game PS4 Version Française'],
    ['Example Game [Spanish]', 'Playstation 4', 'Example Game Spanish Version PS4'],
    ['Example Game [Special Edition]', 'Playstation 4', 'Example Game Special Edition PS4'],
    ['Example Game', 'PAL Playstation 4', 'Example Game PS4 PAL'],
    ['Example Game', 'JP Playstation 4', 'Example Game PS4 Japanese Import'],
    ['Guitar Hero Live [Bundle]', 'Wii U', 'Guitar Hero Live Wii U Bundle with guitar'],
  ]) assert.equal(invoke('floorListingMismatch', title, { ...item, 'product-name': name, 'console-name': system }), null, title);
  assert.ok(invoke('floorListingMismatch', 'Example Game PS4', { ...item, 'product-name': 'Example Game [Special Edition]' }));
});

test('original paper pack-ins remain CIB evidence for eBay and Amazon', () => {
  const product = { ...item, 'product-name': 'Terminator', 'console-name': 'Sega CD' };
  for (const title of [
    'The Terminator (Sega CD, 1993) CIB w/ Reg Card Manual Foam, Near Mint Vintage',
    'Terminator + Registration Card Sega CD CIB',
    'Terminator Sega CD CIB + reg. card + original poster + manual',
    'Terminator Sega CD complete plus warranty card and map',
    'Terminator Sega CD with original inserts + foam insert',
    'Terminator + poster Sega CD complete',
    'Terminator + fold-out map Sega CD complete',
  ]) {
    assert.equal(invoke('floorListingMismatch', title, product), null, title);
    assert.equal(invoke('floorOdd', { title }, 'cib'), false, title);
    const example = cur(product, { sales: { cib: [{ title, price: 25000 }] } });
    assert.equal(invoke('floorResult', example).b.basis, 25000, title);
    assert.equal(invoke('floorAmazonLowest', cur(product, { amazon: { found: true, title, offers: [{ price: 25000 }] } })), 25000, title);
  }
});

test('pack-ins do not excuse separate extras, variants, incomplete copies or high-sale outliers', () => {
  const product = { ...item, 'product-name': 'Terminator', 'console-name': 'Sega CD' };
  for (const title of [
    'Terminator Sega CD + reg card + another game',
    'Terminator Sega CD + poster + soundtrack',
    'Terminator Sega CD + manual + controller',
    'Terminator Sega CD + poster + Sonic',
    'Terminator Sega CD + poster Special Edition',
    'Terminator Sega CD + reg card French Version',
    'Terminator Sega CD 5 games + poster',
    'Terminator Sega CD + movie poster',
    'Terminator Sega CD + collectible poster',
  ]) assert.ok(invoke('floorListingMismatch', title, product), title);
  assert.equal(invoke('floorOdd', { title: 'Terminator Sega CD disc only + reg card' }, 'cib'), true);
  assert.equal(invoke('floorOdd', { title: 'Terminator Sega CD reproduction + poster' }, 'cib'), true);
  const example = cur(product, { sales: { cib: [
    { title: 'Terminator Sega CD CIB + reg card + poster', price: 50000 },
    ...[20000, 21000, 22000, 23000, 24000].map((price) => ({ title: 'Terminator Sega CD CIB', price })),
  ] } });
  const result = invoke('floorResult', example);
  assert.equal(result.b.basis, 24000);
  assert.ok(result.b.checks.some((s) => s.includes('outlier')));
});

test('audit mismatches cannot drive eBay or Amazon baselines', () => {
  for (const [name, system, title, good, price] of [
    ['Final Fight', 'Super Nintendo', 'Final Fight Guy - Nintendo Super NES', 'Final Fight Super Nintendo cartridge tested', 2969],
    ['Terminator', 'Sega CD', '5 Sega CD Games (Andoid Assault,Lunar,Silpheed,Terminator & Vay) for juanmle-84', 'Terminator Sega CD complete', 20000],
    ['Nintendo Switch 2 Console', 'Nintendo Switch 2', '**PRE-SALE/PREORDER** Nintendo Switch 2 Console The Legend of Zelda 40th Edition', 'Nintendo Switch 2 System', 49900],
    ['Time Crisis 4', 'Playstation 3', 'Time Crisis 4 (With Gun) - Sony PlayStation 3 COMPLETE WITH GUN AND SENSORS PS3', 'Time Crisis 4 PS3 complete', 1500],
    ['Halo 3', 'Xbox 360', 'Halo 3 ODST Xbox 360', 'Halo 3 Xbox 360 complete', 2000],
    ['Pokemon Sword', 'Nintendo Switch', 'Pokemon Shield Nintendo Switch', 'Pokemon Sword Nintendo Switch complete', 5000],
  ]) {
    const product = { ...item, 'product-name': name, 'console-name': system };
    const example = cur(product, { sales: { cib: [{ title, price: 99900 }, { title: good, price }] },
      amazon: { found: true, title, offers: [{ price: 99900 }] } });
    const result = invoke('floorResult', example);
    assert.equal(result.b.basis, price, name);
    assert.equal(result.b.sale.title, good, name);
    assert.ok(result.b.checks.some((s) => s.includes('Amazon excluded')), name);
    assert.ok(invoke('floorSales', example).find((s) => s.title === title).mismatch, name);
    if (name === 'Pokemon Sword') { assert.equal(result.premium.pct, 10); assert.equal(result.r.price, 5500); }
  }
});

test('preorders, multi-game lots and unknown named editions are held for review', () => {
  for (const title of ['Example Game pre-order', 'Example Game presale', 'Example Game PRE SALE',
    'Example Game Zelda 40th Edition', 'Example Game Mario Red Edition', 'Two PlayStation 4 Games Example Game',
    'Example Game + another game', 'Example Game with gun', 'Example Game and sensors']) {
    assert.ok(invoke('floorListingMismatch', title, item), title);
  }
  const product = { ...item, 'product-name': 'Example Game [Zelda 40th Edition]' };
  assert.ok(invoke('floorListingMismatch', 'Example Game Mario 40th Edition PS4', product));
  assert.equal(invoke('floorListingMismatch', 'Example Game Zelda 40th Edition PS4', product), null);
});

test('normal naming, selected extras and genuine collections remain comparable', () => {
  for (const [name, system, title] of [
    ['Example Game', 'Playstation 4', 'Example Game Standard Edition PS4'],
    ['Resident Evil 4', 'Wii', 'Resident Evil 4 Wii Edition'],
    ['Final Fight Guy', 'Super Nintendo', 'Final Fight Guy - Nintendo Super NES'],
    ['Final Fantasy XII', 'Playstation 2', 'Final Fantasy XII 12 PS2 Complete'],
    ['Final Fantasy XII', 'Playstation 2', 'final fantasy xii ps2 complete'],
    ['Super Smash Bros for Nintendo 3DS', 'Nintendo 3DS', 'Super Smash Brothers Nintendo 3DS'],
    ['Nintendo Switch 2 Console', 'Nintendo Switch 2', 'Nintendo Switch 2 System'],
    ['Star Fox 64', 'Nintendo 64', 'Starfox 64 Nintendo 64 cartridge'],
    ['Marvel Spiderman [Game of the Year]', 'Playstation 4', "Marvel's Spider-Man Game of the Year Edition PS4"],
    ['Zelda Skyward Sword [Soundtrack Bundle]', 'Wii', 'The Legend of Zelda: Skyward Sword with Music CD'],
    ['Time Crisis 4 [With Gun]', 'Playstation 3', 'Time Crisis 4 With Gun PS3'],
    ['Halo The Master Chief Collection', 'Xbox One', 'Halo The Master Chief Collection Xbox One CIB'],
    ['Halo The Master Chief Collection', 'Xbox One', 'Halo The Master Chief Collection Xbox One 6 Games'],
    ['Example 3 Games Collection', 'Playstation 4', 'Example Three PS4 Games Collection'],
  ]) assert.equal(invoke('floorListingMismatch', title, { ...item, 'product-name': name, 'console-name': system }), null, title);
  assert.ok(invoke('floorListingMismatch', 'Zelda Skyward Sword with Music CD and statue', { ...item, 'product-name': 'Zelda Skyward Sword [Soundtrack Bundle]', 'console-name': 'Wii' }));
  assert.ok(invoke('floorListingMismatch', 'Guitar Hero Live Bundle with guitar and statue', { ...item, 'product-name': 'Guitar Hero Live [Bundle]', 'console-name': 'Wii U' }));
  assert.ok(invoke('floorListingMismatch', 'Four PS3 Games Mass Effect Trilogy', { ...item, 'product-name': 'Mass Effect Trilogy', 'console-name': 'Playstation 3' }));
  const collection = { ...item, 'product-name': 'Halo The Master Chief Collection', 'console-name': 'Xbox One' };
  const title = 'Halo The Master Chief Collection Xbox One 6 Games';
  const result = invoke('floorResult', cur(collection, { sales: { cib: [{ title, price: 5200 }] },
    amazon: { found: true, title, offers: [{ price: 4000 }] } }));
  assert.equal(result.b.from, 'sale'); assert.equal(result.b.basis, 5200); assert.equal(result.r.price, 5000);
});

test('Amazon missing-title and renewed/digital matches are excluded and visibly explained', () => {
  run('amazonSet = true;');
  for (const title of ['', null, 'Example Game (Renewed)', 'Example Game Digital Download Code']) {
    const example = cur(item, { amazon: { found: true, title, lowest: 7000, offers: [{ price: 7000 }], url: 'https://www.amazon.com/dp/example' } });
    const result = invoke('floorResult', example);
    assert.equal(result.b.from, 'sale'); assert.equal(result.r.price, 2000);
    const html = invoke('floorAmazonHtml', example, result.b);
    assert.ok(html.includes('Excluded from pricing')); assert.ok(!html.includes('class="picked"'));
    assert.ok(invoke('floorBasisInfo', result.b).reviewNotes.some((s) => s.includes('Amazon excluded')));
  }
  const example = cur(item, { amazon: { found: true, title: 'Example Game [French Version] <script>unsafe</script>', offers: [{ price: 1000 }] } });
  assert.ok(invoke('floorAmazonHtml', example, {}).includes('&lt;script&gt;'));
  run('amazonSet = false;');
});

test('variant exclusions precede premiums and leave matching Amazon offers eligible', () => {
  const product = { ...item, 'product-name': 'Pokemon Shield', 'console-name': 'Nintendo Switch' };
  const example = cur(product, { sales: { cib: [{ title: 'Pokemon Shield Nintendo Switch', price: 5000 },
    { title: 'Pokemon Shield (French Version) Nintendo Switch', price: 9000 }] },
    amazon: { found: true, title: 'Pokemon Shield - Nintendo Switch', offers: [{ price: 6000 }, { price: 10000 }] } });
  const result = invoke('floorResult', example);
  assert.equal(result.b.basis, 6000); assert.equal(result.premium.pct, 10); assert.equal(result.r.price, 6500);
  example.amazon.title = 'Pokemon Shield (French Version) - Nintendo Switch';
  const excluded = invoke('floorResult', example);
  assert.equal(excluded.b.basis, 5000); assert.equal(excluded.r.price, 5500);
});

test('mismatched rhythm-game sales cannot distort the disc-only safety cap', () => {
  const product = { ...item, 'product-name': 'Guitar Hero Live', 'console-name': 'Wii U' };
  const example = cur(product, { sales: { loose: [700, 800, 900].map((price) => ({ price, title: 'Guitar Hero Live Wii U disc only' }))
    .concat([10, 20, 30, 40, 50].map((price) => ({ price, title: 'Guitar Hero Live Wii U French Version disc only' }))), cib: [] } });
  assert.equal(invoke('rhythmDiscSaleCap', example), 2400);
});

test('sold evidence leads on modern, retro and hardware even when PriceCharting is higher', () => {
  for (const product of [{ ...item }, { ...item, 'console-name': 'Playstation 2' }, { ...item, 'product-name': 'DualShock 4 Controller', genre: 'Accessories' }]) {
    const r = invoke('floorResult', cur({ ...product, 'retail-cib-sell': 9900, 'cib-price': 8900 }));
    assert.equal(r.b.from, 'sale'); assert.equal(r.r.price, 2000);
  }
});
test('a single high outlier cannot drive the price and odd editions do not support it', () => {
  const sales = { cib: Array.from({ length: 30 }, (_, i) => ({ title: 'Example Game complete', price: i === 0 ? 16000 : 1999, date: '2026-10-01' })) };
  sales.cib.push({ title: 'Example Game Steelbook', price: 20000, date: '2026-10-01' });
  const r = invoke('floorResult', cur(item, { sales }));
  assert.equal(r.b.basis, 1999); assert.equal(r.r.price, 2000);
  assert.ok(r.b.checks.some((s) => s.includes('Excluded from automatic pricing possible high sale outlier $160.00')));
});

const highSaleCur = (prices, product = item, extra = {}) => cur(product, {
  sales: { cib: prices.map((price) => ({ price, title: `${product['product-name']} complete`, date: '2026-10-17' })) }, ...extra,
});

test('Killzone uses the supported baseline without a special discount while other premiums stay active', () => {
  const amazon = { found: true, lowest: 1000, offers: [{ price: 1000 }] };
  const killzone = invoke('floorResult', highSaleCur([1600, 1000, 999, 950], { ...item, 'product-name': 'Killzone: Shadow Fall' }, { amazon }));
  assert.equal(killzone.b.basis, 1000); assert.equal(killzone.premium, null); assert.equal(killzone.r.price, 1000);
  const pokemon = invoke('floorResult', highSaleCur([10000, 5000, 4999, 4500], { ...item, 'product-name': 'Pokemon Shield', 'console-name': 'Nintendo Switch' }));
  assert.equal(pokemon.b.basis, 5000); assert.equal(pokemon.premium.pct, 10); assert.equal(pokemon.r.price, 5500);
});

test('outlier thresholds require both a large relative gap and a $5 gap with three lower comparables', () => {
  for (const [prices, expected] of [
    [[1500, 1000, 999, 950], 1000], [[1499, 1000, 999, 950], 1499],
    [[1200, 800, 799, 750], 1200], [[1600, 1000, 999], 1600],
    [[1600, 1600, 1000, 999], 1600], [[1600, 1400, 1200, 1000], 1600],
    [[3000, 1600, 1000, 999, 950], 1600],
  ]) assert.equal(invoke('floorResult', highSaleCur(prices)).b.basis, expected);
  const example = highSaleCur([1600, 1000, 999, 950]);
  example.sales.cib[2].title = 'Example Game Steelbook';
  example.sales.cib[3].title = 'Example Game sealed';
  assert.equal(invoke('floorResult', example).b.basis, 1600);
});

test('Killzone real CIB price distribution excludes $16 and rounds the remaining $13 to $10', () => {
  // Public PriceCharting CIB table, fetched Oct 17, 2026; the $1.50 Greatest Hits edition is omitted.
  const prices = [300, 750, 598, 1237, 601, 899, 999, 554, 799, 750, 900, 240, 1299, 1179,
    700, 399, 528, 1600, 499, 883, 444, 799, 695, 729, 500, 574, 995, 971, 1300];
  const product = { ...item, 'product-name': 'Killzone Shadow Fall', 'gamestop-price': 999 };
  const example = highSaleCur(prices, product, { amazon: { found: true, lowest: 1000, offers: [{ price: 1000 }] } });
  const result = invoke('floorResult', example);
  assert.equal(result.b.basis, 1300); assert.equal(result.r.price, 1000);
  assert.ok(result.b.checks.some((s) => s.includes('75%')));
  assert.equal(invoke('floorResult', { ...example, pick: prices.indexOf(1600) }).r.price, 1500);
  // A second nearby high sale supports the high price rather than being discarded recursively.
  example.sales.cib.push({ price: 1550, title: 'Killzone Shadow Fall complete' });
  assert.equal(invoke('floorResult', example).b.basis, 1600);
  assert.equal(invoke('floorResult', example).r.price, 1500);
});

test('distribution-based flags need eight comparables, a 20% top gap, and a $5 / 50% quartile gap', () => {
  for (const [prices, expected] of [
    [[1600, 1300, 1000, 1000, 999, 950, 900], 1600],
    [[1600, 1300, 1000, 1000, 999, 950, 900, 800], 1300],
    [[1600, 1400, 1000, 1000, 999, 950, 900, 800], 1600],
    [[1400, 1150, 1000, 1000, 999, 950, 900, 800], 1400],
    [[1200, 950, 800, 800, 799, 750, 700, 600], 1200],
  ]) assert.equal(invoke('floorResult', highSaleCur(prices)).b.basis, expected);
});

test('outliers are condition-specific, keep original indices, and do not mutate cached sales', () => {
  const example = highSaleCur([1000, 999, 1600, 950]);
  example.sales.loose = [{ price: 10000, title: 'Example Game disc only' }];
  const before = JSON.stringify(example);
  context.cachedExample = example;
  const sales = json('floorSales(cachedExample)');
  assert.equal(sales[0].i, 2); assert.ok(sales[0].outlier);
  assert.equal(invoke('floorResult', example).b.basis, 1000);
  assert.equal(run('JSON.stringify(cachedExample)'), before);
});

test('Amazon and GameStop remain baseline candidates after excluding an eBay outlier', () => {
  const amazon = { found: true, lowest: 1200, offers: [{ price: 1200 }] };
  assert.equal(invoke('floorResult', highSaleCur([1600, 1000, 999, 950], item, { amazon })).b.basis, 1200);
  assert.equal(invoke('floorResult', highSaleCur([1600, 1000, 999, 950], { ...item, 'gamestop-price': 1300 }, { amazon })).b.basis, 1300);
});

test('reviewed outliers can be selected explicitly and returning to automatic excludes them again', () => {
  const example = highSaleCur([1600, 1000, 999, 950], item, { pick: 0 });
  const selected = invoke('floorResult', example);
  assert.equal(selected.b.basis, 1600);
  assert.ok(selected.b.checks.some((s) => s.includes('Manually included possible high sale outlier')));
  run(`floorCur = ${JSON.stringify(example)}; renderFloorPricer();`);
  assert.ok(element('#floorPricer').innerHTML.includes('Possible high outlier'));
  assert.ok(element('#floorPricer').innerHTML.includes('Use automatic price'));
  context.autoEvent = { target: { closest: (selector) => selector === '[data-floor-act]' ? { dataset: { floorAct: 'auto' } } : null } };
  run('onFloorPricerClick(autoEvent);');
  assert.equal(run('floorCur.pick'), null); assert.equal(json('floorResult(floorCur)').b.basis, 1000);
  assert.ok(element('#floorPricer').innerHTML.includes('Excluded from automatic pricing'));
  run('floorCur = null;');
});

test('review warnings survive list metadata, unchanged rechecks and accepting a new price', () => {
  const result = invoke('floorResult', highSaleCur([1600, 1000, 999, 950]));
  const info = invoke('floorBasisInfo', result.b);
  assert.ok(info.reviewNotes.some((s) => s.includes('high sale outlier')));
  for (const price of [1000, 2000]) {
    assert.ok(invoke('recheckHtml', { price, recheck: { price: 1000, ...info } }).includes('high sale outlier'));
  }
  context.reviewItem = { price: 2000, recheck: { price: 1000, ...info } };
  run('useRecheck(reviewItem);');
  assert.ok(json('reviewItem').reviewNotes.some((s) => s.includes('high sale outlier')));
  assert.ok(invoke('floorReviewHtml', { reviewNotes: ['<script>unsafe</script>'] }).includes('&lt;script&gt;'));
});

test('Halo MCC uses the highest supported sale then low-price rounding across systems', () => {
  // PriceCharting product 35300 CIB prices fetched Oct 17, 2026. Previously p90 selected $36.99 -> $40.
  const prices = [5200, 4999, 4499, 3699, 3499, 3385, 3299, 3199, 3099, 3000, 2999, 2999, 2999,
    2997, 2997, 2995, 2995, 2989, 2956, 2900, 2800, 2799, 2775, 2700, 2599, 2500, 2299, 2000, 2000, 2000];
  for (const system of ['Xbox One', 'Playstation 2', 'Unlisted System']) {
    const product = { ...item, 'product-name': 'Halo: The Master Chief Collection', 'console-name': system, 'gamestop-price': 3499 };
    const sales = { cib: prices.map((price) => ({ price, title: 'Halo The Master Chief Collection CIB' })) };
    const r = invoke('floorResult', cur(product, { sales }));
    assert.equal(r.b.from, 'sale'); assert.equal(r.b.basis, 5200); assert.equal(r.r.price, 5000);
    // Clicking a lower sale cannot undercut the highest valid sale; typed prices are explicit overrides.
    assert.equal(invoke('floorResult', cur(product, { sales, pick: 1 })).r.price, 5000);
  }
});

test('highest-sale selection filters odd listings before ranking and handles sparse sales', () => {
  const sales = { cib: [
    { price: 20000, title: 'Example Game Steelbook' },
    { price: 16000, title: 'Example Game bundle' },
    { price: 12000, title: 'Example Game sealed' },
    { price: 5200, title: 'Example Game complete' },
    { price: 4999, title: 'Example Game complete' },
    { price: 3699, title: 'Example Game complete' },
  ] };
  assert.equal(invoke('floorResult', cur(item, { sales })).b.basis, 5200);
  const one = invoke('floorResult', cur(item, { sales: { cib: [sales.cib[3]] } }));
  assert.equal(one.r.price, 5000); assert.ok(one.b.checks.some((s) => s.includes('Only 1')));
  assert.equal(invoke('floorAutoSale', [{ price: 5200 }, { price: 4999 }]).sale.price, 5200);
  assert.equal(invoke('floorAutoSale', []).sale, null);
});
test('fallback waits for sold evidence and Amazon before using PriceCharting', () => {
  assert.equal(invoke('floorResult', cur(item, { sales: null })).b.waiting, true);
  run('amazonSet = true;');
  assert.equal(invoke('floorResult', cur(item, { sales: { cib: [] }, amazon: { loading: true } })).r, null);
  run('amazonSet = false;');
  const r = invoke('floorResult', cur(item, { sales: { cib: [] } }));
  assert.equal(r.b.from, 'pricecharting'); assert.equal(r.r.price, 1500);
  assert.ok(r.b.checks.some((s) => s.includes('fallback')));
});
test('GameStop and Amazon precede PriceCharting when no sold evidence exists', () => {
  const amazon = { found: true, lowest: 3000, offers: [{ price: 3000 }] };
  const r = invoke('floorResult', cur({ ...item, 'cib-price': 9900 }, { sales: { cib: [] }, amazon }));
  assert.equal(r.b.from, 'amazon'); assert.equal(r.r.price, 3000);
  const gs = invoke('floorResult', cur({ ...item, 'gamestop-price': 2499, 'cib-price': 9900 }, { sales: { cib: [] }, amazon }));
  assert.equal(gs.b.from, 'amazon'); assert.equal(gs.r.price, 3000);
});
test('missing references require a typed price and failed sales are visibly flagged', () => {
  const empty = { ...item, 'cib-price': 0, 'retail-cib-sell': 9900 };
  const r = invoke('floorResult', cur(empty, { sales: null, salesError: 'Service unavailable' }));
  assert.equal(r.r, null); assert.ok(r.b.need);
  const fallback = invoke('floorResult', cur(item, { sales: null, salesError: 'Service unavailable' }));
  assert.equal(fallback.b.from, 'pricecharting'); assert.ok(fallback.b.checks.some((s) => s.includes('fallback')));
});
test('lowest Amazon offer can win and unusually high minimums are flagged instead of discarded', () => {
  for (const price of [3500, 6000]) {
    const r = invoke('floorResult', cur({ ...item, 'cib-price': 9900 }, { amazon: { found: true, lowest: price, offers: [{ price }] } }));
    assert.equal(r.b.from, 'amazon'); assert.equal(r.r.price, price);
    assert.ok(r.b.checks.some((s) => s.includes('Amazon')));
  }
});
test('older systems use the same maximum rule without an Amazon midpoint adjustment', () => {
  const r = invoke('floorResult', cur({ ...item, 'console-name': 'Playstation 2', 'cib-price': 9900 }, { amazon: { found: true, lowest: 6000, offers: [{ price: 6000 }] } }));
  assert.equal(r.b.from, 'amazon'); assert.equal(r.b.basis, 6000); assert.equal(r.r.price, 6000);
});

test('Operation Darkness stays $150 despite expensive higher Amazon offers', () => {
  const product = { ...item, 'product-name': 'Operation Darkness', 'console-name': 'Xbox 360', 'gamestop-price': 9999 };
  const sales = { cib: [15000, 14000, 12000].map((price) => ({ price, title: 'Operation Darkness complete' })) };
  const amazon = { found: true, lowest: 13400, offers: [13400, 20000, 50000, 90000].map((price) => ({ price })) };
  const r = invoke('floorResult', cur(product, { sales, amazon }));
  assert.equal(r.b.from, 'sale'); assert.equal(r.b.basis, 15000); assert.equal(r.r.price, 15000);
  assert.equal(invoke('floorResult', cur(product, { sales, amazon: { found: true, offers: [] } })).r.price, 15000);
});

test('three-reference baseline applies across tiers and conditions before specific manual deductions', () => {
  for (const system of ['Xbox 360', 'Playstation 5', 'Unlisted System']) {
    for (const condition of ['loose', 'cib', 'new']) {
      for (const manualMissing of [false, true]) {
        for (const [ebay, amazonLow, gs, from] of [[15000, 13400, 10000, 'sale'], [15000, 16400, 10000, 'amazon'], [15000, 13400, 17999, 'gamestop']]) {
          const product = { ...item, 'console-name': system, 'gamestop-price': gs };
          const sales = { [condition]: [{ price: ebay, title: 'Example Game complete' }] };
          const amazon = { found: true, lowest: amazonLow, offers: [{ price: 90000 }, { price: amazonLow }, { price: 50000 }] };
          const r = invoke('floorResult', cur(product, { condition, manualMissing, sales, amazon }));
          assert.equal(r.b.from, from);
          const expected = manualMissing && condition === 'cib'
            ? { sale: 13000, amazon: 14000, gamestop: 16000 }[from]
            : { sale: 15000, amazon: 16000, gamestop: 18000 }[from];
          assert.equal(r.r.price, expected);
        }
      }
    }
  }
});

test('pricer displays the lowest Amazon offer and the winning price without midpoint language', () => {
  const amazon = { found: true, lowest: 16400, offers: [{ price: 90000 }, { price: 16400 }, { price: 50000 }] };
  run(`amazonSet = true; floorCur = ${JSON.stringify(cur({ ...item, 'console-name': 'Xbox 360' }, { amazon }))}; renderFloorPricer();`);
  const html = element('#floorPricer').innerHTML;
  assert.ok(html.includes('<strong>$160.00</strong>'));
  assert.ok(html.includes('<tr class="picked">\n      <td class="num">$164.00'));
  assert.ok(!html.includes('typical'));
  assert.ok(!html.includes('halfway'));
  run('amazonSet = false; floorCur = null;');
});
test('missing-manual rules take priority over the general market baseline', () => {
  assert.equal(invoke('floorResult', cur({ ...item, 'gamestop-price': 4799 }, { manualMissing: true, sales: { cib: [{ title: 'Example Game complete', price: 4999 }] } })).r.price, 4500);
});
test('full lookup blocks adding an automatic price even if retail sell is known', () => {
  const r = invoke('floorResult', cur(item, { fullLoading: true }));
  assert.equal(r.r, null); assert.equal(r.b.waiting, true);
});
test('add action also waits for Amazon on a sales-based price', () => {
  run(`amazonSet = true; floorCur = ${JSON.stringify(cur({ ...item, 'console-name': 'Playstation 2' }, { amazon: { loading: true } }))};`);
  assert.equal(json('floorResult(floorCur)').r, null);
  run('addFloorItem();');
  assert.equal(run('floor.items.length'), 0); assert.equal(run('floorCur != null'), true);
  run('amazonSet = false; floorCur = null;');
});
test('lookup failure is visible and typed prices remain explicit overrides', () => {
  assert.ok(invoke('floorResult', cur(item, { fullError: true })).b.checks.some((s) => s.includes('lookup failed')));
  assert.equal(invoke('floorResult', cur(item, { typed: 1000, fullLoading: true })).r.price, 1000);
});
test('modern hardware uses sales instead of the game retail-sell rule', () => {
  const r = invoke('floorResult', cur({ ...item, 'product-name': 'DualShock 4 Controller', genre: 'Accessories', 'cib-price': 3000 }, { sales: { cib: [{ price: 4000, title: 'DualShock 4 controller complete', date: '2026-10-01' }] } }));
  assert.equal(r.hw, true); assert.equal(r.b.from, 'sale'); assert.equal(r.r.price, 4000);
});
test('configured premiums apply on top of the winning market baseline', () => {
  const product = { ...item, 'product-name': 'Pokemon Shield', 'console-name': 'Nintendo Switch', 'gamestop-price': 5500 };
  const r = invoke('floorResult', cur(product, { sales: { cib: [{ price: 5000, title: 'Pokemon Shield complete' }] },
    amazon: { found: true, lowest: 6000, offers: [{ price: 6000 }, { price: 20000 }] } }));
  assert.equal(r.b.from, 'amazon'); assert.equal(r.b.basis, 6000);
  assert.equal(r.premium.pct, 10); assert.equal(r.r.premiumBasis, 6600); assert.equal(r.r.price, 6500);
});
test('specific discounts outrank all three market references and saved settings remain intact', () => {
  const r = invoke('floorResult', cur({ ...item, 'product-name': 'Pokemon Black', 'console-name': 'Nintendo DS', 'gamestop-price': 14500 },
    { sales: { cib: [{ title: 'Pokemon Black complete', price: 14000 }] },
      amazon: { found: true, lowest: 15000, offers: [{ price: 15000 }] } }));
  assert.equal(r.b.basis, 15000); assert.equal(r.premium.pct, -14); assert.equal(r.r.price, 13000);
  assert.equal(invoke('mergeSettings', { version: 9, floorPremiums: [{ phrase: "Conker's Bad Fur Day", pct: 15 }] }).floorPremiums[0].pct, 10);
  assert.equal(invoke('mergeSettings', { version: 9, floorPremiums: [{ phrase: "Conker's Bad Fur Day", pct: 22 }] }).floorPremiums[0].pct, 22);
});
test('settings migration retires the Killzone -45% rule without deleting other custom rules', () => {
  const retired = { phrase: 'Killzone: Shadow Fall', system: 'Playstation 4', pct: -45 };
  const custom = { phrase: 'Killzone Shadow Fall', system: 'Playstation 4', pct: -20 };
  const pokemon = { phrase: 'Pokemon', pct: 12 };
  assert.equal(invoke('floorPremium', retired.phrase, retired.system), null);
  for (const version of [7, 8, 9, 10]) {
    const saved = { version, floorPremiums: [retired, custom, pokemon] };
    const migrated = JSON.parse(JSON.stringify(invoke('mergeSettings', saved)));
    assert.equal(migrated.version, 11);
    assert.deepEqual(migrated.floorPremiums, [custom, pokemon]);
    assert.equal(JSON.stringify(invoke('mergeSettings', migrated).floorPremiums), JSON.stringify([custom, pokemon]));
  }
  assert.equal(JSON.stringify(invoke('mergeSettings', { version: 8, floorPremiums: [pokemon] }).floorPremiums), JSON.stringify([pokemon]));
  assert.equal(invoke('mergeSettings', null).floorPremiums.length, 14);
});
test('longest and system-specific rules win, while zero-percent exemptions retain the baseline', () => {
  const overrides = { floorPremiums: [
    { phrase: 'Example', pct: 10 }, { phrase: 'Example Game', pct: 20 },
    { phrase: 'Example Game', system: 'Playstation 4', pct: 30 },
  ] };
  assert.equal(invoke('floorPremium', 'Example Game', 'Playstation 4', overrides).pct, 30);
  assert.equal(invoke('floorPremium', 'Example Game', 'Xbox 360', overrides).pct, 20);
  const product = { ...item, 'product-name': 'Pokemon Black Version 2', 'console-name': 'Nintendo DS' };
  const r = invoke('floorResult', cur(product, { sales: { cib: [{ price: 5200, title: 'Pokemon Black Version 2 complete' }] } }));
  assert.equal(r.premium, null); assert.equal(r.r.price, 5000);
  assert.equal(invoke('floorResult', cur({ ...product, 'product-name': 'Pokemon Shield', 'console-name': 'Nintendo Switch' }, { typed: 1000 })).r.price, 1000);
});
test('low-price rounding respects dollar endings, cents, market references and the $80 boundary', () => {
  for (const [basis, expected] of [[1000, 1000], [1499, 1000], [1500, 1500], [1600, 1500], [1699, 1500],
    [1700, 2000], [1800, 2000], [1999, 2000], [2038, 2000], [2250, 2000], [2499, 2000],
    [2500, 2500], [2699, 2500], [2700, 3000], [5200, 5000], [5250, 5000], [5700, 6000],
    [7699, 7500], [7700, 8000], [8000, 8000], [8001, 8000]]) {
    assert.equal(invoke('floorPrice', basis, { referenceMin: basis, gs: basis }).price, expected, `market basis ${basis}`);
    if (basis <= 8000) assert.equal(invoke('floorPrice', basis, {}).price, expected, `typed basis ${basis}`);
  }
  assert.equal(invoke('floorPrice', 200, {}).price, 1000);
  assert.equal(invoke('floorPrice', 200, { shitbox: true }).price, 500);
  assert.equal(invoke('floorPrice', 5200, { gs: 5200 }).price, 5000);
  assert.equal(invoke('floorPrice', 5200, { manualMissing: true }).price, 4500);
  const rounded = invoke('floorPrice', 5200, {});
  assert.ok(invoke('floorMath', { from: 'sale', basis: 5200 }, rounded).includes('low-price rounding: $50.00'));
  assert.deepEqual([2000, 2500, 5000, 5500, 10000, 10500, 20000, 20500].map((v) => invoke('manualDeduction', v)), [0, 500, 500, 1000, 1000, 2000, 2000, 2000]);
});

test('final shelf prices over $80 through $500 round to the nearest $10 or $25 multiple with ties up', () => {
  for (const [price, expected] of [[7500, 7500], [8000, 8000], [8001, 8000], [8500, 9000],
    [9500, 10000], [10500, 11000], [12000, 12000], [12500, 12500], [12501, 12500],
    [13500, 14000], [14500, 15000], [15000, 15000], [16500, 17000], [17500, 17500],
    [19500, 20000], [22500, 22500], [24500, 25000], [50000, 50000]]) {
    assert.equal(invoke('floorShelfRound', price), expected);
  }
  const r = invoke('floorPrice', 14500, { referenceMin: 14500 });
  assert.equal(r.beforeShelfRound, 14500); assert.equal(r.price, 15000);
  assert.ok(invoke('floorMath', { from: 'sale', basis: 14500 }, r).includes('rounded to nearest $10 or $25 multiple: $150.00'));
});

test('above $500 rounds directly to $50 once, preserving threshold, ties and raw references', () => {
  for (const [basis, expected] of [[49999, 50000], [50000, 50000], [50001, 50000],
    [52100, 50000], [52499, 50000], [52500, 55000], [52501, 55000], [55000, 55000],
    [57499, 55000], [57500, 60000], [57600, 60000], [102499, 100000], [102500, 105000]]) {
    for (const opts of [{}, { gs: basis, referenceMin: basis }]) {
      const r = invoke('floorPrice', basis, opts);
      assert.equal(r.beforeShelfRound, basis);
      assert.equal(r.price, expected);
      const math = invoke('floorMath', { from: 'sale', basis }, r);
      assert.equal((math.match(/rounded/g) || []).length, basis === expected ? 0 : 1, math);
      if (basis > 50000 && basis !== expected) assert.ok(math.includes('rounded to nearest $50'), math);
    }
  }
  const premium = invoke('floorPrice', 47726, { premium: { phrase: 'Example', pct: 10 } });
  assert.equal(premium.beforeShelfRound, 52499); assert.equal(premium.price, 50000);
  const manual = invoke('floorPrice', 58217, { manualMissing: true });
  assert.equal(manual.ded, 6000); assert.equal(manual.beforeShelfRound, 52217); assert.equal(manual.price, 50000);
  const discounted = invoke('floorPrice', 60000, { premium: { phrase: 'Example', pct: -12.5 } });
  assert.equal(discounted.beforeShelfRound, 52500); assert.equal(discounted.price, 55000);
  const below = invoke('floorPrice', 55000, { manualMissing: true });
  assert.equal(below.beforeShelfRound, 49500); assert.equal(below.price, 50000);
  for (const extra of [{}, { pick: 0 }, { typed: 52499 }]) {
    assert.equal(invoke('floorResult', cur(item, { sales: { cib: [{ title: 'Example Game complete', price: 52499 }] }, ...extra })).r.price, 50000);
  }
});

test('clean shelf rounding follows premiums and manual deductions without replacing their rules', () => {
  const premium = invoke('floorPrice', 15000, { premium: { phrase: 'Example', pct: 10 } });
  assert.equal(premium.premiumBasis, 16500); assert.equal(premium.price, 17000);
  const manual = invoke('floorPrice', 16500, { manualMissing: true });
  assert.equal(manual.ded, 2000); assert.equal(manual.beforeShelfRound, 14500); assert.equal(manual.price, 15000);
  assert.equal(invoke('floorPrice', 14500, { manualMissing: true }).price, 12500);
  const discount = invoke('floorPrice', 15000, { premium: { phrase: 'Example', pct: -20 } });
  assert.equal(discount.price, 12000);
});

test('Terminator rounds its raw amount once, including market clamps and manual selections', () => {
  for (const [basis, expected] of [[40200, 40000], [40217, 40000], [40499, 40000], [40500, 41000],
    [40600, 41000], [42200, 42000], [42250, 42500], [42750, 43000]]) {
    for (const opts of [{}, { referenceMin: basis, gs: basis }]) {
      const r = invoke('floorPrice', basis, opts);
      assert.equal(r.full, basis);
      assert.equal(r.beforeShelfRound, basis);
      assert.equal(r.price, expected);
      const math = invoke('floorMath', { from: 'sale', basis }, r);
      assert.equal((math.match(/rounded/g) || []).length, 1, math);
      assert.ok(!math.includes('to $5'), math);
    }
  }
  const product = { ...item, 'product-name': 'Terminator', 'console-name': 'Sega CD' };
  for (const extra of [{}, { pick: 0 }, { typed: 40217 }]) {
    assert.equal(invoke('floorResult', cur(product, { sales: { cib: [{ title: 'Terminator Sega CD CIB + reg card', price: 40217 }] }, ...extra })).r.price, 40000);
  }
  const premium = invoke('floorPrice', 36561, { premium: { phrase: 'Example', pct: 10 } });
  assert.equal(premium.premiumBasis, 40217); assert.equal(premium.price, 40000);
  const manual = invoke('floorPrice', 40217, { manualMissing: true });
  assert.equal(manual.ded, 4000); assert.equal(manual.beforeShelfRound, 36217); assert.equal(manual.price, 36000);
  assert.equal(invoke('floorPrice', 8100, { manualMissing: true }).price, 7000);
});
test('toy category detection uses figure catalogs and leaves same-named games alone', () => {
  for (const [system, family] of [['Skylanders', 'skylanders'], ['Disney Infinity', 'infinity'], ['Amiibo', 'amiibo'], ['Lego Dimensions', 'dimensions'], ['Starlink', 'starlink']]) {
    assert.equal(invoke('floorToyFamily', { 'console-name': system }), family);
  }
  for (const name of ['Skylanders Giants', 'Disney Infinity', 'Animal Crossing Amiibo Festival', 'Lego Dimensions', 'Starlink Battle for Atlas']) {
    assert.equal(invoke('floorToyFamily', { 'product-name': name, 'console-name': 'Wii U' }), null);
  }
});

test('toy rounding uses the 2-to-15-to-5 ladder and amiibo always uses 5s', () => {
  for (const [price, expected] of [[50, 200], [299, 200], [300, 400], [799, 800], [1200, 1200], [1399, 1400],
    [1449, 1400], [1450, 1500], [1499, 1500], [1500, 1500], [1699, 1500], [1750, 2000], [8500, 8500], [40217, 40000]]) {
    assert.equal(invoke('floorToyRound', price, 'skylanders'), expected, String(price));
  }
  for (const [price, expected] of [[200, 500], [600, 500], [750, 1000], [1200, 1000], [1250, 1500], [8500, 8500]]) {
    assert.equal(invoke('floorToyRound', price, 'amiibo'), expected);
  }
});

test('without verified Amazon, common Skylanders and Infinity retain the condition-specific average', () => {
  for (const system of ['Skylanders', 'Disney Infinity']) {
    const product = { ...item, 'product-name': 'Bash', 'console-name': system, 'loose-price': 320, 'cib-price': 1250, 'new-price': 1800, 'gamestop-price': 3000 };
    for (const [condition, expected] of [['loose', 400], ['cib', 1200], ['new', 2000]]) {
      const r = invoke('floorResult', cur(product, { condition, toyGroup: 'common', manualMissing: true,
        sales: { [condition]: [{ title: 'Bash', price: 4000 }] }, amazon: { found: false } }));
      assert.equal(r.b.from, 'toyaverage'); assert.equal(r.r.price, expected); assert.equal(r.r.ded, 0); assert.equal(r.shitbox, null);
    }
  }
});

test('uncommon figures use highest eligible sold evidence, preserving variant and outlier checks', () => {
  const product = { ...item, 'product-name': 'Bash', 'console-name': 'Skylanders', 'loose-price': 300, 'gamestop-price': 8000 };
  const r = invoke('floorResult', cur(product, { condition: 'loose', toyGroup: 'uncommon',
    sales: { loose: [{ title: 'Bash', price: 5000 }, { title: 'Bash Legendary', price: 9000 },
      ...[700, 800, 900, 1000].map((price) => ({ title: 'Bash', price }))] },
    amazon: { found: false } }));
  assert.equal(r.b.basis, 1000); assert.equal(r.r.price, 1000); assert.equal(r.b.from, 'sale');
  assert.ok(r.b.checks.some((s) => s.includes('outlier')));
});

test('verified Amazon switches common and uncommon figures to the normal three-source maximum', () => {
  for (const system of ['Skylanders', 'Disney Infinity']) {
    for (const toyGroup of ['common', 'uncommon']) {
      for (const [ebay, amazon, gs, expected, from] of [[2000, 3000, 2500, 3000, 'amazon'], [4000, 3000, 2500, 4000, 'sale'], [2000, 3000, 3500, 3500, 'gamestop']]) {
        const product = { ...item, 'product-name': 'Bash', 'console-name': system, 'loose-price': 600, 'gamestop-price': gs };
        const r = invoke('floorResult', cur(product, { condition: 'loose', toyGroup,
          sales: { loose: [{ title: 'Bash', price: ebay }] }, amazon: { found: true, offers: [{ price: 99900 }, { price: amazon }] } }));
        assert.equal(r.b.basis, expected); assert.equal(r.b.from, from); assert.equal(r.r.price, expected);
        assert.ok(r.b.checks.some((s) => s.includes('Verified Amazon offer')));
      }
    }
  }
});

test('wrong, unpriced, failed or missing Amazon matches retain the figure-only rule', () => {
  const product = { ...item, 'product-name': 'Bash', 'console-name': 'Skylanders', 'loose-price': 600, 'gamestop-price': 3000 };
  for (const amazon of [null, { found: false }, { found: true, offers: [] },
    { found: true, title: 'Bash Legendary', offers: [{ price: 5000 }] },
    { found: true, title: 'Bash 3-Pack', offers: [{ price: 5000 }] },
    { found: true, title: 'Bash French Version', offers: [{ price: 5000 }] },
    { found: true, title: '', offers: [{ price: 5000 }] },
    { found: true, offers: [{ price: 5000 }], error: 'Incomplete offer lookup' }]) {
    const r = invoke('floorResult', cur(product, { condition: 'loose', sales: { loose: [{ title: 'Bash', price: 2000 }] }, amazon }));
    assert.equal(r.b.from, 'toyaverage'); assert.equal(r.r.price, 600);
  }
});

test('figures wait for enabled Amazon checks before publishing either baseline', () => {
  const wasEnabled = run('amazonSet'); run('amazonSet = true');
  try {
    const product = { ...item, 'product-name': 'Bash', 'console-name': 'Skylanders', 'loose-price': 600 };
    for (const amazon of [null, { loading: true }, { found: true, loading: true, offers: [{ price: 3000 }] }]) {
      const r = invoke('floorResult', cur(product, { condition: 'loose', amazon, sales: { loose: [] } }));
      assert.equal(r.r, null); assert.equal(r.b.waiting, true);
    }
    assert.equal(invoke('floorResult', cur(product, { condition: 'loose', amazon: { found: false }, sales: { loose: [] } })).r.price, 600);
  } finally { run(`amazonSet = ${wasEnabled}`); }
});

test('Amazon figure baselines preserve rare minimums, premiums and toy rounding', () => {
  const rare = { ...item, 'product-name': 'Trigger Happy - Swap Force, Spring Time', 'console-name': 'Skylanders', 'new-price': 850 };
  const rareCur = cur(rare, { condition: 'new', sales: { new: [] }, amazon: { found: true, title: 'Springtime Trigger Happy', offers: [{ price: 1800 }] } });
  assert.equal(invoke('floorResult', rareCur).r.price, 2000);
  rareCur.amazon.offers = [{ price: 4299 }];
  assert.equal(invoke('floorResult', rareCur).r.price, 4500);
  const old = json('settings.floorPremiums');
  try {
    run('settings.floorPremiums = [{phrase:"Bash",pct:50}]');
    const p = { ...item, 'product-name': 'Bash', 'console-name': 'Skylanders', 'loose-price': 600 };
    const r = invoke('floorResult', cur(p, { condition: 'loose', sales: { loose: [] }, amazon: { found: true, offers: [{ price: 800 }] } }));
    assert.equal(r.b.basis, 800); assert.equal(r.r.price, 1200);
    run('settings.floorPremiums = [{phrase:"Bash",pct:-50}]');
    assert.equal(invoke('floorResult', cur(p, { condition: 'loose', sales: { loose: [] }, amazon: { found: true, offers: [{ price: 2000 }] } })).r.price, 1000);
  } finally { run(`settings.floorPremiums = ${JSON.stringify(old)}`); }
});

test('Skylanders and Infinity accept higher comparable sales while other categories stay strict', () => {
  for (const system of ['Skylanders', 'Disney Infinity', 'Amiibo', 'Lego Dimensions', 'Playstation 4']) {
    const relaxed = ['Skylanders', 'Disney Infinity'].includes(system);
    const product = { ...item, 'product-name': 'Example Figure', 'console-name': system, 'loose-price': 1500 };
    for (const prices of [[4000, 2000, 1900, 1800], [3200, 2600, 2000, 1900, 1800, 1700, 1600, 1500]]) {
      const example = cur(product, { condition: 'loose', sales: { loose: prices.map((price) => ({ title: 'Example Figure', price })) } });
      const r = invoke('floorResult', example);
      assert.equal(r.b.basis, relaxed ? prices[0] : prices[1], system);
      assert.equal(!!invoke('floorSales', example)[0].outlier, !relaxed, system);
    }
  }
});

test('relaxed toy outliers require 3x the next sale and a 25 dollar gap with three lower matches', () => {
  for (const system of ['Skylanders', 'Disney Infinity']) {
    const product = { ...item, 'product-name': 'Example Figure', 'console-name': system, 'loose-price': 1500 };
    for (const [prices, excluded] of [
      [[29999, 10000, 9000, 8000], false], [[30000, 10000, 9000, 8000], true],
      [[3499, 1000, 900, 800], false], [[3500, 1000, 900, 800], true],
      [[3500, 1000, 900], false], [[5000, 1000, 900, 800], true],
    ]) {
      const example = cur(product, { condition: 'loose', sales: { loose: prices.map((price) => ({ title: 'Example Figure', price })) } });
      assert.equal(!!invoke('floorSales', example)[0].outlier, excluded, `${system}: ${prices}`);
    }
  }
});

test('looser toy outliers do not change common averages, rare minimums or identity filtering', () => {
  const product = { ...item, 'product-name': 'Bash', 'console-name': 'Skylanders', 'loose-price': 600 };
  const sales = { loose: [{ title: 'Bash', price: 1600 }, { title: 'Bash', price: 1000 }, { title: 'Bash', price: 900 },
    { title: 'Bash', price: 800 }, { title: 'Bash Legendary', price: 9999 }, { title: 'Bash bundle', price: 8000 }] };
  assert.equal(invoke('floorResult', cur(product, { condition: 'loose', sales })).r.price, 600);
  const uncommon = invoke('floorResult', cur(product, { condition: 'loose', toyGroup: 'uncommon', sales }));
  assert.equal(uncommon.b.basis, 1600); assert.equal(uncommon.r.price, 1500);
  assert.equal(invoke('floorResult', cur(product, { condition: 'loose', toyGroup: 'rare', sales })).r.price, 2000);
});

test('Legendary and staff-classified rare Skylanders have a $20 floor and retain higher rounded prices', () => {
  for (const [name, toyGroup] of [['Trigger Happy - Legendary', undefined], ['Bash', 'rare']]) {
    const product = { ...item, 'product-name': name, 'console-name': 'Skylanders' };
    for (const [price, expected] of [[700, 2000], [1900, 2000], [2000, 2000], [2400, 2500], [8500, 8500]]) {
      const r = invoke('floorResult', cur(product, { condition: 'loose', toyGroup, sales: { loose: [{ title: name, price }] } }));
      assert.equal(r.r.price, expected); assert.equal(r.r.ded, 0);
    }
    assert.equal(invoke('floorResult', cur(product, { condition: 'loose', toyGroup, typed: 1000 })).r.price, 2000);
  }
  const product = { ...item, 'product-name': 'Trigger Happy - Legendary', 'console-name': 'Skylanders' };
  assert.equal(invoke('floorToyGroup', { product, toyGroup: 'common' }), 'rare');
});

test('unknown toy rarity and missing required sources ask for review instead of a made-up baseline', () => {
  const product = { ...item, 'product-name': 'Bash', 'console-name': 'Skylanders', 'cib-price': 0 };
  const unknown = invoke('floorResult', cur(product));
  assert.equal(unknown.r, null); assert.ok(unknown.b.need.includes('Choose Common'));
  assert.equal(invoke('floorResult', cur({ ...product, 'loose-price': 0 }, { condition: 'loose', toyGroup: 'common' })).r, null);
  assert.equal(invoke('floorResult', cur(product, { toyGroup: 'uncommon', sales: { cib: [] } })).r, null);
});

test('the 15 dollar cutoff applies to ordinary figures, while special Skylanders take priority', () => {
  for (const system of ['Skylanders', 'Disney Infinity']) {
    for (const name of ['Bash', 'Bash - Crystal']) {
      for (const [market, group, price] of [[1499, 'common', 1500], [1500, 'uncommon', 3000], [1501, 'uncommon', 3000]]) {
        const product = { ...item, 'product-name': name, 'console-name': system, 'loose-price': market };
        const example = cur(product, { condition: 'loose', toyGroup: 'auto', sales: { loose: [{ title: `${name} figure`, price: 3000 }] } });
        const rare = system === 'Skylanders' && name.includes('Crystal');
        assert.equal(invoke('floorToyGroup', example), rare ? 'rare' : group);
        assert.equal(invoke('floorResult', example).r.price, rare ? 3000 : price);
      }
    }
  }
  const product = { ...item, 'product-name': 'Bash - Crystal', 'console-name': 'Skylanders', 'loose-price': 0, 'new-price': 2000 };
  assert.equal(invoke('floorToyGroup', { product, condition: 'loose' }), 'rare');
  assert.equal(invoke('floorToyGroup', { product: { ...product, 'product-name': 'Bash' }, condition: 'loose' }), 'review');
  assert.equal(invoke('floorToyGroup', { product, condition: 'new' }), 'rare');
  assert.equal(invoke('floorToyGroup', { product, condition: 'new', toyGroup: 'common' }), 'rare');
});

test('rare finishes keep the 20 minimum and named figure variants do not mix', () => {
  for (const name of ['Trigger Happy - Legendary', 'Eye Brawl - Giants, Purple, Metallic', 'Bash - Gold', 'Bash - Chase']) {
    const product = { ...item, 'product-name': name, 'console-name': 'Skylanders', 'loose-price': 500 };
    const r = invoke('floorResult', cur(product, { condition: 'loose', toyGroup: 'auto', sales: { loose: [{ title: `${name} Skylanders figure`, price: 700 }] } }));
    assert.equal(r.toyGroup, 'rare'); assert.equal(r.r.price, 2000);
  }
  const product = { ...item, 'product-name': 'Bash', 'console-name': 'Skylanders' };
  for (const title of ['Skylanders Bash Legendary', 'Bash Skylanders Metallic', 'Bash Series 2 Skylanders']) {
    assert.ok(invoke('floorListingMismatch', title, product));
  }
  assert.equal(invoke('floorListingMismatch', 'Bash Skylanders Figure', product), null);
  assert.equal(invoke('floorListingMismatch', 'Bash Legendary Skylanders Legendary figure', { ...product, 'product-name': 'Bash - Legendary' }), null);
  assert.equal(invoke('floorToyVariant', { ...product, 'product-name': 'Golden Queen - Imaginators' }).rare, false);
});

test('amiibo preserves configured premiums but uses its own rounding and no manual deductions', () => {
  const product = { ...item, 'product-name': 'Pokemon Pikachu', 'console-name': 'Amiibo', 'gamestop-price': 0 };
  const r = invoke('floorResult', cur(product, { manualMissing: true, sales: { cib: [{ title: 'Pokemon Pikachu', price: 1500 }] } }));
  assert.equal(r.premium.pct, 10); assert.equal(r.r.premiumBasis, 1650); assert.equal(r.r.price, 1500); assert.equal(r.r.ded, 0);
  assert.ok(invoke('floorMath', r.b, r.r).includes('toys-to-life $5 step'));
});

test('figure group controls show the actual rule and carry the chosen group into the saved item', () => {
  const product = { ...item, id: '123', 'product-name': 'Bash', 'console-name': 'Skylanders', 'loose-price': 320 };
  context.toyControlCur = cur(product, { condition: 'loose', sales: { loose: [{ title: 'Bash', price: 900 }] } });
  run('floorCur = toyControlCur; renderFloorPricer();');
  assert.ok(element('#floorPricer').innerHTML.includes('Figure pricing group'));
  assert.ok(!element('#floorPricer').innerHTML.includes('Manual missing'));
  assert.ok(!element('#floorPricer').innerHTML.includes('The baseline is the highest'));
  invoke('onFloorPricerChange', { target: { dataset: { floorField: 'toyGroup' }, value: 'common' } });
  assert.equal(run('floorResult(floorCur).r.price'), 400);
  const oldItems = run('floor.items'), oldDirty = run('floor.dirty');
  run('floor.items = []; var toySavedRender = renderFloorList; renderFloorList = () => {};');
  try {
    run('addFloorItem();');
    const saved = json('floor.items[0]');
    assert.equal(saved.toyGroup, 'common'); assert.equal(saved.manualMissing, false); assert.equal(saved.price, 400);
    // This is the same persisted group supplied by the saved-list recheck.
    assert.equal(invoke('floorResult', { ...context.toyControlCur, toyGroup: saved.toyGroup }).r.price, 400);
    run('floor.items = []; floorCur = toyControlCur; floorCur.toyGroup = "auto"; addFloorItem();');
    const automatic = json('floor.items[0]');
    assert.equal(automatic.toyGroup, 'auto');
    assert.equal(invoke('floorToyGroup', { product: { ...product, 'loose-price': 1500 }, condition: 'loose', toyGroup: automatic.toyGroup }), 'uncommon');
  } finally {
    context.toyOldItems = oldItems; context.toyOldDirty = oldDirty;
    run('floor.items = toyOldItems; floor.dirty = toyOldDirty; renderFloorList = toySavedRender; floorCur = null;');
  }
});

test('CSV handles BOM, CRLF, embedded commas/newlines and escaped quotes', () => {
  const r = invoke('fulcrumCsv', '\uFEFFa,b\r\n"Game, \"\"Deluxe\"\"\nEdition",00123\r\n');
  assert.equal(r.rows[0].a, 'Game, "Deluxe"\nEdition'); assert.equal(r.rows[0].b, '00123');
});
test('CSV rejects malformed quoting, duplicate headers and broken rows', () => {
  for (const s of ['a,b\n"broken,1', 'a,a\n1,2', 'a,b\n1,2,3', 'a,b\n"x"bad,2']) assert.throws(() => invoke('fulcrumCsv', s));
});
test('imports reject duplicate stock codes and transaction numbers', () => {
  const row = '001,Example Game,Playstation 4,game,completeInBox,,1,20,15,19.99,25';
  assert.throws(() => invoke('fulcrumImport', `${stockHeader}\n${row}\n${row}`));
  assert.throws(() => invoke('fulcrumImport', `${txHeader}\n1,2026-10-01 12:00:00,Sale,20,1\n1,2026-10-01 12:00:00,Sale,20,1`));
});
test('evidence excludes trades, voids, zero subtotals and unverified headers', () => {
  const rows = [
    '1,2026-10-01 12:00:00,Sale,sale,Example Game,Playstation 4,game,completeInBox,,2,30',
    '2,2026-10-01 12:00:00,,trade,Example Game,Playstation 4,game,completeInBox,,1,0',
    '3,2026-10-01 12:00:00,,sale,Example Game,Playstation 4,game,completeInBox,,1,0',
    '4,2026-10-01 12:00:00,Sale,sale,Example Game,Playstation 4,game,completeInBox,,1,0',
    '5,2026-10-01 12:00:00,Sale,sale,Example Game,Playstation 4,game,completeInBox,,1,90',
    '6,2026-10-01 12:00:00,Return,return,Example Game,Playstation 4,game,completeInBox,,1,-20',
  ];
  context.testData = { stock: [], sales: invoke('fulcrumImport', `${lineHeader}\n${rows.join('\n')}`).rows,
    transactions: invoke('fulcrumImport', `${txHeader}\n1,2026-10-01 12:00:00,Sale,30,1\n2,2026-10-01 12:00:00,,0,1\n3,2026-10-01 12:00:00,,0,1\n4,2026-10-01 12:00:00,Sale,0,1\n6,2026-10-01 12:00:00,Return,-20,1`).rows };
  const r = json('(() => { const d = fulcrumEvidence(testData), g = [...d.groups.values()][0]; return { sales: g.sales, returns: g.returns, unmatched: d.unmatched }; })()');
  assert.equal(r.sales.length, 1); assert.equal(r.sales[0].price, 1500); assert.equal(r.sales[0].qty, 2);
  assert.equal(r.returns, 1); assert.equal(r.unmatched, 1);
});
test('quantity-weighted median and exact edition/region/manual matching', () => {
  assert.equal(invoke('fulcrumMedian', [{ price: 1500, qty: 3 }, { price: 3000, qty: 1 }]), 1500);
  const key = invoke('fulcrumKey', 'Pokemon Red', 'GameBoy', 'cib', false);
  assert.equal(key, invoke('fulcrumKey', 'Pokémon Red', 'GameBoy', 'cib', false));
  for (const [name, sys, manual] of [['Pokemon Red [Japan]', 'GameBoy', false], ['Pokemon Red', 'PAL GameBoy', false], ['Pokemon Red', 'GameBoy', true]]) {
    assert.notEqual(key, invoke('fulcrumKey', name, sys, 'cib', manual));
  }
  assert.equal(invoke('fulcrumGroupKey', { item_type: 'game', condition: 'cartWithManual' }), null);
});
test('transaction import discards customer and payment columns', () => {
  const r = invoke('fulcrumImport', `${txHeader},customer,paid_card\n1,2026-10-01 12:00:00,Sale,20,1,Private Person,20`);
  assert.equal('customer' in r.rows[0], false); assert.equal('paid_card' in r.rows[0], false);
});
test('unloaded sales remain missing instead of appearing as zero sales', () => {
  context.stockOnly = invoke('fulcrumImport', `${stockHeader}\n001,Example Game,Playstation 4,game,completeInBox,,1,40,15,19.99,25`).rows;
  run('Object.assign(fulcrum, { stock: stockOnly, sales: null, transactions: null }); fulcrumData = fulcrumEvidence(); renderFulcrum();');
  assert.ok(element('#fulcrumReview').innerHTML.includes('Not loaded'));
  assert.ok(invoke('fulcrumReference', cur(), 2000).includes('Sales line items not loaded'));
  run('clearFulcrum();');
  assert.equal(run('fulcrumData'), null);
});
test('review-title click keeps search open through document event bubbling', () => {
  run('Object.assign(fulcrum, { stock: stockOnly }); fulcrumData = fulcrumEvidence(); wireFloor();');
  const key = invoke('fulcrumKey', 'Example Game', 'Playstation 4', 'cib', false);
  const button = { dataset: { fulcrumKey: key } };
  const event = { target: { closest(selector) { return selector.includes('[data-fulcrum-key]') ? button : null; } } };
  run('const originalPcSearch = PC.search; PC.search = () => new Promise(() => {});');
  element('#fulcrumReview').listeners.click(event);
  const startedSeq = run('floorSearch.seq');
  for (const entry of context.document.listeners) if (entry.type === 'click') entry.handler(event);
  assert.equal(element('#floorScan').value, 'Example Game Playstation 4');
  assert.equal(element('#floorResults').hidden, false);
  assert.equal(run('floorSearch.loading'), true);
  assert.equal(run('floorSearch.seq'), startedSeq);
  // Ordinary outside clicks must still dismiss the search results.
  for (const entry of context.document.listeners) if (entry.type === 'click') entry.handler({ target: { closest: () => null } });
  assert.equal(element('#floorResults').hidden, true);
  run('PC.search = originalPcSearch; clearFulcrum();');
});

const exportPaths = process.argv.slice(2);
if (exportPaths.length) {
  assert.equal(exportPaths.length, 3, 'Supply stock, sales line items, and transactions exports');
  for (const p of exportPaths) { const parsed = invoke('fulcrumImport', fs.readFileSync(p, 'utf8')); context[parsed.kind] = parsed.rows; }
  run('Object.assign(fulcrum, { stock, sales, transactions }); fulcrumData = fulcrumEvidence(); renderFulcrum();');
  const summary = json(`(() => {
    const groups = [...fulcrumData.groups.values()];
    return { stockRows: stock.length, lineRows: sales.length, transactionRows: transactions.length,
      eligibleGameUnitsSold: groups.reduce((n, g) => n + g.sales.reduce((s, r) => s + r.qty, 0), 0),
      unmatchedHeaders: fulcrumData.unmatched, excludedLines: fulcrumData.excluded,
      soldFrom: fulcrumData.from, soldTo: fulcrumData.to };
  })()`);
  console.log('Export analysis:', JSON.stringify(summary));
  console.log(element('#fulcrumReview').innerHTML.match(/<p[^>]*>(.*?)<\/p>/)?.[1]);
  assert.equal(summary.unmatchedHeaders, 0);
  assert.ok(summary.eligibleGameUnitsSold > 0);
  test('actual exports import, reconcile headers, and render the review queue', () => {});
}
console.log(`${checks} checks passed.`);
