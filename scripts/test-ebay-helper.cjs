'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const root = 'trade-in/browser-helper/';
const manifest = JSON.parse(fs.readFileSync(root + 'manifest.json', 'utf8'));
let readHandler, tick, now = 0, clicks = 0, timerCleared = false;
const reader = vm.createContext({ URL, Date: { now: () => now },
  setInterval(fn) { tick = fn; return 1; }, clearInterval() { timerCleared = true; },
  chrome: { runtime: { id: 'helper', onMessage: { addListener(h) { readHandler = h; } }, sendMessage: async () => {} } } });
vm.runInContext(fs.readFileSync(root + 'ebay-reader.js', 'utf8'), reader);
// Minimal DOM fixture follows original eBay item markup, not the collapsed SOLD card.
const el = (text = '', visible = true, strike = false) => ({ textContent: text,
  getClientRects: () => visible ? [1] : [], matches: () => strike, querySelector: () => null, querySelectorAll: () => [] });
function fixture({ status = 'This listing sold on Mon, Oct 19 at 10:00 AM.', price = 'US $18.00', offer = false, condition = '',
  strike = false, hiddenStrike = false, hiddenSold = false, summary = false, conflict = false, hiddenPrice = false, duplicatePrice = false } = {}) {
  const primary = el(), section = el(), main = el();
  primary.querySelectorAll = s => s === '.x-price-primary__price' ? [el(price, !hiddenPrice), ...(duplicatePrice ? [el(price)] : [])]
    : [el(price, true, strike), el('$99.99', !hiddenStrike && strike, strike)];
  section.querySelector = () => primary;
  section.querySelectorAll = () => offer ? [el('Best offer accepted')] : [];
  main.querySelector = s => s === 'h1.x-item-title__mainTitle' ? el('Skylanders Giants Glow In The Dark Sonic Boom') : s === '.x-item-condition-text' ? el(condition) : section;
  return { readyState: 'complete', defaultView: { getComputedStyle: () => ({ textDecorationLine: '' }) },
    querySelector: selector => selector === '#mainContent' && !summary ? main : null,
    querySelectorAll: s => s === 'button' ? [] : [el(status, !hiddenSold), ...(conflict ? [el('This listing has ended.')] : [])] };
}
function parse(options, url = 'https://www.ebay.com/itm/404870222598') {
  reader.doc = fixture(options); reader.href = url;
  return vm.runInContext('readEbaySale(doc, "404870222598", href)', reader);
}
assert.equal(parse().state, 'sold'); assert.equal(parse().price, 1800);
assert.equal(parse({condition:'Brand New: unopened'}).conditionText,'Brand New');
assert.equal(parse({condition:'New (Other): opened box'}).conditionText,'New (Other)');
assert.equal(parse({condition:'Used: tested'}).conditionText,'Used');
assert.equal(parse({ price: 'US $1,300.00' }).price, 130000);
assert.equal(parse({ status: 'This listing has ended.' }).state, 'ended');
assert.equal(parse({ offer: true }).state, 'offer', 'SOLD badge must not override accepted offer');
assert.equal(parse({ strike: true }).state, 'offer');
assert.equal(parse({ hiddenStrike: true }).state, 'sold', 'Hidden/unrelated old prices do not exclude a sale');
for (const options of [{ summary: true }, { hiddenSold: true }, { conflict: true }, { hiddenPrice: true },
  { duplicatePrice: true }, { price: 'C $18.00' }, { price: 'US $0.00' }, { status: 'This listing is active' }]) assert.equal(parse(options).state, 'unknown');
for (const url of ['https://evil.test/itm/404870222598', 'https://www.ebay.com/itm/999999999999']) assert.equal(parse({}, url).state, 'unknown');
// Real Road Redemption archive layout (167370273675): visible condensed ENDED
// card, hidden full item and no price panel. Ignore recommendations and SOLD summaries.
function archivedCard(status = 'Ended', hidden = false, missingTitle = false) {
  const card = el('', !hidden);
  card.querySelector = selector => selector.includes('__title') ? (missingTitle ? null : el('Road Redemption - Sony PlayStation 4', !hidden)) : el(status, !hidden);
  return { querySelector: selector => selector === '.x-vi-evo-cvip-container--condensed .x-item-condensed-card' ? card : null };
}
reader.doc = archivedCard(); reader.href = 'https://www.ebay.com/itm/167370273675?nordt=true&rt=nc';
const archivedRead = () => vm.runInContext('readEbaySale(doc, "167370273675", href)', reader);
assert.equal(archivedRead().state, 'ended');
assert.equal(archivedRead().title, 'Road Redemption - Sony PlayStation 4');
for (const [status, hidden, missingTitle] of [['Sold', false, false], ['Ended', true, false], ['Ended', false, true], ['123 sold', false, false]]) {
  reader.doc = archivedCard(status, hidden, missingTitle);
  assert.equal(archivedRead().state, 'unknown');
}
reader.doc = archivedCard(); reader.href = 'https://www.ebay.com/p/8617';
assert.equal(archivedRead().state, 'unknown', 'A catalog redirect cannot identify an original ended sale');
reader.doc = fixture({ status: 'This listing has ended.' });
const endedMain = reader.doc.querySelector('#mainContent');
endedMain.querySelector = selector => selector === 'h1.x-item-title__mainTitle' ? el('Road Redemption - Sony PlayStation 4') : null;
reader.href = 'https://www.ebay.com/itm/167370273675';
assert.equal(archivedRead().state, 'ended', 'Full ended page does not need a price');
reader.location = { pathname: '/itm/404870222598', href: 'https://www.ebay.com/itm/404870222598' };
reader.document = fixture({ summary: true });
reader.document.querySelectorAll = s => s === 'button' ? [{ ...el('See original listingSee original listing'), click() { clicks++; reader.document = fixture({ offer: true }); } }] : [];
let readResult;
assert.equal(readHandler({ type: 'P2W_EBAY_READ', id: '404870222598' }, { id: 'other' }, () => {}), false);
assert.equal(readHandler({ type: 'P2W_EBAY_READ', id: '404870222598' }, { id: 'helper' }, v => readResult = v), true);
for (now = 500; now <= 4000; now += 500) tick();
assert.equal(clicks, 1); assert.equal(readResult.state, 'offer'); assert.equal(timerCleared, true);
readResult = null; timerCleared = false; now = 0; reader.document = fixture({ summary: true });
readHandler({ type: 'P2W_EBAY_READ', id: '404870222598' }, { id: 'helper' }, v => readResult = v);
for (now = 500; now <= 18500; now += 500) tick();
assert.equal(readResult.state, 'unknown'); assert.equal(timerCleared, true);

const sender = { url: 'https://play2wingames.com/trade-in/', frameId: 0, tab: { id: 1 } };
let handler, removedHandler, nextId = 10, created = [], removed = [], pending = [], watchdogs = new Set();
const background = vm.createContext({ URL, Date, Map,
  setTimeout(fn) { watchdogs.add(fn); return fn; }, clearTimeout(fn) { watchdogs.delete(fn); },
  pricingSender: s => s.url === sender.url && s.frameId === 0 && Number.isInteger(s.tab?.id),
  chrome: { runtime: { getManifest: () => manifest, onMessage: { addListener(h) { handler = h; } } }, tabs: {
    create: async args => { created.push(args); return { id: nextId++ }; },
    remove: async id => { removed.push(id); },
    sendMessage: (id, message) => new Promise(resolve => pending.push({ id, message, resolve })),
    onRemoved: { addListener(h) { removedHandler = h; } },
  } } });
vm.runInContext(fs.readFileSync(root + 'ebay-background.js', 'utf8'), background);
const flush = () => new Promise(r => setImmediate(r));
const url = id => `https://www.ebay.com/itm/${id}`;
const send = (message, from = sender) => new Promise(resolve => { if (!handler(message, from, resolve)) resolve(null); });
const check = id => send({ type: 'P2W_EBAY_CHECK', url: url(id), protocol: 2, mode: 'manual' });
const result = (job, extra = {}) => ({ id: job.message.id, title: 'Example Game PS4', state: 'sold', price: 1800, ...extra });
(async () => {
  assert.equal((await send({ type: 'P2W_EBAY_CAPABILITY' })).version, manifest.version);
  assert.equal((await send({ type: 'P2W_EBAY_CAPABILITY' })).protocol, 2);
  assert.equal(await send({ type: 'P2W_EBAY_CHECK', url: url('404870222598') }, { ...sender, url: 'https://evil.test/' }), null);
  assert.equal(await send({ type: 'P2W_EBAY_CHECK', url: url('404870222598') }, { ...sender, frameId: 1 }), null);
  for (const bad of ['https://evil.test/itm/404870222598', 'http://ebay.com/itm/404870222598', 'https://user@ebay.com/itm/404870222598',
    'https://ebay.com:123/itm/404870222598', 'https://ebay.com/sch/test', 'https://ebay.com/itm/123']) assert.equal((await send({ type: 'P2W_EBAY_CHECK', url: bad, protocol: 2, mode: 'manual' })).state, 'unknown');
  for (const stale of [{}, { protocol: 1, mode: 'manual' }, { protocol: 2, mode: 'automatic' }])
    assert.equal((await send({ type: 'P2W_EBAY_CHECK', url: url('334736933439'), ...stale })).state, 'unknown');
  assert.equal(created.length, 0);
  const one = check('404870222598'), duplicate = check('404870222598'), two = check('404870222599'), three = check('404870222600');
  await flush(); assert.equal(created.length, 2); assert.ok(created.every(c => c.active === false));
  assert.equal(created[0].url, 'https://www.ebay.com/itm/404870222598?nordt=true&rt=nc', 'Original-item redirect controls survive URL cleanup');
  pending[0].resolve(result(pending[0], { state: 'offer' }));
  assert.equal((await one).state, 'offer'); assert.equal((await duplicate).price, null);
  await flush(); assert.equal(created.length, 3); assert.deepEqual(removed, [10]);
  pending[1].resolve(result(pending[1], { id: '999999999999' })); assert.equal((await two).state, 'unknown');
  pending[2].resolve(result(pending[2])); assert.equal((await three).price, 1800); await flush();
  assert.equal((await check('404870222598')).state, 'offer'); assert.equal(created.length, 3, 'Cache prevents re-opening checked listings');
  const timed = check('404870222601'); await flush(); for (const timer of [...watchdogs]) timer();
  assert.equal((await timed).state, 'unknown'); await flush(); assert.equal(watchdogs.size, 0);
  const closed = check('404870222602'); await flush(); removedHandler(14);
  assert.equal((await closed).state, 'unknown'); await flush();
  const abandoned = check('404870222603'); await flush(); removedHandler(1); await flush();
  assert.ok(removed.includes(15), 'Closing requesting page cancels its temporary tabs');
  void abandoned;
  const listeners = new Set();
  const pageWindow = { addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn),
    postMessage: data => queueMicrotask(() => { for (const fn of [...listeners]) fn({ source: pageWindow, origin: 'https://play2wingames.com', data }); }) };
  const bridge = vm.createContext({ window: pageWindow, location: { origin: 'https://play2wingames.com' }, crypto: require('node:crypto').webcrypto,
    setTimeout, clearTimeout, chrome: { runtime: { sendMessage: message => send(message) } } });
  vm.runInContext(fs.readFileSync(root + 'bridge.js', 'utf8'), bridge);
  vm.runInContext(fs.readFileSync('trade-in/stock-helper-client.js', 'utf8'), bridge);
  const tabsBeforeStatus = created.length;
  assert.equal((await pageWindow.P2WEbayHelper.status()).version, manifest.version);
  assert.equal(created.length, tabsBeforeStatus, 'Version status ping never opens listing tabs');
  assert.equal(await pageWindow.P2WEbayHelper.available(), true);
  assert.equal(await pageWindow.P2WEbayHelper.targetedAvailable(), true);
  assert.equal((await pageWindow.P2WEbayHelper.checkTargeted(url('404870222598'))).state, 'offer');
  assert.equal((await pageWindow.P2WEbayHelper.check(url('404870222598'))).state, 'offer');
  assert.equal(listeners.size, 2, 'Request listeners cleaned up');
  let oldRequests = 0;
  bridge.chrome.runtime.sendMessage = async message => {
    if (message.type === 'P2W_EBAY_CAPABILITY') return { available: true, version: '1.1.0' };
    oldRequests++; return { state: 'unknown' };
  };
  assert.equal(await pageWindow.P2WEbayHelper.available(), false, 'Old helpers fail the capability handshake');
  assert.equal((await pageWindow.P2WEbayHelper.status()).version, '1.1.0', 'Older helper versions remain visible for update guidance');
  assert.equal((await pageWindow.P2WEbayHelper.check(url('334736933439'))).reason, 'helper-update-required');
  assert.equal((await pageWindow.P2WEbayHelper.checkTargeted(url('334736933439'))).reason, 'helper-update-required');
  assert.equal(oldRequests, 0, 'No tab-creating request is sent to an old helper, even through direct check()');
  assert.equal(listeners.size, 2);
  listeners.clear(); assert.equal(await pageWindow.P2WEbayHelper.available(), false); assert.equal(listeners.size, 0);
  console.log('eBay original-listing parsing, expansion, timeout, URL/sender validation, two-tab queue, cache, cleanup and bridge checks passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
