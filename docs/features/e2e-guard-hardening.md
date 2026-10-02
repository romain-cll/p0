# E2E guard hardening

## User story
As Romain, I want the e2e suite to fail fast and clearly when the foreground check or the app launch goes wrong, so that a run never hangs and the real error is easy to spot.

## Acceptance criteria
- [ ] AC1 — Given the probe that reads the frontmost app does not answer (for example, blocked by a macOS permission prompt), when `npm run test:e2e` runs, then:
  - the probe is stopped after 5 s at most;
  - the suite fails with a message saying the frontmost-app probe timed out;
  - the run ends instead of hanging.
- [ ] AC2 — Given the Electron app fails to launch, when `npm run test:e2e` runs, then the report shows the launch error and no other error coming from the end-of-suite cleanup.
- [ ] AC3 — Given a normal run, when `npm run typecheck`, `npm test` and `npm run test:e2e` run, then they all pass as before: 20 e2e tests, one app launch, window never shown.

## Out of scope
- Any other change to the e2e suite or to the app.
- Making the probe work if macOS ever requires a permission: here, it only has to fail cleanly.

## Constraints
- No assertion of the existing tests is removed or weakened, and no other timeout is changed.
- English everywhere (see `AGENTS.md`).

## Technical plan
_To be completed by the architect._

## Decisions
- 2026-10-02 — Follow-ups from the e2e-quiet-runs review, handled right away (approved by Romain)
