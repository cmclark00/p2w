'use strict';

// Queue owns research independently of the card the employee is viewing.
// One job at a time; each job retains the existing source and helper concurrency.
let floorQueueEnabled = false;
const floorQueue = [];
let floorQueueRunning = false;
let floorQueueSelectedId = null;
let floorRecentResults = [];
const FLOOR_RECENT_VERSION = '20261121-queue-skyrim-1';
const FLOOR_RECENT_TTL = 30 * 60 * 1000;
const floorQueueClone = value => JSON.parse(JSON.stringify(value));

function floorRecentScope() {
  return JSON.stringify([FLOOR_RECENT_VERSION, document.querySelector('script[src*="app.js"]')?.src || '', settings, amazonSet, tokenSet]);
}
function floorRecentKey(cur) {
  return JSON.stringify([String(cur.product.id), cur.product['product-name'], cur.product['console-name'],
    cur.condition, !!cur.manualMissing, cur.toyGroup || 'auto', floorQuickPricing(cur) ? 'quick' : 'research']);
}
function floorQueueContext(product, condition = 'cib', extra = {}) {
  return { product: floorQueueClone(product), condition: floorCondition(product, condition), quickPricingEnabled: true,
    manualMissing: false, pick: null, typed: null, showAll: false, queueManaged: true, queueDone: false, ...extra };
}
function saveFloorQueue() {
  // Persist identities, never half-finished prices or helper promises. Reload resumes research.
  store.set('p2w-scan-queue', floorQueue.map(j => ({ id: j.id, upc: j.upc, product: j.cur?.product,
    condition: j.cur?.condition || j.condition, manualMissing: !!j.cur?.manualMissing,
    researchRequested: !!j.cur?.researchRequested, toyGroup: j.cur?.toyGroup })));
}
function selectFloorQueueItem(job) {
  floorQueueSelectedId = job.id;
  floorCur = job.cur;
  renderFloorQueue(); renderFloorPricer();
}
function resolveFloorQueueBarcode(job) {
  if (job.cur) return Promise.resolve();
  if (!job.lookup) job.lookup = PC.byUpc(job.upc).then(product => {
    if (!floorQueue.includes(job)) return;
    job.cur = floorQueueContext(product, job.condition);
    if (floorQueueSelectedId === job.id) floorCur = job.cur;
    saveFloorQueue(); renderFloorQueue(); renderFloorPricer();
  }).catch(error => {
    job.lookupError = error;
    if (floorQueue.includes(job)) {
      job.state = 'review'; job.error = error.message;
      if (floorQueueSelectedId === job.id) toast(error.message, 'error');
      renderFloorQueue();
    }
  });
  return job.lookup;
}
function enqueueFloorScan({ product, upc, condition = 'cib', ...extra }, select = true) {
  if (floorQueue.length >= 100) { toast('The scan queue has 100 items. Remove finished items before scanning more.', 'error'); return; }
  const existing = floorQueue.find(j => upc ? j.upc === upc : j.cur?.product.id === product?.id && j.cur?.condition === floorCondition(product, condition));
  if (existing) { selectFloorQueueItem(existing); toast('Already in the scan queue.'); return; }
  const job = { id: uid(), upc, condition, state: 'queued', cur: product ? floorQueueContext(product, condition, extra) : null };
  floorQueue.push(job);
  if (select || !floorCur) selectFloorQueueItem(job);
  // Resolve the scanned identity immediately, even while an older game's research runs.
  if (!job.cur) void resolveFloorQueueBarcode(job);
  saveFloorQueue(); renderFloorQueue(); renderFloorPricer();
  void pumpFloorQueue();
}
function floorQueueRefresh(job, extra = {}) {
  if (!job?.cur) return;
  const old = job.cur;
  old.queueCancelled = true;
  job.cur = floorQueueContext(old.product, extra.condition || old.condition, {
    researchRequested: old.researchRequested, manualMissing: old.manualMissing, toyGroup: old.toyGroup, ...extra,
  });
  if (job.cur.condition !== 'cib') job.cur.manualMissing = false;
  job.fresh = true; job.state = 'queued'; job.error = null;
  if (floorCur === old) floorCur = job.cur;
  saveFloorQueue(); renderFloorQueue(); renderFloorPricer(); void pumpFloorQueue();
}
function finishFloorQueueItem(cur) {
  const index = floorQueue.findIndex(j => j.cur === cur);
  if (index >= 0 && floorQueueSelectedId === floorQueue[index].id) floorQueueSelectedId = null;
  if (index >= 0) floorQueue.splice(index, 1);
  cur.queueCancelled = true;
  saveFloorQueue(); renderFloorQueue();
}
function onFloorQueuePricerClick(e) {
  const cur = floorCur, job = floorQueue.find(j => j.cur === cur);
  const cond = e.target.closest('[data-floor-cond]')?.dataset.floorCond;
  const act = e.target.closest('[data-floor-act]')?.dataset.floorAct;
  if (cond) { if (cond !== cur.condition) floorQueueRefresh(job, { condition: cond }); return true; }
  if (['research', 'amazon', 'ebay-search', 'ebay-resume'].includes(act)) {
    floorQueueRefresh(job, { researchRequested: true }); return true;
  }
  if (act === 'auto' && cur.typed != null) { floorQueueRefresh(job); return true; }
  return false;
}
function floorQueueEvidence(cur) {
  // Explicit evidence fields only: no staff/customer data, manual overrides, UI state or promises.
  const keys = ['product','condition','quickPricingEnabled','researchRequested','manualMissing','toyGroup',
    'quickSales','sales','salesNotes','salesSources','salesError','standardGame','gamestopUrl','gamestopStock','amazon','directEbay','ebayChecks','cibComparison'];
  const data = {};
  for (const key of keys) if (cur[key] !== undefined) data[key] = cur[key];
  return JSON.parse(JSON.stringify(data, (key, value) => ['targetedEbay','ebayRun','queueManaged','queueDone','queueCancelled'].includes(key) ? undefined : value));
}
function floorQueueCanShare(cur) {
  if (!cur.queueDone || cur.queueCancelled || cur.typed != null || cur.pick != null) return false;
  const { b, r } = floorResult(cur);
  if (!r || b.waiting || b.ebayChecking || b.ebayReview || b.cibReview || b.quickFallback) return false;
  const bad = value => value && typeof value === 'object' && (value.error || value.incomplete || value.partial || value.loading
    || value.state === 'pending' || value.state === 'unavailable' || Object.values(value).some(v => typeof v === 'object' && bad(v)));
  return !cur.fullError && !cur.salesError && !bad(floorQueueEvidence(cur));
}
async function floorRecentRequest(method, body) {
  if (!auth.enabled) return null;
  return api('floor-recent', { method, ...(body ? { body } : {}), signal: AbortSignal.timeout(5000) });
}
async function loadFloorRecent() {
  try {
    const result = await floorRecentRequest('POST', { action: 'list', scope: floorRecentScope() });
    floorRecentResults = result?.entries || [];
  } catch (_) { floorRecentResults = []; }
  renderFloorQueue();
}
function floorQueueResultState(cur) {
  const { b, r } = floorResult(cur);
  return !r || b.waiting || b.ebayChecking || b.ebayReview || b.cibReview || b.quickFallback || cur.salesError
    || cur.amazon?.error || cur.amazon?.incomplete || cur.fullError ? 'review' : 'ready';
}
async function pumpFloorQueue() {
  if (floorQueueRunning) return;
  floorQueueRunning = true;
  try {
    let job;
    while ((job = floorQueue.find(j => j.state === 'queued'))) {
      job.state = 'researching'; renderFloorQueue();
      let cur;
      try {
        if (!job.cur) {
          await resolveFloorQueueBarcode(job);
          if (!floorQueue.includes(job)) continue;
          if (job.lookupError) throw job.lookupError;
        }
        cur = job.cur;
        if (!floorCur && !floorQueueSelectedId) floorCur = cur;
        const stopped = () => !floorQueue.includes(job) || job.cur !== cur || cur.queueCancelled;
        const progress = () => { if (!stopped()) { renderFloorQueue(); if (floorCur === cur) queueFloorPricerRender(cur, cur.condition); } };
        progress(); saveFloorQueue();
        const scope = floorRecentScope(), key = floorRecentKey(cur);
        let recent = null;
        if (!job.fresh) {
          try { recent = await floorRecentRequest('POST', { action: 'get', scope, key }); } catch (_) { /* Live lookup remains available. */ }
        }
        if (stopped()) continue;
        if (recent?.entry && recent.entry.checkedAt <= Date.now() && Date.now() - recent.entry.checkedAt < FLOOR_RECENT_TTL
          && recent.entry.key === key && floorRecentKey(recent.entry.evidence) === key) {
          Object.assign(cur, floorQueueClone(recent.entry.evidence), { queueDone: true, sharedCheckedAt: recent.entry.checkedAt });
        } else {
          await researchFloorQueueItem(cur, progress, stopped);
          if (stopped()) continue;
          cur.queueDone = true;
          if (floorQueueCanShare(cur) && floorRecentScope() === scope) {
            try {
              await floorRecentRequest('POST', { action: 'save', scope, key: floorRecentKey(cur), evidence: floorQueueEvidence(cur) });
            } catch (_) { /* Sharing failure never blocks a completed local price. */ }
          }
        }
        if (stopped()) continue;
        job.state = floorQueueResultState(cur);
        job.fresh = false;
        progress();
      } catch (error) {
        if (!floorQueue.includes(job) || cur && job.cur !== cur) continue;
        job.state = 'review'; job.error = error.message;
        if (job.cur) { job.cur.queueDone = true; job.cur.salesLoading = false; job.cur.fullLoading = false; job.cur.salesError = error.message; }
        if (floorCur === job.cur) renderFloorPricer();
      }
      saveFloorQueue(); renderFloorQueue();
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  } finally { floorQueueRunning = false; void loadFloorRecent(); }
}
async function researchFloorQueueItem(cur, progress, stopped) {
  if (floorQuickPricing(cur)) {
    cur.quickSales = { loading: true }; progress();
    cur.quickSales = await fetchFloorQuickSales(cur.product); progress(); return;
  }
  // Full product data and condition averages are needed for the same premium rules.
  cur.fullLoading = true; progress();
  if (tokenSet) {
    try {
      const full = await PC.byId(cur.product.id);
      if (String(full?.id) !== String(cur.product.id)) throw new Error('Product identity was not confirmed');
      Object.assign(cur.product, full);
    }
    catch (_) { cur.fullError = true; }
  }
  cur.fullLoading = false;
  if (stopped()) return;
  cur.salesLoading = true;
  if (amazonSet) cur.amazon = { loading: true };
  progress();
  // Start the primary page immediately; its extra barcodes are required by
  // Amazon's catalog matching. The combined lookup reuses this cached request.
  const primary = pcReadRequest('pc/sales', { id: String(cur.product.id) }).then(data => {
    if (stopped()) return;
    cur.product.catalogBarcodes = data.barcodes || [];
    cur.sales = data.sales;
    cur.gamestopUrl = data.gamestopUrl || null;
    progress();
  }).catch(() => {});
  await primary;
  if (stopped()) return;
  cur.gamestopStock = { state: 'loading' };
  const stockUrl = cur.gamestopUrl;
  const stock = fetchFloorGameStopStock(cur.product, stockUrl)
    .then(value => { cur.gamestopStock = value; progress(); })
    .catch(error => { cur.gamestopStock = { state: 'unknown', error: error.message }; progress(); });
  const amazon = amazonSet ? fetchFloorAmazonRetry(cur.product, cur.condition, { cancelled: stopped,
    onRetry: () => { cur.amazon = { loading: true, retrying: true }; progress(); } })
    .then(value => { cur.amazon = value; progress(); }).catch(error => { cur.amazon = { error: error.message }; progress(); }) : Promise.resolve();
  const sources = (async () => {
    try { Object.assign(cur, await fetchFloorProductSales(cur.product, (route, params) => {
      if (stopped()) throw new Error('Lookup cancelled');
      return pcReadRequest(route, params);
    })); } catch (error) { cur.salesError = error.message; }
    cur.salesLoading = false;
    if (stopped()) return;
    progress();
    await runFloorEbaySearch(cur, progress, stopped);
    await runFloorTargetedEbay(cur, progress, stopped);
  })();
  await Promise.all([amazon, sources, stock]);
  if (stopped()) return;
  if (cur.gamestopUrl && cur.gamestopUrl !== stockUrl) {
    cur.gamestopStock = await fetchFloorGameStopStock(cur.product, cur.gamestopUrl);
  }
  // Re-run ranked search after exclusions from item-page checks invalidate a stop.
  // Existing search pagination and targeted verification retain all stop/safety rules.
  const verify = async target => {
    let previous;
    do {
      previous = target.directEbay;
      await runFloorEbaySearch(target, progress, stopped);
      await runFloorTargetedEbay(target, progress, stopped);
    } while (!stopped() && target.directEbay !== previous);
  };
  await verify(cur);
  if (!stopped() && floorNeedsCibFloor(cur)) {
    cur.cibComparison = floorCibCur(cur);
    await verify(cur.cibComparison);
  }
  progress();
}
function renderFloorQueue() {
  const host = document.querySelector('#floorQueue');
  if (!host) return;
  const count = document.querySelector('#floorQueueCount');
  const ready = floorQueue.filter(j => j.state === 'ready').length;
  if (count) count.textContent = `· ${floorQueue.length}${ready ? ` · ${ready} ready` : ''}`;
  const names = { queued: 'Queued', researching: 'Researching', ready: 'Ready', review: 'Needs review' };
  host.innerHTML = `<p class="muted small-print">Open an item to review and add it.</p>
    <div class="queue-items">${floorQueue.map(j => {
      const cur = j.cur, done = cur?.queueDone;
      const price = done ? floorResult(cur).r?.price : null;
      return `<div class="queue-item${cur && floorCur === cur ? ' selected' : ''}"><button type="button" class="link" data-queue-open="${esc(j.id)}">${esc(cur?.product['product-name'] || j.upc)}<span class="sub">${esc(cur ? `${cur.product['console-name']} · ${GAME_CONDITIONS[cur.condition]}` : 'Barcode lookup')}</span></button>
      <span class="queue-state">${esc(names[j.state])}${price != null ? ` · ${money(price)}` : ''}${cur?.sharedCheckedAt ? ' · Checked recently' : ''}${j.error ? `<span class="sub error">${esc(j.error)}</span>` : ''}</span>
      ${j.state !== 'researching' ? `<button type="button" class="link" data-queue-refresh="${esc(j.id)}">${j.state === 'review' ? 'Retry' : 'Refresh'}</button>` : ''}
      <button type="button" class="icon-btn" data-queue-remove="${esc(j.id)}" aria-label="Remove ${esc(cur?.product['product-name'] || j.upc)} from queue">×</button></div>`;
    }).join('') || '<p class="muted">Scan a barcode or choose a search result to start.</p>'}</div>
    <details><summary>Shared recent results (${floorRecentResults.length})</summary><p class="muted">Completed checks from the last 30 minutes. Same edition and condition only. Refresh runs research again; source caches still apply.</p>
    <button type="button" class="link" data-queue-recents>Refresh recent list</button>
    ${floorRecentResults.map((r, i) => `<p><button type="button" class="link" data-queue-recent="${i}">${esc(r.name)} · ${esc(r.platform)} · ${esc(GAME_CONDITIONS[r.condition])}</button> <span class="muted">${Math.max(0, Math.floor((Date.now() - r.checkedAt) / 60000))} min ago</span></p>`).join('')}</details>`;
}
function initFloorQueue() {
  const host = document.querySelector('#floorQueue');
  if (!host || floorQueueEnabled) return;
  floorQueueEnabled = true;
  host.addEventListener('click', async e => {
    const button = e.target.closest('button'); if (!button) return;
    const d = button.dataset;
    if ('queueRecents' in d) { void loadFloorRecent(); return; }
    if ('queueRecent' in d) {
      const r = floorRecentResults[Number(d.queueRecent)]; if (!r) return;
      try { const result = await floorRecentRequest('POST', { action: 'get', scope: floorRecentScope(), key: r.key });
        if (!result?.entry) { toast('That recent check expired. Scan the item to research it again.'); void loadFloorRecent(); return; }
        const cur = result.entry.evidence;
        enqueueFloorScan({ product: cur.product, condition: cur.condition, manualMissing: cur.manualMissing, toyGroup: cur.toyGroup, researchRequested: cur.researchRequested }, true);
      } catch (_) { toast('Recent checks are unavailable. Scan the item to research it normally.', 'error'); }
      return;
    }
    const job = floorQueue.find(j => j.id === (d.queueOpen || d.queueRemove || d.queueRefresh)); if (!job) return;
    if (d.queueOpen) selectFloorQueueItem(job);
    if (d.queueRefresh) {
      if (job.cur) floorQueueRefresh(job); else { job.lookup = null; job.lookupError = null; job.state = 'queued'; job.error = null; void pumpFloorQueue(); }
    }
    if (d.queueRemove) {
      if (job.cur) job.cur.queueCancelled = true;
      floorQueue.splice(floorQueue.indexOf(job), 1);
      if (floorQueueSelectedId === job.id) floorQueueSelectedId = null;
      if (floorCur === job.cur) { floorCur = null; renderFloorPricer(); }
      saveFloorQueue();
    }
    renderFloorQueue();
  });
  const saved = store.get('p2w-scan-queue', []);
  if (Array.isArray(saved)) for (const row of saved.slice(0, 100)) {
    if (!row.product?.id && !/^\d{8,14}$/.test(row.upc || '')) continue;
    floorQueue.push({ id: uid(), upc: row.upc, condition: row.condition || 'cib', state: 'queued',
      cur: row.product ? floorQueueContext(row.product, row.condition || 'cib', { manualMissing: !!row.manualMissing, researchRequested: !!row.researchRequested, toyGroup: row.toyGroup }) : null });
  }
  renderFloorQueue(); void loadFloorRecent(); void pumpFloorQueue();
}
