// Small rotating file logger. Every line passes through redactSecrets so API keys can never be logged.
import fs from 'node:fs'
import path from 'node:path'
import { redactSecrets } from './ai/http'

export type LogLevel = 'info' | 'warn' | 'error'

export class Logger {
  private readonly file: string

  constructor(
    dir: string,
    private readonly maxBytes = 1_000_000,
    private readonly keep = 3,
  ) {
    fs.mkdirSync(dir, { recursive: true })
    this.file = path.join(dir, 'lingua-quest.log')
  }

  get path(): string {
    return this.file
  }

  log(level: LogLevel, message: string): void {
    const line = `${new Date().toISOString()} [${level}] ${redactSecrets(message).replace(/\s+/g, ' ').slice(0, 2000)}\n`
    try {
      this.rotate()
      fs.appendFileSync(this.file, line)
    } catch {
      /* logging must never crash the app */
    }
    if (process.env.NODE_ENV === 'development') console.log(line.trim())
  }

  info = (m: string) => this.log('info', m)
  warn = (m: string) => this.log('warn', m)
  error = (m: string) => this.log('error', m)

  private rotate() {
    if (!fs.existsSync(this.file) || fs.statSync(this.file).size < this.maxBytes) return
    for (let i = this.keep - 1; i >= 1; i--) {
      const src = `${this.file}.${i}`
      if (fs.existsSync(src)) fs.renameSync(src, `${this.file}.${i + 1}`)
    }
    fs.renameSync(this.file, `${this.file}.1`)
    const oldest = `${this.file}.${this.keep + 1}`
    if (fs.existsSync(oldest)) fs.unlinkSync(oldest)
  }

  tail(lines = 200): string {
    try {
      return fs.readFileSync(this.file, 'utf8').split('\n').slice(-lines).join('\n')
    } catch {
      return ''
    }
  }
}
