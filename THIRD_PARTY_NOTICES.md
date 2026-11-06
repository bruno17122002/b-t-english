# Third-Party Notices

Lingua Quest includes or adapts material from the open-source projects listed below. Each is distributed under
the MIT License; the full license text with the original copyright line is reproduced for every project.
Material converted into content packs lives in `src/content/packs/<pack-id>/`, and each pack carries a `pack.json`
with its source URL, commit, copyright and attribution.

Original Lingua Quest additions (for example the Vietnamese `viNote` explanations in the Cadence pack) are not part
of the upstream projects.

---

## Sprigo

- **Project:** Sprigo
- **URL:** https://github.com/ozerozdas/sprigo
- **Commit:** `b89aba5cd57c89e1ff7be623f7941930c409a8dd`
- **License:** MIT
- **What Lingua Quest uses:** the English course syllabus (`courses/en.yml`): CEFR levels A1–C2, units, lesson
  (step) titles and descriptions, vocabulary lists, grammar patterns, activity types and level checkpoints. It is
  converted by `scripts/convert_sprigo_syllabus.py` into `src/content/packs/sprigo-en-syllabus/`. Prompts and
  schemas may be ported later (see `docs/OSS_RESEARCH.md` §3.1).

```
MIT License

Copyright (c) 2026 Mehmet Özer Özdaş

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Cadence

- **Project:** Cadence
- **URL:** https://github.com/pstepanovum/Cadence
- **Commit:** `9d94329239892032a343a1d3e64b60b08419d867`
- **License:** MIT
- **What Lingua Quest uses:**
  - Data, converted by `scripts/convert_cadence_pronunciation.py` into `src/content/packs/cadence-pronunciation/`:
    the phoneme catalog (`src/backend/data/phoneme_catalog.json`), practice words with IPA
    (`src/backend/data/practice_targets.json`), the 10 pronunciation modules with their lessons and words
    (`supabase/modules.sql`) and the 10 scripted conversation scenarios (`src/lib/conversation.ts`).
  - Algorithm: the Levenshtein phoneme alignment from `src/backend/ai-engine/phoneme_scorer.py`, rewritten in
    TypeScript in `src/core/phonemes.ts`.
  - Not used: the Python speech engine, models, Supabase backend, Stripe integration and any audio.

```
MIT License

Copyright (c) 2026 Pavel Stepanov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## VocabReader

- **Project:** VocabReader
- **URL:** https://github.com/highsunday/VocabReader
- **Commit:** `39de8ec99a56f88c9594a1e2957e199baf311cc0`
- **License:** MIT
- **What Lingua Quest uses:** planned port of the vocabulary-review and reading-comprehension prompt
  specifications (`.agents/skills/*/SKILL.md`) into the Lingua Quest prompt library, and later an EPUB import
  feature modelled on its importer (see `docs/OSS_RESEARCH.md` §3.2). This notice is kept so that any ported
  material is covered.

```
MIT License

Copyright (c) 2026 highsunday

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## ts-fsrs

- **Project:** ts-fsrs (Open Spaced Repetition)
- **URL:** https://github.com/open-spaced-repetition/ts-fsrs
- **Version:** 6.0.0 (npm package `ts-fsrs`, dependency `^6.0.0`)
- **License:** MIT
- **What Lingua Quest uses:** the FSRS spaced-repetition scheduler, used as a library by `src/core/srs.ts`.

```
MIT License

Copyright (c) 2026 Open Spaced Repetition

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Projects consulted for ideas only

The following projects were reviewed for product and UX ideas. **No code, data, text or media was copied** from
them, because their licenses do not permit reuse in Lingua Quest. Any related features are independent
implementations written for Lingua Quest.

- **EchoType** (https://github.com/bill-gx114/echotype): no license file, so all rights are reserved by the author.
  Ideas only (three-stage dictation listening, retrying missed sentences, lenient scoring mode).
- **ThirtyTutors** (https://github.com/wiss84/thirtytutors): PolyForm Noncommercial License 1.0.0, which forbids
  commercial use. Ideas only (real-time voice tutor flow, rolling learner memory, correct-and-repeat drills).
- **Babblr** (https://github.com/pkuppens/babblr): AGPL-3.0 or a commercial license; copying would require
  releasing Lingua Quest under the AGPL. Ideas only (CEFR-based tutor constraints, structured error feedback).

---

## Libraries bundled in the application

The installed application ships the following open-source libraries (unmodified). Each is used under its own
license; full license texts are included in each package's `LICENSE` file and are available from the project pages.

| Library                         | Version | License                                                                                     | Used for                     |
| ------------------------------- | ------- | ------------------------------------------------------------------------------------------- | ---------------------------- |
| Electron (Chromium, Node.js)    | 44.10.2 | MIT (Chromium: BSD-3-Clause and others, see `LICENSES.chromium.html` in the install folder) | Desktop runtime              |
| React, React DOM                | 19.3.1  | MIT                                                                                         | User interface               |
| React Router                    | 7.18.5  | MIT                                                                                         | Navigation                   |
| Framer Motion                   | 12.43.0 | MIT                                                                                         | Animations                   |
| Lucide React                    | 1.68.0  | ISC                                                                                         | Icons                        |
| Zustand                         | 5.0.16  | MIT                                                                                         | UI state                     |
| Zod                             | 4.6.7   | MIT                                                                                         | Data validation              |
| sql.js                          | 1.15.2  | MIT (SQLite: public domain)                                                                 | Local database               |
| ts-fsrs                         | 6.0.0   | MIT                                                                                         | Spaced-repetition scheduling |
| @open-spaced-repetition/srs-kit | 1.0.0   | BSD-3-Clause                                                                                | Dependency of ts-fsrs        |

The interface uses the Windows system typeface Segoe UI Variable; no font files are bundled.
