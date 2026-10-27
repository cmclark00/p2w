'use strict';
// The isolated content script passes only a product URL and a small stock result.
window.addEventListener('message', event => {
  const m = event.data;
  if (event.source !== window || event.origin !== 'https://play2wingames.com' || m?.type !== 'P2W_GS_REQUEST'
      || typeof m.nonce !== 'string' || !/^[a-z0-9-]{20,60}$/i.test(m.nonce) || typeof m.url !== 'string' || m.url.length > 1000) return;
  window.postMessage({ type: 'P2W_GS_ACK', nonce: m.nonce }, event.origin);
  chrome.runtime.sendMessage({ type: 'P2W_GS_CHECK', url: m.url }).then(result => {
    window.postMessage({ type: 'P2W_GS_RESULT', nonce: m.nonce, result }, event.origin);
  }).catch(() => window.postMessage({ type: 'P2W_GS_RESULT', nonce: m.nonce,
    result: { state: 'unknown', reason: 'Reload the pricing tool after enabling the Chrome helper.' } }, event.origin));
});

// Only eBay item checks and a capability ping; no arbitrary requests or page data.
window.addEventListener('message', event => {
  const m = event.data;
  if (event.source !== window || event.origin !== 'https://play2wingames.com'
      || !['P2W_EBAY_REQUEST', 'P2W_EBAY_PING', 'P2W_EBAY_SEARCH_REQUEST'].includes(m?.type)
      || typeof m.nonce !== 'string' || !/^[a-z0-9-]{20,60}$/i.test(m.nonce)) return;
  if (m.type === 'P2W_EBAY_REQUEST' && (typeof m.url !== 'string' || m.url.length > 1000)) return;
  if (m.type === 'P2W_EBAY_SEARCH_REQUEST' && (typeof m.query !== 'string' || m.query.length > 180 || !Number.isInteger(m.page ?? 1) || (m.page ?? 1) < 1 || (m.page ?? 1) > 50)) return;
  window.postMessage({ type: 'P2W_EBAY_ACK', nonce: m.nonce }, event.origin);
  chrome.runtime.sendMessage({ type: m.type === 'P2W_EBAY_PING' ? 'P2W_EBAY_CAPABILITY' : m.type === 'P2W_EBAY_SEARCH_REQUEST' ? 'P2W_EBAY_SEARCH' : 'P2W_EBAY_CHECK', url: m.url, query: m.query, page: m.page ?? 1, protocol: m.protocol, mode: m.mode }).then(result => {
    window.postMessage({ type: 'P2W_EBAY_RESULT', nonce: m.nonce, result }, event.origin);
  }).catch(() => window.postMessage({ type: 'P2W_EBAY_RESULT', nonce: m.nonce, result: { state: 'unknown' } }, event.origin));
});
