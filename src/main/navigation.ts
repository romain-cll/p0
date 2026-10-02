import type { WebContents } from 'electron'

/** True when `url` is the app's own page, ignoring query and hash. */
export function isAppUrl(url: string, appUrl: string): boolean {
  try {
    const target = new URL(url)
    const app = new URL(appUrl)
    target.search = target.hash = app.search = app.hash = ''
    return target.href === app.href
  } catch {
    return false
  }
}

/** No page but the app's can load in `contents`, and no page can open a window. */
export function guardNavigation(
  contents: Pick<WebContents, 'on' | 'setWindowOpenHandler'>,
  appUrl: string
): void {
  contents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url, appUrl)) event.preventDefault()
  })
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
}
