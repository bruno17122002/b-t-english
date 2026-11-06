"""Convert the Sprigo English course (courses/en.yml, MIT) into a B&T English content pack.

Usage:
    python -I scripts/convert_sprigo_syllabus.py <path/to/sprigo/courses/en.yml> <output dir>
    e.g. python -I scripts/convert_sprigo_syllabus.py D:/lq-oss/ozerozdas_sprigo/courses/en.yml \
             src/content/packs/sprigo-en-syllabus

Writes <output dir>/syllabus.json (array of CEFR levels -> units -> lessons) and <output dir>/pack.json.
The conversion is deterministic: re-running on the same source yields byte-identical files
(pack.json keeps its previous converted_at unless the converted content changed, or --converted-at is given).

Sprigo hierarchy is levels > units > steps > activities. A Sprigo "step" becomes a B&T English "lesson".
App-specific fields (course flag, native_name, iso) are dropped. Activity hints (scenario, goal) are kept.
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import sys

import yaml

PACK_ID = 'sprigo-en-syllabus'
PACK_NAME = 'Sprigo English Syllabus (A1-C2)'
PACK_VERSION = '1.0.0'
SOURCE_URL = 'https://github.com/ozerozdas/sprigo'
DEFAULT_COMMIT = 'b89aba5cd57c89e1ff7be623f7941930c409a8dd'
CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
SLUG_RE = re.compile(r'[^a-z0-9]+')


def slugify(value):
    return SLUG_RE.sub('-', str(value).lower()).strip('-')


def clean_text(value):
    """Collapse folded-YAML whitespace; return None for empty values."""
    if value is None:
        return None
    text = ' '.join(str(value).split())
    return text or None


def find_license(start_path):
    """Walk up from the source file to find the repo LICENSE."""
    directory = os.path.dirname(os.path.abspath(start_path))
    while True:
        candidate = os.path.join(directory, 'LICENSE')
        if os.path.isfile(candidate):
            return candidate
        parent = os.path.dirname(directory)
        if parent == directory:
            raise SystemExit('LICENSE not found above ' + start_path)
        directory = parent


def copyright_line(license_path):
    with open(license_path, encoding='utf-8') as fh:
        for line in fh:
            if line.strip().lower().startswith('copyright'):
                return line.strip()
    raise SystemExit('No copyright line in ' + license_path)


def convert_activity(raw):
    activity = {'type': str(raw['type']), 'count': int(raw.get('count', 1))}
    for key in ('scenario', 'goal'):
        if raw.get(key) is not None:
            activity[key] = clean_text(raw[key])
    return activity


def convert_lesson(level, unit_id, order, step):
    activities = [convert_activity(a) for a in step.get('activities') or []]
    activity_types = []
    for a in activities:
        if a['type'] not in activity_types:
            activity_types.append(a['type'])
    lesson = {
        'id': slugify(level + '-' + step['id']),
        'sourceId': step['id'],
        'unitId': unit_id,
        'order': order,
        'cefr': level,
        'title': clean_text(step['title']),
        'description': clean_text(step.get('description')),
        'grammar': [clean_text(g['pattern']) for g in step.get('grammar') or [] if g.get('pattern')],
        'vocabulary': [clean_text(v) for v in step.get('vocabulary') or [] if clean_text(v)],
        'activityTypes': activity_types,
        'activities': activities,
    }
    return lesson


def convert(course):
    levels_out = []
    seen_lessons = set()
    for level in CEFR:
        raw_level = (course.get('levels') or {}).get(level)
        if not raw_level:
            continue
        units = []
        for unit_order, raw_unit in enumerate(raw_level['units'], start=1):
            unit_id = slugify(level + '-' + raw_unit['id'])
            lessons = []
            for lesson_order, step in enumerate(raw_unit['steps'], start=1):
                lesson = convert_lesson(level, unit_id, lesson_order, step)
                if lesson['id'] in seen_lessons:
                    raise SystemExit('Duplicate lesson id ' + lesson['id'])
                seen_lessons.add(lesson['id'])
                lessons.append(lesson)
            units.append({
                'id': unit_id,
                'sourceId': raw_unit['id'],
                'order': unit_order,
                'cefr': level,
                'title': clean_text(raw_unit['title']),
                'description': clean_text(raw_unit.get('description')),
                'icon': clean_text(raw_unit.get('icon')),
                'lessons': lessons,
            })
        checkpoint = None
        if raw_level.get('checkpoint'):
            cp = raw_level['checkpoint']
            checkpoint = {
                'title': clean_text(cp['title']),
                'requiredScore': int(cp.get('required_score', 80)),
                'activities': [convert_activity(a) for a in cp.get('activities') or []],
            }
        levels_out.append({
            'cefr': level,
            'title': clean_text(raw_level['title']),
            # Sprigo's level description is a CEFR "can-do" style statement.
            'canDo': clean_text(raw_level.get('description')),
            'units': units,
            'checkpoint': checkpoint,
        })
    return levels_out


def dump(data):
    return json.dumps(data, ensure_ascii=False, indent=2) + '\n'


def write_if_changed(path, text):
    if os.path.isfile(path):
        with open(path, encoding='utf-8', newline='') as fh:
            if fh.read() == text:
                return False
    with open(path, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(text)
    return True


def resolve_converted_at(meta_path, content_hash, override):
    if override:
        return override
    if os.path.isfile(meta_path):
        with open(meta_path, encoding='utf-8') as fh:
            try:
                previous = json.load(fh)
            except json.JSONDecodeError:
                previous = {}
        if previous.get('content_sha256') == content_hash and previous.get('converted_at'):
            return previous['converted_at']
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d')


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('source', help='Path to Sprigo courses/en.yml')
    parser.add_argument('out_dir', help='Output directory, e.g. src/content/packs/sprigo-en-syllabus')
    parser.add_argument('--commit', default=DEFAULT_COMMIT, help='Source commit hash')
    parser.add_argument('--converted-at', default=None, help='Override converted_at (YYYY-MM-DD)')
    args = parser.parse_args(argv)

    with open(args.source, encoding='utf-8') as fh:
        course = yaml.safe_load(fh)
    levels = convert(course)
    copyright_text = copyright_line(find_license(args.source))

    os.makedirs(args.out_dir, exist_ok=True)
    syllabus_text = dump(levels)
    content_hash = hashlib.sha256(syllabus_text.encode('utf-8')).hexdigest()
    meta_path = os.path.join(args.out_dir, 'pack.json')
    meta = {
        'id': PACK_ID,
        'name': PACK_NAME,
        'version': PACK_VERSION,
        'license': 'MIT',
        'source': SOURCE_URL,
        'commit': args.commit,
        'copyright': copyright_text,
        'attribution': (
            'Syllabus structure, lesson titles, vocabulary lists and grammar patterns adapted from Sprigo '
            '(' + SOURCE_URL + ', courses/en.yml), ' + copyright_text + ', MIT License. Converted for B&T English.'
        ),
        'files': ['syllabus.json'],
        'content_sha256': content_hash,
        'converted_at': resolve_converted_at(meta_path, content_hash, args.converted_at),
    }
    write_if_changed(os.path.join(args.out_dir, 'syllabus.json'), syllabus_text)
    write_if_changed(meta_path, dump(meta))

    unit_count = sum(len(lv['units']) for lv in levels)
    lesson_count = sum(len(u['lessons']) for lv in levels for u in lv['units'])
    print('levels=%d units=%d lessons=%d' % (len(levels), unit_count, lesson_count))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
