'use strict';
// A read-only batch client. All recommendations come from the live calculator in the same-origin iframe.
// No sales history is sent to the server, and this page never saves prices/settings/sessions.
const audit = { input:null, results:[], running:false, paused:false, next:0, active:0, config:null, started:null, finished:null, engine:null };
const auditCache = new Map();
const aq = id => document.getElementById(id);
const auditNorm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
function auditSystem(s) {
  const n = auditNorm(s);
  return ({ nes:'nintendo nes', 'nintendo entertainment system':'nintendo nes', snes:'super nintendo',
    'super nintendo entertainment system':'super nintendo', n64:'nintendo 64', 'nintendo gamecube':'gamecube',
    gameboy:'game boy', 'gameboy color':'game boy color', 'gameboy advance':'game boy advance',
    'sony playstation':'playstation', 'playstation 1':'playstation', 'sony playstation 2':'playstation 2',
    'sony playstation 3':'playstation 3', 'sony playstation 4':'playstation 4', 'sony playstation 5':'playstation 5',
    'nintendo wii':'wii', 'nintendo wii u':'wii u', 'sega genesis':'sega genesis' })[n] || n;
}
function auditMatch(item,p) {
  if (!p?.id || auditSystem(item.system)!==auditSystem(p['console-name'])) return false;
  const a=auditNorm(item.name), b=auditNorm(p['product-name']);
  return a===b || a.replace(/ console$/,'')===b.replace(/ console$/,'');
}
function auditGap(item,price) {
  if (!(price>0 && item.comparePrice>0)) return { difference:null, percent:null, flag:false };
  const difference=price-item.comparePrice, percent=difference/item.comparePrice;
  return { difference, percent, flag:Math.abs(difference)>=1000 && Math.abs(percent)>=0.30-1e-9 };
}
const cached = (key,fn) => { if(!auditCache.has(key)) auditCache.set(key,fn()); return auditCache.get(key); };
async function auditRequest(route,params={}) {
  for(let attempt=0;attempt<3;attempt++) {
    try { return await audit.engine.api(route,{params}); }
    catch(err) {
      if(err.status===401) { audit.paused=true; throw Error('Staff login expired. Sign in, reload this page, and resume the downloaded results.'); }
      if(attempt===2 || ![429,500,502,503,504].includes(err.status)) throw err;
      await new Promise(resolve=>setTimeout(resolve,3000*(attempt+1)));
    }
  }
}
async function auditProduct(item) {
  return cached(`product|${auditSystem(item.system)}|${auditNorm(item.name)}`,async()=>{
    let rejected=null;
    for(const upc of (item.upcs || []).slice(0,2)) {
      try { const p=await auditRequest('pc/product',{upc}); if(auditMatch(item,p)) return p; if(p?.id) rejected=`Barcode returned ${p['product-name']} / ${p['console-name']}`; }
      catch(err) { if(audit.paused) throw err; rejected=err.message; }
    }
    const found=await auditRequest('pc/products',{q:`${item.name} ${item.system}`});
    const matches=(found.products || []).filter(p=>auditMatch(item,p));
    if(matches.length!==1) throw Error(matches.length>1?'Multiple exact catalog matches; select the correct variant manually':`No exact title/platform match${rejected?`; ${rejected}`:''}`);
    const p=await auditRequest('pc/product',{id:matches[0].id});
    if(!auditMatch(item,p)) throw Error('Catalog detail does not match the selected title/platform');
    return p;
  });
}
async function auditOne(item) {
  if(item.unsupported) return {...item,status:'Unsupported condition',notes:[item.unsupported],flag:false};
  let product;
  try { product=await auditProduct(item); }
  catch(err) { return {...item,status:'Match needs review',notes:[err.message],flag:false}; }
  const upc=String(product.upc || '').split(/[,\s]+/)[0];
  const condition=item.condition==='new'?'new':'used';
  const [sold,amazon] = await Promise.all([
    cached(`sales|${product.id}`,()=>auditRequest('pc/sales',{id:product.id}).then(d=>({sales:d.sales})).catch(e=>({sales:null,salesError:e.message}))),
    audit.config.amazonSet ? cached(`amazon|${upc}|${condition}`,()=>/^\d{8,14}$/.test(upc)
      ? auditRequest('amazon/offers',{upc,cond:condition}).catch(e=>({error:e.message}))
      : Promise.resolve({error:'No valid catalog barcode for Amazon'})) : Promise.resolve(null),
  ]);
  const cur={product,condition:item.condition,manualMissing:item.manualMissing,pick:null,typed:null,...sold,amazon};
  const result=audit.engine.floorResult(cur), price=result.r?.price??null;
  const notes=[...(result.b.checks || [])];
  if(item.allUnits<3) notes.push('Fewer than three historical units sold');
  if(item.latestDate<'2026-04-20') notes.push('Most recent store sale is over 180 days old');
  if(audit.config.amazonSandbox) notes.push('Amazon sandbox data: recommendation is not a real-market comparison');
  const incomplete=!!(sold.salesError || amazon?.error || audit.config.amazonSandbox);
  return {...item,status:price==null?'No recommendation':incomplete?'Incomplete market check':result.b.from==='pricecharting'?'PriceCharting fallback':'Compared',
    recommended:price,...auditGap(item,price),lookedUpAt:new Date().toISOString(),
    pcId:product.id,matchedName:product['product-name'],matchedSystem:product['console-name'],
    source:result.b.from,basis:result.b.basis,ebay:result.b.sale?.price??null,ebayTitle:result.b.sale?.title||'',ebayUrl:result.b.sale?.url||'',
    amazonLowest:audit.engine.floorAmazonLowest(cur),amazonTitle:amazon?.title||'',amazonUrl:amazon?.url||'',
    gamestop:audit.engine.floorGsFor(cur),premium:result.premium,notes};
}
const auditEsc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const auditMoney = n => n==null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
function auditRender() {
  const total=audit.input?.items.length||0, done=audit.results.length, flags=audit.results.filter(r=>r.flag);
  aq('progress').max=total||1; aq('progress').value=done;
  aq('counts').textContent=`${done} / ${total} completed · ${flags.length} large gaps · ${audit.results.filter(r=>r.status!=='Compared').length} results needing additional review`;
  aq('current').textContent=audit.running?`${audit.active} lookups active. The service's normal request limits still apply.`:'';
  aq('start').disabled=!audit.engine||!audit.input||audit.running||done===total;
  aq('pause').disabled=!audit.running; aq('download').disabled=!done;
  aq('historyFile').disabled=audit.running; aq('resumeFile').disabled=audit.running;
  aq('rows').innerHTML=flags.sort((a,b)=>Math.abs(b.difference)-Math.abs(a.difference)).slice(0,30).map(r=>`<tr><td>${auditEsc(r.name)}<br><small>${auditEsc(r.system)} · ${auditEsc(r.condition)}${r.manualMissing?' · no manual':''}</small></td><td>${auditMoney(r.comparePrice)}</td><td>${auditMoney(r.recommended)}</td><td>${auditMoney(r.difference)} (${Math.round(r.percent*100)}%)</td><td>${r.allUnits}</td><td>${auditEsc([r.status,...r.notes].join('; '))}</td></tr>`).join('');
  aq('issues').textContent=audit.results.filter(r=>r.status!=='Compared').slice(-15).map(r=>`${r.name} / ${r.system}: ${r.status}. ${(r.notes||[]).join('; ')}`).join('\n');
}
async function auditRun() {
  audit.running=true; audit.paused=false; audit.started ||= new Date().toISOString(); audit.finished=null;
  const done=new Set(audit.results.map(r=>r.id)), queue=audit.input.items.filter(r=>!done.has(r.id)); let next=0;
  aq('status').textContent='Comparing every item with the current pricing tool…'; auditRender();
  async function worker() {
    while(!audit.paused && next<queue.length) {
      const item=queue[next++]; audit.active++;
      try { audit.results.push(await auditOne(item)); }
      catch(err) { audit.results.push({...item,status:'Lookup error',notes:[err.message],flag:false}); }
      audit.active--; auditRender();
    }
  }
  await Promise.all(Array.from({length:3},worker));
  audit.running=false;
  if(audit.results.length===audit.input.items.length) {audit.finished=new Date().toISOString();aq('status').textContent='Comparison complete. Download the results for the full review.';}
  else aq('status').textContent='Paused. Download a checkpoint before closing this page; Start comparison resumes remaining items.';
  auditRender();
}
function auditDownload() {
  const report={schema:1,started:audit.started,finished:audit.finished,generated:new Date().toISOString(),
    source:{...audit.input,items:undefined},config:{amazonSet:audit.config.amazonSet,amazonSandbox:audit.config.amazonSandbox},results:audit.results};
  const url=URL.createObjectURL(new Blob([JSON.stringify(report)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='pricing-history-comparison.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function auditInit() {
  try {
    for(let i=0;i<120;i++) {
      const engine=aq('engine').contentWindow;
      if(engine?.floorResult && engine.document.getElementById('view-trade')?.hidden===false) {audit.engine=engine;break;}
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    if(!audit.engine) throw Error('Sign in to the pricing tool, then reload this page.');
    audit.config=await auditRequest('status');
    if(!audit.config.tokenSet) throw Error('Live PriceCharting access is not configured.');
    aq('status').textContent='Ready. Choose the prepared sales history to compare.';
    auditRender();
  } catch(err) {audit.engine=null;aq('status').textContent=err.message;}
}
aq('historyFile').addEventListener('change',async e=>{
  try {const input=JSON.parse(await e.target.files[0].text());if(input.schema!==1||!Array.isArray(input.items)||input.items.some(i=>!Number.isInteger(i.id)||!i.name||!i.system||!(i.comparePrice>0)))throw Error('Invalid prepared history file');
    if(new Set(input.items.map(i=>i.id)).size!==input.items.length)throw Error('Duplicate history IDs');
    audit.input=input;audit.results=[];auditCache.clear();audit.started=null;audit.finished=null;aq('status').textContent=`Loaded ${input.items.length} title/platform/condition combinations.`;auditRender();
  }catch(err){aq('status').textContent=err.message;}
});
aq('resumeFile').addEventListener('change',async e=>{
  try {if(!audit.input)throw Error('Load the prepared history first');const prior=JSON.parse(await e.target.files[0].text());
    const byId=new Map(audit.input.items.map(i=>[i.id,i]));
    if(!Array.isArray(prior.results)||new Set(prior.results.map(r=>r.id)).size!==prior.results.length
      ||prior.results.some(r=>!byId.has(r.id)||['name','system','condition','manualMissing','comparePrice'].some(k=>r[k]!==byId.get(r.id)[k])))throw Error('Checkpoint does not match this history');
    audit.results=prior.results;audit.started=prior.started;aq('status').textContent=`Resumed ${audit.results.length} completed items.`;auditRender();
  }catch(err){aq('status').textContent=err.message;}
});
aq('start').addEventListener('click',auditRun);aq('pause').addEventListener('click',()=>{audit.paused=true;aq('status').textContent='Pausing after active lookups finish…';});
aq('download').addEventListener('click',auditDownload);
auditInit();
