'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const pending = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const tick = () => new Promise(r => setTimeout(r, 5));
const nodes = new Map();
const storage = new Map([['p2w-scan-queue', JSON.stringify([{product:{id:'old-black-ops'}}])]]);
const ctx = vm.createContext({ console, Date, URL, URLSearchParams, setTimeout, clearTimeout,
  localStorage: { getItem:k=>storage.get(k)||null, setItem:(k,v)=>storage.set(k,v) },
  document: {querySelector:s=>{if(!nodes.has(s))nodes.set(s,{innerHTML:'',value:'',focus(){},addEventListener(){}});return nodes.get(s);},addEventListener(){}},
});
vm.runInContext(fs.readFileSync('trade-in/app.js','utf8').replace(/\binit\(\);\s*$/, ''),ctx);
const run = s => vm.runInContext(s,ctx);
const product = id => ({id,'product-name':'Example Game '+id,'console-name':'PSP','cib-price':1999,'gamestop-price':0});
(async()=>{
  const first=pending(), second=pending(), calls=[];
  ctx.a=product('1');ctx.b=product('2');
  ctx.lookup=async p=>{calls.push(p.id);return p.id==='1'?first.promise:second.promise;};
  run(`tokenSet=false;amazonSet=false;renderFloorPricer=()=>{};
    pcReadRequest=async()=>({sales:{cib:[]},barcodes:[]});
    fetchFloorProductSales=lookup;loadFloorGameStopStock=()=>{};
    pickFloorGame(a);pickFloorGame(b);`);
  assert.deepEqual(calls,['1','2'],'New game starts immediately without waiting for prior research');
  assert.equal(run('floorCur.product.id'),'2');
  second.resolve({sales:{cib:[{title:'Second game',price:2200}]}});await tick();
  first.resolve({sales:{cib:[{title:'Old game',price:9900}]}});await tick();
  assert.equal(run('floorCur.sales.cib[0].price'),2200,'Late old-game results cannot overwrite the current item');

  const oldScan=pending(),newScan=pending();
  ctx.barcode=code=>code==='11111111'?oldScan.promise:newScan.promise;
  run('PC.byUpc=barcode;floorScanUpc("11111111");floorScanUpc("22222222");');
  newScan.resolve(ctx.b);await tick();oldScan.resolve(ctx.a);await tick();
  assert.equal(run('floorCur.product.id'),'2','Latest scan wins even when barcode responses arrive out of order');

  ctx.quickCalls=[];ctx.researchCalls=[];
  run(`fetchFloorQuickSales=async p=>{quickCalls.push(p.id);return {sales:{cib:[{price:1400}]}}};
    loadFloorSales=async p=>{researchCalls.push(p.id)};
    pickFloorGame({...a,'cib-price':1000});`);
  await tick();assert.deepEqual(Array.from(ctx.quickCalls),['1']);assert.equal(ctx.researchCalls.length,0);
  run(`onFloorPricerClick({target:{closest:s=>s==='[data-floor-act]'?{dataset:{floorAct:'research'}}:null}});`);
  assert.deepEqual(Array.from(ctx.researchCalls),['1'],'Research button still upgrades a quick price to full checks');
  run(`refreshFloorHelperStatus=()=>{};renderFloorList=()=>{};renderFulcrum=()=>{};loadFloorSessions=()=>{};showFloor();`);
  assert.deepEqual(Array.from(ctx.researchCalls),['1'],'Opening Floor Pricing never replays the old saved scan queue');
  assert.doesNotMatch(fs.readFileSync('trade-in/index.html','utf8'),/floor-queue\.js|floorQueueDock/);
  console.log('PASS direct pricing: immediate research, stale response isolation, latest scan, research button, no saved-queue replay');
})().catch(error=>{console.error(error);process.exitCode=1;});
