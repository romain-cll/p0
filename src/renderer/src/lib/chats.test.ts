import { describe, expect, it } from 'vitest'
import { chatsReducer } from './chats'

// `chat AC<n>` refers to the acceptance criteria of docs/features/claude-code-chat.md.
//
// Contracts these tests rely on (src/renderer/src/lib/chats.ts), story 1 only (the `create` action):
// - `type ChatsState = Record<string, Chat[]>`: the chats of each project, keyed by project path,
//   the most recent first;
// - `chatsReducer(state: ChatsState, action: ChatsAction): ChatsState`, pure: it never mutates `state`;
// - `{ type: 'create'; projectPath: string; chatId: string; permissionMode: string }`
//   inserts at the top of `state[projectPath]` a chat
//   `{ id: chatId, title: 'New chat', permissionMode, status: 'idle', items: [] }` with no `sessionId`.
//   The id is made by the caller so that the reducer stays pure; `permissionMode` is the
//   `AgentInfo.defaultPermissionMode` ('plan' for Claude Code);
// - the empty state is `{}`: a project with no chat has no key, or an empty list.

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
