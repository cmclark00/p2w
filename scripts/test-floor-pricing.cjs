/* Run with node scripts/test-floor-pricing.cjs [stock.csv lines.csv transactions.csv].
   Reads the real calculator functions; optional exports stay outside the repository. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../trade-in/app.js'), 'utf8');
const elements = new Map();
const element = (selector) => {
  if (!elements.has(selector)) elements.set(selector, { value: '', innerHTML: '', textContent: '', hidden: false,
    listeners: {}, addEventListener(type, handler) { this.listeners[type] = handler; }, focus() {}, scrollIntoView() {} });
  return elements.get(selector);
};
const context = vm.createContext({ console, Date, setTimeout, clearTimeout,
  localStorage: { getItem: () => null, setItem: () => {} },
  document: { querySelector: element, listeners: [], addEventListener(type, handler) { this.listeners.push({ type, handler }); } },
});
vm.runInContext(source.replace(/\binit\(\);\s*$/, ''), context);
const run = (js) => vm.runInContext(js, context);
const json = (js) => JSON.parse(JSON.stringify(run(js)));
const invoke = (name, ...args) => run(`${name}(...${JSON.stringify(args)})`);
let checks = 0;
function test(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
const stockHeader = 'stock_code,item_name,category,item_type,condition,sub_condition,quantity,sell_price,pc_retail_loose_sell,pc_retail_cib_sell,pc_retail_new_sell';
const lineHeader = 'transaction_number,date_local,transaction_type,line_mode,item_name,category,item_type,condition,sub_condition,quantity,line_subtotal';
const txHeader = 'transaction_number,date_local,transaction_type,purchases_total,line_count';
const item = { 'product-name': 'Example Game', 'console-name': 'Playstation 4', 'retail-cib-sell': 1999, 'cib-price': 1500, 'gamestop-price': 0 };
const cur = (product = item, extra = {}) => ({ product, condition: 'cib', manualMissing: false, sales: { cib: [{ title: 'Example Game complete', price: 1999, date: '2026-10-01' }] }, pick: null, typed: null, ...extra });

test('sold evidence leads on modern, retro and hardware even when PriceCharting is higher', () => {
  for (const product of [{ ...item }, { ...item, 'console-name': 'Playstation 2' }, { ...item, 'product-name': 'DualShock 4 Controller', genre: 'Accessories' }]) {
    const r = invoke('floorResult', cur({ ...product, 'retail-cib-sell': 9900, 'cib-price': 8900 }));
    assert.equal(r.b.from, 'sale'); assert.equal(r.r.price, 2000);
  }
});
test('one high sale and odd editions do not replace the normal sold basis', () => {
  const sales = { cib: Array.from({ length: 30 }, (_, i) => ({ title: 'Example Game complete', price: i === 0 ? 16000 : 1999, date: '2026-10-01' })) };
  sales.cib.push({ title: 'Example Game Steelbook', price: 20000, date: '2026-10-01' });
  assert.equal(invoke('floorResult', cur(item, { sales })).r.price, 2000);
});
test('fallback waits for sold evidence and Amazon before using PriceCharting', () => {
  assert.equal(invoke('floorResult', cur(item, { sales: null })).b.waiting, true);
  run('amazonSet = true;');
  assert.equal(invoke('floorResult', cur(item, { sales: { cib: [] }, amazon: { loading: true } })).r, null);
  run('amazonSet = false;');
  const r = invoke('floorResult', cur(item, { sales: { cib: [] } }));
  assert.equal(r.b.from, 'pricecharting'); assert.equal(r.r.price, 1500);
  assert.ok(r.b.checks.some((s) => s.includes('fallback')));
});
test('GameStop and Amazon precede PriceCharting when no sold evidence exists', () => {
  const amazon = { found: true, lowest: 3000, offers: [{ price: 3000 }] };
  const r = invoke('floorResult', cur({ ...item, 'cib-price': 9900 }, { sales: { cib: [] }, amazon }));
  assert.equal(r.b.from, 'amazon'); assert.equal(r.r.price, 3000);
  const gs = invoke('floorResult', cur({ ...item, 'gamestop-price': 2499, 'cib-price': 9900 }, { sales: { cib: [] }, amazon }));
  assert.equal(gs.b.from, 'gamestop'); assert.equal(gs.r.price, 2500);
});
test('missing references require a typed price and failed sales are visibly flagged', () => {
  const empty = { ...item, 'cib-price': 0, 'retail-cib-sell': 9900 };
  const r = invoke('floorResult', cur(empty, { sales: null, salesError: 'Service unavailable' }));
  assert.equal(r.r, null); assert.ok(r.b.need);
  const fallback = invoke('floorResult', cur(item, { sales: null, salesError: 'Service unavailable' }));
  assert.equal(fallback.b.from, 'pricecharting'); assert.ok(fallback.b.checks.some((s) => s.includes('fallback')));
});
test('modern Amazon checks do not displace sold prices, even when PriceCharting would hide an outlier', () => {
  for (const price of [3500, 6000]) {
    const r = invoke('floorResult', cur({ ...item, 'cib-price': 9900 }, { amazon: { found: true, lowest: price, offers: [{ price }] } }));
    assert.equal(r.b.from, 'sale'); assert.equal(r.r.price, 2000);
    assert.ok(r.b.checks.some((s) => s.includes('Amazon')));
  }
});
test('older Amazon adjustment remains capped at 25 percent above sold evidence', () => {
  const r = invoke('floorResult', cur({ ...item, 'console-name': 'Playstation 2', 'cib-price': 9900 }, { amazon: { found: true, lowest: 6000, offers: [{ price: 6000 }] } }));
  assert.equal(r.b.from, 'amazonMid'); assert.equal(r.b.basis, 2499); assert.equal(r.r.price, 2500);
});
test('GameStop remains the floor after a missing-manual deduction', () => {
  assert.equal(invoke('floorResult', cur({ ...item, 'gamestop-price': 4799 }, { manualMissing: true, sales: { cib: [{ title: 'Example Game complete', price: 4999 }] } })).r.price, 5000);
});
test('full lookup blocks adding an automatic price even if retail sell is known', () => {
  const r = invoke('floorResult', cur(item, { fullLoading: true }));
  assert.equal(r.r, null); assert.equal(r.b.waiting, true);
});
test('add action also waits for Amazon on a sales-based price', () => {
  run(`amazonSet = true; floorCur = ${JSON.stringify(cur({ ...item, 'console-name': 'Playstation 2' }, { amazon: { loading: true } }))};`);
  run('addFloorItem();');
  assert.equal(run('floor.items.length'), 0); assert.equal(run('floorCur != null'), true);
  run('amazonSet = false; floorCur = null;');
});
test('lookup failure is visible and typed prices remain explicit overrides', () => {
  assert.ok(invoke('floorResult', cur(item, { fullError: true })).b.checks.some((s) => s.includes('lookup failed')));
  assert.equal(invoke('floorResult', cur(item, { typed: 1000, fullLoading: true })).r.price, 1000);
});
test('modern hardware uses sales instead of the game retail-sell rule', () => {
  const r = invoke('floorResult', cur({ ...item, 'product-name': 'DualShock 4 Controller', genre: 'Accessories', 'cib-price': 3000 }, { sales: { cib: [{ price: 4000, title: 'DualShock controller complete', date: '2026-10-01' }] } }));
  assert.equal(r.hw, true); assert.equal(r.b.from, 'sale'); assert.equal(r.r.price, 4000);
});
test('configured premiums apply to sold evidence on modern systems', () => {
  const r = invoke('floorResult', cur({ ...item, 'product-name': 'Pokemon Shield', 'console-name': 'Nintendo Switch', 'retail-cib-sell': 4599 }));
  assert.equal(r.premium.pct, 10); assert.equal(r.r.price, 2500);
});
test('Killzone system discount and Conker migration are preserved', () => {
  assert.equal(invoke('floorResult', cur({ ...item, 'product-name': 'Killzone: Shadow Fall' }, { sales: { cib: [{ title: 'Killzone Shadow Fall complete', price: 1799 }] } })).r.price, 1000);
  assert.equal(invoke('mergeSettings', { version: 9, floorPremiums: [{ phrase: "Conker's Bad Fur Day", pct: 15 }] }).floorPremiums[0].pct, 10);
  assert.equal(invoke('mergeSettings', { version: 9, floorPremiums: [{ phrase: "Conker's Bad Fur Day", pct: 22 }] }).floorPremiums[0].pct, 22);
});
test('rounding slack and manual deduction boundaries stay unchanged', () => {
  assert.equal(invoke('floorPrice', 2050, {}).price, 2000);
  assert.equal(invoke('floorPrice', 2051, {}).price, 2500);
  assert.deepEqual([2000, 2500, 5000, 5500, 10000, 10500, 20000, 20500].map((v) => invoke('manualDeduction', v)), [0, 500, 500, 1000, 1000, 2000, 2000, 2000]);
});
test('CSV handles BOM, CRLF, embedded commas/newlines and escaped quotes', () => {
  const r = invoke('fulcrumCsv', '\uFEFFa,b\r\n"Game, \"\"Deluxe\"\"\nEdition",00123\r\n');
  assert.equal(r.rows[0].a, 'Game, "Deluxe"\nEdition'); assert.equal(r.rows[0].b, '00123');
});
test('CSV rejects malformed quoting, duplicate headers and broken rows', () => {
  for (const s of ['a,b\n"broken,1', 'a,a\n1,2', 'a,b\n1,2,3', 'a,b\n"x"bad,2']) assert.throws(() => invoke('fulcrumCsv', s));
});
test('imports reject duplicate stock codes and transaction numbers', () => {
  const row = '001,Example Game,Playstation 4,game,completeInBox,,1,20,15,19.99,25';
  assert.throws(() => invoke('fulcrumImport', `${stockHeader}\n${row}\n${row}`));
  assert.throws(() => invoke('fulcrumImport', `${txHeader}\n1,2026-10-01 12:00:00,Sale,20,1\n1,2026-10-01 12:00:00,Sale,20,1`));
});
test('evidence excludes trades, voids, zero subtotals and unverified headers', () => {
  const rows = [
    '1,2026-10-01 12:00:00,Sale,sale,Example Game,Playstation 4,game,completeInBox,,2,30',
    '2,2026-10-01 12:00:00,,trade,Example Game,Playstation 4,game,completeInBox,,1,0',
    '3,2026-10-01 12:00:00,,sale,Example Game,Playstation 4,game,completeInBox,,1,0',
    '4,2026-10-01 12:00:00,Sale,sale,Example Game,Playstation 4,game,completeInBox,,1,0',
    '5,2026-10-01 12:00:00,Sale,sale,Example Game,Playstation 4,game,completeInBox,,1,90',
    '6,2026-10-01 12:00:00,Return,return,Example Game,Playstation 4,game,completeInBox,,1,-20',
  ];
  context.testData = { stock: [], sales: invoke('fulcrumImport', `${lineHeader}\n${rows.join('\n')}`).rows,
    transactions: invoke('fulcrumImport', `${txHeader}\n1,2026-10-01 12:00:00,Sale,30,1\n2,2026-10-01 12:00:00,,0,1\n3,2026-10-01 12:00:00,,0,1\n4,2026-10-01 12:00:00,Sale,0,1\n6,2026-10-01 12:00:00,Return,-20,1`).rows };
  const r = json('(() => { const d = fulcrumEvidence(testData), g = [...d.groups.values()][0]; return { sales: g.sales, returns: g.returns, unmatched: d.unmatched }; })()');
  assert.equal(r.sales.length, 1); assert.equal(r.sales[0].price, 1500); assert.equal(r.sales[0].qty, 2);
  assert.equal(r.returns, 1); assert.equal(r.unmatched, 1);
});
test('quantity-weighted median and exact edition/region/manual matching', () => {
  assert.equal(invoke('fulcrumMedian', [{ price: 1500, qty: 3 }, { price: 3000, qty: 1 }]), 1500);
  const key = invoke('fulcrumKey', 'Pokemon Red', 'GameBoy', 'cib', false);
  assert.equal(key, invoke('fulcrumKey', 'Pokémon Red', 'GameBoy', 'cib', false));
  for (const [name, sys, manual] of [['Pokemon Red [Japan]', 'GameBoy', false], ['Pokemon Red', 'PAL GameBoy', false], ['Pokemon Red', 'GameBoy', true]]) {
    assert.notEqual(key, invoke('fulcrumKey', name, sys, 'cib', manual));
  }
  assert.equal(invoke('fulcrumGroupKey', { item_type: 'game', condition: 'cartWithManual' }), null);
});
test('transaction import discards customer and payment columns', () => {
  const r = invoke('fulcrumImport', `${txHeader},customer,paid_card\n1,2026-10-01 12:00:00,Sale,20,1,Private Person,20`);
  assert.equal('customer' in r.rows[0], false); assert.equal('paid_card' in r.rows[0], false);
});
test('unloaded sales remain missing instead of appearing as zero sales', () => {
  context.stockOnly = invoke('fulcrumImport', `${stockHeader}\n001,Example Game,Playstation 4,game,completeInBox,,1,40,15,19.99,25`).rows;
  run('Object.assign(fulcrum, { stock: stockOnly, sales: null, transactions: null }); fulcrumData = fulcrumEvidence(); renderFulcrum();');
  assert.ok(element('#fulcrumReview').innerHTML.includes('Not loaded'));
  assert.ok(invoke('fulcrumReference', cur(), 2000).includes('Sales line items not loaded'));
  run('clearFulcrum();');
  assert.equal(run('fulcrumData'), null);
});
test('review-title click keeps search open through document event bubbling', () => {
  run('Object.assign(fulcrum, { stock: stockOnly }); fulcrumData = fulcrumEvidence(); wireFloor();');
  const key = invoke('fulcrumKey', 'Example Game', 'Playstation 4', 'cib', false);
  const button = { dataset: { fulcrumKey: key } };
  const event = { target: { closest(selector) { return selector.includes('[data-fulcrum-key]') ? button : null; } } };
  run('const originalPcSearch = PC.search; PC.search = () => new Promise(() => {});');
  element('#fulcrumReview').listeners.click(event);
  const startedSeq = run('floorSearch.seq');
  for (const entry of context.document.listeners) if (entry.type === 'click') entry.handler(event);
  assert.equal(element('#floorScan').value, 'Example Game Playstation 4');
  assert.equal(element('#floorResults').hidden, false);
  assert.equal(run('floorSearch.loading'), true);
  assert.equal(run('floorSearch.seq'), startedSeq);
  // Ordinary outside clicks must still dismiss the search results.
  for (const entry of context.document.listeners) if (entry.type === 'click') entry.handler({ target: { closest: () => null } });
  assert.equal(element('#floorResults').hidden, true);
  run('PC.search = originalPcSearch; clearFulcrum();');
});

const exportPaths = process.argv.slice(2);
if (exportPaths.length) {
  assert.equal(exportPaths.length, 3, 'Supply stock, sales line items, and transactions exports');
  for (const p of exportPaths) { const parsed = invoke('fulcrumImport', fs.readFileSync(p, 'utf8')); context[parsed.kind] = parsed.rows; }
  run('Object.assign(fulcrum, { stock, sales, transactions }); fulcrumData = fulcrumEvidence(); renderFulcrum();');
  const summary = json(`(() => {
    const groups = [...fulcrumData.groups.values()];
    return { stockRows: stock.length, lineRows: sales.length, transactionRows: transactions.length,
      eligibleGameUnitsSold: groups.reduce((n, g) => n + g.sales.reduce((s, r) => s + r.qty, 0), 0),
      unmatchedHeaders: fulcrumData.unmatched, excludedLines: fulcrumData.excluded,
      soldFrom: fulcrumData.from, soldTo: fulcrumData.to };
  })()`);
  console.log('Export analysis:', JSON.stringify(summary));
  console.log(element('#fulcrumReview').innerHTML.match(/<p[^>]*>(.*?)<\/p>/)?.[1]);
  assert.equal(summary.unmatchedHeaders, 0);
  assert.ok(summary.eligibleGameUnitsSold > 0);
  test('actual exports import, reconcile headers, and render the review queue', () => {});
}
console.log(`${checks} checks passed.`);
