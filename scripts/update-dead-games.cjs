/* Reviewed local import only. No network, credentials, saved settings or deployment.
   node scripts/update-dead-games.cjs candidate.json                  (dry run)
   node scripts/update-dead-games.cjs candidate.json --apply --expected SHA256
   node scripts/update-dead-games.cjs --check
*/
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const jsonPath = path.join(root, 'trade-in/dead-games.json');
const jsPath = path.join(root, 'trade-in/dead-games.js');
const reg = require(jsPath);
const digest = (s) => crypto.createHash('sha256').update(s).digest('hex');
function generated(source, data) {
  const start = '  // BEGIN REGISTER DATA\n', end = '  // END REGISTER DATA';
  const a = source.indexOf(start), b = source.indexOf(end);
  if (a < 0 || b < a || source.indexOf(start, a + 1) !== -1) throw new Error('Generated data markers missing or ambiguous');
  return source.slice(0, a) + start + '  const data = ' + JSON.stringify(data, null, 2).replace(/</g, '\\u003c') + ';\n' + source.slice(b);
}
function plan(candidate, current) {
  reg.validate(candidate);
  if (candidate.updatedAt > new Date().toISOString().slice(0, 10)) throw new Error('Snapshot date is in the future');
  const changes = reg.diff(current, candidate);
  if (JSON.stringify(current) === JSON.stringify(candidate)) return changes;
  if (candidate.revision <= current.revision || candidate.updatedAt < current.updatedAt) throw new Error('Revision must increase; snapshot date cannot go backwards');
  const oldEvents = current.changes;
  if (JSON.stringify(candidate.changes.slice(0, oldEvents.length)) !== JSON.stringify(oldEvents)) throw new Error('Preserve the existing review history');
  const events = candidate.changes.slice(oldEvents.length);
  if (!events.length) throw new Error('Append a sourced review-history event');
  for (const change of changes) {
    if (!events.some((e) => e.entryId === change.id || (change.type === 'removed' && e.type === 'correction' && e.summary.includes(change.id)))) {
      throw new Error('Describe changed entry in review history: ' + change.id);
    }
  }
  for (const e of events) {
    if (e.date < current.updatedAt) throw new Error('New review-history events cannot predate the current snapshot');
    if (e.type === 'shutdown') {
      const entry = candidate.entries.find((r) => r.id === e.entryId);
      if (!entry || entry.category !== 'unplayable' || entry.closureDate !== e.date) throw new Error('A new shutdown event must identify its verified exact-edition effective date');
    }
  }
  return changes;
}
function main(args) {
  const raw = fs.readFileSync(jsonPath, 'utf8'), current = reg.validate(JSON.parse(raw));
  const source = fs.readFileSync(jsPath, 'utf8').replace(/\r\n/g, '\n');
  if (JSON.stringify(current) !== JSON.stringify(reg.data) || generated(source, current) !== source) throw new Error('JSON and generated JavaScript differ. Restore a consistent baseline first.');
  if (args[0] === '--check') { console.log('Register schema and bundled snapshot agree: revision ' + current.revision + ', ' + current.entries.length + ' entries.'); return; }
  if (!args[0] || args[0].startsWith('--')) throw new Error('Provide a candidate JSON file or --check');
  if (args.some((s, i) => i > 0 && s.startsWith('--') && !['--apply', '--expected'].includes(s))) throw new Error('Unknown option');
  const input = fs.readFileSync(path.resolve(args[0]));
  if (input.length > 1024 * 1024) throw new Error('Candidate exceeds 1 MiB');
  const candidate = JSON.parse(input.toString('utf8'));
  const changes = plan(candidate, current), hash = digest(raw);
  console.log('Current SHA256: ' + hash);
  console.log('Revision ' + current.revision + ' -> ' + candidate.revision);
  for (const c of changes) console.log(c.type + ': ' + c.id + ' (' + c.title + ')');
  if (!args.includes('--apply')) { console.log('DRY RUN: no files changed. Review all changed evidence and scope before applying with --expected ' + hash); return; }
  if (args[args.indexOf('--expected') + 1] !== hash || !args.includes('--expected')) throw new Error('Expected current SHA256 is required; rerun the dry run');
  if (!changes.length && JSON.stringify(current) === JSON.stringify(candidate)) { console.log('Already current; no files changed.'); return; }
  const lock = jsonPath + '.import-lock';
  const fd = fs.openSync(lock, 'wx');
  try {
    if (digest(fs.readFileSync(jsonPath, 'utf8')) !== hash || fs.readFileSync(jsPath, 'utf8').replace(/\r\n/g, '\n') !== source) throw new Error('Baseline changed during review; rerun dry run');
    // Keep a copy for local rollback if writing either member of the generated pair fails.
    const oldJS = fs.readFileSync(jsPath, 'utf8');
    try {
      fs.writeFileSync(jsonPath, JSON.stringify(candidate, null, 2) + '\n');
      fs.writeFileSync(jsPath, generated(source, candidate));
    } catch (error) {
      fs.writeFileSync(jsonPath, raw); fs.writeFileSync(jsPath, oldJS); throw error;
    }
    console.log('Applied to this local checkout only. Run checks and review the Git diff; nothing was published.');
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { plan, generated };
