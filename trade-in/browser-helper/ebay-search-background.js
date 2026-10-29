'use strict';
const ebaySearchJobs = new Map(), ebaySearchCache = new Map();
function ebaySearchQuery(value) {
  return typeof value === 'string' && value.length >= 3 && value.length <= 180 && !/[\x00-\x1f]/.test(value) ? value.trim().replace(/\s+/g, ' ') : null;
}
function ebaySearchUrl(query, page = 1) {
  return 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(query) + '&LH_Sold=1&LH_Complete=1&_sop=16&_ipg=120&_pgn=' + page;
}
const ebaySearchUnknown = () => ({ state: 'unknown', sales: [], reason: 'Direct eBay search unavailable. Sign in to eBay in Chrome, then retry.' });
async function finishEbaySearch(job, result) {
  if (job.done) return;
  job.done = true; clearTimeout(job.timer); clearTimeout(job.activeTimer); ebaySearchJobs.delete(job.key);
  const valid = result?.state === 'ready' && result.page === job.page && result.sorted === true && Array.isArray(result.sales) && result.sales.length <= 240;
  const sales = valid ? result.sales.filter(s => ebayTarget(s.url)?.id === s.id && typeof s.title === 'string' && s.title.length <= 450
    && Number.isSafeInteger(s.price) && s.price > 0 && s.price < 100000000 && /^\d{4}-\d{2}-\d{2}$/.test(s.date)
    && ['sold', 'offer'].includes(s.state)).map(s => ({ id: s.id, url: ebayTarget(s.url).url, title: s.title, price: s.price,
      date: s.date, conditionText: String(s.conditionText || '').slice(0, 100), state: s.state,
      sellerCountry: typeof s.sellerCountry === 'string' && s.locationSource === 'ebay-located-in' ? s.sellerCountry.slice(0, 80) : null,
      locationSource: s.locationSource === 'ebay-located-in' ? 'ebay-located-in' : null,
      shipping: Number.isSafeInteger(s.shipping) && s.shipping >= 0 ? s.shipping : null, source: 'ebay-search' })) : [];
  const value = valid ? { state: 'ready', sales, partial: !!result.partial || sales.length !== result.sales.length,
    page: job.page, sorted: result.sorted === true, more: !!result.more, skipped: Math.max(0, Number(result.skipped) || 0), reason: String(result.reason || '').slice(0, 250) } : ebaySearchUnknown();
  value.url = ebaySearchUrl(job.query, job.page); value.checkedAt = Math.floor(Date.now() / 1000);
  ebaySearchCache.set(job.key, value);
  if (ebaySearchCache.size > 40) ebaySearchCache.delete(ebaySearchCache.keys().next().value);
  for (const w of job.waiters) w.respond(value);
  if (job.tabId != null) try { await chrome.tabs.remove(job.tabId); } catch (_) {}
  pumpEbaySearch();
}
async function readEbaySearchJob(job) {
  if (job.reading || job.done || job.tabId == null) return;
  job.reading = true;
  try { await finishEbaySearch(job, await chrome.tabs.sendMessage(job.tabId, { type: 'P2W_EBAY_SEARCH_READ', query: job.query, page: job.page })); }
  catch (_) { job.reading = false; }
}
function pumpEbaySearch() {
  if ([...ebaySearchJobs.values()].some(j => j.running)) return;
  const job = [...ebaySearchJobs.values()].find(j => !j.done);
  if (!job) return;
  job.running = true;
  job.activeTimer = setTimeout(() => finishEbaySearch(job, null), 18000);
  chrome.tabs.create({ url: ebaySearchUrl(job.query, job.page), active: false }).then(tab => {
    job.tabId = tab.id;
    if (job.done) { chrome.tabs.remove(tab.id).catch(() => {}); return; }
    readEbaySearchJob(job);
  }).catch(() => finishEbaySearch(job, null));
}
chrome.runtime.onMessage.addListener((m, sender, respond) => {
  if (m?.type === 'P2W_EBAY_SEARCH' && pricingSender(sender)) {
    const query = ebaySearchQuery(m.query), page = m.page ?? 1;
    const key = JSON.stringify([query, page]);
    if (m.protocol !== 2 || !query || !Number.isInteger(page) || page < 1 || page > 50) { respond(ebaySearchUnknown()); return false; }
    const cached = ebaySearchCache.get(key);
    if (m.refresh !== true && cached && Date.now() / 1000 - cached.checkedAt < (cached.state === 'ready' ? 300 : 20)) { respond(cached); return false; }
    const existing = ebaySearchJobs.get(key);
    if (existing) { existing.waiters.push({ owner: sender.tab.id, respond }); return true; }
    if (ebaySearchJobs.size >= 3) { respond(ebaySearchUnknown()); return false; }
    const job = { query, page, key, waiters: [{ owner: sender.tab.id, respond }] };
    // Includes time in queue so callers never abandon a still-running job silently.
    job.timer = setTimeout(() => finishEbaySearch(job, null), 24000);
    ebaySearchJobs.set(key, job); pumpEbaySearch(); return true;
  }
  if (m?.type === 'P2W_EBAY_SEARCH_READY' && sender.frameId === 0) {
    let u;
    try { u = new URL(sender.url); } catch (_) { return false; }
    for (const job of ebaySearchJobs.values()) if (job.tabId === sender.tab?.id && u.protocol === 'https:'
      && ['www.ebay.com', 'ebay.com'].includes(u.hostname) && u.pathname === '/sch/i.html'
      && Number(u.searchParams.get('_pgn') || 1) === job.page && u.searchParams.get('_sop') === '16' && u.searchParams.get('_nkw') === job.query && u.searchParams.get('LH_Sold') === '1' && u.searchParams.get('LH_Complete') === '1') readEbaySearchJob(job);
  }
  return false;
});
chrome.tabs.onRemoved.addListener(id => {
  for (const job of ebaySearchJobs.values()) {
    if (job.tabId === id) { finishEbaySearch(job, null); continue; }
    job.waiters = job.waiters.filter(w => w.owner !== id);
    if (!job.waiters.length) finishEbaySearch(job, null);
  }
});
