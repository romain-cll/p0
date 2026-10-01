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
- [ ] AC4 — Given the window buttons, when I click close, minimize or zoom, then the window closes, minimizes or zooms, as in any macOS app.
- [ ] AC5 — Given the main window at its normal size, when I double-click anywhere in the band outside the window buttons, then the window zooms; when I double-click the band again, then the window returns to its previous size and position.
- [ ] AC6 — Given the minimum window size of 1024 × 640 px (whole window, band included), when the window is at that size, then the active chat stays at 360 px or more and the Artifacts and diff panel at 320 px or more. All existing tests still pass.

## Out of scope
- Windows and Linux (custom title bar, window controls).
- Double-clicking the band to minimize the window.
- Any content in the band: title, buttons, search, project name.
- Specific behavior in macOS full-screen mode.
- Placing the window buttons inside a column.

## Constraints
- Layout as validated by Romain: a full-width empty band at the top, with the window buttons on the left; the four columns below it are unchanged.
- English everywhere (see `AGENTS.md`).

## Technical plan
_To be completed by the architect._

## Decisions
- 2026-10-01 — Native macOS title bar hidden, only the window buttons kept, in a full-width band at the top (approved by Romain)
- 2026-10-01 — Band height: 40 px (approved by Romain)
- 2026-10-01 — Double-clicking the band zooms the window, in the same user story (approved by Romain)
- 2026-10-01 — Starts after `chore/english-app-content` is merged into `dev` (approved by Romain)
