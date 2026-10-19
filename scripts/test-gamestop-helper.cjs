'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const root = 'trade-in/browser-helper/';
const manifest = JSON.parse(fs.readFileSync(root + 'manifest.json', 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.permissions, undefined);
assert.equal(manifest.host_permissions, undefined);
assert.deepEqual(manifest.content_scripts.flatMap(s => s.matches), ['https://play2wingames.com/trade-in/*', 'https://www.gamestop.com/*products/*', 'https://gamestop.com/*products/*']);
const reader = vm.createContext({ chrome: { runtime: { onMessage: { addListener() {} }, sendMessage: async () => {} } } });
vm.runInContext(fs.readFileSync(root + 'stock-reader.js', 'utf8'), reader);
function button({ state = 'in', condition = 'Pre-Owned', sku = '930799', visible = true, disabled = state === 'out', label = state === 'out' ? 'Not Available' : 'Add to Cart', availability = state === 'out' ? 'Not Available' : 'In Stock' } = {}) {
  return { dataset: { pid: '930799', gtmdata: JSON.stringify({ productInfo: { sku, name: 'Lollipop Chainsaw - PlayStation 3', condition, availability } }) }, disabled, textContent: label,
    getAttribute: () => null, classList: { contains: () => false }, getClientRects: () => visible ? [1] : [] };
}
function parse(cart, shipDisabled = false, shipLabel = shipDisabled ? 'Ship to Home Not Available' : 'Ship to Home In Stock') {
  reader.doc = { querySelectorAll: selector => selector.includes('js-add-to-cart') ? cart : [{ ...button({ disabled: shipDisabled, label: shipLabel }) }] };
  return vm.runInContext('readGameStopStock(doc, "930799")', reader);
}
assert.equal(parse([button()]).state, 'in');
assert.equal(parse([button({ state: 'out' })], true).state, 'out');
for (const b of [button({ condition: 'New' }), button({ sku: '999' }), button({ visible: false }), button({ disabled: true }), button({ label: 'Pre-order' }), button({ availability: 'Backorder' })]) assert.equal(parse([b]).state, 'unknown');
assert.equal(parse([button()], true).state, 'unknown');
assert.equal(parse([button()], false, 'Verify Address').state, 'unknown');
assert.equal(parse([button(), button({ state: 'out' })], true).state, 'unknown');
assert.equal(parse([button({ state: 'out' }), button({ visible: false })], true).state, 'out');
let handler, removedHandler, nextId = 10, created = [], removed = [], requested = [];
const background = vm.createContext({ URL, Date, Map, setTimeout, clearTimeout,
  chrome: { runtime: { onMessage: { addListener(h) { handler = h; } } }, tabs: {
    create: async args => { created.push(args); return { id: nextId++ }; },
    remove: async id => { removed.push(id); },
    sendMessage: async (id, message) => { requested.push([id, message]); return { state: 'out', title: 'Lollipop Chainsaw - PlayStation 3' }; },
    onRemoved: { addListener(h) { removedHandler = h; } },
  } } });
vm.runInContext(fs.readFileSync(root + 'background.js', 'utf8'), background);
const sender = { url: 'https://play2wingames.com/trade-in/', tab: { id: 1 }, frameId: 0 };
const url = 'https://www.gamestop.com/products/lollipop-chainsaw---playstation-3/930799.html';
const send = (message, from = sender) => new Promise(resolve => { const async = handler(message, from, resolve); if (!async) resolve(null); });
(async () => {
  assert.equal(await send({ type: 'P2W_GS_CHECK', url }, { ...sender, url: 'https://evil.test/trade-in/' }), null);
  assert.equal(await send({ type: 'P2W_GS_CHECK', url }, { ...sender, frameId: 1 }), null);
  for (const bad of ['https://evil.test/products/game/1.html', 'https://www.gamestop.com/search/?q=test', 'http://gamestop.com/products/game/1.html', 'https://user@gamestop.com/products/game/1.html', 'https://gamestop.com:123/products/game/1.html']) {
    assert.equal((await send({ type: 'P2W_GS_CHECK', url: bad })).state, 'unknown');
  }
  assert.equal(created.length, 0, 'Invalid callers and URLs never open tabs');
  const value = await send({ type: 'P2W_GS_CHECK', url });
  assert.equal(value.state, 'out'); assert.equal(value.source, 'browser-helper');
  assert.equal(created.length, 1); assert.equal(created[0].active, false);
  assert.deepEqual(removed, [10], 'Only helper-created tab closes');
  assert.equal(requested[0][1].type, 'P2W_GS_READ');
  assert.equal((await send({ type: 'P2W_GS_CHECK', url })).state, 'out');
  assert.equal(created.length, 1, 'Fresh results reuse the cache');
  removedHandler(999); assert.deepEqual(removed, [10]);
  // Exercise both halves of the website/isolated-content-script handshake.
  const listeners = new Set();
  const pageWindow = {
    addEventListener: (type, listener) => listeners.add(listener),
    removeEventListener: (type, listener) => listeners.delete(listener),
    postMessage: data => queueMicrotask(() => { for (const listener of [...listeners]) listener({ source: pageWindow, origin: 'https://play2wingames.com', data }); }),
  };
  const bridge = vm.createContext({ window: pageWindow, location: { origin: 'https://play2wingames.com' }, crypto: require('node:crypto').webcrypto,
    setTimeout, clearTimeout, chrome: { runtime: { sendMessage: message => send(message) } } });
  vm.runInContext(fs.readFileSync(root + 'bridge.js', 'utf8'), bridge);
  vm.runInContext(fs.readFileSync('trade-in/stock-helper-client.js', 'utf8'), bridge);
  assert.equal((await pageWindow.P2WGameStopHelper.check(url)).state, 'out', 'Bridge returns browser result to the page');
  assert.equal(listeners.size, 1, 'Per-request listeners are cleaned up');
  listeners.clear();
  assert.equal(await pageWindow.P2WGameStopHelper.check(url), null, 'Missing extension falls back without hanging');
  assert.equal(listeners.size, 0);
  console.log('Chrome helper URL/sender boundaries, DOM stock evidence, caching and tab lifecycle checks passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
