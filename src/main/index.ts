import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'

const here = fileURLToPath(new URL('.', import.meta.url))

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    titleBarStyle: 'hidden',
    titleBarOverlay: { height: 40 },
    show: false
  })

  window.once('ready-to-show', () => window.show())

  if (process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(here, '../renderer/index.html'))
  }
}

void app.whenReady().then(createWindow)

app.on('window-all-closed', () => app.quit())
