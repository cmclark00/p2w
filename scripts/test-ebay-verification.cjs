'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ctx = vm.createContext({ console, Date, URL, setTimeout, clearTimeout,
  localStorage: { getItem: () => null, setItem() {} },
  document: { querySelector: () => ({ addEventListener() {} }), addEventListener() {} } });
vm.runInContext(fs.readFileSync('trade-in/dead-games.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('trade-in/app.js', 'utf8').replace(/\binit\(\);\s*$/, ''), ctx);
const invoke = (name, ...args) => { ctx.args = args; return vm.runInContext(`${name}(...args)`, ctx); };
const product = { 'product-name': 'Example Game', 'console-name': 'Playstation 4', 'cib-price': 1000 };
const sale = (price, id, title = 'Example Game PS4 CIB') => ({ title, price, date: '2026-10-19', url: `https://www.ebay.com/itm/${id}` });
const cur = (p = product, rows = [sale(3000, '111111111111'), sale(2000, '222222222222'), sale(1000, '333333333333')]) =>
  ({ product: p, condition: 'cib', sales: { cib: rows }, pick: null, typed: null, amazon: { found: false } });
const check = (c, helper, progress = () => {}, cancel = () => false) => invoke('verifyFloorEbaySales', c, progress, cancel, helper);
const result = c => invoke('floorResult', c);
const verified = (id, price, title = 'Example Game PS4 CIB', state = 'sold') => ({ id, price, title, state });
(async () => {
  const c = cur(); let active = 0, peak = 0, waiting = false;
  const helper = { available: async () => true, check: async url => {
    active++; peak = Math.max(peak, active); await new Promise(r => setImmediate(r)); active--;
    const id = url.split('/').pop();
    return verified(id, id.startsWith('3') ? 1000 : 3000, undefined, id.startsWith('1') ? 'offer' : id.startsWith('2') ? 'ended' : 'sold');
  } };
  await check(c, helper, () => { if (c.ebayChecks.loading) { waiting = true; assert.equal(result(c).r, null); } });
  assert.equal(peak, 2); assert.equal(waiting, true); assert.equal(c.ebayChecks.done, 3);
  assert.equal(result(c).b.basis, 1000); assert.equal(result(c).r.price, 1000);
  assert.deepEqual(Array.from(invoke('floorSales', c), s => s.verification.state), ['offer', 'ended', 'sold']);
  c.pick = 0; assert.equal(result(c).b.basis, 1000, 'Cannot manually reselect an accepted asking price');
  c.typed = 1700; assert.equal(result(c).b.from, 'typed', 'Deliberate typed overrides remain available');
  c.typed = null;
  for (const [response, expected] of [[verified('999999999999', 1000), 'unknown'],
    [verified('333333333333', 1500), 'price'], [verified('333333333333', 1000, 'Another Game PS5'), 'mismatch'], [null, 'unknown']]) {
    assert.equal(invoke('floorEbayResult', c.sales.cib[2], product, response).state, expected);
  }
  const absent = cur(); await check(absent, null);
  assert.equal(absent.ebayChecks.unavailable, true); assert.equal(absent.ebayChecks.loading, false);
  assert.equal(result(absent).b.from, 'pricecharting'); assert.equal(result(absent).b.sale, null);
  const thrown = cur(); await check(thrown, { available: async () => true, check: async () => { throw Error('Blocked'); } });
  assert.ok(Object.values(thrown.ebayChecks.results).every(r => r.state === 'unknown'));
  assert.equal(result(thrown).b.sale, null);
  const reject = cur(); await check(reject, { available: async () => { throw Error('Extension reloaded'); } });
  assert.equal(reject.ebayChecks.unavailable, true); assert.equal(reject.ebayChecks.loading, false);
  const cancel = cur(); let requests = 0;
  await check(cancel, { available: async () => true, check: async () => { requests++; return null; } }, () => {}, () => true);
  assert.equal(requests, 0); assert.equal(cancel.ebayChecks.loading, false);
  const mismatches = cur(product, [sale(9900, '111111111111', 'Wrong Game PS5'), sale(1000, '333333333333')]);
  await check(mismatches, { available: async () => true, check: async () => { requests++; return verified('333333333333', 1000); } });
  assert.equal(requests, 1, 'Known mismatches do not open unnecessary tabs');

  // Compare real engine results with/without verification, exercising specific adjustments.
  for (const [name, system, condition, title, price] of [
    ['Pokemon LeafGreen', 'GameBoy Advance', 'loose', 'Pokemon LeafGreen GameBoy Advance authentic', 15000],
    ['Pokemon Red', 'GameBoy', 'loose', 'Pokemon Red GameBoy authentic', 10000],
    ['Sonic Boom - Giants, Glow in the Dark', 'Skylanders', 'loose', 'Skylanders Giants Glow in the Dark Sonic Boom CIB Not Sealed', 1800],
  ]) {
    const p = { 'product-name': name, 'console-name': system, 'loose-price': 977 };
    const item = { product: p, condition, sales: { loose: [sale(price, '333333333333', title)] }, typed: null, pick: null, amazon: { found: false } };
    const before = result(item).r.price;
    await check(item, { available: async () => true, check: async () => verified('333333333333', price, title) });
    assert.equal(result(item).r.price, before, name + ' keeps its existing premium/rounding');
    if (system === 'Skylanders') assert.equal(before, 2000, 'Rare minimum remains $20');
  }
  assert.equal(invoke('floorEbayResult', c.sales.cib[2], product, verified('333333333333', 1000, 'Example Game PS4 New Sealed'), 'cib').state, 'mismatch');
  const originalChecks = cur(product, [sale(1000, '333333333333')]); let release;
  const first = check(originalChecks, { available: async () => true, check: () => new Promise(r => { release = r; }) }, () => {}, () => false);
  await new Promise(r => setImmediate(r));
  // Replacement conditions must keep a separate result object; an old response cannot populate it.
  const old = originalChecks.ebayChecks;
  await check(originalChecks, null); const replacement = originalChecks.ebayChecks;
  assert.notEqual(old, replacement); assert.equal(replacement.unavailable, true);
  release(verified('333333333333', 1000)); await first;
  assert.equal(originalChecks.ebayChecks, replacement); assert.equal(Object.keys(replacement.results).length, 0);
  console.log('eBay pricing checks passed: exclusions, exact item/amount, waiting, helper failure, premium/minimum preservation and isolated runs.');
})().catch(e => { console.error(e); process.exitCode = 1; });
