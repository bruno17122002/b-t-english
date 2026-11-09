import { describe, expect, it } from 'vitest'
import { outputConfigFor } from '../../src/main/kernel/ai/gemini'
import { AdviceSchema } from '../../src/modules/coach/main/prompts'
import { outputConfigFor as serverOutputConfigFor, strList } from '../../supabase/functions/_shared/gemini'

describe('Gemini output budget', () => {
  it('switches thinking off for Flash so small JSON answers are not cut off', () => {
    for (const f of [outputConfigFor, serverOutputConfigFor]) {
      expect(f('gemini-2.5-flash', 400)).toEqual({ maxOutputTokens: 400, thinkingConfig: { thinkingBudget: 0 } })
      expect(f('gemini-2.5-flash-lite', 200).thinkingConfig).toEqual({ thinkingBudget: 0 })
      expect(f('gemini-2.5-pro', 400)).toEqual({ maxOutputTokens: 1424, thinkingConfig: { thinkingBudget: 1024 } })
      expect(f('gemini-2.0-flash', 400)).toEqual({ maxOutputTokens: 400 })
    }
  })
})

describe('lenient advice fields', () => {
  it('flattens objects and cuts long strings instead of rejecting the report', () => {
    const shape = AdviceSchema.shape.bestStudyTimes
    expect(shape.parse([{ time: '19:00–21:00', reason: 'bạn học đều nhất' }, 'x'.repeat(300)])).toEqual([
      '19:00–21:00 – bạn học đều nhất',
      'x'.repeat(120),
    ])
    expect(shape.safeParse([{}]).success).toBe(false)
    expect(strList([{ time: '07:00', reason: 'sáng' }, 'tối', 42], 4, 120)).toEqual(['07:00 – sáng', 'tối'])
  })
})
