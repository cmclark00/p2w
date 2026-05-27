"""Replace the old wordmark on assets/og-image.jpg with the new Play2Win logo.

The existing OG share card (1200x630) keeps its mascot, body text,
tagline, and bottom red bar — only the top-left logo block changes.
Paints the old-logo region with the cream background color, then pastes
assets/play-to-win-logo.png scaled to fit, left-aligned and vertically
centered in the same block.
"""
from PIL import Image
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OG = ROOT / "assets" / "og-image.jpg"
NEW_LOGO = ROOT / "assets" / "play-to-win-logo.png"

BG = (245, 244, 239)
LOGO_BOX = (70, 95, 640, 200)
TARGET_H = 112

og = Image.open(OG).convert("RGB")
logo = Image.open(NEW_LOGO).convert("RGBA")

# Wipe old wordmark
from PIL import ImageDraw
ImageDraw.Draw(og).rectangle(LOGO_BOX, fill=BG)

# Scale new logo to TARGET_H keeping aspect
scale = TARGET_H / logo.height
new_w = round(logo.width * scale)
logo_resized = logo.resize((new_w, TARGET_H), Image.LANCZOS)

# Center vertically in the box, left-align with the box's left edge
bx, by, bw, bh = LOGO_BOX[0], LOGO_BOX[1], LOGO_BOX[2] - LOGO_BOX[0], LOGO_BOX[3] - LOGO_BOX[1]
paste_x = bx
paste_y = by + (bh - TARGET_H) // 2

og.paste(logo_resized, (paste_x, paste_y), logo_resized)
og.save(OG, "JPEG", quality=88, optimize=True, progressive=True)
print(f"wrote {OG.relative_to(ROOT)}  {og.size[0]}x{og.size[1]}  "
      f"{OG.stat().st_size // 1024} KB  (logo pasted at "
      f"{paste_x},{paste_y} as {new_w}x{TARGET_H})")
