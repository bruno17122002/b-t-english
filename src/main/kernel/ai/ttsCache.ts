// Disk cache for AI text-to-speech. The same sentence (engine + voice + speed + text) is synthesised once and
// then played instantly, even after a restart. Least-recently-used files are evicted above the size limit.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const EXT: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/wav': 'wav' }

export class TtsCache {
  constructor(
    private readonly dir: string,
    private readonly maxBytes = 150 * 1024 * 1024,
  ) {}

  private file(key: string, ext: string) {
    return path.join(this.dir, `${crypto.createHash('sha256').update(key).digest('hex').slice(0, 40)}.${ext}`)
  }

  get(key: string): { data: Uint8Array; mimeType: string } | null {
    for (const [mimeType, ext] of Object.entries(EXT)) {
      const f = this.file(key, ext)
      if (!fs.existsSync(f)) continue
      try {
        const now = new Date()
        fs.utimesSync(f, now, now) // mark as recently used
        return { data: new Uint8Array(fs.readFileSync(f)), mimeType }
      } catch {
        return null
      }
    }
    return null
  }

  set(key: string, data: Uint8Array, mimeType: string): void {
    const ext = EXT[mimeType]
    if (!ext) return
    try {
      fs.mkdirSync(this.dir, { recursive: true })
      fs.writeFileSync(this.file(key, ext), data)
      this.prune()
    } catch {
      /* caching is best effort */
    }
  }

  private prune() {
    const files = fs
      .readdirSync(this.dir)
      .map((name) => {
        const f = path.join(this.dir, name)
        const st = fs.statSync(f)
        return { f, size: st.size, at: st.mtimeMs }
      })
      .sort((a, b) => b.at - a.at)
    let total = 0
    for (const x of files) {
      total += x.size
      if (total > this.maxBytes) fs.rmSync(x.f, { force: true })
    }
  }
}
