# Chat with Claude Code

## User story
As a developer, I want to add a project folder and chat with Claude Code about it from the app, so that I can drive Claude Code without the terminal.

## Acceptance criteria

### Projects
- [x] AC1 — Given the app is open, when I click the "+" button of the project rail, then the macOS folder picker opens; when I pick a folder, then a project named after that folder appears in the rail, with its initial, and becomes selected. If I cancel, nothing changes. If the folder is already a project, that project is selected and no duplicate is created.
- [x] AC2 — Given I added projects, when I quit and relaunch the app, then the same projects appear in the rail, in the same order, and the first one is selected.
- [x] AC3 — Given no project was added, when the app opens, then the rail shows only the "+" button, and the chat history and active chat show the empty state "Add a project to get started". The mock projects and chats no longer exist.

### Chats
- [ ] AC4 — Given a selected project, when I click "New chat" in the chat history, then a new chat appears at the top of the list and is selected, with an empty conversation and the Plan permission mode. Its title is "New chat" until the first message is sent, then the first line of that message.
- [ ] AC5 — Given a selected chat, when I type a message and press Enter (or click Send), then:
  - the message appears in the conversation and the input is cleared;
  - Claude Code answers in the project folder, and its reply appears progressively in the conversation as it arrives.
  Shift+Enter inserts a line break. An empty message cannot be sent.
- [ ] AC6 — Given a chat with previous exchanges, when I send a new message, then Claude Code continues the same conversation: it has the previous messages of this chat, and only those.
- [ ] AC7 — Given Claude Code performs actions while answering (reads a file, edits a file, runs a command…), when they happen, then each action appears in the conversation as one line, in order with the text, showing the kind of action and its target (file path or command).

### Permission mode
- [ ] AC8 — Given a chat, when I look at the input area, then a selector shows the chat's permission mode. It offers the Claude Code permission modes that never ask the user, with Claude Code's labels: Plan, Accept edits, Auto, Don't ask, Bypass permissions. The default is Plan.
- [ ] AC9 — Given I change the mode of a chat, when I send the next message in that chat, then Claude Code runs with that mode. Each chat keeps its own mode; other chats are not affected.
- [ ] AC10 — Given a chat in Plan mode, when Claude Code answers, then no file of the project folder is created, modified or deleted, and only Claude Code's read-only commands may run.

### Stop and background
- [ ] AC11 — Given Claude Code is answering in the selected chat, when I click Stop (the send button turns into Stop while it answers) or press Esc, then the answer stops. What was received stays visible, marked as interrupted, and I can send a new message.
- [ ] AC12 — Given Claude Code is answering in chat A, when I switch to another chat or project and come back, then the answer of chat A kept going and shows everything received meanwhile. Other chats can send their own messages while chat A is answering.

### Errors
- [ ] AC13 — Given Claude Code cannot answer (CLI not installed, not logged in, or any error it returns), when I send a message, then the chat shows an error message that says what went wrong, and the app keeps working: other chats still work, and I can send again once fixed.

## Out of scope
- The "Ask" permission mode and in-app permission prompts: next user story.
- Keeping chats and their messages between two launches: projects only are kept.
- Chat status in the history (answering, unread, pinned).
- Other CLIs than Claude Code.
- Model choice, slash commands, attachments and images, `@file` mentions.
- Markdown rendering of replies: replies are shown as plain text with line breaks.
- Full action details (file diffs, command outputs).
- Removing, renaming or reordering projects; projects whose folder was moved or deleted after being added.
- Keyboard shortcut to change the permission mode.
- Content of the Artifacts and diff panel: it keeps its empty state.
- Windows, Linux and the web version.

## Constraints
- The chat UI uses shadcn's AI chat components as much as possible: conversation, messages, input, actions, and so on. The architect explores the shadcn documentation for them and lists which component covers which AC. A custom component replacing an existing shadcn one needs Romain's approval (see `AGENTS.md`). If a component brings something out of scope for free, such as Markdown rendering, the architect says so and Romain decides.
- Claude Code is driven through the official Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), with the user's existing Claude Code login. The app does not handle authentication.
- Agents are integrated through adapters. An adapter is a provider-specific module that receives its agent's own events and translates them into one common event type defined by the app. The rest of the app only reads these common events and never sees a provider's own format. This story delivers one adapter, for Claude Code. Adding another agent (e.g. Codex) must only require a new adapter.
- Automated tests never call the real Claude Code service (no cost, deterministic results).
- `AGENTS.md` says the renderer must not depend on Electron APIs (no preload), so that the UI can later run in a browser. The architect proposes how the UI talks to the process that runs Claude Code while keeping that goal. Any change to the `AGENTS.md` rule needs Romain's approval.
- The e2e suite keeps running hidden, with one launch, and never takes the focus (see `docs/features/e2e-quiet-runs.md`). Spikes and checks run by the team also keep the app window hidden (`P0_E2E=1`). Anything that needs a visible window is left to Romain's manual checks.
- This story replaces these behaviors of `docs/features/app-shell.md`:
  - the mock data (CA2, CA3);
  - the permanent "no messages" empty state (CA5);
  - the always-disabled send button, and Enter inserting a line break (CA6).
  The tests of those criteria change accordingly.
- English everywhere (see `AGENTS.md`).

## Technical plan

### Changes from the previous version
- **Agent SDK replaces the `claude -p` subprocess (Romain's decision).** `src/main/claude.ts` is replaced by `src/main/agents/claude-code.ts`, the only module that imports `@anthropic-ai/claude-agent-sdk`.
- **New adapter layer.**
  - `AgentAdapter` interface in `src/main/agents/agent.ts`.
  - The common `AgentEvent` type lives in `src/shared/chat.ts` (it was `ChatEvent`). The API layer and the renderer read only this type.
  - `index.ts` passes the adapter to the API layer.
  - The permission mode list now comes from the adapter, through `GET /agent`.
- **Multi-turn and Stop.** Each message is still its own run with `resume`. Each run is now a streaming-input `query()` holding that one message, so Stop uses `interrupt()`, with `close()` as fallback. SIGINT/SIGKILL are gone.
- **Binary.** The adapter runs the installed `claude`, found on `PATH` and passed as `pathToClaudeCodeExecutable` (new Decision 3). The SDK's bundled binary is installed but not used.
- **New run options:**
  - `permissionPrompts: 'none'`;
  - the `claude_code` system prompt preset (new Decision 14);
  - `allowDangerouslySkipPermissions` for Bypass only;
  - Plan enforcement through the `settings` option.
- **AC13.** Errors are translated from the SDK's documented error messages.
- **Tests.**
  - The fake CLI on `PATH` is replaced by a fake SDK `query` passed into the real adapter. Unit tests pass it directly; the e2e loads it through `P0_FAKE_SDK_QUERY`, read only under `P0_E2E`.
  - The e2e `PATH` holds only a dummy `claude` that refuses to run.
- **Spike S1** now records SDK messages, and adds a check inside the Electron main process.
- **Decisions.**
  - New dependency `@anthropic-ai/claude-agent-sdk`, pinned to an exact version (new Decision 13).
  - New Decision 5 (adapter interface).
  - Decisions 3, 4, 9 and 12 are rewritten. The rest are renumbered.
- **Spec ambiguities.** 1 and 2 are re-checked against the SDK. Ambiguity 10 is new (denied actions).
- **Correction.** My previous report mentioned a `supportedPermissionModes()` SDK method. The SDK reference has no such method, so the mode list stays a fixed list in the adapter.
- **Risks.** The licensing question is kept as a fact. New SDK risks: version skew, API key precedence, keychain prompt, bundled binary, no automated test of the real SDK.
- **Unchanged:** shadcn mapping, transport, projects, e2e userData isolation, story split, test ids, ambiguities 3 to 9, app-shell test changes.

### Approach
The main process drives Claude Code through the Agent SDK, behind a minimal adapter. The Claude Code adapter runs one `query()` per message on the installed `claude` (`pathToClaudeCodeExecutable`, `resume`, `permissionMode`, `interrupt()`) and translates SDK messages into the app's `AgentEvent`s, the only format the API layer and the renderer see. The renderer reaches the main process through `fetch` on a custom `p0://api` scheme with streamed NDJSON (no preload, no port). Projects are a JSON file in `userData`, and chats live in a renderer reducer. The UI uses shadcn's chat components (Message Scroller, Message, Bubble, Marker) plus Input Group, Select and Empty. Tests pass a fake SDK `query` into the real adapter, and the fake replays real recordings.

### Files
- created: /Users/romain/projects/p0/src/shared/chat.ts — types shared by main and renderer.
  - `Project { path; name }`.
  - `PermissionModeOption { value; label }` and `AgentInfo { permissionModes; defaultPermissionMode }`.
  - `RunRequest { runId; projectPath; prompt; permissionMode; sessionId? }`.
  - `AgentEvent`, the app's common event type, one of: `session {sessionId}`, `text {text}`, `action {kind; target}`, `error {message}`, `end {interrupted}`. Every run emits `end` exactly once, and last. No field is specific to one provider.
- created: /Users/romain/projects/p0/src/main/agents/agent.ts — the adapter interface, and nothing else (Decision 5):
  ```ts
  export interface AgentRun { cwd: string; prompt: string; permissionMode: string; sessionId?: string }
  export interface AgentAdapter extends AgentInfo {
    start(run: AgentRun, emit: (event: AgentEvent) => void): { stop(): void }
  }
  ```
  `permissionMode` and `sessionId` are opaque strings for the rest of the app.
- created: /Users/romain/projects/p0/src/main/agents/claude-code.ts — `createClaudeCodeAdapter({ query })`. `query` defaults to the SDK's `query`; tests pass their own.
  - **Modes.** `permissionModes` is the list from Spec ambiguity 2, with Claude Code's labels. It is written with `satisfies` against the SDK's `PermissionMode` values, so an SDK upgrade that drops a mode fails `npm run typecheck`. `defaultPermissionMode` is `'plan'`.
  - **`start(run, emit)`, finding the CLI.** It looks for the first executable file named `claude` in `process.env.PATH`. If there is none, it emits `error` "Claude Code CLI not found. Install it, then send again." then `end`, and never calls `query` (Decision 3).
  - **`start(run, emit)`, starting the run.** It calls `query({ prompt: input, options })`.
    - `input` is an async iterable. It yields the one user message, stays open until that turn's `result`, then ends so the CLI exits.
    - Streaming input mode is what makes `interrupt()` available (Decision 4).
  - **Options passed to `query`:**
    - `cwd: run.cwd`, `pathToClaudeCodeExecutable: <found path>`, `resume: run.sessionId`;
    - `permissionMode: run.permissionMode`;
    - `allowDangerouslySkipPermissions: true`, only for `bypassPermissions`, because the SDK requires it for that mode;
    - `permissionPrompts: 'none'`: this story has no way to answer a prompt, so anything that would ask is denied instead of waiting. It requires Claude Code 2.1.259 or later; the installed version is 2.1.287;
    - `includePartialMessages: true`, for token streaming (AC5);
    - `systemPrompt: { type: 'preset', preset: 'claude_code' }`, because the SDK default is a minimal prompt (Decision 14);
    - in Plan mode only, `settings: { useAutoModeDuringPlan: false }`, if Spec ambiguity 1 = B;
    - `stderr`: keeps the last lines, for error messages.
    - `settingSources` keeps its default (user, project, local), so CLAUDE.md, project settings and the login behave as in the terminal.
  - **Translation: `toAgentEvents(message, cwd)`**, pure and exported.
    - `system`/`init`: the adapter keeps `session_id`. It emits `session` only at the first model output (a `stream_event`, or an `assistant` message without `error`), so a run that fails before reaching the model leaves the chat without a session.
    - `stream_event` with `content_block_delta`/`text_delta` gives `text`. The SDK streams only the main conversation.
    - `assistant`:
      - each `tool_use` block gives `action {kind: tool name, target}`. The target is the first of `input.file_path`, `notebook_path` (relative to `cwd` when inside it), `command` (first line), `pattern`, `url`, `query`, or empty;
      - text blocks are ignored, since they were already streamed;
      - an `error` field (`authentication_failed`, `billing_error`…) gives `error` with the message text.
    - `result` with `is_error` gives `error` with its text, unless a stop was requested.
    - Any other message gives nothing.
  - **Errors thrown by the iteration** give `error` with the SDK's message ([troubleshooting](https://code.claude.com/docs/en/agent-sdk/troubleshooting)):
    - `Claude Code executable not found at …` becomes the "not found" text above;
    - `Claude Code process exited with code N. stderr: …` and `Failed to spawn Claude Code process: …` are shown as they are;
    - `Claude Code returned an error result: …` is skipped when the result error was already emitted.
  - The run always ends with `end {interrupted}`.
  - **`stop()`** calls `interrupt()`. If no `result` arrives within 5 s, or if `interrupt()` rejects, it calls `close()`.
- created: /Users/romain/projects/p0/src/main/agents/claude-code.test.ts — unit tests with a fake `query` that replays the S1 fixtures. Starts with `// @vitest-environment node`.
- created: /Users/romain/projects/p0/src/main/projects.ts — `listProjects(file)` and `addProject(file, folder)`.
  - The file is `<userData>/projects.json`: a JSON array of absolute paths, in the order they were added.
  - `name` is `basename(path)`.
  - Adding a path that is already there changes nothing and returns that path as the selected one.
  - A missing file means an empty list.
  - There is no in-memory cache, so a page reload reads the disk.
- created: /Users/romain/projects/p0/src/main/api.ts — `handleApiRequest(request, { projectsFile, pickFolder, adapter })`, which returns a `Response`. It does not import Electron or the SDK; it only knows `AgentAdapter` and `AgentEvent`.
  - `GET /projects` returns `Project[]`.
  - `POST /projects` opens the folder picker and returns `{ projects, selected }`. `selected` is `null` on cancel.
  - `GET /agent` returns the adapter's `AgentInfo`.
  - `POST /runs` takes a `RunRequest`.
    - It answers 400 if `projectPath` is not in the store or `permissionMode` is not in `adapter.permissionModes`.
    - Otherwise it calls `adapter.start({ cwd: projectPath, … })` and returns a 200 `application/x-ndjson` stream of `AgentEvent`s until `end`.
    - When the reader cancels the stream (for example on a page reload), the run is stopped.
  - `POST /runs/:runId/stop` returns 204.
  - `OPTIONS` answers the CORS preflight, and every response carries `Access-Control-Allow-Origin: *` (the dev origin is `http://localhost:5173`, the build origin is `null`). Spike S2 confirms which headers are needed.
  - `stopAll()` stops every run, for app quit.
- created: /Users/romain/projects/p0/src/main/projects.test.ts, /Users/romain/projects/p0/src/main/api.test.ts — Vitest, node environment. `api.test.ts` uses a fake `AgentAdapter`.
- created: /Users/romain/projects/p0/src/renderer/src/lib/api.ts — the only renderer module that talks to the main process. Tests mock it.
  - Functions: `listProjects()`, `addProject()`, `getAgent()`, `startRun(request, onEvent)`, `stopRun(runId)`.
  - `const API_BASE = 'p0://api'`.
  - It splits the NDJSON stream into lines, including lines cut across chunks.
- created: /Users/romain/projects/p0/src/renderer/src/lib/api.test.ts — NDJSON lines split across chunks, with a mocked `fetch`.
- created: /Users/romain/projects/p0/src/renderer/src/lib/chats.ts — pure reducer.
  - State: `Record<projectPath, Chat[]>`.
  - `Chat { id; title; permissionMode; sessionId?; status: 'idle' | 'answering'; items }`.
  - Item kinds: `user`, `assistant` (text), `action` (kind, target), `interrupted`, `error`.
  - Actions:
    - `create`: inserts the chat at the top, titled "New chat", in `AgentInfo.defaultPermissionMode`;
    - `send`: adds the user item; on the first message, the title becomes the first non-empty line;
    - `event`: `text` is appended to the last assistant item, or starts a new one after an action;
    - `setMode`.
- created: /Users/romain/projects/p0/src/renderer/src/lib/chats.test.ts — unit tests of the reducer.
- created: /Users/romain/projects/p0/src/renderer/src/components/ui/{empty,message-scroller,message,bubble,avatar,marker,input-group,input,select}.tsx — generated by `npx shadcn add …` (Decision 2). The CLI also adds the `@shadcn/react` dependency.
- created: /Users/romain/projects/p0/e2e/fake-sdk/query.mjs — the fake SDK `query` (see Test strategy).
- created: /Users/romain/projects/p0/e2e/fake-sdk/bin/claude — a `#!/bin/sh` dummy that writes "fake claude: the real Claude Code must not run in e2e" to stderr and exits 1. Committed with the executable bit.
- created: /Users/romain/projects/p0/e2e/fake-sdk/fixtures/*.jsonl — the S1 recordings, one SDK message per line, sanitized. Both `claude-code.test.ts` and the fake use them.
- modified: /Users/romain/projects/p0/src/main/index.ts
  - `protocol.registerSchemesAsPrivileged([{ scheme: 'p0', privileges: { supportFetchAPI: true, corsEnabled: true, stream: true } }])`, at the top level.
  - `if (isE2E && process.env['P0_USER_DATA_DIR']) app.setPath('userData', …)`, before `ready`.
  - The adapter is `createClaudeCodeAdapter({ query })`. Under `P0_E2E=1` with `P0_FAKE_SDK_QUERY` set, `query` is `(await import(pathToFileURL(process.env['P0_FAKE_SDK_QUERY']).href)).query` (Decision 9). Otherwise it is the SDK's `query`.
  - After `ready`: `protocol.handle('p0', …)` with `{ projectsFile, pickFolder, adapter }`. `pickFolder` calls `dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] })` at the moment of the request, which lets the e2e stub it.
  - `app.on('will-quit', stopAll)`.
- modified: /Users/romain/projects/p0/src/renderer/index.html — the CSP adds `connect-src 'self' p0:`.
- modified: /Users/romain/projects/p0/src/renderer/src/App.tsx
  - On mount, loads the projects and `AgentInfo`, then selects the first project.
  - Keeps the project index and the chat id, and holds `useReducer(chats)`.
  - Switching project clears the chat selection, as in app-shell CA3.
  - `send` dispatches the message, then calls `startRun`. Its `onEvent` dispatches to that chat's id, so a run keeps updating its chat while another chat is shown (AC12).
- modified: /Users/romain/projects/p0/src/renderer/src/components/ProjectRail.tsx — a "+" button after the projects (`aria-label="Add project"`, lucide `Plus`); keys by path; uses the shared `Project` type.
- modified: /Users/romain/projects/p0/src/renderer/src/components/ChatHistory.tsx — a "New chat" button at the top; chats keyed by id; the Empty state "Add a project to get started" when there is no project.
- modified: /Users/romain/projects/p0/src/renderer/src/components/ActiveChat.tsx
  - Empty states.
  - The conversation: Message Scroller, Message/Bubble, Marker.
  - `InputGroup`:
    - `InputGroupTextarea aria-label="Message"`;
    - an addon at `block-end` holding the mode `Select` (`AgentInfo.permissionModes`, story 3);
    - an `InputGroupButton` named "Send", which becomes "Stop" while Claude Code answers.
  - `onKeyDown`: Enter without Shift, and not during IME composition, sends a non-empty message. Esc stops the answer (Spec ambiguity 5).
- modified: /Users/romain/projects/p0/src/renderer/src/test/setup.ts — an `IntersectionObserver` stub, plus `Element.prototype.scrollTo` if `@shadcn/react` needs it in jsdom.
- modified: /Users/romain/projects/p0/src/renderer/src/App.test.tsx — rewritten as listed in the Test strategy.
- modified: /Users/romain/projects/p0/e2e/app.spec.ts
  - Launch `env`, set in `electron.launch`, so no shell variables are needed:
    - `PATH = <repo>/e2e/fake-sdk/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
    - `P0_FAKE_SDK_QUERY = <repo>/e2e/fake-sdk/query.mjs`;
    - `P0_FAKE_CLAUDE_STATE` and `P0_USER_DATA_DIR`, both under a `mkdtemp` dir;
    - `P0_E2E=1`.
  - Guard in `beforeAll`: in the main process, `process.env.PATH` equals that `PATH` and `P0_FAKE_SDK_QUERY` is set.
  - `resetApp()` also restores the main process's `PATH` and deletes `projects.json` before it reloads the page.
  - New helpers: `stubFolderPicker`, `addProject`, `newChat`, `send`.
  - New tests.
- modified: /Users/romain/projects/p0/vitest.config.ts — `include` adds `src/main/**/*.test.ts`.
- modified: /Users/romain/projects/p0/tsconfig.node.json, /Users/romain/projects/p0/tsconfig.web.json — `include` adds `src/shared/**/*`.
- modified: /Users/romain/projects/p0/package.json, /Users/romain/projects/p0/package-lock.json
  - `@anthropic-ai/claude-agent-sdk`, pinned to an exact version (Decision 13). It also installs its optional platform package, which carries a bundled binary.
  - The SDK goes in `dependencies`, so electron-vite 5 keeps it external in `out/main/index.js` and its own module resolution keeps working. No config change is needed.
  - `@shadcn/react`, added by the shadcn CLI.
- modified: /Users/romain/projects/p0/AGENTS.md — only if Decision 6 = A.
- modified: /Users/romain/projects/p0/docs/features/claude-code-chat.md — Technical plan, written by the PO.
- deleted: /Users/romain/projects/p0/src/renderer/src/data/projects.ts, /Users/romain/projects/p0/src/renderer/src/data/projects.test.ts — the mock data (AC3).

### Tasks (ordered)
The tasks are grouped by the stories proposed in Decision 1. If Romain keeps a single PR, run them in this same order.

**Story 1 — Projects** (AC1, AC2, AC3, and the "New chat" part of AC4)
1. Spike S2, not committed, about 30 min. It decides the transport (Decision 6).
   - Q1: in `npm run dev` (http://localhost:5173) and in the build (`file://`), under the new CSP, a `protocol.handle('p0')` handler returns `new Response(readableStream)` and enqueues one line every 200 ms. Does a renderer `fetch` POST with a JSON body read the lines one by one, rather than all at the end?
   - Q2: does the handler receive the `OPTIONS` preflight, and which headers does it need?
   - Q3: does `page.reload()` call the stream's `cancel()`?
   - Q4: does all of this hold in the hidden e2e window?
   - Outcome: if every answer is yes, option C. If any is no, go back to Romain (option A needs the `AGENTS.md` change).
2. `chore:` foundations: `src/shared/chat.ts`, the tsconfig includes, the Vitest include, and `npx shadcn add empty`. — basis for AC1 to AC4
3. `test:` then `feat:` the projects store and its unit tests. — covers AC1 (name, no duplicate), AC2 (order, persistence)
4. `test:` then `feat:` the project routes of `api.ts`, with CORS. In `index.ts`: the scheme, the handler, the picker and the userData override. Then the CSP. — covers AC1, AC2
5. `test:` red component tests first. Then `feat:`:
   - `lib/api.ts`, the project functions;
   - `lib/chats.ts`, the `create` action;
   - App, ProjectRail and ChatHistory, and the empty states in ActiveChat;
   - deleting the mock data.
   — covers AC1, AC2, AC3, AC4 (the chat appears at the top, selected, titled "New chat", empty)
6. `test:` e2e: the launch env, the `resetApp` additions, the picker stub, and the chat AC1, AC2 and AC3 tests. — covers AC1, AC2, AC3
7. Verification and manual checklist: the real picker opens as a sheet; cancel changes nothing; quit and relaunch with `npm run dev`. — covers AC1, AC2, AC3

**Story 2 — superseded.** The story 2 tasks below (8 to 16) are replaced by "Tasks — story 2, amended after story 1" further down, and story 3 tasks become 18 to 20. The original list stays here for its details: the S1 cases (a) to (i) are still the reference.

**Story 2 — Chat with Claude Code, Plan mode only** (rest of AC4, AC5 to AC7, AC10 to AC13)
8. Spike S1, run once by hand against the real service, in a scratch git repo. It makes a few real calls. The recordings are sanitized and committed as fixtures. — de-risks AC5, AC7, AC8, AC10, AC11, AC13
   - Versions: `claude --version`, and the `--permission-mode` choices from `claude --help`. The installed binary, `~/.local/share/claude/versions/2.1.287`, contains `["acceptEdits","auto","bypassPermissions","default","dontAsk","plan"]`. Choose the matching SDK release (Decision 13).
   - Recordings: a scratch Node script, not committed. It calls the SDK with `pathToClaudeCodeExecutable` set to the installed `claude` and the adapter's options, and appends each SDK message as one JSON line. Cases:
     - (a) a short answer in Plan mode;
     - (b) Read, Edit and Bash in `acceptEdits`;
     - (c) `interrupt()` during an answer: what follows it, the `result`, and whether a later `resume` query still remembers the conversation;
     - (d) not logged in, with `env: { ...process.env, CLAUDE_CONFIG_DIR: <empty dir> }`: the messages yielded and the error thrown;
     - (e) `resume` with a random UUID: the error thrown;
     - (f) `pathToClaudeCodeExecutable` pointing to a missing path: the error thrown (no service call);
     - (g) Plan mode with `permissionPrompts: 'none'` and `useAutoModeDuringPlan: false`, asked to create a file and to run `touch x`: `git status --porcelain` must stay empty. Note which commands ran and which permission-denied messages arrived;
     - (h) `permissionMode: 'auto'`: which mode the init message reports;
     - (i) the time to the first event.
   - Electron check: one short query from the main process, in `npm run dev` and in `npm run build && npm start`. Check that the SDK stays external in `out/main/index.js`, that the installed binary is the one that runs, that no macOS Keychain prompt appears, and the value of `process.versions.node` (24.21.0 expected).
9. `test:` the fake SDK `query` and the fixtures (`e2e/fake-sdk/`). — basis for AC5 to AC13
10. `test:` then `feat:` the adapter interface and the Claude Code adapter, with their unit tests. — covers AC5, AC6, AC7, AC10, AC11, AC12, AC13
11. `test:` then `feat:` `GET /agent`, the run and stop routes, stop on stream cancel, and `will-quit`. — covers AC5, AC11, AC12
12. `chore:` `npx shadcn add message-scroller message bubble marker input-group`. Refuse the overwrites of `button.tsx` and `textarea.tsx`. Then the `setup.ts` stubs. — basis
13. `test:` then `feat:` the reducer (`send`, events, title, interrupted, error) and the run functions of `lib/api.ts`. — covers AC4, AC5, AC6, AC7, AC11, AC12, AC13
14. `test:` red component tests first, then `feat:` the ActiveChat conversation and input. The CA6 tests are removed. — covers AC5, AC7, AC11, AC12, AC13
15. `test:` e2e chat AC5, AC6, AC7, AC10, AC11, AC12 and AC13. — covers the same ACs
16. Verification and manual checklist with the real Claude Code, on a real project:
    - a streamed answer with action lines;
    - a follow-up message that remembers the previous one;
    - Plan mode leaves `git status` clean;
    - Stop, with the button and with Esc;
    - two chats answering at once.
    — covers AC5, AC6, AC7, AC10, AC11, AC12

**Story 3 — Permission modes** (AC8, AC9)
17. `chore:` `npx shadcn add select`.
18. `test:` then `feat:` the mode `Select` (`aria-label="Permission mode"`, options from `AgentInfo.permissionModes`) in the input addon, `setMode` in the reducer, and the chat's mode sent with each run. — covers AC8, AC9, and "Plan by default" from AC4
19. `test:` e2e chat AC8 and AC9, then verification. Manual check with the real Claude Code: Accept edits creates the requested file, Plan does not. — covers AC8, AC9, AC10

### Changes for story 2, after story 1
- **New task 10, the navigation guard.** It comes before the run routes. New files: `src/main/navigation.ts` and its test. Story 2 tasks are renumbered 8 to 17. Story 3 tasks become 18 to 20; their content is unchanged, except that the `select` task gets the same generated-file check as task 13.
- **Task 11 (adapter)** now covers the Claude Code adapter only. `src/main/agents/agent.ts` already exists from story 1.
- **Task 12 (routes):**
  - `adapter` becomes required in `ApiDeps`;
  - `index.ts` builds the adapter and passes it;
  - `RunRequest` is added to `src/shared/chat.ts`;
  - stop on reload hangs on the stream's `cancel()`, as found in spike S2.
  - The Files section is out of date on three points, already settled by S2 and the story 1 code: the `OPTIONS` route and the CORS header, and the `stream: true` privilege.
- **Task 13 (shadcn):** every generated file is fixed: `cn` imports, registry paths, `IconPlaceholder`. If the CLI added the `cn` package, it is removed.
- **Task 15 (App and ActiveChat):**
  - `App` loads `AgentInfo`, and `DEFAULT_PERMISSION_MODE` is deleted;
  - "Select or start a chat" keeps the input and Send disabled;
  - the "no message" checks move from `listitem` to the conversation's items.
- **Task 16 (e2e):** it reuses story 1's `addProject`, `stubFolderPicker` and `makeFolder`. The temp dir is already a real path, so no extra step is needed for the `Folder:` check.
- **Task 17 (manual checks):** adds the drag-and-drop check. The AC10 line of the Test strategy now points to task 17, not 16.
- **Test strategy:**
  - a guard block;
  - the new API route tests;
  - a test that the app uses the agent's default mode;
  - static checks on the generated files;
  - a DOM contract for the conversation;
  - the updated list of tests that change.
- New Decisions 15 and 16, and five new Risks.

### Tasks — story 2, amended after story 1
**Story 2 — Chat with Claude Code, Plan mode only** (rest of AC4, AC5 to AC7, AC10 to AC13)

8. **Spike S1**, as approved (Decision 12 = A, split). It records real SDK messages and checks the SDK inside Electron. — de-risks AC5, AC7, AC8, AC10, AC11, AC13
   - **Done by the dev, with scripts, no window:**
     - versions: `claude --version`, and the `--permission-mode` choices from `claude --help`; choose the matching SDK release (Decision 13);
     - a scratch Node script, not committed, calls the SDK with `pathToClaudeCodeExecutable` set to the installed `claude` and the adapter's options. It writes each SDK message as one JSON line. Cases (a) to (i) as listed in the original story 2 task 8 above;
     - sanitize the recordings and commit them as `e2e/fake-sdk/fixtures/*.jsonl`.
   - **Done by Romain (a window opens, and a Keychain prompt may appear):** one short query from the main process, in `npm run dev` and in `npm run build && npm start`. He checks that:
     - the SDK stays external in `out/main/index.js`;
     - the installed binary is the one that runs;
     - no Keychain prompt appears;
     - `process.versions.node` is 24.21.0.
9. **`test:` the fake SDK.** `e2e/fake-sdk/query.mjs`, the fixtures, and the dummy `e2e/fake-sdk/bin/claude`, committed with the executable bit. — basis for AC5 to AC13
10. **`test:` then `feat:` the navigation guard.** It must land before `POST /runs` exists (task 12): the scheme handler cannot tell which page sent a request (no `Origin` header, per S2), so the guarantee is that only the app's page ever runs in the window. — precondition for AC5 to AC13
    - New file: /Users/romain/projects/p0/src/main/navigation.ts.
      ```ts
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
      export function guardNavigation(contents: Pick<WebContents, 'on' | 'setWindowOpenHandler'>, appUrl: string): void {
        contents.on('will-navigate', (event, url) => {
          if (!isAppUrl(url, appUrl)) event.preventDefault()
        })
        contents.setWindowOpenHandler(() => ({ action: 'deny' }))
      }
      ```
    - Changes in /Users/romain/projects/p0/src/main/index.ts:
      - add `const appUrl = process.env['ELECTRON_RENDERER_URL'] ?? pathToFileURL(join(here, '../renderer/index.html')).href`;
      - in `createWindow`, call `guardNavigation(window.webContents, appUrl)` right after `new BrowserWindow`, before anything loads;
      - `loadURL` and `loadFile` stay as they are. They are calls from the main process, which `will-navigate` never sees.
    - **In dev**, the app URL is `http://localhost:5173`.
      - Allowed: `http://localhost:5173/`, with any query or hash.
      - Blocked: any other port, path or origin, and any `file://` URL.
      - A full Vite reload is a reload, not a new navigation, so the guard does not touch it.
    - **In the build**, only `file:///…/out/renderer/index.html` is allowed. Every other file, for example one dropped onto the window, and every `http(s)` URL is blocked.
    - **Both modes:** every window opening is denied (`window.open`, `target="_blank"` links, shift-click, forms with a target).
    - **Nothing else is needed:**
      - `<webview>` stays off: `webviewTag` is false by default and the app does not set it;
      - the CSP's `default-src 'self'` keeps foreign frames out;
      - the scope choice is Decision 15.
    - Tests: `src/main/navigation.test.ts`, and the two `chat guard` e2e tests (see Test strategy).
11. **`test:` then `feat:` the Claude Code adapter**, `src/main/agents/claude-code.ts`, with its unit tests. The interface in `src/main/agents/agent.ts` exists since story 1 and does not change. — covers AC5, AC6, AC7, AC10, AC11, AC12, AC13
12. **`test:` then `feat:` the run routes.** — covers AC5, AC11, AC12
    - `src/shared/chat.ts` gets `RunRequest { runId; projectPath; prompt; permissionMode; sessionId? }`.
    - In `api.ts`:
      - `ApiDeps.adapter` becomes required (`adapter: AgentAdapter`, without `?`), and the "story 2" comment goes;
      - `GET /agent` returns `{ permissionModes, defaultPermissionMode }` from the adapter;
      - `POST /runs` answers 400 when `projectPath` is not in `listProjects(projectsFile)` or the mode is not in `adapter.permissionModes`. Otherwise it streams the run's `AgentEvent`s as NDJSON;
      - the stream's `cancel()` calls `stop()`. S2 showed that `page.reload()` calls `cancel()` but never aborts `request.signal`;
      - `POST /runs/:runId/stop` answers 204, including for an unknown or already finished run;
      - `stopAll()` stops every running run.
      - No `OPTIONS` route and no CORS header, as for the project routes (S2).
    - In `index.ts`:
      - it builds `createClaudeCodeAdapter({ query })` inside the `whenReady` callback;
      - under `P0_E2E=1` with `P0_FAKE_SDK_QUERY` set, `query` comes from `await import(pathToFileURL(…).href)`; otherwise it is the SDK's;
      - it passes `adapter` to `handleApiRequest`;
      - `app.on('will-quit', stopAll)`.
13. **`chore:` `npx shadcn add message-scroller message bubble marker input-group`.**
    - Refuse the overwrites of `button.tsx` and `textarea.tsx`.
    - Then fix every generated file, including `avatar.tsx` and `input.tsx`, which come along as registry dependencies:
      - `import { cn } from "cn"` becomes `import { cn } from "@/lib/utils"`;
      - imports from `@/registry/…` become `@/components/ui/…`;
      - any `IconPlaceholder` becomes the matching `lucide-react` icon.
    - Run `npm uninstall cn` if the CLI added the package. Keep `@shadcn/react`.
    - Then add the stubs to `setup.ts`.
    - The static checks in the Test strategy confirm the fixes. — basis
14. **`test:` then `feat:` the reducer and the run functions.** — covers AC4, AC5, AC6, AC7, AC11, AC12, AC13
    - `lib/chats.ts` gets the `send` and `event` actions, the title rule, and the interrupted and error items. `ChatsAction` becomes a union; the `create` action and its tests do not change.
    - `lib/api.ts` gets `getAgent()`, `startRun(request, onEvent)` (NDJSON lines split across chunks) and `stopRun(runId)`.
15. **`test:` red component tests first, then `feat:` App and ActiveChat.** — covers AC4, AC5, AC7, AC11, AC12, AC13
    - `App`:
      - on mount, it loads `listProjects()` and `getAgent()` together, then selects the first project;
      - `DEFAULT_PERMISSION_MODE` is deleted, and "New chat" uses `AgentInfo.defaultPermissionMode`;
      - `send` and `stop` are wired to `startRun` and `stopRun`, keyed by project path and chat id.
    - `ActiveChat`:
      - the Message Scroller conversation and the `InputGroup`, with Send/Stop, Enter, Shift+Enter and Esc;
      - in the "Select or start a chat" state, the input and Send stay disabled, and Esc does nothing.
    - The CA6 tests are removed.
    - The "no message" checks of the existing tests move from `listitem` to the conversation's items (see Test strategy).
16. **`test:` e2e chat AC5, AC6, AC7, AC10, AC11, AC12, AC13.** — covers the same ACs
    - Launch env additions: `PATH = <repo>/e2e/fake-sdk/bin:/usr/bin:/bin:/usr/sbin:/sbin`, `P0_FAKE_SDK_QUERY`, `P0_FAKE_CLAUDE_STATE`.
    - `beforeAll` guard: in the main process, `PATH` and `P0_FAKE_SDK_QUERY` have these values.
    - `resetApp()` also restores the main process's `PATH`.
    - It reuses `addProject`, `stubFolderPicker` and `makeFolder` from story 1, and adds `newChat` and `send`.
17. **Verification, then the manual checklist, by Romain with a visible window.** — covers AC5, AC6, AC7, AC10, AC11, AC12, and the guard
    - With the real Claude Code, on a real project:
      - a streamed answer with action lines;
      - a follow-up message that remembers the previous one;
      - Plan mode leaves `git status` clean;
      - Stop, with the button and with Esc;
      - two chats answering at once.
    - Guard, in `npm run dev` and in `npm run build && npm start`: drag a file from Finder onto the window. The app stays in place and no window opens.

**Story 3 — Permission modes** (AC8, AC9), renumbered: tasks 17, 18 and 19 of the original list become 18, 19 and 20. Task 18 (`npx shadcn add select`) gets the same generated-file fixes and static checks as task 13.

### Test strategy — additions for story 2
- **Navigation guard** (task 10). Test titles start with `chat guard — `.
  - **Unit**, `src/main/navigation.test.ts`, node environment.
    - `isAppUrl`, dev app URL `http://localhost:5173`:
      - allowed: `http://localhost:5173/` and `http://localhost:5173/?a=1#b`;
      - blocked: `http://localhost:5174/`, `http://localhost:5173/other`, `https://example.com/`, a `file://` URL, `not a url`.
    - `isAppUrl`, build app URL `file:///x/out/renderer/index.html`:
      - allowed: the same URL with a hash;
      - blocked: `file:///x/out/renderer/other.html`, `file:///etc/hosts`, `http://localhost:5173/`.
    - `guardNavigation`, with a fake `webContents` that records listeners and the open handler:
      - `will-navigate` to a foreign URL calls `preventDefault`;
      - `will-navigate` to the app URL does not;
      - the open handler returns `{ action: 'deny' }` for the app URL and for a foreign URL.
    - Command: `npx vitest run -t "chat guard "`.
  - **E2E**, on the build (`file://`), with the window still hidden. Command: `npm run test:e2e -- -g "chat guard "`.
    - "chat guard — a foreign page cannot replace the app":
      1. the test writes `<tempDir>/foreign.html`;
      2. through `app.evaluate`, it adds `webContents.once('will-navigate', (event, url) => …)` in the main process. This probe runs after the app's guard and records `{ url, prevented: event.defaultPrevented }`;
      3. it runs `location.href = <foreign file URL>` in the page;
      4. it polls the record, which gives a positive signal rather than a timeout.
      - Expected: `prevented: true`, `page.url()` is still the app URL, and the 4 regions are visible.
      - `finally`: if the page has left, `loadURL(appUrl)` brings it back. This only matters for a red run.
    - "chat guard — the page cannot open a window":
      - in the page, `window.open('about:blank', '_blank', 'show=no')`;
      - expected: `BrowserWindow.getAllWindows()` still has exactly 1 window;
      - `show` is one of the features Electron turns into window options, so even without the guard the extra window stays hidden. The red run confirms this (Decision 16);
      - `finally`: destroy any window other than the app's (compared by id).
  - **Manual**: dropping a file onto the window, task 17. Playwright cannot drag files from the OS.
- **API**, `src/main/api.test.ts`, story 2 part:
  - every call passes `adapter`, which `npm run typecheck` now requires;
  - `GET /agent` returns the adapter's `permissionModes` and `defaultPermissionMode`;
  - `POST /runs`:
    - 400 for a project that is not in the store, and 400 for an unknown mode; `start` is not called in either case;
    - otherwise 200 `application/x-ndjson`: the fake adapter's events, one per line, ending with `end`;
    - `start` gets `cwd` = the project path, and the prompt, mode and session;
  - cancelling the response body calls the run's `stop()`;
  - `POST /runs/:runId/stop` calls `stop()` and answers 204; an unknown id answers 204 and does nothing;
  - `stopAll()` stops every running run;
  - the "transport facts (spike S2)" tests now also cover `GET /agent` and `POST /runs`: no CORS header.
- **Default mode from the agent** (follow-up 2):
  - component test: `getAgent` resolves with `defaultPermissionMode: 'dontAsk'`; after "New chat" and a sent message, `startRun` gets `permissionMode: 'dontAsk'`;
  - e2e chat AC5: the fake's reply shows `Mode: plan`, the default the real adapter announces through `GET /agent`;
  - static: `grep -rn DEFAULT_PERMISSION_MODE src` prints nothing.
- **Generated shadcn files** (follow-up 4). Run after task 13, and again after the `select` task of story 3:
  - `grep -rn 'from "cn"' src` prints nothing;
  - `grep -rnE '@/registry/|IconPlaceholder' src` prints nothing;
  - `grep -n '"cn"' package.json` prints nothing;
  - `grep -n '@shadcn/react' package.json` prints one line;
  - `git diff dev -- src/renderer/src/components/ui/button.tsx src/renderer/src/components/ui/textarea.tsx` is empty.
- **DOM contract of the conversation**, for the component and e2e tests of story 2:
  - the conversation is the element with role `log` inside the "Active chat" region (`MessageScrollerContent`);
  - each user message, reply, action line, "Interrupted" mark and error is one item of that log; an error carries `role="alert"`;
  - the "Message" textbox and the "Send"/"Stop" button stay where story 1 put them, so the existing helpers still find them.
- **Tests that change because of the story 1 code:**
  - `App.test.tsx`:
    - the header contract becomes: "on mount, `listProjects()` and `getAgent()`; the projects show once both have answered; `startRun` and `stopRun` are used from story 2 on";
    - the two "no message" assertions, in "chat AC4 — the new chat has an empty conversation" and the CA6 test, count the items of the `log` instead of `listitem`. With Message Scroller, `listitem` never matches, so the old check would pass without checking anything;
    - the 3 CA6 tests are removed, and chat AC5 replaces them;
    - the "Select or start a chat" tests gain one check: Send is disabled and `startRun` is never called.
  - `src/main/api.test.ts`: the new route tests above. The existing project and transport tests stay as they are.
  - `src/renderer/src/lib/api.test.ts`: new tests for `getAgent`, `startRun` (NDJSON lines split across chunks) and `stopRun`. The project tests stay.
  - `src/renderer/src/lib/chats.test.ts`: new describe blocks for `send` and `event`. The `create` tests stay.
  - `e2e/app.spec.ts`:
    - the launch env, `beforeAll` and `resetApp` gain the additions of task 16;
    - the story 1 chat AC1 to AC3 tests do not change;
    - `git diff dev -- e2e/app.spec.ts | grep -E '^-[^-].*expect'` prints nothing.
  - The AC10 manual check now points to "S1 (g) and task 17".

### Test strategy
- **Commands.** Run them from /Users/romain/projects/p0. They all pass the reviewer's Bash guard.
  - Full run: `npm run typecheck && npm test && npm run test:e2e`.
  - One AC, unit and component: `npx vitest run -t "chat AC5 "`. The trailing space keeps AC10 to AC13 out.
  - Main process only: `npx vitest run src/main`.
  - One AC, e2e: `npm run test:e2e -- -g "chat AC5 "`.
  - Test titles start with `chat AC<n> — ` (Decision 11).
- **No test ever calls the real Claude Code.**
  - Unit tests give the adapter a fake `query`.
  - The e2e loads `e2e/fake-sdk/query.mjs` into the real adapter.
  - The e2e `PATH` holds only the dummy `claude`, which refuses to run. Even a wiring mistake that reached the real SDK could not reach the service.
  - The `beforeAll` guard checks the `PATH` and the hook before the first test.
  - The real SDK runs only in spike S1 and in the manual checklists.
- **The fake SDK `query`** (`e2e/fake-sdk/query.mjs`):
  - `query({ prompt, options })` returns an async iterator with `interrupt()` and `close()`, the only `Query` members the adapter uses. It reads the first user message from `prompt`.
  - It throws if `pathToClaudeCodeExecutable`, `permissionMode`, `includePartialMessages: true` or `permissionPrompts: 'none'` is missing. A wrong call from the adapter therefore fails the tests.
  - Sessions live in `$P0_FAKE_CLAUDE_STATE/<id>.json`. An unknown `resume` throws the error recorded in S1 (e). Without `resume`, it creates a new UUID.
  - It yields messages in the shapes recorded in S1: init, text deltas in chunks, `assistant` blocks with `tool_use`, `result`.
  - Its reply reads: `You said: <prompt>`, `Mode: <permissionMode>`, `Folder: <cwd>`, `Earlier in this chat: <earlier prompts | nothing>`.
  - Scenario markers in the prompt:
    - `[tools]`: text, Read `<cwd>/README.md`, text, Edit `<cwd>/src/index.ts`, Bash `npm test`, text;
    - `[slow]`: one chunk every 100 ms for 30 s. On `interrupt()` it yields the sequence recorded in S1 (c), then ends;
    - `[auth]`: the S1 (d) sequence, then the recorded error is thrown;
    - `[crash]`: throws `Claude Code process exited with code 1. stderr: fake crash`.
  - It uses no network and starts no process. It writes nothing outside its state dir and has no window, so the e2e stays hidden and silent.
- **Native folder picker (AC1).** Playwright cannot drive it.
  - The e2e replaces it in the main process: `app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: folder === null, filePaths: folder ? [folder] : [] }) }, folder)`. No production code changes, and no native UI ever opens.
  - `expectInBackground()` fails the run if a real picker ever appears.
  - The real sheet and its Cancel button are checked by hand.
- **Per AC:**
  - chat AC1 → component + unit + e2e + manual.
    - Component: a picked folder appears in the rail with its initial and is selected; cancel leaves the rail unchanged; picking an existing project selects it and adds no button.
    - Unit: the name comes from `basename`; no duplicate on disk.
    - E2E: with the picker stubbed to `<tmp>/atlas`, the "A" button is current and `projects.json` lists the path.
    - Manual: the real sheet.
  - chat AC2 → unit + component + e2e + manual.
    - Unit: add A then B, read the same file again: [A, B].
    - Component: the API returns 2 projects; they keep their order and the first is current.
    - E2E: add 2 projects, `page.reload()`: same order, first selected. This keeps the one-launch rule (Decision 10).
    - Manual: quit and relaunch.
  - chat AC3 → component + e2e + static check.
    - Component and e2e: the rail has a single button, "Add project"; the history and the active chat show "Add a project to get started".
    - Static: `ls src/renderer/src/data` fails.
  - chat AC4 → component + unit.
    - "New chat" puts the chat first in the list and selects it. It is empty (Spec ambiguity 4) and in the adapter's default mode, Plan (in story 3, the selector shows "Plan").
    - Its title is "New chat", then the first line of the first message.
  - chat AC5 → component + unit + e2e.
    - Component: Enter sends and clears the input; Shift+Enter inserts a line break; an empty or whitespace-only message cannot be sent; mocked events make the reply grow.
    - Unit: `text_delta` gives `text`. The adapter calls `query` with `cwd` = the project, the `pathToClaudeCodeExecutable` it found, `includePartialMessages: true`, `permissionPrompts: 'none'` and the `claude_code` preset.
    - E2E: with `[slow]`, part of the text shows while Stop is visible. A normal message shows `Folder: <project path>`, since the fake echoes `options.cwd`.
  - chat AC6 → unit + e2e.
    - Unit: `resume` is passed only when the chat has a session; `session` is emitted only after model output, so fixture (d) gives none.
    - E2E: chat A sends "first" then "second", and the reply shows `Earlier in this chat: first`. Chat B sends "other" and gets `nothing`.
  - chat AC7 → unit + component + e2e.
    - Unit: fixture (b) gives Read, Edit and Bash actions with their targets.
    - Component: Marker lines appear in order with the text.
    - E2E: `[tools]` shows the 3 lines in the right order, between the text segments.
  - chat AC8 → unit + component + e2e.
    - Unit: `permissionModes` equals the list from Spec ambiguity 2, and the typecheck compares it with the SDK's `PermissionMode`.
    - Component and e2e: the selector is in the input area, lists the modes from `GET /agent`, and shows Plan by default.
  - chat AC9 → unit + component + e2e.
    - Unit: each run passes its own `permissionMode`; `allowDangerouslySkipPermissions` is set only with Bypass.
    - E2E: chat A is set to Accept edits and sends: `Mode: acceptEdits`. Chat B sends: `Mode: plan`.
  - chat AC10 → unit + e2e + manual.
    - Unit: the options of a Plan run: `permissionMode: 'plan'`, `permissionPrompts: 'none'`, plus `settings` or `disallowedTools` depending on Spec ambiguity 1.
    - E2E: `Mode: plan`.
    - Manual, with the real Claude Code: S1 (g) and task 16.
  - chat AC11 → unit + component + e2e.
    - Unit:
      - `stop()` calls `interrupt()`; then the `result` gives `end {interrupted: true}` and the text received so far is kept;
      - with no `result` within 5 s (fake timers), `close()` is called;
      - when `interrupt()` rejects, `close()` is called.
    - Component: Send becomes Stop; a click or Esc calls `stopRun`; "Interrupted" appears; Send comes back.
    - E2E: same, with the button and with Esc.
  - chat AC12 → unit + component + e2e.
    - Unit: two runs in parallel each emit only their own events.
    - Component: events for chat A are applied while chat B is shown; chat B can send while A answers.
    - E2E: `[slow]` in chat A; switch to chat B and get a full answer there; go back to A and see more text than before.
  - chat AC13 → unit + component + e2e.
    - Unit:
      - no `claude` on `PATH`: the "not found" error, and `query` is never called;
      - a thrown `Claude Code process exited with code 1. stderr: boom`: an error with that text;
      - fixture (d): Claude Code's own message;
      - fixture (e): an error.
    - Component: an error bubble with `role="alert"`; the input works again.
    - E2E, CLI missing: set `process.env.PATH = '/usr/bin:/bin'` in main through `evaluate`, then send: "Claude Code CLI not found…". Restore `PATH` and send again: it works.
    - E2E, `[auth]`: Claude Code's own message is shown, and another chat still answers.
- **app-shell tests that change.**
  - CA2: its 3 tests and `projects.test.ts` are removed; chat AC1 and chat AC3 replace them.
  - CA3: the setup changes (projects from the mocked API, chats from "New chat"); the assertions stay.
  - CA5: removed; chat AC3, AC4 and AC5 replace it.
  - CA6: removed in story 2; chat AC5 replaces it. It stays as it is in story 1.
  - CA4 and CA7 also read the mock data: their setup changes and their assertions stay.
  - CA1, CA8, CA9, CA10 and the hidden-titlebar tests are unchanged.
  - Check that no existing e2e assertion was removed: `git diff dev -- e2e/app.spec.ts | grep -E '^-[^-].*expect'` prints nothing.

### Decisions to validate
1. **Story size** — options: A. three stories (Projects / Chat in Plan mode / Permission modes) / B. one PR — recommendation: A.
   - About 20 source and test files, 2 spikes, a new transport and the SDK would make one review very large.
   - Each story delivers ACs that can be tested on their own.
   - Story 1 keeps CA6 green, since the Send button is still disabled there.
2. **Chat UI components** — options: A. shadcn core chat components ([June 2026 changelog](https://ui.shadcn.com/docs/changelog/2026-06-chat-components)) / B. Vercel AI Elements ([elements.ai-sdk.dev](https://elements.ai-sdk.dev/)) / C. a mix — recommendation: A.
   - Mapping with A:
     - **Conversation** (AC5, AC6, AC7, AC11, AC12) → Message Scroller.
       - Parts: `MessageScrollerProvider autoScroll`, `MessageScrollerViewport` (role region "Messages"), `MessageScrollerContent` (role log, `aria-busy` while answering), one `MessageScrollerItem` per item (`scrollAnchor` on user messages), and `MessageScrollerButton`.
       - It brings a new npm dependency, `@shadcn/react` (headless; uses ResizeObserver and IntersectionObserver).
     - **Messages** (AC5) → Message (`align` end for the user, start for Claude) + Bubble (`default` for the user, `ghost` for Claude), as plain text with `whitespace-pre-wrap`. The Avatar component comes along as a registry dependency.
     - **Streaming text** (AC5) → no dedicated component: text is appended to the Bubble and the scroller follows the live edge.
     - **Action lines** (AC7) → Marker (`MarkerIcon` + `MarkerContent`). **Interrupted** (AC11) → Marker `separator`.
     - **Error** (AC13) → Bubble `destructive`.
     - **Input with Send/Stop** (AC5, AC11) → Input Group. shadcn core has no prompt-input component, and `InputGroupTextarea` wraps the existing Textarea. Enter and the Send/Stop swap are our own handlers, about 15 lines, not a custom component.
     - **Mode selector** (AC8, AC9) → Select, in the same addon.
     - **Empty states** (AC3, AC4) → Empty.
     - Not used: Attachment (out of scope), Questionnaire (in-app questions, a later story), Spinner (no AC asks for it).
   - Installation:
     - `npx shadcn add …` with the project's CLI (4.21.1) and `style: radix-mira`. I checked that radix-mira registry entries exist for message-scroller, marker and input-group.
     - The Tailwind v4 utilities `scroll-fade` and `shimmer` ship in the `shadcn/tailwind.css` that the app already imports.
   - Option B:
     - Components: Conversation, Message with MessageResponse, PromptInput (`PromptInputSubmit status` shows Stop; Enter and Shift+Enter built in; PromptInputSelect), Tool.
     - It needs the `ai` package (AI SDK types), `streamdown` and `use-stick-to-bottom`.
     - It brings out-of-scope features for free: Markdown rendering (GFM, KaTeX, code highlighting) and a Tool panel with the full input and output.
     - It can show our own data, but only in AI SDK shapes.
   - With A, there is no Markdown question to decide.
   - The only new UI dependency is `@shadcn/react`. The alternative without it is a hand-made scroll container, which would replace a shadcn component and therefore needs Romain's approval.
3. **Which Claude Code binary runs** — options: A. the installed CLI: `claude` found on `PATH` at each run and passed as `pathToClaudeCodeExecutable` / B. the binary the SDK bundles (optional dependency `@anthropic-ai/claude-agent-sdk-darwin-arm64`, [TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript)) — recommendation: A.
   - A fits the spec. AC8 ("follows the installed Claude Code") and AC13 ("CLI not installed") only make sense with the installed CLI, and it is the same binary and version as in the terminal.
   - Both options reuse the login. The SDK runs a Claude Code binary as the user, and that binary reads the login where the CLI stores it: a macOS Keychain entry keyed to the config dir, and `~/.claude` ([authentication](https://code.claude.com/docs/en/authentication)). The app never handles credentials. An `ANTHROPIC_API_KEY` in the environment takes precedence (see Risks).
   - B needs no `PATH` lookup and pins the version with the SDK. But "not installed" could then only mean a missing optional package, and the app could run a different Claude Code version than the terminal.
   - With A, npm still installs the bundled binary as an optional dependency, and it stays unused. `npm install --omit=optional` would also drop other optional packages of the toolchain.
4. **Multi-turn and Stop** — options: A. one `query()` per message, in streaming input mode holding that single message until its `result`, with `resume: <session_id>` / B. one long-lived streaming-input `query()` per chat: messages are pushed into it, and `setPermissionMode()` is called before each one / C. one single-message `query()` (string prompt) per message, with `resume` — recommendation: A.
   - Stop:
     - `interrupt()` "is only available in streaming input mode", and single-message mode "does not support real-time interruption" ([streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)).
     - `interrupt()` ends the turn and the session can still be resumed. Killing the process instead (`close()` or abort) "leaves the turn that was in progress unfinished" ([headless](https://code.claude.com/docs/en/headless)).
     - So A and B use `interrupt()`; C could only abort.
   - Mode per run (AC9): A and C pass `permissionMode` when each message's query starts. B needs `setPermissionMode()`, which also works only in streaming input mode.
   - A keeps the main process stateless between messages. No Claude Code process sits idle for each chat, a crash affects one message only, and on a page reload or a quit only running turns need stopping. Cost: Claude Code starts once per message (S1 (i) measures it).
   - B saves that start-up time. But it keeps one process alive per open chat and needs lifecycle code: when to close it, and recovery, which needs `resume` anyway.
5. **Adapter interface** — options: A. the minimal interface in Files (`permissionModes`, `defaultPermissionMode`, `start(run, emit) → { stop }`), with the adapter passed to the API handler by `index.ts` / B. A plus a provider registry and a provider id on projects or runs — recommendation: A.
   - With A, adding Codex means a new adapter file plus one line in `index.ts`. The API layer, the renderer and `AgentEvent` stay as they are.
   - B serves a provider choice that no AC asks for (other CLIs are out of scope).
   - The common events cover what the ACs show: text, one line per action, the session that links messages, errors, and end or interrupted. An adapter drops anything else its provider emits.
6. **UI ↔ main communication** — options: A. preload + contextBridge IPC behind `lib/api.ts` / B. local HTTP server with SSE on 127.0.0.1 / C. custom `p0://` scheme with `protocol.handle`, `fetch` and streamed NDJSON ([protocol API](https://www.electronjs.org/docs/latest/api/protocol)) — recommendation: C if spike S2 passes, otherwise A.
   - **Security.**
     - A: the standard Electron pattern; no port; contextIsolation and sandbox kept.
     - B: the weakest. Every local process, and every website open in the browser, can reach a server that starts Claude Code in Bypass mode. It needs a token, plus Host and Origin checks against DNS rebinding.
     - C: no port. Only pages loaded in the app's own session can reach the scheme, and the main process checks the project path and the mode.
   - **Web portability.**
     - A: the renderer is portable through `lib/api.ts`, but the web version needs a second client and an HTTP layer.
     - B: the best, since it is already a server.
     - C: the renderer only uses `fetch`. The web version changes `API_BASE` and mounts the same `Request → Response` handler on an HTTP server.
   - **Testability.**
     - A: `ipcMain` handlers need an Electron mock.
     - B: real HTTP in Vitest.
     - C: the handler is tested with plain `Request` objects, without Electron.
   - **`AGENTS.md`.**
     - A changes the rule. Proposed wording: "the renderer never imports Electron; a preload exposes only a minimal bridge, used only by `lib/api.ts`". A also needs an electron-vite `preload` entry built as CommonJS, because the renderer is sandboxed.
     - B and C keep the rule.
   - Choosing A needs Romain's approval.
7. **Project storage (AC2)** — options: A. `<userData>/projects.json` (absolute paths, in order), owned by the main process / B. `localStorage` in the renderer — recommendation: A.
   - The main process needs the list anyway, to check where a run may execute.
   - The renderer never sends a folder path of its own: paths come from the picker, through the main process.
   - No dependency (no electron-store).
8. **Isolating userData in the e2e** — options: A. `P0_USER_DATA_DIR`, read only when `P0_E2E=1`, then `app.setPath('userData')` / B. Chromium's `--user-data-dir` switch in the launch arguments, which Electron does not document — recommendation: A.
   - Without isolation, the e2e would read and delete Romain's real projects.
   - A follows the existing `P0_E2E` pattern and has no effect on normal runs.
9. **Test seam for Claude Code** — options: A. a fake SDK `query` given to the real Claude Code adapter: unit tests pass it directly, and the e2e loads `e2e/fake-sdk/query.mjs` through `P0_FAKE_SDK_QUERY`, read only when `P0_E2E=1` / B. a fake `AgentAdapter` that emits common events / C. a fake executable passed as `pathToClaudeCodeExecutable` that speaks the SDK's stdin/stdout control protocol — recommendation: A.
   - A runs the real translation, option building, error mapping and stop logic, in Vitest and end to end, on recorded real SDK messages.
   - B skips the translation code in the e2e.
   - C would also exercise the SDK, but the control protocol between the SDK and the CLI is internal, undocumented, and changes with each release.
   - The hook adds a test-only branch to `index.ts`, gated like the existing `P0_E2E` code. No test code goes into the build: the module is loaded from its path at run time.
10. **AC2 under the one-launch rule** — options: A. store unit test + e2e page reload + manual relaunch / B. a second app launch in the e2e — recommendation: A. B breaks the "one launch" constraint of `e2e-quiet-runs`.
11. **Test ids** — options: A. the prefix `chat AC<n> — `, with a header comment pointing to this spec / B. a separate e2e file — recommendation: A.
    - `AC1` to `AC6` already mean hidden-titlebar criteria in the same files, and `-g "AC1"` would also match AC10 to AC13.
    - B would launch the app a second time.
12. **Spike S1 uses the real Claude Code service** (a few calls, so some cost) — options: A. run once by hand (Romain or the dev), with the sanitized recordings committed as fixtures / B. fixtures written from the docs only — recommendation: A. The fake replays SDK messages that the real adapter translates. The docs do not say what follows an `interrupt()`, what a run that is not logged in yields, or every field of some messages.
13. **SDK version** — options: A. an exact pin to the SDK release whose patch number matches the installed CLI, upgraded on purpose with a new S1 recording / B. a caret range — recommendation: A.
    - The docs say SDK 0.3.N bundles Claude Code 2.1.N, so 0.3.287 matches the installed 2.1.287.
    - The fake and the fixtures replay one SDK version. A silent upgrade could change message shapes under the tests.
14. **System prompt** — options: A. `systemPrompt: { type: 'preset', preset: 'claude_code' }` / B. the SDK default, a minimal prompt — recommendation: A. The story is to chat with Claude Code; B drops Claude Code's tool guidance and conventions.
15. **Navigation guard scope** — options: A. the guard on the main window only, as in task 10: `will-navigate` blocks every URL but the app's own page, and `setWindowOpenHandler` denies every window / B. A plus a per-launch token that every API request must carry / C. A, registered for every webContents through `app.on('web-contents-created')`, as in Electron's [security guide](https://www.electronjs.org/docs/latest/tutorial/security) — recommendation: A.
    - Why A is enough: the scheme handler sees no `Origin`, so what matters is that no other page ever runs in the app's session:
      - the main frame cannot navigate away;
      - no window can be opened;
      - no `<webview>` exists;
      - the CSP keeps foreign frames out.
      - Adding a frame would already need script running inside the app's page, and such a script could call the API directly anyway.
    - B adds a secret to `lib/api.ts`, to every route and to their tests, to defend against a page that A already keeps out. The token would also sit in the app page's own memory.
    - C covers webContents that cannot exist under A, and it also applies the rules to DevTools.
16. **E2E check of window opening** — options: A. an e2e test calls `window.open('about:blank', '_blank', 'show=no')` and checks that the window count stays at 1, plus the unit test / B. the unit test with a fake webContents only — recommendation: A.
    - A proves the handler is wired in the real app, which a unit test cannot.
    - `show` is one of the `window.open` features Electron turns into window options ([window.open](https://www.electronjs.org/docs/latest/api/window-open)), so a broken guard opens only a hidden window, and the e2e stays hidden.
    - The dev confirms this in the red run, before the guard exists. If the extra window turns out visible, switch to B and tell Romain.

### Spec ambiguities
1. **AC10, "no command is run" (re-checked against the SDK).** In the SDK's plan mode ([SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions)):
   - read-only tools run as in the default mode;
   - file edits, and on Claude Code 2.1.212 or later shell commands that modify files (`touch`, `rm`), go to the prompt step, where `permissionPrompts: 'none'` denies them;
   - read-only commands still run;
   - when auto mode is available, the classifier can approve other commands during planning, through `useAutoModeDuringPlan`, which is on by default ([permission modes](https://code.claude.com/docs/en/permission-modes)).
   - So the AC as written still does not hold.
   - Options:
     - A. strict, as written: Plan adds `disallowedTools: ['Bash']`. On macOS this also removes Claude's search, since the default tool set leaves out Glob and Grep;
     - B. reword: no file is created, modified or deleted, and only Claude Code's read-only commands may run. Enforced with `settings: { useAutoModeDuringPlan: false }` and `permissionPrompts: 'none'`;
     - C. reword and rely on plan mode as it is.
   - Recommendation: B.
2. **AC8, which modes (re-checked against the SDK).** The SDK's `PermissionMode` type has the same six values as the installed CLI (2.1.287): `default` (Manual), `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`.
   - With `permissionPrompts: 'none'`, nothing ever asks the user in this story. `default` is the coming "Ask" mode.
   - The SDK has no call that lists the modes at run time: `initializationResult()` returns commands, models, account and output styles, not modes.
   - Options: A. Plan, Accept edits, Auto, Don't ask, Bypass permissions / B. only the three named in the AC.
   - Recommendation: A, with Claude Code's own labels.
   - "Follows the installed version": a fixed list in the adapter, checked at compile time against the SDK's `PermissionMode` and against `claude --help` in S1.
   - Bypass needs `allowDangerouslySkipPermissions`, and Auto can silently fall back to Manual (see Risks).
3. **Project selected, no chat selected** (a new project, or right after switching project). What does the active chat show?
   - Options: A. the Empty state "Select or start a chat", with the input and the selector disabled / B. automatically select or create a chat.
   - Recommendation: A.
   - Labels to confirm: "Add project" (accessible name of "+", placed after the projects) and "New chat".
4. **AC4, "empty conversation".** Recommendation: show the Empty state "No messages yet" until the first message.
5. **AC11, where Esc works.**
   - Options: A. while focus is anywhere in the active chat; when the mode menu is open, Esc only closes the menu / B. anywhere in the window.
   - Recommendation: A. After Send, focus goes back to the input.
6. **AC4 and AC5, text rules.** Recommendation: a message with only whitespace counts as empty; the title is the first non-empty line, trimmed.
7. **AC7, what an action line shows.** Recommendation:
   - the kind is Claude Code's tool name (Read, Edit, Write, Bash, Grep…);
   - the target is the file path, relative to the project when it is inside it; or the first line of the command; or the pattern, URL or query; otherwise the line shows the tool name alone;
   - tool calls made by subagents are shown too.
8. **AC12, "come back".** Switching project still clears the chat selection (app-shell CA3), so the user clicks chat A again. Recommendation: keep it that way.
9. **AC13, error wording.** Recommendation: show Claude Code's own message whenever there is one. The app writes its own text only for "Claude Code CLI not found. Install it, then send again.", and otherwise shows the SDK's message, which includes the end of stderr.
10. **AC7, denied actions (new).** With `permissionPrompts: 'none'`, a tool call that Claude Code denies (for example an Edit in Plan mode) still arrives as a `tool_use` block. It would show as an action line although nothing happened. The SDK reports each denial with a permission-denied message.
    - Options:
      - A. show every tool call Claude starts, denied ones included;
      - B. show the line, then mark it "denied" when the denial arrives. This adds an id to `action` and a new event;
      - C. hide denied calls. Lines would then appear only after each tool's result.
    - Recommendation: A in this story, as the smallest; B along with the Ask mode story.

### Risks
- **Licensing, as a fact.** The Agent SDK docs state: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK" ([overview](https://code.claude.com/docs/en/agent-sdk/overview)). Romain considers the question the same for the SDK and for the CLI (Decisions, 2026-10-02).
- **Plan mode cannot fully guarantee AC10.** The default setting sources load the project's hooks and MCP servers, and hooks can run commands in any mode. The app does not control this, and the manual check covers one folder only.
- **Auto mode can silently fall back.** When auto mode is unavailable (account, model or organization), Claude Code starts in Manual. Anything that needs approval is then denied, while the selector still shows "Auto". S1 (h) shows what the init message reports in that case.
- **SDK and CLI versions drift apart.** The native CLI updates itself, while the SDK stays pinned, so the SDK may end up driving a newer CLI. The `PATH` lookup always picks the current install. Re-run S1 after notable CLI upgrades.
- **API key precedence.** An `ANTHROPIC_API_KEY` in the environment is used instead of the login in SDK sessions, so usage would go to API billing. The app passes its environment through; in dev, that is the terminal's.
- **Keychain prompt.** It is not yet verified that the process started by the SDK reads the login without a macOS Keychain prompt (S1, Electron check).
- **Unused bundled binary.** npm installs the SDK's platform package and its binary even though option A never runs it, which increases the download size.
- **Message shapes.** On an SDK upgrade, the SDK's types make shape changes show up at typecheck. The fixtures pin one version, and unknown messages are ignored, so a behavior change may only show up as missing text or missing lines.
- **`interrupt()` is unverified** (S1 (c)). The `close()` fallback leaves the turn unrecorded.
- **No automated test runs the real SDK.** Spawning the CLI and the options the SDK accepts are checked only by S1 and the manual checklists.
- **Streaming and CORS on a custom scheme are unverified** (S2). Known Electron bugs concerned request bodies, not responses ([#41872](https://github.com/electron/electron/issues/41872)). Fallback: option A, which needs the rule change.
- **`PATH`.** The adapter finds `claude` through `PATH`, which works with `npm run dev` and `npm start` from a terminal. An app opened from Finder would not see `~/.local/bin`; packaging is out of scope.
- **Cost and latency.** Claude Code starts once per message, and concurrent chats mean concurrent processes and concurrent usage.
- **Bypass permissions** runs with no checks in the real project folder. Claude Code's docs recommend it only in containers or VMs.
- **shadcn CLI.** It may offer to overwrite `button.tsx` and `textarea.tsx`, or touch `index.css`: review the diff. `@shadcn/react` needs observer stubs in jsdom, so scrolling is not tested there. The new "Messages" region sits inside "Active chat" and does not clash with the 4 region names.
- **Shared e2e app.** Every new piece of state must be reset (here `projects.json` and the main process's `PATH`). A run left over from one test is stopped by the reload, through stream cancel. Slow scenarios must stay well under the 30 s test timeout.
- **Dev reloads.** In dev, a full Vite reload cancels the streams, which stops every running answer.
- **The guard stops navigations, not scripts already running in the app page.** A script injected into the renderer could call `p0://api/runs` directly. Replies are plain text rendered by React (no Markdown, no HTML), so nothing in this story can inject a script. The first story that renders Markdown or links must revisit this, and must keep `setWindowOpenHandler` denying, or opening only validated URLs outside the app.
- **`show=no` is assumed** for the window-opening e2e (Decision 16). If Electron ignores it, the red run of that test shows a window once.
- **Drag-and-drop is checked by hand only** (task 17), because Playwright cannot drag files from the OS onto a window.
- **The `cn` package can hide a wrong import.** If the CLI's `cn` package stays installed, an `import { cn } from "cn"` can still compile while it no longer uses the app's `cn` (`@/lib/utils`). Only the static checks of task 13 catch it.
- **`GET /agent` failing would hide the projects.** `App` waits for both answers before it shows the projects. The route only returns constants from the adapter, so this is unlikely. It is the same kind of gap as the corrupt `projects.json` case already noted as out of scope.

## Decisions
- 2026-10-02 — Next story: connect Claude Code (approved by Romain)
- 2026-10-02 — Projects: "+" button with the macOS folder picker, kept between launches (approved by Romain)
- 2026-10-02 — Multi-turn conversation within a chat (approved by Romain)
- 2026-10-02 — Permission mode selector per chat, with Claude Code's own modes; the "Ask" mode comes in a later story; default Plan (approved by Romain)
- 2026-10-02 — The chat shows the streamed text plus one line per action (approved by Romain)
- 2026-10-02 — Chats are not kept between launches in this story (approved by Romain)
- 2026-10-02 — Stop with a button or the Esc key (approved by Romain)
- 2026-10-02 — Answers keep running in the background when switching chats; several chats can run at once (approved by Romain)
- 2026-10-02 — The chat UI is built on shadcn's AI chat components; the architect explores their documentation (approved by Romain)
- 2026-10-02 — Plan Decision 3 overridden: Claude Code is driven through the official Claude Agent SDK, not a `claude -p` subprocess. Romain considers that both approaches raise the same licensing question regarding the claude.ai login (approved by Romain)
- 2026-10-02 — Adapter architecture: each agent provider has an adapter that translates its events into the app's common event type; the app only consumes those (approved by Romain)
- 2026-10-02 — Revised technical plan approved, all recommendations kept (approved by Romain):
  - Decision 1 = A: three stories, three PRs, all against this spec:
    - story 1, Projects (AC1, AC2, AC3, the "New chat" part of AC4), on `feat/claude-code-chat-projects`;
    - story 2, Chat in Plan mode (rest of AC4, AC5 to AC7, AC10 to AC13);
    - story 3, Permission modes (AC8, AC9).
  - Decisions 2 to 11, 13 and 14 = A. Decision 6 = C if spike S2 passes; otherwise back to Romain.
  - Decision 12 = A, split: the dev records the SDK fixtures with scripts (no window). Romain runs the Electron check of S1 himself, because a window opens and a macOS Keychain prompt may appear.
  - Spec ambiguity 1 = B: AC10 reworded.
  - Spec ambiguity 2 = A: AC8 lists the five modes.
  - Spec ambiguities 3 to 10: as recommended.
- 2026-10-02 — Spike S2 results (Electron 44.5.1, window hidden): Q1 to Q4 all yes, so Decision 6 = C, the `p0://` scheme.
  - Lines arrive one by one, about every 200 ms, both in dev (`http://localhost:5173`) and in the build (`file://`).
  - Facts that tasks 4, 5 and 11 must follow:
    - Privileges: `supportFetchAPI` and `corsEnabled` are both required; without them the fetch fails with `Failed to fetch`. `stream` is not needed.
    - No `OPTIONS` preflight reaches the handler, and no CORS response header is needed. The `OPTIONS` route and `Access-Control-Allow-Origin` of the plan are dropped.
    - CSP: `connect-src 'self' p0:` is required.
    - The handler sees no `Origin` header. Security relies on the project path and mode checks, as planned.
    - `page.reload()` calls the stream's `cancel()`, about 10 ms later, but does not abort `request.signal`. Stop-on-reload must hang on `cancel()`.
    - URL parsing: `p0://api/runs` gives `host === 'api'` and `pathname === '/runs'`.
- 2026-10-02 — Story 1 (Projects) delivered: review OK (0 review loop), and Romain's manual checks all passed (real picker, cancel, duplicate, quit and relaunch, "New chat"). AC1 to AC3 are done. AC4 is partly done: the title after the first message comes with story 2, and the Plan mode display with story 3.
- 2026-10-02 — Follow-ups from the story 1 review, for story 2:
  - replace the `DEFAULT_PERMISSION_MODE` constant in `App.tsx` with `AgentInfo.defaultPermissionMode`;
  - make `adapter` required in the API handler;
  - add a navigation guard (`will-navigate`, `setWindowOpenHandler`) before `POST /runs` exists, so that no foreign page loaded in the window can start Claude Code. The architect adds it to the story 2 plan, and Romain validates it.
  - Each generated shadcn file must be checked: the CLI writes `import { cn } from "cn"` and adds an unrelated `cn` npm package.
- 2026-10-02 — Out of scope, noted for a future story: an unreadable or corrupt `projects.json` shows the "no project" empty state with no error, and "+" does nothing.
- 2026-10-02 — Story 2 plan amended after story 1: "Changes for story 2, after story 1", "Tasks — story 2, amended after story 1", "Test strategy — additions for story 2", Decisions 15 and 16, new Risks.
- 2026-10-02 — Spike S1 results, scripts part (dev). The `e2e/fake-sdk/fixtures/` recordings are the reference.
  - Versions and calls:
    - Claude Code 2.1.287, `~/.local/bin/claude`; SDK `@anthropic-ai/claude-agent-sdk@0.3.287`, exact pin.
    - Every `init` reports `claude_code_version: 2.1.287`, so the installed binary runs, not the bundled one.
    - `apiKeySource: "none"`: the login is used.
    - 8 queries reached the model; 3 more failed before any model call. No system dialog was observed.
  - Facts that tasks 9 and 11 must follow, where they differ from the plan:
    - `claude --help` calls the Manual mode `manual`, while the SDK type says `default`. Not in the list of this story.
    - Missing executable: the SDK throws `ReferenceError: Claude Code native binary not found at …`, not `Claude Code executable not found at …`.
    - Stop: `interrupt()` gives a `result` with `is_error: true` (`terminal_reason: "aborted_streaming"`), then the iteration throws `Claude Code returned an error result: …`. After `stop()`, both must be suppressed, so a stopped run shows "Interrupted" and no error. `resume` after a stop remembers the interrupted turn.
    - Not logged in: the same text, "Not logged in · Please run /login", comes three times (an `assistant` with `error: "authentication_failed"`, a `result` with `is_error: true` and `subtype: "success"`, then a thrown error). The adapter emits it once.
    - `resume` with an unknown id: no `init`, only an error `result` (`errors[]`), then a throw.
    - `auto` mode is available on Romain's account (`init.permissionMode: "auto"`).
    - Plan mode: the model itself refused to write files or run `touch`; only `ls` ran, and `git status --porcelain` stayed empty. The SDK denial path was recorded in `dontAsk` instead (fixture `j`): `tool_use`, then `system/permission_denied`, then a `tool_result` with the denial.
    - Plan mode: Claude writes its plan with an allowed Write to `~/.claude/plans/<slug>.md`, outside the project. An action line points there. AC10 still holds.
    - Time to the first text: 1.6 to 3.9 s after the query starts.
  - Electron check: prepared as temporary code (`src/main/s1-check.ts`, 2 lines in `index.ts`, the SDK pinned in `package.json`), uncommitted, for Romain to run.
- 2026-10-02 — Spike S1, Electron check, run by Romain with `npm run dev`. Everything matches the plan, and no macOS dialog or Keychain prompt appeared. The temporary code is reverted and was never committed.
  - Electron's Node is 24.21.0, Electron 44.5.1, SDK 0.3.287.
  - `pathToClaudeCodeExecutable` is `/Users/romain/.local/bin/claude`.
  - `init`: `permissionMode: 'plan'`, `claude_code_version: '2.1.287'`, `apiKeySource: 'none'`, after 906 ms.
  - The answer "pong" arrived in 5.9 s, with no error.
- 2026-10-02 — Story 2 decisions (approved by Romain):
  - Decision 15 = A: the navigation guard covers the main window; no API token.
  - Decision 16 = A: an e2e test checks that no window can be opened.
  - In Plan mode, the action line for the plan file Claude writes under `~/.claude/plans/` is shown like any other action.
