# Quiet e2e runs

## User story
As Romain, I want the e2e suite to run without launching the app once per test and without taking the focus, so that I can keep working while the tests run.

## Acceptance criteria
- [x] AC1 — Given I am working in another app, when `npm run test:e2e` runs from start to end, then that app stays frontmost the whole time: no window of the tested app comes to the foreground.
- [x] AC2 — Given `npm run test:e2e` runs, when it completes, then the Electron app has been launched only once for the whole suite.
- [x] AC3 — Given the existing e2e tests (CA1 to CA10 of `docs/features/app-shell.md`, AC1 to AC6 of `docs/features/hidden-titlebar.md`), when they run on the shared app instance, then:
  - each test checks the same thing as before, with no assertion removed or weakened;
  - each test starts from the same initial state (window size, panel width, selected project and chat, theme), whatever the order in which tests run.
- [x] AC4 — Given the changes of this story, when `npm run typecheck`, `npm test` and `npm run test:e2e` run, then they all pass.
- [x] AC5 — Given the intermittent failures of the CA8 and CA9 drag and resize tests seen before this story, when the technical plan is written, then their root cause is identified and documented, and the fix removes that cause. Masking it is not allowed:
  - Playwright retries stay at 0, and no test is re-run until it passes;
  - no timeout is made longer;
  - no tolerance is made wider.

## Out of scope
- CI, and running the e2e suite on Linux or Windows.
- Vitest unit and component tests (they do not launch Electron).
- Any change of the app behavior for its users.

## Constraints
- Any change to production code made for the tests must have no effect when the app runs normally (`npm run dev`, build).
- Delivered on the branch `feat/hidden-titlebar`, before the review of the hidden title bar resumes.
- English everywhere (see `AGENTS.md`).

## Technical plan
### Root cause (AC5)
- **Cause.** The e2e window is a real window on Romain's screen, and it takes the focus. `src/main/index.ts:18` shows it on `ready-to-show`, and Electron documents `show()` as "Shows and gives focus to the window". From then on, macOS sends Romain's own input to the page, mixed with Playwright's synthetic CDP input:
  - pointer moves, whenever the cursor is over the window;
  - keys, because the window now has the focus.
- **How react-resizable-panels reacts.** The library (`/Users/romain/projects/p0/node_modules/react-resizable-panels/dist/react-resizable-panels.js`) listens on the whole document, and three of its behaviors break a drag:
  - Any `pointermove` with `buttons === 0` during a drag ends the drag where it is (`Rt`, lines 1742–1772). A real pointer move always has `buttons === 0`. Playwright's moves between `mouse.down` and `mouse.up` have `buttons === 1`.
  - A `pointerleave` on the document during a drag sets the drag delta to ±100 % (`Ct`, lines 1727–1741, then line 1090).
  - `pointerdown` focuses the separator (line 1705). Arrow keys, Home and End typed into the window then resize the panels by 5 % or 100 % (`It`, lines 1598–1662).
  - A drag cut short leaves a layout that is stable but wrong, so `expectWidth` times out after 5 s. That is the observed `expected width: 360px (±1)`.
- **Evidence.**
  - All three listed failures are in tests that drag: CA8 at :98 and :128, and CA9 at :170, which drags before it resizes.
  - The tests that only resize (CA9 :141 and :155, AC6 :433) are not in the list. Yet CA9 :155 depends just as much on the library's ResizeObserver.
  - Each test launches a new window that takes the focus. `launch()` (e2e/app.spec.ts:30–41) returns at `domcontentloaded`, and the drag starts at once, while the window is still appearing. That is exactly when someone who is working moves the pointer, clicks back to their app, or keeps typing.
  - The failure rate is the same before and after the hidden title bar change, so window chrome plays no part.
- **Ruled out by reading.**
  - **Race on the handle position.** The first render already lays out the panel at 400 px: `flexBasis` comes from `defaultSize` (lines 3505–3510). The library then computes its layout from `offsetWidth` in the same React commit (lines 2006–2030 and 3163–3201). `box()` waits for the separator. So the position `dragSeparatorTo` reads is the final one.
  - **Occlusion stopping rendering, and with it the ResizeObserver (lines 1952–1999).** Playwright's Electron loader adds `--disable-backgrounding-occluded-windows` and `--disable-renderer-backgrounding` (`/Users/romain/projects/p0/node_modules/playwright-core/lib/server/electron/loader.js`, lines 43, 64 and 91–95). The resize-only tests have not failed either.
  - **Timeout too short.** The layout update takes one frame; the poll waits 5 s.
- **Certainty.** The library behavior is certain: it is in the code. That it caused the failures seen so far is likely but not proven, because no input logs exist from those runs. Diagnostics D1 and D2 must run first, on the current code.
- **D1 — reproduce the failure, no human needed.** Use a scratch `e2e/diag.spec.ts`, not committed.
  - Copy the body of the CA8 "fully to the left" test. Inline the drag, and add this line between `page.mouse.down()` and the moves:
    `await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointermove', { buttons: 0, clientX: 600, clientY: 300 })))`
    Expected: it fails with `expected width: 360px (±1)`.
  - Second case: after a normal drag to 500 px, run `await page.keyboard.press('ArrowRight')`. Expected: `expectWidth(panel, 500)` fails.
  - Command: `npm run build && npx playwright test e2e/diag.spec.ts`
- **D2 — link it to the real failures, about 10 minutes.**
  - Temporary logger: in `launch()`, after `waitForLoadState`, add capture listeners on `window` for `pointerdown`, `pointermove`, `pointerup` and `keydown`. Each event pushes `{ type, buttons, x: clientX, y: clientY, key, t: performance.now() }` into `window.__inputLog`.
  - At the start of `afterEach`, before the apps close: if `test.info().status !== 'passed'`, print `__inputLog` and the window's `isVisible()` and `isFocused()`.
  - Command for each run: `npm run build && npx playwright test -g "CA8|CA9|AC6" --repeat-each=5`
    - Run A (control): pointer parked in a screen corner, outside the area where the window opens; hands off.
    - Run B (exposure): pointer at the screen center; move it slightly and press arrow keys from time to time during the run.
    - Run C: pointer at the screen center; hands off.
  - What counts as foreign input:
    - any `keydown` (the tests send none);
    - any pointer event off Playwright's path (the horizontal line through the handle center);
    - any `pointermove` with `buttons: 0` between `pointerdown` and `pointerup`.
  - Decision rule:
    - Confirmed if every failure has foreign input logged in that test, and run A has neither failures nor foreign input. Failures in C with foreign input mean the window's appearance under the pointer is enough on its own; the cause and the fix stay the same.
    - If any failure has no foreign input, the cause is elsewhere. Stop, and send the logs back to the architect. Do not implement this plan.

### Approach
In e2e runs only (`P0_E2E=1`, set by the suite), the main process never shows the window. Nothing takes the focus (AC1), and macOS can no longer send any user input to the page, which removes the AC5 cause. The suite launches the app once, in `beforeAll` (AC2). Each test starts with `resetApp()`: it restores the window size and the system theme, sets the test's color scheme emulation, and reloads the page (AC3). `npm run dev` and the build keep today's code path.

### Files
- modified: /Users/romain/projects/p0/src/main/index.ts — reads `const isE2E = process.env['P0_E2E'] === '1'`.
  - `window.once('ready-to-show', () => window.show())` is registered only when `!isE2E`.
  - Only if task 2 requires it: `webPreferences: { backgroundThrottling: false }`, added only when `isE2E`.
  - When `P0_E2E` is unset, the `BrowserWindow` options and the handler are exactly today's.
  - A comment points to docs/features/e2e-quiet-runs.md.
- modified: /Users/romain/projects/p0/e2e/app.spec.ts
  - **One launch.** Module-level `electronApp` and `appPage`, named so they do not shadow the `{ app, page }` the tests destructure.
    - `test.beforeAll`: `electron.launch({ args: [MAIN_ENTRY], env: { ...process.env, P0_E2E: '1' } as Record<string, string> })`. The cast is needed because `process.env` values are typed `string | undefined`. Then `firstWindow()`, `waitForLoadState('domcontentloaded')`, and `expectInBackground()`.
    - `test.afterAll`: `expectInBackground()`, then `close()` in a `finally`.
    - The `apps` array, the `afterEach` and `launch()` are removed.
  - **Reset.** `resetApp(options: { colorScheme?: 'dark' | 'light' | null } = {})` returns `{ app, page }`. The default is `'light'`, which is Playwright's default for `electron.launch`, so tests that called `launch()` keep the same emulation. Steps:
    1. In the main process: `nativeTheme.themeSource = 'system'` and `setSize(1280, 800)`.
    2. Poll until `getSize()` is [1280, 800], `innerWidth` is 1280 and `innerHeight` is 800.
    3. `page.emulateMedia({ colorScheme })`.
    4. `page.reload()`. React mounts again: project 1 selected, no chat selected, panel at its default 400 px, and no globals left on `window`.
    5. Guard: `expectWidth(panel, 400)`.
  - **Call sites.** Every `await launch(x)` becomes `await resetApp(x)`. The theme hot-switch test passes `colorScheme: null`; the `'no-override'` cast and its comment go away.
  - **`expectInBackground()`** (e2e-quiet-runs AC1) asserts that:
    - the window has `isVisible()` false and `isFocused()` false;
    - the frontmost app's PID is not `electronApp.process().pid`. The PID comes from `execFileSync('osascript', ['-l', 'JavaScript', '-e', "ObjC.import('AppKit'); $.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier"])`.
  - **Header comment.** The app is launched once and stays hidden (`P0_E2E`), and the hooks check e2e-quiet-runs AC1.
- modified: /Users/romain/projects/p0/docs/features/e2e-quiet-runs.md — Technical plan, written by the PO.
- Unchanged: /Users/romain/projects/p0/playwright.config.ts (no retries, same timeouts).
- No new file and no new dependency. `e2e/diag.spec.ts` and the D2 logger are temporary and not committed.

### Tasks (ordered)
1. Diagnostics D1, then D2 (runs A, B and C), on the current code, not committed. Record the outcome in the PR description and, through the PO, in the spec Decisions. If D2 refutes the cause, stop. — covers AC5
2. Spike, not committed (about 30 min). Apply the main-process gate, and pass `env` in the current `launch()` (still one launch per test). Then answer:
   - Q1: Does the whole current suite pass with the window never shown? Watch CA8 and CA9 especially, AC6, and the AC2 Window Controls Overlay test (`visible`, rect).
   - Q2: In one test, does `page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(document.visibilityState))))` return `'visible'`?
   - Q3: Run the `osascript` probe in Terminal, then during a run. Does it print a PID without any permission prompt, and is that PID not Electron's?
   - Outcomes:
     - Q1 or Q2 fails on rendering or resize: add `backgroundThrottling: false` under the flag and run again. If it still fails, go back to Romain.
     - The WCO, content size or mouse assertions fail on a hidden window: go back to Romain. No assertion can be weakened.
     - Q3 shows a prompt: the AC1 check becomes manual only.
   — de-risks AC1, AC3, AC5
3. `test:` red, in e2e/app.spec.ts: single launch, `resetApp`, `expectInBackground`, all as described in Files. It is red because the window is still shown and focused, so `expectInBackground` fails. — covers AC1, AC2, AC3
4. `test:` the main-process gate in src/main/index.ts, plus `backgroundThrottling: false` only if task 2 required it. — covers AC1, AC5
5. Verification: the commands in the Test strategy; run B again on the fixed code; the manual AC1 check. Record everything in the PR description. — covers AC1 to AC5

### Test strategy
- Run every command from /Users/romain/projects/p0. Full run: `npm run typecheck && npm test && npm run test:e2e`.
- **AC1 → e2e guard + manual.**
  - Automated, on every `npm run test:e2e`: `expectInBackground()` runs right after launch and again at the end.
    - Activation at launch, if any, happens before the first window loads, so the first check sees it.
    - No code hides the window. So "not visible" at the end means it was never shown.
  - Manual (PR checklist):
    - Start `npm run test:e2e` from Terminal. Within 1 s, click into TextEdit and type until the run ends. Every character must land in TextEdit, no Electron window may appear, and the menu bar must keep showing TextEdit.
    - Constraint check: `npm run dev` and `npm run build && npm start` still show the window and give it the focus.
- **AC2 → structure + launch count.**
  - Structure: `electron.launch` is called exactly once in e2e/app.spec.ts, inside `test.beforeAll`.
  - Run: `npm run build && DEBUG=pw:api npx playwright test 2>&1 | grep -c "=> electron.launch started"` must print `1` on a passing run. The log format comes from playwright-core `coreBundle.js:57405`.
- **AC3 → diff + guard + isolation runs.**
  - Same checks as before: `git diff f6ca980 -- e2e/app.spec.ts | grep -E '^-[^-].*expect'` must print nothing. In the diff, only the `launch(` → `resetApp(` call sites change, plus `'no-override'` → `null`, the removed `launch()` and `afterEach`, and the new hooks and helpers.
  - Same initial state whatever the order:
    - The main-process state (window size, `themeSource`) and the emulation are set explicitly.
    - The page state (selection, panel width, globals) is rebuilt by the reload. The app persists nothing: no storage, no saved layout.
    - The guard fails the next test if the window size or the panel width ever leaks.
  - Each group run alone, so it follows a different predecessor:
    `npm run build && for g in "CA1 " "CA8 " "CA9 " "CA10 " "AC1 " "AC2 " "AC3 " "AC4 " "AC6 "; do npx playwright test -g "$g" || break; done`
  - The theme tests (CA10) keep checking the same thing. The theme is CSS only (`prefers-color-scheme`), and the old tests already relied on Playwright's emulation in the renderer, not on the main process.
    - Dark and light at startup: the emulation is set, then the page reloads. The document starts under the requested scheme, as it did with `electron.launch({ colorScheme })`, and `expectTheme` polls as before.
    - Hot switch: `emulateMedia({ colorScheme: null })` turns emulation off, as `'no-override'` did. `themeSource` starts at `'system'`, as on a fresh launch. The `__themeMarker` is set after the reset, so it still proves there is no reload.
    - If `null` did not turn emulation off, the hot-switch test would fail: nothing can pass silently.
- **AC4 →** `npm run typecheck && npm test && npm run test:e2e`.
- **AC5 → before and after.**
  - Before: D1 and D2 results, recorded.
  - After: run B again with the D2 logger re-added in `resetApp`: `npm run build && npx playwright test -g "CA8|CA9|AC6" --repeat-each=5`. Expected: no foreign input logged and no failure. This is evidence, not a pass-N-times criterion; any failure is a real failure.
  - Nothing masked: `git diff f6ca980 -- playwright.config.ts` is empty (no `retries`, same `timeout`). The AC3 diff check covers e2e/app.spec.ts: no `timeout:` option added, and every `±1` / `<= 1` / `PANEL_MIN - 1` unchanged.

### Decisions to validate
- Where the e2e-only switch lives — options: A. env var `P0_E2E` read in `src/main/index.ts` / B. no production change: a main-process module loaded with Electron's `-r` flag (as Playwright's own loader is) that replaces `BrowserWindow.prototype.show` — recommendation: A.
  - A is one visible condition next to the code it changes, and it is unset in dev and in the build.
  - B patches an Electron prototype from the test side, adds a file, and breaks silently if the app ever shows its window another way.
- How the window stays out of the foreground — options: A. never shown during the run / B. `showInactive()` with `setOpacity(0)` and `setIgnoreMouseEvents(true)` / C. `showInactive()` then `blur()`, which puts it behind other windows — recommendation: A.
  - A is the only option where no window is ever put on screen. AC1 then holds strictly, and the OS cannot send user input to it, which is the AC5 cause.
  - B still puts an invisible window in front of Romain's app.
  - C shows the window in front for a moment, then leaves it reachable by the pointer wherever it is not covered.
- AC1 automated check — options: A. the `expectInBackground()` guard in the hooks, plus the manual check / B. manual only — recommendation: A, if task 2 Q3 shows no prompt.
  - The probe uses a public AppKit API and sends no Apple Events, so it needs no permission.
  - The guard also catches the AC5 cause coming back: if the window is ever shown again, the suite fails every time instead of now and then.
- Per-test reset — options: A. `resetApp(options)` called first in each test, in place of `launch(options)` / B. a `beforeEach` plus a custom Playwright fixture with a `colorScheme` option set per describe (`test.use`) — recommendation: A.
  - A keeps the file's helper pattern and its call sites, with one reload per test. Every current test already starts with this call.
  - B adds a fixture layer the file does not use today.

### Spec ambiguities
1. AC2 when a test fails. After any failure, Playwright discards the worker and runs `beforeAll` again in a new one (Playwright docs, "Test retries"). A failing run therefore launches the app more than once. Options: A. AC2 applies to a passing run / B. `test.describe.configure({ mode: 'serial' })` keeps a single launch but skips every test after the first failure — recommendation: A. B hides failures.
2. AC1 and the Dock. The app still gets a Dock icon and a Cmd-Tab entry during the run, with no window and no focus. Options: A. acceptable, since AC1 is about the foreground / B. also hide it under `P0_E2E` with `app.dock.hide()` — recommendation: A.

### Risks
- **A never-shown window is unverified on Electron 44 / macOS 26.** Unknowns: ResizeObserver rendering, the viewport following `setSize`, the Window Controls Overlay (`visible`, rect), and CDP mouse input. Electron documents that with `show: false` the renderer is "considered visible and paint[s]". Task 2 checks this before any code is kept, and `backgroundThrottling: false` is the prepared fallback for rendering. For the other unknowns, the way out is back to Romain, because no assertion can be weakened.
- **The cause is not proven by reading.** D2 decides. If D2 refutes it, this plan does not fix the flakiness.
- **The library behavior stays.** Any `pointermove` with `buttons === 0` still ends a drag. If the e2e window is ever shown again (screenshots, debugging with a visible window), the flakiness comes back; the AC1 guard fails first in that case.
- **The app might still activate at launch, with no window.** The frontmost probe would catch it. Fallback under the same flag: `app.setActivationPolicy('accessory')`.
- **The e2e no longer exercises a shown window.** What happens at show time (focus, macOS fitting the frame to the screen) was never asserted. It stays covered only by the manual checklists.
- **Shared instance.** Any state that `resetApp` does not cover would leak between tests. Today there is none. Any future persisted state, such as a saved panel width, must be added to the reset.
- **The `osascript` JXA probe depends on macOS tooling.** If a future macOS asks for a permission, the AC1 check falls back to manual.
- **Setup is unchanged.** The e2e still needs a logged-in macOS GUI session, and there is no CI.

## Decisions
- 2026-10-01 — High priority, before resuming the hidden title bar story, on the same branch (approved by Romain)
- 2026-10-01 — The hidden title bar implementation is kept and committed as is, unreviewed; its review resumes after this story (approved by Romain)
- 2026-10-01 — The flaky CA8/CA9 tests are fixed in this story, at their root cause. A test failure means a real problem: no retries, no "pass N times" criterion (approved by Romain)
- 2026-10-01 — Technical plan approved as recommended (approved by Romain):
  - e2e-only switch: env var `P0_E2E`, read in `src/main/index.ts`;
  - the window is never shown during e2e runs;
  - automated AC1 guard `expectInBackground()`, plus a one-time manual check;
  - per-test reset with `resetApp(options)`;
  - AC2 applies to a passing run (Playwright relaunches the app after a failure);
  - the Dock icon and the Cmd-Tab entry stay during the run.
- 2026-10-01 — Root cause diagnostics: D1 and D2 (runs A, B and C) both run before any fix. Romain performs the D2 runs himself (approved by Romain)
- 2026-10-01 — D1 results:
  - Case 1 confirmed: a `pointermove` with `buttons: 0` during a drag makes the CA8 test fail with `expected width: 360px (±1)`.
  - Case 2 not confirmed: after a Playwright drag, focus is on `BODY`, not on the separator, so arrow keys change nothing. Stray keys are therefore an unlikely mechanism. The stray pointer moves remain the main suspect.
  - D2 adjusted: the input log is dumped for every test, not only failing ones, so that the decision rule can check for foreign input in passing tests too.
- 2026-10-02 — D2 results: root cause **confirmed**. This supersedes "likely but not proven" in the Root cause section and the matching item in Risks.
  - Run A (pointer in a corner, hands off): 40 tests passed, 0 failed, no foreign input.
  - Run B (pointer at the center, moves and arrow keys): 21 passed, 19 failed. All 19 failures had 15 to 23 stray `buttons: 0` pointer moves inside the drag; the first one came 4 to 15 ms after `pointerdown`.
  - Run C (pointer at the center, hands off): 40 passed. In 35 of the 40 tests, the window appearing under the resting pointer sent one stray move, sometimes only 2 ms before `pointerdown`. Keeping hands off is therefore not enough.
  - Over 75 drags, a test failed exactly when a stray move landed inside the drag: 19 drags had one and all 19 failed, 56 had none and all 56 passed.
  - Keys were seen but caused no failure. `pointerleave` was not observed.
  - All 120 dumps show `isVisible: true` and `isFocused: true`.
  - The approved fix (window never shown during e2e runs) removes every source seen. If task 2 needs a fallback, it must meet the same bar: no OS mouse or key event may reach the page. `showInactive()` then `blur()` does not meet it.
- 2026-10-02 — AC5 "After" verification (task 5), amended per the D2 analysis:
  - Install the D2 logger at the end of `resetApp()`, after `page.reload()`. Dump it for every test from the shared app instance.
  - Run once under run B conditions (pointer at the screen center, moves and arrow keys), with a text editor in front.
  - Expected:
    - 0 failures;
    - every dump has `isVisible: false` and `isFocused: false`;
    - every drag log is exactly Playwright's path;
    - tests without a drag log nothing;
    - no keydown.
  - Run C does not need to be repeated.
- 2026-10-02 — Task 2 spike results (window never shown, one launch per test, 2 full runs):
  - Q1 yes: 20/20 passed on both runs, with no assertion change. The WCO, content size and mouse drag assertions all hold.
  - Q2 yes: `document.visibilityState` is `'visible'` in all 40 probes, while `isVisible()` and `isFocused()` are false.
  - Q3 yes: the `osascript` probe needs no permission prompt. The frontmost PID was never Electron's.
  - The app does not come to the foreground at launch, so `app.setActivationPolicy('accessory')` is not needed.
  - `backgroundThrottling: false` is not needed and is not added.
- 2026-10-02 — Manual AC1 check, by Romain, during the AC5 "After" run (`CA8|CA9|AC6`, `--repeat-each=5`, with the temporary logger): TextEdit stayed in front, and everything he typed went into it. The temporary logger is reverted and not committed.
- 2026-10-02 — AC5 "After" results, from the log of that run, as analyzed by the reviewer. The log itself was emptied by a later Playwright run.
  - 40 passed, 0 failed. For comparison, D2 run B had 19 failures out of 40.
  - All 40 dumps show `isVisible: false` and `isFocused: false`.
  - 0 keydown and 0 pointerleave.
  - All 25 drags follow exactly Playwright's path: 575 events, all on y = 416.
  - The 15 tests without a drag logged nothing.
- 2026-10-02 — AC2 count: `DEBUG=pw:api npx playwright test | grep -c "=> electron.launch started"` prints `1`, with 20 passed in 2.6 s.
- 2026-10-02 — Review OK. Follow-ups for a later story, since the test file is frozen here:
  - give the `osascript` probe in `expectInBackground()` a timeout, so that a future macOS permission prompt makes the run fail instead of hang;
  - avoid the extra TypeErrors in `afterAll` when `electron.launch` fails.
- Still to check manually (with the hidden title bar checklist): `npm run dev` still shows the window and gives it the focus.
