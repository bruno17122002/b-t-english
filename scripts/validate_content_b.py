"""Validate cinema.json, assessment.json and dictionary.json against the rules in
src/shared/content.ts (plus the authoring rules for these files).

Run:  python -I scripts/validate_content_b.py
Exits with code 1 and prints every problem if anything is invalid.
"""
import json
import os
import re
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT = os.path.join(ROOT, "src", "content")

CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"]
ID_RE = re.compile(r"^[a-z0-9-]+$")
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
BACKDROPS = {"city-night", "cafe", "office", "airport", "train", "lab", "street-rain", "interview-room",
             "apartment", "spaceship", "park", "hotel-lobby", "market", "museum"}
GENRES = {"new-york-life", "travel", "detective", "sci-fi", "job-interview", "office", "business", "social", "real-life"}
MOODS = {"calm", "tense", "warm", "mysterious", "upbeat", "serious"}
QUALITIES = {"great", "ok", "awkward"}
ENDING_TYPES = {"good", "neutral", "bad"}
SKILLS = {"vocabulary": "voc", "grammar": "gra", "reading": "rea", "listening": "lis"}
POS = {"noun", "verb", "adjective", "adverb", "preposition", "conjunction", "pronoun", "determiner", "phrasal verb"}
TOPICS = {"daily-life", "people", "work", "travel", "food", "health", "education", "technology", "nature",
          "emotions", "society", "academic", "business", "time", "places", "actions", "describing"}

errors = []


def err(where, msg):
    errors.append(f"{where}: {msg}")


def is_str(v):
    return isinstance(v, str) and v.strip() != ""


def check_keys(where, obj, required, optional=()):
    if not isinstance(obj, dict):
        err(where, "must be an object")
        return False
    for k in required:
        if k not in obj:
            err(where, f"missing field '{k}'")
    extra = set(obj) - set(required) - set(optional)
    if extra:
        err(where, f"unknown fields {sorted(extra)}")
    return True


def check_vi(where, text):
    """A Vietnamese field must be non-empty; longer ones must contain diacritics."""
    if not is_str(text):
        err(where, "Vietnamese text must be a non-empty string")
        return
    # Short phrases such as "anh trai, em trai" can legitimately be plain ASCII.
    if len(text.split()) >= 6 and all(ord(ch) < 128 for ch in text):
        err(where, f"Vietnamese text has no diacritics: {text[:60]!r}")


def load(name):
    path = os.path.join(CONTENT, name)
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except OSError as e:
        err(name, f"cannot read file ({e})")
        return None
    if raw.startswith(b"\xef\xbb\xbf"):
        err(name, "file starts with a UTF-8 BOM")
        raw = raw[3:]
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        err(name, f"invalid JSON/UTF-8 ({e})")
        return None
    if not isinstance(data, list):
        err(name, "top level must be a JSON array")
        return None
    return data


# ---------------------------------------------------------------- questions
def check_question(where, q, seen_ids):
    if not check_keys(where, q, ["id", "type", "prompt", "options", "answerIndex", "explanation"]):
        return
    if not is_str(q.get("id")):
        err(where, "id must be a non-empty string")
    elif q["id"] in seen_ids:
        err(where, f"duplicate question id {q['id']}")
    else:
        seen_ids.add(q["id"])
    if q.get("type") not in ("mcq", "true-false-ng"):
        err(where, f"bad question type {q.get('type')!r}")
    if not is_str(q.get("prompt")):
        err(where, "prompt must be non-empty")
    opts = q.get("options")
    if not isinstance(opts, list) or not (2 <= len(opts) <= 5) or not all(is_str(o) for o in opts):
        err(where, "options must be 2-5 non-empty strings")
        opts = opts if isinstance(opts, list) else []
    elif len(set(opts)) != len(opts):
        err(where, "duplicate options")
    ai = q.get("answerIndex")
    if not isinstance(ai, int) or isinstance(ai, bool) or ai < 0 or ai >= len(opts):
        err(where, f"answerIndex {ai!r} out of range")
    check_vi(where + ".explanation", q.get("explanation"))


# ---------------------------------------------------------------- cinema
def validate_cinema(stories):
    if len(stories) < 7:
        err("cinema", f"need at least 7 stories, found {len(stories)}")
    story_ids, quiz_ids = set(), set()
    genres = Counter()
    levels = Counter()
    for si, st in enumerate(stories):
        w = f"cinema[{si}]"
        if not check_keys(w, st, ["id", "title", "genre", "cefr", "synopsisEn", "synopsisVi", "setting",
                                  "characters", "startSceneId", "scenes"]):
            continue
        sid = st.get("id")
        w = f"cinema[{sid}]"
        if not isinstance(sid, str) or not ID_RE.match(sid):
            err(w, "story id must match ^[a-z0-9-]+$")
        if sid in story_ids:
            err(w, "duplicate story id")
        story_ids.add(sid)
        for k in ("title", "synopsisEn", "setting"):
            if not is_str(st.get(k)):
                err(w, f"{k} must be non-empty")
        check_vi(w + ".synopsisVi", st.get("synopsisVi"))
        if st.get("genre") not in GENRES:
            err(w, f"bad genre {st.get('genre')!r}")
        genres[st.get("genre")] += 1
        if st.get("cefr") not in CEFR:
            err(w, f"bad cefr {st.get('cefr')!r}")
        levels[st.get("cefr")] += 1

        # characters
        chars = st.get("characters") or []
        if not isinstance(chars, list) or not (2 <= len(chars) <= 4):
            err(w, f"needs 2-4 characters, found {len(chars) if isinstance(chars, list) else chars!r}")
            chars = chars if isinstance(chars, list) else []
        char_ids, colors = set(), set()
        for ci, c in enumerate(chars):
            cw = f"{w}.characters[{ci}]"
            if not check_keys(cw, c, ["id", "name", "role", "voiceGender", "color"]):
                continue
            for k in ("id", "name", "role"):
                if not is_str(c.get(k)):
                    err(cw, f"{k} must be non-empty")
            if c.get("id") == "narrator":
                err(cw, "character id 'narrator' is reserved")
            if c.get("id") in char_ids:
                err(cw, "duplicate character id")
            char_ids.add(c.get("id"))
            if c.get("voiceGender") not in ("female", "male"):
                err(cw, "voiceGender must be female/male")
            col = c.get("color")
            if not isinstance(col, str) or not HEX_RE.match(col):
                err(cw, f"bad color {col!r}")
            else:
                if col.lower() in colors:
                    err(cw, f"color {col} not distinct")
                colors.add(col.lower())
                r, g, b = (int(col[i:i + 2], 16) for i in (1, 3, 5))
                lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
                if lum < 110:
                    err(cw, f"color {col} too dark for a navy background (luma {lum:.0f})")

        # scenes
        scenes = st.get("scenes") or []
        if not isinstance(scenes, list) or not (8 <= len(scenes) <= 14):
            err(w, f"needs 8-14 scenes, found {len(scenes) if isinstance(scenes, list) else scenes!r}")
            scenes = scenes if isinstance(scenes, list) else []
        by_id = {}
        for sc in scenes:
            if isinstance(sc, dict) and is_str(sc.get("id")):
                if sc["id"] in by_id:
                    err(w, f"duplicate scene id {sc['id']}")
                by_id[sc["id"]] = sc
        if st.get("startSceneId") not in by_id:
            err(w, f"startSceneId {st.get('startSceneId')!r} does not exist")

        choice_points = 0
        quiz_scenes = 0
        edges = {}
        endings = {}
        for sc in scenes:
            scw = f"{w}.scene[{sc.get('id') if isinstance(sc, dict) else '?'}]"
            if not check_keys(scw, sc, ["id", "title", "backdrop", "mood", "lines"],
                              ["choice", "nextSceneId", "quiz", "ending"]):
                continue
            if not is_str(sc.get("title")):
                err(scw, "title must be non-empty")
            if sc.get("backdrop") not in BACKDROPS:
                err(scw, f"bad backdrop {sc.get('backdrop')!r}")
            if sc.get("mood") not in MOODS:
                err(scw, f"bad mood {sc.get('mood')!r}")
            lines = sc.get("lines") or []
            if not isinstance(lines, list) or not (3 <= len(lines) <= 8):
                err(scw, f"needs 3-8 lines, found {len(lines) if isinstance(lines, list) else lines!r}")
                lines = lines if isinstance(lines, list) else []
            for li, ln in enumerate(lines):
                lw = f"{scw}.lines[{li}]"
                if not check_keys(lw, ln, ["characterId", "text", "translationVi"], ["expressions"]):
                    continue
                cid = ln.get("characterId")
                if cid != "narrator" and cid not in char_ids:
                    err(lw, f"unknown character {cid!r}")
                if not is_str(ln.get("text")):
                    err(lw, "text must be non-empty")
                check_vi(lw + ".translationVi", ln.get("translationVi"))
                if "expressions" in ln:
                    exs = ln["expressions"]
                    if not isinstance(exs, list):
                        err(lw, "expressions must be an array")
                        exs = []
                    for xi, ex in enumerate(exs):
                        xw = f"{lw}.expressions[{xi}]"
                        if check_keys(xw, ex, ["phrase", "meaningVi", "explanation"]):
                            if not is_str(ex.get("phrase")) or not is_str(ex.get("explanation")):
                                err(xw, "phrase/explanation must be non-empty")
                            check_vi(xw + ".meaningVi", ex.get("meaningVi"))

            exits = sum(1 for k in ("choice", "nextSceneId", "ending") if sc.get(k))
            if exits != 1:
                err(scw, f"must have exactly one of choice/nextSceneId/ending (has {exits})")
            targets = []
            if sc.get("nextSceneId"):
                targets.append(sc["nextSceneId"])
            if sc.get("choice"):
                ch = sc["choice"]
                if check_keys(scw + ".choice", ch, ["prompt", "options"]):
                    if not is_str(ch.get("prompt")):
                        err(scw, "choice prompt must be non-empty")
                    opts = ch.get("options") or []
                    if not isinstance(opts, list) or not (2 <= len(opts) <= 3):
                        err(scw, "choice needs 2-3 options")
                        opts = opts if isinstance(opts, list) else []
                    choice_points += 1
                    for oi, op in enumerate(opts):
                        ow = f"{scw}.choice[{oi}]"
                        if not check_keys(ow, op, ["text", "nextSceneId", "quality", "feedbackVi"]):
                            continue
                        if not is_str(op.get("text")):
                            err(ow, "text must be non-empty")
                        if op.get("quality") not in QUALITIES:
                            err(ow, f"bad quality {op.get('quality')!r}")
                        check_vi(ow + ".feedbackVi", op.get("feedbackVi"))
                        targets.append(op.get("nextSceneId"))
            if sc.get("ending"):
                en = sc["ending"]
                if check_keys(scw + ".ending", en, ["type", "summaryEn", "summaryVi"]):
                    if en.get("type") not in ENDING_TYPES:
                        err(scw, f"bad ending type {en.get('type')!r}")
                    if not is_str(en.get("summaryEn")):
                        err(scw, "ending summaryEn must be non-empty")
                    check_vi(scw + ".ending.summaryVi", en.get("summaryVi"))
                    endings[sc["id"]] = en.get("type")
            for t in targets:
                if t not in by_id:
                    err(scw, f"reference to unknown scene {t!r}")
            edges[sc["id"]] = [t for t in targets if t in by_id]
            if "quiz" in sc:
                qz = sc["quiz"]
                if not isinstance(qz, list) or not (1 <= len(qz) <= 2):
                    err(scw, "quiz must have 1-2 questions")
                    qz = qz if isinstance(qz, list) else []
                else:
                    quiz_scenes += 1
                for qi, q in enumerate(qz):
                    check_question(f"{scw}.quiz[{qi}]", q, quiz_ids)
                    if isinstance(q, dict) and q.get("type") != "mcq":
                        err(f"{scw}.quiz[{qi}]", "cinema quizzes must be mcq")

        if choice_points < 2:
            err(w, f"needs at least 2 choice points, found {choice_points}")
        if scenes and quiz_scenes < max(2, len(scenes) // 4):
            err(w, f"too few quiz scenes ({quiz_scenes}) for {len(scenes)} scenes")

        # graph: reachability, acyclicity, every path ends, >=2 endings reachable
        start = st.get("startSceneId")
        if start in by_id:
            reach, stack = set(), [start]
            while stack:
                n = stack.pop()
                if n in reach:
                    continue
                reach.add(n)
                stack.extend(edges.get(n, []))
            for s in by_id:
                if s not in reach:
                    err(w, f"scene {s} is unreachable from start")
            # cycle detection (a cycle means some path never ends)
            WHITE, GREY, BLACK = 0, 1, 2
            colour = {s: WHITE for s in by_id}

            def dfs(u):
                colour[u] = GREY
                for v in edges.get(u, []):
                    if colour[v] == GREY:
                        err(w, f"cycle detected through {u} -> {v}")
                    elif colour[v] == WHITE:
                        dfs(v)
                colour[u] = BLACK

            sys.setrecursionlimit(10000)
            dfs(start)
            for s in reach:
                if s not in endings and not edges.get(s):
                    err(w, f"scene {s} is a dead end without an ending")
            reach_end = [s for s in reach if s in endings]
            if len(reach_end) < 2:
                err(w, f"needs at least 2 reachable endings, found {len(reach_end)}")
            if len({endings[s] for s in reach_end}) < 2:
                err(w, "endings should have at least 2 different types")

    if len(genres) < len(stories):
        dup = [g for g, n in genres.items() if n > 1]
        err("cinema", f"genres must all differ; duplicated: {dup}")
    low = levels["A1"] + levels["A2"]
    if low < 2 or levels["B1"] < 3 or levels["B2"] < 2:
        err("cinema", f"level mix should be >=2 A1/A2, >=3 B1, >=2 B2; got {dict(levels)}")
    return genres, levels


# ---------------------------------------------------------------- assessment
def validate_assessment(items):
    ids = set()
    cells = Counter()
    id_re = re.compile(r"^(voc|gra|rea|lis)-(a1|a2|b1|b2|c1|c2)-([1-9][0-9]*)$")
    for i, it in enumerate(items):
        w = f"assessment[{i}]"
        if not check_keys(w, it, ["id", "skill", "cefr", "prompt", "options", "answerIndex"], ["passage"]):
            continue
        iid = it.get("id")
        w = f"assessment[{iid}]"
        if not is_str(iid):
            err(w, "id must be non-empty")
        elif iid in ids:
            err(w, "duplicate id")
        ids.add(iid)
        skill, cefr = it.get("skill"), it.get("cefr")
        if skill not in SKILLS:
            err(w, f"bad skill {skill!r}")
        if cefr not in CEFR:
            err(w, f"bad cefr {cefr!r}")
        m = id_re.match(iid or "")
        if not m:
            err(w, "id must look like voc-a1-1")
        elif skill in SKILLS and cefr in CEFR and (m.group(1) != SKILLS[skill] or m.group(2) != cefr.lower()):
            err(w, "id prefix does not match skill/cefr")
        cells[(skill, cefr)] += 1
        if not is_str(it.get("prompt")):
            err(w, "prompt must be non-empty")
        opts = it.get("options")
        if not isinstance(opts, list) or not (3 <= len(opts) <= 4) or not all(is_str(o) for o in opts):
            err(w, "options must be 3-4 non-empty strings")
            opts = opts if isinstance(opts, list) else []
        elif len({o.strip().lower() for o in opts}) != len(opts):
            err(w, "duplicate options")
        ai = it.get("answerIndex")
        if not isinstance(ai, int) or isinstance(ai, bool) or ai < 0 or ai >= len(opts):
            err(w, f"answerIndex {ai!r} out of range")
        passage = it.get("passage")
        if skill in ("reading", "listening"):
            if not is_str(passage):
                err(w, f"{skill} item needs a passage")
            elif skill == "reading":
                wc = len(passage.split())
                if not (30 <= wc <= 120):
                    err(w, f"reading passage has {wc} words (need 30-120)")
            else:
                sentences = [s for s in re.split(r"(?<=[.!?])\s+", passage.strip()) if s]
                if not (1 <= len(sentences) <= 4):
                    err(w, f"listening script has {len(sentences)} sentences (need 1-4)")
        elif passage is not None and not is_str(passage):
            err(w, "passage must be a non-empty string when present")
    for skill in SKILLS:
        for lvl in CEFR:
            if cells[(skill, lvl)] != 4:
                err("assessment", f"{skill}/{lvl} has {cells[(skill, lvl)]} items (need 4)")
    if len(items) != 96:
        err("assessment", f"expected 96 items, found {len(items)}")
    return cells


# ---------------------------------------------------------------- dictionary
def validate_dictionary(entries):
    words = set()
    levels, topics = Counter(), Counter()
    for i, e in enumerate(entries):
        w = f"dictionary[{i}]"
        if not check_keys(w, e, ["word", "ipa", "pos", "meaningVi", "meaningEn", "example", "cefr", "topic"],
                          ["collocations"]):
            continue
        word = e.get("word")
        w = f"dictionary[{word}]"
        if not is_str(word):
            err(w, "word must be non-empty")
        else:
            if word != word.lower() or word != word.strip():
                err(w, "word must be a lowercase lemma without surrounding spaces")
            if word in words:
                err(w, "duplicate word")
            words.add(word)
        ipa = e.get("ipa")
        if not is_str(ipa) or not (ipa.startswith("/") and ipa.endswith("/")):
            err(w, f"ipa should be written between slashes: {ipa!r}")
        if e.get("pos") not in POS:
            err(w, f"bad pos {e.get('pos')!r}")
        check_vi(w + ".meaningVi", e.get("meaningVi"))
        for k in ("meaningEn", "example"):
            if not is_str(e.get(k)):
                err(w, f"{k} must be non-empty")
        if e.get("cefr") not in CEFR:
            err(w, f"bad cefr {e.get('cefr')!r}")
        levels[e.get("cefr")] += 1
        if e.get("topic") not in TOPICS:
            err(w, f"bad topic {e.get('topic')!r}")
        topics[e.get("topic")] += 1
        col = e.get("collocations", [])
        if not isinstance(col, list) or len(col) > 4 or not all(is_str(c) for c in col):
            err(w, "collocations must be 0-4 non-empty strings")
    if len(entries) < 450:
        err("dictionary", f"need at least 450 entries, found {len(entries)}")
    for lvl, minimum in (("A1", 100), ("A2", 100), ("B1", 90), ("B2", 60), ("C1", 25)):
        if levels[lvl] < minimum:
            err("dictionary", f"{lvl} has {levels[lvl]} entries (want roughly >= {minimum})")
    for must in ("significant", "consequently", "phenomenon", "sustainable", "infrastructure", "hypothesis"):
        if must not in words:
            err("dictionary", f"missing academic word {must!r}")
    return levels, topics


def main():
    try:  # Windows consoles default to cp1252; messages may contain IPA/Vietnamese
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:
        pass
    cinema = load("cinema.json")
    assessment = load("assessment.json")
    dictionary = load("dictionary.json")
    report = []
    if cinema is not None:
        genres, levels = validate_cinema(cinema)
        n_scenes = sum(len(s.get("scenes", [])) for s in cinema if isinstance(s, dict))
        report.append(f"cinema.json: {len(cinema)} stories, {n_scenes} scenes; levels {dict(sorted(levels.items()))}; "
                      f"genres {sorted(genres)}")
    if assessment is not None:
        validate_assessment(assessment)
        report.append(f"assessment.json: {len(assessment)} items")
    if dictionary is not None:
        levels, topics = validate_dictionary(dictionary)
        report.append(f"dictionary.json: {len(dictionary)} entries; levels {dict(sorted(levels.items()))}; "
                      f"{len(topics)} topics")
    for line in report:
        print(line)
    if errors:
        print(f"\n{len(errors)} problem(s):")
        for e in errors:
            print(" -", e)
        sys.exit(1)
    print("\nAll content files are valid.")


if __name__ == "__main__":
    main()
