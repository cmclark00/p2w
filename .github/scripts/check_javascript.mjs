// Syntax-check both standalone JavaScript and inline scripts in published HTML.

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, '..', '..');
const excludedHtml = new Set([
  join(root, 'assets', 'files', 'index.html'),
  join(root, 'team-guide-print.html')
]);
const skippedDirs = new Set(['.git', '_site']);
const tempDir = mkdtempSync(join(tmpdir(), 'p2w-js-check-'));
const failures = [];

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && skippedDirs.has(entry.name)) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function check(path, label) {
  const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  if (result.status !== 0) {
    failures.push(`${label}\n${(result.stderr || result.stdout).trim()}`);
  }
}

function checkPairingsHelpers() {
  try {
    const html = readFileSync(join(root, 'pairings.html'), 'utf8');
    function between(startMarker, endMarker) {
      const start = html.indexOf(startMarker);
      const end = html.indexOf(endMarker, start);
      if (start < 0 || end < 0) throw new Error(`could not extract ${startMarker}`);
      return html.slice(start, end);
    }

    const code = [
      between('function safeImage', 'function setPairingImage'),
      between('function divisionFromName', 'function matchEl'),
      'this.helpers = { pairingImages, divisionFromName, pairingDivision };'
    ].join('\n');
    const context = {};
    runInNewContext(code, context);
    const { pairingImages, pairingDivision } = context.helpers;
    const main = 'data:image/webp;base64,AAAA';
    const junior = 'data:image/jpeg;base64,BBBB';
    const senior = 'data:image/png;base64,CCCC';

    const legacy = pairingImages(main);
    if (legacy.main !== main || legacy.junior || legacy.senior) {
      throw new Error('legacy image payload is not preserved');
    }
    const multi = pairingImages(JSON.stringify({ v: 1, main, junior, senior }));
    if (multi.main !== main || multi.junior !== junior || multi.senior !== senior) {
      throw new Error('multi-division image payload is not parsed');
    }
    if (pairingImages('javascript:alert(1)').main) {
      throw new Error('unsafe image source was accepted');
    }

    const adminHtml = readFileSync(join(root, 'pairings-admin.html'), 'utf8');
    const buildStart = adminHtml.indexOf('function buildImagePayload');
    const buildEnd = adminHtml.indexOf('function recompressImages', buildStart);
    if (buildStart < 0 || buildEnd < 0) throw new Error('could not extract buildImagePayload');
    const adminContext = { compressed: { main: { dataUrl: main }, junior: null, senior: null } };
    runInNewContext(
      adminHtml.slice(buildStart, buildEnd) + '\nthis.buildImagePayload = buildImagePayload;',
      adminContext
    );
    if (adminContext.buildImagePayload() !== main) {
      throw new Error('single-photo publish no longer uses the legacy payload');
    }
    adminContext.compressed.junior = { dataUrl: junior };
    adminContext.compressed.senior = { dataUrl: senior };
    const builtMulti = pairingImages(adminContext.buildImagePayload());
    if (builtMulti.main !== main || builtMulti.junior !== junior || builtMulti.senior !== senior) {
      throw new Error('admin multi-photo payload does not round-trip through the player parser');
    }

    const cases = [
      [{ p1: 'A (1/0/0 - JR)', p2: 'B (1/0/0 - JR)' }, 'junior'],
      [{ p1: 'A (1/0/0 - SR)', p2: 'B (1/0/0 - SR)' }, 'senior'],
      [{ p1: 'A (1/0/0 - MA)', p2: 'B (1/0/0 - MA)' }, 'masters'],
      [{ p1: 'John Smith Jr.', p2: 'Bob Jones' }, 'open'],
      [{ p1: 'A (1/0/0 - JR)', p2: 'B (1/0/0 - SR)' }, 'open']
    ];
    cases.forEach(([pair, expected]) => {
      const actual = pairingDivision(pair);
      if (actual !== expected) throw new Error(`expected ${expected}, got ${actual}`);
    });

    class FakeElement {
      constructor(tagName) {
        this.tagName = tagName;
        this.children = [];
        this.dataset = {};
        this.attributes = {};
        this.hidden = false;
      }
      appendChild(child) { this.children.push(child); return child; }
      setAttribute(name, value) { this.attributes[name] = value; }
      set innerHTML(value) { if (value === '') this.children = []; }
    }
    const matchesRoot = new FakeElement('div');
    const renderContext = {
      document: { createElement: (tagName) => new FakeElement(tagName) },
      $matches: matchesRoot
    };
    runInNewContext(
      between('function playerEl', "$search.addEventListener('input'") +
        '\nthis.renderRows = renderRows;',
      renderContext
    );
    renderContext.renderRows([
      { table: 1, p1: 'A (1/0/0 - JR)', p2: 'B (1/0/0 - JR)' },
      { table: 2, p1: 'C (1/0/0 - SR)', p2: 'D (1/0/0 - SR)' },
      { table: 3, p1: 'E (1/0/0 - MA)', p2: 'F (1/0/0 - MA)' },
      { table: 4, p1: 'G', p2: 'H' }
    ]);
    if (matchesRoot.children.map((section) => section.dataset.division).join(',') !==
        'junior,senior,masters') {
      throw new Error('division sections were not rendered in the expected order');
    }
    if (matchesRoot.children[2].children[1].children.length !== 2) {
      throw new Error('Masters / Open section did not preserve unmarked rows');
    }
    renderContext.renderRows([{ table: 1, p1: 'A', p2: 'B' }]);
    if (matchesRoot.children.length !== 1 || matchesRoot.children[0].tagName !== 'ul') {
      throw new Error('events without age divisions no longer render as a flat list');
    }
  } catch (error) {
    failures.push(`pairings helper checks\n${error.message}`);
  }
}

try {
  const files = walk(root);
  files.filter((path) => extname(path) === '.js').forEach((path) => {
    check(path, relative(root, path));
  });

  files
    .filter((path) => extname(path) === '.html' && !excludedHtml.has(path))
    .forEach((path) => {
      const html = readFileSync(path, 'utf8');
      const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
      let match;
      let index = 0;
      while ((match = pattern.exec(html)) !== null) {
        const attrs = match[1];
        const code = match[2];
        if (/\bsrc\s*=/i.test(attrs) || /\btype\s*=\s*["']application\/ld\+json["']/i.test(attrs)) {
          continue;
        }
        index += 1;
        const moduleScript = /\btype\s*=\s*["']module["']/i.test(attrs);
        const tempPath = join(tempDir, `inline-${failures.length}-${index}.${moduleScript ? 'mjs' : 'js'}`);
        writeFileSync(tempPath, code, 'utf8');
        check(tempPath, `${relative(root, path)} inline script ${index}`);
      }
    });

  checkPairingsHelpers();
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`JavaScript syntax checks failed:\n\n${failures.join('\n\n')}`);
  process.exit(1);
}

console.log('JavaScript syntax and pairings helper checks passed.');
