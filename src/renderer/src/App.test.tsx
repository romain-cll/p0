import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, RunRequest } from '../../shared/chat'
import App from './App'

// `CA<n>` refers to the acceptance criteria of docs/features/app-shell.md.
// `AC<n>` refers to the acceptance criteria of docs/features/hidden-titlebar.md.
// `chat AC<n>` refers to the acceptance criteria of docs/features/claude-code-chat.md (stories 1 and 2).
//
// Contracts these tests rely on (see the technical plan of claude-code-chat, tasks 5 and 6 for story 1,
// tasks 14 and 15 for story 2):
// - `App` is the default export of ./App. On mount it calls `listProjects()` and `getAgent()` of `@/lib/api`;
//   the projects show once both have answered, and the first one is selected. `@/lib/api` is the only thing
//   mocked (it is the process frontier). `startRun` and `stopRun` are used from story 2 on.
// - four regions (role "region") named by aria-label;
// - the "Projects" region holds one `button` per project, in the order of `listProjects()`, then the
//   "+" `button` whose accessible name is "Add project", last. A project button is named after the
//   project (`name`) and its text is the uppercase initial; the selected one carries aria-current="true".
//   Clicking "Add project" calls `addProject()` of `@/lib/api`; the answer's `selected` is the path
//   of the project to select (null: nothing changes).
// - the "Chat history" region: its first `button` is the creation button named "New chat"
//   (never aria-current); the buttons after it are the chats, newest first, each with its title as
//   text and aria-current="true" when selected. With no project it shows "Add a project to get started".
//   A chat is titled "New chat" until its first message, then the first non-empty line of that message.
// - a new chat is in `AgentInfo.defaultPermissionMode` (from `getAgent()`), and its runs ask for that mode.
// - the "Active chat" region shows, in this order of precedence:
//   "Add a project to get started" (no project), "Select or start a chat" (project, no chat; the
//   "Message" textbox and the "Send" button are then disabled), "No messages yet" (a chat with no message).
// - the conversation (story 2) is the element with role `log` inside the "Active chat" region. Each user
//   message, reply, action line, "Interrupted" mark and error is one item of that log, in order: the
//   items are the children of the log that have some text (`logItems()` below). With no item the log may be
//   absent. An item's text contains the message or the reply; an action line's text is exactly
//   `<kind> <target>` (the kind alone when the target is empty); the mark's text is exactly "Interrupted";
//   an error carries `role="alert"` inside its item, with the error message as text.
// - the input: the textbox named "Message", and a `button` named "Send" that is disabled while the textbox is
//   empty or whitespace-only. Enter (without Shift, outside an IME composition) sends a non-empty message;
//   Shift+Enter inserts a line break. Sending adds the user item, clears the textbox, puts the focus back in it
//   and calls `startRun(request, onEvent)` with `{ runId (a fresh id), projectPath, prompt (the textbox
//   value), permissionMode (the chat's), sessionId (the chat's, absent before its first session event) }`.
//   `onEvent` feeds the events of that run to the chat that sent it, even when another chat is shown.
//   If `startRun` rejects, the chat shows an error with the rejection's message and is idle again.
// - while a chat answers, the button named "Send" is replaced by one named "Stop", and Enter sends nothing.
//   A click on Stop, or Esc while the focus is anywhere in the active chat, calls `stopRun(runId)` with the
//   run's id. Nothing changes in the conversation until the `end` event: `end` brings Send back, and
//   `end { interrupted: true }` adds the "Interrupted" mark. Esc does nothing when the chat is not answering.
// - switching project clears the chat selection (app-shell CA3); the chats of each project are kept.
// - src/renderer/src/data no longer exists (the mock data is gone).

const api = vi.hoisted(() => ({
  listProjects: vi.fn(),
  addProject: vi.fn(),
  getAgent: vi.fn(),
  startRun: vi.fn(),
  stopRun: vi.fn()
}))
vi.mock('@/lib/api', () => api)

interface TestProject {
  path: string
  name: string
}

const ATLAS: TestProject = { path: '/work/atlas', name: 'atlas' }
const BOREALIS: TestProject = { path: '/work/borealis', name: 'borealis' }
const COBALT: TestProject = { path: '/work/cobalt', name: 'cobalt' }
const PROJECTS = [ATLAS, BOREALIS, COBALT]

const REGION_NAMES = ['Projects', 'Chat history', 'Active chat', 'Artifacts and diff'] as const

const EMPTY_PROJECTS = 'Add a project to get started'
const EMPTY_NO_CHAT = 'Select or start a chat'
const EMPTY_CHAT = 'No messages yet'
const EMPTY_ARTIFACTS = 'No artifacts or diffs yet'
const NEW_CHAT = 'New chat'

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset()
  api.listProjects.mockResolvedValue(PROJECTS)
  api.addProject.mockRejectedValue(new Error('addProject was not expected in this test'))
  api.getAgent.mockResolvedValue({
    permissionModes: [{ value: 'plan', label: 'Plan' }],
    defaultPermissionMode: 'plan'
  })
  mockRuns()
  api.stopRun.mockResolvedValue(undefined)
})

const region = (name: (typeof REGION_NAMES)[number]): HTMLElement =>
  screen.getByRole('region', { name })

const initialOf = (name: string): string => name.trim().charAt(0).toUpperCase()

const isCurrent = (element: HTMLElement): boolean => element.getAttribute('aria-current') === 'true'

const railButtons = (): HTMLElement[] => within(region('Projects')).getAllByRole('button')

/** The project buttons: every button of the rail but the last one, "Add project". */
const projectButtons = (): HTMLElement[] => railButtons().slice(0, -1)

const addButton = (): HTMLElement => within(region('Projects')).getByRole('button', { name: 'Add project' })

const projectButton = (name: string): HTMLElement =>
  within(region('Projects')).getByRole('button', { name })

const historyButtons = (): HTMLElement[] => within(region('Chat history')).getAllByRole('button')

const newChatButton = (): HTMLElement => historyButtons()[0]

/** The chats of the history: every button after the creation button. */
const chatItems = (): HTMLElement[] => historyButtons().slice(1)

const displayedChatTitles = (): string[] => chatItems().map((button) => (button.textContent ?? '').trim())

const selectedChatCount = (): number => chatItems().filter(isCurrent).length

const textbox = (): HTMLElement => within(region('Active chat')).getByRole('textbox')

const settle = (): Promise<void> => act(async () => {})

// --- story 2: the runs are driven by the tests ---
interface FakeRun {
  request: RunRequest
  /** Delivers one event of this run to the app, as the stream of `startRun` would. */
  emit: (event: AgentEvent) => Promise<void>
  /** Emits `end` and closes the stream. */
  end: (interrupted?: boolean) => Promise<void>
  /** Closes the stream with no `end` event. */
  close: () => void
}

let runs: FakeRun[] = []

/** `startRun` records the run and stays pending until the test ends it. */
function mockRuns(): void {
  runs = []
  api.startRun.mockImplementation(
    (request: RunRequest, onEvent: (event: AgentEvent) => void) =>
      new Promise<void>((resolve) => {
        const run: FakeRun = {
          request,
          emit: (event) =>
            act(async () => {
              onEvent(event)
            }),
          end: async (interrupted = false) => {
            await run.emit({ type: 'end', interrupted })
            resolve()
          },
          close: resolve
        }
        runs.push(run)
      })
  )
}

const conversation = (): HTMLElement | null => within(region('Active chat')).queryByRole('log')

/** The items of the conversation: the children of the log that have some text. */
const logItems = (): HTMLElement[] =>
  Array.from(conversation()?.children ?? []).filter((child) => (child.textContent ?? '').trim() !== '') as HTMLElement[]

const itemTexts = (): string[] => logItems().map((item) => (item.textContent ?? '').replace(/\s+/g, ' ').trim())

const sendButton = (): HTMLElement => within(region('Active chat')).getByRole('button', { name: 'Send' })
const stopButton = (): HTMLElement => within(region('Active chat')).getByRole('button', { name: 'Stop' })
const queryStopButton = (): HTMLElement | null => within(region('Active chat')).queryByRole('button', { name: 'Stop' })

const chatButton = (title: string): HTMLElement => within(region('Chat history')).getByRole('button', { name: title })

// jsdom returns null getBoundingClientRect values: the `pointerdown` listener (capture, document)
// of react-resizable-panels then takes any click inside the group for a click on the handle,
// focuses the separator and calls preventDefault. `user.type` / `user.click` on the input area
// would type into the void: we focus it explicitly, then type with the keyboard.
const focusTextarea = (): void => {
  act(() => textbox().focus())
}
const typeInTextarea = async (user: User, text: string): Promise<void> => {
  focusTextarea()
  await user.keyboard(text)
}
/** Types `text` (no `{` or `[` in it) in the focused input, then presses Enter. */
const sendMessage = async (user: User, text: string): Promise<void> => {
  await typeInTextarea(user, `${text}{Enter}`)
}

/** The state of an active chat with no chat selected: the input and Send are disabled, nothing starts. */
function expectNoChatInput(): void {
  expect(textbox()).toBeDisabled()
  expect(sendButton()).toBeDisabled()
  expect(api.startRun).not.toHaveBeenCalled()
}

/** Renders the app with the projects given by the mocked API, once loaded and with the first one selected. */
async function renderApp(projects: TestProject[] = PROJECTS): Promise<void> {
  api.listProjects.mockResolvedValue(projects)
  render(<App />)
  if (projects.length === 0) {
    await within(region('Chat history')).findByText(EMPTY_PROJECTS)
    return
  }
  const first = await within(region('Projects')).findByRole('button', { name: projects[0].name })
  await waitFor(() => expect(isCurrent(first)).toBe(true))
}

type User = ReturnType<typeof userEvent.setup>

async function createChat(user: User): Promise<void> {
  await user.click(newChatButton())
}

const CHAT_COUNTS = [3, 2, 4]

/** App with the 3 projects, `CHAT_COUNTS[i]` chats created in project i, project 1 selected, no chat selected. */
async function renderAppWithChats(user: User): Promise<void> {
  await renderApp()
  for (let index = 0; index < PROJECTS.length; index++) {
    if (index > 0) await user.click(projectButton(PROJECTS[index].name))
    for (let n = 0; n < CHAT_COUNTS[index]; n++) await createChat(user)
  }
  await user.click(projectButton(PROJECTS[0].name))
}

describe('CA1 — 4-column layout', () => {
  it('CA1 — shows the 4 named regions in DOM order: projects, history, active chat, artifacts', async () => {
    render(<App />)
    await settle()

    const elements = REGION_NAMES.map((name) => region(name))

    for (let i = 0; i < elements.length - 1; i++) {
      const position = elements[i].compareDocumentPosition(elements[i + 1])
      expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })
})

// CA2 (mock projects in the rail) is removed: chat AC1, AC2 and AC3 replace it, below.

describe('chat AC1 — adding a project', () => {
  it('chat AC1 — the rail ends with a "+" button named "Add project", after the projects', async () => {
    await renderApp()

    const buttons = railButtons()
    expect(buttons).toHaveLength(PROJECTS.length + 1)
    expect(buttons[buttons.length - 1]).toHaveAccessibleName('Add project')
    expect(buttons.slice(0, -1).map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual(
      PROJECTS.map((project) => project.name)
    )
  })

  it('chat AC1 — clicking "+" opens the picker (one addProject call) and the picked folder appears with its initial, selected', async () => {
    const user = userEvent.setup()
    await renderApp([ATLAS])
    api.addProject.mockResolvedValue({ projects: [ATLAS, BOREALIS], selected: BOREALIS.path })

    await user.click(addButton())

    const added = await within(region('Projects')).findByRole('button', { name: 'borealis' })
    expect(api.addProject).toHaveBeenCalledTimes(1)
    expect(added).toHaveTextContent(initialOf('borealis'))
    expect(added).toHaveTextContent('B')
    await waitFor(() => expect(isCurrent(added)).toBe(true))
    expect(isCurrent(projectButton('atlas'))).toBe(false)
    expect(projectButtons()).toHaveLength(2)
    expect(railButtons()[2]).toHaveAccessibleName('Add project')
  })

  it('chat AC1 — a project that has just been added is selected with no chat selected and none listed', async () => {
    const user = userEvent.setup()
    await renderApp([ATLAS])
    await createChat(user)
    expect(selectedChatCount()).toBe(1)
    api.addProject.mockResolvedValue({ projects: [ATLAS, BOREALIS], selected: BOREALIS.path })

    await user.click(addButton())

    await waitFor(() => expect(isCurrent(projectButton('borealis'))).toBe(true))
    expect(chatItems()).toHaveLength(0)
    expect(within(region('Active chat')).getByText(EMPTY_NO_CHAT)).toBeInTheDocument()
    expectNoChatInput()
  })

  it('chat AC1 — cancelling the picker changes nothing: same projects, same selection', async () => {
    const user = userEvent.setup()
    await renderApp([ATLAS, BOREALIS])
    await user.click(projectButton('borealis'))
    api.addProject.mockResolvedValue({ projects: [ATLAS, BOREALIS], selected: null })

    await user.click(addButton())
    await waitFor(() => expect(api.addProject).toHaveBeenCalledTimes(1))
    await settle()

    expect(projectButtons().map((button) => button.getAttribute('aria-label'))).toEqual(['atlas', 'borealis'])
    expect(isCurrent(projectButton('borealis'))).toBe(true)
    expect(isCurrent(projectButton('atlas'))).toBe(false)
  })

  it('chat AC1 — cancelling the picker with no project leaves the rail with only the "+" button', async () => {
    const user = userEvent.setup()
    await renderApp([])
    api.addProject.mockResolvedValue({ projects: [], selected: null })

    await user.click(addButton())
    await waitFor(() => expect(api.addProject).toHaveBeenCalledTimes(1))
    await settle()

    expect(railButtons()).toHaveLength(1)
    expect(within(region('Chat history')).getByText(EMPTY_PROJECTS)).toBeInTheDocument()
  })

  it('chat AC1 — picking a folder that is already a project selects that project and adds no button', async () => {
    const user = userEvent.setup()
    await renderApp()
    await user.click(projectButton('cobalt'))
    expect(isCurrent(projectButton('cobalt'))).toBe(true)
    api.addProject.mockResolvedValue({ projects: PROJECTS, selected: ATLAS.path })

    await user.click(addButton())

    await waitFor(() => expect(isCurrent(projectButton('atlas'))).toBe(true))
    expect(isCurrent(projectButton('cobalt'))).toBe(false)
    expect(projectButtons()).toHaveLength(PROJECTS.length)
    expect(railButtons()).toHaveLength(PROJECTS.length + 1)
  })

  it('chat AC1 — the first project added from an empty app is selected and the empty state goes away', async () => {
    const user = userEvent.setup()
    await renderApp([])
    api.addProject.mockResolvedValue({ projects: [ATLAS], selected: ATLAS.path })

    await user.click(addButton())

    const added = await within(region('Projects')).findByRole('button', { name: 'atlas' })
    await waitFor(() => expect(isCurrent(added)).toBe(true))
    expect(screen.queryByText(EMPTY_PROJECTS)).not.toBeInTheDocument()
    expect(within(region('Active chat')).getByText(EMPTY_NO_CHAT)).toBeInTheDocument()
    expectNoChatInput()
  })
})

describe('chat AC2 — projects kept between launches', () => {
  it('chat AC2 — the projects returned by the API are in the rail in the same order, each with its initial', async () => {
    await renderApp([BOREALIS, COBALT, ATLAS])

    expect(api.listProjects).toHaveBeenCalled()
    const buttons = projectButtons()
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['borealis', 'cobalt', 'atlas'])
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['B', 'C', 'A'])
  })

  it('chat AC2 — the first project is selected and the others are not', async () => {
    await renderApp([BOREALIS, COBALT, ATLAS])

    const [first, second, third] = projectButtons()
    expect(isCurrent(first)).toBe(true)
    expect(isCurrent(second)).toBe(false)
    expect(isCurrent(third)).toBe(false)
  })

  it('chat AC2 — the history shows the first project with no chat selected', async () => {
    await renderApp()

    expect(chatItems()).toHaveLength(0)
    expect(within(region('Active chat')).getByText(EMPTY_NO_CHAT)).toBeInTheDocument()
    expectNoChatInput()
  })
})

describe('chat AC3 — no project', () => {
  it('chat AC3 — the rail shows only the "+" button', async () => {
    await renderApp([])

    const buttons = railButtons()
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).toHaveAccessibleName('Add project')
  })

  it('chat AC3 — the history and the active chat both show "Add a project to get started"', async () => {
    await renderApp([])

    expect(within(region('Chat history')).getByText(EMPTY_PROJECTS)).toBeInTheDocument()
    expect(within(region('Active chat')).getByText(EMPTY_PROJECTS)).toBeInTheDocument()
  })

  it('chat AC3 — there is no chat to create without a project', async () => {
    await renderApp([])

    const history = within(region('Chat history'))
    const creation = history.queryByRole('button', { name: NEW_CHAT })
    expect(creation === null || (creation as HTMLButtonElement).disabled).toBe(true)
    expect(history.queryAllByRole('button').filter((button) => !(button as HTMLButtonElement).disabled)).toHaveLength(0)
  })

  it('chat AC3 — the mock projects and chats no longer exist', async () => {
    await renderApp([])

    for (const mock of ['Atlas', 'Borealis', 'Cobalt']) {
      expect(screen.queryByRole('button', { name: mock })).not.toBeInTheDocument()
    }
    for (const title of ['Move the database to PostgreSQL', 'Redesign the login page', 'Add offline mode']) {
      expect(screen.queryByText(title)).not.toBeInTheDocument()
    }
  })

  it('chat AC3 — the mock data folder src/renderer/src/data is deleted', () => {
    // no file is left in src/renderer/src/data (the glob is resolved by Vite at transform time)
    expect(Object.keys(import.meta.glob('./data/**/*'))).toEqual([])
  })

  it('chat AC3 — the empty state "Add a project to get started" is not shown once there is a project', async () => {
    await renderApp()

    expect(screen.queryByText(EMPTY_PROJECTS)).not.toBeInTheDocument()
  })
})

describe('chat AC4 — New chat', () => {
  it('chat AC4 — with a selected project and no chat, the history has a "New chat" button and the active chat invites to start one', async () => {
    await renderApp()

    expect(newChatButton()).toHaveAccessibleName(NEW_CHAT)
    expect(newChatButton()).toBeEnabled()
    expect(isCurrent(newChatButton())).toBe(false)
    expect(chatItems()).toHaveLength(0)
    const chat = within(region('Active chat'))
    expect(chat.getByText(EMPTY_NO_CHAT)).toBeInTheDocument()
    expect(chat.queryByText(EMPTY_CHAT)).not.toBeInTheDocument()
    expectNoChatInput()
  })

  it('chat AC4 — clicking "New chat" adds a chat titled "New chat", selected', async () => {
    const user = userEvent.setup()
    await renderApp()

    await user.click(newChatButton())

    expect(chatItems()).toHaveLength(1)
    expect(chatItems()[0]).toHaveTextContent(NEW_CHAT)
    expect(isCurrent(chatItems()[0])).toBe(true)
    expect(newChatButton()).toHaveAccessibleName(NEW_CHAT)
    expect(isCurrent(newChatButton())).toBe(false)
  })

  it('chat AC4 — each new chat goes at the top of the list and is the only one selected', async () => {
    const user = userEvent.setup()
    await renderApp()

    await user.click(newChatButton())
    await user.click(newChatButton())

    expect(displayedChatTitles()).toEqual([NEW_CHAT, NEW_CHAT])
    expect(isCurrent(chatItems()[0])).toBe(true)
    expect(isCurrent(chatItems()[1])).toBe(false)
    expect(selectedChatCount()).toBe(1)

    await user.click(chatItems()[1]) // the older chat
    expect(isCurrent(chatItems()[1])).toBe(true)
    await user.click(newChatButton())

    expect(displayedChatTitles()).toEqual([NEW_CHAT, NEW_CHAT, NEW_CHAT])
    expect(isCurrent(chatItems()[0])).toBe(true)
    expect(selectedChatCount()).toBe(1)
  })

  it('chat AC4 — the new chat has an empty conversation: "No messages yet", no message, and the input is enabled', async () => {
    const user = userEvent.setup()
    await renderApp()

    await user.click(newChatButton())

    const chat = within(region('Active chat'))
    expect(chat.getByText(EMPTY_CHAT)).toBeInTheDocument()
    expect(chat.queryByText(EMPTY_NO_CHAT)).not.toBeInTheDocument()
    expect(logItems()).toHaveLength(0)
    expect(textbox()).toBeEnabled()
  })

  it('chat AC4 — creating a chat does not start Claude Code', async () => {
    const user = userEvent.setup()
    await renderApp()

    await user.click(newChatButton())

    expect(api.startRun).not.toHaveBeenCalled()
  })

  it('chat AC4 — chats belong to their project: another project has none, and the first project keeps its own', async () => {
    const user = userEvent.setup()
    await renderApp()
    await user.click(newChatButton())
    await user.click(newChatButton())

    await user.click(projectButton('borealis'))
    expect(chatItems()).toHaveLength(0)

    await user.click(projectButton('atlas'))
    expect(chatItems()).toHaveLength(2)
    expect(selectedChatCount()).toBe(0)
  })
})

describe('CA3 — switching project', () => {
  // Setup changed: the projects come from the mocked API and the chats are created with "New chat"
  // (no mock chats any more). Chats are told apart by their number: 3, 2 and 4 in projects 1, 2 and 3.
  const titlesOf = (index: number): string[] => Array<string>(CHAT_COUNTS[index]).fill(NEW_CHAT)

  it.each([1, 2])(
    'CA3 — clicking project %i selects its icon, shows only its chats, with no chat selected',
    async (target) => {
      const user = userEvent.setup()
      await renderAppWithChats(user)

      // a chat of project 1 is selected before switching project
      await user.click(chatItems()[0])
      expect(selectedChatCount()).toBe(1)

      await user.click(projectButtons()[target])

      PROJECTS.forEach((_, index) => {
        expect(isCurrent(projectButtons()[index])).toBe(index === target)
      })
      expect(displayedChatTitles()).toEqual(titlesOf(target))
      expect(selectedChatCount()).toBe(0)
    }
  )

  it('CA3 — going back to project 1 shows only its chats again, with no chat selected', async () => {
    const user = userEvent.setup()
    await renderAppWithChats(user)

    await user.click(projectButtons()[1])
    await user.click(chatItems()[0])
    await user.click(projectButtons()[0])

    expect(isCurrent(projectButtons()[0])).toBe(true)
    expect(isCurrent(projectButtons()[1])).toBe(false)
    expect(displayedChatTitles()).toEqual(titlesOf(0))
    expect(selectedChatCount()).toBe(0)
  })
})

describe('CA4 — selecting a chat', () => {
  it('CA4 — clicking chat A then chat B leaves only B selected', async () => {
    const user = userEvent.setup()
    await renderAppWithChats(user)

    await user.click(chatItems()[0])
    expect(isCurrent(chatItems()[0])).toBe(true)
    expect(selectedChatCount()).toBe(1)

    await user.click(chatItems()[1])
    expect(isCurrent(chatItems()[1])).toBe(true)
    expect(isCurrent(chatItems()[0])).toBe(false)
    expect(selectedChatCount()).toBe(1)
  })
})

// CA5 (the active chat is always empty) is removed: chat AC3 (empty state without a project) and
// chat AC4 ("Select or start a chat", then "No messages yet") replace it, above.

// CA6 (the input area: Send always disabled, Enter inserts a line break) is removed in story 2:
// chat AC5 replaces it below. Its three tests map to:
// - "the typed text shows in the area and the Send button is disabled"
//     => "chat AC5 — Send is disabled while the input is empty or whitespace-only, and enabled once it has text";
// - "the Enter key inserts a line break in the area"
//     => "chat AC5 — Shift+Enter inserts a line break and sends nothing", and Enter now sends;
// - "neither a click on Send nor Enter adds a message or clears the area"
//     => "chat AC5 — an empty or whitespace-only message cannot be sent", and the sending tests.

/** App with project atlas, a new chat selected, and the focus not yet in the input. */
async function renderWithChat(user: User): Promise<void> {
  await renderApp()
  await createChat(user)
}

describe('chat AC4 — loading and default mode', () => {
  it('chat AC4 — the projects show once both listProjects and getAgent have answered', async () => {
    let answerAgent!: (info: unknown) => void
    api.getAgent.mockReturnValue(new Promise((resolve) => (answerAgent = resolve)))
    api.listProjects.mockResolvedValue(PROJECTS)
    render(<App />)
    await settle()

    expect(api.listProjects).toHaveBeenCalled()
    expect(api.getAgent).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'atlas' })).not.toBeInTheDocument()

    answerAgent({ permissionModes: [{ value: 'plan', label: 'Plan' }], defaultPermissionMode: 'plan' })

    const first = await within(region('Projects')).findByRole('button', { name: 'atlas' })
    await waitFor(() => expect(isCurrent(first)).toBe(true))
  })

  it('chat AC4 — a new chat is in the default mode the agent announces: its first run asks for it', async () => {
    const user = userEvent.setup()
    api.getAgent.mockResolvedValue({
      permissionModes: [
        { value: 'plan', label: 'Plan' },
        { value: 'dontAsk', label: "Don't ask" }
      ],
      defaultPermissionMode: 'dontAsk'
    })
    await renderWithChat(user)

    await sendMessage(user, 'hello')

    await waitFor(() => expect(api.startRun).toHaveBeenCalledTimes(1))
    expect(runs[0].request.permissionMode).toBe('dontAsk')
  })

  it('chat AC4 — a new chat in Plan: its first run asks for plan', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)

    await sendMessage(user, 'hello')

    await waitFor(() => expect(api.startRun).toHaveBeenCalledTimes(1))
    expect(runs[0].request.permissionMode).toBe('plan')
  })
})

describe('chat AC4 — the title', () => {
  it('chat AC4 — the title becomes the first line of the first message, and stays after the next ones', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)
    expect(displayedChatTitles()).toEqual([NEW_CHAT])

    await typeInTextarea(user, 'Fix the login bug{Shift>}{Enter}{/Shift}it crashes on submit{Enter}')

    await waitFor(() => expect(displayedChatTitles()).toEqual(['Fix the login bug']))
    await runs[0].end()
    await sendMessage(user, 'something else')
    await waitFor(() => expect(api.startRun).toHaveBeenCalledTimes(2))
    expect(displayedChatTitles()).toEqual(['Fix the login bug'])
  })

  it('chat AC4 — only the chat that was written to is renamed', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)
    await createChat(user)

    await sendMessage(user, 'second chat')

    await waitFor(() => expect(displayedChatTitles()).toEqual(['second chat', NEW_CHAT]))
  })
})

describe('chat AC5 — sending a message', () => {
  it('chat AC5 — Enter sends: the message shows in the conversation, the input is cleared, and Claude Code starts in the project', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)

    await typeInTextarea(user, 'hello')
    expect(textbox()).toHaveValue('hello')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(itemTexts()).toEqual([expect.stringContaining('hello')]))
    expect(textbox()).toHaveValue('')
    expect(within(region('Active chat')).queryByText(EMPTY_CHAT)).not.toBeInTheDocument()
    expect(api.startRun).toHaveBeenCalledTimes(1)
    const { request } = runs[0]
    expect(request).toMatchObject({ projectPath: ATLAS.path, prompt: 'hello', permissionMode: 'plan' })
    expect(typeof request.runId).toBe('string')
    expect(request.runId).not.toBe('')
    expect(request.sessionId).toBeUndefined()
  })

  it('chat AC5 — clicking Send sends too, and the focus goes back to the input', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)
    await typeInTextarea(user, 'hello')

    await user.click(sendButton())

    await waitFor(() => expect(api.startRun).toHaveBeenCalledTimes(1))
    expect(runs[0].request.prompt).toBe('hello')
    expect(textbox()).toHaveValue('')
    expect(itemTexts()).toEqual([expect.stringContaining('hello')])
    expect(textbox()).toHaveFocus()
  })

  it('chat AC5 — Shift+Enter inserts a line break and sends nothing; Enter then sends both lines', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)

    await typeInTextarea(user, 'hello{Shift>}{Enter}{/Shift}world')

    expect(textbox()).toHaveValue('hello\nworld')
    expect(api.startRun).not.toHaveBeenCalled()
    expect(logItems()).toHaveLength(0)

    await user.keyboard('{Enter}')

    await waitFor(() => expect(api.startRun).toHaveBeenCalledTimes(1))
    expect(runs[0].request.prompt).toBe('hello\nworld')
    expect(textbox()).toHaveValue('')
  })

  it('chat AC5 — Send is disabled while the input is empty or whitespace-only, and enabled once it has text', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)
    expect(sendButton()).toBeDisabled()

    await typeInTextarea(user, '   ')
    expect(sendButton()).toBeDisabled()

    await user.keyboard('hi')
    expect(sendButton()).toBeEnabled()
  })

  it('chat AC5 — an empty or whitespace-only message cannot be sent: Enter and a click on Send do nothing', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)

    await user.click(sendButton())
    await typeInTextarea(user, '{Enter}')
    await user.keyboard('   {Enter}')
    await user.click(sendButton())
    await settle()

    expect(api.startRun).not.toHaveBeenCalled()
    expect(logItems()).toHaveLength(0)
    expect(within(region('Active chat')).getByText(EMPTY_CHAT)).toBeInTheDocument()

    // the input itself works: a real message goes through (only the empty ones were refused)
    await typeInTextarea(user, 'real{Enter}')
    await waitFor(() => expect(api.startRun).toHaveBeenCalledTimes(1))
    expect(runs[0].request.prompt).toBe('real')
  })

  it('chat AC5 — Enter during an IME composition does not send', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)
    await typeInTextarea(user, 'konnichiwa')

    fireEvent.keyDown(textbox(), { key: 'Enter', isComposing: true })
    await settle()

    expect(api.startRun).not.toHaveBeenCalled()
    expect(textbox()).toHaveValue('konnichiwa')

    // the same key outside a composition sends
    await user.keyboard('{Enter}')
    await waitFor(() => expect(api.startRun).toHaveBeenCalledTimes(1))
    expect(runs[0].request.prompt).toBe('konnichiwa')
  })

  it('chat AC5 — the reply appears progressively: each text event grows the same reply', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)
    await sendMessage(user, 'hello')
    await waitFor(() => expect(runs).toHaveLength(1))

    await runs[0].emit({ type: 'text', text: 'Hel' })
    expect(itemTexts()).toEqual([expect.stringContaining('hello'), expect.stringContaining('Hel')])
    expect(itemTexts()[1]).not.toContain('Hello')

    await runs[0].emit({ type: 'text', text: 'lo, world' })
    expect(itemTexts()).toEqual([expect.stringContaining('hello'), expect.stringContaining('Hello, world')])
  })

  it('chat AC5 — Claude Code answers in the folder of the selected project', async () => {
    const user = userEvent.setup()
    await renderApp()
    await user.click(projectButton('borealis'))
    await createChat(user)

    await sendMessage(user, 'hello')

    await waitFor(() => expect(api.startRun).toHaveBeenCalledTimes(1))
    expect(runs[0].request.projectPath).toBe(BOREALIS.path)
  })

  it('chat AC5 — while the chat answers, Send becomes Stop and Enter sends nothing more', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)
    await sendMessage(user, 'hello')
    await waitFor(() => expect(runs).toHaveLength(1))

    expect(stopButton()).toBeInTheDocument()
    expect(within(region('Active chat')).queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
    await typeInTextarea(user, 'another{Enter}')
    await settle()

    expect(api.startRun).toHaveBeenCalledTimes(1)
  })

  it('chat AC5 — when the answer ends, Send is back and the chat takes a new message', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)
    await sendMessage(user, 'hello')
    await waitFor(() => expect(runs).toHaveLength(1))
    await runs[0].emit({ type: 'text', text: 'Hi.' })

    await runs[0].end()

    expect(queryStopButton()).not.toBeInTheDocument()
    expect(sendButton()).toBeInTheDocument()
    await sendMessage(user, 'again')
    await waitFor(() => expect(api.startRun).toHaveBeenCalledTimes(2))
    expect(itemTexts()).toEqual([
      expect.stringContaining('hello'),
      expect.stringContaining('Hi.'),
      expect.stringContaining('again')
    ])
  })
})

describe('chat AC6 — the same conversation', () => {
  it('chat AC6 — the next message resumes the session of the chat: the first run has none, the second has the one it announced', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)
    await sendMessage(user, 'first')
    await waitFor(() => expect(runs).toHaveLength(1))
    await runs[0].emit({ type: 'session', sessionId: 'session-1' })
    await runs[0].emit({ type: 'text', text: 'ok' })
    await runs[0].end()

    await sendMessage(user, 'second')

    await waitFor(() => expect(runs).toHaveLength(2))
    expect(runs[0].request.sessionId).toBeUndefined()
    expect(runs[1].request.sessionId).toBe('session-1')
    expect(runs[1].request.runId).not.toBe(runs[0].request.runId)
  })

  it('chat AC6 — another chat does not get that session: it has its own conversation', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)
    await sendMessage(user, 'first')
    await waitFor(() => expect(runs).toHaveLength(1))
    await runs[0].emit({ type: 'session', sessionId: 'session-1' })
    await runs[0].end()

    await createChat(user)
    await sendMessage(user, 'other chat')

    await waitFor(() => expect(runs).toHaveLength(2))
    expect(runs[1].request.sessionId).toBeUndefined()
  })

  it('chat AC6 — each chat keeps its own session', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)
    await sendMessage(user, 'chat one')
    await waitFor(() => expect(runs).toHaveLength(1))
    await runs[0].emit({ type: 'session', sessionId: 'session-A' })
    await runs[0].end()
    await createChat(user)
    await sendMessage(user, 'chat two')
    await waitFor(() => expect(runs).toHaveLength(2))
    await runs[1].emit({ type: 'session', sessionId: 'session-B' })
    await runs[1].end()

    await user.click(chatButton('chat one'))
    await sendMessage(user, 'back in one')

    await waitFor(() => expect(runs).toHaveLength(3))
    expect(runs[2].request.sessionId).toBe('session-A')
  })
})

describe('chat AC7 — action lines', () => {
  it('chat AC7 — each action is one line in the conversation, in order with the text', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)
    await sendMessage(user, 'go')
    await waitFor(() => expect(runs).toHaveLength(1))

    await runs[0].emit({ type: 'text', text: 'Let me look.' })
    await runs[0].emit({ type: 'action', kind: 'Read', target: 'README.md' })
    await runs[0].emit({ type: 'text', text: 'Now ' })
    await runs[0].emit({ type: 'text', text: 'the change.' })
    await runs[0].emit({ type: 'action', kind: 'Edit', target: 'src/index.ts' })
    await runs[0].emit({ type: 'action', kind: 'Bash', target: 'npm test' })
    await runs[0].emit({ type: 'text', text: 'Done.' })

    expect(itemTexts()).toEqual([
      expect.stringContaining('go'),
      expect.stringContaining('Let me look.'),
      'Read README.md',
      expect.stringContaining('Now the change.'),
      'Edit src/index.ts',
      'Bash npm test',
      expect.stringContaining('Done.')
    ])
  })

  it('chat AC7 — an action with no target shows its kind alone', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)
    await sendMessage(user, 'go')
    await waitFor(() => expect(runs).toHaveLength(1))

    await runs[0].emit({ type: 'action', kind: 'Task', target: '' })

    expect(itemTexts().at(-1)).toBe('Task')
  })
})

describe('chat AC11 — Stop', () => {
  async function answeringChat(user: User): Promise<void> {
    await renderWithChat(user)
    await sendMessage(user, 'count slowly')
    await waitFor(() => expect(runs).toHaveLength(1))
    await runs[0].emit({ type: 'text', text: 'one two ' })
  }

  it('chat AC11 — while Claude Code answers, the button is Stop; once it ends, it is Send again', async () => {
    const user = userEvent.setup()
    await answeringChat(user)

    expect(stopButton()).toBeEnabled()
    expect(within(region('Active chat')).queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()

    await runs[0].end()

    expect(queryStopButton()).not.toBeInTheDocument()
    expect(sendButton()).toBeInTheDocument()
  })

  it('chat AC11 — a click on Stop stops that run, the text stays, "Interrupted" shows and a new message can be sent', async () => {
    const user = userEvent.setup()
    await answeringChat(user)

    await user.click(stopButton())

    expect(api.stopRun).toHaveBeenCalledTimes(1)
    expect(api.stopRun).toHaveBeenCalledWith(runs[0].request.runId)
    await runs[0].end(true)
    expect(itemTexts()).toEqual([
      expect.stringContaining('count slowly'),
      expect.stringContaining('one two'),
      'Interrupted'
    ])
    expect(queryStopButton()).not.toBeInTheDocument()
    expect(sendButton()).toBeInTheDocument()
    await sendMessage(user, 'next')
    await waitFor(() => expect(runs).toHaveLength(2))
    expect(itemTexts().at(-1)).toContain('next')
  })

  it('chat AC11 — Esc in the input stops the run too', async () => {
    const user = userEvent.setup()
    await answeringChat(user)
    focusTextarea()

    await user.keyboard('{Escape}')

    expect(api.stopRun).toHaveBeenCalledTimes(1)
    expect(api.stopRun).toHaveBeenCalledWith(runs[0].request.runId)
    await runs[0].end(true)
    expect(itemTexts().at(-1)).toBe('Interrupted')
  })

  it('chat AC11 — Esc stops the run wherever the focus is in the active chat', async () => {
    const user = userEvent.setup()
    await answeringChat(user)
    act(() => stopButton().focus())

    await user.keyboard('{Escape}')

    expect(api.stopRun).toHaveBeenCalledTimes(1)
    expect(api.stopRun).toHaveBeenCalledWith(runs[0].request.runId)
  })

  it('chat AC11 — Esc does nothing when the chat is not answering', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)
    await sendMessage(user, 'hello')
    await waitFor(() => expect(runs).toHaveLength(1))
    await runs[0].end()
    focusTextarea()

    await user.keyboard('{Escape}')
    await settle()

    expect(api.stopRun).not.toHaveBeenCalled()
    expect(itemTexts()).toEqual([expect.stringContaining('hello')])
  })

  it('chat AC11 — without an interruption, no "Interrupted" mark shows', async () => {
    const user = userEvent.setup()
    await answeringChat(user)

    await runs[0].end(false)

    expect(itemTexts()).not.toContain('Interrupted')
  })

  it('chat AC11 — with no chat selected, Esc stops nothing and Send stays disabled', async () => {
    await renderApp()

    fireEvent.keyDown(textbox(), { key: 'Escape' })
    fireEvent.keyDown(textbox(), { key: 'Enter' })
    await settle()

    expect(api.stopRun).not.toHaveBeenCalled()
    expectNoChatInput()
  })
})

describe('chat AC12 — background answers', () => {
  it('chat AC12 — chat A keeps receiving while chat B is shown, and shows everything received when I come back', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)
    await sendMessage(user, 'question for A')
    await waitFor(() => expect(runs).toHaveLength(1))
    await runs[0].emit({ type: 'text', text: 'start of A. ' })

    await createChat(user)
    expect(within(region('Active chat')).getByText(EMPTY_CHAT)).toBeInTheDocument()
    await runs[0].emit({ type: 'text', text: 'more of A. ' })
    await runs[0].emit({ type: 'action', kind: 'Read', target: 'README.md' })
    await runs[0].emit({ type: 'text', text: 'end of A.' })

    expect(logItems()).toHaveLength(0)
    expect(within(region('Active chat')).queryByText(/more of A/)).not.toBeInTheDocument()
    await user.click(chatButton('question for A'))
    expect(itemTexts()).toEqual([
      expect.stringContaining('question for A'),
      expect.stringContaining('start of A. more of A.'),
      'Read README.md',
      expect.stringContaining('end of A.')
    ])
    expect(stopButton()).toBeInTheDocument() // A is still answering
  })

  it('chat AC12 — chat B can send its own message while chat A is answering, and the answers do not mix', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)
    await sendMessage(user, 'question for A')
    await waitFor(() => expect(runs).toHaveLength(1))
    await createChat(user)

    expect(sendButton()).toBeDisabled() // empty input, but the Send button is there: B is not answering
    await sendMessage(user, 'question for B')

    await waitFor(() => expect(runs).toHaveLength(2))
    expect(runs[1].request.prompt).toBe('question for B')
    await runs[0].emit({ type: 'text', text: 'answer A' })
    await runs[1].emit({ type: 'text', text: 'answer B' })
    expect(itemTexts()).toEqual([expect.stringContaining('question for B'), expect.stringContaining('answer B')])
    await user.click(chatButton('question for A'))
    expect(itemTexts()).toEqual([expect.stringContaining('question for A'), expect.stringContaining('answer A')])
  })

  it('chat AC12 — Stop in one chat stops only its run', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)
    await sendMessage(user, 'question for A')
    await waitFor(() => expect(runs).toHaveLength(1))
    await createChat(user)
    await sendMessage(user, 'question for B')
    await waitFor(() => expect(runs).toHaveLength(2))

    await user.click(stopButton())

    expect(api.stopRun).toHaveBeenCalledTimes(1)
    expect(api.stopRun).toHaveBeenCalledWith(runs[1].request.runId)
  })

  it('chat AC12 — switching project and coming back: the answer kept going and the chat shows what was received meanwhile', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)
    await sendMessage(user, 'question for A')
    await waitFor(() => expect(runs).toHaveLength(1))
    await runs[0].emit({ type: 'text', text: 'before. ' })

    await user.click(projectButton('borealis'))
    await runs[0].emit({ type: 'text', text: 'meanwhile.' })
    expect(chatItems()).toHaveLength(0)
    await user.click(projectButton('atlas'))
    await user.click(chatButton('question for A'))

    expect(itemTexts()).toEqual([expect.stringContaining('question for A'), expect.stringContaining('before. meanwhile.')])
    expect(stopButton()).toBeInTheDocument()
    expect(api.stopRun).not.toHaveBeenCalled()
  })

  it('chat AC12 — a run that ends while another chat is shown leaves its chat idle, ready for a new message', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)
    await sendMessage(user, 'question for A')
    await waitFor(() => expect(runs).toHaveLength(1))
    await createChat(user)

    await runs[0].emit({ type: 'text', text: 'done.' })
    await runs[0].end()
    await user.click(chatButton('question for A'))

    expect(queryStopButton()).not.toBeInTheDocument()
    expect(sendButton()).toBeInTheDocument()
  })
})

describe('chat AC13 — errors', () => {
  it('chat AC13 — an error is shown in the conversation as an alert that says what went wrong, and the input works again', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)
    await sendMessage(user, 'hello')
    await waitFor(() => expect(runs).toHaveLength(1))

    await runs[0].emit({ type: 'error', message: 'Not logged in · Please run /login' })
    await runs[0].end()

    const alert = within(conversation()!).getByRole('alert')
    expect(alert).toHaveTextContent('Not logged in · Please run /login')
    expect(logItems().some((item) => item.contains(alert))).toBe(true)
    expect(queryStopButton()).not.toBeInTheDocument()
    expect(textbox()).toBeEnabled()
    await sendMessage(user, 'try again')
    await waitFor(() => expect(runs).toHaveLength(2))
    expect(runs[1].request.prompt).toBe('try again')
  })

  it('chat AC13 — the text received before the error stays above it', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)
    await sendMessage(user, 'hello')
    await waitFor(() => expect(runs).toHaveLength(1))

    await runs[0].emit({ type: 'text', text: 'Half an answ' })
    await runs[0].emit({ type: 'error', message: 'Claude Code process exited with code 1. stderr: boom' })
    await runs[0].end()

    expect(itemTexts()).toEqual([
      expect.stringContaining('hello'),
      expect.stringContaining('Half an answ'),
      expect.stringContaining('exited with code 1')
    ])
    expect(within(conversation()!).getAllByRole('alert')).toHaveLength(1)
  })

  it('chat AC13 — a run that cannot even start shows an error with the reason, and the chat is idle again', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)
    api.startRun.mockRejectedValueOnce(new Error('Failed to fetch'))

    await sendMessage(user, 'hello')

    await waitFor(() => expect(within(region('Active chat')).getByRole('alert')).toHaveTextContent('Failed to fetch'))
    expect(logItems().some((item) => item.querySelector('[role="alert"]') !== null || item.getAttribute('role') === 'alert')).toBe(true)
    expect(queryStopButton()).not.toBeInTheDocument()
    expect(sendButton()).toBeInTheDocument()
    await sendMessage(user, 'again')
    await waitFor(() => expect(runs).toHaveLength(1))
    expect(runs[0].request.prompt).toBe('again')
  })

  it('chat AC13 — an error in chat A does not touch chat B, which keeps working', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)
    await sendMessage(user, 'question for A')
    await waitFor(() => expect(runs).toHaveLength(1))
    await createChat(user)
    await sendMessage(user, 'question for B')
    await waitFor(() => expect(runs).toHaveLength(2))

    await runs[0].emit({ type: 'error', message: 'boom in A' })
    await runs[0].end()
    await runs[1].emit({ type: 'text', text: 'answer B' })

    expect(within(conversation()!).queryByRole('alert')).not.toBeInTheDocument()
    expect(itemTexts()).toEqual([expect.stringContaining('question for B'), expect.stringContaining('answer B')])
    expect(stopButton()).toBeInTheDocument()
    await user.click(chatButton('question for A'))
    expect(within(conversation()!).getByRole('alert')).toHaveTextContent('boom in A')
  })
})

describe('CA7 — Artifacts/Diff panel', () => {
  it('CA7 — shows only the empty state, at startup', async () => {
    await renderApp()

    expect(region('Artifacts and diff').textContent).toBe(EMPTY_ARTIFACTS)
  })

  it('CA7 — shows only the empty state after a project change, a chat selection and typing', async () => {
    const user = userEvent.setup()
    await renderApp()

    await user.click(projectButton('borealis'))
    await createChat(user)
    act(() => textbox().focus()) // jsdom + handle: see focusTextarea
    await user.keyboard('hello')

    expect(region('Artifacts and diff').textContent).toBe(EMPTY_ARTIFACTS)
  })
})

describe('AC2 — title bar band', () => {
  it('AC2 — the empty band comes before the 4 regions in DOM order and is inside none of them', async () => {
    render(<App />)
    await settle()

    const band = screen.getByTestId('title-bar')
    const elements = REGION_NAMES.map((name) => region(name))

    for (const element of elements) {
      expect(band.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(element.contains(band)).toBe(false)
      expect(band.contains(element)).toBe(false)
    }
    expect(band).toBeEmptyDOMElement()
  })
})
