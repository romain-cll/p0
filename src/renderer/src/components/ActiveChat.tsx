import { ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyTitle } from '@/components/ui/empty'
import { Textarea } from '@/components/ui/textarea'
import type { Chat } from '@/lib/chats'

interface ActiveChatProps {
  hasProject: boolean
  /** `null` when no chat is selected. */
  chat: Chat | null
}

function emptyTitle({ hasProject, chat }: ActiveChatProps): string {
  if (!hasProject) return 'Add a project to get started'
  return chat === null ? 'Select or start a chat' : 'No messages yet'
}

export function ActiveChat(props: ActiveChatProps) {
  return (
    <section
      aria-label="Active chat"
      className="flex h-full flex-col gap-2 rounded-xl border bg-card p-2"
    >
      <Empty>
        <EmptyTitle>{emptyTitle(props)}</EmptyTitle>
      </Empty>
      <div className="flex items-end gap-2">
        <Textarea aria-label="Message" disabled={props.chat === null} />
        <Button size="icon-lg" aria-label="Send" disabled>
          <ArrowUp />
        </Button>
      </div>
    </section>
  )
}
