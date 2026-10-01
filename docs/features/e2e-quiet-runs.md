# Quiet e2e runs

## User story
As Romain, I want the e2e suite to run without launching the app once per test and without taking the focus, so that I can keep working while the tests run.

## Acceptance criteria
- [ ] AC1 — Given I am working in another app, when `npm run test:e2e` runs from start to end, then that app stays frontmost the whole time: no window of the tested app comes to the foreground.
- [ ] AC2 — Given `npm run test:e2e` runs, when it completes, then the Electron app has been launched only once for the whole suite.
- [ ] AC3 — Given the existing e2e tests (CA1 to CA10 of `docs/features/app-shell.md`, AC1 to AC6 of `docs/features/hidden-titlebar.md`), when they run on the shared app instance, then:
  - each test checks the same thing as before, with no assertion removed or weakened;
  - each test starts from the same initial state (window size, panel width, selected project and chat, theme), whatever the order in which tests run.
- [ ] AC4 — Given the changes of this story, when `npm run typecheck`, `npm test` and `npm run test:e2e` run, then they all pass.
- [ ] AC5 — Given the intermittent failures of the CA8 and CA9 drag and resize tests seen before this story, when the technical plan is written, then their root cause is identified and documented, and the fix removes that cause. Masking it is not allowed:
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
_To be completed by the architect._

## Decisions
- 2026-10-01 — High priority, before resuming the hidden title bar story, on the same branch (approved by Romain)
- 2026-10-01 — The hidden title bar implementation is kept and committed as is, unreviewed; its review resumes after this story (approved by Romain)
- 2026-10-01 — The flaky CA8/CA9 tests are fixed in this story, at their root cause. A test failure means a real problem: no retries, no "pass N times" criterion (approved by Romain)
