// Signed, self-hosted CRX3 releases. The signing key MUST stay outside this repo.
// Format: https://chromium.googlesource.com/chromium/src/+/HEAD/components/crx_file/crx3.proto
'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const updateUrl = 'https://play2wingames.com/trade-in/helper-updates/updates.xml';
function uint32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; }
function varint(n) { const b = []; do { b.push((n & 127) | (n > 127 ? 128 : 0)); n >>>= 7; } while (n); return Buffer.from(b); }
function field(n, bytes) { return Buffer.concat([varint(n * 8 + 2), varint(bytes.length), bytes]); }
function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest(); }
function extensionId(publicKey) { return [...sha(publicKey).subarray(0, 16).toString('hex')].map(x => String.fromCharCode(97 + parseInt(x, 16))).join(''); }
function pack(zip, key) {
  const publicKey = crypto.createPublicKey(key).export({ type: 'spki', format: 'der' });
  const signed = field(1, sha(publicKey).subarray(0, 16));
  const payload = Buffer.concat([Buffer.from('CRX3 SignedData\0'), uint32(signed.length), signed, zip]);
  const signature = crypto.sign('sha256', payload, key);
  const header = Buffer.concat([field(3, Buffer.concat([field(1, publicKey), field(2, signature)])), field(10000, signed)]);
  return Buffer.concat([Buffer.from('Cr24'), uint32(3), uint32(header.length), header, zip]);
}
// Strict verification is also used by CI on the committed release, without the key.
function fields(b) {
  const out = new Map(); let pos = 0;
  function number() { let n = 0, shift = 0; for (;;) { if (pos >= b.length || shift > 28) throw Error('Invalid protobuf'); const c = b[pos++]; n += (c & 127) * 2 ** shift; if (!(c & 128)) return n; shift += 7; } }
  while (pos < b.length) {
    const tag = number(), length = number();
    if ((tag & 7) !== 2 || pos + length > b.length || out.has(tag >>> 3)) throw Error('Invalid CRX header');
    out.set(tag >>> 3, b.subarray(pos, pos + length)); pos += length;
  }
  return out;
}
function verify(crx) {
  if (crx.length < 12 || crx.subarray(0, 4).toString() !== 'Cr24' || crx.readUInt32LE(4) !== 3) throw Error('Not CRX3');
  const end = 12 + crx.readUInt32LE(8);
  if (end >= crx.length) throw Error('Truncated CRX');
  const header = fields(crx.subarray(12, end)), proof = fields(header.get(3)), signed = header.get(10000), zip = crx.subarray(end);
  const publicKey = proof.get(1), id = fields(signed).get(1);
  if (!id.equals(sha(publicKey).subarray(0, 16))) throw Error('Wrong extension identity');
  const key = crypto.createPublicKey({ key: publicKey, format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails.namedCurve !== 'prime256v1') throw Error('Wrong signing algorithm');
  if (!crypto.verify('sha256', Buffer.concat([Buffer.from('CRX3 SignedData\0'), uint32(signed.length), signed, zip]), key, proof.get(2))) throw Error('Invalid package signature');
  return { id: extensionId(publicKey), zip };
}
function privatePath(p) {
  const resolved = path.resolve(p), parent = fs.realpathSync(path.dirname(resolved));
  const actual = path.join(parent, path.basename(resolved));
  if (!path.relative(root, actual).startsWith('..' + path.sep)) throw Error('Signing key must be outside the repository');
  return actual;
}
function build(keyPath) {
  const key = crypto.createPrivateKey(fs.readFileSync(privatePath(keyPath)));
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails.namedCurve !== 'prime256v1') throw Error('Use a P-256 signing key');
  const source = path.join(root, 'trade-in/browser-helper');
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json')));
  manifest.update_url = updateUrl;
  const version = manifest.version;
  if (!/^\d+(\.\d+){1,3}$/.test(version)) throw Error('Invalid version');
  const names = ['background.js', 'bridge.js', 'stock-reader.js', 'ebay-background.js', 'ebay-reader.js', ...Object.values(manifest.icons)];
  const publicKey = crypto.createPublicKey(key).export({ type: 'spki', format: 'der' }), id = extensionId(publicKey);
  const out = path.join(root, 'trade-in/helper-updates'); fs.mkdirSync(out, { recursive: true });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'p2w-managed-helper-'));
  try {
    const files = { 'manifest.json': JSON.stringify(manifest, null, 2) + '\n' };
    for (const name of names) {
      if (name.includes('..') || path.isAbsolute(name)) throw Error('Invalid package filename');
      const bytes = fs.readFileSync(path.join(source, name));
      // Git may check out JS with CRLF on Windows and LF in CI. Ship stable LF.
      files[name] = (name.endsWith('.js') ? Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n')) : bytes).toString('base64');
    }
    fs.writeFileSync(path.join(temp, 'files.json'), JSON.stringify(files));
    const py = spawnSync(process.env.PYTHON || 'python', ['-c',
      "import sys,json,base64,zipfile; from pathlib import Path; p=Path(sys.argv[1]); files=json.loads((p/'files.json').read_text()); z=zipfile.ZipFile(p/'package.zip','w'); [(z.writestr(zipfile.ZipInfo(n,(2020,1,1,0,0,0)),v.encode() if n=='manifest.json' else base64.b64decode(v))) for n,v in sorted(files.items())]; z.close()", temp], { encoding: 'utf8' });
    if (py.status !== 0) throw Error(py.stderr || 'Python ZIP build failed');
    const zip = fs.readFileSync(path.join(temp, 'package.zip')), sourceSha256 = sha(zip).toString('hex');
    const releasePath = path.join(out, 'release.json');
    if (fs.existsSync(releasePath)) {
      const previous = JSON.parse(fs.readFileSync(releasePath));
      if (previous.id !== id) throw Error('Wrong signing key: extension ID would change');
      if (previous.version === version) {
        if (previous.sourceSha256 !== sourceSha256) throw Error('Increment manifest.version before releasing changed code');
        const old = fs.readFileSync(path.join(out, previous.file));
        if (verify(old).id !== id || sha(old).toString('hex') !== previous.sha256) throw Error('Existing release corrupted');
        console.log(`Managed helper ${version} already built (${id})`); return;
      }
      const a = version.split('.').map(Number), b = previous.version.split('.').map(Number);
      const diff = Array.from({ length: 4 }, (_, i) => (a[i] || 0) - (b[i] || 0)).find(x => x);
      if (!(diff > 0)) throw Error('Version must increase');
    }
    const crx = pack(zip, key); if (verify(crx).id !== id) throw Error('Signature check failed');
    const file = `helper-${version}.crx`;
    fs.writeFileSync(path.join(out, file), crx, { flag: 'wx' });
    fs.writeFileSync(releasePath, JSON.stringify({ id, version, file, updateUrl, sha256: sha(crx).toString('hex'), sourceSha256 }, null, 2) + '\n');
    fs.writeFileSync(path.join(out, 'updates.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0"><app appid="${id}"><updatecheck codebase="https://play2wingames.com/trade-in/helper-updates/package.php?v=${version}" version="${version}" /></app></gupdate>\n`);
    console.log(`Built managed helper ${version}; extension ID ${id}`);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
if (require.main === module) {
  try {
    const [option, filename] = process.argv.slice(2);
    if (!filename || !['--init-key', '--key'].includes(option)) throw Error('Usage: node scripts/build-managed-helper.cjs --init-key OUTSIDE_REPO.pem | --key OUTSIDE_REPO.pem');
    if (option === '--init-key') {
      const keyPath = privatePath(filename);
      const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      fs.writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
      console.log('Created private signing key outside repository. Back it up securely; never upload it.');
    } else build(filename);
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { pack, verify, build, updateUrl };
