"""Convert assets/logo.jpg to a transparent, trimmed PNG.

White-to-alpha via min-channel, then unmultiply white from RGB so glyph
edges don't ring with white fringe on the dark header. Auto-trims any
fully-transparent borders.
"""
from PIL import Image
import numpy as np
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "logo.jpg"
DST = ROOT / "assets" / "play-to-win-logo.png"

img = Image.open(SRC).convert("RGB")
arr = np.array(img).astype(np.float32)
r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]

min_ch = np.minimum(np.minimum(r, g), b)
alpha = 255.0 - min_ch                       # white -> 0, black -> 255
a_norm = np.clip(alpha / 255.0, 1e-3, 1.0)   # avoid div-by-zero

# Unmultiply white background: orig = white*(1-a) + true*a  ->  true = (orig - 255*(1-a)) / a
out = np.empty(arr.shape + (), dtype=np.float32)
out = np.dstack([
    (arr[..., 0] - 255.0 * (1 - a_norm)) / a_norm,
    (arr[..., 1] - 255.0 * (1 - a_norm)) / a_norm,
    (arr[..., 2] - 255.0 * (1 - a_norm)) / a_norm,
    alpha,
])
out = np.clip(out, 0, 255).astype(np.uint8)

png = Image.fromarray(out, "RGBA")
bbox = png.getbbox()
if bbox:
    png = png.crop(bbox)

png.save(DST, "PNG", optimize=True)
print(f"wrote {DST.relative_to(ROOT)}  {png.size[0]}x{png.size[1]}  {DST.stat().st_size // 1024} KB")
