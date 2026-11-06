"""Convert Cadence pronunciation data (MIT) into a B&T English content pack.

Usage:
    python -I scripts/convert_cadence_pronunciation.py <path/to/cadence repo root> <output dir>
    e.g. python -I scripts/convert_cadence_pronunciation.py D:/lq-oss/cadence_src \
             src/content/packs/cadence-pronunciation

Reads (read-only):
    src/backend/data/phoneme_catalog.json   -> phonemes.json
    supabase/modules.sql (INSERT seed data) -> modules.json (10 modules with lessons and words)
    src/backend/data/practice_targets.json  -> targets.json
    src/lib/conversation.ts (CONVERSATION_MODULES literal) -> conversations.json
    LICENSE                                 -> copyright line in pack.json

English source text is kept as-is. The only additions are the `viNote` fields on phonemes, which are
original Vietnamese learner notes written for B&T English (not taken from Cadence).
The conversion is deterministic; pack.json keeps its previous converted_at unless content changed.
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import sys

PACK_ID = 'cadence-pronunciation'
PACK_NAME = 'Cadence Pronunciation (phonemes, modules, practice words, conversations)'
PACK_VERSION = '1.0.0'
SOURCE_URL = 'https://github.com/pstepanovum/Cadence'
DEFAULT_COMMIT = '9d94329239892032a343a1d3e64b60b08419d867'

# Original B&T English notes for Vietnamese learners (written for this pack, not from Cadence).
VI_NOTES = {
    'æ': 'Tiếng Việt không có âm này; người Việt hay đọc thành "e" hoặc "a". Mở miệng rộng như "a" '
         'nhưng đẩy lưỡi ra trước như "e": cat, man, bad.',
    'ɛ': 'Gần với "e" trong "mẹ". Giữ âm ngắn, không lướt thành "ây": bed khác bayed.',
    'ɪ': 'Ngắn và lỏng hơn "i" tiếng Việt. Đừng kéo dài thành /iː/, nếu không ship sẽ nghe như sheep.',
    'ɒ': 'Gần "o" trong "có" nhưng ngắn hơn. Giọng Mỹ thường mở rộng thành /ɑ/: hot, stop.',
    'ʌ': 'Gần "â" hoặc "ơ" ngắn (cup gần "cấp"). Môi thả lỏng, không tròn môi.',
    'ʊ': 'Gần "u" nhưng ngắn và lỏng hơn, môi tròn nhẹ. Đừng kéo dài: full khác fool.',
    'ə': 'Âm yếu nhất tiếng Anh, gần "ơ" rất nhẹ và ngắn. Người Việt hay đọc rõ mọi âm tiết; '
         'hãy đọc lướt âm tiết không nhấn: about, banana.',
    'iː': 'Giống "i" tiếng Việt nhưng kéo dài, môi hơi bè. Phân biệt độ dài: sheep /iː/ khác ship /ɪ/.',
    'uː': 'Giống "u" tiếng Việt nhưng dài hơn, môi tròn. food /uː/ khác foot /ʊ/.',
    'ɑː': 'Giống "a" tiếng Việt nhưng sâu và dài hơn, miệng mở rộng: father, car.',
    'ɔː': 'Gần "o" tiếng Việt kéo dài, môi tròn: law, saw, talk.',
    'ɜː': 'Gần "ơ" kéo dài (bird, work). Giọng Mỹ có thêm âm r cong lưỡi ở cuối.',
    'eɪ': 'Gần "ây" (day gần "đây"). Phải lướt đủ sang /ɪ/, đừng đọc thành "e" đơn.',
    'aɪ': 'Gần "ai" tiếng Việt (my gần "mai"). Nhớ đọc rõ phụ âm cuối phía sau: time, nice.',
    'ɔɪ': 'Gần "oi" tiếng Việt (boy gần "bói"). Lướt nhanh từ "o" sang "i".',
    'aʊ': 'Gần "ao" tiếng Việt (now gần "nao"), kết thúc bằng môi tròn.',
    'oʊ': 'Gần "âu" hoặc "ô" lướt sang "u" (go). Đừng đọc thành "ô" đơn. Giọng Anh-Anh là /əʊ/.',
    'ɪə': 'Gần "ia" tiếng Việt (here gần "hia"), chủ yếu trong giọng Anh-Anh; giọng Mỹ đọc /ɪr/.',
    'eə': 'Gần "e" lướt sang "ơ" (hair, care), chủ yếu trong giọng Anh-Anh; giọng Mỹ đọc /ɛr/.',
    'θ': 'Tiếng Việt không có. Người Việt hay thay bằng "th" bật hơi, "t" hoặc "s". Đặt đầu lưỡi giữa '
         'hai hàm răng rồi thổi hơi, không rung dây thanh: think, three.',
    'ð': 'Tiếng Việt không có; hay bị đọc thành "đ", "d" hoặc /z/. Lưỡi giữa hai hàm răng và rung '
         'dây thanh: this, the, mother.',
    'ʃ': 'Gần "s" cong lưỡi khi đọc chuẩn (như "sẽ") nhưng môi tròn và đưa ra trước: she, fish. '
         'Đừng đọc thành /s/: she khác see.',
    'ʒ': 'Không có trong tiếng Việt. Là /ʃ/ có rung dây thanh: vision, measure. Người Việt hay thay '
         'bằng /z/ hoặc /ʃ/.',
    'tʃ': 'Gần "ch" tiếng Việt nhưng môi tròn và bật hơi mạnh hơn: chair, watch. Ở cuối từ phải đọc '
          'rõ, không nuốt âm.',
    'dʒ': 'Không có trong tiếng Việt; hay bị đọc thành "gi" hoặc "ch". Là /tʃ/ có rung dây thanh: '
          'job, age, bridge.',
    'ŋ': 'Giống "ng" tiếng Việt. Lưu ý đuôi -ing: không thêm /g/ và không đổi thành /n/: sing, thinking.',
    'ɹ': 'Khác "r" rung hay "r" giọng miền Nam. Rút hoặc cong lưỡi về sau, không chạm vòm miệng, môi '
         'hơi tròn: red, right. Người Việt hay nhầm với /z/ hoặc /l/.',
    'l': 'Đầu từ giống "l" tiếng Việt. Cuối từ (feel, school) phải đưa đầu lưỡi chạm lợi trên; '
         'tiếng Việt không có "l" cuối nên người học hay bỏ mất âm này.',
    'v': 'Răng trên chạm môi dưới và rung dây thanh: very, voice. Đừng thay bằng /w/, /b/ hoặc "d" '
         'kiểu giọng miền Nam.',
    'w': 'Tròn môi rồi mở ra, gần âm đầu của "oa"/"uy" (we gần "uy"). Răng không chạm môi.',
}


def read_json(path):
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def read_text(path):
    with open(path, encoding='utf-8') as fh:
        return fh.read()


def copyright_line(license_path):
    for line in read_text(license_path).splitlines():
        if line.strip().lower().startswith('copyright'):
            return line.strip()
    raise SystemExit('No copyright line in ' + license_path)


# ---------------------------------------------------------------- phonemes / targets


def convert_phonemes(catalog):
    out = []
    for key, entry in catalog['phonemes'].items():
        item = {
            'symbol': key,
            'ipa': entry.get('ipa', key),
            'label': entry['label'],
            'category': entry['category'],
            'difficulty': entry.get('difficulty'),
            'keywords': list(entry.get('keywords') or []),
            'exampleWords': list(entry.get('example_words') or []),
            'spellingPatterns': list(entry.get('spelling_patterns') or []),
            'articulation': entry.get('articulation'),
            'learnerTip': entry.get('learner_tip'),
            'commonErrors': list(entry.get('common_errors') or []),
            'minimalPairs': [list(p) for p in entry.get('minimal_pairs') or []],
            'dialectNote': entry.get('dialect_note'),
            'viNote': VI_NOTES.get(key),
        }
        out.append(item)
    missing = [p['symbol'] for p in out if not p['viNote']]
    if missing:
        print('warning: no viNote for ' + ' '.join(missing), file=sys.stderr)
    return out


def convert_targets(targets):
    words = []
    for word, entry in targets['words'].items():
        phonemes = entry['ipa'].split()
        segments = []
        for s in entry.get('segments') or []:
            start, end = int(s['start']), int(s['end'])
            # A few upstream entries (e.g. 'suffer') index one phoneme past the end; clamp to the IPA length.
            if end > len(phonemes) or start > len(phonemes):
                print('note: clamped segment %r of %r to %d phonemes' % (s['text'], word, len(phonemes)),
                      file=sys.stderr)
                start, end = min(start, len(phonemes)), min(end, len(phonemes))
            segments.append({'text': s['text'], 'start': start, 'end': end})
        words.append({
            'word': word,
            'ipa': entry['ipa'],
            'phonemes': phonemes,
            'category': entry['category'],
            'focusPhoneme': entry['focus_phoneme'],
            'cue': entry.get('cue'),
            'segments': segments,
        })
    return {'categories': dict(targets.get('categories') or {}), 'words': words}


# ---------------------------------------------------------------- modules.sql


class SqlValues:
    """Tiny parser for the VALUES list of a Postgres INSERT seed (strings, numbers, NULL, ARRAY[...])."""

    def __init__(self, text):
        self.text = text
        self.pos = 0

    def skip_ws(self):
        while self.pos < len(self.text):
            ch = self.text[self.pos]
            if ch.isspace():
                self.pos += 1
            elif self.text.startswith('--', self.pos):
                end = self.text.find('\n', self.pos)
                self.pos = len(self.text) if end < 0 else end + 1
            else:
                break

    def peek(self):
        self.skip_ws()
        return self.text[self.pos] if self.pos < len(self.text) else ''

    def expect(self, ch):
        if self.peek() != ch:
            raise ValueError('expected %r at %d, got %r' % (ch, self.pos, self.text[self.pos:self.pos + 30]))
        self.pos += 1

    def value(self):
        ch = self.peek()
        if ch == "'":
            self.pos += 1
            buf = []
            while True:
                nxt = self.text.index("'", self.pos)
                buf.append(self.text[self.pos:nxt])
                if self.text.startswith("''", nxt):
                    buf.append("'")
                    self.pos = nxt + 2
                else:
                    self.pos = nxt + 1
                    return ''.join(buf)
        if self.text.startswith('ARRAY[', self.pos):
            self.pos += len('ARRAY')
            self.expect('[')
            items = []
            while self.peek() != ']':
                items.append(self.value())
                if self.peek() == ',':
                    self.pos += 1
            self.expect(']')
            return items
        match = re.compile(r'NULL|-?\d+(?:\.\d+)?|TRUE|FALSE', re.I).match(self.text, self.pos)
        if not match:
            raise ValueError('cannot parse value at %d: %r' % (self.pos, self.text[self.pos:self.pos + 30]))
        self.pos = match.end()
        token = match.group(0).upper()
        if token == 'NULL':
            return None
        if token in ('TRUE', 'FALSE'):
            return token == 'TRUE'
        return float(token) if '.' in token else int(token)

    def rows(self):
        out = []
        while self.peek() == '(':
            self.pos += 1
            row = [self.value()]
            while self.peek() == ',':
                self.pos += 1
                row.append(self.value())
            self.expect(')')
            out.append(row)
            if self.peek() == ',':
                self.pos += 1
            else:
                break
        return out


def sql_inserts(sql, table):
    """Return the rows of every `INSERT INTO <table> (cols) VALUES ...` statement as dicts."""
    pattern = re.compile(r'INSERT\s+INTO\s+' + re.escape(table) + r'\s*\(([^)]*)\)\s*VALUES', re.I)
    rows = []
    for match in pattern.finditer(sql):
        columns = [c.strip() for c in match.group(1).split(',')]
        parser = SqlValues(sql)
        parser.pos = match.end()
        for row in parser.rows():
            if len(row) != len(columns):
                raise ValueError('column mismatch in %s: %r' % (table, row))
            rows.append(dict(zip(columns, row)))
    return rows


def strip_slashes(symbol):
    return symbol[1:-1] if len(symbol) > 2 and symbol.startswith('/') and symbol.endswith('/') else symbol


def focus_symbols(focus):
    """'/p/-/b/' -> ['p', 'b']; '/æ/' -> ['æ']."""
    out = []
    for raw in focus:
        for sym in re.findall(r'/([^/]+)/', raw) or [raw]:
            if sym not in out:
                out.append(sym)
    return out


def convert_modules(sql):
    modules = sql_inserts(sql, 'public.modules')
    lessons = sql_inserts(sql, 'public.lessons')
    words = sql_inserts(sql, 'public.lesson_words')
    words_by_lesson = {}
    for w in words:
        words_by_lesson.setdefault(w['lesson_id'], []).append(w)
    lessons_by_module = {}
    for lesson in lessons:
        lessons_by_module.setdefault(lesson['module_id'], []).append(lesson)

    out = []
    for module in sorted(modules, key=lambda m: m['sort_order']):
        module_lessons = []
        for lesson in sorted(lessons_by_module.get(module['id'], []), key=lambda l: l['sort_order']):
            lesson_words = sorted(words_by_lesson.get(lesson['id'], []), key=lambda w: w['sort_order'])
            module_lessons.append({
                'id': lesson['slug'],
                'title': lesson['title'],
                'type': lesson['lesson_type'],
                'order': lesson['sort_order'],
                'theoryHtml': lesson['theory_html'],
                'words': [{'word': w['word'], 'ipa': w['ipa'], 'phonemes': w['ipa'].split()} for w in lesson_words],
            })
        out.append({
            'id': module['slug'],
            'order': module['sort_order'],
            'title': module['title'],
            'description': module['description'],
            'phonemeFocus': list(module['phoneme_focus']),
            'focusSymbols': focus_symbols(module['phoneme_focus']),
            'lessons': module_lessons,
        })
    return out


# ---------------------------------------------------------------- conversation.ts


class JsLiteral:
    """Parser for a plain JS/TS data literal: objects, arrays, quoted strings, numbers, true/false/null."""

    IDENT = re.compile(r'[A-Za-z_$][A-Za-z0-9_$]*')
    NUMBER = re.compile(r'-?\d+(?:\.\d+)?')
    ESCAPES = {'n': '\n', 't': '\t', 'r': '\r', '\\': '\\', '"': '"', "'": "'", '`': '`', '0': '\0'}

    def __init__(self, text, pos=0):
        self.text = text
        self.pos = pos

    def skip_ws(self):
        while self.pos < len(self.text):
            if self.text[self.pos].isspace():
                self.pos += 1
            elif self.text.startswith('//', self.pos):
                end = self.text.find('\n', self.pos)
                self.pos = len(self.text) if end < 0 else end + 1
            elif self.text.startswith('/*', self.pos):
                self.pos = self.text.index('*/', self.pos) + 2
            else:
                break

    def peek(self):
        self.skip_ws()
        return self.text[self.pos] if self.pos < len(self.text) else ''

    def expect(self, ch):
        if self.peek() != ch:
            raise ValueError('expected %r at %d' % (ch, self.pos))
        self.pos += 1

    def string(self):
        quote = self.text[self.pos]
        self.pos += 1
        buf = []
        while True:
            ch = self.text[self.pos]
            if ch == '\\':
                nxt = self.text[self.pos + 1]
                if nxt == 'u':
                    buf.append(chr(int(self.text[self.pos + 2:self.pos + 6], 16)))
                    self.pos += 6
                    continue
                buf.append(self.ESCAPES.get(nxt, nxt))
                self.pos += 2
                continue
            if quote == '`' and self.text.startswith('${', self.pos):
                raise ValueError('template interpolation not supported')
            self.pos += 1
            if ch == quote:
                return ''.join(buf)
            buf.append(ch)

    def value(self):
        ch = self.peek()
        if ch == '{':
            self.pos += 1
            obj = {}
            while self.peek() != '}':
                if self.peek() in '"\'':
                    key = self.string()
                else:
                    match = self.IDENT.match(self.text, self.pos)
                    if not match:
                        raise ValueError('bad key at %d' % self.pos)
                    key = match.group(0)
                    self.pos = match.end()
                self.expect(':')
                obj[key] = self.value()
                if self.peek() == ',':
                    self.pos += 1
            self.expect('}')
            return obj
        if ch == '[':
            self.pos += 1
            arr = []
            while self.peek() != ']':
                arr.append(self.value())
                if self.peek() == ',':
                    self.pos += 1
            self.expect(']')
            return arr
        if ch in '"\'`':
            return self.string()
        match = self.NUMBER.match(self.text, self.pos)
        if match:
            self.pos = match.end()
            return float(match.group(0)) if '.' in match.group(0) else int(match.group(0))
        for word, val in (('true', True), ('false', False), ('null', None)):
            if self.text.startswith(word, self.pos):
                self.pos += len(word)
                return val
        raise ValueError('cannot parse JS value at %d: %r' % (self.pos, self.text[self.pos:self.pos + 30]))


def convert_conversations(ts_source):
    match = re.search(r'CONVERSATION_MODULES\s*:\s*[^=]*=\s*', ts_source)
    if not match:
        return None
    modules = JsLiteral(ts_source, match.end()).value()
    out = []
    for m in sorted(modules, key=lambda x: x['sortOrder']):
        level = m['level']
        out.append({
            'id': m['slug'],
            'order': m['sortOrder'],
            'title': m['title'],
            'level': level,
            'cefr': re.match(r'[ABC][12]', level).group(0),
            'topic': m['topic'],
            'summary': m['summary'],
            'scenario': m['scenario'],
            'focus': list(m['focus']),
            'estimatedMinutes': m['estimatedMinutes'],
            'passScore': m['passScore'],
            'turns': [{
                'id': t['id'],
                'coachMessage': t['coachMessage'],
                'userPrompt': t['userPrompt'],
                'expectedResponse': t['expectedResponse'],
                'coachingCue': t['coachingCue'],
            } for t in m['turns']],
        })
    return out


# ---------------------------------------------------------------- output


def dump(data):
    return json.dumps(data, ensure_ascii=False, indent=2) + '\n'


def write_if_changed(path, text):
    if os.path.isfile(path):
        with open(path, encoding='utf-8', newline='') as fh:
            if fh.read() == text:
                return
    with open(path, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(text)


def resolve_converted_at(meta_path, content_hash, override):
    if override:
        return override
    if os.path.isfile(meta_path):
        try:
            previous = read_json(meta_path)
        except json.JSONDecodeError:
            previous = {}
        if previous.get('content_sha256') == content_hash and previous.get('converted_at'):
            return previous['converted_at']
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d')


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('source', help='Cadence repository root (exported tree)')
    parser.add_argument('out_dir', help='Output directory, e.g. src/content/packs/cadence-pronunciation')
    parser.add_argument('--commit', default=DEFAULT_COMMIT, help='Source commit hash')
    parser.add_argument('--converted-at', default=None, help='Override converted_at (YYYY-MM-DD)')
    args = parser.parse_args(argv)
    root = args.source

    files = {
        'phonemes.json': convert_phonemes(read_json(os.path.join(root, 'src', 'backend', 'data', 'phoneme_catalog.json'))),
        'modules.json': convert_modules(read_text(os.path.join(root, 'supabase', 'modules.sql'))),
        'targets.json': convert_targets(read_json(os.path.join(root, 'src', 'backend', 'data', 'practice_targets.json'))),
    }
    conversation_path = os.path.join(root, 'src', 'lib', 'conversation.ts')
    conversations = convert_conversations(read_text(conversation_path)) if os.path.isfile(conversation_path) else None
    if conversations:
        files['conversations.json'] = conversations
    else:
        print('warning: conversation scripts not found; conversations.json skipped', file=sys.stderr)

    os.makedirs(args.out_dir, exist_ok=True)
    texts = {name: dump(data) for name, data in files.items()}
    digest = hashlib.sha256()
    for name in sorted(texts):
        digest.update(name.encode('utf-8'))
        digest.update(texts[name].encode('utf-8'))
    content_hash = digest.hexdigest()
    meta_path = os.path.join(args.out_dir, 'pack.json')
    copyright_text = copyright_line(os.path.join(root, 'LICENSE'))
    meta = {
        'id': PACK_ID,
        'name': PACK_NAME,
        'version': PACK_VERSION,
        'license': 'MIT',
        'source': SOURCE_URL,
        'commit': args.commit,
        'copyright': copyright_text,
        'attribution': (
            'Phoneme catalog, pronunciation modules, practice words and conversation scripts adapted from Cadence ('
            + SOURCE_URL + '), ' + copyright_text + ', MIT License. Vietnamese notes (viNote) are original '
            'B&T English additions.'
        ),
        'files': sorted(texts),
        'content_sha256': content_hash,
        'converted_at': resolve_converted_at(meta_path, content_hash, args.converted_at),
    }
    for name, text in texts.items():
        write_if_changed(os.path.join(args.out_dir, name), text)
    write_if_changed(meta_path, dump(meta))

    lessons = sum(len(m['lessons']) for m in files['modules.json'])
    words = sum(len(l['words']) for m in files['modules.json'] for l in m['lessons'])
    print('phonemes=%d modules=%d lessons=%d lesson_words=%d targets=%d conversations=%d' % (
        len(files['phonemes.json']), len(files['modules.json']), lessons, words,
        len(files['targets.json']['words']), len(conversations or [])))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
