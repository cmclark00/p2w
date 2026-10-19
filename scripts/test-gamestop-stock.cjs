'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync('trade-in/app.js', 'utf8').replace(/\binit\(\);\s*$/, '');
const ctx = vm.createContext({ console, Date, setTimeout, clearTimeout,
  localStorage: { getItem: () => null, setItem() {} }, document: { querySelector: () => ({ addEventListener() {} }), addEventListener() {} } });
const run = js => vm.runInContext(js, ctx);
run(source);
run('var stockRenders = 0; renderFloorPricer = () => stockRenders++');
const product = { id: '1', 'product-name': 'Lollipop Chainsaw', 'console-name': 'Playstation 3', 'gamestop-price': 5499 };
const current = () => ({ product, gamestopUrl: 'https://www.gamestop.com/products/game/930799.html', condition: 'cib', sales: { cib: [{ title: 'Lollipop Chainsaw PS3 complete', price: 6000 }] } });
(async () => {
  let resolve;
  ctx.request = () => new Promise(r => { resolve = r; }); run('api = request');
  ctx.cur = current(); run('floorCur = cur');
  const pending = run('loadFloorGameStopStock(cur)');
  assert.equal(ctx.cur.gamestopStock.state, 'loading');
  assert.equal(run('floorResult(cur).r.price'), 6000, 'Stock lookup does not block pricing');
  run('floorCur = null'); resolve({ state: 'out', title: 'Lollipop Chainsaw - PlayStation 3' }); await pending;
  assert.equal(run('stockRenders'), 0, 'Stale item cannot rerender a different game');
  assert.match(run('floorGameStopStock(cur)'), /Out of stock online/);
  for (const result of [{ state: 'in', title: 'Another Game PS3' }, { state: 'in', title: 'Lollipop Chainsaw Xbox 360' }]) {
    ctx.result = result; run('api = async () => result'); await run('loadFloorGameStopStock(cur)');
    assert.equal(ctx.cur.gamestopStock.state, 'unknown', 'Wrong product/platform stays unknown');
  }
  run('api = async () => { throw new Error("Blocked"); }'); await run('loadFloorGameStopStock(cur)');
  assert.match(run('floorGameStopStock(cur)'), /Check stock/);
  ctx.cur.gamestopStock = { state: 'in', reason: '<script>bad</script>', checkedAt: 1792400000 };
  assert.match(run('floorGameStopStock(cur)'), /In stock online/);
  assert.ok(!run('floorGameStopStock(cur)').includes('<script>'));
  assert.equal(run('floorResult(cur).r.price'), 6000, 'Stock does not change pricing');
  ctx.window = { P2WGameStopHelper: { check: async () => ({ state: 'out', title: 'Lollipop Chainsaw PS3', source: 'browser-helper' }) } };
  run('api = async () => { throw new Error("Server must not be called for a confirmed browser result"); }');
  await run('loadFloorGameStopStock(cur)');
  assert.equal(ctx.cur.gamestopStock.state, 'out');
  assert.equal(ctx.cur.gamestopStock.source, 'browser-helper');
  ctx.window.P2WGameStopHelper.check = async () => null;
  run('api = async () => ({ state: "out", title: "Lollipop Chainsaw PS3" })');
  await run('loadFloorGameStopStock(cur)');
  assert.equal(ctx.cur.gamestopStock.state, 'out', 'Server fallback works without helper');
  ctx.cur = { product }; await run('loadFloorGameStopStock(cur)');
  assert.equal(ctx.cur.gamestopStock, undefined, 'No matched product URL: no request');
  console.log('GameStop stock display, matching and async checks passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
