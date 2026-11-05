"""Validate Lingua Quest content files (author A set).

Mirrors the zod schemas in src/shared/content.ts plus the authoring rules for:
  reading.json, listening.json, grammar.json, writing-prompts.json, speaking-prompts.json

Run with:  python -I scripts/validate_content_a.py
Exit code 0 = all good, 1 = errors found.
"""
import json
import os
import re
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT = os.path.join(ROOT, "src", "content")

ID_RE = re.compile(r"^[a-z0-9-]+$")
CEFR = {"A1", "A2", "B1", "B2", "C1", "C2"}
READING_CATEGORIES = ["short-story", "article", "news", "science", "technology", "business",
                      "psychology", "philosophy", "fiction"]
ACCENTS = {"en-US", "en-GB", "en-AU"}
TRACK_KINDS = {"dialogue", "monologue", "announcement"}
WRITING_TYPES = ["sentence", "grammar", "paragraph", "journal", "email", "business", "essay",
                 "creative", "free"]
SPEAKING_KINDS = ["shadowing", "repeat", "roleplay", "real-world", "challenge", "ielts"]
TFNG = ["True", "False", "Not Given"]
# Letters that only occur in Vietnamese text (with diacritics); used to check *Vi fields really are Vietnamese.
VI_CHARS = set("ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ")

errors = []
stats = {}


def err(where, msg):
    errors.append(f"{where}: {msg}")


def is_str(v):
    return isinstance(v, str) and len(v.strip()) > 0


def is_int(v):
    return type(v) is int


def looks_vietnamese(s):
    return any(ch in VI_CHARS for ch in s.lower())


def check_keys(where, obj, required, optional=()):
    if not isinstance(obj, dict):
        err(where, "must be an object")
        return False
    for k in required:
        if k not in obj:
            err(where, f"missing field '{k}'")
    extra = set(obj) - set(required) - set(optional)
    if extra:
        err(where, f"unexpected field(s) {sorted(extra)}")
    return True


def check_strs(where, obj, fields):
    for f in fields:
        if f in obj and not is_str(obj[f]):
            err(where, f"'{f}' must be a non-empty string")


def check_vi(where, obj, fields):
    for f in fields:
        if is_str(obj.get(f)) and not looks_vietnamese(obj[f]):
            err(where, f"'{f}' does not look like Vietnamese with diacritics")


def check_id(where, value, seen):
    if not isinstance(value, str) or not ID_RE.match(value):
        err(where, f"id {value!r} does not match ^[a-z0-9-]+$")
    if value in seen:
        err(where, f"duplicate id {value!r}")
    seen.add(value)


def check_cefr(where, value, optional=False):
    if value is None and optional:
        return
    if value not in CEFR:
        err(where, f"invalid cefr {value!r}")


def check_question(where, q, qids):
    if not check_keys(where, q, ["id", "type", "prompt", "options", "answerIndex", "explanation"]):
        return
    check_strs(where, q, ["id", "prompt", "explanation"])
    if q.get("id") in qids:
        err(where, f"duplicate question id {q.get('id')!r}")
    qids.add(q.get("id"))
    if q.get("type") not in ("mcq", "true-false-ng"):
        err(where, f"invalid question type {q.get('type')!r}")
    opts = q.get("options")
    if not isinstance(opts, list) or not (2 <= len(opts) <= 5) or not all(is_str(o) for o in opts):
        err(where, "options must be 2-5 non-empty strings")
        opts = opts if isinstance(opts, list) else []
    elif len(set(opts)) != len(opts):
        err(where, "duplicate options")
    ai = q.get("answerIndex")
    if not is_int(ai) or ai < 0 or ai >= len(opts):
        err(where, f"answerIndex {ai!r} out of range for {len(opts)} options")
    if q.get("type") == "true-false-ng" and opts != TFNG:
        err(where, f"true-false-ng options must be exactly {TFNG}")
    check_vi(where, q, ["explanation"])


def check_glossary_entry(where, g):
    if not check_keys(where, g, ["word", "ipa", "pos", "meaningVi", "meaningEn", "example"], ["cefr"]):
        return
    check_strs(where, g, ["word", "ipa", "pos", "meaningVi", "meaningEn", "example"])
    ipa = g.get("ipa", "")
    if is_str(ipa) and not (ipa.startswith("/") and ipa.endswith("/") and len(ipa) > 2):
        err(where, f"ipa {ipa!r} must be wrapped in slashes")
    if "cefr" in g:
        check_cefr(where, g["cefr"])


def word_in_text(word, text):
    """Lenient check that a glossary headword (or an inflected form) occurs in the text."""
    w, t = word.lower(), text.lower()
    if w in t:
        return True
    # inflections such as hurry->hurried, recognise->recognised, heavy->heavier
    return len(w) >= 4 and w[:-1] in t


def load(name):
    path = os.path.join(CONTENT, name)
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except OSError as e:
        err(name, f"cannot read file: {e}")
        return None
    if raw.startswith(b"\xef\xbb\xbf"):
        err(name, "file starts with a UTF-8 BOM")
        raw = raw[3:]
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        err(name, f"invalid JSON: {e}")
        return None
    if not isinstance(data, list):
        err(name, "top level must be a JSON array")
        return None
    return data


def word_count(s):
    return len(s.split())


# ---------------------------------------------------------------- reading
def validate_reading():
    name = "reading.json"
    data = load(name)
    if data is None:
        return
    seen, qids = set(), set()
    cats, levels, lengths = Counter(), Counter(), []
    for i, p in enumerate(data):
        where = f"{name}[{i}:{p.get('id', '?') if isinstance(p, dict) else '?'}]"
        if not check_keys(where, p, ["id", "title", "category", "cefr", "topicTags", "summaryVi", "body",
                                     "questions", "glossary"]):
            continue
        check_id(where, p.get("id"), seen)
        check_strs(where, p, ["title", "summaryVi", "body"])
        check_vi(where, p, ["summaryVi"])
        check_cefr(where, p.get("cefr"))
        levels[p.get("cefr")] += 1
        if p.get("category") not in READING_CATEGORIES:
            err(where, f"invalid category {p.get('category')!r}")
        cats[p.get("category")] += 1
        tags = p.get("topicTags")
        if not isinstance(tags, list) or len(tags) < 1 or not all(isinstance(t, str) for t in tags):
            err(where, "topicTags must be a non-empty list of strings")
        body = p.get("body") if isinstance(p.get("body"), str) else ""
        if len(body) < 200:
            err(where, f"body has {len(body)} chars (< 200)")
        if "\n\n" not in body:
            err(where, "body should have paragraphs separated by \\n\\n")
        lengths.append((p.get("id"), p.get("cefr"), word_count(body)))
        qs = p.get("questions")
        if not isinstance(qs, list) or not (3 <= len(qs) <= 5):
            err(where, "questions must have 3-5 items")
        else:
            for j, q in enumerate(qs):
                check_question(f"{where}.questions[{j}]", q, qids)
            if not any(q.get("type") == "true-false-ng" for q in qs) or not any(q.get("type") == "mcq" for q in qs):
                err(where, "questions should mix mcq and true-false-ng")
        gl = p.get("glossary")
        if not isinstance(gl, list) or not (5 <= len(gl) <= 8):
            err(where, "glossary must have 5-8 entries")
        else:
            words = set()
            for j, g in enumerate(gl):
                gw = f"{where}.glossary[{j}]"
                check_glossary_entry(gw, g)
                w = g.get("word", "") if isinstance(g, dict) else ""
                if is_str(w):
                    if w.lower() in words:
                        err(gw, f"duplicate glossary word {w!r}")
                    words.add(w.lower())
                    if not word_in_text(w, body):
                        err(gw, f"glossary word {w!r} does not appear in body")
    if len(data) < 18:
        err(name, f"needs at least 18 passages, has {len(data)}")
    for c in READING_CATEGORIES:
        if cats[c] != 2:
            err(name, f"category {c!r} has {cats[c]} passages (expected exactly 2)")
    stats[name] = {"count": len(data), "levels": dict(sorted(levels.items())),
                   "words": [f"{i} ({c}): {n}" for i, c, n in lengths]}


# ---------------------------------------------------------------- listening
def validate_listening():
    name = "listening.json"
    data = load(name)
    if data is None:
        return
    seen, qids = set(), set()
    levels, accents, kinds = Counter(), Counter(), Counter()
    for i, t in enumerate(data):
        where = f"{name}[{i}:{t.get('id', '?') if isinstance(t, dict) else '?'}]"
        if not check_keys(where, t, ["id", "title", "cefr", "topic", "accent", "kind", "speakers", "lines",
                                     "questions", "keyVocabulary"]):
            continue
        check_id(where, t.get("id"), seen)
        check_strs(where, t, ["title", "topic"])
        check_cefr(where, t.get("cefr"))
        levels[t.get("cefr")] += 1
        if t.get("accent") not in ACCENTS:
            err(where, f"invalid accent {t.get('accent')!r}")
        accents[t.get("accent")] += 1
        if t.get("kind") not in TRACK_KINDS:
            err(where, f"invalid kind {t.get('kind')!r}")
        kinds[t.get("kind")] += 1
        speakers = t.get("speakers")
        sids = set()
        if not isinstance(speakers, list) or len(speakers) < 1:
            err(where, "speakers must have at least 1 entry")
        else:
            for j, s in enumerate(speakers):
                sw = f"{where}.speakers[{j}]"
                if check_keys(sw, s, ["id", "name", "gender"]):
                    check_strs(sw, s, ["id", "name"])
                    if s.get("gender") not in ("female", "male"):
                        err(sw, f"invalid gender {s.get('gender')!r}")
                    if s.get("id") in sids:
                        err(sw, f"duplicate speaker id {s.get('id')!r}")
                    sids.add(s.get("id"))
        lines = t.get("lines")
        if not isinstance(lines, list) or not (6 <= len(lines) <= 14):
            err(where, "lines must have 6-14 entries")
        else:
            used = set()
            for j, ln in enumerate(lines):
                lw = f"{where}.lines[{j}]"
                if check_keys(lw, ln, ["speaker", "text", "translationVi"]):
                    check_strs(lw, ln, ["speaker", "text", "translationVi"])
                    check_vi(lw, ln, ["translationVi"])
                    if ln.get("speaker") not in sids:
                        err(lw, f"speaker {ln.get('speaker')!r} not in speakers")
                    used.add(ln.get("speaker"))
                    if is_str(ln.get("text")) and word_count(ln["text"]) > 25:
                        err(lw, f"line has {word_count(ln['text'])} words (> 25)")
            unused = sids - used
            if unused:
                err(where, f"speakers never used in lines: {sorted(unused)}")
        qs = t.get("questions")
        if not isinstance(qs, list) or not (3 <= len(qs) <= 5):
            err(where, "questions must have 3-5 items")
        else:
            for j, q in enumerate(qs):
                check_question(f"{where}.questions[{j}]", q, qids)
        kv = t.get("keyVocabulary")
        if not isinstance(kv, list) or not (3 <= len(kv) <= 6):
            err(where, "keyVocabulary must have 3-6 entries")
        else:
            for j, g in enumerate(kv):
                check_glossary_entry(f"{where}.keyVocabulary[{j}]", g)
    if len(data) < 12:
        err(name, f"needs at least 12 tracks, has {len(data)}")
    for a in ACCENTS:
        if accents[a] == 0:
            err(name, f"no tracks with accent {a}")
    stats[name] = {"count": len(data), "levels": dict(sorted(levels.items())),
                   "accents": dict(sorted(accents.items())), "kinds": dict(sorted(kinds.items()))}


# ---------------------------------------------------------------- grammar
def validate_grammar():
    name = "grammar.json"
    data = load(name)
    if data is None:
        return
    seen, eids = set(), set()
    levels = Counter()
    order = ["A1", "A2", "B1", "B2", "C1", "C2"]
    prev = 0
    for i, g in enumerate(data):
        where = f"{name}[{i}:{g.get('id', '?') if isinstance(g, dict) else '?'}]"
        if not check_keys(where, g, ["id", "title", "cefr", "summaryEn", "explanationVi", "patterns", "examples",
                                     "commonMistakes", "exercises"]):
            continue
        check_id(where, g.get("id"), seen)
        check_strs(where, g, ["title", "summaryEn", "explanationVi"])
        check_vi(where, g, ["explanationVi"])
        check_cefr(where, g.get("cefr"))
        levels[g.get("cefr")] += 1
        if g.get("cefr") in order:
            lvl = order.index(g["cefr"])
            if lvl < prev:
                err(where, f"topics are not in learning order ({g['cefr']} after {order[prev]})")
            prev = max(prev, lvl)
        pats = g.get("patterns")
        if not isinstance(pats, list) or len(pats) < 1 or not all(is_str(x) for x in pats):
            err(where, "patterns must be a non-empty list of strings")
        exs = g.get("examples")
        if not isinstance(exs, list) or len(exs) < 2:
            err(where, "examples must have at least 2 entries")
        else:
            for j, e in enumerate(exs):
                ew = f"{where}.examples[{j}]"
                if check_keys(ew, e, ["en", "vi"]):
                    check_strs(ew, e, ["en", "vi"])
                    check_vi(ew, e, ["vi"])
        cms = g.get("commonMistakes")
        if not isinstance(cms, list) or len(cms) < 1:
            err(where, "commonMistakes must have at least 1 entry")
        else:
            for j, c in enumerate(cms):
                cw = f"{where}.commonMistakes[{j}]"
                if check_keys(cw, c, ["wrong", "right", "why"]):
                    check_strs(cw, c, ["wrong", "right", "why"])
                    check_vi(cw, c, ["why"])
        exercises = g.get("exercises")
        if not isinstance(exercises, list) or len(exercises) < 6:
            err(where, "exercises must have at least 6 entries")
            continue
        types = Counter()
        for j, e in enumerate(exercises):
            xw = f"{where}.exercises[{j}]"
            if not check_keys(xw, e, ["id", "type", "prompt", "answer", "explanation"], ["options"]):
                continue
            check_strs(xw, e, ["id", "prompt", "answer", "explanation"])
            check_vi(xw, e, ["explanation"])
            if e.get("id") in eids:
                err(xw, f"duplicate exercise id {e.get('id')!r}")
            eids.add(e.get("id"))
            typ = e.get("type")
            types[typ] += 1
            opts = e.get("options", [])
            if not isinstance(opts, list) or not all(isinstance(o, str) for o in opts):
                err(xw, "options must be a list of strings")
                opts = []
            if typ == "mcq":
                if len(opts) < 2:
                    err(xw, "mcq needs at least 2 options")
                if e.get("answer") not in opts:
                    err(xw, f"mcq answer {e.get('answer')!r} is not one of the options")
                if len(set(opts)) != len(opts):
                    err(xw, "duplicate options")
            elif typ == "gap":
                if "___" not in str(e.get("prompt", "")):
                    err(xw, "gap prompt must contain '___'")
                if opts and e.get("answer") not in opts:
                    err(xw, "gap answer must be one of the options when options are given")
            else:
                err(xw, f"invalid exercise type {typ!r}")
        if types["mcq"] == 0 or types["gap"] == 0:
            err(where, "exercises should mix mcq and gap")
    if len(data) < 16:
        err(name, f"needs at least 16 topics, has {len(data)}")
    stats[name] = {"count": len(data), "levels": dict(sorted(levels.items())),
                   "exercises": sum(len(g.get("exercises", [])) for g in data if isinstance(g, dict))}


# ---------------------------------------------------------------- writing
def validate_writing():
    name = "writing-prompts.json"
    data = load(name)
    if data is None:
        return
    seen = set()
    levels, types = Counter(), Counter()
    for i, w in enumerate(data):
        where = f"{name}[{i}:{w.get('id', '?') if isinstance(w, dict) else '?'}]"
        if not check_keys(where, w, ["id", "taskType", "cefr", "title", "instructions", "instructionsVi",
                                     "minWords", "maxWords"], ["hints"]):
            continue
        check_id(where, w.get("id"), seen)
        check_strs(where, w, ["title", "instructions", "instructionsVi"])
        check_vi(where, w, ["instructionsVi"])
        check_cefr(where, w.get("cefr"))
        levels[w.get("cefr")] += 1
        tt = w.get("taskType")
        if tt not in WRITING_TYPES:
            err(where, f"invalid taskType {tt!r}")
        types[tt] += 1
        mn, mx = w.get("minWords"), w.get("maxWords")
        if not is_int(mn) or mn < 1 or not is_int(mx) or mx < 1:
            err(where, "minWords/maxWords must be integers >= 1")
        elif mn > mx:
            err(where, f"minWords {mn} > maxWords {mx}")
        elif tt == "essay" and mn < 250:
            err(where, "essay prompts need minWords >= 250")
        hints = w.get("hints", [])
        if not isinstance(hints, list) or not all(is_str(h) for h in hints):
            err(where, "hints must be a list of non-empty strings")
    if len(data) < 18:
        err(name, f"needs at least 18 prompts, has {len(data)}")
    for t in WRITING_TYPES:
        if types[t] != 2:
            err(name, f"taskType {t!r} has {types[t]} prompts (expected 2)")
    stats[name] = {"count": len(data), "levels": dict(sorted(levels.items()))}


# ---------------------------------------------------------------- speaking
def validate_speaking():
    name = "speaking-prompts.json"
    data = load(name)
    if data is None:
        return
    seen = set()
    levels, kinds = Counter(), Counter()
    for i, s in enumerate(data):
        where = f"{name}[{i}:{s.get('id', '?') if isinstance(s, dict) else '?'}]"
        if not check_keys(where, s, ["id", "kind", "cefr", "title", "instructionsVi", "durationSec"],
                          ["sentences", "aiRole", "openingLine", "cueCard"]):
            continue
        check_id(where, s.get("id"), seen)
        check_strs(where, s, ["title", "instructionsVi"])
        check_vi(where, s, ["instructionsVi"])
        check_cefr(where, s.get("cefr"))
        levels[s.get("cefr")] += 1
        kind = s.get("kind")
        if kind not in SPEAKING_KINDS:
            err(where, f"invalid kind {kind!r}")
        kinds[kind] += 1
        d = s.get("durationSec")
        if not is_int(d) or not (15 <= d <= 600):
            err(where, f"durationSec {d!r} must be an integer 15-600")
        sentences = s.get("sentences", [])
        cue = s.get("cueCard", [])
        if not isinstance(sentences, list) or not all(is_str(x) for x in sentences):
            err(where, "sentences must be a list of non-empty strings")
            sentences = []
        if not isinstance(cue, list) or not all(isinstance(x, str) for x in cue):
            err(where, "cueCard must be a list of strings")
            cue = []
        for opt in ("aiRole", "openingLine"):
            if opt in s and not is_str(s[opt]):
                err(where, f"'{opt}' must be a non-empty string when present")
        if kind in ("shadowing", "repeat") and not (4 <= len(sentences) <= 8):
            err(where, f"{kind} needs 4-8 sentences, has {len(sentences)}")
        if kind in ("roleplay", "real-world"):
            if not is_str(s.get("aiRole")) or not is_str(s.get("openingLine")):
                err(where, f"{kind} needs aiRole and openingLine")
        if kind in ("challenge", "ielts") and len([c for c in cue if c.strip()]) == 0:
            err(where, f"{kind} needs a non-empty cueCard")
    if len(data) < 18:
        err(name, f"needs at least 18 prompts, has {len(data)}")
    for k in SPEAKING_KINDS:
        if kinds[k] != 3:
            err(name, f"kind {k!r} has {kinds[k]} prompts (expected 3)")
    stats[name] = {"count": len(data), "levels": dict(sorted(levels.items()))}


def main():
    validate_reading()
    validate_listening()
    validate_grammar()
    validate_writing()
    validate_speaking()
    for name, s in stats.items():
        print(f"{name}: {s['count']} items, levels {s['levels']}")
        for k, v in s.items():
            if k in ("count", "levels"):
                continue
            if isinstance(v, list):
                for line in v:
                    print(f"    {line}")
            else:
                print(f"    {k}: {v}")
    if errors:
        print(f"\n{len(errors)} error(s):")
        for e in errors:
            print("  - " + e)
        sys.exit(1)
    print("\nAll content files are valid.")


if __name__ == "__main__":
    main()
