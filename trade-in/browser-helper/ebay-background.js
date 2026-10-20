'use strict';
const ebayJobs = new Map(), ebayCache = new Map();
let ebayRunning = 0;
function ebayTarget(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || !['www.ebay.com', 'ebay.com'].includes(u.hostname) || u.port || u.username || u.password) return null;
    const id = u.pathname.match(/^\/itm\/(?:[^/]+\/)?(\d{9,15})\/?$/)?.[1];
    // nordt keeps archived item URLs from redirecting to a product/recommendation page.
    return id ? { id, url: `https://www.ebay.com/itm/${id}?nordt=true&rt=nc` } : null;
  } catch (_) { return null; }
}
const ebayUnknown = () => ({ state: 'unknown', source: 'browser-helper', checkedAt: Math.floor(Date.now() / 1000) });
async function finishEbay(job, result) {
  if (job.done) return;
  job.done = true; clearTimeout(job.timer); ebayJobs.delete(job.target.id);
  if (job.running) ebayRunning--;
  const valid = result?.id === job.target.id && ['sold', 'ended', 'offer'].includes(result.state)
    && typeof result.title === 'string' && result.title.length > 0 && result.title.length < 500
    && (result.state !== 'sold' || Number.isSafeInteger(result.price) && result.price > 0 && result.price < 100000000);
  const value = valid ? { state: result.state, id: job.target.id, title: result.title,
    price: result.state === 'sold' ? result.price : null, source: 'browser-helper', checkedAt: Math.floor(Date.now() / 1000) } : ebayUnknown();
  ebayCache.set(job.target.id, value);
  if (ebayCache.size > 500) ebayCache.delete(ebayCache.keys().next().value);
  for (const { respond } of job.waiters) respond(value);
  if (job.tabId != null) try { await chrome.tabs.remove(job.tabId); } catch (_) { /* already closed */ }
  pumpEbay();
}
async function readEbay(job) {
  if (job.reading || job.done || job.tabId == null) return;
  job.reading = true;
  try { await finishEbay(job, await chrome.tabs.sendMessage(job.tabId, { type: 'P2W_EBAY_READ', id: job.target.id })); }
  catch (_) { job.reading = false; }
}
function pumpEbay() {
  for (const job of ebayJobs.values()) {
    if (ebayRunning >= 2) break;
    if (job.running || job.done) continue;
    job.running = true; ebayRunning++;
    job.timer = setTimeout(() => finishEbay(job, null), 12000);
    chrome.tabs.create({ url: job.target.url, active: false }).then(async tab => {
      job.tabId = tab.id;
      if (job.done) { try { await chrome.tabs.remove(tab.id); } catch (_) {} return; }
      await readEbay(job);
    }).catch(() => finishEbay(job, null));
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'P2W_EBAY_CAPABILITY' && pricingSender(sender)) { respond({ available: true, version: '1.1.2', protocol: 2 }); return false; }
  if (message?.type === 'P2W_EBAY_CHECK' && pricingSender(sender)) {
    // Reject stale pricing pages/bridges that still launch automatic all-sales sweeps.
    if (message.protocol !== 2 || message.mode !== 'manual') { respond(ebayUnknown()); return false; }
    const target = ebayTarget(message.url);
    if (!target) { respond(ebayUnknown()); return false; }
    const cached = ebayCache.get(target.id);
    if (cached && Date.now() / 1000 - cached.checkedAt < (cached.state === 'unknown' ? 60 : 86400)) { respond(cached); return false; }
    const existing = ebayJobs.get(target.id);
    if (existing) { existing.waiters.push({ owner: sender.tab.id, respond }); return true; }
    if (ebayJobs.size >= 8) { respond(ebayUnknown()); return false; }
    ebayJobs.set(target.id, { target, waiters: [{ owner: sender.tab.id, respond }], done: false });
    pumpEbay(); return true;
  }
  if (message?.type === 'P2W_EBAY_READY' && sender.frameId === 0) {
    const target = ebayTarget(sender.url), job = target && ebayJobs.get(target.id);
    if (job && job.tabId === sender.tab?.id) readEbay(job);
  }
  return false;
});
chrome.tabs.onRemoved.addListener(tabId => {
  for (const job of ebayJobs.values()) {
    if (job.tabId === tabId) { finishEbay(job, null); continue; }
    job.waiters = job.waiters.filter(w => w.owner !== tabId);
    if (!job.waiters.length) finishEbay(job, null);
  }
});
