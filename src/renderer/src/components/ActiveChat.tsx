import { ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

export function ActiveChat() {
  return (
    <section
      aria-label="Active chat"
      className="flex h-full flex-col gap-2 rounded-xl border bg-card p-2"
    >
      <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        No messages yet
      </p>
      <div className="flex items-end gap-2">
        <Textarea aria-label="Message" />
        <Button size="icon-lg" aria-label="Send" disabled>
          <ArrowUp />
        </Button>
      </div>
    </section>
  )
}
