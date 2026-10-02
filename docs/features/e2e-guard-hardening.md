# E2E guard hardening

## User story
As Romain, I want the e2e suite to fail fast and clearly when the foreground check or the app launch goes wrong, so that a run never hangs and the real error is easy to spot.

## Acceptance criteria
- [x] AC1 — Given the probe that reads the frontmost app does not answer (for example, blocked by a macOS permission prompt), when `npm run test:e2e` runs, then:
  - the probe is stopped after 5 s at most;
  - the suite fails with a message saying the frontmost-app probe timed out;
  - the run ends instead of hanging.
- [x] AC2 — Given the Electron app fails to launch, when `npm run test:e2e` runs, then the report shows the launch error and no other error coming from the end-of-suite cleanup.
- [x] AC3 — Given a normal run, when `npm run typecheck`, `npm test` and `npm run test:e2e` run, then they all pass as before: 20 e2e tests, one app launch, window never shown.
- [x] AC4 — Given the probe that reads the frontmost app returns an empty or non-numeric output, when `npm run test:e2e` runs, then the suite fails with a message saying the frontmost-app probe returned an invalid answer, and showing that answer. The frontmost check never passes without a valid PID.

## Out of scope
- Any other change to the e2e suite or to the app.
- Making the probe work if macOS ever requires a permission: here, it only has to fail cleanly.

## Constraints
- No assertion of the existing tests is removed or weakened, and no other timeout is changed.
- English everywhere (see `AGENTS.md`).

## Technical plan
### Approach
Two small changes, both in `e2e/app.spec.ts`. The `osascript` probe gets a 5 s timeout with `SIGKILL`, and a timeout becomes an explicit "frontmost-app probe timed out" error (AC1). `afterAll` returns at once when `electron.launch` never returned an app, so only the launch error is reported (AC2).
Each failure is checked by forcing it on the real suite through the environment: a fake `osascript` first on `PATH`, and Electron's path pointed at nothing. No window is shown, nothing takes the focus, and nothing extra is committed.

### Files
- modified: /Users/romain/projects/p0/e2e/app.spec.ts
  - **Probe (lines 45–54).** Moves into a local `readFrontmostPid()`, placed just above `expectInBackground()`. It keeps the same `execFileSync('osascript', …)` call and arguments, and adds `{ timeout: PROBE_TIMEOUT_MS, killSignal: 'SIGKILL' }`.
    - `SIGKILL` is needed because `execFileSync` waits for the child to exit, and a process blocked on a prompt may ignore `SIGTERM`.
    - On a timeout, Node throws an error with `code === 'ETIMEDOUT'`. The helper turns it into the AC1 message. Any other error is rethrown unchanged.
    ```ts
    /** e2e-guard-hardening AC1: the frontmost-app probe gives up after this delay instead of hanging. */
    const PROBE_TIMEOUT_MS = 5_000
    // in readFrontmostPid(), catch block:
    if ((error as NodeJS.ErrnoException).code !== 'ETIMEDOUT') throw error
    throw new Error(
      `frontmost-app probe timed out after ${PROBE_TIMEOUT_MS} ms: osascript did not answer (a macOS permission prompt may be waiting)`,
      { cause: error }
    )
    ```
  - **`expectInBackground()`.** Becomes `const frontmostPid = readFrontmostPid()`. Its `expect(frontmostPid, …)` line stays exactly as it is.
  - **`test.afterAll` (lines 68–74).** First line: `if (!electronApp) return`, with a comment: e2e-guard-hardening AC2, `electron.launch` threw in `beforeAll`, its error is the one reported, and there is no app to check or close. The `try` / `finally` is unchanged.
- modified: /Users/romain/projects/p0/docs/features/e2e-guard-hardening.md — Technical plan, written by the PO.
- Unchanged:
  - playwright.config.ts, src/main/index.ts and package.json;
  - the test count stays at 20;
  - no new file, no new dependency.

### Tasks (ordered)
1. "Before" evidence on the current code. Nothing is committed. Run the AC1 command with the *slow* shim and the AC2 command (see Test strategy), and record both outputs in the PR description. This shows that both commands really reach the failure paths. — covers AC1, AC2
2. `fix(e2e-guard-hardening): time out the frontmost-app probe`: `PROBE_TIMEOUT_MS` and `readFrontmostPid()`, as in Files. — covers AC1
3. `fix(e2e-guard-hardening): skip afterAll cleanup when the launch failed`: the `afterAll` guard. — covers AC2
4. Verification: the AC1 and AC2 forced runs, then the AC3 commands. Record everything in the PR description. — covers AC1, AC2, AC3

### Test strategy
- **Setup.** Run every command from /Users/romain/projects/p0 in one zsh session. `npm run test:e2e` is `electron-vite build && playwright test`, so `npm run build` followed by `npx playwright test` runs the same thing.
  ```sh
  WORK=$(mktemp -d); mkdir "$WORK/bin"
  errors() { node -e '
  const r = require(process.argv[1]); const all = [...r.errors];
  const walk = (s) => { for (const spec of s.specs ?? []) for (const t of spec.tests) for (const res of t.results) all.push(...res.errors); (s.suites ?? []).forEach(walk) };
  r.suites.forEach(walk);
  console.log(`${all.length} error(s)`); for (const e of all) console.log(`- ${(e.message ?? "").split("\n")[0]}`);
  ' "$WORK/report.json"; }
  npm run build
  ```
  `errors` counts every error in the JSON report: test errors, hook errors and top-level errors.
- **Nothing on screen.** The suite still sets `P0_E2E=1`, so the window is never shown. The fake `osascript` is a shell `sleep`. The AC2 run starts no Electron process at all. Romain can keep working during every run.
- **AC1 → forced e2e run with the real probe code; the fake `osascript` never answers.**
  ```sh
  printf '#!/bin/sh\nexec sleep 86400\n' > "$WORK/bin/osascript"; chmod +x "$WORK/bin/osascript"
  time PATH="$WORK/bin:$PATH" npx playwright test --reporter=json > "$WORK/report.json"; errors
  pgrep -fl 'sleep 86400|out/main/index.js'
  ```
  - Expected:
    - the run exits non-zero;
    - `time` reports under about 20 s: launch plus 2 × 5 s. Playwright's 30 s hook timeout is not what ends it;
    - `errors` prints 2 errors, both containing `frontmost-app probe timed out after 5000 ms`: one from `beforeAll`, one from `afterAll`. There is nothing else, and the other 19 tests do not run;
    - `pgrep` prints nothing: the probe was killed and the app was closed.
  - Before the fix (task 1), use a bounded shim, `exec sleep 20`, then `time PATH="$WORK/bin:$PATH" npx playwright test`. Expected: `20 passed`, about 40 s slower than a normal run (about 2.6 s), and no timeout message. This shows the probe has no time limit.
  - Why a `PATH` shim: `execFileSync('osascript', …)` finds `osascript` through `PATH`. The shim therefore hits the committed code itself, with a command that never answers.
- **AC2 → forced e2e run with the Electron path pointed at nothing.**
  ```sh
  ELECTRON_OVERRIDE_DIST_PATH=/nonexistent npx playwright test --reporter=json > "$WORK/report.json"; errors
  ```
  - How it works:
    - playwright-core finds Electron with `require("electron/index.js")` (node_modules/playwright-core/lib/coreBundle.js:44267);
    - when the variable is set, that module returns `/nonexistent/Electron.app/Contents/MacOS/Electron` (node_modules/electron/index.js:30–31);
    - the spawn fails with ENOENT and `electron.launch` throws in `beforeAll`.
  - Expected after the fix: `1 error(s)`, the launch error (`… Failed to launch: Error: spawn /nonexistent/Electron.app/Contents/MacOS/Electron ENOENT`), and the other 19 tests do not run.
  - Before the fix (task 1): 2 errors. The second one is `TypeError: Cannot read properties of undefined (reading 'close')`, from `afterAll`.
  - Rejected way to force the failure: deleting `out/main/index.js`. Electron would then open its own "Unable to find Electron app" window.
- **AC3 → normal run, unchanged.**
  ```sh
  npm run typecheck && npm test && npm run test:e2e        # e2e ends with "20 passed"
  npm run build && DEBUG=pw:api npx playwright test 2>&1 | grep -c "=> electron.launch started"   # prints 1
  ```
  - Window never shown: `expectInBackground()` still runs in both hooks with unchanged assertions, so a passing run proves it.
  - Constraints:
    - `git diff dev -- e2e/app.spec.ts | grep -E '^-[^-].*expect'` prints nothing, so no assertion was removed or changed;
    - `git diff dev --stat` lists only `e2e/app.spec.ts` and the spec;
    - `git diff dev -- e2e/app.spec.ts | grep -iE '^\+.*timeout'` shows only the probe lines, so no other timeout changed.
- **Cleanup:** `rm -rf "$WORK"`.

### Decisions to validate
- **How the probe is called** — options: A. keep `execFileSync` and add `timeout` + `killSignal: 'SIGKILL'` / B. switch to the async `execFile` (promisified) with the same options — recommendation: A.
  - A is the smallest change and keeps the current call.
  - With A, the worker is blocked for 5 s at most, well under the 30 s hook timeout.
  - B only helps if a process survives `SIGKILL`, which cannot happen.
- **How AC1 and AC2 are verified** — options: A. one-off forced runs of the real suite through the environment, recorded in the PR / B. committed automated tests — recommendation: A.
  - B means a Vitest test of a probe helper with an injectable command, which needs a new file, a `vitest.config.ts` change and a node environment. It also means an extra Playwright test for the launch failure, which takes the e2e count past the 20 that AC3 requires.
  - A runs the committed code on the real failure paths, without extra code that exists only for tests.
- **Second probe error in the AC1 case** — options: A. keep it: `afterAll` runs its check again, which times out too (same message, 5 s more) / B. skip the `afterAll` check when the `beforeAll` check failed, which needs a flag — recommendation: A.
  - AC1 is met either way.
  - The two errors carry the same clear message.

### Spec ambiguities
1. **What "the Electron app fails to launch" covers in AC2** — options: A. `electron.launch` throws, as in the review follow-up ("when `electron.launch` fails") / B. also `firstWindow()` or `waitForLoadState` failing, for example a main process that crashes at startup — recommendation: A.
   - With B, `afterAll` would still add an error from `electronApp.evaluate`. Avoiding it needs extra state, beyond the review follow-up.

### Risks
- **The checks are not automatic.** They are one-off runs, not part of `npm run test:e2e`, so a later edit could remove the timeout or the guard with no test failing. This is accepted with Decision 2 = A.
- **The forced runs depend on tool behavior:**
  - `PATH` lookup of `osascript`;
  - `ELECTRON_OVERRIDE_DIST_PATH` in the `electron` package.

  If either stops working, the forced run shows `20 passed` instead of the expected failure. It cannot pass silently.
- **A real permission prompt is not reproduced.** The shim simulates "no answer" at the process level. That `SIGKILL` stops a real blocked `osascript` is assumed (it cannot be caught). A system prompt could stay on screen after the kill; that is out of scope.
- **Out of scope, found on the way.** An empty or non-numeric probe output becomes PID `0` or `NaN`, so the frontmost check passes without checking anything. The task 1 "before" run shows it. This is a candidate follow-up, because this story cannot touch it.

## Decisions
- 2026-10-02 — Follow-ups from the e2e-quiet-runs review, handled right away (approved by Romain)
- 2026-10-02 — Technical plan approved (approved by Romain):
  - AC1 and AC2 are verified by one-off forced runs of the real suite, recorded in the PR. No committed test is added. Accepted risk: a later edit could remove the timeout or the guard with no test failing.
  - The probe keeps `execFileSync`, with `timeout` and `killSignal: 'SIGKILL'`.
  - In the AC1 case, the timeout error shows twice (`beforeAll` and `afterAll`), with the same message.
  - AC2 covers `electron.launch` throwing only, not an app that crashes after launch.
- 2026-10-02 — AC4 added: the "found on the way" risk of the plan (empty or non-numeric probe output → the check passes silently) is fixed in this story, in `readFrontmostPid()` (approved by Romain).
  - Verification: same technique as AC1, a `PATH` shim for `osascript`, here one that prints nothing and exits 0.
  - Before the fix, the run gives `20 passed`: the silent pass.
  - After the fix, the suite fails with the AC4 message.
- 2026-10-02 — Roles: all changes are test code (`e2e/app.spec.ts`), so the tester makes them. Task 1 ("before" evidence, including the AC4 case) stands in for the red step. The tester then does tasks 2 and 3 plus AC4, and the reviewer runs the forced checks of task 4 again. There is no dev step.
- 2026-10-02 — Review OK (0 review loop). The reviewer's Bash guard blocks the forced runs, so the PO re-ran them independently, with the window hidden:
  - AC1, never-answering shim: exit 1 in 11 s, 2 "probe timed out" errors, 19 tests skipped.
  - AC2, `ELECTRON_OVERRIDE_DIST_PATH=/nonexistent`: exit 1, 1 error (launch ENOENT).
  - AC4, empty-output shim: exit 1, 2 "invalid answer" errors.
  - AC3: 20 passed in 2.6 s, launch count 1.
  - No `sleep` or Electron process was left over.
