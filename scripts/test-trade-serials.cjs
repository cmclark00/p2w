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
  await test('mixed trade renders required serials prominently and preserves optional serials', () => {
    const html = invoke('tradeSerialFields', [hardware('PS5'), hardware('NES', { id: 'old', serial: 'OLD-123' })]);
    assert.match(html, /PS5 \(required\)/); assert.match(html, /spellcheck/);
    assert.match(html, /Optional serial numbers \(1\)/); assert.match(html, /NES \(optional\)/); assert.match(html, /OLD-123/);
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
  await test('completion keeps the existing photo-ID check for optional-serial hardware', async () => {
    ctx.line = hardware('NES'); run('trade.lines=[line];'); invoke('openComplete');
    assert.equal(element('#idCheckRow').hidden, false);
    element('#staffName').value = 'Test staff'; element('#completeCustomer').value = 'Test customer';
    await invoke('saveCompleted', false); assert.match(element('#completeError').textContent, /photo ID/);
    assert.equal(run('sentRecords.length'), 0);
    element('#idChecked').checked = true; await invoke('saveCompleted', false);
    assert.equal(run('sentRecords.length'), 1); assert.equal(run('sentRecords[0].items[0].serial'), undefined);
  });
  await test('Save and Save-and-print block missing required serials and preserve valid serials', async () => {
    ctx.line = hardware('PS5'); run('trade.lines=[line];');
    for (const print of [false, true]) {
      await invoke('saveCompleted', print); assert.match(element('#completeError').textContent, /serial number/);
      assert.equal(run('sentRecords.length'), 1);
    }
    run('trade.lines[0].serial="PS5-123"'); await invoke('saveCompleted', true);
    assert.equal(run('sentRecords.length'), 2); assert.equal(run('sentRecords[1].items[0].serial'), 'PS5-123'); assert.equal(run('printed'), 1);
  });
  console.log(`${checks} trade serial checks passed.`);
})().catch((err) => { console.error(err); process.exitCode = 1; });
