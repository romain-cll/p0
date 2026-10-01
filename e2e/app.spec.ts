import { resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'

// Ces tests lancent l'app buildée (`electron-vite build` => out/main/index.js) dans un vrai
// Electron : ils exigent une session graphique macOS. Cf. `npm run test:e2e`.
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
  // `'no-override'` est accepté à l'exécution (Playwright ne force alors pas le thème) mais absent
  // du type de `electron.launch` ('dark' | 'light' | null) : cast ciblé sur cette seule valeur.
  const colorScheme = options.colorScheme as 'dark' | 'light' | null | undefined
  const app = await electron.launch({ args: [MAIN_ENTRY], colorScheme })
  apps.push(app)
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

const chatOf = (page: Page): Locator => page.getByRole('region', { name: 'Chat actif' })
const panelOf = (page: Page): Locator => page.getByRole('region', { name: 'Artifacts et diff' })

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const result = await locator.boundingBox()
  if (!result) throw new Error('élément sans boîte : non affiché')
  return result
}

const widthOf = async (locator: Locator): Promise<number> => (await box(locator)).width

/** Attend que la largeur de l'élément atteigne `expected` px (±1). */
async function expectWidth(locator: Locator, expected: number): Promise<void> {
  await expect.poll(async () => Math.abs((await widthOf(locator)) - expected) <= 1, {
    message: `largeur attendue : ${expected}px (±1)`
  }).toBe(true)
}

/** Glisse la poignée (role separator) à la souris, de son centre jusqu'à l'abscisse `toX`. */
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

test.describe('CA1 — 4 colonnes', () => {
  test('CA1 — les 4 régions sont visibles et rangées de gauche à droite : projets, historique, chat actif, artifacts', async () => {
    const { page } = await launch()
    const names = ['Projets', 'Historique des chats', 'Chat actif', 'Artifacts et diff']

    const xs: number[] = []
    for (const name of names) {
      const region = page.getByRole('region', { name })
      await expect(region).toBeVisible()
      xs.push((await box(region)).x)
    }

    for (let i = 0; i < xs.length - 1; i++) {
      expect(xs[i + 1], `${names[i + 1]} doit être à droite de ${names[i]}`).toBeGreaterThan(xs[i])
    }
  })
})

test.describe('CA8 — poignée chat / panneau', () => {
  test('CA8 — glisser la poignée de 100 px vers la gauche élargit le panneau de 100 px et le chat suit', async () => {
    const { page } = await launch()
    const panel = panelOf(page)
    const chat = chatOf(page)

    await expectWidth(panel, 400) // largeur au lancement (cf. Contraintes)
    const before = await box(panel)
    const handle = await box(page.getByRole('separator'))

    await dragSeparatorTo(page, handle.x + handle.width / 2 - 100)

    await expectWidth(panel, 500)
    const chatBox = await box(chat)
    const panelBox = await box(panel)
    expect(Math.abs(chatBox.x + chatBox.width + GAP - panelBox.x)).toBeLessThanOrEqual(1)
    // le bord droit du panneau n'a pas bougé
    expect(Math.abs(panelBox.x + panelBox.width - (before.x + before.width))).toBeLessThanOrEqual(1)
  })

  test('CA8 — glisser la poignée tout à droite ne descend pas le panneau sous 320 px', async () => {
    const { page } = await launch()

    await dragSeparatorTo(page, (await innerWidthOf(page)) - 1)

    await expectWidth(panelOf(page), PANEL_MIN)
    const chatBox = await box(chatOf(page))
    const panelBox = await box(panelOf(page))
    expect(Math.abs(chatBox.x + chatBox.width + GAP - panelBox.x)).toBeLessThanOrEqual(1)
  })

  test('CA8 — glisser la poignée tout à gauche ne descend pas le chat sous 360 px', async () => {
    const { page } = await launch()

    await dragSeparatorTo(page, 1)

    await expectWidth(chatOf(page), CHAT_MIN)
    const chatBox = await box(chatOf(page))
    const panelBox = await box(panelOf(page))
    expect(Math.abs(chatBox.x + chatBox.width + GAP - panelBox.x)).toBeLessThanOrEqual(1)
  })
})

test.describe('CA9 — taille minimale et ordre de réduction', () => {
  test('CA9 — la fenêtre entière ne descend pas sous 1024 × 640', async () => {
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

  test('CA9 — en rétrécissant, le panneau garde sa largeur et le chat absorbe la réduction', async () => {
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

  test('CA9 — panneau à 500 px puis fenêtre à 1024 px : le chat est à 360 px et le panneau reste ≥ 320 px', async () => {
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
  /** Fond calculé de `body`, converti en RGBA sRGB (le navigateur peut le renvoyer en oklch). */
  body: Rgba
  /** Token `--background` résolu dans le thème courant, converti de la même façon. */
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

/** Le fond du body est opaque, égal au token --background, et sombre ou clair selon `theme`. */
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
    }, { message: `le fond de body doit être le token --background du thème ${theme}` })
    .toBe(true)
}

test.describe('CA10 — thème système', () => {
  test('CA10 — macOS en mode sombre : l’app démarre en thème sombre', async () => {
    const { page } = await launch({ colorScheme: 'dark' })

    await expectTheme(page, 'dark')
  })

  test('CA10 — macOS en mode clair : l’app démarre en thème clair', async () => {
    const { page } = await launch({ colorScheme: 'light' })

    await expectTheme(page, 'light')
  })

  test('CA10 — le thème bascule à chaud, sans rechargement, quand le réglage change', async () => {
    // 'no-override' : sans cela Playwright force `light` et masque nativeTheme.themeSource.
    const { app, page } = await launch({ colorScheme: 'no-override' })
    const setTheme = (source: 'dark' | 'light'): Promise<void> =>
      app.evaluate(({ nativeTheme }, value) => {
        nativeTheme.themeSource = value
      }, source)

    await setTheme('light')
    await expectTheme(page, 'light')
    await page.evaluate(() => {
      ;(window as unknown as Record<string, unknown>).__themeMarker = 'vivant'
    })

    await setTheme('dark')
    await expectTheme(page, 'dark')
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__themeMarker)).toBe('vivant')

    await setTheme('light')
    await expectTheme(page, 'light')
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__themeMarker)).toBe('vivant')
  })
})
