# English app content

## User story
As Romain, I want all the app content in English, so that the codebase follows the project language rule set on 2026-10-01.

## Acceptance criteria
- [ ] AC1 — Given the app is launched, when the main window opens, then the four columns are exposed, left to right, with the accessible names "Projects", "Chat history", "Active chat" and "Artifacts and diff".
- [ ] AC2 — Given any project and any chat selected (or none), when I look at the active chat, then it shows the empty state "No messages yet".
- [ ] AC3 — Given any app state, when I look at the Artifacts and diff panel, then its only content is "No artifacts or diffs yet".
- [ ] AC4 — Given the input area of the active chat, when I look at the send button, then its accessible name is "Send" and it is still disabled.
- [ ] AC5 — Given the mock data, when I open the chat history of each project, then every chat title is in English. Titles remain distinct within a project.
- [ ] AC6 — Given the app is launched, when I inspect the document, then its language is English (`<html lang="en">`).
- [ ] AC7 — Given the source files under `src/` and `e2e/` and the config files at the repository root, when they are reviewed, then no French remains in UI text, identifiers, code comments or test titles.
- [ ] AC8 — Given the behaviors specified in `docs/features/app-shell.md` (CA1 to CA10), when `npm test` and `npm run test:e2e` run, then all tests pass. Test changes are limited to translated strings, titles and comments.

## Out of scope
- Any i18n framework, language switch or French localization: strings stay hard-coded in English.
- Any visual or behavioral change.
- Rewriting existing commits and PRs.
- Translating `docs/features/app-shell.md`, the spec of a delivered feature.

## Constraints
- Use exactly the strings given in the acceptance criteria.
- The project language rule is in `AGENTS.md` (PR #2).

## Technical plan
_To be completed by the architect._

## Decisions
- 2026-10-01 — Everything written to the repo or GitHub is in English from now on; existing commits and PRs stay as they are (approved by Romain)
- 2026-10-01 — Existing French app content is translated in this dedicated user story (approved by Romain)
- 2026-10-01 — `docs/features/app-shell.md` stays in French (approved by Romain)
