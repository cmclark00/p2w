/* Offline tests of the real pricing engine; no Amazon credentials or network. */
'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync('trade-in/app.js', 'utf8').replace(/\binit\(\);\s*$/, '');
const product = { id: '1', 'product-name': 'Final Fight', 'console-name': 'Super Nintendo', upc: '123456789012', 'loose-price': 1500 };
const candidate = (asin, title = 'Final Fight', platforms = ['Super Nintendo']) => ({ asin, title, platforms, url: `https://www.amazon.com/dp/${asin}` });
const offer = (c, price) => ({ ...c, found: true, condition: 'Used', offers: price ? [{ price }, { price: price + 10000 }] : [], count: price ? 2 : 0 });
function engine(request) {
  const ctx = vm.createContext({ console, Date, setTimeout, clearTimeout, request, product,
    localStorage: { getItem: () => null, setItem() {} }, document: { querySelector: () => ({ addEventListener() {} }), addEventListener() {} } });
  vm.runInContext(source, ctx);
  return { ctx, run: (js) => vm.runInContext(js, ctx), fetch: (p = product, condition = 'loose') => {
    ctx.p = p; ctx.condition = condition; return vm.runInContext('fetchFloorAmazon(p, condition, request)', ctx);
  } };
}
let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log('PASS ' + name); }
(async () => {
  await test('all UPC candidates are checked before offers; wrong game, platform and French variant cannot win', async () => {
    const good = candidate('B000000001'), calls = [];
    const e = engine(async (route, params) => { calls.push([route, params]);
      if (route === 'amazon/catalog') return { candidates: [candidate('B000000002', 'Final Fight Guy'), candidate('B000000003', 'Final Fight', ['Sega CD']), candidate('B000000004', 'Final Fight French Version'), good, good] };
      assert.equal(params.asin, good.asin); return offer(good, 2500);
    });
    const result = await e.fetch(); assert.equal(result.asin, good.asin); assert.equal(result.rejected.length, 3);
    assert.equal(calls.length, 2); assert.equal(result.searched, false);
  });
  await test('wrong barcode falls back to title/platform and links the cheapest verified ASIN', async () => {
    const a = candidate('B000000001'), b = candidate('B000000002', 'Final Fight SNES'); const calls = [];
    const e = engine(async (route, params) => { calls.push([route, params]);
      if (route === 'amazon/catalog') return { candidates: params.upc ? [candidate('B000000003', 'Final Fight Guy')] : [a, b, candidate('B000000004', 'Final Fight Sega CD', ['Sega CD'])] };
      return offer(params.asin === a.asin ? a : b, params.asin === a.asin ? 4000 : 2200);
    });
    const result = await e.fetch(); assert.equal(result.asin, b.asin); assert.equal(result.url, b.url);
    assert.equal(result.matchMethod, 'title/platform search'); assert.equal(result.offers[0].price, 2200);
    assert.equal(calls[1][1].q, 'Final Fight Super Nintendo'); assert.equal(calls.length, 4);
    e.ctx.result = result; e.run('amazonSet=true');
    const html = e.run('floorAmazonHtml({product,condition:"loose",amazon:result},{from:"amazon"})');
    assert.ok(html.includes(b.url)); assert.ok(!html.includes('B000000003')); assert.ok(html.includes('Compared 2 verified'));
  });
  await test('missing UPC searches directly and requires positive platform evidence', async () => {
    const calls = [], good = candidate('B000000001', 'Final Fight - Super NES', []);
    const e = engine(async (route, params) => { calls.push([route, params]);
      if (route === 'amazon/catalog') return { candidates: [candidate('B000000002', 'Final Fight', []), good] };
      assert.equal(params.cond, 'new'); return { ...offer(good, 4500), condition: 'New' };
    });
    const result = await e.fetch({ ...product, upc: '' }, 'new'); assert.equal(result.asin, good.asin); assert.equal(calls.length, 2);
    assert.ok(result.rejected[0].reason.includes('platform'));
  });
  await test('offer response identity is rechecked even after a matching catalog result', async () => {
    const e = engine(async (route, params) => route === 'amazon/catalog' ? { candidates: params.upc ? [candidate('B000000001')] : [] }
      : offer(candidate('B000000001', 'Final Fight Guy'), 50000));
    const r = await e.fetch(); assert.equal(r.found, false); assert.ok(r.matchNotes.some(n => n.includes('No verified')));
  });
  await test('failed lookups are retried and cache keys include product identity and condition', async () => {
    let fail = true, calls = 0;
    const e = engine(async (route, params) => { calls++; if (fail) throw Error('Temporary API failure');
      return route === 'amazon/catalog' ? { candidates: [candidate('B000000001')] } : offer(candidate('B000000001'), 2500); });
    await assert.rejects(e.fetch(), /Temporary/); fail = false;
    await e.fetch(); const after = calls; await e.fetch(product, 'cib'); assert.equal(calls, after);
    await e.fetch(product, 'new'); assert.equal(calls, after + 2);
    const other = await e.fetch({ ...product, id: '2', 'product-name': 'Final Fight Guy' });
    assert.equal(other.found, false); assert.ok(calls > after + 2);
  });
  await test('fallback preserves condition, specific premiums and the lowest-offer baseline', async () => {
    const p = { ...product, 'product-name': 'Pokemon Shield', 'console-name': 'Nintendo Switch' };
    const good = candidate('B000000001', 'Pokemon Shield - Nintendo Switch', ['Nintendo Switch']);
    const e = engine(async (route, params) => route === 'amazon/catalog' ? { candidates: params.upc ? [] : [good] } : offer(good, 6000));
    e.ctx.result = await e.fetch(p, 'cib'); e.ctx.p = p;
    const r = e.run('floorResult({product:p,condition:"cib",sales:{cib:[{title:"Pokemon Shield Nintendo Switch complete",price:5000}]},amazon:result})');
    assert.equal(r.b.basis, 6000); assert.equal(r.premium.pct, 10); assert.equal(r.r.price, 6500);
    assert.ok(r.b.checks.some(n => n.includes('title/platform')));
  });
  await test('unpriced UPC match searches other listings and does not mislabel a missing price', async () => {
    const good = candidate('B000000001');
    const e = engine(async (route, params) => route === 'amazon/catalog' ? { candidates: params.upc ? [good] : [] } : offer(good, null));
    const r = await e.fetch(); assert.equal(r.found, true); assert.equal(r.asin, good.asin); assert.equal(r.offers.length, 0); assert.equal(r.searched, true);
  });
  await test('ambiguous broad searches and partially failed offer checks do not publish an arbitrary price', async () => {
    const many = engine(async () => ({ candidates: Array.from({length:6},(_,i)=>candidate('B00000000'+i)) }));
    await assert.rejects(many.fetch(), /too many candidates/);
    const broken = engine(async (route, params) => {
      if (route === 'amazon/catalog') return { candidates: [candidate('B000000001'), candidate('B000000002')] };
      if (params.asin === 'B000000002') throw Error('Offer lookup failed'); return offer(candidate('B000000001'), 99900);
    });
    await assert.rejects(broken.fetch(), /Offer lookup failed/);
  });
  console.log(`${checks} Amazon matching checks passed.`);
})().catch(e => { console.error(e); process.exitCode = 1; });
