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
