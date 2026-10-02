import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../../shared/chat'
import { chatsReducer, type ChatsState } from './chats'

// `chat AC<n>` refers to the acceptance criteria of docs/features/claude-code-chat.md.
//
// Contracts these tests rely on (src/renderer/src/lib/chats.ts), stories 1 and 2 (`create`, `send`, `event`):
// - `type ChatsState = Record<string, Chat[]>`: the chats of each project, keyed by project path,
//   the most recent first;
// - `chatsReducer(state: ChatsState, action: ChatsAction): ChatsState`, pure: it never mutates `state`;
// - `{ type: 'create'; projectPath: string; chatId: string; permissionMode: string }`
//   inserts at the top of `state[projectPath]` a chat
//   `{ id: chatId, title: 'New chat', permissionMode, status: 'idle', items: [] }` with no `sessionId`.
//   The id is made by the caller so that the reducer stays pure; `permissionMode` is the
//   `AgentInfo.defaultPermissionMode` ('plan' for Claude Code);
// - the empty state is `{}`: a project with no chat has no key, or an empty list.
// Story 2. `ChatsAction` is a union; every new action names its chat by `projectPath` and `chatId`, and
// is ignored (state unchanged in value) when no such chat exists:
// - `{ type: 'send'; projectPath; chatId; text }`: appends the item `{ type: 'user', text }` (the text as
//   given), sets `status: 'answering'`; when the chat has no user item yet (its first message), the title
//   becomes the first non-empty line of `text`, trimmed. Later messages leave the title alone;
// - `{ type: 'event'; projectPath; chatId; event: AgentEvent }` (the events of src/shared/chat.ts):
//   - `session`: sets `sessionId` (kept by later `send` actions);
//   - `text`: appends `text` to the last item when it is an `assistant` item; otherwise (after a user,
//     action, interrupted or error item, or in an empty chat) adds a new `{ type: 'assistant', text }` item;
//   - `action`: adds `{ type: 'action', kind, target }`;
//   - `error`: adds `{ type: 'error', message }`;
//   - `end`: `status` becomes 'idle'; with `interrupted: true` it also adds `{ type: 'interrupted' }`;
// - both only change the targeted chat: the other chats and projects keep the same objects.

const create = (projectPath: string, chatId: string, permissionMode = 'plan') =>
  ({ type: 'create', projectPath, chatId, permissionMode }) as const

describe('chatsReducer — create', () => {
  it('chat AC4 — creates a chat titled "New chat", empty, idle, with the given permission mode', () => {
    const state = chatsReducer({}, create('/work/atlas', 'c1', 'plan'))

    expect(state['/work/atlas']).toHaveLength(1)
    const chat = state['/work/atlas'][0]
    expect(chat).toMatchObject({
      id: 'c1',
      title: 'New chat',
      permissionMode: 'plan',
      status: 'idle',
      items: []
    })
    expect(chat.sessionId).toBeUndefined()
  })

  it('chat AC4 — uses the permission mode it is given, not a fixed one', () => {
    const state = chatsReducer({}, create('/work/atlas', 'c1', 'acceptEdits'))

    expect(state['/work/atlas'][0].permissionMode).toBe('acceptEdits')
  })

  it('chat AC4 — a new chat goes at the top of the project list', () => {
    let state = chatsReducer({}, create('/work/atlas', 'c1'))
    state = chatsReducer(state, create('/work/atlas', 'c2'))
    state = chatsReducer(state, create('/work/atlas', 'c3'))

    expect(state['/work/atlas'].map((chat) => chat.id)).toEqual(['c3', 'c2', 'c1'])
  })

  it('chat AC4 — every chat starts with its own title and empty items', () => {
    let state = chatsReducer({}, create('/work/atlas', 'c1'))
    state = chatsReducer(state, create('/work/atlas', 'c2'))

    for (const chat of state['/work/atlas']) {
      expect(chat.title).toBe('New chat')
      expect(chat.items).toEqual([])
    }
  })

  it('chat AC4 — creating a chat in one project leaves the other projects alone', () => {
    let state = chatsReducer({}, create('/work/atlas', 'a1'))
    state = chatsReducer(state, create('/work/borealis', 'b1'))
    const before = state

    state = chatsReducer(state, create('/work/atlas', 'a2'))

    expect(state['/work/atlas'].map((chat) => chat.id)).toEqual(['a2', 'a1'])
    expect(state['/work/borealis']).toBe(before['/work/borealis'])
    expect(state['/work/borealis'].map((chat) => chat.id)).toEqual(['b1'])
  })

  it('chat AC4 — does not mutate the state it receives', () => {
    const initial = chatsReducer({}, create('/work/atlas', 'c1'))
    const snapshot = JSON.parse(JSON.stringify(initial))

    const next = chatsReducer(initial, create('/work/atlas', 'c2'))

    expect(next).not.toBe(initial)
    expect(initial).toEqual(snapshot)
    expect(initial['/work/atlas']).toHaveLength(1)
  })
})

// --- Story 2: send and event ---
const send = (projectPath: string, chatId: string, text: string) => ({ type: 'send', projectPath, chatId, text }) as const
const event = (projectPath: string, chatId: string, e: AgentEvent) => ({ type: 'event', projectPath, chatId, event: e }) as const

const ATLAS = '/work/atlas'

/** A state with one chat `c1` in /work/atlas. */
const withChat = (): ChatsState => chatsReducer({}, create(ATLAS, 'c1'))
const chatOf = (state: ChatsState, id = 'c1') => state[ATLAS].find((chat) => chat.id === id)!

const apply = (state: ChatsState, ...actions: Parameters<typeof chatsReducer>[1][]): ChatsState =>
  actions.reduce(chatsReducer, state)

describe('chatsReducer — send', () => {
  it('chat AC5 — adds the user message as an item and marks the chat as answering', () => {
    const state = chatsReducer(withChat(), send(ATLAS, 'c1', 'hello'))

    expect(chatOf(state).items).toEqual([{ type: 'user', text: 'hello' }])
    expect(chatOf(state).status).toBe('answering')
  })

  it('chat AC5 — keeps the text as it was typed, line breaks included', () => {
    const state = chatsReducer(withChat(), send(ATLAS, 'c1', 'first\nsecond'))

    expect(chatOf(state).items).toEqual([{ type: 'user', text: 'first\nsecond' }])
  })

  it('chat AC4 — the first message gives the title: its first line', () => {
    const state = chatsReducer(withChat(), send(ATLAS, 'c1', 'Fix the login bug\nit crashes on submit'))

    expect(chatOf(state).title).toBe('Fix the login bug')
  })

  it('chat AC4 — the title is the first non-empty line, trimmed', () => {
    const state = chatsReducer(withChat(), send(ATLAS, 'c1', '\n  \n   hello world  \nsecond line'))

    expect(chatOf(state).title).toBe('hello world')
  })

  it('chat AC4 — the title is "New chat" until the first message is sent', () => {
    const state = withChat()

    expect(chatOf(state).title).toBe('New chat')
    expect(chatOf(chatsReducer(state, send(ATLAS, 'c1', 'hi'))).title).toBe('hi')
  })

  it('chat AC4 — a later message does not change the title', () => {
    const state = apply(
      withChat(),
      send(ATLAS, 'c1', 'first message'),
      event(ATLAS, 'c1', { type: 'end', interrupted: false }),
      send(ATLAS, 'c1', 'second message')
    )

    expect(chatOf(state).title).toBe('first message')
    expect(chatOf(state).items.filter((item) => item.type === 'user')).toHaveLength(2)
  })

  it('chat AC4 — the title is set by the first message even when its run failed', () => {
    const state = apply(
      withChat(),
      send(ATLAS, 'c1', 'first message'),
      event(ATLAS, 'c1', { type: 'error', message: 'boom' }),
      event(ATLAS, 'c1', { type: 'end', interrupted: false }),
      send(ATLAS, 'c1', 'try again')
    )

    expect(chatOf(state).title).toBe('first message')
  })

  it('chat AC6 — the session of the chat is kept when another message is sent', () => {
    const state = apply(
      withChat(),
      send(ATLAS, 'c1', 'one'),
      event(ATLAS, 'c1', { type: 'session', sessionId: 'session-1' }),
      event(ATLAS, 'c1', { type: 'end', interrupted: false }),
      send(ATLAS, 'c1', 'two')
    )

    expect(chatOf(state).sessionId).toBe('session-1')
  })

  it('chat AC12 — only the targeted chat changes: the other chats and projects keep the same objects', () => {
    let state = apply(
      {},
      create(ATLAS, 'c1'),
      create(ATLAS, 'c2'),
      create('/work/borealis', 'b1')
    )
    const before = state

    state = chatsReducer(state, send(ATLAS, 'c1', 'hello'))

    expect(chatOf(state, 'c1').items).toHaveLength(1)
    expect(chatOf(state, 'c2')).toBe(chatOf(before, 'c2'))
    expect(state['/work/borealis']).toBe(before['/work/borealis'])
    expect(state[ATLAS].map((chat) => chat.id)).toEqual(['c2', 'c1'])
  })

  it('chat AC5 — does not mutate the state it receives, and ignores an unknown chat', () => {
    const initial = withChat()
    const snapshot = JSON.parse(JSON.stringify(initial))

    const next = chatsReducer(initial, send(ATLAS, 'c1', 'hello'))
    const unknown = chatsReducer(initial, send(ATLAS, 'nope', 'hello'))

    expect(next).not.toBe(initial)
    expect(initial).toEqual(snapshot)
    expect(unknown).toEqual(snapshot)
  })
})

describe('chatsReducer — event', () => {
  const sent = (): ChatsState => chatsReducer(withChat(), send(ATLAS, 'c1', 'hello'))
  const text = (t: string) => event(ATLAS, 'c1', { type: 'text', text: t })

  it('chat AC5 — text events grow one reply: each text is appended to the last assistant item', () => {
    const state = apply(sent(), text('Hel'), text('lo, '), text('world'))

    expect(chatOf(state).items).toEqual([
      { type: 'user', text: 'hello' },
      { type: 'assistant', text: 'Hello, world' }
    ])
  })

  it('chat AC5 — text keeps its own line breaks', () => {
    const state = apply(sent(), text('one\n'), text('two'))

    expect(chatOf(state).items[1]).toEqual({ type: 'assistant', text: 'one\ntwo' })
  })

  it('chat AC7 — an action is one item, in order with the text; the text after it starts a new reply', () => {
    const state = apply(
      sent(),
      text('Let me look.'),
      event(ATLAS, 'c1', { type: 'action', kind: 'Read', target: 'README.md' }),
      text('Now '),
      text('the change.'),
      event(ATLAS, 'c1', { type: 'action', kind: 'Edit', target: 'src/index.ts' }),
      event(ATLAS, 'c1', { type: 'action', kind: 'Bash', target: 'npm test' }),
      text('Done.')
    )

    expect(chatOf(state).items).toEqual([
      { type: 'user', text: 'hello' },
      { type: 'assistant', text: 'Let me look.' },
      { type: 'action', kind: 'Read', target: 'README.md' },
      { type: 'assistant', text: 'Now the change.' },
      { type: 'action', kind: 'Edit', target: 'src/index.ts' },
      { type: 'action', kind: 'Bash', target: 'npm test' },
      { type: 'assistant', text: 'Done.' }
    ])
  })

  it('chat AC5 — the reply of a second message does not extend the reply of the first one', () => {
    const state = apply(
      sent(),
      text('First reply.'),
      event(ATLAS, 'c1', { type: 'end', interrupted: false }),
      send(ATLAS, 'c1', 'again'),
      text('Second reply.')
    )

    expect(chatOf(state).items).toEqual([
      { type: 'user', text: 'hello' },
      { type: 'assistant', text: 'First reply.' },
      { type: 'user', text: 'again' },
      { type: 'assistant', text: 'Second reply.' }
    ])
  })

  it('chat AC6 — the session event sets the session id of the chat, and adds no item', () => {
    const state = apply(sent(), event(ATLAS, 'c1', { type: 'session', sessionId: 'session-1' }))

    expect(chatOf(state).sessionId).toBe('session-1')
    expect(chatOf(state).items).toHaveLength(1)
  })

  it('chat AC6 — a chat has no session until its run gives one', () => {
    expect(chatOf(sent()).items).toHaveLength(1)
    expect(chatOf(sent()).sessionId).toBeUndefined()
  })

  it('chat AC5 — the end event makes the chat idle again, and adds no item when not interrupted', () => {
    const state = apply(sent(), text('Hi.'), event(ATLAS, 'c1', { type: 'end', interrupted: false }))

    expect(chatOf(state).status).toBe('idle')
    expect(chatOf(state).items).toHaveLength(2)
  })

  it('chat AC11 — an interrupted end keeps what was received and adds an "interrupted" item', () => {
    const state = apply(sent(), text('Partial'), event(ATLAS, 'c1', { type: 'end', interrupted: true }))

    expect(chatOf(state).status).toBe('idle')
    expect(chatOf(state).items).toEqual([
      { type: 'user', text: 'hello' },
      { type: 'assistant', text: 'Partial' },
      { type: 'interrupted' }
    ])
  })

  it('chat AC11 — after an interrupted run, a new message starts a new reply below the "interrupted" item', () => {
    const state = apply(
      sent(),
      text('Partial'),
      event(ATLAS, 'c1', { type: 'end', interrupted: true }),
      send(ATLAS, 'c1', 'next'),
      text('Fresh')
    )

    expect(chatOf(state).status).toBe('answering')
    expect(chatOf(state).items.slice(-3)).toEqual([
      { type: 'interrupted' },
      { type: 'user', text: 'next' },
      { type: 'assistant', text: 'Fresh' }
    ])
  })

  it('chat AC13 — an error event adds an error item, and the end brings the chat back to idle', () => {
    const state = apply(
      sent(),
      event(ATLAS, 'c1', { type: 'error', message: 'Not logged in · Please run /login' }),
      event(ATLAS, 'c1', { type: 'end', interrupted: false })
    )

    expect(chatOf(state).items).toEqual([
      { type: 'user', text: 'hello' },
      { type: 'error', message: 'Not logged in · Please run /login' }
    ])
    expect(chatOf(state).status).toBe('idle')
  })

  it('chat AC13 — the text received before an error stays, the error comes after it', () => {
    const state = apply(sent(), text('Half an answ'), event(ATLAS, 'c1', { type: 'error', message: 'boom' }))

    expect(chatOf(state).items.map((item) => item.type)).toEqual(['user', 'assistant', 'error'])
  })

  it('chat AC12 — an event for chat A leaves chat B alone, whichever chat is shown', () => {
    let state = apply({}, create(ATLAS, 'a'), create(ATLAS, 'b'), send(ATLAS, 'a', 'for A'), send(ATLAS, 'b', 'for B'))
    const before = state

    state = apply(
      state,
      event(ATLAS, 'a', { type: 'session', sessionId: 'sa' }),
      event(ATLAS, 'a', { type: 'text', text: 'answer A' })
    )

    expect(chatOf(state, 'a').items).toEqual([
      { type: 'user', text: 'for A' },
      { type: 'assistant', text: 'answer A' }
    ])
    expect(chatOf(state, 'a').sessionId).toBe('sa')
    expect(chatOf(state, 'b')).toBe(chatOf(before, 'b'))
    expect(chatOf(state, 'b').sessionId).toBeUndefined()
  })

  it('chat AC12 — a chat can end while another is still answering: statuses are per chat', () => {
    const state = apply(
      {},
      create(ATLAS, 'a'),
      create(ATLAS, 'b'),
      send(ATLAS, 'a', 'one'),
      send(ATLAS, 'b', 'two'),
      event(ATLAS, 'b', { type: 'end', interrupted: false })
    )

    expect(chatOf(state, 'a').status).toBe('answering')
    expect(chatOf(state, 'b').status).toBe('idle')
  })

  it('chat AC5 — does not mutate the state it receives, and ignores an unknown chat or project', () => {
    const initial = sent()
    const snapshot = JSON.parse(JSON.stringify(initial))

    const next = chatsReducer(initial, text('Hi'))
    const unknownChat = chatsReducer(initial, event(ATLAS, 'nope', { type: 'text', text: 'x' }))
    const unknownProject = chatsReducer(initial, event('/work/elsewhere', 'c1', { type: 'text', text: 'x' }))

    expect(next).not.toBe(initial)
    expect(initial).toEqual(snapshot)
    expect(unknownChat).toEqual(snapshot)
    expect(unknownProject).toEqual(snapshot)
  })
})
