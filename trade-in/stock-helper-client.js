'use strict';
// Optional Chrome bridge. Without it, the ordinary server check remains available.
window.P2WGameStopHelper = {
  check(url) {
    return new Promise(resolve => {
      const nonce = crypto.randomUUID();
      let acknowledged = false;
      const finish = value => { clearTimeout(probe); clearTimeout(deadline); window.removeEventListener('message', receive); resolve(value); };
      const receive = event => {
        if (event.source !== window || event.origin !== location.origin || event.data?.nonce !== nonce) return;
        if (event.data.type === 'P2W_GS_ACK') acknowledged = true;
        if (event.data.type === 'P2W_GS_RESULT' && acknowledged) finish(event.data.result || { state: 'unknown' });
      };
      const probe = setTimeout(() => { if (!acknowledged) finish(null); }, 800);
      const deadline = setTimeout(() => finish({ state: 'unknown', reason: 'Chrome stock check timed out. Open the listing to check.' }), 28000);
      window.addEventListener('message', receive);
      window.postMessage({ type: 'P2W_GS_REQUEST', nonce, url }, location.origin);
    });
  },
};

function ebayHelperRequest(type, url) {
  return new Promise(resolve => {
    const nonce = crypto.randomUUID();
    let acknowledged = false;
    const finish = value => { clearTimeout(probe); clearTimeout(deadline); window.removeEventListener('message', receive); resolve(value); };
    const receive = event => {
      if (event.source !== window || event.origin !== location.origin || event.data?.nonce !== nonce) return;
      if (event.data.type === 'P2W_EBAY_ACK') acknowledged = true;
      if (event.data.type === 'P2W_EBAY_RESULT' && acknowledged) finish(event.data.result || { state: 'unknown' });
    };
    const probe = setTimeout(() => { if (!acknowledged) finish(null); }, 800);
    const deadline = setTimeout(() => finish({ state: 'unknown' }), type === 'P2W_EBAY_PING' ? 2500 : 28000);
    window.addEventListener('message', receive);
    window.postMessage({ type, nonce, url, protocol: 2, mode: 'manual' }, location.origin);
  });
}
window.P2WEbayHelper = {
  available: async () => { const helper = await ebayHelperRequest('P2W_EBAY_PING'); return !!helper?.available && helper.protocol === 2; },
  async check(url) {
    // An old installed worker must never receive a request that can create a tab.
    if (!await window.P2WEbayHelper.available()) return { state: 'unknown', reason: 'helper-update-required' };
    return ebayHelperRequest('P2W_EBAY_REQUEST', url);
  },
};
