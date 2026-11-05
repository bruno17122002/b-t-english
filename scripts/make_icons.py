"""Generate the Lingua Quest app icon (original artwork) as PNG + multi-size ICO.

Usage: python -I scripts/make_icons.py [output_dir]   (default: build/)
Draws a rounded gradient tile with a stylised open book that turns into a path toward a star.
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def gradient(size, c1, c2):
    img = Image.new("RGBA", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x * 0.55 + y * 0.45) / size
            px[x, y] = lerp(c1, c2, min(1.0, t)) + (255,)
    return img


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def star(cx, cy, r_out, r_in, points=5, rotation=-math.pi / 2):
    pts = []
    for i in range(points * 2):
        r = r_out if i % 2 == 0 else r_in
        a = rotation + i * math.pi / points
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def draw_icon():
    base = gradient(SIZE, (40, 46, 92), (14, 16, 30))
    glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    g.ellipse((180, 120, 860, 760), fill=(124, 140, 255, 90))
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    base = Image.alpha_composite(base, glow)

    d = ImageDraw.Draw(base)
    # Open book (two pages).
    left = [(212, 610), (500, 668), (500, 830), (212, 772)]
    right = [(524, 668), (812, 610), (812, 772), (524, 830)]
    d.polygon(left, fill=(124, 140, 255, 255))
    d.polygon(right, fill=(79, 209, 197, 255))
    d.line([(512, 662), (512, 838)], fill=(236, 238, 246, 255), width=14)
    # Winding path rising from the book.
    # Stamped circles give a smooth stroke without jagged joints.
    for i in range(400):
        t = i / 399
        x = 512 + math.sin(t * math.pi * 1.6) * 120 * (1 - t)
        y = 640 - t * 360
        d.ellipse((x - 17, y - 17, x + 17, y + 17), fill=(236, 238, 246, 255))
    # Star at the end of the path.
    d.polygon(star(512, 236, 112, 48), fill=(255, 193, 94, 255))

    mask = rounded_mask(SIZE, 230)
    out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    out.paste(base, (0, 0), mask)
    return out


def main():
    out_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "build")
    out_dir.mkdir(parents=True, exist_ok=True)
    icon = draw_icon()
    icon.save(out_dir / "icon.png")
    icon.resize((256, 256), Image.LANCZOS).save(
        out_dir / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    )
    print(f"Wrote {out_dir / 'icon.png'} and {out_dir / 'icon.ico'}")


if __name__ == "__main__":
    main()
