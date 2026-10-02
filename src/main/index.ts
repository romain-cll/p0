import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'

const here = fileURLToPath(new URL('.', import.meta.url))
const isE2E = process.env['P0_E2E'] === '1'

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

  // The e2e suite sets P0_E2E=1: the window is never shown, so it never takes the focus.
  // See docs/features/e2e-quiet-runs.md.
  if (!isE2E) {
    window.once('ready-to-show', () => window.show())
  }

  if (process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(here, '../renderer/index.html'))
  }
}

void app.whenReady().then(createWindow)

app.on('window-all-closed', () => app.quit())
