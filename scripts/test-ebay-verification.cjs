'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const elements = new Map();
const element = key => { if (!elements.has(key)) elements.set(key, { value: '', innerHTML: '', addEventListener() {} }); return elements.get(key); };
const ctx = vm.createContext({ console, Date, URL, setTimeout, clearTimeout,
  localStorage: { getItem: () => null, setItem() {} }, document: { querySelector: element, addEventListener() {} } });
vm.runInContext(fs.readFileSync('trade-in/dead-games.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('trade-in/app.js', 'utf8').replace(/\binit\(\);\s*$/, ''), ctx);
const invoke = (name, ...args) => { ctx.args = args; return vm.runInContext(`${name}(...args)`, ctx); };
const product = { 'product-name': 'Example Game', 'console-name': 'Playstation 4', 'cib-price': 1000 };
const sale = (price, id, title = 'Example Game PS4 CIB') => ({ title, price, date: '2026-10-19', url: `https://www.ebay.com/itm/${id}` });
const cur = (p = product, rows = [sale(3000, '111111111111'), sale(2000, '222222222222'), sale(1000, '333333333333')]) =>
  ({ product: p, condition: 'cib', sales: { cib: rows }, pick: null, typed: null, amazon: { found: false } });
const check = (c, index, helper, progress = () => {}, cancel = () => false) => invoke('verifyFloorEbaySale', c, index, progress, cancel, helper);
const result = c => invoke('floorResult', c);
const verified = (id, price, title = 'Example Game PS4 CIB', state = 'sold') => ({ id, price, title, state });
(async () => {
  const c = cur(); let requests = [], release;
  const helper = { available: async () => true, check: url => { requests.push(url); return new Promise(r => { release = r; }); } };
  const task = check(c, 0, helper); await new Promise(r => setImmediate(r));
  assert.equal(requests.length, 1); assert.equal(result(c).r.price, 3000, 'Pending optional check does not hold pricing');
  await check(c, 1, helper); assert.equal(requests.length, 1, 'Second clicks do not queue work');
  release(verified('111111111111', null, undefined, 'offer')); await task;
  assert.equal(requests.length, 1, 'Does not proceed to the next sale');
  assert.equal(result(c).b.basis, 2000); c.pick = 0;
  assert.equal(result(c).b.basis, 2000, 'Confirmed accepted asking price cannot be reselected');
  await check(c, 1, { available: async () => true, check: async () => verified('222222222222', null, undefined, 'ended') });
  assert.equal(result(c).r.price, 1000);
  await check(c, 0, { available: async () => true, check: async () => null });
  assert.equal(c.ebayChecks.results['111111111111'].state, 'offer', 'Failed retry cannot erase a confirmed exclusion');
  c.typed = 1700; assert.equal(result(c).b.from, 'typed'); c.typed = null;
  const absent = cur(); await check(absent, 0, null);
  assert.equal(absent.ebayChecks.unavailable, true); assert.equal(result(absent).b.basis, 3000);
  assert.equal(invoke('floorSales', absent)[0].verification.state, 'unknown');
  assert.equal(invoke('floorSales', absent)[1].verification, undefined, 'Unchecked rows are not falsely flagged');
  const thrown = cur(); await check(thrown, 0, { available: async () => true, check: async () => { throw Error('Blocked'); } });
  assert.equal(result(thrown).b.basis, 3000); assert.equal(thrown.ebayChecks.loading, false);
  for (const [response, expected] of [[verified('999999999999', 1000), 'unknown'], [verified('333333333333', 1500), 'price'],
    [verified('333333333333', 1000, 'Another Game PS5'), 'mismatch'], [null, 'unknown']])
    assert.equal(invoke('floorEbayResult', c.sales.cib[2], product, response).state, expected);
  assert.equal(invoke('floorEbayResult', c.sales.cib[2], product, verified('333333333333', 1000, 'Example Game PS4 New Sealed'), 'cib').state, 'mismatch');
  let forbiddenCalls = 0;
  const forbidden = { available: async () => true, check: async () => { forbiddenCalls++; return null; } };
  await check(cur(product, [sale(9900, '111111111111', 'Wrong Game PS5')]), 0, forbidden);
  await check(cur(), undefined, forbidden); await check(cur(), 999, forbidden);
  await check(cur(), 0, forbidden, () => {}, () => true); assert.equal(forbiddenCalls, 0);
  for (const [name, system, title, price] of [
    ['Pokemon LeafGreen', 'GameBoy Advance', 'Pokemon LeafGreen GameBoy Advance authentic', 15000],
    ['Pokemon Red', 'GameBoy', 'Pokemon Red GameBoy authentic', 10000],
    ['Sonic Boom - Giants, Glow in the Dark', 'Skylanders', 'Skylanders Giants Glow in the Dark Sonic Boom CIB Not Sealed', 1800],
  ]) {
    const p = { 'product-name': name, 'console-name': system, 'loose-price': 977 };
    const item = { product: p, condition: 'loose', sales: { loose: [sale(price, '333333333333', title)] }, typed: null, pick: null, amazon: { found: false } };
    const before = result(item).r.price;
    await check(item, 0, { available: async () => true, check: async () => verified('333333333333', price, title) });
    assert.equal(result(item).r.price, before, name + ' keeps premium/rounding');
    if (system === 'Skylanders') assert.equal(before, 2000);
  }
  // Real load path must never invoke the helper, even when available.
  const automatic = cur(); ctx.automatic = automatic;
  ctx.window = { P2WEbayHelper: forbidden };
  vm.runInContext('floorCur = automatic; fetchFloorProductSales = async () => ({ sales: automatic.sales }); loadFloorGameStopStock = () => {};', ctx);
  await invoke('loadFloorSales', automatic.product); assert.equal(forbiddenCalls, 0);
  const html = element('#floorPricer').innerHTML;
  assert.match(html, /Check selected sale/); assert.doesNotMatch(html, /Recheck sales|Verifying eBay sales/);
  assert.doesNotMatch(html, /data-floor-act="add" disabled/, 'Ordinary Add to list is available without eBay checking');
  console.log('Optional eBay checks passed: one selected sale, no automatic queue or pricing wait, unknowns stay eligible, confirmed exclusions and premiums preserved.');
})().catch(e => { console.error(e); process.exitCode = 1; });
