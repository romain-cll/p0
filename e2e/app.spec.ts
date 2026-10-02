import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
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
// These tests run the built app (`electron-vite build` => out/main/index.js) in a real
// Electron: they require a macOS graphical session. See `npm run test:e2e`.
// The app is launched once for the whole file (`beforeAll`) and stays hidden: `P0_E2E=1` tells
// the main process never to show its window (docs/features/e2e-quiet-runs.md). Each test starts
// with `resetApp()`. The hooks check e2e-quiet-runs AC1 (`expectInBackground`): the window is
// neither visible nor focused, and the app is not the frontmost one.
const MAIN_ENTRY = resolve('out/main/index.js')

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
  electronApp = await electron.launch({
    args: [MAIN_ENTRY],
    env: { ...process.env, P0_E2E: '1' } as Record<string, string>
  })
  appPage = await electronApp.firstWindow()
  await appPage.waitForLoadState('domcontentloaded')
  await expectInBackground()
})

test.afterAll(async () => {
  // e2e-guard-hardening AC2: `electron.launch` threw in `beforeAll`, its error is the one reported,
  // and there is no app to check or close.
  if (!electronApp) return
  try {
    await expectInBackground()
  } finally {
    await electronApp.close()
  }
})

/**
 * Puts the shared app back in its initial state: window size, system theme, color scheme
 * emulation, and a fresh page (project 1 selected, no chat, panel at its default width).
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
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await expectWidth(panelOf(page), INITIAL_PANEL_WIDTH)
  return { app, page }
}

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
