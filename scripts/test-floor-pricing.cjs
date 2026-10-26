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
const context = vm.createContext({ console, Date, URL, setTimeout, clearTimeout, crypto: require('node:crypto').webcrypto,
  window: { addEventListener() {} },
  localStorage: { getItem: () => null, setItem: () => {} },
  document: { querySelector: element, listeners: [], addEventListener(type, handler) { this.listeners.push({ type, handler }); } },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../trade-in/dead-games.js'), 'utf8'), context);
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
  if (result.amazon?.found) result.amazon = { title: product['product-name'], ...result.amazon,
    offers: result.amazon.offers?.map(o => ({ sub: result.condition === 'loose' ? 'good' : 'very_good', ...o })) };
  return result;
};

test('loose PSP games use normal trade offers while other disc-only tiers stay intact', () => {
  const settings = json('DEFAULT_SETTINGS');
  const line = { source: 'pc', category: 'game', name: 'LocoRoco', platform: 'PSP', condition: 'loose',
    prices: { 'loose-price': 1500, 'retail-loose-buy': 1000, 'cib-price': 1500, 'retail-cib-buy': 1200 }, deductions: [] };
  for (const platform of ['PSP', 'PAL PSP', 'JP PSP']) {
    for (const value of [500, 1000, 2000, 2500]) {
      const psp = { ...line, platform, prices: { ...line.prices, 'loose-price': value } };
      const price = invoke('priceLine', psp, settings);
      assert.equal(price.guide, null); assert.equal(price.flat, false);
      assert.equal(price.cash, 700); assert.equal(price.credit, 1050);
    }
    assert.equal(invoke('guideCheck', { ...line, platform, name: 'Madden NFL 07' }, settings), null);
  }
  for (const platform of ['Playstation', 'Playstation 2', 'Playstation 4', 'Xbox 360', 'Gamecube', 'Wii', 'Sega CD', 'PAL Playstation 2']) {
    for (const [value, flat] of [[500, 50], [1000, 100], [2000, 100]]) {
      const price = invoke('priceLine', { ...line, platform, prices: { ...line.prices, 'loose-price': value } }, settings);
      assert.equal(price.cash, flat); assert.equal(price.credit, flat); assert.equal(price.guide.outlier, true);
    }
    assert.equal(invoke('guideCheck', { ...line, platform, name: 'Madden NFL 07' }, settings).flat, 10);
  }
  assert.equal(invoke('priceLine', { ...line, condition: 'cib' }, settings).cash, 840);
  assert.equal(invoke('guideCheck', { ...line, name: 'Madden NFL 07', condition: 'cib' }, settings).flat, 25);
});

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

test('CIB disc, case and manual combinations are ordinary contents, including the Alice screenshot', () => {
  const product = { ...item, 'product-name': 'Alice: Madness Returns', 'console-name': 'Playstation 3' };
  const title = 'Alice: Madness Returns PlayStation 3 PS3 Complete Disc + Case + Manual';
  for (const listing of [title,
    'Alice Madness Returns PS3 Complete Case + Manual + Game Disc',
    'Alice Madness Returns PS3 CIB Disc + Original Jewel Case + Instruction Booklet',
    'Alice Madness Returns PS3 Complete Manual + Box + Disc',
    'Alice Madness Returns PS3 Complete Disc plus Case and Manual']) {
    assert.equal(invoke('floorListingMismatch', listing, product), null, listing);
    assert.equal(invoke('floorSales', cur(product, { sales: { cib: [{ title: listing, price: 13995 }] } }))[0].odd, false, listing);
    assert.equal(invoke('floorAmazonLowest', cur(product, { amazon: { found: true, title: listing, offers: [{ price: 13995 }] } })), 13995, listing);
  }
  const example = cur(product, { sales: { cib: [{ title, price: 13995 }, { title: 'Alice Madness Returns PS3 CIB', price: 12800 }] },
    amazon: { found: true, title: 'Alice Madness Returns PS3', offers: [{ price: 12898 }] } });
  assert.equal(invoke('floorResult', example).b.basis, 13995);
  assert.equal(invoke('floorResult', example).r.price, 14000);
  for (const extra of [' + Another Game', ' + Controller', ' + Bonus Disc', ' + Soundtrack', ' + Figurine', ' + Steelbook', ' French Version', ' Special Edition'])
    assert.ok(invoke('floorListingMismatch', title + extra, product), extra);
  for (const incomplete of ['Case + Manual Only', 'Disc Only + Case, No Manual'])
    assert.equal(invoke('floorSales', cur(product, { sales: { cib: [{ title: 'Alice Madness Returns PS3 ' + incomplete, price: 13995 }] } }))[0].odd, true, incomplete);
  assert.ok(invoke('floorListingMismatch', 'Skylanders Trigger Happy + Game Disc', { 'product-name': 'Trigger Happy', 'console-name': 'Skylanders' }), 'A game disc bundled with a figure is still an extra');
  assert.ok(invoke('floorListingMismatch', 'Nintendo Switch Console + Game Cartridge', { 'product-name': 'Nintendo Switch Console', 'console-name': 'Nintendo Switch', genre: 'Systems' }), 'A game bundled with hardware is still an extra');
});

test('boxed games cannot drive loose pricing, including the Splatterhouse 3 screenshot', () => {
  const product = { 'product-name': 'Splatterhouse 3', 'console-name': 'Sega Genesis', 'loose-price': 8000, 'gamestop-price': 9499 };
  const boxed = 'Splatterhouse 3 Sega Genesis Authentic Cartridge And Box- Tested+works';
  const example = cur(product, { condition: 'loose', gamestopStock: { state: 'out', title: 'Splatterhouse 3 Sega Genesis' }, sales: { loose: [
    { title: boxed + ' See Proof', price: 17999 }, { title: boxed, price: 14500 },
    ...[11999, 10999].map(price => ({ title: 'Splatterhouse 3 Sega Genesis 1993 Authentic Game Cartridge Tested Working!', price })),
    { title: 'Splatterhouse 3 (Sega Genesis, 1993)', price: 10500 },
  ] } });
  const rows = invoke('floorSales', example);
  assert.ok(rows.slice(0, 2).every(row => row.odd && row.mismatch === 'Box/manual included — not loose' && !row.outlier));
  assert.ok(rows.slice(2).every(row => !row.odd));
  assert.equal(invoke('floorResult', example).b.basis, 11999);
  assert.equal(invoke('floorResult', example).r.price, 12000);
  for (const suffix of ['Cartridge And Box', 'Cart & Original Box', 'Cartridge + Box', 'Game w/Box', 'Game with original case',
    'Boxed No Manual', 'Complete In Box', 'CIB', 'C.I.B.', 'Disc + Case + Manual', 'Cartridge with instruction booklet']) {
    const title = 'Splatterhouse 3 ' + suffix;
    assert.equal(invoke('floorOdd', { title }, 'loose', null, product), true, title);
    assert.equal(invoke('floorOdd', { title }, 'cib', null, product), false, title);
  }
  for (const suffix of ['Cartridge Only', 'Cartridge No Box', 'Cart without original box or manual', 'Loose no box/manual',
    'Cartridge Box and Manual Not Included', 'Game only box missing', 'Cartridge no case no manual', 'Cartridge Tested Working'])
    assert.equal(invoke('floorOdd', { title: 'Splatterhouse 3 ' + suffix }, 'loose', null, product), false, suffix);
  assert.equal(invoke('floorOdd', { title: 'Splatterhouse 3 No Manual With Original Box' }, 'loose', null, product), true);
  for (const name of ['The Orange Box', 'LEGO Star Wars The Complete Saga'])
    assert.equal(invoke('floorOdd', { title: name + ' Disc Only Tested' }, 'loose', null, { ...item, 'product-name': name }), false, name);
  // Amazon's used catalog remains shared by Loose/CIB; explicit sale packaging does not redefine it.
  assert.equal(invoke('floorAmazonLowest', cur(product, { condition: 'loose', amazon: { found: true, title: boxed, offers: [{ price: 13000 }] } })), 13000);
  const ebaySale = { title: 'Splatterhouse 3', price: 14500, url: 'https://www.ebay.com/itm/123456789012' };
  assert.equal(invoke('floorEbayResult', ebaySale, product, { id: '123456789012', title: boxed, state: 'sold', price: 14500 }, 'loose').state, 'mismatch');
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

test('named collections cannot raise the standard game price, including the Valor screenshot', () => {
  const product = { ...item, 'product-name': 'Call of Duty WWII', 'console-name': 'Playstation 4', 'gamestop-price': 999 };
  const titles = [
    'Call of Duty WWII Valor Collection Valor Great Condition PS4 Playstation 4',
    'Call of Duty WWII Valor Collection Valor Great Condition PS4 Statue',
    'Call of Duty WWII VALOR Collection WW2 Ps4 ArmyPatches Cod Zombies Used Game',
    'Call of Duty: WWII Valor Collection PS4',
    'Call of Duty: WWII WW2 Valor Collection (Sony Playstation 4, 2017) Open Box +',
    'Call of Duty WWII Valor Collection (PS4 PlayStation 4) - CIB Complete, Very good',
    'Call of Duty WWII Valor Collection PS4 Statue WWII with Bloodraven Sword Pin',
    'Call of Duty WWII Unknown Named Collection PS4',
  ];
  const example = cur(product, { sales: { cib: [...titles.map(title => ({ title, price: 10000 })),
    { title: 'Call of Duty WWII PS4 CIB', price: 1200 }] },
    amazon: { found: true, title: titles[0], offers: [{ price: 15000 }] } });
  assert.equal(invoke('floorResult', example).b.basis, 1200);
  assert.equal(invoke('floorResult', example).r.price, 1500);
  assert.equal(invoke('floorAmazonLowest', example), null);
  assert.equal(invoke('floorEstimate', { ...example, salesLoading: true }).price, 1500);
  for (const title of titles) assert.ok(invoke('floorListingMismatch', title, product), title);
  const valor = { ...product, 'product-name': 'Call of Duty WWII [Valor Collection]' };
  assert.equal(invoke('floorListingMismatch', titles[0], valor), null);
  for (const title of ['Call of Duty WWII PS4 CIB', 'Call of Duty WWII Other Collection PS4'])
    assert.ok(invoke('floorListingMismatch', title, valor), title);
  for (const suffix of ['from my collection', 'from my personal collection', 'personal collection', 'add to your collection'])
    assert.equal(invoke('floorListingMismatch', 'Call of Duty WWII PS4 CIB ' + suffix, product), null, suffix);
  assert.ok(invoke('floorListingMismatch', titles[0] + ' from my personal collection', product));
  for (const name of ['Halo Master Chief Collection', 'Sonic Mega Collection Plus', 'Castlevania Anniversary Collection'])
    assert.equal(invoke('floorListingMismatch', name + ' PS4 CIB', { ...product, 'product-name': name }), null, name);
  const savedPremiums = run('settings.floorPremiums');
  run('settings.floorPremiums=[{phrase:"Call of Duty WWII",pct:20}]');
  assert.equal(invoke('floorResult', example).r.price, 1500, '1200 + 20% rounds once to 1500');
  assert.equal(invoke('floorResult', cur(valor, { sales: { cib: [{ title: titles[0], price: 10000 }] } })).r.price, 12000);
  context.savedCollectionTestPremiums = savedPremiums;
  run('settings.floorPremiums=savedCollectionTestPremiums');
});

test('GBA Link to the Past includes Four Swords without treating it as a sequel or bundle', () => {
  const product = { ...item, 'product-name': 'Zelda Link to the Past', 'console-name': 'GameBoy Advance' };
  const titles = [
    'Legend of Zelda: A Link to the Past/Four Swords GBA',
    'The Legend of Zelda: A Link to the Past Four Swords Gameboy Advance Game Tested',
    'Legend of Zelda: A Link to the Past Four Swords (Game Boy Advance) GBA TESTED',
    'The Legend of Zelda A Link to the Past/Four Swords GameBoy Advance - Tested',
    'Zelda A Link to the Past + Four Swords GBA cartridge only',
    'Zelda Link to the Past & 4 Swords Nintendo Game Boy Advance',
    'Zelda Link to the Past and Four Swords GBA',
  ];
  for (const title of titles) {
    const example = cur(product, { condition: 'loose', sales: { loose: [{ title, price: 5939 }] } });
    assert.equal(invoke('floorListingMismatch', title, product), null, title);
    assert.equal(invoke('floorSales', example)[0].odd, false, title);
    assert.equal(invoke('floorResult', example).b.basis, 5939, title);
    assert.equal(invoke('floorAmazonCandidateMismatch', { title, platforms: ['GameBoy Advance'] }, product, 'loose', true), null, title);
  }
  const manual = 'Zelda A Link to the Past Four Swords GBA Game Boy Advance & Manual Tested';
  assert.equal(invoke('floorListingMismatch', manual, product), null);
  assert.ok(invoke('floorLoosePackagingMismatch', manual, 'loose', product), 'included manual is still not a loose comp');
  for (const title of [
    'Zelda Four Swords Adventures GameCube', 'Zelda Four Swords GBA',
    'Zelda Link to the Past Four Swords Adventures GBA',
    'Zelda Link to the Past + Four Swords + Minish Cap GBA',
    'Zelda Link to the Past Four Swords Players Choice GBA',
    'Zelda Link to the Past Four Swords French Version GBA',
    'Zelda Link to the Past Four Swords Super Nintendo',
  ]) assert.ok(invoke('floorListingMismatch', title, product), title);
  assert.ok(invoke('floorListingMismatch', titles[0], { ...product, 'console-name': 'Super Nintendo' }), 'alias is GBA-specific');
  assert.equal(invoke('floorListingMismatch', titles[0], { ...product, 'product-name': 'Zelda Link to the Past & Four Swords' }), null);
  assert.equal(invoke('floorAmazonPlatformConfirmed', { title: titles[0] }, product), true, 'GBA abbreviation confirms platform');
  const renewed = cur(product, { condition: 'loose', sales: { loose: [{ title: titles[0], price: 5939 }] },
    amazon: { found: true, renewedFallback: true, title: 'The Legend of Zelda: A Link to the Past (Includes Four Swords Adventure) (Renewed)', offers: [{ price: 6399 }] } });
  assert.equal(invoke('floorResult', renewed).b.basis, 6399);
  assert.equal(invoke('floorResult', renewed).r.price, 6500, 'existing Renewed and rounding rules remain unchanged');
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

test('helper status reports installed versions and capability readiness without claiming absent means uninstalled', () => {
  assert.equal(invoke('floorHelperStatusInfo', null).text, 'Not connected');
  const capability = { available: true, protocol: 2, targeted: 1 };
  for (const version of ['1.1.5', '1.1.6', '1.1.10', '1.2.0', '2.0.0']) {
    const status = invoke('floorHelperStatusInfo', { ...capability, version });
    assert.equal(status.state, 'connected'); assert.equal(status.text, `Connected · v${version}`);
  }
  for (const version of ['1.1.3', '1.1.4', '1.0.99', undefined, '<script>']) {
    const status = invoke('floorHelperStatusInfo', { ...capability, version });
    assert.equal(status.state, 'update'); assert.ok(status.text.includes('Update needed'));
    assert.ok(!status.text.includes('<script>'));
  }
  assert.equal(invoke('floorHelperStatusInfo', { ...capability, version: '1.1.5', targeted: 0 }).state, 'update');
  assert.equal(invoke('floorHelperStatusInfo', { ...capability, version: '1.1.5', protocol: 1 }).state, 'update');
});

test('numbered sequel pairs are bundles for single games on both eBay and Amazon', () => {
  const product = { ...item, 'product-name': 'Kingdom Hearts', 'console-name': 'Playstation 2' };
  for (const title of ['Kingdom Hearts 1 & 2 (I & II) PS2 - Sony PlayStation 2, 2005 Greatest Hits CIB',
    'Kingdom Hearts I + II PS2 CIB', 'Kingdom Hearts 1 and 2 PS2 Complete',
    'Kingdom Hearts I/II PS2', 'Kingdom Hearts 1, 2 Playstation 2']) {
    assert.equal(invoke('floorListingMismatch', title, product), 'Multiple-game lot or bundle', title);
    assert.equal(invoke('floorAmazonMismatch', { product, condition: 'cib', amazon: { found: true, title, offers: [{ price: 9999 }] } }), 'Multiple-game lot or bundle', title);
    assert.equal(invoke('floorListingMismatch', title, { ...product, 'product-name': 'Kingdom Hearts 2' }), 'Multiple-game lot or bundle');
  }
  for (const [name, title] of [['God of War', 'God of War 1 & 2 PS2 CIB'], ['God of War II', 'God of War I and II PS2'],
    ['Star Wars Battlefront', 'Star Wars Battlefront 1/2 PS2']]) {
    assert.equal(invoke('floorListingMismatch', title, { ...product, 'product-name': name }), 'Multiple-game lot or bundle');
  }
  for (const title of ['Kingdom Hearts PS2 compatible PS1 & PS2', 'Kingdom Hearts PS2 discs 1 & 2',
    'Black Label Kingdom Hearts PlayStation 2 PS2 Complete CIB w/ Reg Card']) {
    assert.equal(invoke('floorNumberedGameBundle', title, product), false, title);
  }
  assert.equal(invoke('floorListingMismatch', 'Kingdom Hearts 1 & 2 PS2 CIB', { ...product, 'product-name': 'Kingdom Hearts 1 & 2' }), null);
  assert.equal(invoke('floorListingMismatch', 'Final Fantasy X/X-2 HD Remaster PS4', { ...item, 'product-name': 'Final Fantasy X/X-2 HD Remaster' }), null);
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
  assert.equal(result.b.from, 'sale'); assert.equal(result.b.basis, 5200); assert.equal(result.r.price, 5500);
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
test('games with sold evidence and a $500+ reference use sales instead of regular or Renewed Amazon', () => {
  for (const name of ['Rule of Rose', 'Haunting Ground']) {
    const product = { ...item, 'product-name': name, 'console-name': 'Playstation 2' };
    for (const price of [49999, 50000, 130000]) {
      for (const renewedFallback of [false, true]) {
        const result = invoke('floorResult', cur(product, { sales: { cib: [{ title: `${name} complete`, price }] },
          amazon: { found: true, offers: [{ price: 170000 }], renewedFallback } }));
        assert.equal(result.b.expensiveGameBasis, true);
        assert.equal(result.b.basis, price);
        assert.equal(result.r.price, price === 49999 ? 50000 : price);
        assert.equal(result.b.referenceMin, price);
        assert.equal(result.b.renewedReference, false);
      }
    }
  }
});

test('Mega Man 7 uses $450 sold when Amazon is $700 and switches at the raw $500 Amazon boundary', () => {
  const product = { ...item, 'product-name': 'Mega Man 7', 'console-name': 'Super Nintendo' };
  for (const [amazonPrice, expected] of [[49999, 49999], [50000, 45000], [70000, 45000]]) {
    const result = invoke('floorResult', cur(product, { sales: { cib: [{ title: 'Mega Man 7 SNES complete', price: 45000 }] },
      amazon: { found: true, offers: [{ price: amazonPrice }, { price: 170000 }] } }));
    assert.equal(result.b.basis, expected);
    if (amazonPrice >= 50000) assert.equal(result.r.price, 45000);
  }
});

test('high-value games retain GameStop floors, specific premiums, manual deductions and one final rounding', () => {
  const product = { ...item, 'gamestop-price': 60000 };
  const example = cur(product, { sales: { cib: [{ title: 'Example Game complete', price: 57500 }] },
    amazon: { found: true, offers: [{ price: 170000 }] } });
  assert.equal(invoke('floorResult', example).r.price, 60000);
  const old = json('settings.floorPremiums');
  try {
    context.highGamePremiums = [{ phrase: 'Example Game', pct: 10 }];
    run('settings.floorPremiums = highGamePremiums');
    assert.equal(invoke('floorResult', example).r.price, 65000);
    context.highGamePremiums = [{ phrase: 'Example Game', pct: -10 }];
    run('settings.floorPremiums = highGamePremiums');
    assert.equal(invoke('floorResult', example).r.price, 55000);
  } finally { context.restorePremiums = old; run('settings.floorPremiums = restorePremiums'); }
  const missing = invoke('floorResult', { ...example, manualMissing: true });
  assert.equal(missing.r.ded, 6000); assert.equal(missing.r.price, 55000);
  assert.equal(invoke('floorResult', { ...example, typed: 52500 }).r.price, 55000);
});

test('high-value game threshold needs a valid sale, ignores catalog averages and excludes hardware and figures', () => {
  const amazon = { found: true, offers: [{ price: 170000 }] };
  const product = { ...item, 'cib-price': 130000 };
  for (const sales of [{ cib: [] }, { cib: [{ title: 'Example Game Special Edition complete', price: 130000 }] }]) {
    const result = invoke('floorResult', cur(product, { sales, amazon }));
    assert.equal(!!result.b.expensiveGameBasis, false); assert.equal(result.b.basis, 170000);
  }
  for (const sales of [{ cib: [{ title: 'Example Game complete', price: 40000 }] },
    { cib: [130000, 40000, 39000, 38000].map((price) => ({ title: 'Example Game complete', price })) }]) {
    const lowAmazon = invoke('floorResult', cur(product, { sales, amazon: { found: true, offers: [{ price: 49999 }] } }));
    assert.equal(lowAmazon.b.expensiveGameBasis, false); assert.equal(lowAmazon.b.basis, 49999);
    const highAmazon = invoke('floorResult', cur(product, { sales, amazon }));
    assert.equal(highAmazon.b.expensiveGameBasis, true); assert.equal(highAmazon.b.basis, 40000);
  }
  for (const p of [{ ...item, 'product-name': 'Playstation 5 Console', 'console-name': 'Playstation 5', genre: 'Systems' },
    { ...item, 'product-name': 'Bash - Legendary', 'console-name': 'Skylanders' }]) {
    const result = invoke('floorResult', cur(p, { sales: { cib: [{ title: `${p['product-name']} complete`, price: 60000 }] }, amazon }));
    assert.equal(!!result.b.expensiveGameBasis, false); assert.equal(result.b.basis, 170000);
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

test('Kingdom Hearts uses the general gap rule while bundles and failed sold checks stay excluded', () => {
  const product = { ...item, 'product-name': 'Kingdom Hearts', 'console-name': 'Playstation 2', 'gamestop-price': 999 };
  const example = highSaleCur([3495, 2600, 2495, 2399, 2000, 1900, 1800, 1700, 1600, 1500], product,
    { amazon: { found: true, title: 'Kingdom Hearts PS2 (Renewed)', renewedFallback: true, offers: [{ price: 1548 }] } });
  example.sales.cib[0] = { price: 3495, title: 'Black Label Kingdom Hearts PlayStation 2 PS2 Complete CIB w/ Reg Card', url: 'https://www.ebay.com/itm/111111111111' };
  example.sales.cib.push({ price: 9999, title: 'Kingdom Hearts 1 & 2 PS2 CIB' });
  const result = invoke('floorResult', example);
  assert.equal(result.b.basis, 3495); assert.equal(result.r.price, 3500);
  assert.equal(invoke('floorSales', example).find(s => s.price === 3495).outlier, undefined);
  assert.ok(!result.b.checks.some(s => s.includes('Kingdom Hearts PS2')));
  assert.equal(invoke('floorEbayCandidates', example, 1)[0].sale.price, 3495, 'Highest sale still gets verified');
  example.sales.cib[0].price = 10000;
  assert.equal(invoke('floorResult', example).b.basis, 2600, 'Kingdom Hearts has no exception for an extreme spike');
  example.sales.cib[0].price = 3495;
  for (const state of ['ended', 'offer', 'mismatch', 'price']) {
    example.ebayChecks = { results: { '111111111111': { state } } };
    assert.equal(invoke('floorResult', example).b.basis, 2600, state);
  }
  example.ebayChecks = { results: { '111111111111': { state: 'unknown', skipped: true, price: 3495 } } };
  assert.equal(invoke('floorResult', example).b.basis, 2600);
  assert.equal(invoke('floorResult', example).b.ebayReview, true);
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

test('Killzone distribution keeps $16 supported by $13 without a broad cluster exclusion', () => {
  // Public PriceCharting CIB table, fetched Oct 17, 2026; the $1.50 Greatest Hits edition is omitted.
  const prices = [300, 750, 598, 1237, 601, 899, 999, 554, 799, 750, 900, 240, 1299, 1179,
    700, 399, 528, 1600, 499, 883, 444, 799, 695, 729, 500, 574, 995, 971, 1300];
  const product = { ...item, 'product-name': 'Killzone Shadow Fall', 'gamestop-price': 999 };
  const example = highSaleCur(prices, product, { amazon: { found: true, lowest: 1000, offers: [{ price: 1000 }] } });
  const result = invoke('floorResult', example);
  assert.equal(result.b.basis, 1600); assert.equal(result.r.price, 1500);
  assert.ok(!invoke('floorSales', example).some(s => s.outlier));
  assert.equal(invoke('floorResult', { ...example, pick: prices.indexOf(1600) }).r.price, 1500);
  // A second nearby high sale supports the high price rather than being discarded recursively.
  example.sales.cib.push({ price: 1550, title: 'Killzone Shadow Fall complete' });
  assert.equal(invoke('floorResult', example).b.basis, 1600);
  assert.equal(invoke('floorResult', example).r.price, 1500);
});

test('a cheaper sales cluster cannot exclude a supported high sale for any title', () => {
  for (const [prices, expected] of [
    [[1600, 1300, 1000, 1000, 999, 950, 900], 1600],
    [[1600, 1300, 1000, 1000, 999, 950, 900, 800], 1600],
    [[1600, 1400, 1000, 1000, 999, 950, 900, 800], 1600],
    [[1400, 1150, 1000, 1000, 999, 950, 900, 800], 1400],
    [[1200, 950, 800, 800, 799, 750, 700, 600], 1200],
    [[3495, 2600, 2495, 2399, 2000, 1900, 1800, 1700, 1600, 1500], 3495],
    [[8000, 6000, 4000, 3000, 2999, 2900, 2800, 2700], 8000],
    [[20000, 6000, 4000, 3000, 2999, 2900, 2800, 2700], 6000],
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
    assert.equal(r.b.from, 'sale'); assert.equal(r.b.basis, 5200); assert.equal(r.r.price, 5500);
    // Clicking a lower sale cannot undercut the highest valid sale; typed prices are explicit overrides.
    assert.equal(invoke('floorResult', cur(product, { sales, pick: 1 })).r.price, 5500);
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
  assert.equal(one.r.price, 5500); assert.ok(one.b.checks.some((s) => s.includes('Only 1')));
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

test('Kingdom Hearts uses its higher eligible sale over Renewed and retains eBay verification', () => {
  const product = { 'product-name': 'Kingdom Hearts', 'console-name': 'Playstation 2', 'cib-price': 1915, 'gamestop-price': 999 };
  const example = cur(product, { sales: { cib: [
    { title: 'Kingdom Hearts PS2 Complete', price: 2600, url: 'https://www.ebay.com/itm/111111111111' },
    { title: 'Kingdom Hearts PS2 CIB Complete', price: 2495, url: 'https://www.ebay.com/itm/222222222222' },
    { title: 'Kingdom Hearts PS2 CIB Complete Tested', price: 2399, url: 'https://www.ebay.com/itm/333333333333' }
  ] }, ebayChecks: { results: { '111111111111': { state: 'unknown', price: 2600, skipped: true } } },
  amazon: { found: true, title: 'Kingdom Hearts PS2 (Renewed)', renewedFallback: true, offers: [{ price: 1548 }] } });
  const r = invoke('floorResult', example);
  assert.equal(r.b.from, 'sale'); assert.equal(r.b.basis, 2495); assert.equal(r.r.price, 2500);
  assert.equal(invoke('floorEbayCandidates', example, 1)[0].sale.price, 2495, 'Renewed cannot stop checks of the higher sale');
  assert.equal(r.b.ebayReview, true, 'Skipped higher evidence still needs review');
  example.ebayChecks.results['222222222222'] = { state: 'ended' };
  assert.equal(invoke('floorResult', example).b.basis, 2399, 'Rejected listings stay excluded');
  example.amazon.offers[0].price = 3000;
  assert.equal(invoke('floorResult', example).b.from, 'amazon');
  assert.equal(invoke('floorResult', example).r.price, 3000, 'Renewed can win when it is actually highest');
});

test('confirmed out-of-stock GameStop is reference-only across regular, Renewed and high-value pricing', () => {
  const product = { ...item, 'gamestop-price': 10000 };
  const example = cur(product, { sales: { cib: [{ title: 'Example Game complete', price: 5000 }] },
    amazon: { found: true, offers: [{ price: 7000 }] } });
  for (const state of ['in', 'unknown', undefined]) {
    assert.equal(invoke('floorResult', { ...example, gamestopStock: { state, title: 'Example Game' } }).r.price, 10000);
  }
  const out = { ...example, gamestopStock: { state: 'out', title: 'Example Game' } };
  const r = invoke('floorResult', out);
  assert.equal(r.b.basis, 7000); assert.equal(r.b.referenceMin, 7000); assert.equal(r.r.price, 7000);
  assert.ok(r.b.checks.some(s => s.includes('confirmed out of stock')));
  assert.equal(invoke('floorResult', { ...out, amazon: { error: 'Rate limited' } }).r.price, 5000);
  assert.equal(invoke('floorResult', { ...out, amazon: { ...example.amazon, renewedFallback: true } }).r.price, 7000);
  assert.equal(invoke('floorResult', { ...out, product: { ...product, 'gamestop-price': 170000 }, sales: { cib: [{ title: 'Example Game complete', price: 60000 }] } }).r.price, 60000);
  assert.equal(invoke('floorResult', { ...out, gamestopStock: { state: 'out', title: 'Another Game PS4' } }).r.price, 10000);
  assert.equal(invoke('floorResult', { ...out, gamestopStock: { state: 'out' } }).r.price, 10000);
});

test('out-of-stock exclusion preserves premiums, discounts, deductions and pending-stock safeguards', () => {
  const product = { ...item, 'product-name': 'Pokemon Shield', 'console-name': 'Nintendo Switch', 'gamestop-price': 10000 };
  const example = cur(product, { sales: { cib: [{ title: 'Pokemon Shield complete', price: 5000 }] },
    amazon: { found: true, offers: [{ price: 7000 }] }, gamestopStock: { state: 'out', title: 'Pokemon Shield Nintendo Switch' } });
  const r = invoke('floorResult', example);
  assert.equal(r.b.basis, 7000); assert.equal(r.premium.pct, 10); assert.equal(r.r.price, 8000);
  const pending = invoke('floorResult', { ...example, gamestopStock: { state: 'loading' } });
  assert.equal(pending.b.waiting, true); assert.equal(pending.r, null);
  assert.equal(invoke('floorResult', { ...example, typed: 5000, gamestopStock: { state: 'loading' } }).r.price, 5000);
  const manual = invoke('floorResult', { ...example, manualMissing: true });
  assert.ok(manual.r.ded > 0); assert.ok(manual.r.price < r.r.price);
  const old = json('settings.floorPremiums');
  try {
    context.outDiscount = [{ phrase: 'Pokemon Shield', pct: -20 }]; run('settings.floorPremiums = outDiscount');
    assert.equal(invoke('floorResult', example).r.price, 5500);
  } finally { context.restorePremiums = old; run('settings.floorPremiums = restorePremiums'); }
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
          const sales = { [condition]: [{ price: ebay, title: 'Example Game ' + ({ loose: 'disc only', cib: 'complete', new: 'sealed' })[condition] }] };
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
    assert.equal(migrated.version, 12);
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
  assert.equal(r.premium, null); assert.equal(r.r.price, 5500);
  assert.equal(invoke('floorResult', cur({ ...product, 'product-name': 'Pokemon Shield', 'console-name': 'Nintendo Switch' }, { typed: 1000 })).r.price, 1000);
});
test('low-price rounding respects dollar endings, cents, market references and the $80 boundary', () => {
  for (const [basis, expected] of [[1000, 1000], [1099, 1000], [1100, 1000], [1199, 1000], [1200, 1500], [1299, 1500], [1300, 1500], [1400, 1500], [1495, 1500], [1499, 1500], [1500, 1500], [1599, 1500], [1600, 1500], [1699, 1500],
    [1700, 2000], [1800, 2000], [1999, 2000], [2038, 2000], [2250, 2500], [2499, 2500],
    [2500, 2500], [2699, 2500], [2700, 3000], [5200, 5500], [5250, 5500], [5700, 6000],
    [7699, 7500], [7700, 8000], [8000, 8000], [8001, 8000]]) {
    assert.equal(invoke('floorPrice', basis, { referenceMin: basis, gs: basis }).price, expected, `market basis ${basis}`);
    if (basis <= 8000) assert.equal(invoke('floorPrice', basis, {}).price, expected, `typed basis ${basis}`);
  }
  assert.equal(invoke('floorPrice', 200, {}).price, 1000);
  assert.equal(invoke('floorPrice', 200, { shitbox: true }).price, 500);
  assert.equal(invoke('floorPrice', 5200, { gs: 5200 }).price, 5500);
  assert.equal(invoke('floorPrice', 5200, { manualMissing: true }).price, 4500);
  const rounded = invoke('floorPrice', 5200, {});
  assert.ok(invoke('floorMath', { from: 'sale', basis: 5200 }, rounded).includes('low-price rounding: $55.00'));
  assert.deepEqual([2000, 2500, 5000, 5500, 10000, 10500, 20000, 20500].map((v) => invoke('manualDeduction', v)), [0, 500, 500, 1000, 1000, 2000, 2000, 2000]);
});

test('LEGO DC Super Villains PS4 CIB rounds its winning $14.95 sale to $15', () => {
  const product = { ...item, 'product-name': 'LEGO DC Super Villains', 'cib-price': 1073, 'gamestop-price': 999 };
  const result = invoke('floorResult', cur(product, {
    sales: { cib: [{ title: 'LEGO DC Super Villains PS4 PlayStation 4 Complete - 1 Year Warranty EX Cond', price: 1495, date: '2026-07-13' }] },
    amazon: { found: true, title: 'LEGO DC Super-Villains - PlayStation 4', lowest: 1263, offers: [{ price: 1263 }] },
  }));
  assert.equal(result.b.basis, 1495);
  assert.equal(result.r.price, 1500);
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

test('without verified Amazon, common Skylanders and Infinity use loose averages for opened/CIB figures', () => {
  for (const system of ['Skylanders', 'Disney Infinity']) {
    const product = { ...item, 'product-name': 'Bash', 'console-name': system, 'loose-price': 320, 'cib-price': 1250, 'new-price': 1800, 'gamestop-price': 3000 };
    for (const [condition, expected] of [['loose', 400], ['cib', 400], ['new', 2000]]) {
      const r = invoke('floorResult', cur(product, { condition, toyGroup: 'common', manualMissing: true,
        sales: { [condition]: [{ title: 'Bash', price: 4000 }] }, amazon: { found: false } }));
      assert.equal(r.b.from, 'toyaverage'); assert.equal(r.r.price, expected); assert.equal(r.r.ded, 0); assert.equal(r.shitbox, null);
    }
  }
});

test('all figure lines merge opened/CIB sales into loose while preserving sealed and excluding empty boxes', () => {
  for (const system of ['Skylanders', 'Disney Infinity', 'Amiibo', 'Lego Dimensions', 'Starlink']) {
    const product = { 'product-name': 'Bash', 'console-name': system, 'loose-price': 1600, 'cib-price': 9000, 'new-price': 10000 };
    const duplicate = { title: 'Bash CIB', price: 2000, url: 'https://www.ebay.com/itm/123456789012' };
    const used = ['Bash Complete In Box Not Sealed', 'Bash with original box', 'Bash + original box', 'Bash and original packaging', 'Bash MIB', 'Bash brand new open box', 'Bash opened blister'];
    const sales = { loose: [duplicate], cib: [{ ...duplicate, url: duplicate.url + '?tracking=1' }, ...used.map(title => ({ title, price: 2500 })),
      { title: 'Bash original box only', price: 100000 }],
      new: [{ title: 'Bash CIB sealed', price: 8000 }, { title: 'Bash CIB', price: 3000 }] };
    const example = cur(product, { condition: 'cib', sales });
    const rows = invoke('floorSales', example);
    assert.equal(rows.filter(s => s.url?.includes('123456789012')).length, 1, system);
    for (const title of used) assert.equal(rows.find(s => s.title === title)?.odd, false, system + title);
    assert.ok(rows.find(s => s.title.includes('box only')).odd, system);
    assert.ok(!rows.some(s => s.title.includes('CIB sealed')), system);
    assert.equal(invoke('floorResult', example).r.price, 3000, system);
    assert.equal(invoke('floorResult', { ...example, condition: 'new' }).b.basis, 8000, system);
    const link = new URL(invoke('floorLinks', product, 'loose').ebay).searchParams.get('_nkw');
    assert.ok(!link.includes('-cib') && !link.includes('-complete'), system);
    context.example = example;
    run('floorCur = example; renderFloorPricer()');
    assert.match(element('#floorPricer').innerHTML, /data-floor-cond="loose"/);
    assert.match(element('#floorPricer').innerHTML, /data-floor-cond="new"/);
    assert.doesNotMatch(element('#floorPricer').innerHTML, /data-floor-cond="cib"/);
    assert.equal(run('floorCur.condition'), 'loose');
  }
  const game = cur(item, { sales: { loose: [{ title: 'Example Game', price: 1000 }], cib: [{ title: 'Example Game CIB', price: 3000 }] } });
  assert.equal(invoke('floorResult', game).b.basis, 3000, 'Game CIB remains separate');
});

test('accepting a CIB figure recheck updates condition even when the price stays the same', () => {
  const entry = { name: 'Bash', platform: 'Skylanders', condition: 'cib', manualMissing: true, price: 2000,
    recheck: { price: 2000, condition: 'loose', basis: 1800, from: 'sale' } };
  context.entry = entry;
  assert.equal(run('recheckChanged(entry)'), true);
  assert.match(run('recheckHtml(entry)'), /Loose/);
  assert.equal(run('useRecheck(entry)'), true);
  assert.equal(entry.condition, 'loose');
  assert.equal(entry.manualMissing, false);
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
      const excluded = !relaxed && prices[0] === 4000;
      assert.equal(r.b.basis, excluded ? prices[1] : prices[0], system);
      assert.equal(!!invoke('floorSales', example)[0].outlier, excluded, system);
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
