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
  // Legacy identity/pagination fixtures omit grade; give their synthetic offers
  // a matching grade. Grade-policy regressions below supply explicit sub values.
  ctx.request = async (route, params) => {
    const result = await request(route, params);
    return result.offers ? { ...result, offers: result.offers.map(o => ({
      sub: params.cond === 'new' ? 'new' : ctx.condition === 'loose' ? 'good' : 'very_good', ...o })) } : result;
  };
  vm.runInContext(source, ctx);
  return { ctx, run: (js) => vm.runInContext(js, ctx), fetch: (p = product, condition = 'loose') => {
    ctx.p = p; ctx.condition = condition; return vm.runInContext('fetchFloorAmazon(p, condition, request)', ctx);
  } };
}
let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log('PASS ' + name); }
(async () => {
  await test('PSVR catalog labels match PS4 games without accepting PSVR2, headsets or sequels', async () => {
    const p={id:'astro','product-name':'Astro Bot Rescue Mission','console-name':'Playstation 4','cib-price':1500};
    const good=candidate('B07FWG1KC6','ASTRO Bot Rescue Mission - PlayStation VR',['PlayStation 4']);
    const e=engine(async(route,params)=>route==='amazon/catalog'?{candidates:[good]}:
      {...offer(good,null),condition:params.cond==='new'?'New':'Used',offers:params.cond==='used'?
        [{price:3777,sub:'very_good'},{price:2984,sub:'very_good'}]:[]});
    e.ctx.p=p;e.ctx.a=good;
    assert.equal(e.run('floorAmazonCandidateMismatch(a,p,"cib",true)'),null);
    for(const label of ['PlayStation VR','PSVR','PS VR']) {
      e.ctx.a={...good,title:`ASTRO Bot Rescue Mission - ${label}`,platforms:[label]};
      assert.equal(e.run('floorAmazonCandidateMismatch(a,p,"cib",true)'),null,label);
      assert.equal(e.run('floorListingMismatch(a.title,p)'),null,label);
    }
    for(const title of ['ASTRO Bot Rescue Mission - PlayStation VR2', 'ASTRO Bot Rescue Mission - PSVR 2',
      'ASTRO Bot Rescue Mission - PlayStation VR Headset Bundle', 'ASTRO Bot Rescue Mission - PlayStation VR Deluxe Edition',
      'ASTRO Bot Rescue Mission - PlayStation VR Reborn', 'ASTRO Bot Rescue Mission French Version - PlayStation VR']) {
      e.ctx.a={...good,title};assert.ok(e.run('floorAmazonCandidateMismatch(a,p,"cib",true)'),title);
    }
    e.ctx.p5={...p,'console-name':'Playstation 5'};
    for(const label of ['PlayStation VR2','PlayStation VR 2','PSVR2','PS VR2']) {
      e.ctx.a={...good,title:`ASTRO Bot Rescue Mission - ${label}`,platforms:[label]};
      assert.equal(e.run('floorAmazonCandidateMismatch(a,p5,"cib",true)'),null,label);
      assert.ok(e.run('floorAmazonCandidateMismatch(a,p,"cib",true)'),label);
    }
    e.ctx.result=await e.fetch(p,'cib');
    assert.equal(e.ctx.result.asin,good.asin);
    assert.equal(e.run('floorAmazonLowest({product:p,condition:"cib",amazon:result})'),2984);
  });
  await test('manufacturer MSRP survives verified lookups with no used offers and excludes wrong matches', async () => {
    const p={'product-name':'Example Adventure','console-name':'Nintendo Switch','release-date':new Date().toISOString().slice(0,10)};
    const good={asin:'B000000001',title:'Example Adventure Nintendo Switch',platforms:['Nintendo Switch'],publishers:['Nintendo'],publisherSource:'amazon-manufacturer'};
    const bad={asin:'B000000002',title:'Example Adventure Deluxe Edition Nintendo Switch',platforms:['Nintendo Switch']};
    const e=engine(async(route,params)=>{
      if(route==='amazon/catalog')return {candidates:[good,bad]};
      const c=params.asin===good.asin?good:bad;
      return {...c,found:true,condition:params.cond==='new'?'New':'Used',offers:[],count:0,
        msrp:params.asin===good.asin?5999:9999,msrpSource:'amazon-list-price'};
    });
    const r=await e.fetch(p,'cib');
    assert.ok(r.msrpCandidates.length>0);assert.ok(r.msrpCandidates.every(c=>c.asin===good.asin && c.msrp===5999));
    assert.ok(r.rejected.some(c=>c.asin===bad.asin));
    e.ctx.current={product:p,condition:'cib',amazon:r};
    assert.equal(e.run('floorResult(current).r.price'),5499);
  });
  await test('catalog prefetch is bounded at two while matching keeps barcode order and every query', async () => {
    const good=candidate('B000000001'),bad=candidate('B000000001','Final Fight Guy');
    const pending=[],calls=[];let active=0,peak=0,offers=0;
    const e=engine(async(route,params)=>{
      calls.push([route,params]);
      if(route!=='amazon/catalog'){offers++;return offer(good,2500);}
      peak=Math.max(peak,++active);
      const data=await new Promise(resolve=>pending.push({params,resolve}));active--;return data;
    });
    const task=e.fetch({...product,upc:'123456789012 123456789013 123456789014'});
    const tick=()=>new Promise(r=>setImmediate(r));
    await tick();assert.equal(pending.length,2);assert.equal(peak,2);
    pending[1].resolve({candidates:[bad]});await tick();assert.equal(pending.length,3);
    assert.equal(offers,0,'Later barcode response cannot decide identity before earlier barcode');
    pending[0].resolve({candidates:[good]});await tick();
    for(let i=2;i<4;i++){assert.ok(pending[i]);pending[i].resolve({candidates:[]});await tick();}
    const result=await task;
    assert.equal(result.asin,good.asin);assert.equal(result.offers[0].price,2500);assert.equal(peak,2);
    assert.equal(calls.filter(([r])=>r==='amazon/catalog').length,4,'All three UPCs and title query checked');
    assert.equal(offers,2,'Duplicate ASIN checks still coalesce');
  });
  await test('sealed-item Used comparisons queue together without affecting New pricing', async () => {
    const choices=[candidate('B000000001'),candidate('B000000002'),candidate('B000000003')], pending=[];
    const e=engine(async(route,params)=>{
      if(route==='amazon/catalog')return {candidates:choices};
      const c=choices.find(c=>c.asin===params.asin);
      if(params.cond==='used')await new Promise(resolve=>pending.push(resolve));
      return {...offer(c,params.cond==='new'?6000:1000),condition:params.cond==='new'?'New':'Used'};
    });
    const task=e.fetch(product,'new');await new Promise(r=>setImmediate(r));
    assert.equal(pending.length,3,'Comparisons enter batch queue together instead of serial HTTP calls');
    pending.forEach(resolve=>resolve());const result=await task;
    assert.equal(result.offers[0].price,6000);assert.equal(result.references.used.offers[0].price,1000);
  });
  await test('Loose accepts all Used grades while CIB keeps packaging-grade filters and rejects ungraded lowest', () => {
    const e=engine(async()=>{});
    e.ctx.cur={product,condition:'loose',amazon:{...candidate('B000000001'),found:true,condition:'Used',lowest:100,offers:[
      {price:1000,sub:'Acceptable'},{price:1800,sub:'Good'},{price:1400,sub:'Very Good'},
      {price:1200,sub:'LikeNew'},{price:1300,sub:'mint'},{price:100,sub:null}]}};
    assert.equal(e.run('floorAmazonLowest(cur)'),100);
    e.run('cur.condition="cib"');assert.equal(e.run('floorAmazonLowest(cur)'),1200);
    for(const offers of [[{price:1400,sub:'very_good'}],[{price:1300,sub:'like_new'}],[{price:1300,sub:'Mint'}]]) {
      e.ctx.cur.amazon.offers=offers;assert.equal(e.run('floorAmazonLowest(cur)'),offers[0].price);
    }
    for(const offers of [[],[{price:1000,sub:'good'}],[{price:1000,sub:'acceptable'}],[{price:1000}],[{price:1000,sub:'other'}]]) {
      e.ctx.cur.amazon.offers=offers;assert.equal(e.run('floorAmazonLowest(cur)'),null);
    }
    e.run('cur.condition="loose"');e.ctx.cur.amazon.offers=[{price:1400,sub:'very_good'},{price:1200,sub:'acceptable'}];
    assert.equal(e.run('floorAmazonLowest(cur)'),1200);
    for(const product of [{'product-name':'Bash','console-name':'Skylanders'},{'product-name':'Playstation 4 Console','console-name':'Playstation 4'}]) {
      e.ctx.cur.product=product;e.ctx.cur.amazon.title=product['product-name'];e.ctx.cur.amazon.platforms=[product['console-name']];
      e.ctx.cur.amazon.offers=[{price:1000,sub:'acceptable'}];e.ctx.cur.condition='cib';
      assert.equal(e.run('floorAmazonLowest(cur)'),1000,'Game packaging policy leaves figures and hardware unchanged');
    }
  });
  await test('Loose compares every Used grade and New across ASINs without Good priority', async () => {
    const first=candidate('B000000001'),second=candidate('B000000002');
    for(const grade of ['acceptable','good','very_good','like_new','mint','other',null]) {
      for(const newPrice of [6000,2000]) {
        const e=engine(async(route,p)=>{
          if(route==='amazon/catalog'){assert.ok(!p.q?.endsWith('renewed'));return {candidates:[first,second]};}
          return {...offer(p.asin===first.asin?first:second,null),condition:p.cond==='new'?'New':'Used',
            offers:p.cond==='new'?[{price:newPrice,sub:'new'}]:[{price:p.asin===first.asin?4500:2500,sub:p.asin===first.asin?'good':grade}]};
        });
        const result=await e.fetch();e.ctx.result=result;
        assert.equal(e.run('floorAmazonLowest({product,condition:"loose",amazon:result})'),Math.min(newPrice,2500));
        assert.equal(result.references.used.asin,second.asin);
        assert.equal(result.newReference,newPrice<2500);
        const html=e.run('floorAmazonReferencesHtml({product,condition:"loose",amazon:result},{from:"amazon"},true)');
        assert.match(html,newPrice<2500?/Amazon New.*selected/:/Amazon Used.*selected/);
        assert.ok(result.matchNotes.some(n=>n.includes('every Used grade and New')));
      }
    }
  });
  await test('CIB picks cheaper Very Good or Like New across listings and keeps each condition cache separate', async () => {
    const first=candidate('B000000001'),second=candidate('B000000002');let calls=0;
    const e=engine(async(route,p)=>{calls++;return route==='amazon/catalog'?{candidates:[first,second]}:{...offer(p.asin===first.asin?first:second,null),
      condition:p.cond==='new'?'New':'Used',offers:p.cond==='new'?[{price:10000,sub:'new'}]:[
        {price:4500,sub:'good'},{price:800,sub:'acceptable'},{price:p.asin===first.asin?3000:2000,sub:p.asin===first.asin?'very_good':'like_new'}]};});
    const loose=await e.fetch(product,'loose'),cib=await e.fetch(product,'cib');
    e.ctx.loose=loose;e.ctx.cib=cib;
    assert.equal(e.run('floorAmazonLowest({product,condition:"loose",amazon:loose})'),800);
    assert.equal(e.run('floorAmazonLowest({product,condition:"cib",amazon:cib})'),2000);
    assert.equal(cib.asin,second.asin);const count=calls;await e.fetch(product,'loose');await e.fetch(product,'cib');assert.equal(calls,count);
    e.run('amazonSet=true');
    const html=e.run('floorAmazonHtml({product,condition:"cib",amazon:cib},{from:"amazon"})');
    assert.match(html,/Used · Like new/);assert.match(html,/Not used for this condition/);assert.match(html,/lowest eligible/);
  });
  await test('condition switches reload Amazon and stale Loose responses cannot overwrite CIB', async () => {
    const e=engine(async()=>{}),jobs=[];
    e.ctx.fetchGrades=(_p,condition)=>new Promise(resolve=>jobs.push({condition,resolve}));
    e.run('amazonSet=true; renderFloorPricer=()=>{}; fetchFloorAmazon=fetchGrades; floorCur={product,condition:"loose",amazon:null};');
    const old=e.run('loadFloorAmazon()');
    e.ctx.event={target:{closest:selector=>selector==='[data-floor-cond]'?{dataset:{floorCond:'cib'}}:null}};
    e.run('onFloorPricerClick(event)');assert.equal(jobs.length,2);assert.equal(jobs[1].condition,'cib');
    jobs[1].resolve({found:false,marker:'cib'});await new Promise(setImmediate);
    jobs[0].resolve({found:false,marker:'loose'});await old;
    assert.equal(e.run('floorCur.amazon.marker'),'cib');
  });

  await test('all UPC candidates are checked before offers; wrong game, platform and French variant cannot win', async () => {
    const good = candidate('B000000001'), calls = [];
    const e = engine(async (route, params) => { calls.push([route, params]);
      if (route === 'amazon/catalog') return { candidates: [candidate('B000000002', 'Final Fight Guy'), candidate('B000000003', 'Final Fight', ['Sega CD']), candidate('B000000004', 'Final Fight French Version'), good, good] };
      assert.equal(params.asin, good.asin); return offer(good, 2500);
    });
    const result = await e.fetch(); assert.equal(result.asin, good.asin); assert.equal(result.rejected.length, 3);
    assert.equal(calls.length, 4); assert.equal(result.searched, true);
  });
  await test('wrong barcode falls back to title/platform and links the cheapest verified ASIN', async () => {
    const a = candidate('B000000001'), b = candidate('B000000002', 'Final Fight SNES'); const calls = [];
    const e = engine(async (route, params) => { calls.push([route, params]);
      if (route === 'amazon/catalog') return { candidates: params.upc ? [candidate('B000000003', 'Final Fight Guy')] : [a, b, candidate('B000000004', 'Final Fight Sega CD', ['Sega CD'])] };
      return offer(params.asin === a.asin ? a : b, params.asin === a.asin ? 4000 : 2200);
    });
    const result = await e.fetch(); assert.equal(result.asin, b.asin); assert.equal(result.url, b.url);
    assert.equal(result.matchMethod, 'title/platform search'); assert.equal(result.offers[0].price, 2200);
    assert.equal(calls[1][1].q, 'Final Fight Super Nintendo'); assert.equal(calls.length, 6);
    e.ctx.result = result; e.run('amazonSet=true');
    const html = e.run('floorAmazonHtml({product,condition:"loose",amazon:result},{from:"amazon"})');
    assert.ok(html.includes(b.url)); assert.ok(!html.includes('B000000003')); assert.ok(html.includes('Compared 2 verified'));
  });
  await test('missing UPC searches directly and requires positive platform evidence', async () => {
    const calls = [], good = candidate('B000000001', 'Final Fight - Super NES', []);
    const e = engine(async (route, params) => { calls.push([route, params]);
      if (route === 'amazon/catalog') return { candidates: [candidate('B000000002', 'Final Fight', []), good] };
      return { ...offer(good, params.cond === 'new' ? 4500 : 2500), condition: params.cond === 'new' ? 'New' : 'Used' };
    });
    const result = await e.fetch({ ...product, upc: '' }, 'new'); assert.equal(result.asin, good.asin); assert.equal(calls.length, 3);
    assert.equal(result.offers[0].price,4500);assert.equal(result.references.used.offers[0].price,2500);
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
    await e.fetch(); const looseCalls = calls; await e.fetch(product, 'cib'); assert.ok(calls > looseCalls, 'Loose and CIB have separate result caches'); const after = calls; await e.fetch(product, 'cib'); assert.equal(calls, after);
    await e.fetch(product, 'new'); assert.equal(calls, after + 4);
    const other = await e.fetch({ ...product, id: '2', 'product-name': 'Final Fight Guy' });
    assert.equal(other.found, false); assert.ok(calls > after + 2);
  });
  await test('fallback preserves condition, specific premiums and the lowest-offer baseline', async () => {
    const p = { ...product, 'release-date': '2019-11-15', 'product-name': 'Pokemon Shield', 'console-name': 'Nintendo Switch' };
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
  await test('more than 24 matching offers finish automatically while failed offer checks remain partial', async () => {
    const candidates = Array.from({length:26},(_,i)=>candidate('B'+String(i).padStart(9,'0')));
    const many = engine(async (route, params) => route === 'amazon/catalog' ? {candidates}
      : offer(candidates.find(c=>c.asin===params.asin),params.asin===candidates.at(-1).asin?2000:2500));
    const completeMany = await many.fetch(); assert.equal(completeMany.incomplete, undefined);
    assert.equal(completeMany.asin,candidates.at(-1).asin, 'last offer can supply the lowest price without Continue');
    many.ctx.result = completeMany;
    assert.equal(many.run('floorAmazonLowest({product,condition:"loose",amazon:result})'),2000);
    const broken = engine(async (route, params) => {
      if (route === 'amazon/catalog') return { candidates: [candidate('B000000001'), candidate('B000000002')] };
      if (params.asin === 'B000000002') throw Error('Offer lookup failed'); return offer(candidate('B000000001'), 99900);
    });
    const partial = await broken.fetch(); assert.equal(partial.incomplete,true); assert.match(partial.searchError,/Offer lookup failed/);
  });
  await test('Lollipop Chainsaw PS3 finds renewed offers only after regular listings are unpriced', async () => {
    const p = { ...product, 'product-name': 'Lollipop Chainsaw', 'console-name': 'Playstation 3' };
    const regular = candidate('B000000001', 'Lollipop Chainsaw - PS3', ['PlayStation 3']);
    const renewed = candidate('B000000002', 'Lollipop Chainsaw - PS3 (Renewed)', ['PlayStation 3']);
    const calls = [];
    const e = engine(async (route, params) => {
      calls.push([route, params]);
      if (route === 'amazon/catalog') return { candidates: params.q?.endsWith('renewed') ? [renewed] : [regular, renewed] };
      if (params.asin === regular.asin) return offer(regular, null);
      return { ...offer(renewed, params.cond === 'new' ? 9999 : 11000), condition: params.cond === 'new' ? 'New' : 'Used' };
    });
    const result = await e.fetch(p, 'cib');
    assert.equal(result.asin, renewed.asin); assert.equal(result.renewedFallback, true); assert.equal(result.offers[0].price, 9999);
    assert.deepEqual(calls.filter(([route])=>route==='amazon/catalog').map(([,p])=>p.q || p.upc),
      [product.upc,'Lollipop Chainsaw Playstation 3','Lollipop Chainsaw Playstation 3 renewed']);
    assert.equal(calls.filter(([route]) => route === 'amazon/offers').length, 4);
    e.ctx.result = result; e.ctx.p = p;
    const priced = e.run('floorResult({product:p,condition:"cib",sales:{cib:[{title:"Lollipop Chainsaw PS3 complete",price:12999}]},amazon:result})');
    assert.equal(priced.b.basis, 12999); assert.equal(priced.b.from, 'sale');
    assert.equal(priced.b.referenceMin, 12999); assert.equal(priced.r.price, 13000);
    assert.ok(priced.b.checks.some(n => n.includes('Renewed fallback')));
    e.run('amazonSet=true');
    assert.match(e.run('floorAmazonHtml({product:p,condition:"cib",amazon:result},{from:"amazon"})'), /Amazon Renewed fallback offers/);
  });
  await test('regular priced offers always take priority over cheaper or higher renewed offers', async () => {
    for (const viaSearch of [false, true]) {
      const good = candidate('B000000001'), renewed = candidate('B000000002', 'Final Fight SNES (Renewed)');
      const e = engine(async (route, params) => {
        if (route === 'amazon/catalog') {
          assert.ok(!params.q?.endsWith('renewed'));
          return { candidates: viaSearch && params.upc ? [renewed] : [renewed, good] };
        }
        assert.equal(params.asin, good.asin); return offer(good, 2500);
      });
      const result = await e.fetch(); assert.equal(result.asin, good.asin); assert.equal(result.renewedFallback, false);
    }
  });
  await test('used/CIB Amazon reference uses cheaper New while premiums and source floors remain intact', async () => {
    const p={...product,'release-date':'2019-11-15','product-name':'Pokemon Shield','console-name':'Nintendo Switch'};
    const good=candidate('B000000001','Pokemon Shield Nintendo Switch',['Nintendo Switch']);
    const e=engine(async(route,params)=>{
      if(route==='amazon/catalog') {assert.ok(!params.q?.endsWith('renewed'));return {candidates:[good]};}
      return {...offer(good,params.cond==='new'?6000:9000),condition:params.cond==='new'?'New':'Used'};
    });
    const result=await e.fetch(p,'cib');assert.equal(result.newReference,true);assert.equal(result.renewedFallback,false);
    assert.equal(result.offers[0].price,6000);e.ctx.p=p;e.ctx.result=result;e.run('amazonSet=true');
    const cur='{product:p,condition:"cib",sales:{cib:[{title:"Pokemon Shield Nintendo Switch CIB",price:5000}]},amazon:result}';
    const priced=e.run(`floorResult(${cur})`);assert.equal(priced.premium.pct,10);assert.equal(priced.r.price,6500);
    assert.match(e.run(`floorAmazonHtml(${cur},{from:"amazon"})`),/Amazon new offers/);
    assert.equal(e.run('floorResult({product:{...p,"gamestop-price":10000},condition:"cib",sales:{cib:[]},amazon:result}).b.basis'),10000);
    assert.equal(e.run('floorResult({product:p,condition:"cib",sales:{cib:[{title:"Pokemon Shield Nintendo Switch CIB",price:11000}]},amazon:result}).b.basis'),11000);
  });
  await test('CIB selects the lower eligible Used or New price, preferring Used on a tie', async () => {
    for(const newPrice of [1500,2500,9000]) {
      const good=candidate('B000000001');
      const e=engine(async(route,params)=>route==='amazon/catalog'?{candidates:[good]}:offer(good,params.cond==='new'?newPrice:2500));
      const result=await e.fetch(product,'cib');assert.equal(result.offers[0].price,Math.min(newPrice,2500));assert.equal(result.newReference,newPrice<2500);
    }
  });
  await test('They Always Run CIB uses 29.99 New over 41.99 Like New and rounds to 30', async () => {
    const p={id:'they-run','product-name':'They Always Run','console-name':'Playstation 4','cib-price':1635,'gamestop-price':1499};
    const good=candidate('B000000001','They Always Run Playstation 4',['Playstation 4']);
    const e=engine(async(route,params)=>route==='amazon/catalog'?{candidates:[good]}:
      {...offer(good,null),condition:params.cond==='new'?'New':'Used',offers:[{price:params.cond==='new'?2999:4199,sub:params.cond==='new'?'new':'like_new'}]});
    e.ctx.result=await e.fetch(p,'cib');e.ctx.p=p;e.run('amazonSet=true');
    assert.equal(e.ctx.result.newReference,true);
    assert.equal(e.run('floorResult({product:p,condition:"cib",amazon:result,sales:{cib:[{price:2254,title:"They Always Run PS4 CIB"}]}}).r.price'),3000);
    assert.match(e.run('floorAmazonReferencesHtml({product:p,condition:"cib",amazon:result},{from:"amazon"},true)'),/Amazon New.*\$29.99.*selected/);
  });
  await test('separate Used/New links retain their prices and distinguish the selected reference from the shelf baseline', async () => {
    const used=candidate('B000000001'),fresh=candidate('B000000002');
    const e=engine(async(route,params)=>route==='amazon/catalog'?{candidates:[used,fresh]}
      : {...offer(params.asin===used.asin?used:fresh,params.cond==='used'?(params.asin===used.asin?4000:5000):(params.asin===fresh.asin?3000:6000)),condition:params.cond==='new'?'New':'Used'});
    const result=await e.fetch(product,'cib');assert.equal(result.references.used.asin,used.asin);assert.equal(result.references.new.asin,fresh.asin);
    assert.equal(result.asin,fresh.asin);assert.equal(result.offers[0].price,3000, "Cheaper New prices CIB, with both references visible");
    e.ctx.result=result;e.run('amazonSet=true');
    const html=e.run('floorAmazonReferencesHtml({product,condition:"cib",amazon:result},{from:"sale"})');
    assert.ok(html.includes(used.url)&&html.includes(fresh.url));assert.match(html,/\$40\.00/);assert.match(html,/\$30\.00/);
    assert.match(html,/Selected Amazon reference/);assert.doesNotMatch(html,/Sets baseline/);
    assert.match(e.run('floorAmazonReferencesHtml({product,condition:"cib",amazon:result},{from:"amazon"})'),/Sets baseline/);
    const pinned=e.run('floorAmazonReferencesHtml({product,condition:"cib",amazon:result},{from:"amazon"},true)');
    assert.match(pinned,/Amazon Used/);assert.match(pinned,/Amazon New/);assert.match(pinned,/selected/);
    e.ctx.result.incomplete=true;
    assert.doesNotMatch(e.run('floorAmazonReferencesHtml({product,condition:"cib",amazon:result},{from:"sale"},true)'),/selected/);
  });
  await test('Used comparisons on a sealed item never price it and a display-only failure does not block New', async () => {
    const good=candidate('B000000001');
    for(const fail of [false,true]) {
      const e=engine(async(route,params)=>{
        if(route==='amazon/catalog')return {candidates:[good]};
        if(params.cond==='used'&&fail)throw Error('Used unavailable');
        return {...offer(good,params.cond==='new'?6000:1000),condition:params.cond==='new'?'New':'Used'};
      });
      const result=await e.fetch(product,'new');assert.equal(result.incomplete,undefined);assert.equal(result.offers[0].price,6000);
      e.ctx.result=result;
      assert.equal(e.run('floorAmazonLowest({product,condition:"new",amazon:result})'),6000);
      const html=e.run('floorAmazonReferencesHtml({product,condition:"new",amazon:result},{from:"amazon"})');
      if(fail)assert.match(html,/Check failed/);else assert.match(html,/\$10\.00/);
    }
  });
  await test('CIB uses regular New before searching Renewed when eligible Used is absent', async () => {
    for(const [newPrice,renewedPrice] of [[7394,7024],[6000,7024],[6000,null]]) {
      const regular=candidate('B000000001'),renewed=candidate('B000000002','Final Fight SNES (Renewed)');let renewedChecked=false;
      const e=engine(async(route,params)=>{
        if(route==='amazon/catalog') {if(params.q?.endsWith('renewed')){renewedChecked=true;return {candidates:[renewed]};}return {candidates:[regular]};}
        const item=params.asin===regular.asin?regular:renewed;
        return {...offer(item,item===regular?(params.cond==='new'?newPrice:null):renewedPrice),condition:params.cond==='new'?'New':'Used'};
      });
      const result=await e.fetch(product,'cib');assert.equal(renewedChecked,false);assert.equal(result.newReference,true);
      e.ctx.result=result;assert.equal(e.run('floorAmazonLowest({product,condition:"cib",amazon:result})'),newPrice);
      assert.equal(result.references.new.offers[0].price,newPrice);
    }
  });
  await test('New can price CIB while wrong games and foreign editions remain excluded', async () => {
    const good=candidate('B000000001','Final Fight SNES Factory Sealed'),bad=candidate('B000000002','Final Fight Guy SNES Factory Sealed'),french=candidate('B000000003','Final Fight French Version SNES Factory Sealed');
    const e=engine(async(route,params)=>{
      if(route==='amazon/catalog') return {candidates:[good,bad,french]};
      assert.equal(params.asin,good.asin);return {...offer(good,params.cond==='new'?6000:null),condition:params.cond==='new'?'New':'Used'};
    });
    const result=await e.fetch(product,'cib');assert.equal(result.references.new.asin,good.asin);e.ctx.result=result;assert.equal(e.run('floorAmazonLowest({product,condition:"cib",amazon:result})'),6000);
    assert.ok(result.rejected.some(r=>r.asin===bad.asin));assert.ok(result.rejected.some(r=>r.asin===french.asin));
  });
  await test('Loose waits for New failures to recover and does not reuse an incomplete higher Used price', async () => {
    const good=candidate('B000000001');let fail=true,usedCalls=0;
    const e=engine(async(route,p)=>{
      if(route==='amazon/catalog')return {candidates:[good]};
      if(p.cond==='used'){usedCalls++;return {...offer(good,4500),condition:'Used'};}
      if(fail)throw Error('New lookup rate limited');return {...offer(good,2800),condition:'New'};
    });
    e.ctx.result=await e.fetch();assert.equal(e.ctx.result.incomplete,true);
    assert.equal(e.run('floorAmazonLowest({product,condition:"loose",amazon:result})'),null);
    fail=false;e.ctx.result=await e.fetch();assert.equal(e.ctx.result.incomplete,undefined);
    assert.equal(e.run('floorAmazonLowest({product,condition:"loose",amazon:result})'),2800);assert.equal(usedCalls,1);
  });
  await test('Loose uses regular New before considering Renewed and retains Renewed when both regular conditions lack offers', async () => {
    for(const fresh of [3000,null]) {
      const regular=candidate('B000000001'),renewed=candidate('B000000002','Final Fight SNES (Renewed)');let renewedChecked=false;
      const e=engine(async(route,p)=>{
        if(route==='amazon/catalog'){if(p.q?.endsWith('renewed')){renewedChecked=true;return {candidates:[renewed]};}return {candidates:[regular]};}
        return {...offer(p.asin===regular.asin?regular:renewed,p.asin===regular.asin?(p.cond==='new'?fresh:null):2000),condition:p.cond==='new'?'New':'Used'};
      });
      e.ctx.result=await e.fetch();assert.equal(renewedChecked,fresh===null);
      assert.equal(e.run('floorAmazonLowest({product,condition:"loose",amazon:result})'),fresh||2000);
    }
  });
  await test('CIB waits for a failed New check, then resumes to select the cheaper New price', async () => {
    const good=candidate('B000000001');let fail=true,usedCalls=0;
    const e=engine(async(route,params)=>{
      if(route==='amazon/catalog')return {candidates:[good]};
      if(params.cond==='used'){usedCalls++;return offer(good,9000);}
      if(fail)throw Error('New offers unavailable');return {...offer(good,6000),condition:'New'};
    });
    e.ctx.result=await e.fetch(product,'cib');assert.equal(e.ctx.result.incomplete,true);
    assert.equal(e.run('floorAmazonLowest({product,condition:"cib",amazon:result})'),null);assert.equal(usedCalls,1);
    fail=false;e.ctx.result=await e.fetch(product,'cib');assert.equal(e.ctx.result.incomplete,undefined);
    assert.equal(e.run('floorAmazonLowest({product,condition:"cib",amazon:result})'),6000);assert.equal(usedCalls,1);
  });
  await test('renewed fallback still rejects wrong games, platforms, imports, editions, bundles and digital copies', async () => {
    const bad = [candidate('B000000001', 'Final Fight Guy (Renewed)'), candidate('B000000002', 'Final Fight Sega CD (Renewed)', ['Sega CD']),
      candidate('B000000003', 'Final Fight French Version (Renewed)'), candidate('B000000004', 'Final Fight Special Edition (Renewed)'),
      candidate('B000000005', 'Final Fight + Street Fighter Bundle (Renewed)'), candidate('B000000006', 'Final Fight Digital Download Code (Renewed)'),
      candidate('B000000007', 'Final Fight (Renewed)', [])];
    const e = engine(async (route, params) => {
      assert.equal(route, 'amazon/catalog'); return { candidates: params.q?.endsWith('renewed') ? bad : [] };
    });
    const result = await e.fetch(); assert.equal(result.found, false); assert.equal(result.rejected.length, bad.length);
  });
  await test('renewed fallback rechecks offer identity and cannot price sealed copies', async () => {
    const renewed = candidate('B000000001', 'Final Fight SNES (Renewed)');
    const e = engine(async (route, params) => route === 'amazon/catalog' ? { candidates: [renewed] }
      : offer({ ...renewed, title: 'Final Fight Guy SNES (Renewed)' }, 99900));
    assert.equal((await e.fetch()).found, false);
    const sealed = engine(async (route, params) => {
      assert.equal(route, 'amazon/catalog'); assert.ok(!params.q?.endsWith('renewed')); return { candidates: [renewed] };
    });
    assert.equal((await sealed.fetch(product, 'new')).found, false);
    sealed.ctx.result = { ...offer(renewed, 2500), renewedFallback: true };
    assert.equal(sealed.run('floorAmazonLowest({product,condition:"new",amazon:result})'), null);
  });
  await test('renewed failures and missing prices are not represented as a priced fallback', async () => {
    const renewed = candidate('B000000001', 'Final Fight SNES (Renewed)');
    const e = engine(async (route) => route === 'amazon/catalog' ? { candidates: [renewed] } : offer(renewed, null));
    const result = await e.fetch(); assert.equal(result.offers.length, 0);
    assert.ok(result.matchNotes.some(n => n.includes('no Amazon price used')));
    const failed = engine(async (route, params) => {
      if (route === 'amazon/catalog') return { candidates: [renewed] };
      if (params.cond === 'new') throw Error('Renewed lookup failed'); return offer(renewed, 9000);
    });
    const partial = await failed.fetch(); assert.equal(partial.incomplete,true); assert.match(partial.searchError,/Renewed lookup failed/);
    failed.ctx.result=partial;
    assert.equal(failed.run('floorAmazonLowest({product,condition:"loose",amazon:result})'),null);
  });
  await test('specific premiums remain applied after the three-source maximum with Renewed', async () => {
    const p = { ...product, 'release-date': '2019-11-15', 'product-name': 'Pokemon Shield', 'console-name': 'Nintendo Switch' };
    const renewed = candidate('B000000001', 'Pokemon Shield Nintendo Switch (Renewed)', ['Nintendo Switch']);
    const e = engine(async (route) => route === 'amazon/catalog' ? { candidates: [renewed] } : offer(renewed, 6000));
    e.ctx.result = await e.fetch(p, 'cib'); e.ctx.p = p;
    const result = e.run('floorResult({product:p,condition:"cib",sales:{cib:[{title:"Pokemon Shield Nintendo Switch",price:9000}]},amazon:result})');
    assert.equal(result.b.basis, 9000); assert.equal(result.premium.pct, 10); assert.equal(result.r.price, 10000);
  });
  await test('Renewed and regular Amazon both use the three-source maximum', () => {
    const e = engine(async () => { throw Error('No network needed'); });
    e.ctx.result = { ...offer(candidate('B000000001', 'Final Fight SNES (Renewed)'), 9999), renewedFallback: true };
    let priced = e.run('floorResult({product:{...product,"gamestop-price":11000},condition:"cib",sales:{cib:[{title:"Final Fight SNES complete",price:12999}]},amazon:result})');
    assert.equal(priced.b.basis, 12999); assert.equal(priced.b.from, 'sale'); assert.equal(priced.r.price, 13000);
    priced = e.run('floorResult({product:{...product,"gamestop-price":14000},condition:"cib",sales:{cib:[{title:"Final Fight SNES complete",price:12999}]},amazon:result})');
    assert.equal(priced.b.from, 'gamestop'); assert.equal(priced.b.basis, 14000);
    e.ctx.result = offer(candidate('B000000001'), 9999);
    priced = e.run('floorResult({product,condition:"cib",sales:{cib:[{title:"Final Fight SNES complete",price:12999}]},amazon:result})');
    assert.equal(priced.b.basis, 12999); assert.equal(priced.r.price, 13000);
  });
  await test('specific discounts and missing-manual rules outrank the renewed baseline', () => {
    const e = engine(async () => { throw Error('No network needed'); });
    e.ctx.p = { ...product, 'product-name': 'Pokemon Black', 'console-name': 'Nintendo DS', 'gamestop-price': 14500 };
    e.ctx.result = { ...offer(candidate('B000000001', 'Pokemon Black Nintendo DS (Renewed)', ['Nintendo DS']), 15000), renewedFallback: true };
    const discounted = e.run('floorResult({product:p,condition:"cib",sales:{cib:[{title:"Pokemon Black Nintendo DS complete",price:20000}]},amazon:result})');
    assert.equal(discounted.b.basis, 20000); assert.equal(discounted.premium.pct, -14); assert.equal(discounted.r.price, 17000);
    e.ctx.result = { ...offer(candidate('B000000001', 'Final Fight SNES (Renewed)'), 9999), renewedFallback: true };
    const manual = e.run('floorResult({product,condition:"cib",manualMissing:true,sales:{cib:[{title:"Final Fight SNES complete",price:12999}]},amazon:result})');
    assert.equal(manual.b.basis, 12999); assert.ok(manual.r.price < 12999);
  });
  await test('priced barcode matches still compare title results, every known UPC, and subsequent catalog pages', async () => {
    const calls = [], a = candidate('B000000001'), b = candidate('B000000002'), c = candidate('B000000003');
    const e = engine(async (route, params) => {
      calls.push([route, params]);
      if (route === 'amazon/catalog') {
        if (params.upc) return { candidates: [params.upc === '123456789012' ? a : b] };
        return params.pageToken ? { candidates: [a, c] } : { candidates: [a], more: true, nextToken: 'page-two' };
      }
      const item = [a,b,c].find(x => x.asin === params.asin);
      return offer(item, {B000000001:4000,B000000002:3000,B000000003:2500}[item.asin]);
    });
    const r = await e.fetch({...product,upc:'123456789012, 123456789013'});
    assert.equal(r.asin,c.asin); assert.equal(r.offers[0].price,2500);
    assert.equal(calls.filter(([route]) => route === 'amazon/offers').length,6, 'each ASIN and condition requested once');
    assert.ok(calls.some(([,p]) => p.pageToken === 'page-two'));
  });
  await test('variant and standard Amazon prices stay separate while standard price can raise the baseline', async () => {
    const p = {...product,'product-name':'Final Fight [Special Edition]'};
    const special = candidate('B000000001','Final Fight Special Edition SNES'), regular = candidate('B000000002','Final Fight SNES');
    const e = engine(async (route, params) => route === 'amazon/catalog' ? {candidates:[special,regular]}
      : offer(params.asin === special.asin ? special : regular,params.asin === special.asin ? 2000 : 2500));
    const r = await e.fetch(p,'cib');
    assert.equal(r.asin,special.asin); assert.equal(r.offers[0].price,2000);
    assert.equal(r.standard.asin,regular.asin); assert.equal(r.standard.offers[0].price,2500);
    e.ctx.variant = p; e.ctx.result = r;
    assert.equal(e.run('floorResult({product:variant,condition:"cib",sales:{cib:[]},amazon:result}).r.price'),2500);
  });
  await test('missing edition uses standard Amazon fallback and exposes its condition prices without relabeling the match', async () => {
    const p = {...product, 'product-name':'Witcher 3: Wild Hunt [With Bonus Content]', 'console-name':'Playstation 4'};
    const regular = candidate('B000000002', 'Witcher 3 Wild Hunt PS4', ['Playstation 4']);
    const calls = [];
    const e = engine(async (route, params) => {
      calls.push([route, params]);
      return route === 'amazon/catalog' ? {candidates:[regular]} : offer(regular, params.cond === 'used' ? 4000 : 5000);
    });
    const r = await e.fetch(p,'cib');
    assert.equal(r.found,false,'standard listing does not become a false edition match');
    assert.equal(r.standard.asin,regular.asin);
    assert.ok(calls.some(([route,p]) => route === 'amazon/catalog' && p.q === 'Witcher 3: Wild Hunt Playstation 4'));
    e.ctx.result=r;e.ctx.variant=p;
    e.run('amazonSet=true; example={product:variant,condition:"cib",sales:{cib:[]},amazon:result}; basis=floorResult(example).b;');
    assert.equal(e.run('floorResult(example).r.price'),4000);
    assert.equal(e.run('basis.from'),'standard');
    const pin=e.run('floorAmazonReferencesHtml(example,basis,true)'), body=e.run('floorAmazonHtml(example,basis)');
    assert.match(pin,/Standard Amazon Used/); assert.match(pin,/\$40\.00/); assert.match(pin,/\$50\.00/);
    assert.ok(pin.includes(regular.url));
    assert.match(body,/Standard-game Amazon fallback/); assert.match(body,/Sets baseline/);
    assert.match(body,/No verified Amazon match for this edition/);
    assert.match(e.run('floorStandardHtml(basis)'),/Used · Very good/);
    e.run('example.amazon.standard.incomplete=true; basis=floorResult(example).b');
    assert.doesNotMatch(e.run('floorAmazonReferencesHtml(example,basis,true)'),/Standard Amazon/,'incomplete checks cannot become a usable fallback');
  });
  await test('variant and standard searches overlap, share requests and still wait for both prices', async () => {
    const p={...product,upc:'','product-name':'Final Fight [Special Edition]'};
    const special=candidate('B000000001','Final Fight Special Edition SNES'), regular=candidate('B000000002','Final Fight SNES');
    const calls=[];let release,finished=false;
    const gate=new Promise(resolve=>{release=resolve;});
    const e=engine(async(route,params)=>{
      calls.push([route,params]);
      if(route==='amazon/offers') return offer(params.asin===special.asin?special:regular,params.asin===special.asin?2000:2500);
      if(params.q.includes('Special Edition')) {await gate;return {candidates:[special]};}
      return {candidates:[regular]};
    });
    const pending=e.fetch(p,'cib').then(r=>{finished=true;return r;});
    await new Promise(setImmediate);
    assert.ok(calls.some(([r,v])=>r==='amazon/offers'&&v.asin===regular.asin),'standard offer starts while specific edition is still searching');
    assert.equal(finished,false,'cannot finish until both searches resolve');
    release();const result=await pending;
    assert.equal(result.asin,special.asin);assert.equal(result.standard.asin,regular.asin);
    assert.equal(calls.filter(([r,v])=>r==='amazon/catalog'&&v.q==='Final Fight Super Nintendo').length,1,'overlapping base-title request is sent once');
    e.ctx.result=result;e.ctx.p=p;
    assert.equal(e.run('floorResult({product:p,condition:"cib",sales:{cib:[]},amazon:result}).r.price'),2500);
  });
  await test('truncated catalogs and failed later pages cannot silently claim the lowest Amazon match', async () => {
    const incomplete = engine(async (route, params) => route === 'amazon/catalog'
      ? {candidates:[candidate('B000000001')],more:true} : offer(candidate('B000000001'),2500));
    const partial = await incomplete.fetch(); assert.equal(partial.incomplete,true); assert.match(partial.searchError,/incomplete/);
    const failed = engine(async (route, params) => {
      if (route !== 'amazon/catalog') return offer(candidate('B000000001'),2500);
      if (params.pageToken) throw Error('Later catalog page failed');
      return {candidates:[candidate('B000000001')],more:true,nextToken:'next'};
    });
    const failedPartial = await failed.fetch(); assert.equal(failedPartial.incomplete,true); assert.match(failedPartial.searchError,/Later catalog page failed/);
    failed.ctx.result=failedPartial; failed.run('amazonSet=true');
    const cur='{product,condition:"loose",sales:{loose:[{title:"Final Fight SNES",price:2000}]},amazon:result}';
    assert.equal(failed.run(`floorResult(${cur}).r.price`),2000, 'partial Amazon cannot silently raise baseline');
    const html=failed.run(`floorAmazonHtml(${cur},{from:"sale"})`);
    assert.ok(html.includes('$25.00') && html.includes('reference only') && html.includes('Retry Amazon'));
    assert.ok(!html.includes('lowest matching offer used'));
  });
  await test('large searches finish every page automatically without repeating completed requests', async () => {
    const a=candidate('B000000001'), b=candidate('B000000002'), calls=[];
    const e=engine(async(route,params)=>{
      calls.push([route,params]);
      if(route==='amazon/offers') return offer(params.asin===a.asin?a:b,params.asin===a.asin?5000:2000);
      if(params.upc) return {candidates:[a]};
      const page=Number(params.pageToken||1);
      return {candidates:page===35?[b]:[],more:page<35,nextToken:page<35?String(page+1):''};
    });
    const complete=await e.fetch();
    assert.equal(complete.incomplete,undefined); assert.equal(complete.asin,b.asin); assert.equal(complete.offers[0].price,2000);
    assert.equal(calls.filter(([r])=>r==='amazon/catalog').length,36, 'barcode plus every title page checked once');
    assert.equal(calls.filter(([r,p])=>r==='amazon/offers'&&p.asin===a.asin).length,2);
    const before=calls.length; await e.fetch(); assert.equal(calls.length,before,'completed result cached');
    e.ctx.result=complete;
    assert.equal(e.run('floorAmazonLowest({product,condition:"loose",amazon:result})'),2000);
  });
  await test('WWE Deluxe reaches Renewed after large regular searches without a Continue click', async () => {
    const p={...product,'product-name':'WWE 2K22 [Deluxe Edition]','console-name':'Playstation 4'};
    const regular=candidate('B000000001','WWE 2K22 Deluxe Edition - PlayStation 4',['PlayStation 4']);
    const renewed=candidate('B000000002','WWE 2K22 Deluxe Edition - PlayStation 4 (Renewed)',['PlayStation 4']);
    const e=engine(async(route,params)=>{
      if(route==='amazon/offers') return offer(params.asin===regular.asin?regular:renewed,params.asin===regular.asin?null:7024);
      if(params.upc) return {candidates:[regular]};
      const page=Number(params.pageToken||1), isRenewed=params.q.endsWith('renewed');
      return {candidates:isRenewed&&page===12?[renewed]:[],more:page<12,nextToken:page<12?String(page+1):''};
    });
    const result=await e.fetch(p,'cib');
    assert.equal(result.incomplete,undefined); assert.equal(result.standard.incomplete,undefined);
    assert.equal(result.asin,renewed.asin); assert.equal(result.renewedFallback,true);
    e.ctx.result=result;e.ctx.p=p;
    assert.equal(e.run('floorResult({product:p,condition:"cib",sales:{cib:[{title:"WWE 2K22 Deluxe Edition PS4",price:3498}]},amazon:result}).r.price'),7000);
  });
  await test('unpriced partial matches do not claim Amazon has no offers', async () => {
    const good=candidate('B000000001');let fail=true;
    const e=engine(async(route,params)=>{
      if(route==='amazon/offers') return offer(good,null);
      if(params.upc) return {candidates:[good]};
      if(fail) throw Error('Amazon temporarily unavailable');return {candidates:[]};
    });
    e.ctx.result=await e.fetch();e.run('amazonSet=true');
    let html=e.run('floorAmazonHtml({product,condition:"cib",amazon:result},{from:"sale"})');
    assert.match(html,/No priced offer found yet; Amazon search is incomplete/);
    assert.doesNotMatch(html,/No used offers on Amazon right now|No matching used offers returned/);
    fail=false;e.ctx.result=await e.fetch();
    html=e.run('floorAmazonHtml({product,condition:"cib",amazon:result},{from:"sale"})');
    assert.match(html,/No matching used offers returned by Amazon/);assert.doesNotMatch(html,/search is incomplete/);
  });
  await test('runaway pagination stops at the safety cap without an automatic retry loop', async () => {
    const good=candidate('B000000001');let pages=0;
    const e=engine(async(route,params)=>{
      if(route==='amazon/offers') return offer(good,2500);
      if(params.upc) return {candidates:[good]};
      pages++;return {candidates:[],more:true,nextToken:String(pages+1)};
    });
    const result=await e.fetch();assert.equal(pages,50);assert.equal(result.incomplete,true);
    assert.match(result.searchError,/50 pages/);e.ctx.result=result;
    assert.equal(e.run('floorAmazonLowest({product,condition:"loose",amazon:result})'),null);
  });
  await test('failed pages retry from saved progress and broken tokens are refetched', async () => {
    const a=candidate('B000000001'); let fail=true, firstPages=0, offers=0;
    const e=engine(async(route,params)=>{
      if(route==='amazon/offers'){offers++;return offer(a,2500);}
      if(params.upc) return {candidates:[]};
      if(!params.pageToken){firstPages++;return {candidates:[a],more:true,nextToken:'next'};}
      if(fail) throw Error('Temporary page failure'); return {candidates:[]};
    });
    assert.equal((await e.fetch()).incomplete,true); fail=false;
    assert.equal((await e.fetch()).incomplete,undefined); assert.equal(firstPages,1); assert.equal(offers,2);
    let calls=0;
    const token=engine(async(route)=>route==='amazon/offers'?offer(a,2500)
      : (++calls===1?{candidates:[a],more:true}:{candidates:[a]}));
    assert.equal((await token.fetch()).incomplete,true);
    assert.equal((await token.fetch()).incomplete,undefined); assert.equal(calls,3,'bad UPC page refetched, then title searched');
  });
  await test('catalog pages continue during offer I/O and final pricing waits for every matching member', async () => {
    const a=candidate('B000000001'), b=candidate('B000000002');
    let release, reachedLater;
    const gate=new Promise(r=>release=r), later=new Promise(r=>reachedLater=r);
    const e=engine(async(route,params)=>{
      if(route==='amazon/offers'){await gate;return offer(params.asin===a.asin?a:b,params.asin===a.asin?3000:2500);}
      if(params.pageToken){reachedLater();return {candidates:[b]};}
      if(params.upc)return {candidates:[a],more:true,nextToken:'later'};
      return {candidates:[a,b]};
    });
    let finished=false;const pending=e.fetch().then(r=>{finished=true;return r;});
    await later;assert.equal(finished,false);release();
    const result=await pending;e.ctx.result=result;
    assert.equal(result.incomplete,undefined);
    assert.equal(e.run('floorAmazonLowest({product,condition:"loose",amazon:result})'),2500);
  });
  await test('automatic Amazon retry resumes failed pages once and keeps successful offers cached', async () => {
    const a=candidate('B000000001');let later=0,first=0,offers=0,notices=0;
    const e=engine(async(route,params)=>{
      if(route==='amazon/offers'){offers++;return offer(a,2500);}
      if(params.upc)return {candidates:[]};
      if(!params.pageToken){first++;return {candidates:[a],more:true,nextToken:'later'};}
      if(++later===1)throw Error('Temporary later-page failure');
      return {candidates:[]};
    });
    e.ctx.condition='loose';e.ctx.onRetry=()=>notices++;
    e.ctx.result=await e.run('fetchFloorAmazonRetry(product,"loose",{request,onRetry,pause:async()=>{}})');
    assert.equal(notices,1);assert.equal(later,2);assert.equal(first,1);assert.equal(offers,2);
    assert.equal(e.ctx.result.incomplete,undefined);assert.equal(e.ctx.result.retryAttempted,undefined);
    assert.equal(e.run('floorAmazonLowest({product,condition:"loose",amazon:result})'),2500);
  });
  await test('automatic Amazon retry recovers a failed offer without refetching successful members', async () => {
    const a=candidate('B000000001');let used=0,fresh=0,catalogs=0;
    const e=engine(async(route,params)=>{
      if(route==='amazon/catalog'){catalogs++;return {candidates:[a]};}
      if(params.cond==='used'){used++;return offer(a,3000);}
      if(++fresh===1)throw Error('Offer throttled');
      return {...offer(a,2000),condition:'New'};
    });
    e.ctx.condition='loose';
    const result=await e.run('fetchFloorAmazonRetry(product,"loose",{request,pause:async()=>{}})');
    assert.equal(used,1);assert.equal(fresh,2);assert.equal(catalogs,2);
    assert.equal(result.newReference,true);assert.equal(result.offers[0].price,2000);
  });
  await test('persistent Amazon failures stop after one retry and partial prices stay excluded', async () => {
    const a=candidate('B000000001');let attempts=0;
    const e=engine(async(route,params)=>{
      if(route==='amazon/offers')return offer(a,2500);
      if(params.upc)return {candidates:[]};
      if(params.pageToken){attempts++;throw Error('Still unavailable');}
      return {candidates:[a],more:true,nextToken:'later'};
    });
    e.ctx.condition='loose';e.ctx.result=await e.run('fetchFloorAmazonRetry(product,"loose",{request,pause:async()=>{}})');
    assert.equal(attempts,2);assert.equal(e.ctx.result.incomplete,true);assert.equal(e.ctx.result.retryAttempted,true);
    assert.equal(e.ctx.result.offers[0].price,2500);
    assert.equal(e.run('floorAmazonLowest({product,condition:"loose",amazon:result})'),null);
    e.run('amazonSet=true');
    assert.match(e.run('floorAmazonHtml({product,condition:"loose",amazon:result},{})'),/Still incomplete after one automatic retry/);
    let failures=0;
    const failed=engine(async()=>{failures++;throw Error('Offline');});
    const value=await failed.run('fetchFloorAmazonRetry({...product,upc:""},"loose",{request,pause:async()=>{}})');
    assert.equal(failures,2);assert.equal(value.error,'Offline');assert.equal(value.retryAttempted,true);
  });
  await test('completed empty Amazon searches do not retry and cancellation prevents recovery work', async () => {
    let reads=0,notices=0;
    const e=engine(async()=>{reads++;return {candidates:[]};});
    e.ctx.onRetry=()=>notices++;
    await e.run('fetchFloorAmazonRetry(product,"loose",{request,onRetry,pause:async()=>{}})');
    assert.equal(notices,0);assert.equal(reads,3,'UPC, title and Renewed each searched once');
    let attempts=0;const cancelled=engine(async()=>{attempts++;throw Error('Offline');});
    cancelled.ctx.stop=false;
    await cancelled.run('fetchFloorAmazonRetry({...product,upc:""},"loose",{request,cancelled:()=>stop,onRetry:()=>{stop=true;},pause:async()=>{}})');
    assert.equal(attempts,1,'No retry after switching lookup');
  });
  await test('standard-game Amazon recovery is independent and first partial details survive transport failure', async () => {
    const e=engine(async()=>{});let attempts=0;
    e.ctx.fetchStub=async()=>++attempts===1?{found:false,standard:{error:'Temporary failure'}}:{found:false,standard:{found:false}};
    e.run('fetchFloorAmazon=fetchStub');
    const recovered=await e.run('fetchFloorAmazonRetry(product,"cib",{pause:async()=>{}})');
    assert.equal(attempts,2);assert.equal(recovered.standard.error,undefined);
    attempts=0;const a={...offer(candidate('B000000001'),2500),incomplete:true,searchError:'First failure'};
    e.ctx.fetchStub=async()=>{if(++attempts===1)return a;throw Error('Second failure');};e.run('fetchFloorAmazon=fetchStub');
    const retained=await e.run('fetchFloorAmazonRetry(product,"cib",{pause:async()=>{}})');
    assert.equal(retained.offers[0].price,2500);assert.equal(retained.incomplete,true);assert.equal(retained.searchError,'Second failure');
  });
  await test('New also loads an independent CIB comparison, sharing successful catalog and offer reads', async () => {
    const calls=[];
    const e=engine(async(route,params)=>{
      calls.push([route,JSON.stringify(params)]);
      if(route==='amazon/catalog')return {candidates:[candidate('B000000001')]};
      return {...offer(candidate('B000000001'),params.cond==='new'?3000:4000),condition:params.cond==='new'?'New':'Used'};
    });
    const a=await e.fetch(product,'new');
    assert.equal(a.condition,'New');assert.equal(a.cibComparison.condition,'New','CIB keeps cheaper-New policy');
    assert.equal(a.cibComparison.references.used.offers[0].price,4000);
    assert.equal(a.cibComparison.references.new.offers[0].price,3000);
    assert.equal(new Set(calls.map(JSON.stringify)).size,calls.length,'condition comparisons do not duplicate identical HTTP reads');
    await e.fetch(product,'cib');
    assert.equal(new Set(calls.map(JSON.stringify)).size,calls.length,'CIB result stays cached for condition switch');
  });
  await test('New retries a failed CIB comparison once and preserves its review status if still incomplete', async () => {
    const e=engine(async()=>{});let attempts=0;
    e.ctx.fetchStub=async()=>({found:true,condition:'New',cibComparison:++attempts===1?{incomplete:true}:{found:false}});
    e.run('fetchFloorAmazon=fetchStub');
    const done=await e.run('fetchFloorAmazonRetry(product,"new",{pause:async()=>{}})');
    assert.equal(attempts,2);assert.equal(done.cibComparison.incomplete,undefined);
    attempts=0;e.ctx.fetchStub=async()=>{attempts++;return {found:true,cibComparison:{found:false,standard:{error:'offline'}}};};
    e.run('fetchFloorAmazon=fetchStub');
    const partial=await e.run('fetchFloorAmazonRetry(product,"new",{pause:async()=>{}})');
    assert.equal(attempts,2);assert.equal(partial.cibComparison.standard.retryAttempted,true);
    assert.equal(partial.cibComparison.standard.error,'offline');
  });
  console.log(`${checks} Amazon matching checks passed.`);
})().catch(e => { console.error(e); process.exitCode = 1; });
