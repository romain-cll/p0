import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

// `CA<n>` refers to the acceptance criteria of docs/features/app-shell.md.
// `AC<n>` refers to the acceptance criteria of docs/features/hidden-titlebar.md.
// `chat AC<n>` refers to the acceptance criteria of docs/features/claude-code-chat.md (story 1).
//
// Contracts these tests rely on (see the technical plan of claude-code-chat, story 1, tasks 5 and 6):
// - `App` is the default export of ./App. On mount it calls `listProjects()` of `@/lib/api`, then
//   selects the first project. `@/lib/api` is the only thing mocked (it is the process frontier).
//   `getAgent`, `startRun` and `stopRun` are mocked too; story 1 does not need them.
// - four regions (role "region") named by aria-label;
// - the "Projects" region holds one `button` per project, in the order of `listProjects()`, then the
//   "+" `button` whose accessible name is "Add project", last. A project button is named after the
//   project (`name`) and its text is the uppercase initial; the selected one carries aria-current="true".
//   Clicking "Add project" calls `addProject()` of `@/lib/api`; the answer's `selected` is the path
//   of the project to select (null: nothing changes).
// - the "Chat history" region: its first `button` is the creation button named "New chat"
//   (never aria-current); the buttons after it are the chats, newest first, each with its title as
//   text and aria-current="true" when selected. With no project it shows "Add a project to get started".
// - the "Active chat" region shows, in this order of precedence:
//   "Add a project to get started" (no project), "Select or start a chat" (project, no chat; the
//   "Message" textbox is then disabled), "No messages yet" (a chat with no message).
//   The send button is a `button` named "Send", still always disabled in story 1.
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
  api.startRun.mockResolvedValue(undefined)
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
    expect(textbox()).toBeDisabled()
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
    expect(chat.queryAllByRole('listitem')).toHaveLength(0)
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

describe('CA6 — input area', () => {
  // Setup changed: with no chat selected the input is disabled (chat AC4), so each test first
  // creates a chat with "New chat". The assertions are those of the app-shell spec: the send button
  // is still always disabled in story 1, and Enter inserts a line break.
  const sendButton = (): HTMLElement =>
    within(region('Active chat')).getByRole('button', { name: 'Send' })

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
  const renderWithChat = async (user: User): Promise<void> => {
    await renderApp()
    await createChat(user)
  }

  it('CA6 — the typed text shows in the area and the Send button is disabled', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)

    expect(sendButton()).toBeDisabled()
    await typeInTextarea(user, 'hello')

    expect(textbox()).toHaveValue('hello')
    expect(sendButton()).toBeDisabled()
  })

  it('CA6 — the Enter key inserts a line break in the area', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)

    await typeInTextarea(user, 'hello{Enter}world')

    expect(textbox()).toHaveValue('hello\nworld')
  })

  it('CA6 — neither a click on Send nor Enter adds a message or clears the area', async () => {
    const user = userEvent.setup()
    await renderWithChat(user)
    await typeInTextarea(user, 'hello')

    await user.click(sendButton())
    expect(textbox()).toHaveValue('hello')
    expect(sendButton()).toBeDisabled()

    focusTextarea() // the click on Send may have moved the focus
    await user.keyboard('{Enter}')
    // Enter sends nothing: the area keeps "hello" (at most followed by a line break)
    expect((textbox() as HTMLTextAreaElement).value.startsWith('hello')).toBe(true)

    const chat = region('Active chat')
    expect(within(chat).getByText(EMPTY_CHAT)).toBeInTheDocument()
    expect(within(chat).queryAllByRole('listitem')).toHaveLength(0)
    expect(within(chat).queryByText('hello')).not.toBeInTheDocument()
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
    act(() => textbox().focus()) // see CA6: jsdom + handle
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
