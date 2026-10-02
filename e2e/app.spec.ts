import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'

// `CA<n>` refers to the acceptance criteria of docs/features/app-shell.md.
// `AC<n>` refers to the acceptance criteria of docs/features/hidden-titlebar.md.
// `chat AC<n>` refers to the acceptance criteria of docs/features/claude-code-chat.md (story 1:
// chat AC1, AC2 and AC3; story 2: chat AC5, AC6, AC7, AC10, AC11, AC12 and AC13).
// `chat guard` is the navigation guard of the same spec (story 2, task 10).
//
// claude-code-chat, story 2: the app runs its real Claude Code adapter on the fake SDK `query` of
// e2e/fake-sdk/query.mjs (`P0_FAKE_SDK_QUERY`, read by the main process only under `P0_E2E=1`), and the
// `PATH` of the app holds only the dummy `claude` of e2e/fake-sdk/bin, which refuses to run: no test can reach
// the real Claude Code. The fake's reply reads `You said: <prompt>`, `Mode: <mode>`, `Folder: <project>`,
// `Earlier in this chat: <earlier prompts | nothing>`; the markers `[tools]`, `[slow]`, `[auth]` and `[crash]`
// in a prompt pick a scenario (see the header of query.mjs).
// The conversation is the element with role `log` of the "Active chat" region; its items are the children of
// the log that have some text (`logItemsOf`). An error carries `role="alert"`.
// These tests run the built app (`electron-vite build` => out/main/index.js) in a real
// Electron: they require a macOS graphical session. See `npm run test:e2e`.
// The app is launched once for the whole file (`beforeAll`) and stays hidden: `P0_E2E=1` tells
// the main process never to show its window (docs/features/e2e-quiet-runs.md). Each test starts
// with `resetApp()`. The hooks check e2e-quiet-runs AC1 (`expectInBackground`): the window is
// neither visible nor focused, and the app is not the frontmost one.
const MAIN_ENTRY = resolve('out/main/index.js')

// claude-code-chat: the app reads and writes its projects in `<userData>/projects.json`. The e2e gives
// it a throwaway userData (`P0_USER_DATA_DIR`, read by the main process only under `P0_E2E=1`), so it
// never touches the real projects. The project folders the picker returns live in the same dir.
let tempDir: string
let userDataDir: string
let projectsFile: string

// claude-code-chat, story 2: the fake SDK and the `PATH` of the app (the dummy `claude` first, then system dirs).
const FAKE_SDK_DIR = resolve('e2e/fake-sdk')
const FAKE_PATH = `${join(FAKE_SDK_DIR, 'bin')}:/usr/bin:/bin:/usr/sbin:/sbin`
const FAKE_QUERY = join(FAKE_SDK_DIR, 'query.mjs')

const GAP = 8
const PANEL_MIN = 320
const CHAT_MIN = 360
const WINDOW_MIN: [number, number] = [1024, 640]

// Named so that they do not shadow the `{ app, page }` the tests destructure.
let electronApp: ElectronApplication
let appPage: Page

const INITIAL_SIZE: [number, number] = [1280, 800]
const INITIAL_PANEL_WIDTH = 400

/** e2e-guard-hardening AC1: the frontmost-app probe gives up after this delay instead of hanging. */
const PROBE_TIMEOUT_MS = 5_000

/**
 * PID of the frontmost app, read with `osascript`.
 * e2e-guard-hardening AC1: a probe that does not answer is killed and reported as a timeout.
 * e2e-guard-hardening AC4: an answer that is not a positive integer PID is an error, never a PID.
 */
function readFrontmostPid(): number {
  let output: string
  try {
    output = execFileSync(
      'osascript',
      [
        '-l',
        'JavaScript',
        '-e',
        "ObjC.import('AppKit'); $.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier"
      ],
      // SIGKILL: `execFileSync` waits for the child to exit, and a process blocked on a prompt may ignore SIGTERM.
      { timeout: PROBE_TIMEOUT_MS, killSignal: 'SIGKILL' }
    )
      .toString()
      .trim()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ETIMEDOUT') throw error
    throw new Error(
      `frontmost-app probe timed out after ${PROBE_TIMEOUT_MS} ms: osascript did not answer (a macOS permission prompt may be waiting)`,
      { cause: error }
    )
  }
  if (!/^[1-9][0-9]*$/.test(output)) {
    throw new Error(`frontmost-app probe returned an invalid answer: ${JSON.stringify(output)}`)
  }
  return Number(output)
}

/** e2e-quiet-runs AC1: the window is never shown or focused, and the app is not the frontmost one. */
async function expectInBackground(): Promise<void> {
  const window = await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    return { visible: win.isVisible(), focused: win.isFocused() }
  })
  expect(window, 'the window must be neither visible nor focused').toEqual({
    visible: false,
    focused: false
  })

  const frontmostPid = readFrontmostPid()
  expect(frontmostPid, 'the app must not be the frontmost one').not.toBe(electronApp.process().pid)
}

test.beforeAll(async () => {
  tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'p0-e2e-')))
  userDataDir = join(tempDir, 'user-data')
  projectsFile = join(userDataDir, 'projects.json')
  electronApp = await electron.launch({
    args: [MAIN_ENTRY],
    env: {
      ...process.env,
      PATH: FAKE_PATH,
      P0_E2E: '1',
      P0_USER_DATA_DIR: userDataDir,
      P0_FAKE_SDK_QUERY: FAKE_QUERY,
      P0_FAKE_CLAUDE_STATE: join(tempDir, 'fake-claude-state')
    } as Record<string, string>
  })
  appPage = await electronApp.firstWindow()
  await appPage.waitForLoadState('domcontentloaded')
  await expectInBackground()
  // The real Claude Code must never run: the main process has the dummy-only PATH and the fake SDK hook.
  const mainEnv = await electronApp.evaluate(() => ({
    PATH: process.env.PATH,
    fakeQuery: process.env.P0_FAKE_SDK_QUERY,
    e2e: process.env.P0_E2E
  }))
  expect(mainEnv.PATH, 'the main process must run with the fake-only PATH').toBe(FAKE_PATH)
  expect(mainEnv.fakeQuery, 'the main process must load the fake SDK query').toBe(FAKE_QUERY)
  expect(mainEnv.e2e).toBe('1')
})

test.afterAll(async () => {
  // e2e-guard-hardening AC2: `electron.launch` threw in `beforeAll`, its error is the one reported,
  // and there is no app to check or close.
  if (!electronApp) {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
    return
  }
  try {
    await expectInBackground()
  } finally {
    await electronApp.close()
    rmSync(tempDir, { recursive: true, force: true })
  }
})

/**
 * Puts the shared app back in its initial state: window size, system theme, color scheme
 * emulation, the fake-only `PATH` of the main process, no project (`projects.json` deleted), and a fresh
 * page (no chat, panel at its default width). The reload also stops any run left over by the previous test
 * (the stream is cancelled).
 * `colorScheme` defaults to `'light'`, like `electron.launch`; `null` turns the emulation off.
 */
async function resetApp(
  options: { colorScheme?: 'dark' | 'light' | null } = {}
): Promise<{ app: ElectronApplication; page: Page }> {
  const { colorScheme = 'light' } = options
  const app = electronApp
  const page = appPage

  await app.evaluate(({ BrowserWindow, nativeTheme }, size) => {
    nativeTheme.themeSource = 'system'
    BrowserWindow.getAllWindows()[0].setSize(size[0], size[1])
  }, INITIAL_SIZE)
  await expect
    .poll(async () => ({
      size: await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize()),
      inner: await page.evaluate(() => [window.innerWidth, window.innerHeight])
    }))
    .toEqual({ size: INITIAL_SIZE, inner: INITIAL_SIZE })

  await page.emulateMedia({ colorScheme })
  // chat AC13: a test may have changed the PATH of the main process to hide the CLI.
  await app.evaluate((_electron, path) => {
    process.env.PATH = path
  }, FAKE_PATH)
  // chat AC2 and AC3: the projects live on disk, so a test starts from an empty `projects.json`.
  rmSync(projectsFile, { force: true })
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await expectWidth(panelOf(page), INITIAL_PANEL_WIDTH)
  return { app, page }
}

/**
 * chat AC1: the native folder picker cannot be driven by Playwright. The main process calls
 * `dialog.showOpenDialog` when the request arrives, so replacing it here is enough: no production
 * code changes and no native UI opens. `null` simulates Cancel.
 */
async function stubFolderPicker(app: ElectronApplication, folder: string | null): Promise<void> {
  // The stub must never run if the app would use the real userData: it could add to the user's projects.
  const userData = await app.evaluate(({ app: electron }) => electron.getPath('userData'))
  expect(userData, 'the e2e must run on its own userData (P0_USER_DATA_DIR)').toBe(userDataDir)
  await app.evaluate(({ dialog }, picked) => {
    const counter = globalThis as unknown as { __pickerCalls: number }
    counter.__pickerCalls = 0
    dialog.showOpenDialog = (async () => {
      counter.__pickerCalls++
      return { canceled: picked === null, filePaths: picked === null ? [] : [picked] }
    }) as unknown as typeof dialog.showOpenDialog
  }, folder)
}

/** How many times the stubbed picker was opened since the last `stubFolderPicker`. */
const pickerCallsOf = (app: ElectronApplication): Promise<number> =>
  app.evaluate(() => (globalThis as unknown as { __pickerCalls: number }).__pickerCalls)

/** A real, empty folder `<tempDir>/projects/<name>`, like the one a user would pick. */
function makeFolder(name: string): string {
  const folder = join(tempDir, 'projects', name)
  mkdirSync(folder, { recursive: true })
  return folder
}

const railOf = (page: Page): Locator => page.getByRole('region', { name: 'Projects' })
const historyOf = (page: Page): Locator => page.getByRole('region', { name: 'Chat history' })
const addProjectButtonOf = (page: Page): Locator => railOf(page).getByRole('button', { name: 'Add project' })
/** The project buttons, in rail order: all the buttons of the rail except "Add project". */
const projectButtonsOf = (page: Page): Locator =>
  railOf(page).locator('button:not([aria-label="Add project"])')

/** Stubs the picker to return `folder`, clicks "Add project", and waits for the project to show up. */
async function addProject(app: ElectronApplication, page: Page, folder: string): Promise<void> {
  await stubFolderPicker(app, folder)
  await addProjectButtonOf(page).click()
  await expect(railOf(page).getByRole('button', { name: basename(folder), exact: true })).toBeVisible()
}

// --- claude-code-chat, story 2: chats ---
const messageBoxOf = (page: Page): Locator => chatOf(page).getByRole('textbox', { name: 'Message' })
const sendButtonOf = (page: Page): Locator => chatOf(page).getByRole('button', { name: 'Send' })
const stopButtonOf = (page: Page): Locator => chatOf(page).getByRole('button', { name: 'Stop' })
const logOf = (page: Page): Locator => chatOf(page).getByRole('log')
/** The items of the conversation: the children of the log that have some text. */
const logItemsOf = (page: Page): Locator => logOf(page).locator(':scope > *').filter({ hasText: /\S/ })
const alertsOf = (page: Page): Locator => logOf(page).getByRole('alert')
/** A chat of the history, by its title (the first line of its first message). */
const chatButtonOf = (page: Page, title: string): Locator =>
  historyOf(page).getByRole('button', { name: title, exact: true })

/** Clicks "New chat" (the first button of the history) and waits for the empty conversation. */
async function newChat(page: Page): Promise<void> {
  await historyOf(page).getByRole('button', { name: 'New chat', exact: true }).first().click()
  await expect(chatOf(page).getByText('No messages yet')).toBeVisible()
  await expect(messageBoxOf(page)).toBeEnabled()
}

/** Types `text` in the input of the active chat and presses Enter; waits for the input to be cleared. */
async function send(page: Page, text: string): Promise<void> {
  const box = messageBoxOf(page)
  await box.fill(text)
  await box.press('Enter')
  await expect(box).toHaveValue('')
}

/** A fresh app with project `atlas` selected and a new chat open. */
async function openChat(): Promise<{ app: ElectronApplication; page: Page; folder: string }> {
  const { app, page } = await resetApp()
  const folder = makeFolder('atlas')
  await addProject(app, page, folder)
  await newChat(page)
  return { app, page, folder }
}

/** Waits until the chat is not answering any more: Send is back and Stop is gone. */
async function expectIdle(page: Page): Promise<void> {
  await expect(sendButtonOf(page)).toBeVisible()
  await expect(stopButtonOf(page)).toHaveCount(0)
}

/** How many `tick N` chunks of a `[slow]` reply the conversation shows. */
const ticksIn = async (page: Page): Promise<number> =>
  ((await logOf(page).innerText()).match(/tick \d+/g) ?? []).length

const storedProjects = (): string[] => JSON.parse(readFileSync(projectsFile, 'utf8')) as string[]

const chatOf = (page: Page): Locator => page.getByRole('region', { name: 'Active chat' })
const panelOf = (page: Page): Locator => page.getByRole('region', { name: 'Artifacts and diff' })

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const result = await locator.boundingBox()
  if (!result) throw new Error('element has no box: not displayed')
  return result
}

const widthOf = async (locator: Locator): Promise<number> => (await box(locator)).width

/** Waits until the element's width reaches `expected` px (±1). */
async function expectWidth(locator: Locator, expected: number): Promise<void> {
  await expect.poll(async () => Math.abs((await widthOf(locator)) - expected) <= 1, {
    message: `expected width: ${expected}px (±1)`
  }).toBe(true)
}

/** Drags the handle (role separator) with the mouse, from its center to the x position `toX`. */
async function dragSeparatorTo(page: Page, toX: number): Promise<void> {
  const handle = await box(page.getByRole('separator'))
  const y = handle.y + handle.height / 2
  await page.mouse.move(handle.x + handle.width / 2, y)
  await page.mouse.down()
  await page.mouse.move(toX, y, { steps: 20 })
  await page.mouse.up()
}

const innerWidthOf = (page: Page): Promise<number> => page.evaluate(() => window.innerWidth)

async function setWindowSize(app: ElectronApplication, width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0].setSize(size[0], size[1])
  }, [width, height])
}

test.describe('CA1 — 4 columns', () => {
  test('CA1 — the 4 regions are visible and laid out left to right: projects, history, active chat, artifacts', async () => {
    const { page } = await resetApp()
    const names = ['Projects', 'Chat history', 'Active chat', 'Artifacts and diff']

    const xs: number[] = []
    for (const name of names) {
      const region = page.getByRole('region', { name })
      await expect(region).toBeVisible()
      xs.push((await box(region)).x)
    }

    for (let i = 0; i < xs.length - 1; i++) {
      expect(xs[i + 1], `${names[i + 1]} must be to the right of ${names[i]}`).toBeGreaterThan(xs[i])
    }
  })
})

test.describe('CA8 — chat / panel handle', () => {
  test('CA8 — dragging the handle 100 px to the left widens the panel by 100 px and the chat follows', async () => {
    const { page } = await resetApp()
    const panel = panelOf(page)
    const chat = chatOf(page)

    await expectWidth(panel, 400) // width at launch (see Constraints)
    const before = await box(panel)
    const handle = await box(page.getByRole('separator'))

    await dragSeparatorTo(page, handle.x + handle.width / 2 - 100)

    await expectWidth(panel, 500)
    const chatBox = await box(chat)
    const panelBox = await box(panel)
    expect(Math.abs(chatBox.x + chatBox.width + GAP - panelBox.x)).toBeLessThanOrEqual(1)
    // the right edge of the panel did not move
    expect(Math.abs(panelBox.x + panelBox.width - (before.x + before.width))).toBeLessThanOrEqual(1)
  })

  test('CA8 — dragging the handle fully to the right does not shrink the panel below 320 px', async () => {
    const { page } = await resetApp()

    await dragSeparatorTo(page, (await innerWidthOf(page)) - 1)

    await expectWidth(panelOf(page), PANEL_MIN)
    const chatBox = await box(chatOf(page))
    const panelBox = await box(panelOf(page))
    expect(Math.abs(chatBox.x + chatBox.width + GAP - panelBox.x)).toBeLessThanOrEqual(1)
  })

  test('CA8 — dragging the handle fully to the left does not shrink the chat below 360 px', async () => {
    const { page } = await resetApp()

    await dragSeparatorTo(page, 1)

    await expectWidth(chatOf(page), CHAT_MIN)
    const chatBox = await box(chatOf(page))
    const panelBox = await box(panelOf(page))
    expect(Math.abs(chatBox.x + chatBox.width + GAP - panelBox.x)).toBeLessThanOrEqual(1)
  })
})

test.describe('CA9 — minimum size and shrink order', () => {
  test('CA9 — the whole window does not shrink below 1024 × 640', async () => {
    const { app } = await resetApp()

    await setWindowSize(app, 800, 500)

    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize()))
      .toEqual(WINDOW_MIN)
    const minimum = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getMinimumSize()
    )
    expect(minimum).toEqual(WINDOW_MIN)
  })

  test('CA9 — when shrinking, the panel keeps its width and the chat absorbs the reduction', async () => {
    const { app, page } = await resetApp()
    const [initialWindowWidth] = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getSize()
    )
    const panelBefore = await widthOf(panelOf(page))
    const chatBefore = await widthOf(chatOf(page))

    await setWindowSize(app, 1100, 800)
    await expect.poll(() => innerWidthOf(page)).toBe(1100)

    await expectWidth(panelOf(page), panelBefore)
    await expectWidth(chatOf(page), chatBefore - (initialWindowWidth - 1100))
  })

  test('CA9 — panel at 500 px then window at 1024 px: the chat is at 360 px and the panel stays ≥ 320 px', async () => {
    const { app, page } = await resetApp()
    const handle = await box(page.getByRole('separator'))
    await dragSeparatorTo(page, handle.x + handle.width / 2 - 100)
    await expectWidth(panelOf(page), 500)

    await setWindowSize(app, WINDOW_MIN[0], 800)
    await expect.poll(() => innerWidthOf(page)).toBe(WINDOW_MIN[0])

    await expectWidth(chatOf(page), CHAT_MIN)
    expect(await widthOf(panelOf(page))).toBeGreaterThanOrEqual(PANEL_MIN - 1)
  })
})

type Rgba = [number, number, number, number]
interface ThemeColors {
  /** Computed background of `body`, converted to sRGB RGBA (the browser may return it in oklch). */
  body: Rgba
  /** `--background` token resolved in the current theme, converted the same way. */
  token: Rgba
}

async function readColors(page: Page): Promise<ThemeColors> {
  return page.evaluate(() => {
    const toRgba = (css: string): Rgba => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const context = canvas.getContext('2d', { willReadFrequently: true })!
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = css
      context.fillRect(0, 0, 1, 1)
      const data = context.getImageData(0, 0, 1, 1).data
      return [data[0], data[1], data[2], data[3]]
    }
    const probe = document.createElement('div')
    probe.style.backgroundColor = 'var(--background)'
    document.body.appendChild(probe)
    const token = getComputedStyle(probe).backgroundColor
    probe.remove()
    return { body: toRgba(getComputedStyle(document.body).backgroundColor), token: toRgba(token) }
  })
}

/** The body background is opaque, equal to the --background token, and dark or light depending on `theme`. */
async function expectTheme(page: Page, theme: 'dark' | 'light'): Promise<void> {
  await expect
    .poll(async () => {
      const { body, token } = await readColors(page)
      const opaque = body[3] === 255 && token[3] === 255
      const channels = body.slice(0, 3)
      const matchesTheme =
        theme === 'dark' ? channels.every((c) => c <= 64) : channels.every((c) => c >= 192)
      const isToken = body.every((c, i) => c === token[i])
      return opaque && matchesTheme && isToken
    }, { message: `the body background must be the --background token of the ${theme} theme` })
    .toBe(true)
}

test.describe('CA10 — system theme', () => {
  test('CA10 — macOS in dark mode: the app starts in the dark theme', async () => {
    const { page } = await resetApp({ colorScheme: 'dark' })

    await expectTheme(page, 'dark')
  })

  test('CA10 — macOS in light mode: the app starts in the light theme', async () => {
    const { page } = await resetApp({ colorScheme: 'light' })

    await expectTheme(page, 'light')
  })

  test('CA10 — the theme switches live, without reloading, when the setting changes', async () => {
    // `null`: without it Playwright forces `light` and masks nativeTheme.themeSource.
    const { app, page } = await resetApp({ colorScheme: null })
    const setTheme = (source: 'dark' | 'light'): Promise<void> =>
      app.evaluate(({ nativeTheme }, value) => {
        nativeTheme.themeSource = value
      }, source)

    await setTheme('light')
    await expectTheme(page, 'light')
    await page.evaluate(() => {
      ;(window as unknown as Record<string, unknown>).__themeMarker = 'alive'
    })

    await setTheme('dark')
    await expectTheme(page, 'dark')
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__themeMarker)).toBe('alive')

    await setTheme('light')
    await expectTheme(page, 'light')
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__themeMarker)).toBe('alive')
  })
})

// --- hidden-titlebar: `AC<n>` ---
// The native buttons, the title text and the native drag / zoom are drawn by AppKit, outside the
// page: Playwright cannot see them. These tests check the observable proxies (window geometry,
// band, drag region, Window Controls Overlay); the rest is in the manual checklist of the spec.
const BAND_HEIGHT = 40
const REGION_NAMES = ['Projects', 'Chat history', 'Active chat', 'Artifacts and diff'] as const

const bandOf = (page: Page): Locator => page.getByTestId('title-bar')
const regionsOf = (page: Page): Locator[] => REGION_NAMES.map((name) => page.getByRole('region', { name }))

const windowSizeOf = (app: ElectronApplication): Promise<number[]> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize())

const innerHeightOf = (page: Page): Promise<number> => page.evaluate(() => window.innerHeight)

/**
 * Background of the first ancestor of the band (itself included) that is not transparent,
 * converted to sRGB RGBA through a canvas like `readColors` does (computed colors are in oklch).
 */
async function readBandBackground(page: Page): Promise<Rgba> {
  return page.evaluate(() => {
    const toRgba = (css: string): Rgba => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const context = canvas.getContext('2d', { willReadFrequently: true })!
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = css
      context.fillRect(0, 0, 1, 1)
      const data = context.getImageData(0, 0, 1, 1).data
      return [data[0], data[1], data[2], data[3]]
    }
    let element: Element | null = document.querySelector('[data-testid="title-bar"]')
    while (element) {
      const color = toRgba(getComputedStyle(element).backgroundColor)
      if (color[3] > 0) return color
      element = element.parentElement
    }
    return [0, 0, 0, 0]
  })
}

test.describe('AC1 — no native title bar', () => {
  test('AC1 — the content fills the whole window: content size equals window size', async () => {
    const { app, page } = await resetApp()

    const contentSizeOf = (): Promise<number[]> =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize())

    await expect
      .poll(async () => (await contentSizeOf()).join('x') === (await windowSizeOf(app)).join('x'), {
        message: 'getContentSize() must equal getSize(): no native title bar strip'
      })
      .toBe(true)
    const [, windowHeight] = await windowSizeOf(app)
    await expect.poll(() => innerHeightOf(page)).toBe(windowHeight)
  })
})

test.describe('AC2 — title bar band', () => {
  test('AC2 — the band is at the top, full width and 40 px high', async () => {
    const { page } = await resetApp()
    const band = bandOf(page)

    await expect(band).toBeVisible()
    const bandBox = await box(band)
    expect(bandBox.x).toBe(0)
    expect(bandBox.y).toBe(0)
    expect(bandBox.width).toBe(await innerWidthOf(page))
    expect(bandBox.height).toBe(BAND_HEIGHT)
  })

  test('AC2 — the 4 regions start right under the band, at 40 px', async () => {
    const { page } = await resetApp()

    await expect(bandOf(page)).toBeVisible()
    for (const [index, region] of regionsOf(page).entries()) {
      const top = (await box(region)).y
      expect(top, `${REGION_NAMES[index]} must start at ${BAND_HEIGHT}px`).toBe(BAND_HEIGHT)
    }
  })

  for (const theme of ['dark', 'light'] as const) {
    test(`AC2 — ${theme} mode: the band shows the window background (--background token)`, async () => {
      const { page } = await resetApp({ colorScheme: theme })

      await expect(bandOf(page)).toBeVisible()
      await expectTheme(page, theme)
      const { body, token } = await readColors(page)
      const background = await readBandBackground(page)

      expect(background).toEqual(token)
      expect(background).toEqual(body)
    })
  }

  test('AC2 — the native buttons sit in a 40 px area on the left (Window Controls Overlay)', async () => {
    const { page } = await resetApp()

    const overlay = await page.evaluate(() => {
      const wco = (
        navigator as unknown as {
          windowControlsOverlay?: {
            visible: boolean
            getTitlebarAreaRect: () => { x: number; y: number; width: number; height: number }
          }
        }
      ).windowControlsOverlay
      return wco ? { visible: wco.visible, rect: wco.getTitlebarAreaRect() } : null
    })

    expect(overlay).not.toBeNull()
    expect(overlay?.visible).toBe(true)
    expect(overlay?.rect.height).toBe(BAND_HEIGHT)
    expect(overlay?.rect.x).toBeGreaterThan(0)
  })
})

test.describe('AC3 — dragging the band', () => {
  test('AC3 — the band is a drag region and none of the 4 regions is', async () => {
    const { page } = await resetApp()
    const appRegionOf = (locator: Locator): Promise<string> =>
      locator.evaluate((element) => getComputedStyle(element).getPropertyValue('app-region'))

    await expect(bandOf(page)).toBeVisible()
    expect(await appRegionOf(bandOf(page))).toBe('drag')
    for (const [index, region] of regionsOf(page).entries()) {
      expect(await appRegionOf(region), `${REGION_NAMES[index]} must not be a drag region`).not.toBe('drag')
    }
  })
})

test.describe('AC4 — window buttons', () => {
  test('AC4 — the window can be closed, minimized and zoomed', async () => {
    const { app } = await resetApp()

    const capabilities = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return {
        closable: win.isClosable(),
        minimizable: win.isMinimizable(),
        maximizable: win.isMaximizable()
      }
    })

    expect(capabilities).toEqual({ closable: true, minimizable: true, maximizable: true })
  })
})

test.describe('AC6 — minimum size with the band', () => {
  /** The window is at its minimum, the band counts inside it and the columns keep their minimums. */
  async function expectMinimumLayout(app: ElectronApplication, page: Page): Promise<void> {
    await setWindowSize(app, WINDOW_MIN[0], WINDOW_MIN[1])

    await expect.poll(() => windowSizeOf(app)).toEqual(WINDOW_MIN)
    await expect.poll(() => innerWidthOf(page)).toBe(WINDOW_MIN[0])
    await expect.poll(() => innerHeightOf(page)).toBe(WINDOW_MIN[1])
    await expect(bandOf(page)).toBeVisible()
    expect((await box(bandOf(page))).height).toBe(BAND_HEIGHT)
    await expectWidth(chatOf(page), CHAT_MIN)
    expect(await widthOf(panelOf(page))).toBeGreaterThanOrEqual(PANEL_MIN - 1)
    for (const [index, region] of regionsOf(page).entries()) {
      const { y, height } = await box(region)
      expect(y + height, `${REGION_NAMES[index]} must not extend past the window`).toBeLessThanOrEqual(
        WINDOW_MIN[1] + 1
      )
    }
  }

  test('AC6 — window at 1024 × 640: the band counts inside it, chat ≥ 360 px, panel ≥ 320 px, nothing past the bottom', async () => {
    const { app, page } = await resetApp()

    await expectMinimumLayout(app, page)
  })

  test('AC6 — panel widened to 500 px then window at 1024 × 640: same checks', async () => {
    const { app, page } = await resetApp()
    const handle = await box(page.getByRole('separator'))
    await dragSeparatorTo(page, handle.x + handle.width / 2 - 100)
    await expectWidth(panelOf(page), 500)

    await expectMinimumLayout(app, page)
  })
})

// --- claude-code-chat, story 1: projects ---
test.describe('chat AC1 — adding a project', () => {
  test('chat AC1 — picking a folder adds a project named after it, with its initial, selected and stored', async () => {
    const { app, page } = await resetApp()
    const folder = makeFolder('atlas')

    await addProject(app, page, folder)

    const button = railOf(page).getByRole('button', { name: 'atlas', exact: true })
    await expect(button).toHaveText('A')
    await expect(button).toHaveAttribute('aria-current', 'true')
    await expect(projectButtonsOf(page)).toHaveCount(1)
    await expect.poll(storedProjects).toEqual([folder])
    await expectInBackground()
  })

  test('chat AC1 — cancelling the picker changes nothing', async () => {
    const { app, page } = await resetApp()
    await addProject(app, page, makeFolder('atlas'))
    await addProject(app, page, makeFolder('borealis'))
    await expect(railOf(page).getByRole('button', { name: 'borealis', exact: true })).toHaveAttribute(
      'aria-current',
      'true'
    )
    const before = storedProjects()

    await stubFolderPicker(app, null)
    await addProjectButtonOf(page).click()

    // the picker was opened once; then the app has had the time to (wrongly) react
    await expect.poll(() => pickerCallsOf(app)).toBe(1)
    await page.waitForTimeout(300)
    await expect(projectButtonsOf(page)).toHaveCount(2)
    await expect(railOf(page).getByRole('button', { name: 'borealis', exact: true })).toHaveAttribute(
      'aria-current',
      'true'
    )
    expect(storedProjects()).toEqual(before)
  })

  test('chat AC1 — picking a folder that is already a project selects it and adds no duplicate', async () => {
    const { app, page } = await resetApp()
    const atlas = makeFolder('atlas')
    await addProject(app, page, atlas)
    const borealis = makeFolder('borealis')
    await addProject(app, page, borealis)

    await addProject(app, page, atlas)

    await expect(railOf(page).getByRole('button', { name: 'atlas', exact: true })).toHaveAttribute(
      'aria-current',
      'true'
    )
    await expect(projectButtonsOf(page)).toHaveCount(2)
    expect(storedProjects()).toEqual([atlas, borealis])
  })
})

test.describe('chat AC2 — projects kept between launches', () => {
  // One launch only (e2e-quiet-runs): `page.reload()` makes the renderer read `projects.json` again.
  // The quit and relaunch itself is in the manual checklist of the spec.
  test('chat AC2 — after a reload the same projects are in the rail, in the same order, the first one selected', async () => {
    const { app, page } = await resetApp()
    const folders = [makeFolder('borealis'), makeFolder('atlas'), makeFolder('cobalt')]
    for (const folder of folders) await addProject(app, page, folder)
    await expect(railOf(page).getByRole('button', { name: 'cobalt', exact: true })).toHaveAttribute(
      'aria-current',
      'true'
    )

    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    await expect(projectButtonsOf(page)).toHaveCount(3)
    await expect(projectButtonsOf(page)).toHaveText(['B', 'A', 'C'])
    await expect(projectButtonsOf(page).nth(0)).toHaveAttribute('aria-current', 'true')
    await expect(projectButtonsOf(page).nth(1)).not.toHaveAttribute('aria-current', 'true')
    await expect(projectButtonsOf(page).nth(2)).not.toHaveAttribute('aria-current', 'true')
    expect(storedProjects()).toEqual(folders)
  })
})

test.describe('chat AC3 — no project', () => {
  test('chat AC3 — the rail shows only the "+" button, and the history and the chat show "Add a project to get started"', async () => {
    const { page } = await resetApp()

    await expect(railOf(page).getByRole('button')).toHaveCount(1)
    await expect(addProjectButtonOf(page)).toBeVisible()
    await expect(historyOf(page).getByText('Add a project to get started')).toBeVisible()
    await expect(chatOf(page).getByText('Add a project to get started')).toBeVisible()
  })
})

// --- claude-code-chat, story 2: chat with Claude Code, Plan mode ---
test.describe('chat AC5 — sending a message', () => {
  test('chat AC5 — Enter sends: the message shows, the input is cleared, and Claude Code answers in the project folder', async () => {
    const { page, folder } = await openChat()

    await send(page, 'hello')

    await expect(logItemsOf(page)).toHaveCount(2)
    await expect(logItemsOf(page).first()).toContainText('hello')
    await expect(logOf(page)).toContainText('You said: hello')
    await expect(logOf(page)).toContainText('Mode: plan')
    await expect(logOf(page)).toContainText(`Folder: ${folder}`)
    await expect(logOf(page)).toContainText('Earlier in this chat: nothing')
    await expect(chatButtonOf(page, 'hello')).toBeVisible()
    await expectIdle(page)
    await expectInBackground()
  })

  test('chat AC5 — clicking Send sends too', async () => {
    const { page } = await openChat()

    await messageBoxOf(page).fill('by click')
    await sendButtonOf(page).click({ timeout: 5_000 })

    await expect(logOf(page)).toContainText('You said: by click')
    await expect(messageBoxOf(page)).toHaveValue('')
  })

  test('chat AC5 — Shift+Enter inserts a line break; an empty or whitespace-only message cannot be sent', async () => {
    const { page } = await openChat()
    const box = messageBoxOf(page)
    await expect(sendButtonOf(page)).toBeDisabled()

    await box.press('Enter')
    await box.fill('   ')
    await expect(sendButtonOf(page)).toBeDisabled()
    await box.press('Enter')
    await page.waitForTimeout(300)
    await expect(logItemsOf(page)).toHaveCount(0)

    await box.fill('hello')
    await box.press('Shift+Enter')
    await box.pressSequentially('world')
    await expect(box).toHaveValue('hello\nworld')
    await expect(logItemsOf(page)).toHaveCount(0)
    await box.press('Enter')

    await expect(box).toHaveValue('')
    await expect(logOf(page)).toContainText(/You said: hello\s+world/)
  })

  test('chat AC5 — the reply appears progressively: part of the text shows while Stop is visible', async () => {
    const { page } = await openChat()

    await send(page, '[slow] go')

    await expect(stopButtonOf(page)).toBeVisible()
    await expect(sendButtonOf(page)).toHaveCount(0)
    await expect(logOf(page)).toContainText('tick 1')
    const early = await ticksIn(page)
    await expect(logOf(page)).toContainText('tick 4')
    expect(await ticksIn(page)).toBeGreaterThan(early)
    await expect(stopButtonOf(page)).toBeVisible()
  })
})

test.describe('chat AC6 — the same conversation', () => {
  test('chat AC6 — a second message has the first one, and another chat has only its own', async () => {
    const { page } = await openChat()

    await send(page, 'first')
    await expect(logOf(page)).toContainText('Earlier in this chat: nothing')
    await expectIdle(page)
    await send(page, 'second')
    await expect(logOf(page)).toContainText('You said: second')
    await expect(logOf(page)).toContainText('Earlier in this chat: first')
    await expectIdle(page)
    await send(page, 'third')
    await expect(logOf(page)).toContainText('Earlier in this chat: first | second')
    await expectIdle(page)

    await newChat(page)
    await send(page, 'other')

    await expect(logOf(page)).toContainText('You said: other')
    await expect(logOf(page)).toContainText('Earlier in this chat: nothing')
    await expect(logOf(page)).not.toContainText('first')
    await expectIdle(page)
    await chatButtonOf(page, 'first').click()
    await expect(logOf(page)).toContainText('Earlier in this chat: first | second')
    await expect(logOf(page)).not.toContainText('other')
  })
})

test.describe('chat AC7 — action lines', () => {
  test('chat AC7 — [tools]: the 3 action lines show in order, between the text segments', async () => {
    const { page } = await openChat()

    await send(page, '[tools] go')

    await expect(logItemsOf(page)).toHaveText([
      /\[tools\] go/,
      /Let me look at the project\./,
      /^Read README\.md$/,
      /Now the change\./,
      /^Edit src\/index\.ts$/,
      /^Bash npm test$/,
      /Done\./
    ])
    await expectIdle(page)
  })
})

test.describe('chat AC10 — Plan mode', () => {
  test('chat AC10 — a new chat runs in Plan, the default the adapter announces, and leaves the project folder untouched', async () => {
    const { page, folder } = await openChat()

    await send(page, 'please create a file')

    await expect(logOf(page)).toContainText('Mode: plan')
    await expectIdle(page)
    await expect(alertsOf(page)).toHaveCount(0)
    expect(readdirSync(folder)).toEqual([])
  })
})

test.describe('chat AC11 — Stop', () => {
  test('chat AC11 — the Stop button stops the answer: the text stays, "Interrupted" shows, and a new message can be sent', async () => {
    const { page } = await openChat()
    await send(page, '[slow] count')
    await expect(logOf(page)).toContainText('tick 2')

    await stopButtonOf(page).click()

    await expect(logItemsOf(page).last()).toHaveText('Interrupted')
    await expect(logOf(page)).toContainText('tick 1')
    await expectIdle(page)
    await expect(alertsOf(page)).toHaveCount(0)
    const kept = await ticksIn(page)
    await page.waitForTimeout(400)
    expect(await ticksIn(page), 'the answer must really have stopped').toBe(kept)

    await send(page, 'next')
    await expect(logOf(page)).toContainText('You said: next')
    await expect(logOf(page)).toContainText('Earlier in this chat: [slow] count')
    await expectIdle(page)
  })

  test('chat AC11 — Esc stops the answer too', async () => {
    const { page } = await openChat()
    await send(page, '[slow] count')
    await expect(logOf(page)).toContainText('tick 2')

    await messageBoxOf(page).press('Escape')

    await expect(logItemsOf(page).last()).toHaveText('Interrupted')
    await expect(logOf(page)).toContainText('tick 1')
    await expectIdle(page)
    await expect(alertsOf(page)).toHaveCount(0)
  })
})

test.describe('chat AC12 — background answers', () => {
  /** The first `n` ticks, with no gap: nothing received was lost. */
  const ticksFromOne = (n: number): string => Array.from({ length: n }, (_, i) => `tick ${i + 1}`).join(' ')

  test('chat AC12 — switching to another chat and back: the answer kept going, and the other chat answered in the meantime', async () => {
    const { page } = await openChat()
    await send(page, '[slow] chat a')
    await expect(logOf(page)).toContainText('tick 2')

    await newChat(page)
    await send(page, 'hello b')
    await expect(logOf(page)).toContainText('You said: hello b')
    await expectIdle(page)
    await page.waitForTimeout(1500)
    await chatButtonOf(page, '[slow] chat a').click()

    await expect(logOf(page)).toContainText(ticksFromOne(12))
    await expect(stopButtonOf(page)).toBeVisible()
    await expect(alertsOf(page)).toHaveCount(0)
  })

  test('chat AC12 — switching to another project and back: the answer kept going and shows everything received', async () => {
    const { app, page } = await openChat()
    await send(page, '[slow] chat a')
    await expect(logOf(page)).toContainText('tick 2')

    await addProject(app, page, makeFolder('borealis'))
    await expect(logItemsOf(page)).toHaveCount(0)
    await page.waitForTimeout(1500)
    await railOf(page).getByRole('button', { name: 'atlas', exact: true }).click()
    await chatButtonOf(page, '[slow] chat a').click()

    await expect(logOf(page)).toContainText(ticksFromOne(12))
    await expect(stopButtonOf(page)).toBeVisible()
  })
})

test.describe('chat AC13 — errors', () => {
  test('chat AC13 — CLI not installed: the chat says so, and once it is found again a new message works', async () => {
    const { app, page } = await openChat()
    await app.evaluate(() => {
      process.env.PATH = '/usr/bin:/bin'
    })

    try {
      await send(page, 'hello')

      await expect(alertsOf(page)).toHaveCount(1)
      await expect(alertsOf(page)).toContainText('Claude Code CLI not found')
      await expectIdle(page)
    } finally {
      await app.evaluate((_electron, path) => {
        process.env.PATH = path
      }, FAKE_PATH)
    }

    await send(page, 'hello again')
    await expect(logOf(page)).toContainText('You said: hello again')
    await expectIdle(page)
  })

  test('chat AC13 — not logged in: Claude Code\'s own message shows once, other chats still answer, and the chat can send again', async () => {
    const { page } = await openChat()

    await send(page, '[auth] hello')

    await expect(alertsOf(page)).toHaveCount(1)
    await expect(alertsOf(page)).toContainText('Not logged in')
    await expectIdle(page)

    await newChat(page)
    await send(page, 'hello from b')
    await expect(logOf(page)).toContainText('You said: hello from b')
    await expect(alertsOf(page)).toHaveCount(0)
    await expectIdle(page)

    await chatButtonOf(page, '[auth] hello').click()
    await expect(alertsOf(page)).toHaveCount(1)
    await send(page, 'fixed now')
    await expect(logOf(page)).toContainText('You said: fixed now')
    await expectIdle(page)
  })

  test('chat AC13 — any error Claude Code returns shows its text, and the app keeps working', async () => {
    const { page } = await openChat()

    await send(page, '[crash] hello')

    await expect(alertsOf(page)).toHaveCount(1)
    await expect(alertsOf(page)).toContainText('fake crash')
    await expectIdle(page)
    await send(page, 'next')
    await expect(logOf(page)).toContainText('You said: next')
  })
})

// --- claude-code-chat, story 2, task 10: navigation guard ---
// The build is loaded from `file://`. The guard must keep every other page out of the window, and every
// window closed. Dropping a file from Finder onto the window is checked by hand (Playwright cannot do it).
test.describe('chat guard — the window only ever shows the app', () => {
  test('chat guard — a foreign page cannot replace the app', async () => {
    const { app, page } = await resetApp()
    const appUrl = page.url()
    const foreign = join(tempDir, 'foreign.html')
    writeFileSync(foreign, '<!doctype html><title>foreign</title><p>foreign page</p>')
    // The probe is registered after the app's own listener, so it sees the state the guard left.
    await app.evaluate(({ BrowserWindow }) => {
      const record = globalThis as unknown as { __navigation?: { url: string; prevented: boolean } }
      delete record.__navigation
      BrowserWindow.getAllWindows()[0].webContents.once('will-navigate', (event, legacyUrl) => {
        const url = (event as unknown as { url?: string }).url ?? legacyUrl
        record.__navigation = { url, prevented: event.defaultPrevented }
      })
    })

    try {
      await page.evaluate((url) => {
        location.href = url
      }, pathToFileURL(foreign).href)

      await expect
        .poll(() =>
          app.evaluate(() => (globalThis as unknown as { __navigation?: unknown }).__navigation ?? null)
        )
        .not.toBeNull()
      const navigation = await app.evaluate(
        () => (globalThis as unknown as { __navigation: { url: string; prevented: boolean } }).__navigation
      )
      expect(navigation.url).toBe(pathToFileURL(foreign).href)
      expect(navigation.prevented, 'the guard must prevent the navigation').toBe(true)
      expect(page.url()).toBe(appUrl)
      // Not `toBeVisible()`: Playwright keeps the blocked navigation pending, and retrying locator actions wait for it.
      for (const name of REGION_NAMES)
        await expect.poll(() => page.getByRole('region', { name }).isVisible()).toBe(true)
    } finally {
      // Only matters when the guard is missing: bring the app back so the other tests can run.
      if (page.url() !== appUrl) {
        await app.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows()[0].loadURL(url), appUrl)
        await page.waitForLoadState('domcontentloaded')
      }
    }
  })

  test('chat guard — the page cannot open a window', async () => {
    const { app, page } = await resetApp()
    const appWindowId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id)

    try {
      // `show=no` is a window.open feature Electron turns into a window option: even with no guard,
      // the extra window stays hidden, so this test never takes the focus (Decision 16).
      const opened = await page.evaluate(() => window.open('about:blank', '_blank', 'show=no') !== null)
      await page.waitForTimeout(300)

      const windows = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((window) => ({ id: window.id, visible: window.isVisible() }))
      )
      // one assertion, so that a failure shows both: `opened: false` is window.open returning null (denied)
      expect({ opened, windows }).toEqual({ opened: false, windows: [{ id: appWindowId, visible: false }] })
    } finally {
      await app.evaluate(({ BrowserWindow }, keep) => {
        for (const window of BrowserWindow.getAllWindows()) if (window.id !== keep) window.destroy()
      }, appWindowId)
    }
  })
})
