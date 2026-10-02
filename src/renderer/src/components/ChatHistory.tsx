import { Button } from '@/components/ui/button'
import { Empty, EmptyTitle } from '@/components/ui/empty'
import type { Chat } from '@/lib/chats'

interface ChatHistoryProps {
  /** `null` when there is no project. */
  chats: Chat[] | null
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
}

export function ChatHistory({ chats, selectedId, onSelect, onCreate }: ChatHistoryProps) {
  return (
    <section
      aria-label="Chat history"
      className="flex w-60 shrink-0 flex-col gap-2 overflow-y-auto rounded-xl border bg-card p-2"
    >
      {chats === null ? (
        <Empty>
          <EmptyTitle>Add a project to get started</EmptyTitle>
        </Empty>
      ) : (
        <>
          <Button variant="outline" className="w-full" onClick={onCreate}>
            New chat
          </Button>
          {chats.map((chat) => (
            <Button
              key={chat.id}
              variant="ghost"
              aria-current={chat.id === selectedId ? 'true' : undefined}
              className="w-full justify-start overflow-hidden aria-[current=true]:bg-muted"
              onClick={() => onSelect(chat.id)}
            >
              <span className="truncate">{chat.title}</span>
            </Button>
          ))}
        </>
      )}
    </section>
  )
}
