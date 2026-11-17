'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const product = { id: '35460', 'product-name': "New Nintendo 3DS XL Zelda Majora's Mask Limited Edition", 'console-name': 'Nintendo 3DS', genre: 'Systems', 'loose-price': 54312, 'cib-price': 78509 };
const ctx = vm.createContext({ console, Date, URL, setTimeout, clearTimeout, product,
  localStorage: { getItem: () => null, setItem() {} }, document: { querySelector: () => ({ addEventListener() {} }), addEventListener() {} } });
vm.runInContext(fs.readFileSync('trade-in/app.js', 'utf8').replace(/\binit\(\);\s*$/, ''), ctx);
const run = js => vm.runInContext(js, ctx);
const match = title => { ctx.title = title; return run('floorListingMismatch(title, product)'); };
// Real titles rejected in both condition pools. Title identity is separate from
// packaging, sold verification, accepted offers, location and price eligibility.
const recovered = [
  "Nintendo 3DS XL Legend of Zelda Majora's Mask Limited Edition Handheld Console",
  "MINTY Nintendo 3DS XL Legend of Zelda Majora's Mask Edition IPS CIB - Tested",
  "Nintendo 3DS XL Legend of Zelda Majora's Mask Limited Edition Handheld CIB",
  "Nintendo New 3DS XL Legend of Zelda Majora's Mask Edition Console Gold CIB",
  "CLEAN Nintendo 3DS XL Legend of Zelda Majora's Mask Limited Edition Complete Box",
  'New Nintendo 3DS XL Majora’s Mask Edition Unused CIB',
  "Nintendo 3DS XL Legend of Zelda Majora's Mask Limited Edition.",
  "Nintendo New 3DS XL Majora's Mask Edition Gold/Black Console CIB",
  "Nintendo New 3DS XL Majora's Mask Edition Gold/Black 4GB (Top IPS)",
  'New Nintendo 3DS XL Majora’s Mask Limited Edition – Complete in Box – Excellent',
  "Nintendo New 3DS XL - Zelda Majora's Mask Edition - CIB - PERFECT Condition",
  "Nintendo 3DS XL Legend of Zelda Majora's Mask Edition IPS CIB - Tested",
  "Nintendo New 3DS XL Majora's Mask Edition Gold/Black CIB Manuals NFC 4GB",
  "Nintendo 3DS XL Legend of Zelda Majora's Mask Limited Edition Console and Box",
  'New Nintendo 3DS XL Majoras Mask Limited Edition Complete In Box Adult Owned',
  'New Nintendo 3ds XL: The Legend Of Zelda Majoras Mask Edition',
  'New 3DS XL Majoras Mask Edition - Top IPS CIB! Offers Welcome!',
  "New Nintendo 3DS XL Zelda Majora's Mask Edition Console System 3d ds A+ condi",
  "Nintendo 3DS XL Legend of Zelda Majora's Mask Limited Edition Handheld Consloe -",
  "Nintendo New 3DS XL Majora's Mask Edition Gold/Black Wi-Fi 4GB",
  'Nintendo New 3DS XL (Top Screen IPS) Zelda Majora’s Mask Edition Gold Console',
  "Nintendo 3DS XL Legend of Zelda Majora's Mask (Handheld) Tested & Working W/Acce",
  "MINT 3DS XL Legend of Zelda Majora's Mask Limited Edition",
  "NintendoUsed 3DS XL Legend of Zelda Majora's Mask Limited Edition Console",
  "⭐️ IPS Nintendo New 3DS XL - Legend of Zelda Majora's Mask Edition - USA NTSC",
  "Nintendo New 3DS XL Majora's Mask Edition Gold Handheld Console TOP IPS",
  "Nintendo 3DS XL Legend of Zelda Majora's Mask Limited Edition Console Top IPS",
  "New Nintendo 3DS XL - Majora's Mask Limited Edition with charger",
  'Nintendo New 3DS XL zelda majoras mask Edition Console & charger- FAST SHIPPING',
  "* Nintendo 3DS XL - Majora's Mask Limited Edition w/ Charger & Carrying Case *",
];
for (const title of recovered) assert.equal(match(title), null, title);
const rejected = [
  'DUAL IPS Nintendo New 3DS XL Hyrule Edition Console CIB Complete in Box US Model',
  'New Nintendo 3DS XL Gold Console CIB',
  'Nintendo 2DS XL Majora Mask Limited Edition',
  "Nintendo 3DS XL Majora's Mask Limited Edition Replacement Shell",
  "Carrying Case for New Nintendo 3DS XL Majora's Mask Limited Edition",
  "Nintendo 3DS XL Majora's Mask Limited Edition with Loopy Capture Card",
  "New Nintendo 3DS XL Majora's Mask Edition CIB PAL",
  "New Nintendo 3DS XL Majora's Mask Edition Japan",
  "NEW NINTENDO 3DS XL MAJORA'S MASK EDITION BUNDLE + OCARINA OF TIME 3D & CHARGER",
  'New Nintendo 3DS XL - Majora’s Mask Limited Edition - Console + Luigi’s Mansion',
  "New Nintendo 3DS XL Legend of Zelda Majora's Mask Limited Edition console + Game",
  "New Nintendo 3DS XL Legend Of Zelda Majora's Mask Limited Edition Console +...",
  "New Nintendo 3DS XL Majora's Mask Limited Edition + 8 Games Bundle",
  "New Nintendo 3DS XL Majora's Mask Limited Edition with Lot Of Extras!",
];
for (const title of rejected) assert.ok(match(title), title);
for (const title of ["New Nintendo 3DS XL Majora's Mask Edition EMPTY BOX ONLY", "New Nintendo 3DS XL Majora's Mask Edition BOX & MANUAL ONLY"]) {
  ctx.title = title;
  assert.ok(run('floorOdd({title}, "cib", null, product)'), title);
}
// Grade New never becomes CIB merely because the title says CIB or Complete.
ctx.title = recovered[2];
assert.equal(run('floorDirectCondition({title,conditionText:"Brand New"},product)'), 'new');
assert.equal(run('floorDirectCondition({title,conditionText:"Pre-Owned"},product)'), 'cib');
ctx.title = recovered[27];
assert.equal(run('floorDirectCondition({title,conditionText:"Pre-Owned"},product)'), 'loose');
ctx.sale = { id:'168793181152', url:'https://www.ebay.com/itm/168793181152', title:recovered[15], conditionText:'Pre-Owned', price:85000, shipping:638, state:'sold' };
ctx.cur = { product, condition:'loose', sales:{cib:[ctx.sale]}, directEbay:{result:{state:'ready',sales:[ctx.sale]}} };
assert.equal(run('floorMergedSales(cur, []).length'), 0, 'Known boxed sale must not become Loose from a generic title');
ctx.cur.condition = 'cib';
assert.equal(run('floorMergedSales(cur, cur.sales.cib).length'), 1, 'Keep the known CIB sale');
ctx.cur.condition = 'loose';
ctx.sale.title += ' console only';
assert.equal(run('floorMergedSales(cur, []).length'), 1, 'Explicit console-only evidence wins over the source category');
// Preserve model checks for ordinary New 3DS XL inventory and game titles.
ctx.other = { ...product, 'product-name': 'New Nintendo 3DS XL Red' };
assert.ok(run('floorListingMismatch("Nintendo 3DS XL Red",other)'));
assert.ok(run('floorListingMismatch("New Nintendo 3DS XL Majoras Mask Edition",other)'));
ctx.other = { ...product, 'product-name': "Zelda Majora's Mask", genre: 'Action & Adventure' };
assert.ok(run('floorListingMismatch("Nintendo 3DS XL Majoras Mask Console",other)'));
console.log(`Console edition audit passed: ${recovered.length} recovered title forms, ${rejected.length} mismatch controls and condition checks.`);
