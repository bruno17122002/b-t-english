// API keys encrypted with Electron safeStorage (DPAPI on Windows). Keys never enter SQLite, logs,
// backups or exports; the renderer only ever sees a masked hint.
import fs from 'node:fs'
import path from 'node:path'
import type { UserProviderId } from '@shared/types'
import { writeFileAtomic } from '../../db/database'

export interface Cipher {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

type Stored = Partial<Record<UserProviderId, string>> // base64 ciphertext

export class KeyStore {
  /** Used only when OS encryption is unavailable: keys live for this session and are never written. */
  private readonly memory = new Map<UserProviderId, string>()

  constructor(
    private readonly file: string,
    private readonly cipher: Cipher,
  ) {}

  get encryptionAvailable(): boolean {
    try {
      return this.cipher.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  private read(): Stored {
    try {
      if (!fs.existsSync(this.file)) return {}
      return JSON.parse(fs.readFileSync(this.file, 'utf8')) as Stored
    } catch {
      return {}
    }
  }

  private write(data: Stored) {
    writeFileAtomic(this.file, new TextEncoder().encode(JSON.stringify(data)))
  }

  get(provider: UserProviderId): string | null {
    const mem = this.memory.get(provider)
    if (mem) return mem
    const enc = this.read()[provider]
    if (!enc || !this.encryptionAvailable) return null
    try {
      return this.cipher.decryptString(Buffer.from(enc, 'base64'))
    } catch {
      return null // encrypted by another Windows user / machine
    }
  }

  has(provider: UserProviderId): boolean {
    return this.get(provider) !== null
  }

  /** Masked hint such as "••••3xQz" – the only form a key ever leaves the main process. */
  hint(provider: UserProviderId): string | null {
    const key = this.get(provider)
    return key ? `••••${key.slice(-4)}` : null
  }

  set(provider: UserProviderId, key: string): { persisted: boolean } {
    const clean = normalizeKey(key)
    if (!this.encryptionAvailable) {
      this.memory.set(provider, clean)
      return { persisted: false }
    }
    const data = this.read()
    data[provider] = this.cipher.encryptString(clean).toString('base64')
    this.write(data)
    this.memory.delete(provider)
    return { persisted: true }
  }

  remove(provider: UserProviderId): void {
    this.memory.delete(provider)
    const data = this.read()
    delete data[provider]
    if (fs.existsSync(this.file) || Object.keys(data).length) this.write(data)
  }

  static defaultPath(userDataDir: string): string {
    return path.join(userDataDir, 'secure', 'keys.bin')
  }
}

export class InvalidKeyFormatError extends Error {
  constructor() {
    super('API key format looks wrong (no spaces, 20–300 characters).')
  }
}

export function normalizeKey(key: string): string {
  const clean = key.trim()
  if (clean.length < 20 || clean.length > 300 || /\s/.test(clean)) throw new InvalidKeyFormatError()
  return clean
}
