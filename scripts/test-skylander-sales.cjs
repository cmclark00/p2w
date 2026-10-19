'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync('trade-in/app.js', 'utf8').replace(/\binit\(\);\s*$/, '');
const product = { id: '1', 'product-name': 'Trigger Happy - Swap Force, Spring Time', 'console-name': 'Skylanders', 'new-price': 850, 'loose-price': 1288 };
const standard = { ...product, id: '2', 'product-name': 'Trigger Happy' };
const sale = (title, price, id = '123456789012') => ({ title, price, date: '2026-06-28', url: `https://www.ebay.com/itm/${id}` });
function engine(request) {
  const ctx = vm.createContext({ console, Date, setTimeout, clearTimeout, request, product,
    localStorage: { getItem: () => null, setItem() {} }, document: { querySelector: () => ({ addEventListener() {} }), addEventListener() {} } });
  vm.runInContext(source, ctx);
  return { ctx, run: (js) => vm.runInContext(js, ctx), fetch: (p = product) => { ctx.p = p; return vm.runInContext('fetchFloorProductSales(p, request)', ctx); } };
}
let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log('PASS ' + name); }
(async () => {
  await test('special variants override low averages and saved common overrides', () => {
    const e = engine();
    for (const name of ['Trigger Happy - Swap Force, Spring Time', 'Springtime Trigger Happy', 'Trigger Happy - Power Blue', 'Hoot Loop - Enchanted', 'Bash - Crystal', 'Hex - Giants, Lightcore', 'Dive Clops - Eggcited', 'Pop Fizz - Love Potion', 'Whirlwind - Polar', 'Royal Double Trouble', 'Scarlet Ninjini', 'Molten Hot Dog', 'Tree Rex - Gnarly']) {
      e.ctx.p = { ...product, 'product-name': name }; const g = e.run('floorToyGroup({product:p,condition:"new",toyGroup:"auto"})');
      assert.equal(g, 'rare', name);
      if (g === 'rare') assert.equal(e.run('floorResult({product:p,condition:"new",toyGroup:"common",typed:850,sales:{new:[]}}).r.price'), 2500);
    }
    e.ctx.p = { ...product, 'product-name': 'Bash - Unknown Finish' };
    assert.equal(e.run('floorToyGroup({product:p,condition:"new"})'), 'review');
    for (const name of ['Golden Queen - Imaginators', 'Dark Creation Crystal', 'Water Creation Crystal', 'Fright Rider - Giants', 'Trigger Happy - Series 2', 'Super Shot Stealth Elf - Superchargers']) {
      e.ctx.p = { ...product, 'product-name': name }; assert.equal(e.run('floorToyGroup({product:p,condition:"new"})'), 'common', name);
    }
  });
  await test('Springtime aliases and marketing edition are accepted, different characters and variants are not', () => {
    const e = engine();
    for (const title of ['Skylanders Swap Force SPRINGTIME TRIGGER HAPPY New', 'Trigger Happy Easter Spring Edition New', 'Springtime Trigger Happy Limited Edition Easter Variant No Gold No Glory']) {
      e.ctx.title = title; assert.equal(e.run('floorListingMismatch(title,product)'), null, title);
    }
    for (const title of ['Trigger Happy Legendary New', 'Trigger Happy Power Blue New', 'Trigger Happy New', 'Springtime Spyro New', 'Springtime Trigger Happy 3 pack', 'Springtime Trigger Happy Deluxe Edition', 'Springtime Trigger Happy preorder', 'Springtime Trigger Happy + Spyro bundle']) {
      e.ctx.title = title; assert.ok(e.run('floorListingMismatch(title,product)'), title);
    }
  });
  await test('recovers misplaced $39 Springtime new sale without sibling variants or other conditions', async () => {
    const calls = [], e = engine(async (route, p) => {
      calls.push([route, p]);
      if (route === 'pc/products') return { products: [standard, product, { ...standard, id: '3', 'product-name': 'Spyro' }, { ...standard, id: '4', 'console-name': 'Wii' }] };
      return { sales: String(p.id) === '1' ? { new: [sale('Springtime Trigger Happy New', 1200, '111111111111')] } : {
        new: [sale('Skylanders Swap Force SPRINGTIME TRIGGER HAPPY New', 3900), sale('Power Blue Trigger Happy New', 7400, '222222222222'), sale('Springtime Trigger Happy used', 9000, '333333333333')],
        loose: [sale('Springtime Trigger Happy', 1605, '444444444444')] } };
    });
    const sold = await e.fetch(); assert.equal(calls.length, 3); assert.equal(sold.sales.new.length, 2); assert.equal(sold.sales.loose.length, 1);
    e.ctx.sold = sold; assert.equal(e.run('floorResult({product,condition:"new",...sold}).r.price'), 4000);
    assert.equal(sold.sales.new[1].sourcePcId, '2'); assert.equal(sold.salesError, null);
  });
  await test('same listing across pages counts once, including eBay tracking URLs', async () => {
    const s = sale('Springtime Trigger Happy New', 3900);
    const e = engine(async (route, p) => route === 'pc/products' ? { products: [standard, standard] } : { sales: { new: [{ ...s, url: String(p.id) === '1' ? s.url : s.url + '?tracking=abc' }] } });
    const sold = await e.fetch(); assert.equal(sold.sales.new.length, 1); assert.equal(sold.salesSources.length, 2);
  });
  await test('related failures preserve evidence and visibly flag incomplete checks', async () => {
    const e = engine(async (route, p) => { if (route === 'pc/products') return { products: [standard] }; if (String(p.id) === '2') throw Error('Service unavailable'); return { sales: { new: [sale('Springtime Trigger Happy New', 3000)] } }; });
    const sold = await e.fetch(); assert.equal(sold.sales.new.length, 1); assert.match(sold.salesError, /Service unavailable/);
    e.ctx.sold = sold; assert.ok(e.run('floorResult({product,condition:"new",...sold}).b.checks.some(n=>n.includes("incomplete"))'));
  });
  await test('empty selected page can recover evidence; catalog failures cannot look complete', async () => {
    const e = engine(async (route, p) => route === 'pc/products' ? { products: [standard] } : { sales: String(p.id) === '1' ? {} : { new: [sale('Springtime Trigger Happy BNIB', 2999)] } });
    assert.equal((await e.fetch()).sales.new.length, 1);
    const failed = engine(async (route) => { if (route === 'pc/products') throw Error('Search unavailable'); return { sales: {} }; });
    assert.match((await failed.fetch()).salesError, /Search unavailable/);
  });
  await test('related lookup is bounded and reports omitted pages', async () => {
    let calls = 0;
    const e = engine(async (route) => { calls++; return route === 'pc/products' ? { products: Array.from({ length: 20 }, (_, i) => ({ ...standard, id: String(i + 2) })) } : { sales: {} }; });
    assert.match((await e.fetch()).salesError, /eight/); assert.equal(calls, 10);
  });
  await test('ordinary games and Infinity do not search related character pages', async () => {
    const e = engine(async (route) => { assert.equal(route, 'pc/sales'); return { sales: { new: [sale('Example', 2000)] } }; });
    for (const system of ['Playstation 4', 'Disney Infinity']) { const r = await e.fetch({ ...product, 'console-name': system }); assert.equal(r.sales.new.length, 1); assert.equal(r.salesNotes.length, 0); }
  });
  console.log(`${checks} Skylander sales checks passed.`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
