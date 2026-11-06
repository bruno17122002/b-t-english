"""Build the Windows icon (build/icon.ico) from the rendered logo (build/icon.png).

The logo source is build/logo.svg (original artwork). Render it first:
    npx electron --force-device-scale-factor=1 scripts/render_logo.cjs
then run:
    python -I scripts/make_icons.py [build_dir]   (default: build/)
"""
import sys
from pathlib import Path

from PIL import Image

ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def main():
    build = Path(sys.argv[1] if len(sys.argv) > 1 else "build")
    icon = Image.open(build / "icon.png").convert("RGBA")
    if icon.size != (1024, 1024):
        sys.exit(f"expected a 1024x1024 icon.png, got {icon.size}")
    icon.resize((256, 256), Image.LANCZOS).save(build / "icon.ico", sizes=ICO_SIZES)
    print(f"Wrote {build / 'icon.ico'}")


if __name__ == "__main__":
    main()
