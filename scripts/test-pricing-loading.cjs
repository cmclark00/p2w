'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync('trade-in/app.js', 'utf8').replace(/\binit\(\);\s*$/, '');
const product = { id: '1', 'product-name': 'Example Game', 'console-name': 'Playstation 4', 'cib-price': 2000, 'gamestop-price': 1000 };
const sale = { title: 'Example Game PS4 CIB', price: 2500, url: 'https://www.ebay.com/itm/123456789012' };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(setImmediate);
function engine(request) {
  const elements = new Map();
  const element = s => { if (!elements.has(s)) elements.set(s, { innerHTML: '', addEventListener() {} }); return elements.get(s); };
  const ctx = vm.createContext({ console, Date, URL, URLSearchParams, setTimeout, clearTimeout, product, sale,
    fetch: async url => { const q = new URL(url, 'https://example.test/').searchParams; const route = q.get('route'); q.delete('route');
      const data = await request(route, Object.fromEntries(q)); return { ok: true, status: 200, json: async () => data }; },
    localStorage: { getItem: () => null, setItem() {} }, document: { querySelector: element, addEventListener() {} } });
  vm.runInContext(fs.readFileSync('trade-in/dead-games.js', 'utf8'), ctx);
  vm.runInContext(source, ctx);
  return { ctx, element, run: js => vm.runInContext(js, ctx) };
}
(async () => {
  const switchLoad = engine();
  switchLoad.run(`tokenSet=true; amazonSet=true;
    loadFloorSales=()=>{}; loadFloorAmazon=()=>{}; closeFloorResults=()=>{};
    PC.byId=async()=>({id:'12','product-name':'Example Adventure','console-name':'Nintendo Switch',
      'release-date':new Date().toISOString().slice(0,10),'gamestop-price':9999});
    const selected={id:'12','product-name':'Example Adventure','console-name':'Nintendo Switch','gamestop-price':9999,upc:'123456789012'};
    pickFloorGame(selected);`);
  assert.equal(switchLoad.run('floorCur.fullLoading'),true,'Missing release date triggers full product fetch even with UPC/GS');
  await tick();
  assert.equal(switchLoad.run('floorCur.product["release-date"]'),new Date().toISOString().slice(0,10));
  assert.match(switchLoad.element('#floorPricer').innerHTML,/Checking MSRP/);
  assert.match(switchLoad.element('#floorPricer').innerHTML,/data-floor-act="add" disabled/);
  switchLoad.run(`floorCur.amazon={found:true,msrpCandidates:[{asin:'B000000001',title:'Example Adventure Nintendo Switch',platforms:['Nintendo Switch'],msrp:5999,msrpSource:'amazon-list-price'}]};renderFloorPricer();`);
  assert.match(switchLoad.element('#floorPricer').innerHTML,/\$54.99/);
  assert.match(switchLoad.element('#floorPricer').innerHTML,/MSRP <strong>\$59.99<\/strong>/);
  assert.match(switchLoad.element('#floorPricer').innerHTML,/data-floor-act="add">/);
  assert.equal(switchLoad.run('floorCur.directEbay'),undefined,'No automatic eBay tab work for fixed MSRP');
  console.log('PASS Switch release-date enrichment, exact MSRP UI and no unrelated sale checks');
  const matching = engine();
  matching.run(`computeCalls=0; const originalCompute=floorComputeListingMismatch;
    floorComputeListingMismatch=(...args)=>{computeCalls++;return originalCompute(...args);};
    for(let i=0;i<100;i++) floorListingMismatch('Example Game PS4 CIB',product);`);
  assert.equal(matching.run('computeCalls'),1,'unchanged titles do not repeat expensive matching on every render');
  assert.equal(matching.run(`floorListingMismatch('Example Game PS4 CIB',{...product,'product-name':'Other Game'})`), 'Listing does not confirm the selected game or product');
  assert.equal(matching.run(`floorListingMismatch('Example Game PS4 CIB',{...product,'console-name':'Playstation 5'})`), 'Different platform');
  matching.run(`floorListingMismatch('Example Game PS4 CIB',{...product,genre:'Systems'});
    floorListingMismatch('Example Game PS4 + Controller',product);`);
  assert.equal(matching.run('computeCalls'),5,'identity, platform, genre and title changes invalidate matching');
  matching.run(`floorListingMismatch('Example Game PS4 CIB',product);
    settings.flatItems={keywords:['Example Game']};
    floorListingMismatch('Example Game PS4 CIB',product);`);
  assert.equal(matching.run('computeCalls'),6,'changed hardware classification cannot reuse a game match');
  matching.run(`for(let i=0;i<2010;i++) floorListingMismatch('Other Game '+i,product);`);
  assert.equal(matching.run('floorListingMatchCache.size'),2000,'cache stays bounded throughout a long shift');
  const redraw = engine();
  redraw.run(`renderCount=0; renderFloorPricer=()=>{renderCount++;}; floorCur={product,condition:'cib'};
    for(let i=0;i<10;i++)queueFloorPricerRender(floorCur,'cib');`);
  assert.equal(redraw.run('renderCount'),0,'background progress cannot render recursively');
  await new Promise(r=>setTimeout(r,10));
  assert.equal(redraw.run('renderCount'),1,'one paint for a burst of progress updates');
  redraw.run(`queueFloorPricerRender(floorCur,'cib');floorCur={product,condition:'loose'};`);
  await new Promise(r=>setTimeout(r,10));
  assert.equal(redraw.run('renderCount'),1,'queued old-game updates cannot overwrite a new lookup');
  console.log('PASS bounded matching reuse and coalesced background redraws preserve identity and cancellation');
  const primary = deferred(), related = deferred(), stock = deferred(), calls = [];
  const e = engine((route, params) => {
    calls.push([route, params]);
    if (route === 'pc/sales') return primary.promise;
    if (route === 'pc/products') return related.promise;
    if (route === 'gamestop/stock') return stock.promise;
    throw Error(route);
  });
  e.run('amazonSet=true; settings.floorPremiums=[{phrase:"Example Game",pct:20}]; floorCur={product,condition:"cib",sales:null,amazon:{loading:true},pick:null};');
  const loading = e.run('loadFloorSales(product)');
  assert.deepEqual(calls.map(c => c[0]), ['pc/sales', 'pc/products'], 'selected sales start before related search');
  primary.resolve({ sales: { cib: [sale] }, gamestopUrl: 'https://www.gamestop.com/products/example/123.html' });
  await tick();
  assert.equal(calls.at(-1)[0], 'gamestop/stock', 'stock starts while related search is still pending');
  assert.equal(e.run('floorResult(floorCur).r'), null);
  assert.equal(e.run('floorEstimate(floorCur).price'), 3000, 'preview applies the configured premium');
  let html = e.element('#floorPricer').innerHTML;
  assert.match(html, /Estimate<\/span><strong>\$30.00/);
  assert.match(html, /Estimate may change/);
  assert.match(html, /data-floor-act="add" disabled/);
  assert.match(html, /Example Game PS4 CIB/);
  related.resolve({ products: [] });
  await loading;
  assert.equal(calls.filter(c => c[0] === 'pc/sales').length, 1, 'primary request is reused');
  assert.equal(calls.filter(c => c[0] === 'gamestop/stock').length, 1, 'stock request is not duplicated');
  assert.equal(e.run('floorCur.salesLoading'), false);
  assert.equal(e.run('floorResult(floorCur).r'), null, 'stock and Amazon still block the final price');
  stock.resolve({ state: 'out', title: 'Example Game PS4' }); await tick();
  assert.equal(e.run('floorResult(floorCur).r'), null, 'Amazon still blocks the final price');
  e.run('floorCur.amazon={found:false};renderFloorPricer()');
  assert.equal(e.run('floorResult(floorCur).r.price'), 3000);
  html = e.element('#floorPricer').innerHTML;
  assert.match(html, /Needs review<\/span><strong>\$30.00/);
  assert.match(html, /data-floor-act="add">/);
  assert.equal(e.run('floorEstimate({...floorCur,sales:{},salesLoading:true})'), null, 'no estimate without valid evidence');
  assert.equal(e.run('floorResult({...floorCur,salesLoading:true,typed:4000}).r.price'), 4000, 'explicit typed override remains available');
  e.run('floorCur={...floorCur,product:{...product,"product-name":"Concord"},salesLoading:true,sales:{cib:[{...sale,title:"Concord PS5 CIB"}]}}');
  assert.equal(e.run('floorEstimate(floorCur)'), null, 'Dead Games hold also blocks estimates');
  console.log('PASS early selected sales, parallel stock, premium-aware estimate, final-price safeguards and Dead Games hold');

  // Exercise the actual source callbacks/render loop: GameStop plus one eBay,
  // then pairs without waiting for Amazon; late catalog evidence is re-evaluated.
  const gsGate = deferred(), saleGate = deferred(), catalogGate = deferred(), ebayJobs = [];
  const live = engine((route) => {
    if (route === 'pc/sales') return saleGate.promise;
    if (route === 'pc/products') return catalogGate.promise;
    throw Error(route);
  });
  let gsStarted = false;
  live.ctx.window = {
    P2WGameStopHelper: { check: () => { gsStarted = true; return gsGate.promise; } },
    P2WEbayHelper: { targetedAvailable: async () => true, checkTargeted: url => {
      const job = deferred(); ebayJobs.push({ ...job, url }); return job.promise;
    } }
  };
  live.run('amazonSet=true;floorCur={product,condition:"cib",sales:null,amazon:{loading:true},pick:null}');
  const liveLoad = live.run('loadFloorSales(product)');
  const rows = [2500, 2400, 2300, 2200].map((price, i) => ({ ...sale, price, url: `https://www.ebay.com/itm/${123456789012 + i}` }));
  saleGate.resolve({ sales: { cib: rows }, gamestopUrl: 'https://www.gamestop.com/products/example/123.html' });
  await tick(); assert.equal(gsStarted, true); assert.equal(ebayJobs.length, 1, 'First eBay starts before GameStop completes');
  ebayJobs[0].resolve({ id: '123456789012', state: 'ended', title: sale.title }); await tick();
  assert.equal(ebayJobs.length, 1, 'GameStop retains the second slot');
  gsGate.resolve({ state: 'out', title: 'Example Game PS4' }); await tick();
  assert.equal(ebayJobs.length, 3, 'Next pair starts before Amazon and catalog finish');
  ebayJobs[1].resolve({ id: '123456789013', state: 'sold', title: sale.title, price: 2400 });
  ebayJobs[2].resolve({ id: '123456789014', state: 'ended', title: sale.title }); await tick();
  assert.equal(live.run('floorResult(floorCur).r'), null, 'Final price still waits for all sources');
  catalogGate.resolve({ products: [] }); await liveLoad;
  live.run('floorCur.amazon={found:false};renderFloorPricer()'); await tick();
  assert.equal(ebayJobs.length, 3, 'Source completion does not repeat checks');
  assert.equal(live.run('floorResult(floorCur).b.basis'), 2400);
  assert.equal(live.run('floorCur.ebayChecks.results["123456789013"].state'), 'sold');
  console.log('PASS GameStop/first-sale overlap, subsequent pairs during Amazon loading and final source gating');

  let count = 0; const catalog = deferred();
  const cached = engine(() => { count++; return catalog.promise; });
  const a = cached.run('pcReadRequest("pc/products",{q:"  Example   Game PS4 "})');
  const b = cached.run('pcReadRequest("pc/products",{q:"example game ps4"})');
  assert.equal(count, 1);
  catalog.resolve({ products: [product] });
  const [ra, rb] = await Promise.all([a, b]);
  ra.products[0]['product-name'] = 'Mutated';
  assert.equal(rb.products[0]['product-name'], product['product-name']);
  await cached.run('pcReadRequest("pc/products",{q:"EXAMPLE GAME PS4"})');
  assert.equal(count, 1);
  cached.run('for(const v of pcReadCache.values())v.expires=0');
  await cached.run('pcReadRequest("pc/products",{q:"example game ps4"})');
  assert.equal(count, 2, 'expired reads refresh');
  let attempts = 0;
  const failed = engine(() => { if (++attempts === 1) throw Error('Temporary failure'); return { products: [] }; });
  await assert.rejects(failed.run('pcReadRequest("pc/products",{q:"Example"})'));
  await failed.run('pcReadRequest("pc/products",{q:"Example"})');
  assert.equal(attempts, 2, 'failures remain retryable');
  console.log('PASS in-flight reuse, canonical search keys, isolated objects, expiration and failure retries');

  const oldPrimary = deferred(), oldSearch = deferred(), oldCalls = [];
  const old = engine((route, params) => { oldCalls.push([route, params]); return route === 'pc/sales' ? oldPrimary.promise : oldSearch.promise; });
  old.run('floorCur={product,condition:"cib",sales:null}');
  const stale = old.run('loadFloorSales(product)');
  old.run('floorCur={product:{...product,id:"99"},condition:"cib",sales:null}');
  oldPrimary.resolve({ sales: { cib: [sale] } }); oldSearch.resolve({ products: [{ ...product, id: '2' }] });
  await stale;
  assert.equal(old.run('floorCur.product.id'), '99');
  assert.equal(old.run('floorCur.sales'), null);
  assert.equal(oldCalls.length, 2, 'superseded lookup does not queue more PC requests');
  console.log('PASS replaced lookups cannot overwrite the current game or queue more PriceCharting reads');

  const sky = { id: '1', 'product-name': 'Trigger Happy - Swap Force, Spring Time', 'console-name': 'Skylanders', 'loose-price': 1200 };
  const pending = new Map(); let active = 0, peak = 0;
  const parallel = engine(); parallel.ctx.sky = sky;
  parallel.ctx.request = async (route, params) => {
    if (route === 'pc/products') return { products: [2, 3, 4].map(id => ({ ...sky, id: String(id), 'product-name': 'Trigger Happy' })) };
    const d = deferred(); pending.set(String(params.id), d); peak = Math.max(peak, ++active);
    const result = await d.promise; active--; return result;
  };
  const gathering = parallel.run('fetchFloorProductSales(sky,request)'); await tick();
  assert.equal(peak, 3);
  const row = { title: 'Springtime Trigger Happy with original box', price: 3000, url: sale.url };
  pending.get('3').resolve({ sales: { cib: [row] } }); await tick();
  assert.ok(pending.has('4')); assert.equal(peak, 3);
  pending.get('4').resolve({ sales: { loose: [row] } });
  pending.get('2').resolve({ sales: { loose: [row] } });
  pending.get('1').resolve({ sales: { cib: [row] } });
  const gathered = await gathering;
  assert.equal(gathered.sales.loose.length, 1);
  assert.equal(gathered.sales.loose[0].sourcePcId, '1', 'primary source wins regardless of finish order');
  assert.equal(gathered.sales.loose[0].sourceCondition, 'cib');
  console.log('PASS bounded parallel figure requests preserve conditions, deduplication and source ordering');
})().catch(err => { console.error(err); process.exitCode = 1; });
