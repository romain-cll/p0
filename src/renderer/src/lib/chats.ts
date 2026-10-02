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

export type ChatsAction = {
  type: 'create'
  projectPath: string
  chatId: string
  permissionMode: string
}

export function chatsReducer(state: ChatsState, action: ChatsAction): ChatsState {
  const chat: Chat = {
    id: action.chatId,
    title: 'New chat',
    permissionMode: action.permissionMode,
    status: 'idle',
    items: []
  }
  return { ...state, [action.projectPath]: [chat, ...(state[action.projectPath] ?? [])] }
}
