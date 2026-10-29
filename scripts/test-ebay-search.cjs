'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const reader = vm.createContext({ URL, Date });
vm.runInContext(fs.readFileSync('trade-in/browser-helper/ebay-search-reader.js', 'utf8'), reader);
const invoke = (ctx, name, ...args) => { ctx.args = args; return vm.runInContext(`${name}(...args)`, ctx); };
// Values/markup roles observed on live eBay sold search, Oct 26 2026. No seller/account data.
const card = { title: 'The Order 1886 PS4 Game Steelbook PlayStation 4 Tested Clean', url: 'https://www.ebay.com/itm/116915330518?tracking=ignored',
  sold: 'Sold Sep 12, 2026', positive: true, price: '$40.00', condition: 'New (Other)', shipping: '+$6.12 delivery', location: 'Located in United States', details: 'or Best Offer' };
const parse = values => invoke(reader, 'parseEbaySearchCard', { ...card, ...values });
assert.equal(parse().price, 4000); assert.equal(parse().shipping, 612); assert.equal(parse().date, '2026-09-12');
assert.equal(parse().state, 'sold', 'Offering negotiation is not proof an offer was accepted');
assert.equal(parse().sellerCountry,'United States');
assert.equal(parse({location:'Located in: Canada'}).sellerCountry,'Canada');
assert.equal(parse({location:'Located in Italy'}).locationSource,'ebay-located-in');
assert.equal(parse({location:'Ships worldwide'}).sellerCountry,null,'Delivery destinations are not seller location');
assert.equal(parse({location:''}).sellerCountry,null);
assert.equal(parse({ struck: true }).state, 'offer');
assert.equal(parse({ details: 'Best offer accepted' }).state, 'offer');
for (const v of [{ sold: 'Ended Sep 12, 2026' }, { sold: '123 sold' }, { positive: false }, { price: '$40.00 to $60.00' },
  { price: 'C $40.00' }, { price: 'EUR 40.00' }, { price: '$0.00' }, { url: 'https://www.ebay.com/p/195265830' },
  { url: 'https://evil.test/itm/116915330518' }, { title: '' }]) assert.equal(parse(v), null, JSON.stringify(v));
const el = (text = '', extra = {}) => ({ textContent: text, getClientRects: () => [1], closest: () => null, ...extra });
const price = el('$40.00', { querySelectorAll: () => [], matches: () => false });
const row = el('', { querySelector(selector) {
  if (selector === '.s-card__title .su-styled-text') return el(card.title, { closest: s => s === 'a' ? ({ href: card.url }) : null });
  if (selector.includes('Sold Item')) return el('Sold Sep 12, 2026', { classList: { contains: () => true } });
}, querySelectorAll(selector) {
  return selector === '.s-card__price' ? [price] : selector === '.s-card__subtitle' ? [el(card.condition)] : [el(card.details), el(card.shipping), el(card.location)];
} });
const query = 'The Order 1886 Steelbook PS4', href = 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(query) + '&LH_Sold=1&LH_Complete=1&_sop=16';
const doc = { querySelector: selector => selector === '#srp-results-heading' ? el('1 result for ' + query) : null,
  querySelectorAll: selector => selector === '#srp-river-results li.s-card' ? [row] : [], defaultView: { getComputedStyle: () => ({ textDecorationLine: '' }) } };
assert.equal(invoke(reader, 'readEbaySearch', doc, href, query).sales[0].price, 4000);
assert.equal(invoke(reader, 'readEbaySearch', doc, href, query).sales[0].sellerCountry,'United States');
for (const url of [href.replace('LH_Sold=1', 'LH_Sold=0'), 'https://signin.ebay.com/', href.replace('_nkw=', '_wrong=')])
  assert.equal(invoke(reader, 'readEbaySearch', doc, url, query).state, 'unknown');
assert.equal(invoke(reader,'readEbaySearch',doc,href.replace('_sop=16','_sop=13'),query).state,'unknown','Only highest-first pages can justify stopping early');
assert.equal(invoke(reader,'readEbaySearch',doc,href,query,2).state,'unknown','Wrong page cannot be counted twice');
const noCards = { ...doc, querySelectorAll: () => [] };
assert.equal(invoke(reader, 'readEbaySearch', noCards, href, query).state, 'unknown', 'A layout failure is not zero sales');
assert.equal(invoke(reader, 'readEbaySearch', { ...noCards, querySelector: s => s.includes('heading') ? el('0 results for ' + query) : null }, href, query).state, 'ready');
assert.equal(invoke(reader, 'readEbaySearch', { ...doc, querySelector: s => s.includes('next') ? el('next') : doc.querySelector(s) }, href, query).more, true);
price.matches = () => true;
assert.equal(invoke(reader, 'readEbaySearch', doc, href, query).sales[0].state, 'offer'); price.matches = () => false;

const ctx = vm.createContext({ console, URL, Date, setTimeout, clearTimeout, localStorage: { getItem: () => null, setItem() {} },
  document: { querySelector: () => ({ value: '', innerHTML: '', addEventListener() {} }), addEventListener() {} } });
vm.runInContext(fs.readFileSync('trade-in/dead-games.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('trade-in/app.js', 'utf8').replace(/\binit\(\);\s*$/, ''), ctx);
const product = { id: '123', 'product-name': 'The Order: 1886 [Steelbook Edition]', 'console-name': 'Playstation 4', 'cib-price': 2124 };
const sold = parse(), ready = rows => ({ state: 'ready', sales: rows, checkedAt: 123456, partial: false, page: 1, sorted: true });
const base = () => ({ product, condition: 'cib', sales: { cib: [{ ...sold, price: 2500, source: undefined, state: undefined }] }, typed: null, pick: null, amazon: { found: false }, directEbay: { result: ready([sold]) } });
const result = c => invoke(ctx, 'floorResult', c);
const rows = c => invoke(ctx, 'floorSales', c);
assert.equal(rows(base()).length, 1, 'Same item dedupes across PriceCharting and eBay');
assert.equal(result(base()).b.basis, 4612, 'Recovered sale includes known shipping exactly once');
assert.equal(result(base()).r.price, 4500, 'Total follows unchanged rounding');
assert.equal(result(base()).b.basis, 4612, 'Repeated pricing does not add shipping again');
assert.equal(invoke(ctx, 'floorEbayResult', rows(base())[0], product, { id:sold.id, title:sold.title, state:'sold', price:4000 }, 'cib').state, 'sold', 'Original-item checks compare item price, not delivered total');
assert.equal(rows(base())[0].verification.state, 'sold');
assert.equal(invoke(ctx,'floorEbayResult',rows(base())[0],product,{id:sold.id,title:sold.title,state:'sold',price:4000,sellerCountry:'Rome, Italy',locationSource:'ebay-located-in'},'cib').state,'location');
const foreignCheck=base();foreignCheck.ebayChecks={results:{[sold.id]:{state:'location',sellerCountry:'Italy',locationSource:'ebay-located-in'}}};
assert.equal(rows(foreignCheck)[0].odd,true,'Original-item overseas evidence overrides a sold search card');
assert.equal(invoke(ctx, 'floorEbayCandidates', base(), 2).length, 0, 'Positive sold cards do not need redundant item tabs');
const prior = base(); prior.ebayChecks = { results: { [sold.id]: { state: 'ended' } } };
assert.equal(rows(prior)[0].verification.state, 'sold', 'Dated sold result is stronger than generic archived ended status');
prior.ebayChecks.results[sold.id] = { state: 'offer' };
assert.equal(rows(prior)[0].odd, true, 'Known hidden accepted price remains excluded');
for (const change of [{ title: 'The Order 1886 PS4 Collectors Edition Statue' }, { title: 'The Order 1886 PS4 Steelbook Case Only No Game' },
  { title: 'Another Game PS4 CIB' }, { title: 'The Order 1886 PS4 Steelbook French Version' }, { state: 'offer' }, { conditionText: 'For parts or not working' }]) {
  const c = base(); c.directEbay.result = ready([{ ...sold, ...change }]); assert.equal(rows(c)[0].odd, true, JSON.stringify(change));
}
const sealed = base(); sealed.directEbay.result = ready([{ ...sold, conditionText: 'Brand New', title: 'The Order 1886 Steelbook PS4 Sealed' }]);
assert.equal(rows(sealed).length, 0, 'New cannot contaminate CIB, including duplicate PC rows');
sealed.condition = 'new'; assert.equal(rows(sealed).length, 1);
const ambiguous = base(); ambiguous.directEbay.result = ready([{ ...sold, title: 'The Order 1886 Playstation 4' }]);
assert.equal(rows(ambiguous)[0].mismatch, 'Different named edition');
const unknown = base(); unknown.product = { ...product, 'product-name': 'The Order: 1886' }; unknown.directEbay.result = ambiguous.directEbay.result;
assert.equal(rows(unknown)[0].conditionUnknown, false); assert.equal(rows(unknown)[0].odd, false, 'Generic used evidence can support CIB pricing');
unknown.sales.cib[0] = { ...sold, title: 'The Order 1886 Playstation 4 CIB' };
assert.equal(rows(unknown)[0].conditionUnknown, false, 'A duplicate keeps valid PC condition evidence when the eBay grade is only generic used');
const wwe = { id: '456', 'product-name': 'WWE 2K20', 'console-name': 'Playstation 4', 'cib-price': 1000 };
const delivered={...base(),product:wwe,sales:{cib:[]},directEbay:{result:ready([
  {...sold,title:'WWE 2K20 PS4 CIB',conditionText:'Pre-Owned',price:1070,shipping:1173},
  {...sold,id:'123456789012',url:'https://www.ebay.com/itm/123456789012',title:'WWE 2K20 PS4 CIB',conditionText:'Pre-Owned',price:1650,shipping:0}
])}};
assert.equal(rows(delivered)[0].price,2243,'Highest delivered total outranks a higher item-only price');
assert.equal(result(delivered).r.price,2500,'WWE example follows the existing low-price rounding');
delivered.directEbay.result.sales[0].shipping=null;
assert.equal(rows(delivered).find(s=>s.id===sold.id).shipping,null,'Unknown shipping stays unknown');
assert.equal(rows(delivered).find(s=>s.id===sold.id).price,1070,'Never invent shipping');
assert.equal(invoke(ctx, 'floorEbaySearchQuery', wwe), 'WWE 2K20 PS4');
assert.equal(new URL(invoke(ctx, 'floorLinks', wwe, 'cib').ebay).searchParams.get('_nkw'), 'WWE 2K20 PS4', 'Manual link has no complete/CIB query restriction');
assert.equal(invoke(ctx, 'floorEbaySearchQuery', product), 'The Order 1886 Steelbook PS4', 'Keep edition identity');
for (const title of ['WWE 2K20 PS4 Disc Only', 'WWE 2K20 PS4', 'WWE 2K20 PS4 No Case']) {
  const c={...base(),product:wwe,sales:{cib:[]},directEbay:{result:ready([{...sold,title,conditionText:'Pre-Owned',price:1070,shipping:1173}])}};
  assert.equal(result(c).b.basis,2243,title);assert.equal(rows(c)[0].odd,false);
  c.condition='new';assert.equal(rows(c).filter(s=>!s.odd).length,0,'Used cannot price sealed inventory');
}
for (const title of ['WWE 2K20 PS4 Case Only No Game','WWE 2K20 PS4 Disc Only Bundle with WWE 2K19',
  'WWE 2K20 Deluxe Edition PS4 Disc Only','WWE 2K19 PS4 Disc Only','WWE 2K20 Xbox One Disc Only','WWE 2K20 PS4 Brand New Sealed']) {
  const c={...base(),product:wwe,sales:{cib:[]},directEbay:{result:ready([{...sold,title,conditionText:'Pre-Owned',price:2500}])}};
  assert.equal(rows(c)[0].odd,true,title);
}
const loose={...base(),product:wwe,condition:'loose',sales:{loose:[]},directEbay:{result:ready([{...sold,title:'WWE 2K20 PS4 Complete CIB',conditionText:'Pre-Owned'}])}};
assert.equal(rows(loose).length,0,'CIB cannot inflate loose pricing');
const toy = { 'product-name': 'Sonic Boom - Giants, Glow in the Dark', 'console-name': 'Skylanders', 'loose-price': 977 };
assert.equal(invoke(ctx, 'floorDirectCondition', { title: 'Sonic Boom CIB Original Box', conditionText: 'Pre-Owned' }, toy), 'loose');
const rare = { ...base(), product: toy, condition: 'loose', sales: {}, directEbay: { result: ready([{ ...sold, price: 1500, title: 'Skylanders Giants Glow in the Dark Sonic Boom', conditionText: 'Pre-Owned' }]) } };
rare.directEbay.result.sales[0].shipping=0;
assert.equal(result(rare).r.price, 2000, 'Rare minimum intact');
const pending = base(); pending.directEbay.loading = true; assert.equal(result(pending).b.waiting, true);
pending.typed = 5000; assert.equal(result(pending).r.price, 5000, 'Typed reviewed prices stay usable');
const incomplete = base(); incomplete.directEbay.result.partial = true; assert.equal(result(incomplete).b.searchReview, true);
const standard = base(); standard.directEbay.standard = { result: ready([{ ...sold, id: '999999999999', url: 'https://www.ebay.com/itm/999999999999', title: 'The Order 1886 Playstation 4 CIB', price: 5000 }]) };
assert.equal(result(standard).b.basis, 5612, 'Standard fallback includes delivered direct evidence without allowing variant comps into the standard');

// Search worker validates messages, bounds tab lifetime, shares/cache jobs, and closes only its own tabs.
let listeners = [], onRemove = [], created = [], removed = [], requests = [], timers = new Set(), nextId = 10;
const worker = vm.createContext({ URL, Date, Map, setTimeout: fn => { timers.add(fn); return fn; }, clearTimeout: fn => timers.delete(fn),
  pricingSender: s => s.frameId === 0 && s.url === 'https://play2wingames.com/trade-in/' && Number.isInteger(s.tab?.id),
  chrome: { runtime: { getManifest: () => ({ version: '1.1.8' }), onMessage: { addListener: h => listeners.push(h) } }, tabs: {
    create: async args => { created.push(args); return { id: nextId++ }; }, remove: async id => removed.push(id),
    sendMessage: (id, m) => new Promise(resolve => requests.push({ id, m, resolve })), onRemoved: { addListener: h => onRemove.push(h) } } } });
vm.runInContext(fs.readFileSync('trade-in/browser-helper/ebay-background.js', 'utf8'), worker);
vm.runInContext(fs.readFileSync('trade-in/browser-helper/ebay-search-background.js', 'utf8'), worker);
const sender = { frameId: 0, tab: { id: 1 }, url: 'https://play2wingames.com/trade-in/' };
const send = (query, from = sender, protocol = 2, page = 1) => new Promise(resolve => { if (!listeners[1]({ type: 'P2W_EBAY_SEARCH', query, protocol, page }, from, resolve)) resolve(null); });
const flush = () => new Promise(r => setImmediate(r));
(async () => {
  const recent={product:{id:'12','product-name':'Example Adventure','console-name':'Nintendo Switch','release-date':new Date().toISOString().slice(0,10)},condition:'cib'};
  let fixedSearchCalls=0;
  await invoke(ctx,'runFloorEbaySearch',recent,()=>{},()=>false,{search:async()=>{fixedSearchCalls++;}});
  assert.equal(fixedSearchCalls,0,'MSRP rule skips automatic sold-search tabs');

  const searchCur=()=>({...base(),product:{...wwe,'cib-price':3000},sales:{cib:[]},directEbay:undefined});
  const comp=(n,grade,title)=>({...sold,id:String(100000000000+n),url:`https://www.ebay.com/itm/${100000000000+n}`,title,conditionText:grade,price:5000-n*100,shipping:0});
  const pageCalls=[];const paged=searchCur();
  await invoke(ctx,'runFloorEbaySearch',paged,()=>{},()=>false,{search:async(q,page)=>{
    pageCalls.push(page);return {...ready(page===1?[comp(1,'Brand New','WWE 2K20 PS4 Brand New'),comp(2,'Pre-Owned','WWE 2K20 & WWE 2K19 PS4 Bundle')]:[comp(3,'Pre-Owned','WWE 2K20 PS4 CIB')]),page,more:true};
  }});
  assert.deepEqual(pageCalls,[1,2]);assert.equal(paged.directEbay.result.stoppedAtMatch,true);assert.equal(paged.directEbay.result.partial,false,'Unread lower pages are not a failure after a sorted match');
  assert.equal(invoke(ctx,'floorSearchReviewWarnings',paged).length,0,'Intentional stopping has no warning');
  for (const [mode, label] of [['location','Seller location unknown'], ['shipping','Shipping unknown'],
    ['skipped','Some results unreadable'], ['partial','Search details need review']]) {
    const c=searchCur();
    await invoke(ctx,'runFloorEbaySearch',c,()=>{},()=>false,{search:async(q,page)=>({
      ...ready([{...comp(1,'Pre-Owned','WWE 2K20 PS4 CIB'),shipping:mode==='shipping'?null:0,
        sellerCountry:mode==='location'?null:'United States',locationSource:'ebay-located-in'}]),page,more:true,
      skipped:mode==='skipped'?2:0,partial:mode==='partial'
    })});
    const warnings=invoke(ctx,'floorSearchReviewWarnings',c);
    assert.equal(warnings.length,1,mode);assert.equal(warnings[0].label,label,mode);
    assert.ok(invoke(ctx,'floorDirectSearchHtml',c).includes(label));
    assert.ok(result(c).b.checks.some(text=>text.includes(warnings[0].detail)),'Review notes explain action');
    const before=result(c).r.price;
    const legacy=JSON.parse(JSON.stringify(c));delete legacy.directEbay.result.issues;
    assert.equal(result(legacy).r.price,before,'Diagnostics never change shelf price');
    assert.equal(result(legacy).b.searchReview,result(c).b.searchReview,'Same review policy');
    if(mode==='skipped')assert.ok(warnings[0].detail.includes('page 1'));
  }
  const combined=searchCur();
  combined.directEbay={result:{...ready([]),partial:true,issues:[{code:'unreadable',page:1},{code:'unreadable',page:2}]},
    standard:{result:{...ready([]),partial:true,issues:[{code:'location'}]}}};
  const combinedWarnings=invoke(ctx,'floorSearchReviewWarnings',combined);
  assert.equal(combinedWarnings.length,2);assert.ok(combinedWarnings[0].detail.includes('pages 1, 2'));
  assert.equal(combinedWarnings[1].label,'Standard game: Seller location unknown');
  assert.ok(invoke(ctx,'floorDirectSearchHtml',combined).includes('Standard game: Seller location unknown'));
  const legacyWarning=invoke(ctx,'floorSearchWarnings',{...ready([]),partial:true})[0];
  assert.ok(legacyWarning.detail.includes('did not report a specific cause'),'Do not invent a reason for older results');
  const marketLimited={...searchCur(),product:wwe}, marketPages=[];
  await invoke(ctx,'runFloorEbaySearch',marketLimited,()=>{},()=>false,{search:async(q,page)=>{
    marketPages.push(page);return {...ready([{...comp(page,'Pre-Owned','WWE 2K20 PS4 CIB'),price:page===1?2500:1500,shipping:page===1?500:0}]),page,more:true};
  }});
  assert.deepEqual(marketPages,[1,2],'A sold price plus shipping at 3x market cannot stop pagination');
  assert.equal(result(marketLimited).b.basis,1500);
  assert.equal(rows(marketLimited)[0].outlier.pcLimit,3000);
  const savedPricingRules=vm.runInContext('settings.floorPremiums',ctx);
  try {
    vm.runInContext('settings.floorPremiums=[{phrase:"WWE 2K20",pct:0}]',ctx);
    const specific={...searchCur(),product:wwe}, specificPages=[];
    await invoke(ctx,'runFloorEbaySearch',specific,()=>{},()=>false,{search:async(q,page)=>{
      specificPages.push(page);return {...ready([{...comp(page,'Pre-Owned','WWE 2K20 PS4 CIB'),price:3000}]),page,more:true};
    }});
    assert.deepEqual(specificPages,[1],'A specific rule can stop at a valid sold match at 3x PC');
    assert.equal(result(specific).b.basis,3000);
  } finally {ctx.savedPricingRules=savedPricingRules;vm.runInContext('settings.floorPremiums=savedPricingRules',ctx);}
  const sao = {...searchCur(), product:{...wwe,'cib-price':3000,'product-name':'Sword Art Online: Lost Song'}};
  const saoPages=[];
  await invoke(ctx,'runFloorEbaySearch',sao,()=>{},()=>false,{search:async(q,page)=>{
    saoPages.push(page);return {...ready([comp(page,'New (Other)',page===1
      ?'Sword Art Online: Lost Song, Hollow Realization, PlayStation 4 PS4'
      :'Sword Art Online: Lost Song PS4 CIB')]),page,more:true};
  }});
  assert.deepEqual(saoPages,[1,2],'Named bundle must not stop the sold search');
  assert.equal(invoke(ctx,'floorSales',sao)[0].mismatch,'Multiple-game title list — review');
  assert.equal(invoke(ctx,'floorAutoSale',invoke(ctx,'floorSales',sao)).sale.title,'Sword Art Online: Lost Song PS4 CIB');
  const lastOfUs = {...searchCur(),product:{...wwe,'cib-price':3000,'product-name':'The Last of Us Remastered'}};
  const languagePages=[];
  await invoke(ctx,'runFloorEbaySearch',lastOfUs,()=>{},()=>false,{search:async(q,page)=>{
    languagePages.push(page);return {...ready(page===1
      ?[comp(1,'Pre-Owned','THE LAST OF US Remastered PS4 Sony PlayStation 4 ITALIAN - FIRST PRINT'),
        comp(2,'Pre-Owned','The Last Of Us Remastered PS4 GAME for Playstation 4 Multi Language (ITA)')]
      :[comp(3,'Pre-Owned','The Last Of Us Remastered PS4 CIB USA')]),page,more:true};
  }});
  assert.deepEqual(languagePages,[1,2],'Foreign variants cannot stop pagination');
  assert.equal(invoke(ctx,'floorAutoSale',invoke(ctx,'floorSales',lastOfUs)).sale.title,'The Last Of Us Remastered PS4 CIB USA');
  const gundam={...searchCur(),product:{...wwe,'cib-price':3000,'product-name':'Dynasty Warriors: Gundam','console-name':'Playstation 3'}};
  const gundamPages=[];
  await invoke(ctx,'runFloorEbaySearch',gundam,()=>{},()=>false,{search:async(q,page)=>{
    gundamPages.push(page);return {...ready([comp(page,'Pre-Owned',page===1
      ?'Dynasty Warriors Gundam Reborn PS3 CIB':'Dynasty Warriors Gundam PS3 CIB')]),page,more:true};
  }});
  assert.deepEqual(gundamPages,[1,2],'A sequel cannot stop the original game search');
  const creatures={...searchCur(),product:{...wwe,'cib-price':1274,'product-name':'Creatures','console-name':'Playstation'}};
  const creaturePages=[];
  await invoke(ctx,'runFloorEbaySearch',creatures,()=>{},()=>false,{search:async(q,page)=>{
    creaturePages.push(page);return {...ready([{...comp(page,'Pre-Owned',page===1
      ?'Nightmare Creatures (Sony PlayStation 1 PS1, 1997)':'Creatures Sony PS1 CIB'),price:page===1?3743:1499}]),page,more:true};
  }});
  assert.deepEqual(creaturePages,[1,2],'A longer title containing the selected name cannot stop search');
  assert.equal(result(creatures).r.price,1500);
  const witcher={...searchCur(),product:{...wwe,'cib-price':1695,'product-name':'Witcher 3: Wild Hunt'}};
  const witcherPages=[];
  await invoke(ctx,'runFloorEbaySearch',witcher,()=>{},()=>false,{search:async(q,page)=>{
    witcherPages.push(page);return {...ready([{...comp(page,'Pre-Owned',page===1
      ?'PS4: Witcher 3 Wild Hunt, w/Music+, Fallout4, Diablo 3, FarCry 4, Borderlands 3'
      :'Witcher 3 Wild Hunt PS4 CIB'),price:page===1?4800:3041}]),page,more:true};
  }});
  assert.deepEqual(witcherPages,[1,2],'Numbered game list cannot stop pagination');
  assert.equal(result(witcher).r.price,3000);
  const geo=searchCur(), geoPages=[];
  await invoke(ctx,'runFloorEbaySearch',geo,()=>{},()=>false,{search:async(q,page)=>{
    geoPages.push(page);return {...ready([{
      ...comp(page,'Pre-Owned','WWE 2K20 PS4 CIB'),sellerCountry:page===1?'Italy':'Canada',locationSource:'ebay-located-in',shipping:2596
    }]),page,more:true};
  }});
  assert.deepEqual(geoPages,[1,2],'Overseas sales cannot stop search; Canadian shipping can');
  assert.equal(invoke(ctx,'floorAutoSale',rows(geo)).sale.sellerCountry,'Canada');
  const oldDate=ctx.Date;ctx.Date=class extends Date{static now(){return Date.parse('2026-10-27T12:00:00Z');}};
  try {
    const aging=searchCur(), agePages=[];
    await invoke(ctx,'runFloorEbaySearch',aging,()=>{},()=>false,{search:async(q,page)=>{
      agePages.push(page);return {...ready(page===1
        ?[{...comp(1,'Pre-Owned','WWE 2K20 PS4 CIB'),date:'2025-10-01'},comp(2,'Pre-Owned','WWE 2K20 PS4 CIB')]
        :[comp(3,'Pre-Owned','WWE 2K20 PS4 CIB'),comp(4,'Pre-Owned','WWE 2K20 PS4 CIB')]),page,more:true};
    }});
    assert.deepEqual(agePages,[1,2],'Old first-page evidence cannot falsely establish a slow seller');
    assert.equal(rows(aging)[0].exclusion,'Older than six months');
    const scarce=searchCur(), scarcePages=[];
    await invoke(ctx,'runFloorEbaySearch',scarce,()=>{},()=>false,{search:async(q,page)=>{
      scarcePages.push(page);return {...ready(page===1?[{...comp(1,'Pre-Owned','WWE 2K20 PS4 CIB'),date:'2025-10-01'}]:[]),page,more:page===1};
    }});
    assert.deepEqual(scarcePages,[1,2]);assert.equal(rows(scarce)[0].ageInfo.retained,true,'Older evidence allowed after a scarce search exhausts');
  } finally {ctx.Date=oldDate;}
  const newPages=[];paged.condition='new';
  await invoke(ctx,'runFloorEbaySearch',paged,()=>{},()=>false,{search:async(q,page)=>{newPages.push(page);return {...ready([comp(1,'Brand New','WWE 2K20 PS4 Brand New')]),page,more:true};}});
  assert.deepEqual(newPages,[1],'Condition change searches for its own highest match');
  const exhausted=searchCur();let count=0;
  await invoke(ctx,'runFloorEbaySearch',exhausted,()=>{},()=>false,{search:async(q,page)=>{count++;return {...ready([comp(page,'Brand New','WWE 2K20 PS4 Brand New')]),page,more:page<3};}});
  assert.equal(count,3);assert.equal(exhausted.directEbay.result.partial,false);assert.equal(exhausted.directEbay.result.stoppedAtMatch,undefined);
  for(const mode of ['repeat','failed','wrong-page']) {
    const c=searchCur();let count=0;
    await invoke(ctx,'runFloorEbaySearch',c,()=>{},()=>false,{search:async(q,page)=>{count++;if(page===2&&mode==='failed')throw Error('Blocked');return {...ready([comp(1,'Brand New','WWE 2K20 PS4 Brand New')]),page:mode==='wrong-page'?1:page,more:true};}});
    assert.equal(count,2,mode);assert.equal(c.directEbay.result.partial,true,mode);assert.equal(c.directEbay.result.sales.length,1,'Keep prior evidence without duplicates');
    const warning=invoke(ctx,'floorSearchReviewWarnings',c)[0];
    assert.equal(warning.label,mode==='repeat'?'No new results on next page':mode==='failed'?'Search page unavailable':'Search page not verified');
    assert.ok(warning.detail.includes('page 2'));
  }
  const switched=searchCur();let release;const inFlight=invoke(ctx,'runFloorEbaySearch',switched,()=>{},()=>false,{search:()=>new Promise(r=>release=r)});
  switched.condition='new';release(ready([comp(1,'Pre-Owned','WWE 2K20 PS4 CIB')]));await inFlight;
  assert.equal(switched.directEbay.result,undefined,'Stale CIB completion cannot publish into New');
  let calls = 0;
  const c = base(); delete c.directEbay;
  const helper = { search: async q => { calls++; return ready(q.includes('Steelbook') ? [sold] : []); } };
  await invoke(ctx, 'runFloorEbaySearch', c, () => {}, () => false, helper);
  assert.equal(calls, 2, 'Edition and standard searches both run');
  await invoke(ctx, 'runFloorEbaySearch', c, () => {}, () => false, helper); assert.equal(calls, 2, 'Renders reuse search, all conditions share it');
  const absent = base(); delete absent.directEbay; await invoke(ctx, 'runFloorEbaySearch', absent, () => {}, () => false, null);
  assert.equal(absent.directEbay.loading, false); assert.equal(result(absent).b.searchReview, true);
  assert.equal(invoke(ctx,'floorSearchReviewWarnings',absent)[0].label,'Helper not connected or outdated');
  const cancelled = base(); delete cancelled.directEbay; let stop = false, updates = 0;
  await invoke(ctx, 'runFloorEbaySearch', cancelled, () => updates++, () => stop, { search: async () => { stop = true; return ready([sold]); } });
  assert.equal(updates, 1, 'Cancelled lookup does not redraw another game');
  assert.equal(await send(query, { ...sender, frameId: 1 }), null);
  assert.equal((await send(query, sender, 1)).state, 'unknown');
  for(const page of [0,51,'2',-1,1.5]) assert.equal((await send(query,sender,2,page)).state,'unknown');
  const a = send(query), b = send(query), other = send('Road Redemption PS4'); await flush();
  assert.equal(created.length, 1); assert.equal(created[0].active, false);
  assert.equal(new URL(created[0].url).searchParams.get('LH_Sold'), '1'); assert.equal(new URL(created[0].url).searchParams.get('_sop'), '16');
  requests[0].resolve(ready([sold])); await a; await b; await flush();
  assert.equal(created.length, 2); assert.ok(removed.includes(10));
  assert.equal((await send(query)).sales.length, 1); assert.equal(created.length, 2, 'Five-minute cache avoids repeat searches');
  onRemove[1](11); assert.equal((await other).state, 'unknown'); await flush();
  assert.ok(removed.includes(11)); assert.ok(!removed.includes(1)); assert.equal(timers.size, 0, 'All queue and active watchdogs cleared');
  const timeout = send('Unreachable Game PS4'); await flush(); for (const fn of [...timers]) fn();
  assert.equal((await timeout).state, 'unknown'); await flush(); assert.equal(timers.size, 0);
  const pageListeners = new Set(), messages = [];
  const pageWindow = { addEventListener: (t, f) => pageListeners.add(f), removeEventListener: (t, f) => pageListeners.delete(f),
    postMessage: data => queueMicrotask(() => { for (const f of [...pageListeners]) f({ data, source: pageWindow, origin: 'https://play2wingames.com' }); }) };
  let oldHelper = false;
  const bridge = vm.createContext({ window: pageWindow, location: { origin: 'https://play2wingames.com' }, crypto: require('node:crypto').webcrypto, setTimeout, clearTimeout,
    chrome: { runtime: { sendMessage: m => {
      messages.push(m);
      if (oldHelper) return Promise.resolve({ available: true, protocol: 2, targeted: 1 });
      return new Promise(resolve => { for (const h of listeners) if (h(m, sender, resolve)) return; resolve(null); });
    } } } });
  vm.runInContext(fs.readFileSync('trade-in/browser-helper/bridge.js', 'utf8'), bridge);
  vm.runInContext(fs.readFileSync('trade-in/stock-helper-client.js', 'utf8'), bridge);
  assert.equal((await pageWindow.P2WEbayHelper.search(query)).sales[0].price, 4000);
  assert.equal(messages.at(-1).type, 'P2W_EBAY_SEARCH'); assert.equal(pageListeners.size, 2, 'Request listeners clean up');
  const pageTwo=pageWindow.P2WEbayHelper.search(query,2);await flush();
  assert.equal(new URL(created.at(-1).url).searchParams.get('_pgn'),'2','Page travels through client, bridge and worker');
  requests.at(-1).resolve({...ready([sold]),page:2});assert.equal((await pageTwo).page,2);
  assert.equal((await pageWindow.P2WEbayHelper.search(query,2)).sales[0].sellerCountry,'United States','Worker preserves observed country');
  const beforeCachedPage=created.length;assert.equal((await pageWindow.P2WEbayHelper.search(query,2)).page,2);assert.equal(created.length,beforeCachedPage,'Cache separates pages');
  oldHelper = true; messages.length = 0;
  assert.equal((await pageWindow.P2WEbayHelper.search(query)).state, 'unavailable');
  assert.equal(messages.length, 1, 'Old worker receives only a capability ping, never a search tab request');
  console.log('Direct eBay sold parsing, conditions, deduplication, baseline/premiums, cancellation, tab queue/cache/timeouts passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
