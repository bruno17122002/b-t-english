import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  combineAnalyses,
  creditedSpeakingSeconds,
  measureSpeaking,
  samePhoneme,
  sessionScore,
} from '../../src/modules/speaking/main/metrics'
import { decodeEntities, theoryHtmlToBlocks, theoryHtmlToText } from '../../src/modules/speaking/main/theory'
import { mockFeedback, FeedbackOutputSchema } from '../../src/modules/speaking/main/prompts'
import { PronunciationModulesSchema } from '../../src/shared/packs'
import { alignIpa } from '../../src/core/phonemes'

describe('theory html sanitizer', () => {
  it('converts allowlisted markup into blocks with bold/italic runs', () => {
    const blocks = theoryHtmlToBlocks(
      '<h2>Short Vowels</h2><p>English has <strong>five</strong> short vowels.</p><ul><li><strong>/æ/</strong> — <em>cat</em>. Jaw drops.</li><li>Two</li></ul>',
    )
    expect(blocks).toEqual([
      { type: 'heading', runs: [{ text: 'Short Vowels' }] },
      {
        type: 'paragraph',
        runs: [{ text: 'English has ' }, { text: 'five', strong: true }, { text: ' short vowels.' }],
      },
      {
        type: 'list',
        items: [
          [{ text: '/æ/', strong: true }, { text: ' — ' }, { text: 'cat', em: true }, { text: '. Jaw drops.' }],
          [{ text: 'Two' }],
        ],
      },
    ])
  })

  it('drops scripts, styles, event handlers and unknown tags', () => {
    const html =
      '<p onclick="alert(1)">Hi <script>alert("x")</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">link</a></p><style>p{}</style><iframe src="evil"></iframe><p>End</p>'
    const blocks = theoryHtmlToBlocks(html)
    const text = theoryHtmlToText(html)
    expect(text).toBe('Hi link\n\nEnd')
    expect(JSON.stringify(blocks)).not.toMatch(/alert|script|onerror|javascript|iframe|style/i)
  })

  it('decodes entities and keeps stray angle brackets as text', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &#233; &#x41; &#0; &bogus;')).toBe('a & b <c> é A  &bogus;')
    expect(theoryHtmlToText('<p>3 < 5 &amp; 5 > 3</p>')).toBe('3 < 5 & 5 > 3')
    expect(theoryHtmlToText('Loose text <b>bold</b>')).toBe('Loose text bold')
  })

  it('handles every theory lesson in the Cadence pack without leaving tags behind', () => {
    const raw = JSON.parse(
      readFileSync(resolve(__dirname, '../../src/content/packs/cadence-pronunciation/modules.json'), 'utf8'),
    ) as unknown
    const modules = PronunciationModulesSchema.parse(raw)
    const theory = modules.flatMap((m) => m.lessons).filter((l) => l.theoryHtml)
    expect(theory.length).toBeGreaterThanOrEqual(10)
    for (const l of theory) {
      const text = theoryHtmlToText(l.theoryHtml as string)
      expect(text.length).toBeGreaterThan(40)
      expect(text).not.toMatch(/<\/?[a-z][^>]*>/i)
    }
  })
})

describe('speaking metrics', () => {
  const a = { durationSec: 10, speakingSec: 8, pauseCount: 3, longestPauseSec: 1.26 }

  it('measures WPM, pauses and word accuracy', () => {
    const m = measureSpeaking(a, 'I would like a coffee please', 'I would like a cup of coffee please')
    expect(m.durationSec).toBe(10)
    expect(m.speakingSec).toBe(8)
    expect(m.pauseCount).toBe(3)
    expect(m.longestPauseSec).toBe(1.3)
    expect(m.wordsPerMinute).toBe(45)
    expect(m.missingWords).toEqual(['cup', 'of'])
    expect(m.wordAccuracy).toBeCloseTo(0.75)
  })

  it('works without a transcript', () => {
    const m = measureSpeaking(a, null, 'Hello there')
    expect(m.wordsPerMinute).toBeNull()
    expect(m.wordAccuracy).toBeNull()
    expect(creditedSpeakingSeconds(m, null)).toBe(8)
    const silent = measureSpeaking(
      { durationSec: 20, speakingSec: 0, pauseCount: 0, longestPauseSec: 0 },
      'one two three four five',
      null,
    )
    expect(creditedSpeakingSeconds(silent, 'one two three four five')).toBe(2)
  })

  it('combines recordings and scores sessions', () => {
    expect(combineAnalyses([a, { durationSec: 5, speakingSec: 4, pauseCount: 1, longestPauseSec: 2 }])).toEqual({
      durationSec: 15,
      speakingSec: 12,
      pauseCount: 4,
      longestPauseSec: 2,
    })
    const m = measureSpeaking(a, 'She go to school', null)
    expect(sessionScore(m, null)).toBeNull()
    const fb = FeedbackOutputSchema.parse(
      mockFeedback({ mode: 'free', prompt: '', target: null, transcript: 'She go to school', measured: m, cefr: 'A2' }),
    )
    expect(fb.grammar.corrections[0]?.better).toBe('She goes')
    expect(sessionScore(m, fb)).toBeGreaterThan(0)
    expect(sessionScore(m, fb)).toBeLessThanOrEqual(1)
  })

  it('treats accent variants as the same phoneme', () => {
    expect(samePhoneme('ɹ', 'r')).toBe(true)
    expect(samePhoneme('oʊ', 'əʊ')).toBe(true)
    expect(samePhoneme('θ', 't')).toBe(false)
    expect(alignIpa('ɹ ɛ d', 'r e d', { isSame: samePhoneme }).accuracy).toBe(1)
    expect(alignIpa('θ ɪ ŋ k', 't ɪ ŋ k', { isSame: samePhoneme }).substitutions).toBe(1)
  })
})
