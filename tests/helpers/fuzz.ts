// Schema-driven input generator for the IPC abuse tests. Walks a zod 4 schema to build one valid sample,
// then derives hostile variants: every leaf replaced by wrong types, boundary values and nasty strings,
// fields removed, unknown / prototype-pollution keys added, and generic garbage payloads.
import type { z } from 'zod'

interface Def {
  type: string
  [k: string]: unknown
}
type Schema = z.ZodType
const defOf = (s: Schema): Def => (s as unknown as { _zod: { def: Def } })._zod.def

export const SECRET_GEMINI = 'AIzaSyFAKE-SECRET-0123456789abcdefghijklmn'
export const SECRET_OPENAI = 'sk-proj-FAKESECRET0123456789abcdefABCDEF'

/** Hostile strings: whitespace, huge, emoji / ZWJ / flags, zero-width, RTL override, combining marks, markup, SQL, regex. */
export const NASTY_STRINGS: [string, string][] = [
  ['empty', ''],
  ['spaces', '   '],
  ['newlines', '\n\r\n\t'],
  ['100k chars', 'a'.repeat(100_000)],
  ['100k spaces+word', ' '.repeat(50_000) + 'word' + ' '.repeat(50_000)],
  ['emoji', '😀👩\u200d👩\u200d👧\u200d👦🇻🇳🏳️\u200d🌈'],
  ['zero-width', 'he\u200bllo\u200d\u2060\ufeff'],
  ['rtl override', '\u202eevil\u202c txt.exe'],
  ['combining', 'é̂̃̄̅̆'.repeat(50)],
  ['html', '<script>alert(1)</script><img src=x onerror=alert(1)>'],
  ['sql', "'; DROP TABLE vocabulary; --"],
  ['regex meta', '%_\\[](){}*+?^$|.'],
  ['nul byte', 'a\u0000b'],
  ['lone surrogate', 'x\ud800y'],
  ['vietnamese', 'Tiếng Việt đầy đủ dấu: ngọn hải đăng'],
  ['csv formula', '=HYPERLINK("http://evil","x")'],
  ['path traversal', '..\\..\\..\\Windows\\System32\\drivers\\etc\\hosts'],
  ['json', '{"__proto__":{"polluted":"yes"}}'],
]

export const NASTY_NUMBERS: [string, number][] = [
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['-Infinity', Number.NEGATIVE_INFINITY],
  ['-1', -1],
  ['0', 0],
  ['-0', -0],
  ['0.5', 0.5],
  ['1e308', 1e308],
  ['-1e308', -1e308],
  ['MAX_SAFE', Number.MAX_SAFE_INTEGER],
  ['2^53+2', 2 ** 53 + 2],
  ['not-existing id', 987_654],
]

const WRONG_TYPES: [string, unknown][] = [
  ['null', null],
  ['undefined', undefined],
  ['object', {}],
  ['array', []],
  ['bool', true],
  ['string', 'x'],
  ['number', 42],
]

function deepNested(depth: number): unknown {
  let o: Record<string, unknown> = { leaf: 1 }
  for (let i = 0; i < depth; i++) o = { a: o, id: 1 }
  return o
}

const protoPayload = (): Record<string, unknown> =>
  JSON.parse('{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}}}') as Record<
    string,
    unknown
  >

export const GENERIC_PAYLOADS: [string, unknown][] = [
  ['undefined', undefined],
  ['null', null],
  ['{}', {}],
  ['[]', []],
  ['0', 0],
  ['NaN', Number.NaN],
  ['string', 'hello'],
  ['true', true],
  ['deep nested 3000', deepNested(3000)],
  ['proto pollution', protoPayload()],
  ['Uint8Array(0)', new Uint8Array(0)],
  ['array of nulls', [null, null]],
]

const STRING_CANDIDATES = [
  'hello world example',
  'the-lost-key',
  'abcd-1234-efgh',
  '12:30',
  '2026-11-05',
  '123456',
  'lingua-quest-manual-2026-11-05-08-00-00.sqlite',
  'gemini-2.0-flash',
  '@lingua_bot',
  'abc',
  'a',
]

export function sample(schema: Schema): unknown {
  const d = defOf(schema)
  switch (d.type) {
    case 'optional':
    case 'nullable':
    case 'nonoptional':
    case 'readonly':
    case 'catch':
    case 'prefault':
      return sample(d.innerType as Schema)
    case 'default':
      return sample(d.innerType as Schema)
    case 'undefined':
    case 'void':
      return undefined
    case 'null':
      return null
    case 'boolean':
      return false
    case 'literal':
      return (d.values as unknown[])[0]
    case 'enum':
      return Object.values(d.entries as Record<string, unknown>)[0]
    case 'union':
      return sample((d.options as Schema[])[0] as Schema)
    case 'pipe':
      return sample(d.in as Schema)
    case 'array': {
      const min = (schema as unknown as { _zod: { bag: { minimum?: number } } })._zod.bag.minimum ?? 0
      return Array.from({ length: Math.max(1, min) }, () => sample(d.element as Schema))
    }
    case 'object': {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(d.shape as Record<string, Schema>)) out[k] = sample(v)
      return out
    }
    case 'record': {
      const keys = defOf(d.keyType as Schema)
      if (keys.type === 'enum') {
        const first = Object.values(keys.entries as Record<string, string>)[0] as string
        return { [first]: sample(d.valueType as Schema) }
      }
      return {}
    }
    case 'custom':
      return new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69])
    case 'number': {
      const n = schema as unknown as { minValue: number | null; maxValue: number | null; isInt: boolean }
      let v = 1
      if (n.minValue !== null && v < n.minValue) v = n.minValue
      if (n.maxValue !== null && v > n.maxValue) v = n.maxValue
      return v
    }
    case 'string': {
      const s = schema as unknown as { format: string | null; minLength: number | null }
      if (s.format === 'email') return 'learner@example.com'
      if (s.format === 'url') return 'https://github.com/x'
      if (s.format === 'datetime') return '2026-11-05T08:00:00.000Z'
      for (const c of STRING_CANDIDATES) {
        const padded = c.length < (s.minLength ?? 0) ? c.padEnd(s.minLength ?? 0, 'a') : c
        if (schema.safeParse(padded).success) return padded
      }
      return 'a'.repeat(Math.max(1, s.minLength ?? 1))
    }
    default:
      return undefined
  }
}

type Leaf = { path: (string | number)[]; schema: Schema }

/** Leaves (and containers) of a sample with the schema that validates them. */
function leaves(schema: Schema, path: (string | number)[] = []): Leaf[] {
  const d = defOf(schema)
  switch (d.type) {
    case 'optional':
    case 'nullable':
    case 'default':
    case 'nonoptional':
    case 'readonly':
    case 'catch':
    case 'prefault':
      return leaves(d.innerType as Schema, path)
    case 'pipe':
      return leaves(d.in as Schema, path)
    case 'object': {
      const out: Leaf[] = path.length ? [{ path, schema }] : []
      for (const [k, v] of Object.entries(d.shape as Record<string, Schema>)) out.push(...leaves(v, [...path, k]))
      return out
    }
    case 'array':
      return [{ path, schema }, ...leaves(d.element as Schema, [...path, 0])]
    case 'record': {
      const keys = defOf(d.keyType as Schema)
      if (keys.type === 'enum') {
        const first = Object.values(keys.entries as Record<string, string>)[0] as string
        return [{ path, schema }, ...leaves(d.valueType as Schema, [...path, first])]
      }
      return [{ path, schema }]
    }
    default:
      return path.length ? [{ path, schema }] : []
  }
}

const innermost = (s: Schema): Def => {
  let d = defOf(s)
  while (['optional', 'nullable', 'default', 'nonoptional', 'readonly', 'catch', 'prefault', 'pipe'].includes(d.type))
    d = defOf((d.innerType ?? d.in) as Schema)
  return d
}

function setAt(obj: unknown, path: (string | number)[], value: unknown, remove = false): unknown {
  const root = structuredClone(obj)
  let cur = root as Record<string | number, unknown>
  for (const k of path.slice(0, -1)) cur = cur[k] as Record<string | number, unknown>
  const last = path[path.length - 1] as string | number
  if (remove) delete cur[last]
  else cur[last] = value
  return root
}

function valuesFor(schema: Schema): [string, unknown][] {
  const d = innermost(schema)
  const out: [string, unknown][] = [...WRONG_TYPES]
  switch (d.type) {
    case 'string': {
      const inner = (() => {
        let s = schema
        while (innermost(s) !== defOf(s)) {
          const dd = defOf(s)
          s = (dd.innerType ?? dd.in) as Schema
        }
        return s as unknown as { maxLength: number | null }
      })()
      out.push(...NASTY_STRINGS)
      if (inner.maxLength) {
        out.push(['max length', 'ạ'.repeat(inner.maxLength)])
        out.push(['max length + 1', 'a'.repeat(inner.maxLength + 1)])
      }
      break
    }
    case 'number':
      out.push(...NASTY_NUMBERS)
      break
    case 'enum':
      for (const v of Object.values(d.entries as Record<string, unknown>)) out.push([`enum ${String(v)}`, v])
      out.push(['enum bogus', 'NOT_AN_OPTION'])
      break
    case 'array':
      out.push(['empty array', []])
      out.push(['10k elements', Array.from({ length: 10_000 }, () => sample(d.element as Schema))])
      out.push(['array of null', [null]])
      out.push(['array-like', { length: 3, 0: 'a' }])
      break
    case 'custom':
      out.push(['Uint8Array(0)', new Uint8Array(0)])
      out.push(['Uint8Array(26MB)', new Uint8Array(26 * 1024 * 1024)])
      out.push(['Uint8Array garbage', new Uint8Array([0xff, 0xfe, 0, 1, 2, 3, 0x89, 0x50])])
      out.push(['plain number array', [1, 2, 3]])
      break
    case 'object':
    case 'record':
      out.push(['proto keys', protoPayload()])
      break
  }
  return out
}

export interface Variant {
  desc: string
  payload: unknown
}

export function variants(schema: Schema): Variant[] {
  const base = sample(schema)
  const out: Variant[] = [{ desc: 'valid sample', payload: base }]
  for (const [desc, payload] of GENERIC_PAYLOADS) out.push({ desc: `generic ${desc}`, payload })
  if (base && typeof base === 'object' && !Array.isArray(base) && !(base instanceof Uint8Array)) {
    out.push({ desc: 'extra field', payload: { ...base, extraField: 'x', isAdmin: true } })
    out.push({ desc: 'proto keys merged', payload: Object.assign(protoPayload(), base) })
    for (const leaf of leaves(schema)) {
      const p = leaf.path.join('.')
      out.push({ desc: `${p} removed`, payload: setAt(base, leaf.path, undefined, true) })
      for (const [d, v] of valuesFor(leaf.schema)) out.push({ desc: `${p} = ${d}`, payload: setAt(base, leaf.path, v) })
    }
  }
  return out
}

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout after ${ms} ms: ${label}`)), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}
