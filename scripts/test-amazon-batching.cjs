'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync('trade-in/app.js', 'utf8');
const start = source.indexOf('function createAmazonBatchRequest(');
const end = source.indexOf('const floorAmazonRequest', start);
const ctx = vm.createContext({ setTimeout, clearTimeout });
vm.runInContext(source.slice(start, end), ctx);
const create = ctx.createAmazonBatchRequest;
const params = i => ({ asin: `B${String(i).padStart(9, '0')}`, cond: 'used' });
const reply = requests => ({ results: Object.fromEntries(requests.map(p => [`${p.asin}:${p.cond}`, { data: { asin: p.asin, lowest: 1234 } }])) });
(async () => {
  const calls = [];
  const request = create(async (route, opts) => { calls.push([route, opts]); return reply(opts.body.requests); });
  const reads = Array.from({ length: 41 }, (_, i) => request('amazon/offers', params(i)));
  assert.equal(request('amazon/offers', params(0)), reads[0], 'Duplicate reads share an in-flight promise');
  const values = await Promise.all(reads);
  assert.deepEqual(calls.map(c => c[1].body.requests.length), [20, 20, 1]);
  assert.equal(values[40].asin, params(40).asin);
  let unblock, offerStarted;
  const started = new Promise(r => offerStarted = r);
  const parallel = create(async (route, opts) => {
    if (route === 'amazon/catalog') return { candidates: [] };
    offerStarted(); await new Promise(r => unblock = r); return reply(opts.body.requests);
  });
  const pending = parallel('amazon/offers', params(0)); await started;
  assert.deepEqual(await parallel('amazon/catalog', { q: 'game' }), { candidates: [] });
  unblock(); await pending;
  const partial = create(async (_, opts) => {
    const data = reply(opts.body.requests);
    data.results[`${params(1).asin}:used`] = { error: 'Throttled', status: 429 };
    delete data.results[`${params(2).asin}:used`]; return data;
  });
  const results = await Promise.allSettled([0, 1, 2].map(i => partial('amazon/offers', params(i))));
  assert.deepEqual(results.map(r => r.status), ['fulfilled', 'rejected', 'rejected']);
  assert.equal(results[1].reason.status, 429); assert.equal(results[2].reason.status, 502);
  const routes = [];
  const legacy = create(async (route, opts) => {
    routes.push(route);
    if (route.endsWith('-batch')) throw Object.assign(new Error('Not deployed'), { status: 404 });
    return { asin: opts.params.asin };
  });
  assert.equal((await legacy('amazon/offers', params(0))).asin, params(0).asin);
  assert.deepEqual(routes, ['amazon/offers-batch', 'amazon/offers']);
  console.log('Amazon batching: bounded chunks, deduplication, catalog overlap, partial failure and legacy fallback passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
