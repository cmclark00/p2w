'use strict';
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const fs = require('node:fs'), { spawnSync } = require('node:child_process');
const { pack, verify, updateUrl } = require('./build-managed-helper.cjs');
const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const sample = pack(Buffer.from('sample archive'), privateKey);
assert.equal(verify(sample).zip.toString(), 'sample archive');
const altered = Buffer.from(sample); altered[altered.length - 1] ^= 1;
assert.throws(() => verify(altered), /signature/);
assert.throws(() => verify(sample.subarray(0, 20)));
assert.throws(() => verify(Buffer.from('not a CRX')));
const base = 'trade-in/helper-updates/', release = JSON.parse(fs.readFileSync(base + 'release.json'));
const bytes = fs.readFileSync(base + release.file), checked = verify(bytes);
assert.equal(checked.id, release.id);
assert.equal(release.updateUrl, updateUrl);
assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), release.sha256);
assert.equal(crypto.createHash('sha256').update(checked.zip).digest('hex'), release.sourceSha256);
const xml = fs.readFileSync(base + 'updates.xml', 'utf8');
assert.ok(xml.includes(`appid="${release.id}"`));
assert.ok(xml.includes(`version="${release.version}"`));
assert.ok(xml.includes(`package.php?v=${release.version}`));
const setup = fs.readFileSync('trade-in/helper-setup.html', 'utf8');
assert.ok(setup.includes(release.id) && setup.includes(updateUrl));
// Read the archive with an independent ZIP implementation and compare every runtime
// byte to source. Catch stale packages, leaked files and unintended permission changes.
const result = spawnSync(process.env.PYTHON || 'python', ['-c', `
import sys,io,json,zipfile,xml.etree.ElementTree as ET
from pathlib import Path
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
source=Path('trade-in/browser-helper')
m=json.loads((source/'manifest.json').read_text())
m['update_url']='${updateUrl}'
assert json.loads(z.read('manifest.json'))==m
assert m['version']=='${release.version}'
names=['background.js','bridge.js','stock-reader.js','ebay-background.js','ebay-reader.js',*m['icons'].values()]
assert set(z.namelist())=={'manifest.json',*names}
for name in names:
    expected=(source/name).read_bytes()
    if name.endswith('.js'): expected=expected.replace(b'\\r\\n',b'\\n')
    assert z.read(name)==expected, name
ET.parse('trade-in/helper-updates/updates.xml')
print('Signed package, identity, update feed and runtime contents verified.')
`], { input: checked.zip, encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
console.log(result.stdout.trim());
for (const filename of ['trade-in/index.html', 'trade-in/app.js']) {
  assert.ok(!fs.readFileSync(filename, 'utf8').includes('chromewebstore.google.com'), 'Old Store promotion remains');
}
console.log('Managed helper tests passed; modified and truncated packages rejected.');
