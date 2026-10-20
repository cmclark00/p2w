'use strict';
if (typeof importScripts === 'function') importScripts('ebay-background.js');
// No broad tabs, cookies, storage, scripting or browsing-history permissions.
const activeChecks = new Map(), stockCache = new Map();
function stockTarget(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || !['www.gamestop.com', 'gamestop.com'].includes(u.hostname) || u.port || u.username || u.password) return null;
    const m = u.pathname.match(/^\/(?:[a-z0-9-]+\/)*products\/(?:[a-z0-9%-]+\/)?(\d{1,12})\.html$/i);
    return m ? { id: m[1], url: `https://www.gamestop.com${u.pathname}` } : null;
  } catch (_) { return null; }
}
function pricingSender(sender) {
  try { const u = new URL(sender.url); return sender.frameId === 0 && sender.tab?.id != null && u.origin === 'https://play2wingames.com' && u.pathname.startsWith('/trade-in/'); }
  catch (_) { return false; }
}
const unavailable = reason => ({ state: 'unknown', reason, source: 'browser-helper', checkedAt: Math.floor(Date.now() / 1000) });
async function finishCheck(job, result) {
  if (job.done) return;
  job.done = true; clearTimeout(job.timer); activeChecks.delete(job.target.id);
  const value = ['in', 'out'].includes(result?.state) && typeof result.title === 'string' && result.title.length > 0 && result.title.length < 300
    ? { state: result.state, title: result.title, reason: 'Chrome checked GameStop pre-owned Ship to Home controls. Local store stock may differ.', source: 'browser-helper', checkedAt: Math.floor(Date.now() / 1000) }
    : unavailable('Chrome could not confirm GameStop stock. Open the listing to check.');
  stockCache.set(job.target.id, value);
  if (stockCache.size > 100) stockCache.delete(stockCache.keys().next().value);
  for (const respond of job.responders) respond(value);
  // Only close the temporary tab this job created, never a staff-opened tab.
  if (job.tabId != null) try { await chrome.tabs.remove(job.tabId); } catch (_) { /* already closed */ }
}
async function readCheck(job) {
  if (job.reading || job.done || job.tabId == null) return;
  job.reading = true;
  try {
    const result = await chrome.tabs.sendMessage(job.tabId, { type: 'P2W_GS_READ', id: job.target.id });
    await finishCheck(job, result);
  } catch (_) { job.reading = false; /* content script may not be ready */ }
}
async function startCheck(target, ownerTab, respond) {
  const cached = stockCache.get(target.id);
  if (cached && Date.now() / 1000 - cached.checkedAt < (cached.state === 'unknown' ? 30 : 600)) { respond(cached); return; }
  const existing = activeChecks.get(target.id);
  if (existing) { existing.responders.push(respond); return; }
  if (activeChecks.size >= 2) { respond(unavailable('Chrome stock helper is busy. Open the listing or check again shortly.')); return; }
  const job = { target, ownerTab, responders: [respond], done: false };
  activeChecks.set(target.id, job);
  job.timer = setTimeout(() => finishCheck(job, null), 25000);
  try {
    const tab = await chrome.tabs.create({ url: target.url, active: false });
    job.tabId = tab.id;
    if (job.done) { await chrome.tabs.remove(tab.id); return; }
    await readCheck(job);
  } catch (_) { await finishCheck(job, null); }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'P2W_GS_CHECK' && pricingSender(sender)) {
    const target = stockTarget(message.url);
    if (!target) { respond(unavailable('No matching GameStop product link.')); return false; }
    startCheck(target, sender.tab.id, respond);
    return true;
  }
  if (message?.type === 'P2W_GS_READY' && sender.frameId === 0) {
    const target = stockTarget(sender.url), job = target && activeChecks.get(target.id);
    if (job && sender.tab?.id === job.tabId) readCheck(job);
  }
  return false;
});
chrome.tabs.onRemoved.addListener(tabId => {
  for (const job of activeChecks.values()) if (job.tabId === tabId || job.ownerTab === tabId) finishCheck(job, null);
});
