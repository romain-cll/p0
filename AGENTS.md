# p0 — Agent instructions

Desktop app (Electron) to drive Claude Code and other CLIs.

## Language

- Everything written to the repository or to GitHub is in English:
  - UI text;
  - code (identifiers and comments);
  - tests, including test titles;
  - specs in `docs/features/`, and other docs;
  - commit messages, branch names, PR titles and descriptions.
- Exceptions:
  - commits and PRs created before 2026-10-01 stay as they are;
  - French content still present in the app is translated in a dedicated user story.
- Conversations with Romain may be in French.

## Git workflow

- Gitflow: `main` ← `dev` ← short-lived branches.
- Branch from `dev`. Name branches `<type>/<short-slug>`, where `<type>` is a Conventional Commits type (`feat`, `fix`, `docs`, `chore`, `refactor`, `test`…).
- Open every PR against `dev`. Releases go through a PR from `dev` to `main`.
- Direct pushes, force-pushes and deletions are blocked on `main` and `dev` by the GitHub ruleset `protect-main-dev`, with no bypass. Every change goes through a PR.
- Commit messages and PR titles follow Conventional Commits: `type(scope): summary`.

## Feature specs

- Each feature has a spec in `docs/features/<slug>.md`: user story, acceptance criteria, out of scope, constraints, technical plan, decisions.
- The spec is the contract: implementation, tests and review follow it.

## Stack and commands

- Stack: Electron + electron-vite, React 19, TypeScript, Tailwind CSS v4, shadcn/ui (Radix, Mira preset). Package manager: npm.
- Commands:
  - `npm install`
  - `npm run dev`: start the app
  - `npm test`: unit and component tests (Vitest)
  - `npm run test:e2e`: end-to-end tests (Playwright Electron). They need an open macOS GUI session.
  - `npm run typecheck`

## Architecture rules

- The renderer must not depend on Electron APIs (no preload), so that the UI can later be served in a browser.
- Prefer shadcn/ui components. Replacing an existing shadcn/ui component with a custom one requires Romain's approval.
