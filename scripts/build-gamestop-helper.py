"""Package the reviewed Chrome extension; no local profiles or credentials."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import argparse
import json

root = Path(__file__).resolve().parents[1]
source = root / 'trade-in' / 'browser-helper'
files = ['manifest.json', 'background.js', 'bridge.js', 'stock-reader.js', 'ebay-background.js', 'ebay-reader.js', 'ebay-search-background.js', 'ebay-search-reader.js', 'EBAY-UPDATE.txt']
manifest = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
files += list(manifest['icons'].values())
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--store-output', type=Path, help='Also create a Chrome Web Store ZIP with manifest.json at its root.')
args = parser.parse_args()
with ZipFile(root / 'trade-in' / 'gamestop-stock-helper.zip', 'w', ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(source / name, 'play2win-gamestop-stock-helper/' + name)
    archive.writestr('play2win-gamestop-stock-helper/INSTALL.txt', (source / 'EBAY-UPDATE.txt').read_text(encoding='utf-8'))
print('Built trade-in/gamestop-stock-helper.zip')
if args.store_output:
    args.store_output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(args.store_output, 'w', ZIP_DEFLATED) as archive:
        for name in files:
            if name.endswith('.txt'):
                continue
            archive.write(source / name, name)
    print(f'Built Chrome Web Store package: {args.store_output}')
