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
  const quickPending = deferred(), quickCalls = [];
  const quickData = { sales: {
    loose: [{ ...sale, title: 'Example Game PS4 Disc Only', price: 1499 }],
    cib: [{ ...sale, price: 5000, date: new Date().toISOString().slice(0,10) },
      { ...sale, title: 'Example Game PS4 CIB Bundle Lot of 3 Games', price: 3900 },
      { ...sale, title: 'Example Game Xbox One CIB', price: 3800 },
      { ...sale, title: 'Example Game PS4 PAL Italian CIB', price: 3700 },
      { ...sale, date: new Date().toISOString().slice(0,10) }],
    new: [{ ...sale, title: 'Example Game PS4 New Sealed', price: 1800 }],
  } };
  const quick = engine((route, params) => {
    quickCalls.push({ route, params });
    assert.equal(route,'pc/sales','Quick mode only reads the selected PriceCharting sales page');
    assert.equal(params.id,'1');
    return quickPending.promise;
  });
  quick.run(`tokenSet=true; amazonSet=true; closeFloorResults=()=>{};
    lowProduct={...product,'loose-price':999,'cib-price':1499,'new-price':1200,'gamestop-price':5999};
    pickFloorGame(lowProduct);`);
  assert.equal(quick.run('floorQuickPricing(floorCur)'),true);
  assert.equal(quick.run('floorResult(floorCur).b.waiting'),true);
  assert.match(quick.element('#floorPricer').innerHTML,/data-floor-act="add" disabled/);
  quick.run('startFloorResearch();renderFloorPricer();');
  quickPending.resolve(quickData);
  await tick();
  assert.equal(quickCalls.length,1,'Repaints do not repeat the selected-page lookup');
  assert.equal(quick.run('floorResult(floorCur).r.price'),5000,'Highest PC sale wins without exclusions or unchecked GameStop');
  assert.equal(quick.run('floorBasis().from'),'pcsale');
  assert.equal(quick.run('floorQuickSales(floorCur).length'),5,'Quick mode keeps bundles, platform/region mismatches and high outliers');
  assert.equal(quick.run('floorCur.salesRequested'),undefined);
  assert.equal(quick.run('floorCur.fullRequested'),undefined,'Missing UPC alone does not trigger research');
  assert.equal(quick.run('floorCur.directEbay'),undefined);
  assert.equal(quick.run('floorCur.amazon'),undefined);
  assert.match(quick.element('#floorPricer').innerHTML,/Highest PriceCharting sale: \$50.00/);
  assert.match(quick.element('#floorPricer').innerHTML,/Unfiltered · not verified/);
  assert.match(quick.element('#floorPricer').innerHTML,/class="floor-sales"/);
  assert.match(quick.element('#floorPricer').innerHTML,/class="picked"/);
  assert.match(quick.element('#floorPricer').innerHTML,/Bundle Lot of 3 Games/);
  assert.doesNotMatch(quick.element('#floorPricer').innerHTML,/data-sale="|Sold price verified/,'Quick rows are links for review, not full-research selections');
  assert.match(quick.element('#floorPricer').innerHTML,/data-floor-act="research"/);
  assert.match(quick.element('#floorPricer').innerHTML,/data-floor-act="add">/);
  assert.doesNotMatch(quick.element('#floorPricer').innerHTML,/No matching offers|Reading recent sales/);
  assert.equal(quick.run('floorBasisInfo(floorBasis()).quickPricing'),true,'Saved result records skipped research');
  assert.equal(quick.run(`floorResult({...floorCur,condition:'new'}).r.price`),5000,'Quick sealed price retains CIB sale floor');
  assert.equal(quick.run('floorBasisInfo(floorBasis()).saleDate'),new Date().toISOString().slice(0,10));
  assert.equal(quick.run(`floorBasis({...floorCur,quickSales:{sales:{loose:[],cib:[],new:[]}}}).quickFallback`),true);
  assert.equal(quick.run(`floorResult({...floorCur,quickSales:{error:'offline'}}).r.price`),1500,'Failed lookup visibly falls back to condition average');
  assert.match(quick.run(`floorBasis({...floorCur,quickSales:{error:'offline'}}).checks.join(' ')`),/check failed.*offline/);
  assert.equal(quick.run(`floorBasis({...floorCur,typed:1800}).basis`),1800,'Typed price remains an explicit override');
  for (const price of [0, null, undefined, 1500, 1501]) {
    quick.ctx.testPrice=price;
    assert.equal(quick.run(`floorQuickPricing({...floorCur,product:{...lowProduct,'cib-price':testPrice}})`),false,`Full research at missing/$15+ value ${price}`);
  }
  quick.run(`settings.floorPremiums.push({phrase:'Example Game',pct:25});`);
  assert.equal(quick.run('floorQuickPricing(floorCur)'),false,'Specific premiums keep researched pricing');
  quick.run(`settings.floorPremiums.pop();`);
  for (const [name, platform] of [
    ['Xbox One Elite Wireless Controller','Xbox One'], ['Spyro','Skylanders'],
    ['Example Game [Deluxe Edition]','Playstation 4'], ['Example Game','Nintendo Switch'],
  ]) {
    quick.ctx.specialProduct={...product,'product-name':name,'console-name':platform,'cib-price':999};
    assert.equal(quick.run('floorQuickPricing({...floorCur,product:specialProduct})'),false,`${name} keeps its evidence-dependent rules`);
  }
  quick.run(`onFloorPricerClick({target:{closest:s=>s==='[data-floor-cond]'?{dataset:{floorCond:'loose'}}:null}});`);
  assert.equal(quick.run('floorResult(floorCur).r.price'),1500,'Condition-specific PC sales select quick price');
  assert.equal(quickCalls.length,1,'All conditions reuse one PriceCharting response');
  quick.run(`salesStarts=0; amazonStarts=0; fullStarts=0;
    loadFloorSales=()=>{salesStarts++;floorCur.salesLoading=true;};
    loadFloorAmazon=()=>{amazonStarts++;floorCur.amazon={loading:true};};
    PC.byId=async()=>{fullStarts++;return {...lowProduct,upc:'123456789012'};};
    onFloorPricerClick({target:{closest:s=>s==='[data-floor-act]'?{dataset:{floorAct:'research'}}:null}});`);
  await tick();
  assert.equal(quick.run('floorQuickPricing(floorCur)'),false);
  assert.equal(quick.run('salesStarts'),1);
  assert.equal(quick.run('amazonStarts'),1);
  assert.equal(quick.run('fullStarts'),1);
  assert.doesNotMatch(quick.element('#floorPricer').innerHTML,/data-floor-act="research"/);
  quick.run('startFloorResearch();renderFloorPricer();');
  assert.equal(quick.run('salesStarts'),1,'Repainting/re-entry does not duplicate research');
  assert.equal(quick.run('amazonStarts'),1);
  assert.equal(quick.run('fullStarts'),1);
  quick.run(`floorCur.researchRequested=false;
    floorCur.product['cib-price']=1500;
    onFloorPricerClick({target:{closest:s=>s==='[data-floor-cond]'?{dataset:{floorCond:'cib'}}:null}});`);
  assert.equal(quick.run('floorQuickPricing(floorCur)'),false,'Switching to $15 condition starts full mode');
  quick.run(`onFloorPricerClick({target:{closest:s=>s==='[data-floor-cond]'?{dataset:{floorCond:'loose'}}:null}});`);
  assert.equal(quick.run('floorQuickPricing(floorCur)'),true);
  assert.equal(quick.run('floorResult(floorCur).b.waiting'),undefined,'Old full-mode work cannot keep quick mode waiting');
  assert.equal(quick.run('floorResult(floorCur).r.price'),1500);
  console.log('PASS $15 quick cutoff, manual research, condition changes, CIB floor and premium exceptions');
  const quickRecheck = engine((route) => { assert.equal(route,'pc/sales'); return quickData; });
  quickRecheck.run(`amazonSet=true; savedCalls=0; stockCalls=0; amzCalls=0;
    renderFloorList=()=>{};toast=()=>{};
    PC.byId=async id=>({...product,id,'gamestop-price':0,'cib-price':id==='2'?1500:999});
    fetchFloorProductSales=async()=>{savedCalls++;return {sales:{cib:[]}};};
    fetchFloorAmazon=async()=>{amzCalls++;return {found:false};};
    fetchFloorGameStopStock=async()=>{stockCalls++;return {state:'unknown'};};
    floor.items=[{pcId:'1',condition:'cib',price:500,quickPricing:true},
      {pcId:'2',condition:'cib',price:500,quickPricing:true},
      {pcId:'3',condition:'cib',price:500}];`);
  await quickRecheck.run('recheckFloorPrices()');
  assert.equal(quickRecheck.run('savedCalls'),2,'Only still-cheap quick items skip related-page research on recheck');
  assert.equal(quickRecheck.run('amzCalls'),2);
  assert.equal(quickRecheck.run('stockCalls'),2);
  assert.equal(quickRecheck.run('floor.items[0].recheck.quickPricing'),true);
  assert.equal(quickRecheck.run('floor.items[0].recheck.price'),5000,'Saved quick rechecks use highest unfiltered sale');
  assert.equal(quickRecheck.run('floor.items[1].recheck.quickPricing'),undefined);
  quickRecheck.run('useRecheck(floor.items[0]);useRecheck(floor.items[1]);');
  assert.equal(quickRecheck.run('floor.items[0].quickPricing'),true);
  assert.equal(quickRecheck.run('floor.items[1].quickPricing'),false);
  console.log('PASS quick saved-list rechecks retain provenance and promote $15+ items to research');
  const latePage = deferred();
  const quickRace = engine(() => latePage.promise);
  quickRace.run(`tokenSet=true; closeFloorResults=()=>{};
    pickFloorGame({...product,'cib-price':999});
    loadFloorSales=()=>{floorCur.sales={cib:[{...sale,price:2200}]};};
    PC.byId=async()=>({...product,upc:'123456789012'});
    runFloorEbaySearch=()=>{};runFloorTargetedEbay=()=>{};
    onFloorPricerClick({target:{closest:s=>s==='[data-floor-act]'?{dataset:{floorAct:'research'}}:null}});`);
  latePage.resolve(quickData);
  await tick();
  assert.equal(quickRace.run('floorQuickPricing(floorCur)'),false);
  assert.equal(quickRace.run('floorCur.sales.cib[0].price'),2200,'Late quick response cannot overwrite full research');
  const quickFailure = engine(() => { throw new Error('offline'); });
  quickFailure.run(`tokenSet=true;closeFloorResults=()=>{};pickFloorGame({...product,'cib-price':999});`);
  await tick();
  assert.match(quickFailure.element('#floorPricer').innerHTML,/PriceCharting fallback/);
  assert.equal(quickFailure.run('floorBasis().quickFallback'),true);
  assert.equal(quickFailure.run('floorBasis().waiting'),undefined,'Failed quick lookup cannot get stuck loading');
  console.log('PASS quick lookup failures and late responses preserve fallback and full research');
  const sealed = engine();
  sealed.run(`amazonSet=false; pendingComparisons=[];
    runFloorEbaySearch=(cur,progress,cancelled)=>{
      if(cur.directEbay?.condition===cur.condition)return;
      cur.directEbay={condition:cur.condition,loading:true};pendingComparisons.push({cur,cancelled});
    }; runFloorTargetedEbay=()=>{};
    floorCur={product:{...product,'gamestop-price':0},condition:'new',sales:{
      new:[{title:'Example Game PS4 sealed',price:2999}],cib:[{title:'Example Game PS4 CIB',price:3999}]}};
    renderFloorPricer();`);
  assert.equal(sealed.run('pendingComparisons.length'),2,'New selected directly starts its CIB comparison too');
  assert.match(sealed.element('#floorPricer').innerHTML,/Checking CIB comparison/);
  assert.match(sealed.element('#floorPricer').innerHTML,/data-floor-act="add" disabled/);
  sealed.run(`for(const {cur} of pendingComparisons)cur.directEbay={condition:cur.condition,loading:false,result:{state:'ready',sales:[]}};
    renderFloorPricer();renderFloorPricer();`);
  assert.equal(sealed.run('pendingComparisons.length'),2,'repainting does not repeat comparisons');
  assert.equal(sealed.run('floorResult(floorCur).r.price'),4000);
  assert.match(sealed.element('#floorPricer').innerHTML,/held at CIB price \$40.00/);
  sealed.run('floorCur.condition="cib"');
  assert.equal(sealed.run('pendingComparisons[0].cancelled()'),true,'leaving New cancels its background CIB work');
  sealed.run(`floorCur.amazon={loading:true};floorCur.directEbay={condition:'cib',loading:true};
    floorCur.ebayChecks={loading:true,results:{a:{state:'pending'},b:{state:'sold'}}};loadFloorAmazon=()=>{};
    onFloorPricerClick({target:{closest:selector=>selector==='[data-floor-cond]'?{dataset:{floorCond:'new'}}:null}});`);
  assert.equal(sealed.run('floorCur.cibComparison.ebayChecks.results.a'),undefined,'abandoned pending checks cannot stick');
  assert.equal(sealed.run('floorCur.cibComparison.ebayChecks.results.b.state'),'sold');
  assert.equal(sealed.run('floorCur.cibComparison.amazon'),null,'abandoned Amazon load cannot stick');
  console.log('PASS New CIB floor, final-price gating, cached checks and condition-switch cancellation');
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
  switchLoad.run(`floorCur.amazon={found:true,publisherCandidates:[{asin:'B000000001',title:'Example Adventure Nintendo Switch',platforms:['Nintendo Switch'],publishers:['Nintendo'],publisherSource:'amazon-manufacturer'}],msrpCandidates:[{asin:'B000000001',title:'Example Adventure Nintendo Switch',platforms:['Nintendo Switch'],msrp:5999,msrpSource:'amazon-list-price'}]};renderFloorPricer();`);
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
