// Font audit on the real renderer: asks Chromium (CDP CSS.getPlatformFontsForNode) which installed font actually
// drew every text node on every page, in Vietnamese and English UI. Any glyph drawn by a font outside the
// Windows 11 system set means a missing glyph / font fallback ("lỗi font") and fails the test.
import { expect, test, type Page } from '@playwright/test'
import { launchApp, type LaunchedApp } from './fixtures'

const ALLOWED = new Set([
  'Segoe UI Variable',
  'Segoe UI Variable Text',
  'Segoe UI Variable Display',
  'Segoe UI Variable Small',
  'Segoe UI',
  'Segoe UI Semibold',
  'Segoe UI Bold',
  'Segoe UI Emoji',
  'Segoe UI Symbol',
])

const ROUTES = [
  '/',
  '/journey',
  '/journey/course',
  '/listening',
  '/listening/:listening',
  '/speaking',
  '/speaking/pronunciation',
  '/reading',
  '/reading/:reading',
  '/writing',
  '/grammar',
  '/grammar/:grammar',
  '/vocabulary',
  '/cinema',
  '/cinema/:cinema',
  '/tutor',
  '/game',
  '/stats',
  '/library',
  '/settings/general',
  '/settings/ai',
  '/settings/data',
  '/settings/about',
]

let lq: LaunchedApp
const ids: Record<string, string> = {}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  lq = await launchApp()
  const found = await lq.page.evaluate(async () => {
    await window.lq.invoke('learner:updateProfile', {
      displayName: 'Nguyễn Thị Ánh Tuyết',
      interests: ['travel'],
      purposes: ['ielts'],
      onboardingCompleted: true,
    })
    await window.lq.invoke('journey:placementSkip')
    // Save a Vietnamese-heavy word so the vocabulary page renders real diacritics and IPA.
    await window.lq.invoke('vocab:save', {
      word: 'thoroughly',
      ipa: '/ˈθʌrəli/',
      meaningVi: 'một cách kỹ lưỡng, tỉ mỉ; triệt để',
      sourceModule: 'manual',
      examples: ['She checked the essay thoroughly.'],
    })
    const data = async <T>(channel: string): Promise<T | null> => {
      const res = await window.lq.invoke(channel)
      return res.ok ? (res.data as T) : null
    }
    const reading = await data<{ passages: { id: string }[] }>('reading:library')
    const cinema = await data<{ stories: { id: string }[] }>('cinema:list')
    const grammar = await data<{ castles: { topics: { id: string }[] }[] }>('grammar:overview')
    const listening = await data<{ id: string }[]>('listening:list')
    return {
      reading: reading?.passages[0]?.id ?? '',
      cinema: cinema?.stories[0]?.id ?? '',
      grammar: grammar?.castles[0]?.topics[0]?.id ?? '',
      listening: listening?.[0]?.id ?? '',
    }
  })
  Object.assign(ids, found)
  await lq.page.reload()
})

test.afterAll(async () => {
  await lq?.close()
})

interface Usage {
  family: string
  glyphs: number
}

async function auditPage(page: Page): Promise<{ fonts: Map<string, number>; offenders: string[] }> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  const { root } = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as { root: { nodeId: number } }
  // Elements that directly contain non-whitespace text.
  await page.evaluate(() => {
    document.querySelectorAll('[data-font-audit]').forEach((e) => e.removeAttribute('data-font-audit'))
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let n: Node | null
    while ((n = walker.nextNode())) {
      const el = n.parentElement
      if (el && n.textContent?.trim() && el.getClientRects().length) el.setAttribute('data-font-audit', '1')
    }
  })
  const { nodeIds } = (await cdp.send('DOM.querySelectorAll', {
    nodeId: root.nodeId,
    selector: '[data-font-audit]',
  })) as {
    nodeIds: number[]
  }
  const fonts = new Map<string, number>()
  const offenders: string[] = []
  for (const nodeId of nodeIds) {
    const { fonts: used } = (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })) as {
      fonts: { familyName: string; glyphCount: number }[]
    }
    for (const f of used as Usage[] & { familyName: string; glyphCount: number }[]) {
      fonts.set(f.familyName, (fonts.get(f.familyName) ?? 0) + f.glyphCount)
      if (!ALLOWED.has(f.familyName)) {
        const { outerHTML } = (await cdp.send('DOM.getOuterHTML', { nodeId })) as { outerHTML: string }
        offenders.push(`${f.familyName} (${f.glyphCount} glyphs): ${outerHTML.replace(/\s+/g, ' ').slice(0, 160)}`)
      }
    }
  }
  await cdp.detach()
  return { fonts, offenders }
}

for (const lang of ['vi', 'en'] as const) {
  test(`every page renders only with Windows 11 system fonts (${lang.toUpperCase()} interface)`, async () => {
    const { page } = lq
    await page.evaluate(async (l) => {
      await window.lq.invoke('settings:update', { uiLanguage: l, theme: 'dark' })
    }, lang)
    await page.reload()
    const total = new Map<string, number>()
    const problems: string[] = []
    for (const r of ROUTES) {
      const route = r.replace(/:(\w+)$/, (_, k: string) => ids[k] ?? '')
      await page.evaluate((x) => (window.location.hash = `#${x}`), route)
      await page.waitForTimeout(700)
      const { fonts, offenders } = await auditPage(page)
      for (const [k, v] of fonts) total.set(k, (total.get(k) ?? 0) + v)
      problems.push(...offenders.map((o) => `${route}: ${o}`))
    }
    console.log(`[${lang}] fonts used:`, Object.fromEntries([...total].sort((a, b) => b[1] - a[1])))
    expect(problems, problems.join('\n')).toEqual([])
    // The interface itself must be drawn with Segoe UI Variable, not a fallback.
    const segoe = [...total].filter(([k]) => k.startsWith('Segoe UI Variable')).reduce((s, [, v]) => s + v, 0)
    const all = [...total].reduce((s, [, v]) => s + v, 0)
    expect(segoe / all).toBeGreaterThan(0.9)
  })
}

test('Vietnamese diacritics and IPA are drawn by the UI font, not a fallback', async () => {
  const { page } = lq
  await page.evaluate(() => (window.location.hash = '#/'))
  await page.waitForTimeout(400)
  const sample = await page.evaluate(() => {
    const div = document.createElement('div')
    div.id = 'font-sample'
    div.textContent =
      'ĂÂĐÊÔƠƯ ăâđêôơư Ắ Ằ Ẳ Ẵ Ặ Ấ Ầ Ẩ Ẫ Ậ Ế Ề Ể Ễ Ệ Ố Ồ Ổ Ỗ Ộ Ớ Ờ Ở Ỡ Ợ Ứ Ừ Ử Ữ Ự Ý Ỳ Ỷ Ỹ Ỵ ' +
      'Nguyễn Thị Ánh Tuyết học tiếng Anh mỗi ngày. /ˈθʌrəli/ /ðə/ /ʃ ʒ ŋ ɪ ʊ ɜː ɔː æ ə/'
    document.body.appendChild(div)
    return div.textContent.length
  })
  expect(sample).toBeGreaterThan(50)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  await page.waitForTimeout(200)
  const { root } = (await cdp.send('DOM.getDocument', { depth: -1 })) as { root: { nodeId: number } }
  const { nodeId } = (await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#font-sample' })) as {
    nodeId: number
  }
  const { fonts } = (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })) as {
    fonts: { familyName: string; postScriptName: string; glyphCount: number }[]
  }
  console.log('sample fonts:', fonts)
  // Every glyph (all Vietnamese letters with diacritics + IPA) comes from one font: Segoe UI Variable Text.
  expect(fonts.map((f) => [f.familyName, f.postScriptName])).toEqual([['Segoe UI Variable', 'Segoe-UI-Variable-Text']])
})
