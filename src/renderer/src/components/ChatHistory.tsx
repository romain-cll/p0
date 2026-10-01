import { Button } from '@/components/ui/button'
import type { Chat } from '@/data/projects'

interface ChatHistoryProps {
  chats: Chat[]
  selectedIndex: number | null
  onSelect: (index: number) => void
}

export function ChatHistory({ chats, selectedIndex, onSelect }: ChatHistoryProps) {
  return (
    <section
      aria-label="Chat history"
      className="flex w-60 shrink-0 flex-col gap-2 overflow-y-auto rounded-xl border bg-card p-2"
    >
      {chats.map((chat, index) => (
        <Button
          key={chat.title}
          variant="ghost"
          aria-current={index === selectedIndex ? 'true' : undefined}
          className="w-full justify-start overflow-hidden aria-[current=true]:bg-muted"
          onClick={() => onSelect(index)}
        >
          <span className="truncate">{chat.title}</span>
        </Button>
      ))}
    </section>
  )
}
