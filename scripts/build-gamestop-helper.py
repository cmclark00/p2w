"""Package the reviewed Chrome extension; no local profiles or credentials."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
source = root / 'trade-in' / 'browser-helper'
files = ['manifest.json', 'background.js', 'bridge.js', 'stock-reader.js', 'INSTALL.txt']
with ZipFile(root / 'trade-in' / 'gamestop-stock-helper.zip', 'w', ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(source / name, 'play2win-gamestop-stock-helper/' + name)
print('Built trade-in/gamestop-stock-helper.zip')
