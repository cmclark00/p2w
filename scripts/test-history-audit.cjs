const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ctx=vm.createContext({console,Date,Intl,setTimeout,clearTimeout,document:{getElementById:()=>({addEventListener(){}})}});
vm.runInContext(fs.readFileSync('trade-in/history-audit.js','utf8').replace(/auditInit\(\);\s*$/,''),ctx);
const invoke=(name,...args)=>vm.runInContext(`${name}(...${JSON.stringify(args)})`,ctx);
let checks=0;const test=(name,fn)=>{fn();checks++;console.log(`PASS ${name}`);};
test('catalog match preserves platform, edition and language and accepts punctuation aliases',()=>{
  const item={name:'Pokémon Red',system:'GameBoy'};
  assert.equal(invoke('auditMatch',item,{id:1,'product-name':'Pokemon Red','console-name':'Game Boy'}),true);
  for(const [name,system] of [['Pokemon Red [Japan]','GameBoy'],['Pokemon Red','GameBoy Advance'],['Pokemon Red [French Version]','GameBoy']])
    assert.equal(invoke('auditMatch',item,{id:2,'product-name':name,'console-name':system}),false);
  assert.equal(invoke('auditMatch',{name:'Nintendo Switch 2 Console',system:'Nintendo Switch 2'},{id:3,'product-name':'Nintendo Switch 2','console-name':'Nintendo Switch 2'}),true);
});
test('large gaps require both $10 and 30%, in both directions',()=>{
  for(const [old,price,flag] of [[1000,2000,true],[5000,6500,true],[5000,3500,true],[10000,12000,false],[1000,1500,false],[1000,null,false]])
    assert.equal(invoke('auditGap',{comparePrice:old},price).flag,flag);
});
test('table output escapes source titles and notes',()=>{assert.equal(invoke('auditEsc','<script>'), '&lt;script&gt;');});
(async()=>{
  const item={id:1,name:'Example',system:'Playstation 4',condition:'cib',comparePrice:1000,allUnits:3,latestDate:'2026-10-01',upcs:['123456789012']};
  ctx.calls=[];
  vm.runInContext(`audit.config={amazonSet:true};audit.engine={
    api:async(route,{params})=>{calls.push(route);if(route==='pc/product')return {id:42,'product-name':'Example','console-name':'Playstation 4',upc:'123456789012'};
      if(route==='pc/sales')return {sales:{cib:[{price:2000}]}};if(route==='amazon/offers')return {found:false};throw Error('Unexpected request');},
    floorResult:cur=>({r:{price:2000},b:{basis:2000,from:'sale',checks:[],sale:{price:2000}},premium:null}),
    floorAmazonLowest:()=>null,floorGsFor:()=>null};`,ctx);
  const r=await invoke('auditOne',item);assert.equal(r.recommended,2000);assert.equal(r.status,'Compared');assert.equal(r.flag,true);checks++;
  const second=await invoke('auditOne',{...item,id:2,condition:'loose'});assert.equal(second.recommended,2000);
  assert.equal(ctx.calls.length,3);checks++;
  const unsupported=await invoke('auditOne',{...item,unsupported:'Unsupported condition'});assert.equal(unsupported.status,'Unsupported condition');assert.equal(ctx.calls.length,3);checks++;
  vm.runInContext(`auditCache.clear();audit.engine.api=async(route)=>{if(route==='pc/product')return {id:42,'product-name':'Example','console-name':'Playstation 4',upc:'123456789012'};throw Error('Service unavailable');};`,ctx);
  const incomplete=await invoke('auditOne',item);assert.equal(incomplete.status,'Incomplete market check');checks++;
  vm.runInContext(`auditCache.clear();audit.engine.api=async()=>({products:[{id:1,'product-name':'Example','console-name':'Playstation 4'},{id:2,'product-name':'Example','console-name':'Playstation 4'}]});`,ctx);
  const ambiguous=await invoke('auditOne',{...item,upcs:[]});assert.equal(ambiguous.status,'Match needs review');assert.equal(ambiguous.recommended,undefined);checks++;
  console.log(`${checks} history-audit checks passed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
