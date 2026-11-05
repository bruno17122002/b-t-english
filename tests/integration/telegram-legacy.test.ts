import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { importLegacyTelegramConfig, legacyConfigPath, TELEGRAM_FLAGS } from '../../src/main/kernel/telegram/legacy'
import { makeKernel } from '../helpers/kernel'

const FAKE_TOKEN = '123456789:AAFakeTokenForTests_abcdefghijklmn'
const FAKE_GEMINI = 'AIzaSyFAKE_legacy_import_key_1234567'

describe('legacy Telegram bot import', () => {
  it('moves token, chat id and Gemini key into the encrypted store and deletes the plain-text file', async () => {
    const { kernel, dir } = await makeKernel({ mockAi: false })
    const file = legacyConfigPath(dir)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(
      file,
      JSON.stringify({
        bot_token: FAKE_TOKEN,
        chat_id: '987654321',
        excel_path: 'C:/x.xlsx',
        gemini_api_key: FAKE_GEMINI,
        gemini_model: 'gemini-2.5-flash',
        gemini_image_model: 'gemini-3.1-flash-image',
        image_provider: 'pollinations',
      }),
    )
    const imported = importLegacyTelegramConfig(kernel)
    expect(imported).toEqual(['bot token', 'chat id', 'Gemini key'])
    expect(kernel.keys.get('telegram')).toBe(FAKE_TOKEN)
    expect(kernel.keys.get('gemini')).toBe(FAKE_GEMINI)
    expect(kernel.settings.getFlag(TELEGRAM_FLAGS.chatId)).toBe('987654321')
    expect(kernel.settings.getFlag(TELEGRAM_FLAGS.imageProvider)).toBe('pollinations')
    expect(fs.existsSync(file)).toBe(false)
    const keysFile = fs.readFileSync(path.join(dir, 'secure', 'keys.bin'), 'utf8')
    expect(keysFile).not.toContain('AAFakeToken')
    expect(importLegacyTelegramConfig(kernel)).toEqual([])
  })

  it('keeps an existing Gemini key and ignores malformed values', async () => {
    const { kernel, dir } = await makeKernel({ mockAi: false })
    kernel.ai.setKey('gemini', 'AIzaSyEXISTING_key_should_stay_123456')
    const file = legacyConfigPath(dir)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ bot_token: 'not-a-token', chat_id: 'abc', gemini_api_key: FAKE_GEMINI }))
    expect(importLegacyTelegramConfig(kernel)).toEqual([])
    expect(kernel.keys.get('gemini')).toBe('AIzaSyEXISTING_key_should_stay_123456')
    expect(kernel.keys.has('telegram')).toBe(false)
  })
})
