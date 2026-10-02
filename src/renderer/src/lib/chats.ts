import type { AgentEvent } from '../../../shared/chat'

export type ChatItem =
  | { type: 'user'; text: string }
  | { type: 'assistant'; text: string }
  | { type: 'action'; kind: string; target: string }
  | { type: 'interrupted' }
  | { type: 'error'; message: string }

export interface Chat {
  id: string
  title: string
  permissionMode: string
  sessionId?: string
  status: 'idle' | 'answering'
  items: ChatItem[]
}

/** The chats of each project, keyed by project path, the most recent first. */
export type ChatsState = Record<string, Chat[]>

export type ChatsAction =
  | { type: 'create'; projectPath: string; chatId: string; permissionMode: string }
  | { type: 'send'; projectPath: string; chatId: string; text: string }
  | { type: 'event'; projectPath: string; chatId: string; event: AgentEvent }

const firstLine = (text: string): string =>
  text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '') ?? ''

/** What one agent event changes in its chat. */
function applyEvent(chat: Chat, event: AgentEvent): Chat {
  switch (event.type) {
    case 'session':
      return { ...chat, sessionId: event.sessionId }
    case 'text': {
      const last = chat.items.at(-1)
      const items: ChatItem[] =
        last?.type === 'assistant'
          ? [...chat.items.slice(0, -1), { type: 'assistant', text: last.text + event.text }]
          : [...chat.items, { type: 'assistant', text: event.text }]
      return { ...chat, items }
    }
    case 'action':
      return { ...chat, items: [...chat.items, { type: 'action', kind: event.kind, target: event.target }] }
    case 'error':
      return { ...chat, items: [...chat.items, { type: 'error', message: event.message }] }
    case 'end':
      return {
        ...chat,
        status: 'idle',
        items: event.interrupted ? [...chat.items, { type: 'interrupted' }] : chat.items
      }
  }
}

/** Applies `change` to one chat; every other chat keeps the same object. An unknown chat leaves the state as it is. */
function updateChat(state: ChatsState, projectPath: string, chatId: string, change: (chat: Chat) => Chat): ChatsState {
  const chats = state[projectPath]
  if (!chats?.some((chat) => chat.id === chatId)) return state
  return { ...state, [projectPath]: chats.map((chat) => (chat.id === chatId ? change(chat) : chat)) }
}

export function chatsReducer(state: ChatsState, action: ChatsAction): ChatsState {
  switch (action.type) {
    case 'create': {
      const chat: Chat = {
        id: action.chatId,
        title: 'New chat',
        permissionMode: action.permissionMode,
        status: 'idle',
        items: []
      }
      return { ...state, [action.projectPath]: [chat, ...(state[action.projectPath] ?? [])] }
    }
    case 'send':
      return updateChat(state, action.projectPath, action.chatId, (chat) => ({
        ...chat,
        title: chat.items.some((item) => item.type === 'user') ? chat.title : firstLine(action.text),
        status: 'answering',
        items: [...chat.items, { type: 'user', text: action.text }]
      }))
    case 'event':
      return updateChat(state, action.projectPath, action.chatId, (chat) => applyEvent(chat, action.event))
  }
}
