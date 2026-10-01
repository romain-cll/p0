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
// These tests launch the built app (`electron-vite build` => out/main/index.js) in a real
// Electron: they require a macOS graphical session. See `npm run test:e2e`.
const MAIN_ENTRY = resolve('out/main/index.js')

const GAP = 8
const PANEL_MIN = 320
const CHAT_MIN = 360
const WINDOW_MIN: [number, number] = [1024, 640]

const apps: ElectronApplication[] = []

test.afterEach(async () => {
  while (apps.length > 0) {
    await apps.pop()?.close()
  }
})

async function launch(
  options: { colorScheme?: 'dark' | 'light' | 'no-override' } = {}
): Promise<{ app: ElectronApplication; page: Page }> {
  // `'no-override'` is accepted at runtime (Playwright then does not force the theme) but absent
  // from the `electron.launch` type ('dark' | 'light' | null): targeted cast on that single value.
  const colorScheme = options.colorScheme as 'dark' | 'light' | null | undefined
  const app = await electron.launch({ args: [MAIN_ENTRY], colorScheme })
  apps.push(app)
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
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
    const { page } = await launch()
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
    const { page } = await launch()
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
    const { page } = await launch()

    await dragSeparatorTo(page, (await innerWidthOf(page)) - 1)

    await expectWidth(panelOf(page), PANEL_MIN)
    const chatBox = await box(chatOf(page))
    const panelBox = await box(panelOf(page))
    expect(Math.abs(chatBox.x + chatBox.width + GAP - panelBox.x)).toBeLessThanOrEqual(1)
  })

  test('CA8 — dragging the handle fully to the left does not shrink the chat below 360 px', async () => {
    const { page } = await launch()

    await dragSeparatorTo(page, 1)

    await expectWidth(chatOf(page), CHAT_MIN)
    const chatBox = await box(chatOf(page))
    const panelBox = await box(panelOf(page))
    expect(Math.abs(chatBox.x + chatBox.width + GAP - panelBox.x)).toBeLessThanOrEqual(1)
  })
})

test.describe('CA9 — minimum size and shrink order', () => {
  test('CA9 — the whole window does not shrink below 1024 × 640', async () => {
    const { app } = await launch()

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
    const { app, page } = await launch()
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
    const { app, page } = await launch()
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
    const { page } = await launch({ colorScheme: 'dark' })

    await expectTheme(page, 'dark')
  })

  test('CA10 — macOS in light mode: the app starts in the light theme', async () => {
    const { page } = await launch({ colorScheme: 'light' })

    await expectTheme(page, 'light')
  })

  test('CA10 — the theme switches live, without reloading, when the setting changes', async () => {
    // 'no-override': without it Playwright forces `light` and masks nativeTheme.themeSource.
    const { app, page } = await launch({ colorScheme: 'no-override' })
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
