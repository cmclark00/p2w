'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const pending = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const tick = () => new Promise(r => setTimeout(r, 5));
function engine() {
  const nodes = new Map(), storage = new Map();
  const element = s => { if (!nodes.has(s)) nodes.set(s, {innerHTML:'', value:'', addEventListener(){}, focus(){}}); return nodes.get(s); };
  const ctx = vm.createContext({console, Date, URL, URLSearchParams, setTimeout, clearTimeout, AbortSignal,
    crypto:require('node:crypto').webcrypto, document:{querySelector:element,addEventListener(){}},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  });
  for (const file of ['dead-games.js','floor-queue.js','app.js']) vm.runInContext(fs.readFileSync('trade-in/'+file,'utf8').replace(/\binit\(\);\s*$/, ''),ctx);
  const run = s => vm.runInContext(s,ctx);
  run('floorQueueEnabled=true; tokenSet=false; amazonSet=false; toast=()=>{};');
  return {ctx,run,nodes,storage};
}
const product = (id, value=1000) => ({id, 'product-name':'Example Game '+id,'console-name':'Playstation 4','cib-price':value,'loose-price':800,'new-price':value,'gamestop-price':0});
async function drained(e) { for(let n=0;n<200;n++){ if(!e.run('floorQueueRunning'))return; await tick(); } throw Error('Queue did not drain'); }
(async()=>{
  const e=engine(), first=pending(); let calls=[];
  e.ctx.lookup=async p=>{calls.push(p.id); if(p.id==='1')await first.promise; return {sales:{loose:[],cib:[{title:p['product-name']+' PS4 CIB',price:1400,date:new Date().toISOString().slice(0,10)}],new:[]}};};
  e.run('fetchFloorQuickSales=lookup;'); e.ctx.a=product('1'); e.ctx.b=product('2');
  e.run('enqueueFloorScan({product:a});enqueueFloorScan({product:b});floorCur=floorQueue[1].cur;renderFloorPricer();');
  await tick();
  assert.deepEqual(calls,['1'],'One lookup runs while another scan is queued');
  assert.match(e.nodes.get('#floorPricer').innerHTML,/data-floor-act="add" disabled/);
  first.resolve(); await drained(e);
  assert.deepEqual(calls,['1','2']);
  assert.equal(e.run('floorCur.product.id'),'2','Opening a different card does not cancel research');
  assert.equal(e.run('floorQueue[0].state'),'ready');
  assert.equal(e.run('floorResult(floorQueue[0].cur).r.price'),1500,'Real quick pricing and rounding retained');
  assert.equal(e.run('floorQueueCanShare(floorQueue[0].cur)'),true);
  e.run('floorQueue[0].cur.typed=1700');
  assert.equal(e.run('floorQueueCanShare(floorQueue[0].cur)'),false,'Manual prices are not shared');
  e.run('floorQueue[0].cur.typed=null;floorQueue[0].cur.amazon={incomplete:true}');
  assert.equal(e.run('floorQueueCanShare(floorQueue[0].cur)'),false,'Incomplete sources are not shared');
  assert.equal(JSON.parse(e.storage.get('p2w-scan-queue'))[0].sales,undefined,'Reload stores identities, not partial results');
  const c=engine(), gate=pending();let conditions=[];
  c.ctx.a=product('3',2500);c.ctx.research=async(cur,progress,stopped)=>{conditions.push(cur.condition);if(cur.condition==='cib')await gate.promise;if(stopped())return;cur.sales={loose:[],cib:[],new:[]};progress();};
  c.run('researchFloorQueueItem=research;enqueueFloorScan({product:a});');await tick();
  c.run('floorQueueRefresh(floorQueue[0],{condition:"loose"});');
  gate.resolve();await drained(c);
  assert.deepEqual(conditions,['cib','loose']);assert.equal(c.run('floorQueue[0].cur.condition'),'loose');
  assert.equal(c.run('floorQueue[0].cur.queueCancelled'),undefined,'Stale job cannot replace new condition');
  const r=engine();r.ctx.a=product('4');r.ctx.evidence=JSON.parse(e.run('JSON.stringify(floorQueueEvidence(floorQueue[1].cur))'));
  r.ctx.evidence.product=r.ctx.a;
  r.run(`floorRecentRequest=async(method,b)=>b.action==='get'?{entry:{key:b.key,checkedAt:Date.now(),evidence}}:{entries:[]};
    fetchFloorQuickSales=()=>{throw Error('Cache should avoid research')};enqueueFloorScan({product:a});`);
  await drained(r);assert.ok(r.run('floorQueue[0].cur.sharedCheckedAt'));
  assert.equal(r.run('floorQueue[0].cur.typed'),null,'Shared result never imports staff overrides');
  const f=engine();f.ctx.a=product('5',2500);f.ctx.events=[];
  f.run(`pcReadRequest=async()=>({sales:{loose:[],cib:[],new:[]},barcodes:['123'],gamestopUrl:'gs'});
    fetchFloorGameStopStock=async()=>{events.push('stock');return {state:'out'}};
    fetchFloorProductSales=async()=>({sales:{loose:[],cib:[],new:[]}});
    runFloorEbaySearch=async(cur)=>{events.push('search:'+cur.condition);cur.directEbay||={condition:cur.condition,result:{state:'ready',sales:[]}}};
    runFloorTargetedEbay=async(cur)=>{events.push('verify:'+cur.condition)};
    enqueueFloorScan({product:a,condition:'new'});`);
  await drained(f);
  assert.ok(f.ctx.events.includes('verify:new'));assert.ok(f.ctx.events.includes('verify:cib'),'Sealed condition retains CIB comparison');
  assert.equal(f.run('floorQueue[0].cur.product.catalogBarcodes[0]'),'123');
  console.log('PASS scan queue scheduling, condition cancellation, real quick prices, sharing restrictions, cache reuse and sealed comparison');
})().catch(e=>{console.error(e);process.exitCode=1});
