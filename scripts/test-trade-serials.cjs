'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const elements = new Map();
const element = (selector) => {
  if (!elements.has(selector)) elements.set(selector, { value: '', innerHTML: '', textContent: '', hidden: false, checked: false,
    elements: { payout: { value: 'credit' } }, addEventListener() {}, focus() {}, showModal() {}, close() {} });
  return elements.get(selector);
};
const ctx = vm.createContext({ console, Date, setTimeout, clearTimeout,
  localStorage: { getItem: () => null, setItem() {} },
  document: { querySelector: element, querySelectorAll: () => [], addEventListener() {} } });
vm.runInContext(fs.readFileSync('trade-in/app.js', 'utf8').replace(/\binit\(\);\s*$/, ''), ctx);
const run = (js) => vm.runInContext(js, ctx);
const invoke = (name, ...args) => { ctx.args = args; return run(`${name}(...args)`); };
const hardware = (name, extra = {}) => ({ id: 'test', name, category: 'console', condition: 'unit', qty: 1, ...extra });
let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log('PASS ' + name); }
(async () => {
  await test('listed console families require serials, including model and platform aliases', () => {
    for (const name of ['Switch', 'Nintendo Switch OLED', 'Switch Lite', 'Switch 2', 'Nintendo Switch V2',
      'Xbox Series S', 'Xbox Series X', 'PS4', 'PS4 Slim', 'PS4 Pro', 'PlayStation 4 Slim',
      'PS5', 'PS5 Slim Digital', 'PS5 Pro', 'PlayStation 5 Disc']) {
      assert.equal(invoke('tradeSerialRequired', hardware(name)), true, name);
    }
    assert.equal(invoke('tradeSerialRequired', hardware('CFI-2000 Console', { platform: 'Playstation 5' })), true);
  });
  await test('3DS family and PC handhelds require serials', () => {
    for (const name of ['Nintendo 3DS', '3DS XL', 'New Nintendo 3DS XL', 'Nintendo 2DS', 'New Nintendo 2DS XL',
      'Steam Deck OLED', 'ASUS ROG Ally X', 'ROG Xbox Ally X', 'Lenovo Legion Go S', 'MSI Claw 8 AI+',
      'Logitech G Cloud', 'AYANEO Air', 'ONEXPLAYER 2', 'OneXFly', 'GPD Win Mini', 'AYN Loki', 'Zotac Zone', 'Acer Nitro Blaze', 'Handheld Gaming PC']) {
      assert.equal(invoke('tradeSerialRequired', hardware(name, { category: 'handheld' })), true, name);
    }
    assert.equal(invoke('tradeSerialRequired', hardware('Custom handheld', { category: 'handheld', platform: 'PC' })), true);
    for (const name of ['Steam Deck OLED', 'ROG Ally', 'Logitech G Cloud', 'GPD Win 4']) assert.equal(invoke('guessCategory', name), 'handheld');
    assert.equal(invoke('guessCategory', 'Steam Deck Dock'), 'accessory');
    assert.equal(invoke('guessCategory', 'Steam Deck Carrying Case'), 'accessory');
    assert.equal(invoke('guessCategory', 'ROG Ally Screen Protector'), 'accessory');
    assert.equal(invoke('guessCategory', 'Steam Deck with carrying case'), 'handheld');
  });
  await test('older used consoles and handhelds no longer require serials', () => {
    for (const name of ['PS1', 'PS2 Slim', 'PS3', 'Xbox Original', 'Xbox 360 Slim', 'Xbox One S', 'Xbox One X',
      'NES', 'SNES', 'Nintendo 64', 'GameCube', 'Wii', 'Wii U', 'Sega Genesis', 'Dreamcast', 'Atari 2600',
      'Game Boy Advance SP', 'Nintendo DS Lite', 'Nintendo DSi XL', 'PSP', 'PS Vita', 'PS Portal']) {
      assert.equal(invoke('tradeSerialRequired', hardware(name)), false, name);
    }
  });
  await test('all sealed hardware requires serials without confusing model names, games or accessories', () => {
    for (const category of ['console', 'handheld']) {
      assert.equal(invoke('tradeSerialRequired', hardware('Sega Game Gear', { category, condition: 'new' })), true);
      assert.equal(invoke('tradeSerialRequired', hardware('Factory Sealed NES', { category })), true);
    }
    for (const name of ['NES unsealed', 'NES not sealed', 'NES not factory sealed', 'New Nintendo DS model']) {
      assert.equal(invoke('tradeSerialRequired', hardware(name)), false, name);
    }
    for (const category of ['game', 'pokemon', 'accessory', 'other']) {
      assert.equal(invoke('tradeSerialRequired', hardware('Nintendo Switch', { category, condition: 'new' })), false);
    }
  });
  await test('mixed trade renders only required serial fields', () => {
    const html = invoke('tradeSerialFields', [hardware('PS5'), hardware('NES', { id: 'old', serial: 'OLD-123' })]);
    assert.match(html, /PS5 \(required\)/); assert.match(html, /spellcheck/);
    assert.doesNotMatch(html, /Optional|NES|OLD-123/);
    assert.equal((html.match(/ required/g) || []).length, 1);
    assert.equal(invoke('tradeSerialFields', [hardware('PS5 Controller', { category: 'accessory' })]), '');
  });
  await test('only required hardware needs one serial per unit and failed lines do not block', () => {
    assert.equal(invoke('tradeSerialIssue', [hardware('NES')]), null);
    assert.match(invoke('tradeSerialIssue', [hardware('PS5')]), /serial number/);
    assert.match(invoke('tradeSerialIssue', [hardware('PS5', { qty: 2, serial: 'A' })]), /2 serial numbers/);
    assert.equal(invoke('tradeSerialIssue', [hardware('PS5', { qty: 2, serial: ' A, B ' })]), null);
    assert.equal(invoke('tradeSerialIssue', [hardware('PS5', { failed: true })]), null);
  });
  run(`var sentRecords=[], printed=0;
    tradeTotals=()=>({cash:1000,credit:1200,count:1,missing:0}); updateDialogSplit=()=>{};
    saveTrade=()=>{}; priceLine=()=>({cash:1000,credit:1200}); lineDeductions=()=>[];
    api=async(route,{body})=>{sentRecords.push(body);return {id:1,time:'2026-10-19'};};
    resetTrade=()=>{}; toast=()=>{}; printSheet=()=>{printed++;};`);
  const openTrade = (lines) => {
    ctx.testLines = lines; run('trade.lines=testLines; sentRecords=[]; printed=0;'); invoke('openComplete');
    element('#staffName').value = 'Test staff'; element('#completeCustomer').value = 'Test customer';
  };
  await test('completion totals selected-condition market values and quantities, independent of offers', () => {
    const prices = { 'loose-price': 1495, 'cib-price': 2501, 'new-price': 4000, 'retail-cib-buy': 500, 'box-only-price': 305 };
    const game = (condition, qty = 1) => ({ source: 'pc', category: 'game', condition, qty, prices });
    openTrade([game('loose', 2), game('cib'), game('new'), game('case')]);
    assert.equal(element('#completePcValue').textContent, '$97.96');
    assert.doesNotMatch(element('#completePcNote').textContent, /Partial/);
    assert.equal(element('#payCash').textContent, '$10.00');
    openTrade([game('cib'), { ...game('cib'), source: 'hw' }, { ...game('cib', 2), prices: {} },
      { ...game('loose'), failed: true },
      { ...game('loose'), source: 'custom', override: 9000 }, game('parts')]);
    assert.equal(element('#completePcValue').textContent, '$50.02');
    assert.match(element('#completePcNote').textContent, /Partial total · 4 items/);
    openTrade([{ ...game('loose'), prices: { 'loose-price': 0 } }]);
    assert.equal(element('#completePcValue').textContent, 'Unavailable');
    run('var originalPriceLine=priceLine; priceLine=(l)=>({dontBuy:l.notBuying});');
    try {
      const total = invoke('tradePriceChartingTotal', [{ ...game('cib'), notBuying: true },
        { ...game('new'), pending: true }, { ...game('new'), failed: true }, game('loose')]);
      assert.equal(total.total, 1495); assert.equal(total.count, 1); assert.equal(total.missing, 0);
    } finally { run('priceLine=originalPriceLine;'); }
  });
  await test('older used hardware and games save and print without ID or serial fields', async () => {
    for (const line of [hardware('Sega Genesis'), hardware('NES', { serial: 'OLD-123' }),
      hardware('Game Boy', { category: 'handheld' }), hardware('Sonic', { category: 'game' })]) {
      openTrade([line]);
      assert.equal(element('#idCheckRow').hidden, true);
      assert.equal(element('#serialFields').innerHTML, '');
      assert.equal(element('#idChecked').checked, false);
      // A stale visible ID row must not impose a requirement on exempt items.
      element('#idCheckRow').hidden = false;
      for (const print of [false, true]) {
        await invoke('saveCompleted', print); assert.equal(element('#completeError').textContent, '');
      }
      assert.equal(run('sentRecords.length'), 2); assert.equal(run('printed'), 1);
      assert.equal(run('sentRecords[0].idChecked'), undefined);
      assert.equal(run('sentRecords[0].items[0].serial'), line.serial);
      assert.equal(line.category, run('trade.lines[0].category'));
    }
  });
  await test('listed models and sealed Genesis require serials and ID for both completion actions', async () => {
    for (const line of [hardware('PS5'), hardware('Sega Genesis', { condition: 'new' })]) {
      openTrade([line]);
      assert.equal(element('#idCheckRow').hidden, false);
      assert.match(element('#serialFields').innerHTML, /data-serial/);
      for (const print of [false, true]) {
        await invoke('saveCompleted', print); assert.match(element('#completeError').textContent, /serial number/);
        assert.equal(run('sentRecords.length'), 0);
      }
      line.serial = 'TEST-123';
      // Hidden/stale UI cannot bypass the ID requirement.
      element('#idCheckRow').hidden = true;
      for (const print of [false, true]) {
        await invoke('saveCompleted', print); assert.match(element('#completeError').textContent, /photo ID/);
        assert.equal(run('sentRecords.length'), 0);
      }
      element('#idChecked').checked = true;
      for (const print of [false, true]) await invoke('saveCompleted', print);
      assert.equal(run('sentRecords.length'), 2); assert.equal(run('printed'), 1);
      assert.equal(run('sentRecords[0].items[0].serial'), 'TEST-123');
      assert.equal(run('sentRecords[0].idChecked'), true);
    }
  });
  await test('mixed trades only collect serials for listed hardware and still require ID', async () => {
    openTrade([hardware('Genesis', { id: 'old' }), hardware('Switch 2', { id: 'modern', serial: 'SW-123' })]);
    assert.equal(element('#idCheckRow').hidden, false);
    assert.doesNotMatch(element('#serialFields').innerHTML, /Genesis|data-serial="old"/);
    assert.match(element('#serialFields').innerHTML, /Switch 2/);
    await invoke('saveCompleted', false); assert.match(element('#completeError').textContent, /photo ID/);
    element('#idChecked').checked = true; await invoke('saveCompleted', false);
    assert.equal(run('sentRecords.length'), 1); assert.equal(run('sentRecords[0].items.length'), 2);
  });
  await test('failed modern hardware does not trigger ID for an older-console trade', async () => {
    openTrade([hardware('Genesis'), hardware('PS5', { failed: true })]);
    assert.equal(element('#idCheckRow').hidden, true); assert.equal(element('#serialFields').innerHTML, '');
    await invoke('saveCompleted', false); assert.equal(run('sentRecords.length'), 1);
  });
  await test('default and saved legacy footers have no blanket ID notice; custom footer preserved', () => {
    const legacy = 'Offer valid today only and subject to inspection. A valid photo ID is required for any console or handheld with a serial number.';
    for (const saved of [null, { quoteFooter: legacy }]) {
      assert.equal(invoke('mergeSettings', saved).quoteFooter, 'Offer valid today only and subject to inspection.');
    }
    assert.equal(invoke('mergeSettings', { quoteFooter: 'Custom footer' }).quoteFooter, 'Custom footer');
  });
  console.log(`${checks} trade serial checks passed.`);
})().catch((err) => { console.error(err); process.exitCode = 1; });
