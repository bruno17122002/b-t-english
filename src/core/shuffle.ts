// Shuffling helpers so tests and quizzes are not identical on every attempt. Pure and shared by main and
// renderer: pass a seeded rng (see `seededRandom` in ./dates) when the order must be reproducible, e.g. on the
// server where every call recomputes the current question.
import { hashString, seededRandom } from './dates'

/** Seeded rng from any string key: the same key always gives the same sequence. */
export function rngFor(key: string): () => number {
  return seededRandom(hashString(key))
}

/** Fisher–Yates shuffle into a new array. */
export function shuffled<T>(xs: readonly T[], rng: () => number = Math.random): T[] {
  const out = [...xs]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j] as T, out[i] as T]
  }
  return out
}

/** Random permutation of `0..n-1`. */
export function permutation(n: number, rng: () => number = Math.random): number[] {
  return shuffled(
    Array.from({ length: n }, (_, i) => i),
    rng,
  )
}

const FIXED_SETS = [
  ['true', 'false', 'not given'],
  ['yes', 'no', 'not given'],
  ['true', 'false'],
  ['yes', 'no'],
]
const POSITIONAL = /\b(all|none|both|neither) of (the )?(above|these|them)\b|^(a|b) and (a|b)$/i

/**
 * Options whose order carries meaning (True / False / Not Given, "All of the above") must stay put;
 * everything else can be shuffled.
 */
export function keepsOptionOrder(options: readonly string[]): boolean {
  const norm = options.map((o) => o.trim().toLowerCase().replace(/[.!]$/, ''))
  if (FIXED_SETS.some((set) => set.length === norm.length && set.every((s, i) => norm[i] === s))) return true
  return options.some((o) => POSITIONAL.test(o.trim()))
}

/**
 * Display order for a question's options: `order[displayIndex] = originalIndex`. Identity when the options
 * must keep their order. Grade with the original index (`order[displayIndex]`) so answer keys stay valid.
 */
export function optionOrder(options: readonly string[], rng: () => number = Math.random): number[] {
  if (keepsOptionOrder(options)) return options.map((_, i) => i)
  return permutation(options.length, rng)
}

/** Picks one element at random (undefined for an empty list). */
export function pickOne<T>(xs: readonly T[], rng: () => number = Math.random): T | undefined {
  return xs.length ? xs[Math.floor(rng() * xs.length)] : undefined
}
