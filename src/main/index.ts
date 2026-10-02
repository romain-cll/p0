import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, protocol } from 'electron'
import { createClaudeCodeAdapter } from './agents/claude-code'
import { handleApiRequest, stopAll } from './api'
import { guardNavigation } from './navigation'

type AdapterQuery = NonNullable<NonNullable<Parameters<typeof createClaudeCodeAdapter>[0]>['query']>

const here = fileURLToPath(new URL('.', import.meta.url))
const isE2E = process.env['P0_E2E'] === '1'
const appUrl = process.env['ELECTRON_RENDERER_URL'] ?? pathToFileURL(join(here, '../renderer/index.html')).href

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

  // Only the app's own page may run in the window: the scheme handler cannot tell which page sent a request.
  guardNavigation(window.webContents, appUrl)

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

void app.whenReady().then(async () => {
  const projectsFile = join(app.getPath('userData'), 'projects.json')
  let window: BrowserWindow

  // `dialog.showOpenDialog` is looked up at each request, which lets the e2e replace it.
  const pickFolder = async (): Promise<string | null> => {
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      properties: ['openDirectory', 'createDirectory']
    })
    return canceled ? null : filePaths[0]
  }

  // The e2e suite replaces the SDK's `query` with a fake, loaded from its path at run time (never bundled).
  const fakeQuery = isE2E ? process.env['P0_FAKE_SDK_QUERY'] : undefined
  const adapter = createClaudeCodeAdapter(
    fakeQuery
      ? { query: ((await import(/* @vite-ignore */ pathToFileURL(fakeQuery).href)) as { query: AdapterQuery }).query }
      : {}
  )

  protocol.handle('p0', (request) => handleApiRequest(request, { projectsFile, pickFolder, adapter }))
  window = createWindow()
})

app.on('will-quit', stopAll)

app.on('window-all-closed', () => app.quit())
