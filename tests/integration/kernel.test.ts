import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AiConfigView, GameState, Profile, Reward, VocabItem } from '../../src/shared/types'
import { CONTRACT } from '../../src/modules/contract'
import { makeApp, makeKernel } from '../helpers/kernel'

describe('kernel IPC', () => {
  it('registers a handler for every channel in the contract', async () => {
    const { router } = await makeApp()
    expect(router.missing()).toEqual([])
    expect(Object.keys(CONTRACT).length).toBeGreaterThan(50)
  })

  it('rejects unknown channels and invalid payloads without throwing', async () => {
    const { router } = await makeApp()
    const unknown = await router.dispatch('nope:nothing', {})
    expect(unknown.ok).toBe(false)
    const bad = await router.dispatch('vocab:save', { word: '', sourceModule: 'reading' })
    expect(bad).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
    const badModule = await router.dispatch('vocab:save', { word: 'hello', sourceModule: 'hacker' })
    expect(badModule.ok).toBe(false)
  })

  it('bootstraps a first-run profile', async () => {
    const { call } = await makeApp()
    const boot = await call<{ isFirstRun: boolean; profile: Profile; game: GameState }>('app:bootstrap')
    expect(boot.isFirstRun).toBe(true)
    expect(boot.profile.targetCefr).toBe('B2')
    expect(boot.game.level).toBe(1)
    const updated = await call<Profile>('learner:updateProfile', { displayName: 'Lan', dailyMinutes: 30, onboardingCompleted: true })
    expect(updated.displayName).toBe('Lan')
    expect(updated.onboardingCompletedAt).not.toBeNull()
  })

  it('saves a word once, schedules it, reviews it and awards XP', async () => {
    const { call, kernel } = await makeApp()
    const rewards: Reward[] = []
    kernel.progress.onReward((r) => rewards.push(r))
    const first = await call<{ item: VocabItem; created: boolean }>('vocab:save', {
      word: 'Resilient',
      meaningVi: 'kiên cường',
      sourceModule: 'reading',
      examples: ['She is resilient.'],
    })
    expect(first.created).toBe(true)
    expect(first.item.review.state).toBe('new')
    const again = await call<{ item: VocabItem; created: boolean }>('vocab:save', {
      word: ' resilient ',
      sourceModule: 'listening',
      examples: ['A resilient city.'],
    })
    expect(again.created).toBe(false)
    expect(again.item.examples).toHaveLength(2)
    const due = await call<{ id: number; preview: Record<string, string> }[]>('vocab:due')
    expect(due).toHaveLength(1)
    expect(due[0]?.preview['3']).toBeTruthy()
    const reviewed = await call<VocabItem>('vocab:review', { id: first.item.id, rating: 3, durationMs: 4000 })
    expect(reviewed.review.reps).toBe(1)
    const game = await call<GameState>('progress:game')
    expect(game.totalXp).toBeGreaterThan(0)
    expect(game.streak.activeToday).toBe(true)
    expect(rewards.length).toBeGreaterThan(0)
  })

  it('stores API keys encrypted and never returns them', async () => {
    const { call, dir } = await makeApp()
    const key = 'AIzaSyTESTKEY_1234567890abcdefghijk'
    const res = await call<{ persisted: boolean; config: AiConfigView }>('ai:setKey', { provider: 'gemini', key })
    expect(res.persisted).toBe(true)
    expect(res.config.providers.gemini.hasKey).toBe(true)
    expect(res.config.providers.gemini.keyHint).toBe('••••hijk')
    expect(JSON.stringify(res)).not.toContain(key)
    const raw = fs.readFileSync(path.join(dir, 'secure', 'keys.bin'), 'utf8')
    expect(raw).not.toContain(key)
    expect(raw).not.toContain('AIza')
    const removed = await call<AiConfigView>('ai:removeKey', { provider: 'gemini' })
    expect(removed.providers.gemini.hasKey).toBe(false)
  })

  it('creates, validates and lists backups, and blocks deleting files outside the backup folder', async () => {
    const { call, kernel } = await makeApp({ persistent: true })
    await call('vocab:save', { word: 'harbour', sourceModule: 'manual' })
    const b = await call<{ file: string; sizeBytes: number }>('data:createBackup')
    expect(b.sizeBytes).toBeGreaterThan(1000)
    await expect(kernel.data.validateBackup(b.file)).resolves.toMatchObject({ words: 1 })
    const list = await call<unknown[]>('data:backups')
    expect(list).toHaveLength(1)
    const outside = await call('data:deleteBackup', { file: kernel.paths.dbFile }).catch((e: Error) => e)
    expect(outside).toBeInstanceOf(Error)
  })

  it('exports vocabulary to CSV and imports it back', async () => {
    const { kernel } = await makeKernel()
    kernel.vocab.save({ word: 'brave, bold', meaningVi: 'dũng cảm "can đảm"', sourceModule: 'manual' })
    const csv = kernel.data.vocabularyCsv()
    const { kernel: other } = await makeKernel()
    const res = other.data.importVocabulary(csv, 'csv')
    expect(res).toEqual({ added: 1, merged: 0, skipped: 0 })
    expect(other.vocab.findByWord('brave, bold')?.meaningVi).toBe('dũng cảm "can đảm"')
  })

  it('searches pages, content and vocabulary without diacritics', async () => {
    const { call } = await makeApp()
    await call('vocab:save', { word: 'lighthouse', meaningVi: 'ngọn hải đăng', sourceModule: 'manual' })
    const res = await call<{ kind: string }[]>('search:query', { q: 'hai dang' })
    expect(res.some((r) => r.kind === 'vocab')).toBe(true)
    const pages = await call<{ kind: string; route: string }[]>('search:query', { q: 'cai dat' })
    expect(pages.some((r) => r.route === '/settings')).toBe(true)
  })

  it('loads all bundled content without validation issues', async () => {
    const { kernel } = await makeKernel()
    expect(kernel.content.reading().length).toBeGreaterThanOrEqual(18)
    expect(kernel.content.stories().length).toBe(7)
    expect(kernel.content.assessment().length).toBe(96)
    expect(kernel.content.dictionary().length).toBeGreaterThan(400)
    expect(kernel.content.issues).toEqual([])
  })
})
