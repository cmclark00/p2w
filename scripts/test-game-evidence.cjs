'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync('trade-in/app.js', 'utf8').replace(/\binit\(\);\s*$/, '');
const variant = { id: '1', 'product-name': 'Example Game [Special Edition]', 'console-name': 'Playstation 4', 'cib-price': 2000, 'gamestop-price': 0 };
const base = { ...variant, id: '2', 'product-name': 'Example Game', 'cib-price': 2500 };
const collector = { ...variant, id: '3', 'product-name': 'Example Game [Collectors Edition]' };
const foreign = { ...base, id: '4', 'console-name': 'PAL Playstation 4' };
const sale = (id, title, price) => ({ title, price, date: '2026-10-20', url: `https://www.ebay.com/itm/${id}` });
function engine(request) {
  const ctx = vm.createContext({ console, Date, URL, setTimeout, clearTimeout, request, variant, base,
    localStorage: { getItem: () => null, setItem() {} }, document: { querySelector: () => ({ addEventListener() {} }), addEventListener() {} } });
  vm.runInContext(fs.readFileSync('trade-in/dead-games.js', 'utf8'), ctx);
  vm.runInContext(source, ctx);
  return { ctx, run: js => vm.runInContext(js, ctx), fetch: () => vm.runInContext('fetchFloorProductSales(variant, request)', ctx) };
}
(async () => {
  const recovered = sale('123456789012', 'Example Game Special Edition PS4 CIB', 2200);
  const standard = sale('123456789013', 'Example Game PS4 CIB', 2500);
  const calls = [];
  const e = engine(async (route, params) => {
    calls.push([route, params]);
    if (route === 'pc/products') return { products: [variant, base, collector, foreign,
      { ...base, id: '8', 'product-name': 'Example Game 2' }, { ...base, id: '9', 'console-name': 'Playstation 5' }] };
    if (route === 'pc/product') return base;
    if (route === 'pc/sales') return { gamestopUrl: null, sales: { cib: params.id === '1' ? [sale('123456789014', 'Example Game Special Edition PS4 CIB', 2000)]
      : params.id === '2' ? [standard, recovered]
      : params.id === '3' ? [recovered, sale('123456789015', 'Example Game Collectors Edition PS4 CIB', 90000)]
      : [sale('123456789016', 'Example Game PS4 CIB PAL', 99900), sale('123456789017', 'Example Game PS4 CIB', 80000), sale('123456789018', 'Example Game Special Edition PS4 CIB USA ESRB', 2300)],
      new: [sale('123456789019', 'Example Game PS4 opened used', 99900)] } };
    throw Error(route);
  });
  const sold = await e.fetch();
  e.run('bonus={...variant,"product-name":"Example Game [With Bonus Content]"}');
  assert.equal(e.run('floorListingMismatch("Example Game PS4 With Bonus Content CIB",bonus)'), null);
  assert.ok(e.run('floorListingMismatch("Example Game PS4 With Bonus Content CIB",base)'));
  assert.ok(e.run('floorListingMismatch("Example Game PS4 CIB",bonus)'));
  assert.ok(e.run('floorListingMismatch("Example Game PS4 With Bonus Content + Controller CIB",bonus)'));
  assert.equal(sold.sales.cib.filter(s => s.url === recovered.url).length, 1);
  assert.ok(sold.sales.cib.some(s => s.price === 2300 && s.recovered));
  assert.ok(!sold.sales.cib.some(s => s.price >= 80000));
  assert.ok(!sold.standardGame.sales.cib.some(s => s.price >= 80000));
  assert.equal(calls.filter(([r]) => r === 'pc/sales').length, 4);
  e.ctx.sold = sold;
  e.run('example = {product:variant,condition:"cib",...sold,amazon:{found:false,standard:{found:false}}}');
  let result = e.run('floorResult(example)');
  assert.equal(result.b.from, 'standard'); assert.equal(result.b.basis, 2500); assert.equal(result.r.price, 2500);
  assert.ok(e.run('floorStandardHtml(floorBasis(example))').includes('Standard game'));
  e.run('settings.floorPremiums = [{phrase:"Example Game",pct:20}]');
  assert.equal(e.run('floorResult(example).r.price'), 3000);
  e.run('settings.floorPremiums = [{phrase:"Example Game",pct:-20}]');
  assert.equal(e.run('floorResult(example).r.price'), 2000, 'specific discounts outrank baseline');
  e.run('settings.floorPremiums = []');
  assert.equal(e.run('floorResult({...example, manualMissing:true}).r.price'), 2000);
  assert.equal(e.run('floorResult({...example, typed:1000}).r.price'), 1000);
  e.run('example.sales.cib.push({title:"Example Game Special Edition PS4 CIB",price:3000})');
  assert.equal(e.run('floorResult(example).r.price'), 3000, 'higher variant keeps its value');
  e.run('example.condition="loose"');
  assert.equal(e.run('floorResult(example).b.basis'), null, 'CIB cannot supply loose evidence');

  const failed = engine(async (route) => { if (route === 'pc/products') throw Error('catalog offline'); return { sales: { cib: [standard] } }; });
  const partial = await failed.fetch();
  assert.match(partial.salesError, /catalog offline/);
  assert.equal(partial.sales.cib.length, 1, 'selected page survives failed related search');

  e.run('example={product:variant,condition:"cib",sales:{cib:[{title:"Example Game Special Edition PS4 CIB",price:2000}]},standardGame:{product:base,sales:{cib:[{title:"Example Game PS4 CIB",price:2500}]}},amazon:{found:false,standard:{found:true,title:"Example Game PS4",offers:[{price:3000}]}}}');
  assert.equal(e.run('floorResult(example).r.price'), 3000, 'base Amazon can set variant floor');
  e.run('example.standardGame.product={...base,"gamestop-price":4000}; example.standardGame.gamestopStock={state:"out",title:"Example Game PS4"}');
  assert.equal(e.run('floorResult(example).r.price'), 3000, 'out-of-stock base GameStop does not set floor');
  e.run('example.standardGame.gamestopStock={state:"in",title:"Example Game PS4"}');
  assert.equal(e.run('floorResult(example).r.price'), 4000);
  e.run('example.standardGame.product=base; example.standardGame.sales.cib[0].price=45000; example.amazon.standard.offers[0].price=70000');
  assert.equal(e.run('floorResult(example).r.price'), 45000, 'high-value Amazon protection survives base comparison');
  console.log('Game evidence passed: related sales, duplicates, region/platform/edition filters, standard minimum, Amazon/GameStop, premiums, deductions, conditions and failures.');
})().catch(err => { console.error(err); process.exitCode = 1; });
