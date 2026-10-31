'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const elements = new Map(), stored = new Map();
const el = key => {
  if (!elements.has(key)) elements.set(key, { value:'', textContent:'', innerHTML:'', hidden:false, open:false,
    classList:{toggle(){}}, elements:{payout:{value:'credit'}}, addEventListener(){}, focus(){}, select(){},
    showModal(){this.open=true;}, close(){this.open=false;} });
  return elements.get(key);
};
const ctx = vm.createContext({console,Date,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto,
  localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)},
  document:{querySelector:el,querySelectorAll:()=>[],addEventListener(){}},window:{print(){}}});
const run = s => vm.runInContext(s,ctx);
run(fs.readFileSync('trade-in/app.js','utf8').replace(/\binit\(\);\s*$/,''));
run(`toast=()=>{};focusScan=()=>{};commit=()=>saveTrade();renderHeld=()=>{};
  priceLine=l=>({cash:l.cash,credit:l.credit});lineDeductions=()=>[];
  var sent=[];api=async(route,{body})=>{sent.push(body);return {id:1,time:'2026-10-31T12:00:00Z'};};`);
const fresh=()=>run(`Object.assign(trade,{lines:[{id:'1',name:'Example Game',category:'game',condition:'cib',qty:1,cash:2000,credit:3000}],cashTotal:null,creditTotal:null,split:null,staff:'Test Staff',customer:'Test Customer'});`);
const credit = value => {ctx.value=value;return run('applyCreditTotal(value)');};
(async()=>{
  fresh();const original=run('JSON.stringify(trade.lines)');
  assert.equal(credit('45.50'),true);assert.equal(run('tradeTotals().credit'),4600);
  assert.equal(run('tradeTotals().cash'),2000);assert.equal(run('JSON.stringify(trade.lines)'),original);
  assert.equal(JSON.parse(stored.get('p2w-trade')).creditTotal.credit,4600,'Override persists on reload/hold');
  assert.match(run('totalsNote(tradeTotals())'),/Store credit adjusted from \$30.00 to \$46.00/);
  run('printQuote()');assert.match(el('#printArea').innerHTML,/\$46.00/);
  assert.match(el('#printArea').innerHTML,/Store credit adjusted/);
  for(const bad of ['-1','nope','Infinity','999999999999999999999']){
    assert.equal(credit(bad),false);assert.equal(run('tradeTotals().credit'),4600);
  }
  assert.equal(credit('0'),true);assert.equal(run('tradeTotals().credit'),0,'Zero is intentional, not a missing override');
  credit('');assert.equal(run('trade.creditTotal'),null);assert.equal(run('tradeTotals().credit'),3000);
  run('trade.cashTotal={cash:3000,base:2000}');assert.equal(run('tradeTotals().credit'),4500);
  credit('50');assert.equal(run('tradeTotals().cash'),3000);assert.equal(run('tradeTotals().credit'),5000);
  assert.equal(run('splitPayout(tradeTotals(),1500).credit'),2500,'Split uses adjusted credit total');
  run('resetCreditTotal()');assert.equal(run('tradeTotals().credit'),4500,'Auto keeps cash adjustment');
  credit('50');run('trade.lines[0].credit=3200;renderTotals()');
  assert.equal(run('trade.creditTotal'),null,'Repriced credit clears stale override even if cash is unchanged');
  assert.equal(run('tradeTotals().credit'),4800);
  for(const print of [false,true]){
    fresh();run('openComplete()');assert.equal(el('#payCredit').value,'$30.00');
    el('#payCredit').value='42.49';el('#completeForm').elements.payout.value='credit';
    await run(`saveCompleted(${print})`);
    assert.equal(run('sent.at(-1).payout.credit'),4200,'Save reads edited field even without blur');
    assert.equal(run('sent.at(-1).totals.credit'),4200);
    assert.equal(run('sent.at(-1).totals.creditAdjustedFrom'),3000);
    assert.equal(run('sent.at(-1).items[0].credit'),3000,'Item snapshots retain original offer');
    assert.equal(run('trade.creditTotal'),null,'Completed trade cannot leak adjustment into next trade');
    if(print)assert.match(el('#printArea').innerHTML,/Paid: <strong>\$42.00 store credit/);
  }
  fresh();run('openComplete()');el('#payCredit').value='bad';
  const before=run('sent.length');await run('saveCompleted(false)');
  assert.equal(run('sent.length'),before);assert.match(el('#completeError').textContent,/valid store credit/);
  el('#payCredit').value='50';el('#completeForm').elements.payout.value='split';el('#paySplitCash').value='10';
  await run('saveCompleted(false)');
  assert.equal(run('sent.at(-1).payout.cash'),1000);assert.equal(run('sent.at(-1).payout.credit'),2500);
  fresh();credit('45');run('heldTrades=[{id:"held",trade:clone(trade)}];resetTrade();resumeHeld("held")');
  assert.equal(run('tradeTotals().credit'),4500,'Held trade restores its own adjustment');
  run('heldTrades=[{id:"old",trade:{lines:clone(trade.lines),customer:"Old",staff:"",cashTotal:null}}];resumeHeld("old")');
  assert.equal(run('trade.creditTotal'),null,'Older held trade does not inherit current adjustment');
  console.log('Final store credit: independent edits, rounding, validation, cash/split interaction, persistence, save/receipt and reset passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
