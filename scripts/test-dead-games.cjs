'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const reg = require('../trade-in/dead-games.js');
const importer = require('./update-dead-games.cjs');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../trade-in/dead-games.json'), 'utf8'));
const clone = (s) => JSON.parse(JSON.stringify(s));
let checks = 0;
const test = (name, fn) => { fn(); checks++; console.log('PASS ' + name); };
test('all 28 reviewed source-register entries and four categories survive generation', () => {
  assert.deepEqual(reg.data, data);
  assert.equal(data.revision, 6); assert.equal(data.sourceSequence, 9);
  assert.deepEqual(Object.keys(reg.labels).map((k) => data.entries.filter((e) => e.category === k).length), [17, 8, 2, 1]);
  for (const e of data.entries) {
    assert.ok(e.sources.length);
    assert.equal(e.reviewedAt, ['monster-hunter-frontier-g-ps3', 'phantasy-star-online-2-vita-special',
      'monster-hunter-frontier-g-wii-u', 'monster-hunter-frontier-online-xbox360-beginners',
      'monster-hunter-frontier-g-vita'].includes(e.id) ? '2026-10-20' : '2026-10-19');
  }
});

test('Frontier G matches only the verified PS3 disc names, preserving exact-edition evidence', () => {
  const e = reg.match('Monster Hunter: Frontier G', 'JP Playstation 3');
  assert.equal(e.id, 'monster-hunter-frontier-g-ps3'); assert.equal(e.category, 'conditional');
  assert.match(e.edition, /BLJM-60577/); assert.match(e.edition, /4976219051682/); assert.match(e.edition, /4562923/);
  assert.match(e.caveats, /exact original-disc revival setup and hardware compatibility are unverified/);
  assert.equal(reg.match("Monster Hunter Frontier G Beginner's Package", 'PS3').id, e.id);
  for (const [name, p] of [['Monster Hunter', 'PS3'], ['Monster Hunter Portable 3rd HD', 'PS3'],
    ['Monster Hunter Portable 3rd HD Ver.', 'PS3'], ['Monster Hunter Frontier', 'PS3'], ['Monster Hunter Frontier Z', 'PS3'],
    ['Monster Hunter Frontier GG', 'PS3'], ['Monster Hunter Frontier G2', 'PS3'],
    ['Monster Hunter Frontier G [Download Code]', 'PS3'], ['Monster Hunter Frontier G Premium Package', 'PS3'],
    ['Monster Hunter Frontier G', 'PS4'],
    ['Monster Hunter Frontier G', 'PC Games']]) assert.equal(reg.match(name, p), null, name + ' @ ' + p);
});
test('Wii U and Xbox 360 match only their verified Beginner packages with independent classifications', () => {
  const wii = reg.match('Monster Hunter: Frontier G', 'JP Wii U');
  assert.equal(wii.id, 'monster-hunter-frontier-g-wii-u'); assert.equal(wii.category, 'conditional');
  for (const id of ['WUP-P-AMFJ', '4976219051699', '4042087']) assert.ok(wii.edition.includes(id), id);
  assert.match(wii.caveats, /through Z2/); assert.match(wii.caveats, /Exact original-disc compatibility is unverified/);
  const xbox = reg.match("Monster Hunter Frontier Online [Beginner's Package]", 'JP Xbox 360');
  assert.equal(xbox.id, 'monster-hunter-frontier-online-xbox360-beginners'); assert.equal(xbox.category, 'unplayable');
  for (const id of ['JES1-00049', '4976219034241', '4400119', '24 June 2010']) assert.ok(xbox.edition.includes(id), id);
  assert.match(xbox.caveats, /not the separate Online Trial Version Edition/);
  assert.equal(wii.closureDate, '2018-08-01'); assert.equal(xbox.closureDate, '2018-08-01');
  for (const [name, p] of [
    ['Monster Hunter Frontier G Memorial Package', 'Wii U'], ['Monster Hunter Frontier G5', 'Wii U'],
    ['Monster Hunter Frontier G6 Premium Package', 'Wii U'], ['Monster Hunter Frontier G Trial', 'Wii U'],
    ['Monster Hunter Frontier G Beta', 'Wii U'], ['Monster Hunter Frontier Z', 'Wii U'],
    ['Monster Hunter 3 Ultimate', 'Wii U'], ['Monster Hunter Frontier Online', 'Xbox 360'],
    ['Monster Hunter Frontier Online Trial Version Edition', 'Xbox 360'],
    ['Monster Hunter Frontier Online Season 9.0', 'Xbox 360'], ['Monster Hunter Frontier Online Forward.1', 'Xbox 360'],
    ['Monster Hunter Frontier G', 'Xbox 360'], ["Monster Hunter Frontier Online Beginner's Package", 'PC Games'],
    ['Front Mission Online', 'PS2'], ['Front Mission Online SLPM-65981', 'PS2'], ['Front Mission Online SLPM-68514', 'PS2'],
  ]) assert.equal(reg.match(name, p), null, name + ' @ ' + p);
  assert.match(data.notice, /Reviewed subset of source sequence 9/);
  assert.match(data.notice, /Front Mission Online PS2 remains outside website coverage/);
});
const vitaOutOfScope = ['Monster Hunter Frontier G Beta', 'Monster Hunter Frontier G Trial',
  'Monster Hunter Frontier G Free Trial', 'Monster Hunter Frontier G Download Code',
  'Monster Hunter Frontier G5', 'Monster Hunter Frontier G6 Premium Package', 'Monster Hunter Frontier G9',
  'Monster Hunter Frontier G Memorial Package', 'Monster Hunter Frontier GG', 'Monster Hunter Frontier Z',
  'Monster Hunter Freedom Unite', 'Monster Hunter'];
test('Vita Beginner package uses reconciled exact identity and excludes trial, beta and later packages', () => {
  const e = reg.match('Monster Hunter: Frontier G', 'JP Playstation Vita');
  assert.equal(e.id, 'monster-hunter-frontier-g-vita'); assert.equal(e.category, 'conditional');
  assert.equal(reg.match("Monster Hunter Frontier G [Beginner's Package]", 'PlayStation Vita').id, e.id);
  for (const id of ['VLJM-35137', '4976219056304', '2156539', '13 August 2014']) assert.ok(e.edition.includes(id), id);
  assert.match(e.edition, /cross-source inference/); assert.match(e.edition, /no model\/JAN metadata fields populated/);
  assert.match(e.caveats, /exact original-card compatibility is unverified/);
  assert.match(e.caveats, /live JAN lookup returned no product/);
  assert.equal(e.closureDate, '2019-12-18'); assert.match(e.effective, /21:00 JST/);
  for (const name of vitaOutOfScope) assert.equal(reg.match(name, 'PlayStation Vita'), null, name);
  for (const platform of ['PS4', 'PS5', 'Xbox 360', 'PC Games']) assert.equal(reg.match('Monster Hunter Frontier G', platform), null, platform);
  assert.equal(reg.match('Monster Hunter Frontier G', 'PS3').id, 'monster-hunter-frontier-g-ps3');
  assert.equal(reg.match('Monster Hunter Frontier G', 'Wii U').id, 'monster-hunter-frontier-g-wii-u');
});
test('every curated exact alias matches its own platform and category', () => {
  for (const e of data.entries) for (const a of e.aliases) for (const p of e.platforms) {
    assert.equal(reg.match(a, p).id, e.id, a + ' @ ' + p);
    assert.equal(reg.match(a, 'PAL ' + p).id, e.id);
  }
});

test('PSO2 matches only the verified Vita Special Package and keeps Sega release and experimental caveats', () => {
  const e = reg.match('Phantasy Star Online 2 [Special Package]', 'JP Playstation Vita');
  assert.equal(e.id, 'phantasy-star-online-2-vita-special'); assert.equal(e.category, 'conditional');
  for (const id of ['PCSG-00141', 'VLJM-35031', '4974365821111', '1179918', '28 February 2013']) assert.ok(e.edition.includes(id), id);
  assert.equal(e.closureDate, '2020-09-16');
  assert.match(e.caveats, /6\.1001\.2/); assert.match(e.caveats, /gameplay completeness and original-card compatibility are unverified/);
  for (const [name, p] of [['Phantasy Star Nova', 'PlayStation Vita'], ['Phantasy Star Online 2', 'PlayStation Vita'],
    ['Phantasy Star Online 2 New Genesis', 'PlayStation Vita'], ['Phantasy Star Online 2 Episode 2 Special Package', 'PlayStation Vita'],
    ['Phantasy Star Online 2 Episode 4 Deluxe Package', 'PlayStation Vita'], ['Phantasy Star Online 2 Special Package Unknown Edition', 'PlayStation Vita'],
    ['Phantasy Star Online 2 [Special Package]', 'PS4'], ['Phantasy Star Online 2 [Special Package]', 'PC Games'],
    ['Phantasy Star Online 2 [Special Package]', 'PS3']]) assert.equal(reg.match(name, p), null, name + ' @ ' + p);
});
test('closures never leak across platforms, sequels, expansions or unknown editions', () => {
  for (const [name, p] of [['DC Universe Online', 'PlayStation 4'], ['Final Fantasy XIV Heavensward', 'PlayStation 4'],
    ['Plants vs Zombies Garden Warfare', 'Xbox 360'], ['Plants vs Zombies Garden Warfare', 'PlayStation 4'],
    ['The Crew 2', 'PlayStation 4'], ['The Crew Motorfest', 'PlayStation 5'], ['Defiance 2050', 'PlayStation 3'],
    ['Final Fantasy XI', 'PC Games'], ['Anthem Unknown Edition', 'PlayStation 4'], ['The Crew Wild Run', 'Xbox 360'],
    ['Twisted Metal Black', 'PlayStation 2'], ['Paragon', 'PlayStation 4']]) assert.equal(reg.match(name, p), null, name + ' @ ' + p);
  assert.ok(reg.related('Paragon', 'PS4').length);
  assert.equal(reg.match("Babylon’s Fall", 'PS5').id, 'babylons-fall');
  assert.equal(reg.match('Anthem [Legion of Dawn Edition]', 'Xbox One').id, 'anthem');
});
test('Evolve and LAN exclusions, console revivals and future closures stay distinct', () => {
  assert.equal(reg.match('Evolve', 'PS4').category, 'offline');
  assert.equal(reg.match('Twisted Metal Black Online', 'PS2').category, 'offline');
  assert.equal(reg.match('Final Fantasy XI', 'PS2').category, 'conditional');
  assert.equal(reg.match('Final Fantasy XI', 'Xbox 360').category, 'unplayable');
  assert.equal(reg.match('Destruction AllStars', 'PS5').category, 'upcoming');
});
test('search combines title, edition, console, caveat and category filters', () => {
  assert.equal(reg.filter('Defiance', 'PlayStation 3', 'unplayable').length, 1);
  assert.equal(reg.filter('PSRewired', '', 'conditional')[0].id, 'socom-confrontation');
  assert.equal(reg.filter('Evolve', '', 'unplayable').length, 0);
  assert.equal(reg.filter('zzzz-no-such-game').length, 0);
});
test('only entire untouched legacy lists migrate; staff edits and deliberate version-12 rules survive', () => {
  assert.deepEqual(reg.migrateLegacy(reg.legacy.slice().reverse()), []);
  assert.deepEqual(reg.migrateLegacy(['Evolve', 'My shop override']), ['Evolve', 'My shop override']);
  assert.deepEqual(reg.migrateLegacy(reg.legacy.slice(1)), reg.legacy.slice(1));
});
test('schema rejects unsafe links, missing evidence, ambiguous aliases, invalid dates and future confirmations', () => {
  for (const mutate of [
    (d) => d.entries[0].sources[0].url = 'javascript:alert(1)',
    (d) => d.entries[0].sources = [],
    (d) => d.entries[1].aliases = ['Anthem'],
    (d) => d.entries[0].reviewedAt = '2026-02-30',
    (d) => d.entries[0].closureDate = '2027-01-01',
    (d) => d.entries[0].category = 'probably dead',
    (d) => d.entries[0].normalPlay = 'requires-lan',
    (d) => d.entries.find((e) => e.id === 'tmbo').normalPlay = 'unsupported-policy',
    (d) => d.entries.push(clone(d.entries[0])),
    (d) => Object.defineProperty(d, '__proto__', { value: { polluted: true }, enumerable: true }),
    (d) => d.metadata = JSON.parse('{"constructor":{"prototype":{"polluted":true}}}'),
  ]) { const d = clone(data); mutate(d); assert.throws(() => reg.validate(d)); }
});
test('import requires higher revision, preserves history and identifies reviewed changes', () => {
  const d = clone(data); d.entries[0].caveats += ' Review note.';
  assert.throws(() => importer.plan(d, data), /Revision/);
  d.revision++; assert.throws(() => importer.plan(d, data), /history/);
  d.changes.push({ date: data.updatedAt, type: 'review', entryId: 'anthem', summary: 'Rechecked exact-console evidence.' });
  assert.equal(importer.plan(d, data)[0].type, 'review');
  d.changes[0].summary = 'Overwritten history'; assert.throws(() => importer.plan(d, data), /Preserve/);
});
test('new coverage is not labeled a new shutdown, and upcoming dates never auto-promote', () => {
  const d = clone(data), e = clone(d.entries[0]); e.id = 'new-coverage'; e.aliases = ['Historical Game']; e.title = 'Historical Game';
  d.entries.push(e); d.revision++; d.changes.push({ date: data.updatedAt, type: 'coverage', entryId: e.id, summary: 'Added historical closure evidence.' });
  assert.equal(importer.plan(d, data).find((r) => r.id === e.id).type, 'coverage');
  const bad = clone(d); bad.changes.at(-1).type = 'shutdown'; assert.throws(() => importer.plan(bad, data));
  assert.equal(reg.match('Destruction AllStars', 'PS5', d).category, 'upcoming');
});
test('revivals and removals preserve historical events instead of rewriting past shutdowns', () => {
  const closed = clone(data); closed.revision++;
  closed.entries[0].closureDate = data.updatedAt; closed.entries[0].reviewedAt = data.updatedAt;
  closed.changes.push({date:data.updatedAt,type:'shutdown',entryId:'anthem',summary:'Verified exact-edition closure on the effective date.'});
  assert.ok(importer.plan(closed, data).length);
  const revived = clone(closed); revived.revision++; revived.entries[0].category = 'offline';
  revived.changes.push({date:data.updatedAt,type:'status',entryId:'anthem',summary:'New evidence verifies offline gameplay for this edition.'});
  assert.equal(importer.plan(revived, closed)[0].type, 'status');
  const removed = clone(revived); removed.revision++; removed.entries = removed.entries.filter((r) => r.id !== 'anthem');
  removed.changes.push({date:data.updatedAt,type:'correction',summary:'Removed anthem after correcting register coverage.'});
  assert.equal(importer.plan(removed, revived)[0].type, 'removed');
});
test('CLI dry run is read-only, stale hashes fail, and reviewed apply updates the pair consistently', () => {
  const os = require('node:os'), cp = require('node:child_process'), crypto = require('node:crypto');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'p2w-dead-import-'));
  try {
    fs.mkdirSync(path.join(temp, 'scripts')); fs.mkdirSync(path.join(temp, 'trade-in'));
    for (const rel of ['scripts/update-dead-games.cjs', 'trade-in/dead-games.js', 'trade-in/dead-games.json']) {
      fs.copyFileSync(path.join(__dirname, '..', rel), path.join(temp, rel));
    }
    const old = fs.readFileSync(path.join(temp, 'trade-in/dead-games.json'), 'utf8');
    const d = clone(data); d.revision++; d.entries[0].caveats += ' Reviewed.';
    d.changes.push({ date: data.updatedAt, type: 'review', entryId: 'anthem', summary: 'Reviewed console evidence.' });
    const candidate = path.join(temp, 'candidate.json'); fs.writeFileSync(candidate, JSON.stringify(d));
    const cli = (...args) => {
      const r = cp.spawnSync(process.execPath, [path.join(temp, 'scripts/update-dead-games.cjs'), ...args], { encoding: 'utf8' });
      if (r.error) throw r.error;
      return r;
    };
    assert.equal(cli(candidate).status, 0);
    assert.equal(fs.readFileSync(path.join(temp, 'trade-in/dead-games.json'), 'utf8'), old);
    assert.equal(cli(candidate, '--apply', '--expected', 'stale').status, 1);
    assert.equal(fs.readFileSync(path.join(temp, 'trade-in/dead-games.json'), 'utf8'), old);
    const hash = crypto.createHash('sha256').update(old).digest('hex');
    const malicious = JSON.parse(JSON.stringify(d).replace('"schemaVersion":1', '"schemaVersion":1,"__proto__":{"polluted":true}'));
    fs.writeFileSync(candidate, JSON.stringify(malicious));
    assert.equal(cli(candidate, '--apply', '--expected', hash).status, 1);
    assert.equal(fs.readFileSync(path.join(temp, 'trade-in/dead-games.json'), 'utf8'), old);
    fs.writeFileSync(candidate, JSON.stringify(d));
    const applied = cli(candidate, '--apply', '--expected', hash);
    assert.equal(applied.status, 0, applied.stderr);
    assert.equal(cli('--check').status, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(temp, 'trade-in/dead-games.json'))).revision, data.revision + 1);
  } finally {
    const resolved = path.resolve(temp);
    if (path.dirname(resolved).toLowerCase() !== path.resolve(os.tmpdir()).toLowerCase()
      || !path.basename(resolved).startsWith('p2w-dead-import-')) throw new Error('Unexpected test cleanup target');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
const elements = new Map();
function element(k) {
  if (!elements.has(k)) elements.set(k, { value: '', innerHTML: '', textContent: '', hidden: false, options: [{}],
    addEventListener() {}, focus() {}, classList: { toggle() {} } });
  return elements.get(k);
}
const ctx = vm.createContext({ console, URL, Date, setTimeout, clearTimeout, P2WDeadGames: reg,
  crypto: require('node:crypto').webcrypto, localStorage: { getItem: () => null, setItem() {} },
  document: { querySelector: element, querySelectorAll: () => [], addEventListener() {} } });
const source = fs.readFileSync(path.join(__dirname, '../trade-in/app.js'), 'utf8');
vm.runInContext(source.replace(/\binit\(\);\s*$/, ''), ctx);
const run = (s) => vm.runInContext(s, ctx);
const call = (name, ...args) => run(name + '(...' + JSON.stringify(args) + ')');
const line = (name, platform) => ({ name, platform, category: 'game', source: 'pc', condition: 'cib',
  qty: 1, prices: { 'retail-cib-buy': 1000, 'cib-price': 2000, 'loose-price': 1000 } });
test('real calculator respects curated scoping, offline exclusions and independent manager overrides', () => {
  assert.equal(call('guideCheck', line('Anthem', 'PS4'), run('settings')).dontBuy, true);
  assert.equal(call('guideCheck', line('DC Universe Online', 'PS4'), run('settings')), null);
  assert.equal(call('guideCheck', line('Evolve', 'PS4'), run('settings')), null);
  assert.equal(call('guideCheck', line('MAG', 'PS3'), run('settings')), null);
  const saved = clone(run('settings')); saved.guide.deadGames = ['Evolve', 'DC Universe Online'];
  assert.equal(call('guideCheck', line('Evolve', 'PS4'), saved).dontBuy, true);
  assert.equal(call('guideCheck', line('DC Universe Online', 'PS4'), saved).dontBuy, true);
  const legacy = clone(saved); legacy.version = 11; legacy.guide.deadGames = reg.legacy;
  assert.deepEqual(clone(call('mergeSettings', legacy).guide.deadGames), []);
  saved.version = 12; saved.guide.deadGames = reg.legacy;
  assert.deepEqual(clone(call('mergeSettings', saved).guide.deadGames), reg.legacy);
});
function cur(name, platform) {
  return { product: { id: '123', 'product-name': name, 'console-name': platform, 'cib-price': 2000 },
    condition: 'cib', sales: { cib: [{ price: 2000, title: name + ' complete', date: '2026-10-01' }] }, typed: 2000 };
}
test('real floor pricing holds only exact unplayable/conditional editions, even with typed prices', () => {
  for (const [name, p] of [['Anthem', 'PS4'], ['MAG', 'PS3'], ['SOCOM Confrontation', 'PS3']]) {
    const r = call('floorResult', cur(name, p)); assert.equal(r.r, null); assert.match(r.b.need, /Do not buy or sell/);
  }
  for (const [name, p] of [['Evolve', 'PS4'], ['DC Universe Online', 'PS4'], ['The Crew 2', 'PS4'], ['Destruction AllStars', 'PS5']]) {
    assert.ok(call('floorResult', cur(name, p)).r);
  }
});
test('both rendered checkpoints prominently flag confirmed and special-setup exact editions', () => {
  const cases = [['Anthem','PS4'], ['MAG','PS3'], ['SOCOM Confrontation','PS3'],
    ['Final Fantasy XI','PS2'], ['EverQuest Online Adventures Frontiers','PS2'], ['Monster Hunter: Frontier G','JP Playstation 3'],
    ['Phantasy Star Online 2 [Special Package]','JP Playstation Vita'],
    ['Monster Hunter: Frontier G','JP Wii U'], ["Monster Hunter Frontier Online [Beginner's Package]",'JP Xbox 360'],
    ['Monster Hunter: Frontier G','JP Playstation Vita']];
  ctx.policyRow = { classList: { toggle() {} }, querySelector: element, querySelectorAll: () => [] };
  for (const [name, platform] of cases) {
    ctx.policyLine = line(name, platform);
    run('updateRow(policyRow, policyLine);');
    const tradeHTML = element('[data-cell="flags"]').innerHTML;
    assert.match(tradeHTML, /Trade-In checkpoint/);
    assert.match(tradeHTML, /Do not buy or sell as ordinarily playable/);
    if (reg.match(name, platform).category === 'conditional') assert.match(tradeHTML, /not normally playable - unofficial or special setup/);
    ctx.policyCurrent = cur(name, platform); run('floorCur = policyCurrent; renderFloorPricer();');
    assert.match(element('#floorPricer').innerHTML, /Pricing checkpoint/);
    assert.match(element('#floorPricer').innerHTML, /data-floor-act="add" disabled/);
  }
});
test('Frontier platform packages preserve offer rules, saved prices and exact-edition shelf holds', () => {
  for (const [name, platform, confirmed] of [['Monster Hunter: Frontier G', 'JP Wii U', false],
    ["Monster Hunter Frontier Online [Beginner's Package]", 'JP Xbox 360', true],
    ['Monster Hunter: Frontier G', 'JP Playstation Vita', false]]) {
    const l = line(name, platform);
    assert.equal(!!call('guideCheck', l, run('settings'))?.dontBuy, confirmed);
    assert.equal(call('priceLine', l).cash === 0, confirmed);
    l.cashOverride = 777; assert.equal(call('priceLine', l).cash, 777);
    run('settings.guide.enabled = false;');
    ctx.policyLine = l; run('updateRow(policyRow, policyLine);');
    assert.match(element('[data-cell="flags"]').innerHTML, /Trade-In checkpoint/);
    assert.equal(call('priceLine', l).cash, 777);
    assert.equal(call('floorResult', cur(name, platform)).r, null);
    run('settings.guide.enabled = true;');
    ctx.packageSaved = [{name, platform, price:3000, recheck:{price:4000}}];
    run('floor.items = packageSaved; printFloorLabels(); printFloorList(); copyFloorList(); useRecheck(floor.items[0]);');
    assert.equal(run('floor.items[0].price'), 3000);
  }
  for (const [name, p] of [['Monster Hunter Frontier G Memorial Package', 'Wii U'],
    ['Monster Hunter Frontier G5', 'Wii U'], ['Monster Hunter Frontier Online Trial Version Edition', 'Xbox 360'],
    ['Monster Hunter Frontier Online', 'Xbox 360'], ...vitaOutOfScope.map((name) => [name, 'PlayStation Vita'])]) {
    for (const checkpoint of ['Trade-In', 'Pricing']) assert.equal(call('deadGameNotice', name, p, checkpoint), '', name);
    assert.ok(call('floorResult', cur(name, p)).r, name);
  }
});
test('conditional flags remain visible with guide disabled and typed offers, without changing cash', () => {
  const l = line('MAG','PS3');
  const before = clone(call('priceLine', l));
  assert.equal(before.dontBuy, false); assert.ok(before.cash > 0);
  l.cashOverride = 777;
  assert.equal(call('priceLine', l).cash, 777);
  run('settings.guide.enabled = false;');
  ctx.policyLine = l; run('updateRow(policyRow, policyLine);');
  assert.match(element('[data-cell="flags"]').innerHTML, /not normally playable/);
  assert.equal(call('priceLine', l).cash, 777);
  run('settings.guide.enabled = true;');
});

test('Frontier G keeps both checkpoints and shelf holds without zeroing offers or touching saved prices', () => {
  const name = 'Monster Hunter: Frontier G', platform = 'JP Playstation 3';
  const l = line(name, platform);
  assert.equal(call('guideCheck', l, run('settings')), null);
  assert.ok(call('priceLine', l).cash > 0);
  l.cashOverride = 777; ctx.policyLine = l; run('updateRow(policyRow, policyLine);');
  assert.match(element('[data-cell="flags"]').innerHTML, /Trade-In checkpoint/);
  assert.match(element('[data-cell="flags"]').innerHTML, /exact original-disc revival setup and hardware compatibility are unverified/);
  assert.equal(call('priceLine', l).cash, 777);
  assert.equal(call('floorResult', cur(name, platform)).r, null);
  run("floor.items = [{name:'Monster Hunter: Frontier G',platform:'JP Playstation 3',price:3000,recheck:{price:4000}}];");
  run('printFloorLabels(); printFloorList(); copyFloorList(); useRecheck(floor.items[0]);');
  assert.equal(run('floor.items[0].price'), 3000);
  for (const name of ['Monster Hunter', 'Monster Hunter Portable 3rd HD', 'Monster Hunter Frontier Z',
    'Monster Hunter Frontier G2', 'Monster Hunter Frontier G [Download Code]', 'Monster Hunter Frontier G Premium Package']) {
    for (const checkpoint of ['Trade-In', 'Pricing']) assert.equal(call('deadGameNotice', name, platform, checkpoint), '', name);
    assert.ok(call('floorResult', cur(name, platform)).r, name);
  }
});
test('Evolve, other platforms and successor titles receive no automatic warning in either checkpoint', () => {
  for (const [name, platform] of [['Evolve','PS4'], ['Evolve','Xbox One'], ['DC Universe Online','PS4'],
    ['Plants vs Zombies Garden Warfare','Xbox 360'], ['Final Fantasy XIV Heavensward','PS4'],
    ['Final Fantasy XI','PS4'], ['SOCOM Confrontation','PS4'], ['The Crew 2','PS4'], ['The Crew Motorfest','PS5']]) {
    assert.equal(call('deadGameNotice',name,platform,'Trade-In'), '', name);
    assert.equal(call('deadGameNotice',name,platform,'Pricing'), '', name);
    assert.ok(call('floorResult',cur(name,platform)).r, name);
  }
});

test('PSO2 Special Package preserves trade overrides and saved prices while both checkpoints hold normal shelves', () => {
  const name = 'Phantasy Star Online 2 [Special Package]', platform = 'JP Playstation Vita';
  const l = line(name, platform);
  assert.equal(call('guideCheck', l, run('settings')), null);
  assert.ok(call('priceLine', l).cash > 0);
  l.cashOverride = 777; ctx.policyLine = l; run('updateRow(policyRow, policyLine);');
  assert.match(element('[data-cell="flags"]').innerHTML, /Trade-In checkpoint/);
  assert.match(element('[data-cell="flags"]').innerHTML, /gameplay completeness and original-card compatibility are unverified/);
  assert.equal(call('priceLine', l).cash, 777);
  assert.equal(call('floorResult', cur(name, platform)).r, null);
  run("floor.items = [{name:'Phantasy Star Online 2 [Special Package]',platform:'JP Playstation Vita',price:3000,recheck:{price:4000}}];");
  run('printFloorLabels(); printFloorList(); copyFloorList(); useRecheck(floor.items[0]);');
  assert.equal(run('floor.items[0].price'), 3000);
  for (const [name, p] of [['Phantasy Star Nova', platform], ['Phantasy Star Online 2', platform],
    ['Phantasy Star Online 2 New Genesis', platform], ['Phantasy Star Online 2 Episode 2 Special Package', platform],
    ['Phantasy Star Online 2 [Special Package]', 'PS4'], ['Phantasy Star Online 2 [Special Package]', 'PC Games']]) {
    for (const checkpoint of ['Trade-In', 'Pricing']) assert.equal(call('deadGameNotice', name, p, checkpoint), '', name);
    assert.ok(call('floorResult', cur(name, p)).r, name);
  }
});
test('LAN policy is separate from dead classification and blocks ordinary shelf labels/exports', () => {
  const name = 'Twisted Metal Black Online', platform = 'PS2';
  const e = reg.match(name,platform);
  assert.equal(e.category,'offline'); assert.match(e.classification,/LAN multiplayer available/);
  assert.equal(e.normalPlay,'requires-lan');
  for (const tab of ['Trade-In','Pricing']) {
    const html = call('deadGameNotice',name,platform,tab);
    assert.match(html,/LAN-only gameplay/); assert.match(html,/Not completely dead/);
  }
  assert.equal(call('guideCheck',line(name,platform),run('settings')),null);
  assert.equal(call('floorResult',cur(name,platform)).r,null);
  run("floor.items = [{name:'Twisted Metal Black Online',platform:'PS2',price:3000,recheck:{price:4000}}];");
  run('printFloorLabels(); printFloorList(); copyFloorList(); useRecheck(floor.items[0]);');
  assert.equal(run('floor.items[0].price'),3000);
});
test('upcoming returning-player caveat is a caution at both checkpoints, not a dead classification', () => {
  for (const tab of ['Trade-In','Pricing']) {
    const html = call('deadGameNotice','Destruction AllStars','PS5',tab);
    assert.match(html,/not confirmed dead/); assert.match(html,/returning players/);
  }
  assert.equal(call('guideCheck',line('Destruction AllStars','PS5'),run('settings')),null);
  assert.ok(call('floorResult',cur('Destruction AllStars','PS5')).r);
});
test('saved prices are retained but held games cannot be exported as shelf labels/list', () => {
  assert.equal(call('deadShelfReady', [{ name: 'Anthem', platform: 'PS4', price: 3000 }]), false);
  assert.equal(call('deadShelfReady', [{ name: 'Evolve', platform: 'PS4', price: 3000 }]), true);
  run("floor.items = [{name:'Anthem', platform:'PS4', price:3000}];");
  run('printFloorLabels(); printFloorList(); copyFloorList();');
  assert.equal(run('floor.items[0].price'), 3000);
});
test('stale saved rechecks cannot change held prices individually or through Use all', () => {
  run("floor.items = [{id:'held', name:'Anthem', platform:'PS4', price:3000, recheck:{price:4000}}, {id:'ok',name:'Evolve',platform:'PS4',price:1000,recheck:{price:2000}}];");
  assert.equal(run('recheckChanged(floor.items[0])'), false);
  assert.equal(run('useRecheck(floor.items[0])'), false);
  assert.equal(run('floor.items[0].price'), 3000);
  assert.ok(!run('recheckHtml(floor.items[0])').includes('data-floor-use'));
  run('useAllRechecks();');
  assert.equal(run('floor.items[0].price'), 3000);
  assert.equal(run('floor.items[1].price'), 2000);
});
test('register UI renders counts, filters, source caveats and custom-policy conflicts safely', () => {
  run("settings.guide.deadGames = ['Evolve']; showDeadGames();");
  assert.match(element('#deadEntries').innerHTML, /Sandstorm/);
  assert.match(element('#deadOverrides').innerHTML, /Conflict with offline-playable evidence/);
  element('#deadSearch').value = 'Evolve'; element('#deadCategory').value = 'offline'; run('showDeadGames();');
  assert.match(element('#deadCount').textContent, /^1 of 28/);
  element('#deadSearch').value = 'impossible'; run('showDeadGames();');
  assert.match(element('#deadEntries').innerHTML, /No entries match/);
  assert.ok(!call('deadGameNotice', '<img src=x onerror=alert(1)>', 'PS4').includes('<img'));
  const title = reg.data.entries[0].title;
  reg.data.entries[0].title = '<img src=x onerror=alert(1)>';
  element('#deadSearch').value = ''; element('#deadCategory').value = ''; run('showDeadGames();');
  assert.ok(element('#deadEntries').innerHTML.includes('&lt;img'));
  assert.ok(!element('#deadEntries').innerHTML.includes('<img'));
  reg.data.entries[0].title = title;
});
test('missing register gives an explicit shelving hold, without rewriting saved prices', () => {
  run('globalThis.P2WDeadGames = undefined;');
  assert.equal(call('deadShelfReady', []), false);
  assert.match(call('deadGameNotice', 'Anthem', 'PS4'), /unavailable/);
  const old = { version: 11, guide: { deadGames: reg.legacy } };
  const deferred = call('mergeSettings', old);
  assert.equal(deferred.version, 11);
  assert.deepEqual(clone(deferred.guide.deadGames), reg.legacy);
});
test('old HTML plus updated app keeps ordinary views and login usable without new markup', () => {
  const original = ctx.document.querySelector;
  ctx.document.querySelector = (s) => ['#view-dead', '#deadSearch'].includes(s) ? null : element(s);
  try {
    run("const keepRender = renderLines, keepFocus = focusScan, keepClear = clearFulcrum; renderLines = () => {}; focusScan = () => {}; clearFulcrum = () => {};");
    run("wireDeadGames(); showView('trade'); showAuth('login'); showView('dead');");
    assert.match(element('#toast').textContent, /Update the shop-PC HTML/);
    run('renderLines = keepRender; focusScan = keepFocus; clearFulcrum = keepClear;');
  } finally { ctx.document.querySelector = original; }
});
console.log(checks + ' Dead Games checks passed.');
