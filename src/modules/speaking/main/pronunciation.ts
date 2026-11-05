// Loads and validates the Cadence pronunciation pack (MIT) bundled under src/content/packs.
import { PronunciationPackSchema, type PronunciationPack } from '@shared/packs'
import conversations from '@content/packs/cadence-pronunciation/conversations.json'
import modules from '@content/packs/cadence-pronunciation/modules.json'
import meta from '@content/packs/cadence-pronunciation/pack.json'
import phonemes from '@content/packs/cadence-pronunciation/phonemes.json'
import targets from '@content/packs/cadence-pronunciation/targets.json'
import type { PackAttribution } from '../contract'

let cached: { pack: PronunciationPack | null; error: string | null } | null = null

/** Validated pack, or null (with an error message) when the bundled files are broken. */
export function loadPronunciationPack(): { pack: PronunciationPack | null; error: string | null } {
  if (cached) return cached
  const parsed = PronunciationPackSchema.safeParse({ meta, phonemes, modules, targets, conversations })
  cached = parsed.success
    ? { pack: parsed.data, error: null }
    : {
        pack: null,
        error: parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      }
  return cached
}

export function attributionOf(pack: PronunciationPack): PackAttribution {
  return {
    name: pack.meta.name,
    license: pack.meta.license,
    source: pack.meta.source,
    copyright: pack.meta.copyright,
    attribution: pack.meta.attribution,
  }
}
