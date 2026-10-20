'use strict';
// Render original vector artwork to Chrome's required PNG sizes.
// Run with NODE_PATH pointing to a runtime that includes sharp.
const fs = require('node:fs'), path = require('node:path'), sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const out = process.argv[2];
if (!out || !path.isAbsolute(out)) throw new Error('Pass an absolute private output folder for store promotional assets.');
const mark = '<rect x="16" y="16" width="96" height="96" rx="22" fill="#d51c3c"/><path d="M45 42h38c10 0 15 9 17 23l3 18c1 11-9 16-16 7L77 79H51L41 90c-7 9-17 4-16-7l3-18c2-14 7-23 17-23Z" fill="#fff"/><path d="M41 54v18m-9-9h18" stroke="#242631" stroke-width="6" stroke-linecap="round"/><path d="m66 61 8 8 15-17" fill="none" stroke="#d51c3c" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>';
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">${mark}</svg>`;
async function main() {
  const icons = path.join(root, 'trade-in/browser-helper/icons');
  fs.mkdirSync(icons, {recursive:true}); fs.mkdirSync(out, {recursive:true});
  for (const size of [16,32,48,128]) await sharp(Buffer.from(icon)).resize(size,size).png().toFile(path.join(icons, `icon-${size}.png`));
  fs.copyFileSync(path.join(icons, 'icon-128.png'), path.join(out, 'store-icon-128.png'));
  const promo = `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280"><rect width="440" height="280" fill="#111217"/><circle cx="410" cy="10" r="190" fill="#25202d"/><g transform="translate(24 28) scale(.75)">${mark}</g><text x="130" y="69" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="white">Play2Win</text><text x="130" y="99" font-family="Arial,sans-serif" font-size="23" fill="white">Market Helper</text><path d="M36 146h368" stroke="#434652"/><text x="36" y="184" font-family="Arial,sans-serif" font-size="20" fill="#f4cd51">GameStop stock</text><text x="36" y="218" font-family="Arial,sans-serif" font-size="20" fill="#83bcff">Selected eBay sale checks</text><text x="36" y="254" font-family="Arial,sans-serif" font-size="14" fill="#b7bbc6">A companion to Play2Win floor pricing</text></svg>`;
  await sharp(Buffer.from(promo)).removeAlpha().png().toFile(path.join(out, 'small-promo-440x280.png'));
  console.log('Rendered helper icons and store promotional tile.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
