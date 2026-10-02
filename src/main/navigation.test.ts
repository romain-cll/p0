// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { guardNavigation, isAppUrl } from './navigation'

// `chat guard` is the navigation guard of docs/features/claude-code-chat.md (story 2, task 10, Decision 15).
//
// Contracts these tests rely on (src/main/navigation.ts):
// - `isAppUrl(url: string, appUrl: string): boolean` is true when `url` is the app's own page: same URL
//   as `appUrl`, ignoring the query and the hash. Anything else is false, including a string that is
//   not a URL (it never throws).
// - `guardNavigation(contents, appUrl): void`, with `contents` limited to `on` and `setWindowOpenHandler`:
//   - it registers a `will-navigate` listener. The listener is called as `(event, url)`, where `event` is
//     the Electron event (it has `preventDefault()`, and `event.url` is the target); it calls
//     `event.preventDefault()` unless the target is the app's page;
//   - it sets a window-open handler that returns `{ action: 'deny' }` for every URL.
// Dev app URL: `http://localhost:5173`. Build app URL: `file:///x/out/renderer/index.html`.

const DEV = 'http://localhost:5173'
const BUILD = 'file:///x/out/renderer/index.html'

describe('isAppUrl, dev app URL', () => {
  it.each(['http://localhost:5173/', 'http://localhost:5173/?a=1#b', 'http://localhost:5173/#b', 'http://localhost:5173'])(
    'chat guard — allows %s',
    (url) => {
      expect(isAppUrl(url, DEV)).toBe(true)
    }
  )

  it.each([
    'http://localhost:5174/',
    'http://localhost:5173/other',
    'https://example.com/',
    'https://localhost:5173/',
    'file:///x/out/renderer/index.html',
    'not a url',
    ''
  ])('chat guard — blocks %j', (url) => {
    expect(isAppUrl(url, DEV)).toBe(false)
  })
})

describe('isAppUrl, build app URL', () => {
  it.each([BUILD, `${BUILD}#chat`, `${BUILD}?a=1`])('chat guard — allows %s', (url) => {
    expect(isAppUrl(url, BUILD)).toBe(true)
  })

  it.each([
    'file:///x/out/renderer/other.html',
    'file:///etc/hosts',
    'file:///x/out/renderer/',
    'http://localhost:5173/',
    'https://example.com/',
    'not a url'
  ])('chat guard — blocks %s', (url) => {
    expect(isAppUrl(url, BUILD)).toBe(false)
  })
})

type Contents = Parameters<typeof guardNavigation>[0]
type Listener = (event: { url: string; preventDefault: () => void }, url: string) => void
type OpenHandler = (details: { url: string }) => { action: string }

/** A `webContents` that records the listeners and the window-open handler it receives. */
function fakeContents(): {
  contents: Contents
  navigate: (url: string) => { prevented: boolean }
  open: (url: string) => { action: string }
  listenedEvents: () => string[]
} {
  const listeners = new Map<string, Listener[]>()
  let openHandler: OpenHandler | null = null
  const contents = {
    on(event: string, listener: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
      return contents
    },
    setWindowOpenHandler(handler: OpenHandler) {
      openHandler = handler
    }
  }
  return {
    contents: contents as unknown as Contents,
    navigate(url) {
      const preventDefault = vi.fn()
      for (const listener of listeners.get('will-navigate') ?? []) listener({ url, preventDefault }, url)
      return { prevented: preventDefault.mock.calls.length > 0 }
    },
    open(url) {
      if (!openHandler) throw new Error('no window-open handler was set')
      return openHandler({ url })
    },
    listenedEvents: () => [...listeners.keys()]
  }
}

describe('guardNavigation', () => {
  it('chat guard — will-navigate to a foreign URL is prevented', () => {
    const { contents, navigate } = fakeContents()
    guardNavigation(contents, BUILD)

    expect(navigate('file:///tmp/foreign.html').prevented).toBe(true)
    expect(navigate('https://example.com/').prevented).toBe(true)
    expect(navigate('http://localhost:5173/').prevented).toBe(true)
  })

  it('chat guard — will-navigate to the app URL is not prevented', () => {
    const { contents, navigate } = fakeContents()
    guardNavigation(contents, BUILD)

    expect(navigate(BUILD).prevented).toBe(false)
    expect(navigate(`${BUILD}#chat`).prevented).toBe(false)
  })

  it('chat guard — in dev, only the dev page may be navigated to', () => {
    const { contents, navigate } = fakeContents()
    guardNavigation(contents, DEV)

    expect(navigate('http://localhost:5173/?x=1').prevented).toBe(false)
    expect(navigate('http://localhost:5174/').prevented).toBe(true)
    expect(navigate('file:///x/out/renderer/index.html').prevented).toBe(true)
  })

  it('chat guard — the window-open handler denies the app URL and a foreign URL', () => {
    const { contents, open } = fakeContents()
    guardNavigation(contents, BUILD)

    expect(open(BUILD)).toEqual({ action: 'deny' })
    expect(open('https://example.com/')).toEqual({ action: 'deny' })
    expect(open('about:blank')).toEqual({ action: 'deny' })
  })

  it('chat guard — it listens to will-navigate before anything loads', () => {
    const { contents, listenedEvents } = fakeContents()

    guardNavigation(contents, BUILD)

    expect(listenedEvents()).toContain('will-navigate')
  })
})
