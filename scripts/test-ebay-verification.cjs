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
  // Targeted checks examine only the actual driver, with a hard three-sale bound.
  const old = rows => cur(product, rows.map((price, i) => ({ ...sale(price, String(111111111111 + i)), date: '2025-01-01' })));
  const targeted = (c, responses, cancel = () => false) => {
    const calls = [];
    const helper = { targetedAvailable: async () => true, checkTargeted: async url => {
      calls.push(url); const row = c.sales.cib.find(s => s.url === url);
      return verified(invoke('floorSaleKey', row), row.price, row.title, responses[calls.length - 1] || 'sold');
    } };
    return invoke('runFloorTargetedEbay', c, () => {}, cancel, helper).then(() => calls);
  };
  const good = old([3000, 2900, 2800, 2700]); const original = result(good).r.price;
  assert.equal((await targeted(good, ['sold'])).length, 1);
  assert.equal(result(good).r.price, original); assert.equal(result(good).b.ebayReview, undefined);
  const retries = old([3000, 2900, 2800, 2700]);
  assert.equal((await targeted(retries, ['offer', 'ended', 'sold'])).length, 3);
  assert.equal(result(retries).b.basis, 2800); assert.equal(result(retries).b.ebayReview, undefined);
  const limited = old([3000, 2900, 2800, 2700]);
  assert.equal((await targeted(limited, ['offer', 'ended', 'offer'])).length, 3);
  assert.equal(result(limited).b.basis, 2700); assert.equal(result(limited).b.ebayReview, true);
  assert.equal((await targeted(limited, ['sold'])).length, 0, 'Renders cannot restart the budget');
  const unknown = old([3000, 2900]);
  assert.equal((await targeted(unknown, ['unknown'])).length, 1, 'Unknown is flagged, not replaced with an unverified lower sale');
  assert.equal(result(unknown).b.basis, 3000); assert.equal(result(unknown).b.ebayReview, true);
  const absentTarget = old([3000]); await invoke('runFloorTargetedEbay', absentTarget, () => {}, () => false, null);
  assert.equal(result(absentTarget).b.ebayReview, true); assert.equal(absentTarget.targetedEbay.running, false);
  const cancelled = old([3000]); assert.equal((await targeted(cancelled, ['sold'], () => true)).length, 0);
  const recent = cur(product, [sale(3000, '111111111111')]); recent.sales.cib[0].date = new Date().toISOString().slice(0, 10);
  assert.equal((await targeted(recent, ['sold'])).length, 0, 'No broad automatic sweep of recent ordinary sales');
  const gap = cur(product, [sale(6000, '111111111111')]); gap.sales.cib[0].date = new Date().toISOString().slice(0, 10);
  gap.amazon = { found: true, title: 'Example Game PS4', platforms: ['Playstation 4'], offers: [{ price: 2300, shipping: 0 }] };
  assert.equal((await targeted(gap, ['sold'])).length, 1, 'Large Amazon discrepancy triggers a recent sale');
  const amazonDriver = old([3000]); amazonDriver.amazon = { found: true, title: 'Example Game PS4', platforms: ['Playstation 4'], offers: [{ price: 4000, shipping: 0 }] };
  assert.equal((await targeted(amazonDriver, ['sold'])).length, 0, 'Do not check eBay when Amazon drives');
  const typed = old([3000]); typed.typed = 4000; assert.equal((await targeted(typed, ['sold'])).length, 0);
  const premiumItem = old([10000]); premiumItem.product = { 'product-name': 'Pokemon Red', 'console-name': 'GameBoy', 'loose-price': 6000 };
  premiumItem.condition = 'loose'; premiumItem.sales.loose = premiumItem.sales.cib;
  premiumItem.sales.loose[0].title = 'Pokemon Red GameBoy authentic';
  const premiumBefore = result(premiumItem).r.price;
  await targeted(premiumItem, ['sold']); assert.equal(result(premiumItem).r.price, premiumBefore, 'Targeted verification preserves premiums and rounding');
  const variant = cur({ ...product, id: 'variant', 'product-name': 'Example Game [Deluxe Edition]' },
    [sale(2000, '888888888888', 'Example Game Deluxe Edition PS4 CIB')]);
  variant.standardGame = old([3000, 2900]);
  let standardCalls = 0;
  await invoke('runFloorTargetedEbay', variant, () => {}, () => false, {
    targetedAvailable: async () => true, checkTargeted: async url => {
      standardCalls++; const row = variant.standardGame.sales.cib.find(s => s.url === url);
      return verified(invoke('floorSaleKey', row), row.price);
    }
  });
  assert.equal(standardCalls, 1); assert.equal(result(variant).b.from, 'standard');
  assert.equal(variant.standardGame.ebayChecks.results['111111111111'].state, 'sold');
  assert.equal(result(variant).b.ebayReview, undefined, 'Standard baseline driver verification is retained');
  const pendingTarget = old([3000, 2900]); let finishTarget;
  const running = invoke('runFloorTargetedEbay', pendingTarget, () => {}, () => false, {
    targetedAvailable: async () => true, checkTargeted: () => new Promise(r => { finishTarget = r; })
  });
  await new Promise(r => setImmediate(r)); assert.equal(result(pendingTarget).b.ebayChecking, true);
  pendingTarget.targetedEbay = null; pendingTarget.ebayChecks = null;
  finishTarget(verified('111111111111', null, undefined, 'ended')); await running;
  assert.equal(pendingTarget.ebayChecks, null, 'An old condition run cannot restore results after a switch back');
  assert.ok(invoke('floorBasisInfo', result(unknown).b).reviewNotes.some(n => n.includes('Price needs review')));
  // Real load path must never invoke the helper, even when available.
  const automatic = cur(); ctx.automatic = automatic;
  ctx.window = { P2WEbayHelper: forbidden };
  vm.runInContext('floorCur = automatic; fetchFloorProductSales = async () => ({ sales: automatic.sales }); loadFloorGameStopStock = () => {};', ctx);
  await invoke('loadFloorSales', automatic.product); assert.equal(forbiddenCalls, 0);
  const html = element('#floorPricer').innerHTML;
  assert.match(html, /Check selected sale/); assert.doesNotMatch(html, /Recheck sales|Verifying eBay sales/);
  assert.doesNotMatch(html, /data-floor-act="add" disabled/, 'Ordinary Add to list is available without eBay checking');
  console.log('Targeted and optional eBay checks passed: bounded driver checks, condition cancellation, unknown review, standard baseline, helper compatibility and premiums preserved.');
})().catch(e => { console.error(e); process.exitCode = 1; });
