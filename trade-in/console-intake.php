<?php
declare(strict_types=1);

// Reuse the calculator's signed, path-scoped login and password rotation.
define('P2W_TRADEIN_PAGE', true);
require __DIR__ . '/api.php';
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: private, no-store');
if (current_role() === null):
    http_response_code(401);
?>
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>Employee sign-in · Play2Win Games</title>
<link rel="icon" href="../favicon-32.png">
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f5f7;color:#211c26;font:1rem/1.5 system-ui,sans-serif}main{width:min(92%,27rem);padding:2rem;border:1px solid #d6d0d8;border-radius:1rem;background:white}img{width:72px;border-radius:8px}h1{font-size:2rem;line-height:1.12}label{display:block;font-weight:650}input,button{font:inherit;width:100%;min-height:48px;border-radius:8px;padding:10px}input{margin:5px 0 14px;border:1px solid #857889}button{border:0;background:#9e1734;color:white;font-weight:700}#error{color:#9e1734}button:focus-visible,input:focus-visible{outline:3px solid #176daf;outline-offset:2px}
</style></head>
<body><main><img src="../assets/logo.jpg" alt="Play2Win Games"><h1>Trade-in inspection</h1><p>Sign in with your trade-in calculator password.</p>
<form id="login" method="post"><label for="password">Staff or manager password</label><input type="password" id="password" autocomplete="current-password" required><button>Sign in</button><p role="alert" id="error"></p></form></main>
<script>
document.getElementById('login').addEventListener('submit', async event => {
  event.preventDefault();
  const password = document.getElementById('password');
  const button = event.currentTarget.querySelector('button');
  const error = document.getElementById('error');
  button.disabled = true;
  error.textContent = '';
  try {
    const response = await fetch('api.php?route=login', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({password: password.value})
    });
    const result = await response.json();
    if (response.ok && result.ok) { password.value = ''; location.replace(location.pathname); return; }
    error.textContent = result['error-message'] || 'Sign-in failed. Try again.';
    password.select();
  } catch { error.textContent = 'Could not reach the store website. Try again.'; }
  finally { button.disabled = false; }
});
</script></body></html>
<?php exit; endif; ?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<link rel="icon" href="../favicon-32.png"><title>Trade-in inspection · Play2Win Games</title>
<style>
:root{font:100%/1.45 "Inter",system-ui,sans-serif;color:#1c292a;background:#f3f6f4;--ink:#28202c;--green:#951632;--line:#cbd6d1;--muted:#52655f;--lime:#cded80}
*{box-sizing:border-box}body{margin:0}header{background:var(--ink);color:white} .bar,main{max-width:1200px;margin:auto;padding:0 clamp(16px,4vw,52px)}.bar{min-height:72px;display:flex;align-items:center;justify-content:space-between;gap:16px}.brand{display:flex;align-items:center;gap:12px;font-size:1.12rem;font-weight:750}.mark{background:var(--lime);border-radius:10px;color:var(--ink);padding:6px 8px;letter-spacing:-2px;font-style:italic;font-weight:900}.bar button{background:transparent;color:white;border:1px solid #80948d}.hero{padding:32px 0 24px;display:flex;align-items:flex-end;justify-content:space-between;gap:12px}.hero h1{font-size:clamp(1.85rem,4vw,2.8rem);letter-spacing:-.05em;margin:0}.hero p{margin:4px 0 0;color:var(--muted)}.meter{min-width:150px;color:var(--muted);font-size:.9rem}.meter progress{display:block;width:100%;height:8px;accent-color:var(--green);margin-top:7px}
.layout{display:grid;grid-template-columns:190px 1fr;align-items:start;gap:22px;margin-bottom:36px}nav{position:sticky;top:16px;display:grid;gap:4px}nav button{border:0;text-align:left;color:var(--muted);background:transparent;padding-left:14px}nav button[aria-current=step]{color:#6e1427;background:#f4e0e5;box-shadow:inset 3px 0 var(--green)}button,input,textarea,select{font:inherit}button{cursor:pointer;font-weight:650;border:1px solid var(--line);background:white;color:var(--ink);border-radius:9px;min-height:46px;padding:8px 16px}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:3px solid #1b78b6;outline-offset:2px}.panel{background:#fff;border-radius:16px;border:1px solid var(--line);min-width:0;padding:clamp(18px,3vw,34px)}h2{font-size:1.55rem;letter-spacing:-.035em;margin:0 0 5px}h3{font-size:1.05rem;margin:22px 0 8px}p.hint{color:var(--muted);margin:0 0 18px}.group{margin:24px 0;border-top:1px solid var(--line)}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 18px}.field{display:grid;align-content:start;gap:5px;font-size:.94rem;font-weight:600;min-width:0}input:not([type=radio]):not([type=checkbox]),textarea,select{width:100%;min-width:0;background:#fbfcfb;border:1px solid #9eafa7;border-radius:8px;min-height:48px;padding:10px 12px;font-size:1rem;color:var(--ink)}textarea{resize:vertical;min-height:76px}.wide{grid-column:1/-1}fieldset{min-width:0;border:0;padding:0;margin:0}legend{font-weight:650;padding:0;margin-bottom:7px}.choices{display:flex;flex-wrap:wrap;gap:7px}.choice{display:inline-flex;align-items:center;gap:9px;padding:9px 13px;min-height:46px;border:1px solid #acbcb5;border-radius:8px;cursor:pointer;background:white}.choice input{width:18px;height:18px;accent-color:var(--green);margin:0}.choice:has(:checked){background:#e1f2e8;border-color:var(--green);color:#074637}.test{padding:16px 0;border-top:1px solid var(--line)}.test legend{font-size:1.02rem}.test details{margin-top:3px}.test summary{display:inline-flex;align-items:center;min-height:44px;color:var(--green);cursor:pointer;font-weight:600}.note{border-left:4px solid #a57929;background:#fcf5e4;padding:12px 16px;border-radius:5px;margin:14px 0 18px}.actions{display:flex;justify-content:space-between;gap:10px;border-top:1px solid var(--line);padding-top:20px;margin-top:24px;flex-wrap:wrap}.primary{background:var(--green);color:white;border-color:var(--green)}dialog{border:1px solid var(--line);border-radius:16px;width:min(570px,94vw);max-height:85vh;padding:24px}dialog::backdrop{background:#10232188}dialog li{margin-bottom:9px}#report{display:none}.review{display:grid;grid-template-columns:minmax(120px,1fr) 2fr;margin:0}.review dt,.review dd{border-bottom:1px solid var(--line);padding:7px 0;overflow-wrap:anywhere;white-space:pre-wrap}.review dt{font-weight:600;padding-right:14px}.review dd{margin:0}.reportGroup{break-inside:auto}.small{font-size:.9rem;color:var(--muted)}[hidden]{display:none!important}footer{padding:0 0 24px;color:var(--muted);font-size:.9rem}
@media(max-width:900px){.layout{grid-template-columns:1fr;gap:12px}nav{position:static;display:flex;overflow:auto;padding:3px;gap:4px}nav button{white-space:nowrap}nav button[aria-current=step]{box-shadow:inset 0 -3px var(--green)}}
@media(max-width:560px){.hero{display:block;padding:21px 0 14px}.meter{margin-top:12px}.grid{grid-template-columns:1fr}.bar{min-height:62px}.bar button{padding:6px 10px}.panel{border-radius:12px}.choice{padding:9px 10px}.review{grid-template-columns:1fr}.review dt{border-bottom:0}.review dd{padding-top:0}}
@media print{@page{margin:14mm}body{background:white;color:black;font:10pt/1.35 sans-serif}header,main,dialog{display:none!important}#report{display:block}.review{display:grid;grid-template-columns:40% 60%}.review dt,.review dd{padding:3px 5px;border-bottom:1px solid #ddd}#report h2{font-size:14pt;border-bottom:1px solid #555;margin-top:16px;break-after:avoid}#report h1{font-size:20pt}#report .entry{break-inside:avoid}}
</style></head>
<body>
<header><div class="bar" style="flex-wrap:wrap;padding-block:8px"><div class="brand"><img src="../assets/logo.jpg" width="44" height="44" alt="" style="border-radius:8px;object-fit:contain"> Play2Win Games</div><div class="choices"><button type="button" id="findOpen">Find an inspection</button><button type="button" id="guideOpen">Procedure guide</button></div></div></header>
<main><div class="hero"><div><h1>Trade-in inspection</h1><p>Console intake and employee evaluation</p></div><div class="meter"><span id="count">0 of 22 checks recorded</span><progress id="progress" max="22" value="0" aria-label="Checks recorded"></progress></div></div>
<div class="layout"><nav id="nav" aria-label="Form sections"></nav><div class="panel"><form id="form" autocomplete="off"><div id="pages"></div><div class="actions"><button type="button" id="back">Back</button><button type="button" class="primary" id="next">Continue</button></div></form></div></div>
<footer><button type="button" id="logout">Sign out</button><p id="logoutError" role="alert"></p>Save the completed inspection in Review. Unsaved entries clear when you close or reload this tab.</footer></main>
<dialog id="archive" aria-labelledby="archiveTitle">
<h2 id="archiveTitle">Find an inspection</h2>
<form id="lookup"><label class="field" for="lookupNumber">Full serial number or intake number</label>
<input id="lookupNumber" autocomplete="off" autocapitalize="off" spellcheck="false" required>
<div class="actions"><button type="button" id="closeArchive">Close</button><button class="primary">Search</button></div></form>
<p id="searchStatus" role="status"></p><div id="matches"></div>
<div id="savedPanel" hidden><h3 id="savedTitle" tabindex="-1">Saved inspection</h3><p id="savedTime"></p>
<button type="button" id="printSaved">Print / save PDF</button>
<div id="savedDetail"></div></div></dialog>
<dialog id="guide"><h2>Employee procedure</h2><ol>
<li>Confirm store authorization and create an intake record.</li><li>Identify the exact model and record its serial number according to store policy.</li><li>Record received items and arrival condition before testing.</li><li>Inspect before connecting power. Stop for liquid damage, exposed wiring, burning, swelling, or other safety hazards.</li><li>Use known-good, store-approved test equipment.</li><li>Record each applicable result and describe defects or tests you could not complete.</li><li>Protect customer privacy. Never request passwords or record account information.</li><li>Refer locks, suspected tampering, safety concerns, uncertain results, and exceptions to a manager.</li><li>Complete the condition summary. Only authorized personnel may determine or approve an offer.</li><li>Retain the completed record according to store policy.</li></ol><button type="button" id="guideClose">Close guide</button></dialog>
<dialog id="newDialog"><h2>Start another intake?</h2><p>Starting a new intake clears this form. Saved inspections remain available under Find an inspection.</p><div class="actions"><button type="button" id="cancelNew">Keep working</button><button type="button" id="clearForm" class="primary">Clear and start new</button></div></dialog>
<article id="report"></article>
<script>
'use strict';
const physical=['Exterior and casing — cracks, dents, warping or heavy wear','Serial number and product labels — present and legible','Ports and connectors — damage, looseness or corrosion','Ventilation openings — blockage, dust buildup or damage','Signs of liquid damage, corrosion, burning or unusual odor','Evidence of tampering, missing screws or unauthorized modification','Controller, dock and accessories — condition and completeness'];
const functional=['Power on and startup','Video output — stable picture without artifacts or flicker','Audio output at a reasonable level','Controller connection and input response','Buttons, sticks, triggers and directional controls','Disc drive accepts, reads and ejects discs','Game card or cartridge slot reads media','USB and other external ports','Wi-Fi or network connection, if permitted','Internal storage recognized without obvious errors','Fan operation, unusual noise and overheating','Charging and battery operation','Docking and TV output','Factory reset or account-lock status handled per store policy','Other model-specific test'];
const titles=['Intake','Physical inspection','Functional tests','Account & data','Evaluation','Sign-off','Review'];
const $=id=>document.getElementById(id);
const form=$('form'), sections=[], records=[], tests=[];
function el(tag,attrs={},content=''){const node=document.createElement(tag);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,v);if(content)node.textContent=content;return node}
function add(parent,tag,attrs,content){const node=el(tag,attrs,content);parent.append(node);return node}
let page=0,buildSection=0;
for(const [i,name] of titles.entries()){
 const section=add($('pages'),'section',{'aria-labelledby':'title'+i});sections.push(section);
 add(section,'h2',{id:'title'+i,tabindex:'-1'},name);
 const button=add($('nav'),'button',{type:'button'},name);button.onclick=()=>show(i);
}
function block(title){const group=add(sections[buildSection],'div',{class:'group'});add(group,'h3',{},title);return add(group,'div',{class:'grid'})}
function hint(message,cls='hint'){add(sections[buildSection],'p',{class:cls},message)}
function field(parent,name,label,type='text',wide=false,initial=''){
 const wrap=add(parent,'label',{class:'field'+(wide?' wide':'')});add(wrap,'span',{},label);
 const node=add(wrap,type==='area'?'textarea':'input',{name,id:name});
 if(type!=='area')node.type=type;
 if(initial)node.value=initial;
 records.push({name,section:buildSection,label,read:()=>node.value.trim()});return node;
}
function options(parent,name,label,values,multi=false){
 const fs=add(parent,'fieldset',{class:'wide'});add(fs,'legend',{},label);const row=add(fs,'div',{class:'choices'});
 for(const val of values){const wrap=add(row,'label',{class:'choice'});add(wrap,'input',{type:multi?'checkbox':'radio',name,value:val});wrap.append(document.createTextNode(val))}
 const read=()=>Array.from(fs.querySelectorAll('input:checked'),n=>n.value).join(', ');
 records.push({name,section:buildSection,label,read});return fs;
}
function localDate(time=false){const d=new Date();d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,time?16:10)}
hint('Identify the console and record what arrived with it.');
let grid=block('Intake record');
field(grid,'store','Store / location');field(grid,'intake','Transaction / intake number');field(grid,'employee','Employee');field(grid,'received','Intake date and time','datetime-local',false,localDate(true));field(grid,'reviewer','Manager / reviewer');field(grid,'version','SOP version','text',false,'1.0');
grid=block('Customer and console');field(grid,'customer','Customer name or ID (per store policy)');field(grid,'contact','Contact or transaction reference');field(grid,'platform','Manufacturer / platform');field(grid,'model','Model / edition');field(grid,'serial','Serial number');field(grid,'storage','Storage capacity');
grid=block('Arrival condition and accessories');options(grid,'arrival','Condition at arrival',['New / like new','Good','Fair','Poor','Parts / repair','Unable to assess']);options(grid,'items','Items received',['Console','Power cable','HDMI / video cable','Controller(s)','Dock','Stand','Other'],true);field(grid,'power','Included power supply / cable');field(grid,'otherItems','Other items received');field(grid,'history','Customer-reported issues, history or known defects','area',true);
function checklist(items,prefix){
 for(const [i,label] of items.entries()){
  const test=add(sections[buildSection],'div',{class:'test'}),name=prefix+i;
  const part=options(test,name,label,['Pass','Fail','N/A','Couldn’t test']);const record=records[records.length-1];
  if(prefix==='f'&&i===items.length-1)field(test,'specific','Model-specific test performed');
  const details=add(test,'details',{});add(details,'summary',{},'Observation / notes');
  field(details,name+'note','Notes for '+label,'area');
  part.addEventListener('change',()=>{if(['Fail','Couldn’t test'].includes(record.read()))details.open=true;updateCount()});
  tests.push(record);
 }
}
buildSection=1;hint('Inspect before connecting power. Only open or repair a console when store policy authorizes it.');
hint('Stop if you see liquid damage, exposed wiring, burning, swelling, or another safety hazard. Record what you observed and refer it to a manager.','note');checklist(physical,'p');
buildSection=2;hint('Use known-good, store-approved equipment. Choose N/A for tests that do not apply to this model. For a test you couldn’t complete, record the reason.');checklist(functional,'f');
buildSection=3;hint('Follow store policy and manufacturer guidance. Never request passwords or PINs, or access, copy, browse or retain customer personal data.');
hint('Stop and refer the console to a manager if it remains linked to an account, has an activation lock or cannot be safely reset.','note');
grid=block('Account handling');options(grid,'advised','Customer guidance',['Advised to remove personal accounts / disable device locks'],true);options(grid,'resetStatus','Reset status',['Completed using approved process','Not completed']);options(grid,'lock','Manager referral',['Account / activation lock concern'],true);field(grid,'action','Details / action taken','area',true);
buildSection=4;hint('Summarize the inspection before recording a valuation.');
grid=block('Condition summary');options(grid,'outcome','Functional classification',['Fully functional','Functional with noted defects','Non-functional','Incomplete testing','Parts / repair only']);field(grid,'result','Overall functional result','text',true);field(grid,'cosmetic','Cosmetic condition');field(grid,'complete','Completeness');field(grid,'defects','Defects, missing items or additional observations','area',true);
hint('Only a manager or authorized employee may determine or approve the offer. Test results alone do not authorize a purchase.','note');
grid=block('Valuation and disposition');field(grid,'grade','Estimated resale grade');field(grid,'proposed','Proposed purchase / trade value');field(grid,'offer','Final approved offer');options(grid,'disposition','Disposition',['Eligible for offer','Offer pending manager review','Decline','Refer for further testing','Parts / repair evaluation']);field(grid,'pricing','Reason / pricing notes','area',true);field(grid,'approval','Manager approval name');field(grid,'approvedAt','Approval date and time','datetime-local');
buildSection=5;hint('Type each signer’s name, or leave the signature line blank for signing on paper. Use the method your store accepts.');
const acknowledgment='I acknowledge that the console and accessories listed above were presented for inspection and that the recorded condition and test results reflect the store’s evaluation at the time of intake. This acknowledgment does not constitute acceptance of an offer or transfer of ownership.';
const certification='I completed the applicable inspection and tests, recorded observed results accurately, and escalated any safety, security, or policy concern.';
grid=block('Customer acknowledgment (if required)');add(grid,'p',{class:'wide'},acknowledgment);field(grid,'customerSign','Customer signature');field(grid,'customerDate','Customer signature date','date');
grid=block('Employee certification');add(grid,'p',{class:'wide'},certification);field(grid,'employeeSign','Employee signature');field(grid,'employeeDate','Employee signature date','date');
grid=block('Manager review');field(grid,'managerSign','Manager / reviewer signature');field(grid,'managerDate','Manager review date','date');
buildSection=6;hint('Review the results and save the completed inspection for staff lookup. You can also print a copy.');
const statusLine=add(sections[6],'p',{class:'note'});
const saveButton=add(sections[6],'button',{type:'button',class:'primary'},'Save completed inspection');
const saveStatus=add(sections[6],'p',{role:'status'});
const preview=add(sections[6],'div',{});
function updateCount(){const count=tests.filter(t=>t.read()).length;$('count').textContent=count+' of 22 checks recorded';$('progress').value=count;return count}
function renderReport(root,printing,snapshot=null){
 root.replaceChildren();
 if(printing){
  add(root,'h1',{},'Play2Win Games · Trade-in inspection');
  const count=snapshot?tests.filter(r=>snapshot.fields[r.name]).length:updateCount();
  add(root,'p',{},count+' of 22 checks recorded');
  if(snapshot)add(root,'p',{},'Saved '+formatSaved(snapshot.saved));
 }
 for(let i=0;i<6;i++){
  const group=add(root,printing?'section':'details',{class:'reportGroup'});if(!printing){group.classList.add('test');if(i===0)group.open=true}
  add(group,printing?'h2':'summary',{},titles[i]);
  for(const r of records.filter(item=>item.section===i)){
   const value=snapshot?(snapshot.fields[r.name]||''):r.read();if(!value&&r.label.startsWith('Notes for '))continue;
   if(i===5&&r.label==='Customer signature')add(group,'p',{},acknowledgment);
   if(i===5&&r.label==='Employee signature')add(group,'p',{},certification);
   const row=add(group,'dl',{class:'review entry'});add(row,'dt',{},r.label);
   add(row,'dd',{},value||(tests.includes(r)?'Unanswered':(r.label.endsWith('signature')?'____________________':'—')));
  }
 }
}
function show(i,focus=true){
 page=i;sections.forEach((s,n)=>{s.hidden=n!==i;const b=$('nav').children[n];if(n===i)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current')});
 $('back').hidden=i===0;$('back').textContent=i===6?'Start new intake':'Back';$('next').textContent=i===6?'Print / save PDF':'Continue';
 if(i===6){const missing=22-updateCount();statusLine.textContent=missing?missing+' unanswered '+(missing===1?'check':'checks')+'. The printed record will identify each unanswered check.':'All 22 checks have a recorded response.';renderReport(preview,false)}
 if(focus){$( 'title'+i).focus({preventScroll:true});window.scrollTo(0,0);const nav=$('nav');if(nav.scrollWidth>nav.clientWidth)nav.scrollLeft=nav.children[i].offsetLeft-nav.offsetLeft-12}
}
$('back').onclick=()=>page===6?$('newDialog').showModal():show(page-1);
$('next').onclick=()=>{if(page<6)show(page+1);else {renderReport($('report'),true);window.print()}};
window.addEventListener('beforeprint',()=>renderReport($('report'),true,$('archive').open?openedInspection:completedInspection));
$('guideOpen').onclick=()=>$('guide').showModal();$('guideClose').onclick=()=>$('guide').close();
$('cancelNew').onclick=()=>$('newDialog').close();
let edited=false;form.addEventListener('input',()=>{edited=true});window.addEventListener('beforeunload',e=>{if(edited){e.preventDefault();e.returnValue=''}});
$('clearForm').onclick=()=>{
 for(const control of form.querySelectorAll('input,textarea'))control.disabled=false;
 form.reset();$('version').value='1.0';$('received').value=localDate(true);
 for(const detail of form.querySelectorAll('details'))detail.open=false;
 preview.replaceChildren();$('report').replaceChildren();
 completedInspection=null;inspectionId=null;saveButton.disabled=false;saveStatus.replaceChildren();
 edited=false;updateCount();$('newDialog').close();show(0);
};
$('logout').onclick=async()=>{
 if(edited && !window.confirm('Sign out and discard the unsaved entries in this tab?'))return;
 try {
  const response=await fetch('api.php?route=logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  if(!response.ok)throw new Error();
  edited=false;location.replace(location.pathname);
 } catch { $('logoutError').textContent='Could not sign out. Check the connection and try again.'; }
};
// Recheck the session when a browser restores a previously visited page.
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload()});
form.onsubmit=e=>e.preventDefault();show(0,false);
</script>
<script src="inspection-records.js?v=1"></script>
</body></html>
