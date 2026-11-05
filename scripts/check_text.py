"""Text & font health check for Lingua Quest.

Scans every bundled content file (src/content/**/*.json) and UI source file (src/**/*.ts, *.tsx) for:
  * U+FFFD replacement characters and typical mojibake (UTF-8 decoded as cp1252/latin-1, e.g. "Ã©", "á»", "â€")
  * Vietnamese text that is not NFC-normalised (decomposed diacritics render misplaced in many fonts)
  * invisible / control characters (zero-width, BOM, C0/C1 controls other than \t \n \r)
  * characters the UI font (Segoe UI Variable, Windows 11) cannot display, which would fall back to another font

Usage: python -I scripts/check_text.py [--fonts-dir C:/Windows/Fonts]
Exit code 1 when a problem is found. Only reads files; never modifies anything.
"""
import json
import re
import struct
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOJIBAKE = re.compile(r"Ã[\u0080-\u00ff]|Â[\u0080-\u00bf]|Ä[\u0080-\u00bf]|á»|áº|â€|Æ°|Æ¡")
INVISIBLE = re.compile(r"[\u200b-\u200f\u2028\u2029\u2060-\u2064\ufeff\u00ad]")
CONTROL = re.compile(r"[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]")


# ---------- minimal TrueType cmap reader (formats 4 and 12) ----------
def font_codepoints(path: Path) -> set[int]:
    data = path.read_bytes()
    if data[:4] == b"ttcf":  # collection: use the first font
        (offset,) = struct.unpack_from(">I", data, 12)
    else:
        offset = 0
    num_tables = struct.unpack_from(">H", data, offset + 4)[0]
    cmap_off = None
    for i in range(num_tables):
        tag, _, off, _ = struct.unpack_from(">4sIII", data, offset + 12 + i * 16)
        if tag == b"cmap":
            cmap_off = off
    if cmap_off is None:
        return set()
    n = struct.unpack_from(">H", data, cmap_off + 2)[0]
    cps: set[int] = set()
    for i in range(n):
        pid, eid, sub = struct.unpack_from(">HHI", data, cmap_off + 4 + i * 8)
        if not (pid == 3 and eid in (1, 10)) and pid != 0:
            continue
        st = cmap_off + sub
        fmt = struct.unpack_from(">H", data, st)[0]
        if fmt == 4:
            segx2 = struct.unpack_from(">H", data, st + 6)[0]
            seg = segx2 // 2
            ends = struct.unpack_from(f">{seg}H", data, st + 14)
            starts = struct.unpack_from(f">{seg}H", data, st + 16 + segx2)
            deltas = struct.unpack_from(f">{seg}h", data, st + 16 + 2 * segx2)
            ro_pos = st + 16 + 3 * segx2
            ros = struct.unpack_from(f">{seg}H", data, ro_pos)
            for k in range(seg):
                for c in range(starts[k], ends[k] + 1):
                    if c == 0xFFFF:
                        continue
                    if ros[k] == 0:
                        gid = (c + deltas[k]) & 0xFFFF
                    else:
                        addr = ro_pos + 2 * k + ros[k] + 2 * (c - starts[k])
                        gid = struct.unpack_from(">H", data, addr)[0]
                        if gid:
                            gid = (gid + deltas[k]) & 0xFFFF
                    if gid:
                        cps.add(c)
        elif fmt == 12:
            ngroups = struct.unpack_from(">I", data, st + 12)[0]
            for g in range(ngroups):
                s, e, _ = struct.unpack_from(">III", data, st + 16 + g * 12)
                cps.update(range(s, e + 1))
    return cps


def iter_strings(obj, path=""):
    if isinstance(obj, str):
        yield path, obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield from iter_strings(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from iter_strings(v, f"{path}[{i}]")


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    fonts_dir = Path(sys.argv[sys.argv.index("--fonts-dir") + 1]) if "--fonts-dir" in sys.argv else Path("C:/Windows/Fonts")
    problems: list[str] = []
    used: dict[str, set[str]] = defaultdict(set)  # char -> files

    sources: list[tuple[str, str]] = []
    for f in sorted((ROOT / "src/content").rglob("*.json")):
        rel = f.relative_to(ROOT).as_posix()
        for p, s in iter_strings(json.loads(f.read_text(encoding="utf-8"))):
            sources.append((f"{rel}{p}", s))
    for f in sorted((ROOT / "src").rglob("*")):
        if f.suffix in (".ts", ".tsx", ".css", ".html") and "content" not in f.parts[-2:]:
            rel = f.relative_to(ROOT).as_posix()
            for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
                sources.append((f"{rel}:{n}", line))

    for where, s in sources:
        if "\ufffd" in s:
            problems.append(f"replacement char U+FFFD  {where}")
        m = MOJIBAKE.search(s)
        if m:
            problems.append(f"mojibake {m.group()!r}  {where}: {s[max(0, m.start() - 20): m.end() + 20]!r}")
        if unicodedata.normalize("NFC", s) != s:
            problems.append(f"not NFC (decomposed diacritics)  {where}: {s[:60]!r}")
        # A zero-width joiner between two emoji is part of an emoji sequence (e.g. 👨‍👩‍👧), not an error.
        for m in INVISIBLE.finditer(s):
            i = m.start()
            if m.group() == "‍" and 0 < i < len(s) - 1 and ord(s[i - 1]) > 0x2000 and ord(s[i + 1]) > 0x2000:
                continue
            problems.append(f"invisible char U+{ord(m.group()):04X}  {where}")
        m = CONTROL.search(s)
        if m:
            problems.append(f"control char U+{ord(m.group()):04X}  {where}")
        for ch in s:
            if ord(ch) > 0x7E:
                used[ch].add(where.split(":")[0].split(".json")[0])

    ui_font = fonts_dir / "SegUIVar.ttf"
    if not ui_font.exists():
        ui_font = fonts_dir / "segoeui.ttf"
    ui = font_codepoints(ui_font)
    emoji = font_codepoints(fonts_dir / "seguiemj.ttf") if (fonts_dir / "seguiemj.ttf").exists() else set()
    symbol = font_codepoints(fonts_dir / "seguisym.ttf") if (fonts_dir / "seguisym.ttf").exists() else set()
    print(f"UI font: {ui_font.name} ({len(ui)} code points); {len(used)} distinct non-ASCII characters in use")

    missing = sorted(c for c in used if ord(c) not in ui and unicodedata.category(c) not in ("Cc", "Cf", "Zl", "Zp"))
    for ch in missing:
        files = ", ".join(sorted(used[ch])[:3])
        cp = ord(ch)
        if cp in emoji:
            print(f"  emoji (Segoe UI Emoji)   U+{cp:04X} {ch}  {unicodedata.name(ch, '?')}  [{files}]")
        elif cp in symbol:
            print(f"  symbol (Segoe UI Symbol) U+{cp:04X} {ch}  {unicodedata.name(ch, '?')}  [{files}]")
        else:
            problems.append(f"no Windows font covers U+{cp:04X} {ch} {unicodedata.name(ch, '?')}  [{files}]")

    vietnamese = "ăâđêôơưàảãáạằẳẵắặầẩẫấậèẻẽéẹềểễếệìỉĩíịòỏõóọồổỗốộờởỡớợùủũúụừửữứựỳỷỹýỵ"
    vn_missing = [c for c in vietnamese + vietnamese.upper() if ord(c) not in ui]
    if vn_missing:
        problems.append(f"UI font lacks Vietnamese letters: {''.join(vn_missing)}")
    else:
        print(f"  all {len(vietnamese) * 2} Vietnamese letters (lower + upper) are in {ui_font.name}")

    if problems:
        print(f"\n{len(problems)} problem(s):")
        for p in problems:
            print("  ✗", p)
        return 1
    print("\nOK – no encoding, normalisation, invisible-character or font-coverage problems.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
