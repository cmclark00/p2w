'use strict';
function readGameStopStock(doc, id) {
  const unknown = { state: 'unknown' }, states = [];
  let title = '';
  const visible = e => e.getClientRects().length > 0;
  const disabled = e => e.disabled || e.getAttribute('aria-disabled') === 'true' || e.classList.contains('disabled');
  for (const b of doc.querySelectorAll('button.js-add-to-cart')) {
    if (!visible(b) || b.dataset.pid !== id) continue;
    let info;
    try { info = JSON.parse(b.dataset.gtmdata).productInfo; } catch (_) { continue; }
    if (String(info?.sku) !== id || String(info?.condition).trim().toLowerCase() !== 'pre-owned') continue;
    const availability = String(info.availability).trim().toLowerCase(), label = b.textContent.trim().toLowerCase();
    let state = 'unknown';
    if (disabled(b) && ['not available', 'out of stock'].includes(availability) && ['not available', 'out of stock'].includes(label)) state = 'out';
    if (!disabled(b) && ['in stock', 'available'].includes(availability) && label === 'add to cart') state = 'in';
    states.push(state); title = String(info.name || '').trim();
  }
  if (!states.length || new Set(states).size !== 1 || states[0] === 'unknown' || !title) return unknown;
  const shipping = [...doc.querySelectorAll('button[data-optionvalue="ship"]')].filter(visible);
  if (!shipping.length) return unknown;
  for (const b of shipping) {
    const label = b.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
    if (states[0] === 'out' && (!disabled(b) || !/not available|out of stock/.test(label))) return unknown;
    if (states[0] === 'in' && (disabled(b) || /not available|unavailable|verify address|pre.?order|back.?order/.test(label))) return unknown;
  }
  return { state: states[0], title };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'P2W_GS_READ'
      || !/^\d{1,12}$/.test(message.id) || !location.pathname.endsWith(`/${message.id}.html`)) return false;
  let previous = '', stableSince = 0;
  const started = Date.now();
  const timer = setInterval(() => {
    const value = readGameStopStock(document, message.id), key = JSON.stringify(value);
    if (key !== previous) { previous = key; stableSince = Date.now(); }
    // Avoid classifying the initial placeholder while the page is hydrating.
    if (document.readyState === 'complete' && value.state !== 'unknown' && Date.now() - started >= 5000 && Date.now() - stableSince >= 2000) {
      clearInterval(timer); respond(value);
    } else if (Date.now() - started > 18000) { clearInterval(timer); respond({ state: 'unknown' }); }
  }, 500);
  return true;
});
chrome.runtime.sendMessage({ type: 'P2W_GS_READY' }).catch(() => {});
