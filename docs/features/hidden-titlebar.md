# Hidden macOS title bar

## User story
As a macOS user, I want the native title bar hidden and only the window buttons kept, so that the app looks like Codex or the Claude desktop app.

## Acceptance criteria
- [ ] AC1 — Given the app on macOS, when the main window opens, then no native title bar is shown (no title text, no title bar background), and the three window buttons (close, minimize, zoom) are visible at the top-left of the window.
- [ ] AC2 — Given the main window, when it opens, then:
  - a 40 px band spans the full width at the top of the window, above the four columns;
  - the band has the same background as the window, in light and dark mode;
  - the window buttons sit in this band, vertically centered;
  - no column overlaps the band.
- [ ] AC3 — Given the main window, when I press and drag anywhere in the band outside the window buttons, then the window moves with the pointer.
- [ ] AC4 — Given the window buttons, when I click them, then they behave as in any macOS app: close closes the window, minimize sends it to the Dock, a click on the green button enters full screen and an Option-click on it zooms the window.
- [ ] AC5 — Given the macOS setting "Double-click a window's title bar to" is set to Zoom (or Fill) and the main window at its normal size, when I double-click anywhere in the band outside the window buttons, then the window zooms; when I double-click the band again, then the window returns to its previous size and position. With any other value of this setting, the double-click follows that setting.
- [ ] AC6 — Given the minimum window size of 1024 × 640 px (whole window, band included), when the window is at that size, then the active chat stays at 360 px or more and the Artifacts and diff panel at 320 px or more. All existing tests still pass.

## Out of scope
- Windows and Linux (custom title bar, window controls).
- Any double-click behavior of our own beyond the macOS setting (e.g. forcing zoom when the setting is Minimize or Do Nothing).
- Any content in the band: title, buttons, search, project name.
- Specific behavior in macOS full-screen mode.
- Placing the window buttons inside a column.

## Constraints
- Layout as validated by Romain: a full-width empty band at the top, with the window buttons on the left; the four columns below it are unchanged.
- English everywhere (see `AGENTS.md`).

## Technical plan
### Approach
Main process: add `titleBarStyle: 'hidden'` and `titleBarOverlay: { height: 40 }` to the existing `BrowserWindow`. The page then fills the whole window, and Electron centers the native buttons vertically in a 40 px area, at the default macOS left inset (no `trafficLightPosition`). The minimum stays 1024 × 640, which now equals the content size.
Renderer: `App` becomes a vertical stack. On top is an empty 40 px band, `aria-hidden`, with `app-region: drag` and no background of its own, so the `body` `--background` shows through in both themes. Below it is the existing four-column row, unchanged except for its top padding: the band serves as the top gap (see Spec ambiguities 1).
Double-click: macOS should handle it natively on a drag region and follow the system setting (AppKit in the title bar area, Chromium below it). Task 1 checks this on Electron 44 first. If it fails, the fallback lives in the main process (`before-mouse-event`), so there is still no preload.

### Files
- modified: /Users/romain/projects/p0/src/main/index.ts — adds two `BrowserWindow` options: `titleBarStyle: 'hidden'` and `titleBarOverlay: { height: 40 }`. Only if task 5 runs: a `webContents` `before-mouse-event` handler, sharing a `TITLE_BAR_HEIGHT = 40` constant with the overlay option.
- modified: /Users/romain/projects/p0/src/renderer/src/App.tsx
  - Root: `flex h-full flex-col`.
  - First child: `<div aria-hidden="true" data-testid="title-bar" className="h-10 shrink-0 [app-region:drag]" />`.
  - The current row keeps its children and classes, except `h-full` → `min-h-0 flex-1` and `p-2` → `px-2 pb-2` (it stays `p-2` if Spec ambiguity 1 = B).
- modified: /Users/romain/projects/p0/src/renderer/src/App.test.tsx — one AC2 component test. New header line: `AC<n>` refers to `docs/features/hidden-titlebar.md`.
- modified: /Users/romain/projects/p0/e2e/app.spec.ts — new `describe` blocks for AC1, AC2, AC3, AC4 and AC6, plus AC5 only with the fallback. They reuse the existing helpers (`launch`, `box`, `setWindowSize`, `dragSeparatorTo`, `expectWidth`, and the color conversion in `readColors`). Same header line as in `App.test.tsx`.
- modified: /Users/romain/projects/p0/docs/features/hidden-titlebar.md — Technical plan, written by the PO.
- No file created, no new dependency.

### Tasks (ordered)
1. Spike, not committed (about 30 min). Apply the two window options and a bare band, run `npm run dev`, then answer the questions below and record the answers in the PR description. — de-risks AC2, AC3, AC5
   - Q1: Set System Settings > Desktop & Dock > "Double-click a window's title bar to" to Zoom. Does a real double-click zoom the window, and a second one restore it? Try three points: the band center, near its right end, and low in the band (y ≈ 35 px, below the standard title bar height).
   - Q2: In DevTools, does `getComputedStyle(band).getPropertyValue('app-region')` return `drag`?
   - Q3: Does `navigator.windowControlsOverlay.getTitlebarAreaRect()` return `height` 40 and `x` > 0?
   - Q4, only if Q1 fails: does `before-mouse-event` fire with `clickCount: 2` for a real double-click in the band? And for Playwright's `page.mouse.dblclick`?
   - Outcomes:
     - Q1 yes: skip task 5.
     - Q1 no, Q4 yes for a real double-click: do task 5.
     - Both no: stop and go back to Romain (Decision 3).
     - Q2 or Q3 no: drop the matching e2e assertion; that check becomes manual.
2. `test:` red tests: the AC2 component test, then e2e for AC1, AC2, AC3, AC4 and AC6, as described in the Test strategy, minus anything task 1 ruled out. — covers AC1, AC2, AC3, AC4, AC6
3. `feat:` window options in `src/main/index.ts`. — covers AC1, AC2 (button centering), AC4
4. `feat:` band and layout in `App.tsx`. — covers AC2, AC3, AC5 (native path), AC6
5. Conditional: only if task 1 calls for it and Decision 3 = A. `feat:` double-click fallback in `src/main/index.ts`, plus the AC5 e2e test. — covers AC5
   - Trigger: `mouseDown` with `clickCount === 2` and `y < TITLE_BAR_HEIGHT`. Read `systemPreferences.getUserDefault('AppleActionOnDoubleClick', 'string')`.
   - `None`: do nothing. `Minimize`: call `minimize()`, only if Spec ambiguity 3 = A. Anything else (`Maximize`, `Fill`, unset): toggle `maximize()` / `unmaximize()` based on `isMaximized()`.
6. Verification: `npm run typecheck`, `npm test`, `npm run test:e2e`, then the manual checklist below, recorded in the PR description. Run it on macOS, in light and dark mode. — covers AC1 to AC6

### Test strategy
- Run commands from /Users/romain/projects/p0:
  - full run: `npm run typecheck && npm test && npm run test:e2e` (the e2e needs a macOS graphical session);
  - one AC: `npx vitest run -t "AC2"`, or `npm run build && npx playwright test -g "AC2"` (Playwright runs the built `out/`).
- Native elements cannot be tested by Playwright.
  - The buttons, the title text and the native drag/zoom are drawn and handled by AppKit, outside the page.
  - Playwright sends mouse events into the page through CDP, below the native window, so they never reach AppKit.
  - `capturePage()` captures only the web contents. A full screen capture needs the Screen Recording permission; clicking native buttons needs the Accessibility permission plus AppleScript or `cliclick`. Neither is proposed.
  - These parts are covered by e2e proxies plus the manual checklist.
- AC1 → e2e Electron + manual. Command: `npm run build && npx playwright test -g "AC1"`
  - E2E: `getContentSize()` equals `getSize()`, and `window.innerHeight` equals the window height. This shows there is no native title bar strip; today the content is shorter than the window.
  - Manual (cannot be automated): no title text and no title bar color, in light and dark mode; the three buttons are visible at the top left.
- AC2 → component + e2e Electron + manual. Commands: `npx vitest run -t "AC2"`, then `npm run build && npx playwright test -g "AC2"`
  - Component: `getByTestId('title-bar')` comes before the 4 regions in DOM order, is inside none of them, and is empty (`toBeEmptyDOMElement`).
  - E2E: the band box is x 0, y 0, width = `innerWidth`, height 40. The top of each of the 4 regions is at 40 px (48 px if Spec ambiguity 1 = B).
  - E2E, launched with `colorScheme: 'dark'` and then `'light'`: walk up from the band to the first non-transparent background. It must equal the `--background` token and the `body` background.
  - E2E, subject to task 1 Q3: `navigator.windowControlsOverlay.visible` is true, and `getTitlebarAreaRect()` has height 40 and x > 0. This shows the native buttons sit in a 40 px area on the left, where Electron centers them.
  - Manual (cannot be automated): the buttons are vertically centered in the band (zoomed screenshot), in light and dark mode.
- AC3 → e2e proxy + manual. Command: `npm run build && npx playwright test -g "AC3"`
  - E2E, subject to task 1 Q2: the band's computed `app-region` is `drag`, and none of the 4 regions has it.
  - Manual (a real drag cannot be automated): drag from the band just right of the buttons, from its center and from its right end; the window follows each time. Drag from a column: the window does not move.
- AC4 → e2e proxy + manual. Command: `npm run build && npx playwright test -g "AC4"`
  - E2E: `isClosable()`, `isMinimizable()` and `isMaximizable()` are all true.
  - Manual (native buttons cannot be automated):
    - close: the window closes and the app quits, as today;
    - minimize: the window goes to the Dock, then restore it;
    - green button, per Spec ambiguity 2 = A: a click enters full screen; an Option-click zooms, and another one restores.
- AC5 → manual; e2e only with the fallback.
  - Native path: no e2e. `page.mouse.dblclick` never reaches AppKit, so the test would fail while the app works. The AC3 drag-region proxy guards what the native behavior depends on.
  - Fallback path: `npm run build && npx playwright test -g "AC5"`. `page.mouse.dblclick(innerWidth / 2, 20)` makes `isMaximized()` true; a second double-click makes it false and `getBounds()` returns to its initial value. The test uses `test.skip` unless `AppleActionOnDoubleClick` is unset, `Maximize` or `Fill`. It is written only if task 1 Q4 confirms that CDP double-clicks reach the handler.
  - Manual (always required):
    - with the setting on Zoom, double-click the 3 points from task 1 Q1: the window zooms, and a second double-click brings back the previous size and position;
    - with "Do Nothing", nothing happens (Spec ambiguity 3 = A);
    - restore your own setting afterwards.
- AC6 → e2e Electron + full suites. Command: `npm run build && npx playwright test -g "AC6"`, then the full run.
  - E2E: `setWindowSize(app, 1024, 640)` gives `getSize()` = [1024, 640] and `innerHeight` = 640, so the band counts inside the minimum. The band is 40 px, chat ≥ 360 and panel ≥ 320 (±1), and no region extends past 640.
  - E2E: same checks after first widening the panel to 500 px with `dragSeparatorTo`.
  - Width math is unchanged: 8+56+8+240+8+360+8+320+8 = 1016 ≤ 1024. Column height at the minimum: 640 − 40 − 8 = 592 px.
  - The existing CA1, CA8, CA9 and CA10 tests check window size and x positions, never content height, so they still hold.
- Manual checklist (PR description): the manual items above, plus resizing the window by its corner down to the minimum, where nothing is clipped.

### Decisions to validate
- Vertical centering of the buttons — options: A. `titleBarOverlay: { height: 40 }` / B. `trafficLightPosition: { x, y }`, with y = (40 − button height) / 2 hard-coded — recommendation: A.
  - With A, Electron computes the offset from the real button height, which changes between macOS versions ([window_buttons_proxy.mm](https://github.com/electron/electron/blob/main/shell/browser/ui/cocoa/window_buttons_proxy.mm)). B hard-codes it.
  - Side effect of A: the page gets the standard Window Controls Overlay API (`navigator.windowControlsOverlay`, `env(titlebar-area-*)`). App code does not use it; the e2e reads it.
  - `height` has no platform restriction ([BaseWindowConstructorOptions](https://www.electronjs.org/docs/latest/api/structures/base-window-options)).
- Horizontal position of the buttons — options: A. default macOS inset / B. a custom inset (for example 16 px, closer to Codex) — recommendation: A.
  - The spec only asks for "top-left".
  - When both a height and a position are set, Electron stops centering ("Do not center buttons if height and button position specified"), so B brings back the hard-coded y of the previous decision.
- Fallback if Electron 44 does not zoom natively (task 1) — options: A. main-process `webContents` `before-mouse-event` handler (no preload, renderer unchanged) / B. a minimal preload plus IPC, as [Electron Fiddle](https://github.com/electron/fiddle/blob/main/src/main/main.ts) does, which breaks the `AGENTS.md` "no preload" rule / C. move AC5 to its own story — recommendation: A, but only if task 1 Q4 shows that a real double-click reaches it. Otherwise, back to Romain to choose B or C.

### Spec ambiguities
1. Top gap. "The four columns below it are unchanged" can mean that the band replaces the current 8 px top gap (columns start at 40 px) or sits above it (columns start at 48 px). Options: A. replace / B. add — recommendation: A. The approved 40 px is then the whole empty space above the columns; with B, 48 px would show. The side and bottom gaps are unchanged either way.
2. AC4, green button. By default, clicking it on macOS enters full screen (Electron windows can go full screen by default); zoom is Option-click or the button's hover menu. Options: A. keep the native behavior, with no code; full-screen specifics stay out of scope / B. `fullscreenable: false`, so a click zooms, which is non-standard and removes full screen — recommendation: A, which matches "as in any macOS app". The AC4 manual check then covers click = full screen and Option-click = zoom.
3. AC5 and the setting System Settings > Desktop & Dock > "Double-click a window's title bar to" (Fill / Zoom / Minimize / Do Nothing). Options: A. follow the setting / B. always zoom — recommendation: A.
   - AppKit and Chromium both read `AppleActionOnDoubleClick` ([native_widget_mac_nswindow.mm](https://chromium.googlesource.com/chromium/src/+/main/components/remote_cocoa/app_shim/native_widget_mac_nswindow.mm)). If the native path works, B cannot be enforced, and it would override the user's own choice.
   - Proposed AC5 wording: "Given the macOS setting is Zoom (or Fill)…". The out-of-scope line "double-click to minimize" then means no minimize feature of our own; a user who picked Minimize gets the system behavior.

### Risks
- Native double-click is unverified on Electron 44. Electron Fiddle wires it by hand through IPC, which suggests it may not be native. Task 1 checks it before any code is kept.
- Fallback A could pass in Playwright (CDP events reach `before-mouse-event`) while a real double-click, captured by AppKit in the drag region, never does: a green test on a broken feature. This is why task 1 Q4 checks a real double-click and AC5 keeps a manual check.
- Chromium may not expose `app-region` in computed style (Q2), or Window Controls Overlay may not be exposed on macOS (Q3). The matching e2e proxies would then become manual checks.
- AC1, AC3, AC4 and AC5 rely partly on the manual checklist, and the e2e needs a macOS graphical session. There is no CI, so both run locally before the PR.
- The only test machine runs macOS 26, whose buttons differ in size from earlier versions. The first decision (option A) absorbs this, but other macOS versions are not checked.
- In full screen, macOS hides the buttons and the empty 40 px band stays at the top. This is out of scope but visible to users.
- The window options apply on every platform. On Windows or Linux, `titleBarStyle: 'hidden'` plus `titleBarOverlay` would show overlay controls on the right; this is untested (out of scope, no build).

## Decisions
- 2026-10-01 — Native macOS title bar hidden, only the window buttons kept, in a full-width band at the top (approved by Romain)
- 2026-10-01 — Band height: 40 px (approved by Romain)
- 2026-10-01 — Double-clicking the band zooms the window, in the same user story (approved by Romain)
- 2026-10-01 — Starts after `chore/english-app-content` is merged into `dev` (approved by Romain)
- 2026-10-01 — Technical plan approved as recommended (approved by Romain):
  - buttons centered by `titleBarOverlay: { height: 40 }`, at the default macOS horizontal inset;
  - double-click fallback, if needed, in the main process (`before-mouse-event`), with no preload; if it does not receive a real double-click either, back to Romain;
  - the band replaces the 8 px top gap: columns start 40 px from the top;
  - green button keeps the native macOS behavior (click: full screen, Option-click: zoom); AC4 reworded;
  - double-click follows the macOS setting; AC5 reworded.
- 2026-10-01 — Task 1 spike reduced to the automatable questions (Q2, Q3, and Q4 for Playwright only), run by the dev before the red tests and not committed. The real double-click (Q1, Q4 for a real double-click) is checked manually by Romain at delivery; if it fails, the fallback above applies (approved by Romain)
