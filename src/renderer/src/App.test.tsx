import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'
import { projects } from './data/projects'

// `CA<n>` refers to the acceptance criteria of docs/features/app-shell.md.
// Assumed contracts (see the technical plan, tasks 5 to 8):
// - `App` is the default export of ./App;
// - `projects` (./data/projects): { name: string; chats: { title: string }[] }[];
// - four regions (role "region") named by aria-label;
// - projects and chats are `button`s; the selected one carries aria-current="true";
// - the send button is a `button` named "Send".

const REGION_NAMES = ['Projects', 'Chat history', 'Active chat', 'Artifacts and diff'] as const

const EMPTY_CHAT = 'No messages yet'
const EMPTY_ARTIFACTS = 'No artifacts or diffs yet'

const region = (name: (typeof REGION_NAMES)[number]): HTMLElement =>
  screen.getByRole('region', { name })

const initialOf = (name: string): string => name.trim().charAt(0).toUpperCase()

const isCurrent = (element: HTMLElement): boolean => element.getAttribute('aria-current') === 'true'

const projectButton = (index: number): HTMLElement =>
  within(region('Projects')).getByRole('button', { name: projects[index].name })

const chatButton = (title: string): HTMLElement =>
  within(region('Chat history')).getByRole('button', { name: title })

const displayedChatTitles = (): string[] =>
  within(region('Chat history'))
    .getAllByRole('button')
    .map((button) => (button.textContent ?? '').trim())

const titlesOf = (index: number): string[] => projects[index].chats.map((chat) => chat.title)

const sorted = (values: string[]): string[] => [...values].sort()

const selectedChatCount = (): number =>
  within(region('Chat history'))
    .getAllByRole('button')
    .filter(isCurrent).length

describe('CA1 — 4-column layout', () => {
  it('CA1 — shows the 4 named regions in DOM order: projects, history, active chat, artifacts', () => {
    render(<App />)

    const elements = REGION_NAMES.map((name) => region(name))

    for (let i = 0; i < elements.length - 1; i++) {
      const position = elements[i].compareDocumentPosition(elements[i + 1])
      expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })
})

describe('CA2 — initial state', () => {
  it('CA2 — the rail shows one button per mock project (3), with its initial', () => {
    render(<App />)

    const buttons = within(region('Projects')).getAllByRole('button')
    expect(buttons).toHaveLength(3)
    projects.forEach((project, index) => {
      expect(projectButton(index)).toHaveTextContent(initialOf(project.name))
      expect(buttons[index]).toBe(projectButton(index))
    })
  })

  it('CA2 — only the first project is selected', () => {
    render(<App />)

    expect(isCurrent(projectButton(0))).toBe(true)
    expect(isCurrent(projectButton(1))).toBe(false)
    expect(isCurrent(projectButton(2))).toBe(false)
  })

  it('CA2 — the history shows exactly the first project\'s chats and none is selected', () => {
    render(<App />)

    expect(sorted(displayedChatTitles())).toEqual(sorted(titlesOf(0)))
    expect(selectedChatCount()).toBe(0)
  })
})

describe('CA3 — switching project', () => {
  it.each([1, 2])(
    'CA3 — clicking project %i selects its icon, shows only its chats, with no chat selected',
    async (target) => {
      const user = userEvent.setup()
      render(<App />)

      // a chat of project 1 is selected before switching project
      await user.click(chatButton(titlesOf(0)[0]))
      expect(selectedChatCount()).toBe(1)

      await user.click(projectButton(target))

      projects.forEach((_, index) => {
        expect(isCurrent(projectButton(index))).toBe(index === target)
      })
      expect(sorted(displayedChatTitles())).toEqual(sorted(titlesOf(target)))
      expect(selectedChatCount()).toBe(0)
    }
  )

  it('CA3 — going back to project 1 shows only its chats again, with no chat selected', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(projectButton(1))
    await user.click(chatButton(titlesOf(1)[0]))
    await user.click(projectButton(0))

    expect(isCurrent(projectButton(0))).toBe(true)
    expect(isCurrent(projectButton(1))).toBe(false)
    expect(sorted(displayedChatTitles())).toEqual(sorted(titlesOf(0)))
    expect(selectedChatCount()).toBe(0)
  })
})

describe('CA4 — selecting a chat', () => {
  it('CA4 — clicking chat A then chat B leaves only B selected', async () => {
    const user = userEvent.setup()
    render(<App />)
    const [titleA, titleB] = titlesOf(0)

    await user.click(chatButton(titleA))
    expect(isCurrent(chatButton(titleA))).toBe(true)
    expect(selectedChatCount()).toBe(1)

    await user.click(chatButton(titleB))
    expect(isCurrent(chatButton(titleB))).toBe(true)
    expect(isCurrent(chatButton(titleA))).toBe(false)
    expect(selectedChatCount()).toBe(1)
  })
})

describe('CA5 — active chat always empty', () => {
  it('CA5 — shows the empty state and no message, whatever the project and chat (or none)', async () => {
    const user = userEvent.setup()
    render(<App />)

    const expectEmptyChat = (): void => {
      const chat = region('Active chat')
      expect(within(chat).getByText(EMPTY_CHAT)).toBeInTheDocument()
      expect(within(chat).queryAllByRole('listitem')).toHaveLength(0)
    }

    expectEmptyChat() // initial state: project 1, no chat
    for (let index = 0; index < projects.length; index++) {
      await user.click(projectButton(index)) // project with no chat selected
      expectEmptyChat()
      for (const title of titlesOf(index)) {
        await user.click(chatButton(title))
        expectEmptyChat()
      }
    }
  })
})

describe('CA6 — input area', () => {
  const sendButton = (): HTMLElement =>
    within(region('Active chat')).getByRole('button', { name: 'Send' })
  const textarea = (): HTMLElement => within(region('Active chat')).getByRole('textbox')

  // jsdom returns null getBoundingClientRect values: the `pointerdown` listener (capture, document)
  // of react-resizable-panels then takes any click inside the group for a click on the handle,
  // focuses the separator and calls preventDefault. `user.type` / `user.click` on the input area
  // would type into the void: we focus it explicitly, then type with the keyboard.
  const focusTextarea = (): void => {
    act(() => textarea().focus())
  }
  const typeInTextarea = async (user: ReturnType<typeof userEvent.setup>, text: string): Promise<void> => {
    focusTextarea()
    await user.keyboard(text)
  }

  it('CA6 — the typed text shows in the area and the Send button is disabled', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(sendButton()).toBeDisabled()
    await typeInTextarea(user, 'hello')

    expect(textarea()).toHaveValue('hello')
    expect(sendButton()).toBeDisabled()
  })

  it('CA6 — the Enter key inserts a line break in the area', async () => {
    const user = userEvent.setup()
    render(<App />)

    await typeInTextarea(user, 'hello{Enter}world')

    expect(textarea()).toHaveValue('hello\nworld')
  })

  it('CA6 — neither a click on Send nor Enter adds a message or clears the area', async () => {
    const user = userEvent.setup()
    render(<App />)
    await typeInTextarea(user, 'hello')

    await user.click(sendButton())
    expect(textarea()).toHaveValue('hello')
    expect(sendButton()).toBeDisabled()

    focusTextarea() // the click on Send may have moved the focus
    await user.keyboard('{Enter}')
    // Enter sends nothing: the area keeps "hello" (at most followed by a line break)
    expect((textarea() as HTMLTextAreaElement).value.startsWith('hello')).toBe(true)

    const chat = region('Active chat')
    expect(within(chat).getByText(EMPTY_CHAT)).toBeInTheDocument()
    expect(within(chat).queryAllByRole('listitem')).toHaveLength(0)
    expect(within(chat).queryByText('hello')).not.toBeInTheDocument()
  })
})

describe('CA7 — Artifacts/Diff panel', () => {
  it('CA7 — shows only the empty state, at startup', () => {
    render(<App />)

    expect(region('Artifacts and diff').textContent).toBe(EMPTY_ARTIFACTS)
  })

  it('CA7 — shows only the empty state after a project change, a chat selection and typing', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(projectButton(1))
    await user.click(chatButton(titlesOf(1)[0]))
    act(() => within(region('Active chat')).getByRole('textbox').focus()) // see CA6: jsdom + handle
    await user.keyboard('hello')

    expect(region('Artifacts and diff').textContent).toBe(EMPTY_ARTIFACTS)
  })
})
