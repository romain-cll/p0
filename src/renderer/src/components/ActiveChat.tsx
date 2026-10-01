import { ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

export function ActiveChat() {
  return (
    <section
      aria-label="Chat actif"
      className="flex h-full flex-col gap-2 rounded-xl border bg-card p-2"
    >
      <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Aucun message pour l'instant
      </p>
      <div className="flex items-end gap-2">
        <Textarea aria-label="Message" />
        <Button size="icon-lg" aria-label="Envoyer" disabled>
          <ArrowUp />
        </Button>
      </div>
    </section>
  )
}
