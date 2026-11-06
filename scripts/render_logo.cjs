// Renders build/logo.svg to build/icon.png (1024 px, transparent) with Electron's own Chromium.
// Usage (repo root): npx electron --force-device-scale-factor=1 scripts/render_logo.cjs
// Then run `python -I scripts/make_icons.py` (ICO) and `python -I web/scripts/make_icons.py` (PWA icons).
const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

const ROOT = path.resolve(__dirname, '..')
const SIZE = 1024

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(ROOT, 'build', 'logo.svg'))
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  })
  const html = `<html><body style="margin:0;background:transparent"><img width="${SIZE}" height="${SIZE}" src="data:image/svg+xml;base64,${svg.toString('base64')}"></body></html>`
  await win.loadURL(`data:text/html,${encodeURIComponent(html)}`)
  await new Promise((r) => setTimeout(r, 400))
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE })
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.png'), image.resize({ width: SIZE, height: SIZE }).toPNG())
  console.log('wrote build/icon.png')
  app.quit()
})
