// Syntax-check both standalone JavaScript and inline scripts in published HTML.

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`JavaScript syntax checks failed:\n\n${failures.join('\n\n')}`);
  process.exit(1);
}

console.log('JavaScript syntax checks passed.');
