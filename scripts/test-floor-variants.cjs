'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync('trade-in/app.js', 'utf8').replace(/\binit\(\);\s*$/, '');
const scanned = { id: '9909046', upc: '883929530434', 'product-name': 'Witcher 3: Wild Hunt [With Bonus Content]', 'console-name': 'Playstation 4', 'cib-price': 839 };
const standard = { ...scanned, id: '1', 'product-name': 'Witcher 3: Wild Hunt' };
const complete = { ...scanned, id: '2', 'product-name': 'Witcher 3: Wild Hunt [Complete Edition]' };
function engine(search = async () => [standard, complete]) {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { value: '', hidden: false, innerHTML: '', addEventListener() {}, focus() {} });
    return elements.get(selector);
  };
  const ctx = vm.createContext({ console, Date, URL, setTimeout, clearTimeout, scanned, variantSearch: search,
    localStorage: { getItem: () => null, setItem() {} }, document: { querySelector: element, addEventListener() {} } });
  vm.runInContext(source, ctx);
  const run = js => vm.runInContext(js, ctx);
  run('PC.byUpc = async () => scanned; PC.search = variantSearch; renderFloorPricer = () => {}; pickFloorGame = p => { picked = p; closeFloorResults(); };');
  return { ctx, run, element, json: js => JSON.parse(JSON.stringify(run(js))) };
}
(async () => {
  let query;
  const e = engine(async q => { query = q; return [standard, complete, scanned, { ...standard, id: '3', 'console-name': 'Xbox One' },
    { ...standard, id: '4', 'console-name': 'PAL Playstation 4' }, { ...standard, id: '5', 'product-name': 'Witcher 2: Wild Hunt' },
    { ...standard, id: '6', 'product-name': 'Witcher 3: Wild Hunt Strategy Guide' }]; });
  await e.run('runFloorVariants(scanned)');
  assert.equal(query, 'Witcher 3: Wild Hunt Playstation 4');
  assert.deepEqual(e.json('floorSearch.results.map(p => p.id)'), ['9909046', '1', '2']);
  assert.equal(e.run('typeof picked'), 'undefined', 'never auto-select another edition');
  assert.ok(e.element('#floorResults').innerHTML.includes('Choose your edition'));
  assert.ok(e.element('#floorResults').innerHTML.includes('Original match'));
  assert.ok(e.element('#floorResults').innerHTML.includes('PC average'));
  e.run('pickFloorGame(floorSearch.results[1])');
  assert.equal(e.run('picked.id'), '1');
  assert.equal(e.run('floorSearch.results'), null);

  const single = engine(async () => []);
  await single.run('floorScanUpc("883929530434")');
  assert.equal(single.run('picked.id'), scanned.id);

  const failed = engine(async () => { throw Error('offline'); });
  await failed.run('runFloorVariants(scanned)');
  assert.deepEqual(failed.json('floorSearch.results.map(p => p.id)'), [scanned.id]);
  assert.ok(failed.element('#floorResults').innerHTML.includes('Other editions could not be checked'));
  assert.ok(failed.element('#floorResults').innerHTML.includes('Retry'));

  let resolve;
  const stale = engine(() => new Promise(r => { resolve = r; }));
  const pending = stale.run('runFloorVariants(scanned, true)');
  stale.run('closeFloorResults()');
  resolve([standard]); await pending;
  assert.equal(stale.run('floorSearch.results'), null);
  assert.equal(stale.run('typeof picked'), 'undefined');

  const race = engine(); let resolveUpc;
  race.ctx.delayed = () => new Promise(r => { resolveUpc = r; });
  race.run('PC.byUpc = delayed');
  const scan = race.run('floorScanUpc("883929530434")');
  race.run('closeFloorResults()'); resolveUpc(scanned); await scan;
  assert.equal(race.run('floorSearch.results'), null);
  assert.equal(race.run('typeof picked'), 'undefined');

  e.ctx.unsafe = { ...scanned, id: '7', 'product-name': 'Witcher 3: Wild Hunt [<img src=x onerror=alert(1)>]' };
  e.run('Object.assign(floorSearch, {variantProduct: scanned, results: [unsafe]}); renderFloorResults();');
  assert.ok(e.element('#floorResults').innerHTML.includes('&lt;img'));
  assert.ok(!e.element('#floorResults').innerHTML.includes('<img'));
  console.log('UPC variant discovery passed: editions, platform/region/sequel filtering, explicit selection, fallback, stale responses and escaping.');
})().catch(err => { console.error(err); process.exitCode = 1; });
