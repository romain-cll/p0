import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, protocol } from 'electron'
import { handleApiRequest } from './api'

const here = fileURLToPath(new URL('.', import.meta.url))
const isE2E = process.env['P0_E2E'] === '1'

// The renderer reaches the main process with `fetch` on `p0://api` (docs/features/claude-code-chat.md, Decision 6).
// Both privileges are required: without them the fetch fails.
protocol.registerSchemesAsPrivileged([
  { scheme: 'p0', privileges: { supportFetchAPI: true, corsEnabled: true } }
])

// The e2e suite runs on a throwaway userData, so it never touches the real projects.
if (isE2E && process.env['P0_USER_DATA_DIR']) {
  app.setPath('userData', process.env['P0_USER_DATA_DIR'])
}

function createWindow(): BrowserWindow {
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

  return window
}

void app.whenReady().then(() => {
  const projectsFile = join(app.getPath('userData'), 'projects.json')
  let window: BrowserWindow

  // `dialog.showOpenDialog` is looked up at each request, which lets the e2e replace it.
  const pickFolder = async (): Promise<string | null> => {
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      properties: ['openDirectory', 'createDirectory']
    })
    return canceled ? null : filePaths[0]
  }

  protocol.handle('p0', (request) => handleApiRequest(request, { projectsFile, pickFolder }))
  window = createWindow()
})

app.on('window-all-closed', () => app.quit())
