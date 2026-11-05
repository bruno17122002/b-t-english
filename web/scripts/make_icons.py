"""Resize build/icon.png into the PWA icons under web/public/icons/.

Usage (from the repo root): python -I web/scripts/make_icons.py
- icon-192.png, icon-512.png: the app icon as is ("any" purpose)
- maskable-512.png: icon scaled into the 80 % safe zone on the #202020 theme background
- apple-touch-icon.png: 180 px, opaque background (iOS ignores transparency)
"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(sys.argv[0]).resolve().parents[2]
SRC = ROOT / "build" / "icon.png"
OUT = ROOT / "web" / "public" / "icons"
BG = (32, 32, 32, 255)


def fit(img, size):
    return img.resize((size, size), Image.LANCZOS)


def on_background(img, size, scale):
    canvas = Image.new("RGBA", (size, size), BG)
    inner = int(size * scale)
    icon = fit(img, inner)
    off = (size - inner) // 2
    canvas.alpha_composite(icon, (off, off))
    return canvas


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    src = Image.open(SRC).convert("RGBA")
    fit(src, 192).save(OUT / "icon-192.png", optimize=True)
    fit(src, 512).save(OUT / "icon-512.png", optimize=True)
    on_background(src, 512, 0.8).save(OUT / "maskable-512.png", optimize=True)
    on_background(src, 180, 0.9).convert("RGB").save(OUT / "apple-touch-icon.png", optimize=True)
    print("icons written to", OUT)


if __name__ == "__main__":
    main()
