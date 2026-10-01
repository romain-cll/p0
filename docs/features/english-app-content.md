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
### Approach
This is a translation only: no new code, dependency or abstraction. French literals are replaced in place in `index.html`, the 4 components and the mock data. The tests are translated in the same commit as the UI strings they assert, so every commit stays green. Test structure, selectors, assertions and values stay as they are. AC7 is checked with two repeatable `grep` commands and a read of the diff.

### Files
- modified: /Users/romain/projects/p0/src/renderer/index.html — `<html lang="fr">` → `<html lang="en">`
- modified: /Users/romain/projects/p0/src/renderer/src/components/ProjectRail.tsx — `aria-label` "Projets" → "Projects"
- modified: /Users/romain/projects/p0/src/renderer/src/components/ChatHistory.tsx — `aria-label` "Historique des chats" → "Chat history"
- modified: /Users/romain/projects/p0/src/renderer/src/components/ActiveChat.tsx — `aria-label` "Chat actif" → "Active chat"; empty state "Aucun message pour l'instant" → "No messages yet"; send button `aria-label` "Envoyer" → "Send". The textarea `aria-label="Message"` is already English and stays.
- modified: /Users/romain/projects/p0/src/renderer/src/components/ArtifactsPanel.tsx — `aria-label` "Artifacts et diff" → "Artifacts and diff"; content "Aucun artifact ni diff" → "No artifacts or diffs yet"
- modified: /Users/romain/projects/p0/src/renderer/src/data/projects.ts — the 12 chat titles (table in task 2). Project names Atlas, Borealis and Cobalt stay.
- modified: /Users/romain/projects/p0/src/renderer/src/App.test.tsx — `REGION_NAMES`, `EMPTY_CHAT`, `EMPTY_ARTIFACTS`, every `region('…')` argument, `{ name: 'Envoyer' }` → `'Send'`, all `describe`/`it` titles, the header and inline comments, typed text `'bonjour'`/`'monde'` → `'hello'`/`'world'`
- modified: /Users/romain/projects/p0/src/renderer/src/data/projects.test.ts — header comment, `describe('données fictives')` → `'mock data'`, the 4 `it` titles, the inline comment
- modified: /Users/romain/projects/p0/src/renderer/src/test/setup.ts — 1 comment (ResizeObserver stub)
- modified: /Users/romain/projects/p0/e2e/app.spec.ts — region names in `chatOf`, `panelOf` and the CA1 `names` array; all `test.describe`/`test` titles; comments and JSDoc; error and poll messages (`throw new Error(…)`, `expectWidth`, the CA1 order message, `expectTheme`); the window marker value `'vivant'` → `'alive'`
- modified: /Users/romain/projects/p0/playwright.config.ts — the 2-line header comment
- modified: /Users/romain/projects/p0/docs/features/english-app-content.md — Technical plan section (written by the PO)
- unchanged (searched, no French): `src/main/index.ts`, `src/renderer/src/main.tsx`, `App.tsx`, `index.css`, `lib/utils.ts`, `components/ui/button.tsx`, `resizable.tsx`, `textarea.tsx`, `electron.vite.config.ts`, `vitest.config.ts`, `package.json`, `components.json`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `.gitignore`. `package-lock.json` is generated and was not reviewed.

### Tasks (ordered)
1. `chore:` UI strings and document language, with the matching test strings in the same commit:
   - app: `index.html` and the 4 components (Files above);
   - `App.test.tsx`: `REGION_NAMES`, `EMPTY_CHAT`, `EMPTY_ARTIFACTS`, every `region('…')` argument and the `'Send'` button name;
   - `e2e/app.spec.ts`: `chatOf`, `panelOf` and the CA1 `names` array.
   — covers AC1, AC2, AC3, AC4, AC6
2. `chore:` mock chat titles in `projects.ts`. The order is unchanged. The tests read titles from `projects`, so no test changes. — covers AC5

   | Project | Current (French) | English |
   |---|---|---|
   | Atlas | Migrer la base vers PostgreSQL | Move the database to PostgreSQL |
   | Atlas | Corriger le bug de pagination | Fix the pagination bug |
   | Atlas | Ajouter un export CSV | Add a CSV export |
   | Atlas | Revoir les règles de cache | Review the caching rules |
   | Borealis | Refondre la page de connexion | Redesign the login page |
   | Borealis | Écrire les tests de l’API | Write the API tests |
   | Borealis | Optimiser le temps de build | Reduce build time |
   | Cobalt | Préparer la release 2.0 | Prepare the 2.0 release |
   | Cobalt | Documenter le module d’auth | Document the auth module |
   | Cobalt | Nettoyer les dépendances | Clean up dependencies |
   | Cobalt | Ajouter le mode hors ligne | Add offline mode |
   | Cobalt | Diagnostiquer une fuite mémoire | Investigate a memory leak |

   Titles are distinct within each project and plain ASCII. None is longer than the longest current title (31 characters), so truncation in the 240 px history column is unchanged.
3. `test:` translate the rest of the tests in `App.test.tsx`, `projects.test.ts`, `setup.ts` and `e2e/app.spec.ts`: titles, comments, assertion and error messages, and typed or marker literals. Also translate the header comment of `playwright.config.ts`.
   - Keep the `CA<n> — ` prefixes (see Spec ambiguities, 1) and add one comment line at the top of `App.test.tsx`, `projects.test.ts` and `app.spec.ts` saying that `CA<n>` refers to the acceptance criteria of `docs/features/app-shell.md`.
   - Selectors, assertions, numbers and test count stay as they are.
   — covers AC7, AC8
4. Verification: the two AC7 greps, `npm run typecheck`, `npm test`, `npm run test:e2e`. Then a quick manual look with `npm run dev`: the 4 columns, empty states and chat titles are in English. — covers AC7, AC8

### Test strategy
- Commands, from the repository root:
  - `npm run typecheck`
  - `npm test`
  - `npm run test:e2e` (needs a macOS graphical session)
  - to filter one criterion: `npx vitest run -t CA6` or `npx playwright test -g CA8`
- Tests that change: `App.test.tsx`, `projects.test.ts` and `e2e/app.spec.ts`, plus comments in `setup.ts` and `playwright.config.ts`. Only strings, titles, comments, messages and typed literals change. No test is added or removed (unless Spec ambiguity 2 is resolved as B).
- AC1 → component + e2e.
  - Component: `App.test` CA1 checks that the 4 regions with their English names exist in DOM order.
  - E2E: `app.spec` CA1 checks that they are visible with x increasing from left to right.
  - Every `region('…')` lookup in both files fails if a name was missed.
- AC2 → component. `App.test` CA5 loops over every project × (no chat, then each chat) and runs `getByText('No messages yet')` inside "Active chat". The third CA6 test repeats the check.
- AC3 → component. In `App.test` CA7, the region's `textContent` equals exactly `'No artifacts or diffs yet'`: once at startup, once after a project change, a chat selection and typing.
- AC4 → component. In `App.test` CA6, the button named `'Send'` inside "Active chat" is disabled before typing, after typing and after a click.
- AC5 → unit + review. `projects.test` CA2 (titles non-empty and distinct within each project) is unchanged and still passes. The English wording is checked by reading `projects.ts` against the task 2 table, plus the AC7 greps.
- AC6 → static check (see Spec ambiguities, 2). `grep -n lang src/renderer/index.html` must print `<html lang="en">`. AC7 command 2 also flags a leftover `fr`.
- AC7 → two greps plus a read of the diff. Both must print nothing (exit status 1). Neither uses quotes, so both pass the reviewer's read-only Bash guard. Run against today's tree, they find many hits, all in files that contain French; none in English-only files.
  1. Accented letters and French guillemets:
     `grep -rnI -F -e à -e â -e ç -e é -e è -e ê -e ë -e î -e ï -e ô -e ù -e û -e œ -e À -e Ç -e É -e È -e « -e » src e2e playwright.config.ts vitest.config.ts electron.vite.config.ts package.json components.json tsconfig.json tsconfig.node.json tsconfig.web.json .gitignore`
  2. French function words plus the former French UI strings and test literals, as whole words, ignoring case:
     `grep -rnI -i -w -F -e le -e la -e les -e de -e des -e du -e un -e une -e et -e est -e ou -e ni -e ne -e pas -e au -e aux -e ce -e son -e ses -e qui -e que -e pour -e sur -e dans -e avec -e aucun -e aucune -e fr -e projets -e historique -e actif -e envoyer -e bonjour -e monde -e vivant src e2e playwright.config.ts vitest.config.ts electron.vite.config.ts package.json components.json tsconfig.json tsconfig.node.json tsconfig.web.json .gitignore`
  - The symbols `—`, `×`, `≥` and `±` stay in test titles and comments. They are not French and are not flagged.
- AC8 → `npm test` and `npm run test:e2e` pass, and so does `npm run typecheck`. The `REGION_NAMES` union type turns any leftover French region name in `App.test.tsx` into a type error. The reviewer confirms that the test diff only touches strings, titles and comments:
  `git -C /Users/romain/projects/p0 diff --word-diff dev -- src/renderer/src/App.test.tsx src/renderer/src/data/projects.test.ts src/renderer/src/test/setup.ts e2e/app.spec.ts playwright.config.ts`

### Decisions to validate
- Mock chat titles — options: A. the English titles in the task 2 table / B. other wording from Romain — recommendation: A. They are close to literal translations, in the same order, distinct within each project, and no longer than today's longest title.

### Spec ambiguities
- AC7 and the `CA<n>` ids in test titles. "CA" is the French abbreviation of "critère d'acceptation". Options: A. keep `CA1`–`CA10` and add a comment saying they refer to `docs/features/app-shell.md` / B. rename them to `AC1`–`AC10` — recommendation: A, for three reasons:
  - these ids point into `app-shell.md`, which stays in French with its CA ids (decision of 2026-10-01);
  - the test strategy of that spec documents filters such as `npx vitest run -t "CA3"`;
  - with B, the test ids would clash with this spec's own AC1–AC8: "AC5" would mean the empty chat in the tests but the mock titles here.
- AC6 and AC8. No existing test covers `<html lang>`, and AC8 limits test changes to translations. Options: A. no new test; AC6 is checked statically (`grep -n lang src/renderer/index.html`, plus AC7 command 2) / B. add one e2e test in `app.spec.ts` (`await expect(page.locator('html')).toHaveAttribute('lang', 'en')`), which means reading AC8 as "existing tests are only translated" — recommendation: A. The attribute is a fixed value in a single file, and A follows AC8 to the letter. Choose B if Romain wants an automated guard against regressions.
- Scope of AC7. Assertion and error messages and test input values (`'bonjour'`, `'monde'`, `'vivant'`) are not in AC7's list ("UI text, identifiers, code comments or test titles"). Options: A. translate them too / B. leave them — recommendation: A. It follows the project rule that everything is in English, and AC8's "translated strings" allows it. AC7 command 2 relies on it.

### Risks
- The e2e region names are plain strings, not typed. A missed rename only shows up in `npm run test:e2e`, which needs a macOS graphical session, so it must be run locally before the PR.
- The two greps are heuristics: a French word with no accent that is not on the list would slip through. The reviewer still reads the whole diff, which is small (11 source files).
- `AGENTS.md` (PR #2) is not on this branch, and I had no shell to run `git show`. The plan relies on the rule as the PO relayed it: everything in English.
- `.claude/` is untracked and holds French agent memory. It is outside AC7's scope and must not be committed on this branch.

## Decisions
- 2026-10-01 — Everything written to the repo or GitHub is in English from now on; existing commits and PRs stay as they are (approved by Romain)
- 2026-10-01 — Existing French app content is translated in this dedicated user story (approved by Romain)
- 2026-10-01 — `docs/features/app-shell.md` stays in French (approved by Romain)
- 2026-10-01 — Technical plan approved as recommended (approved by Romain):
  - mock chat titles as in the task 2 table;
  - `CA<n>` prefixes kept in test titles, with a comment pointing to `app-shell.md`;
  - no new test for `<html lang>`, AC6 checked statically;
  - test messages and typed literals translated too.
- 2026-10-01 — Roles: the tester translates the tests first (red against the French app), then the dev translates the app. This replaces the "same commit" note of the plan (approved by Romain)
