'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const elements=new Map(),stored=new Map();
const el=k=>{if(!elements.has(k))elements.set(k,{value:'',innerHTML:'',textContent:'',open:false,hidden:false,
  addEventListener(){},focus(){},classList:{toggle(){}}});return elements.get(k);};
const ctx=vm.createContext({console,Date,URL,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto,
  localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)},
  document:{querySelector:el,querySelectorAll:()=>[],addEventListener(){}},window:{addEventListener(){}}});
const run=s=>vm.runInContext(s,ctx);
run(fs.readFileSync('trade-in/app.js','utf8').replace(/\binit\(\);\s*$/,''));
run(`tokenSet=true; var notices=[],calls=0,resolveLookup,rejectLookup;
  toast=m=>notices.push(m); commit=()=>{saveTrade();for(const l of trade.lines)loadTradeManualPrices(l);};
  PC.byId=()=>{calls++;return new Promise((resolve,reject)=>{resolveLookup=resolve;rejectLookup=reject;});};
  var fresh=()=>({id:'line',pcId:'123',name:'Example Adventure',platform:'Playstation 2',source:'pc',category:'game',
    condition:'cib',manualMissing:true,qty:1,prices:{'cib-price':4000,'retail-cib-buy':2400},deductions:[]});
  var full={id:'123','product-name':'Example Adventure','console-name':'Playstation 2','loose-price':2000,
    'cib-price':4000,'retail-cib-buy':2400,'box-only-price':800,'manual-only-price':1000};`);
(async()=>{
  run('trade.lines=[fresh()]; var line=trade.lines[0]; var first=loadTradeManualPrices(line);');
  assert.equal(run('loadTradeManualPrices(line)===first'),true,'Concurrent rendering shares a request');
  assert.equal(run('calls'),1); assert.equal(run('tradeManualPending()'),true);
  run('openComplete()');assert.match(run('notices.at(-1)'),/Wait for the box\/manual/);
  await run('saveCompleted(false)');assert.match(el('#completeError').textContent,/Wait for the box\/manual/);
  run('resolveLookup(full)');await run('first');
  assert.equal(run('tradeManualPending()'),false);assert.equal(run('calls'),1,'Completion cannot start a request loop');
  assert.equal(run('tradePcValue(line)'),2800);assert.equal(run('priceLine(line).base'),1680);
  assert.equal(JSON.parse(stored.get('p2w-trade')).lines[0].prices['manual-only-price'],1000);
  assert.equal(run('tradeItems()[0].condition'),'Game + box, no manual');
  assert.equal(run('tradePcSnapshot().items[0].valuation'),'loose-plus-box');

  run('trade.lines=[fresh()]; line=trade.lines[0]; first=loadTradeManualPrices(line);rejectLookup(Error("Unavailable"));');
  await run('first');assert.equal(run('tradeManualLoads.get(line).error'),true);
  const failures=run('calls');run('loadTradeManualPrices(line);commit();');assert.equal(run('calls'),failures,'Failed requests wait for explicit retry');
  assert.equal(run('priceLine(line).cash'),null,'No silent CIB fallback');
  run('tradeManualLoads.delete(line);first=loadTradeManualPrices(line);resolveLookup({...full,"box-only-price":0});');
  await run('first');assert.equal(run('tradePcReference(line).method'),'cib-minus-manual');
  assert.equal(run('priceLine(line).base'),1800);

  run('trade.lines=[fresh()];line=trade.lines[0];first=loadTradeManualPrices(line);setTradeCondition(line,"loose");resolveLookup(full);');
  await run('first');assert.equal(run('line.condition'),'loose');assert.equal(run('line.manualMissing'),false,'Late data cannot restore old condition');
  run('trade.lines=[fresh()];line=trade.lines[0];first=loadTradeManualPrices(line);trade.lines=[];resolveLookup(full);');
  await run('first');assert.equal(run('line.prices[BOX_KEY]'),undefined,'Removed items ignore stale data');
  run('trade.lines=[fresh()];line=trade.lines[0];first=loadTradeManualPrices(line);resolveLookup({...full,id:"999"});');
  await run('first');assert.equal(run('line.prices[BOX_KEY]'),undefined,'Another product cannot supply components');
  assert.equal(run('tradeManualLoads.get(line).error'),true);
  run('trade.lines=[fresh()];line=trade.lines[0];first=loadTradeManualPrices(line);resolveLookup({id:"123","cib-price":4000,"retail-cib-buy":2400});');
  await run('first');assert.equal(run('tradePcValue(line)'),null,'Absent components remain unavailable');
  const emptyCalls=run('calls');run('commit()');assert.equal(run('calls'),emptyCalls);
  console.log('No-manual trade component loading, persistence, missing-data fallback, completion guards, retry and stale-response checks passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
