import { useRef, useState, type KeyboardEvent } from 'react'
import { ArrowUp, Square, Wrench } from 'lucide-react'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Empty, EmptyTitle } from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { Message, MessageContent } from '@/components/ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '@/components/ui/message-scroller'
import type { Chat, ChatItem } from '@/lib/chats'

interface ActiveChatProps {
  hasProject: boolean
  /** `null` when no chat is selected. */
  chat: Chat | null
  onSend: (text: string) => void
  onStop: () => void
}

function emptyTitle({ hasProject, chat }: ActiveChatProps): string {
  if (!hasProject) return 'Add a project to get started'
  return chat === null ? 'Select or start a chat' : 'No messages yet'
}

function ConversationItem({ item }: { item: ChatItem }) {
  switch (item.type) {
    case 'user':
      return (
        <Message align="end">
          <MessageContent>
            <Bubble align="end">
              <BubbleContent className="whitespace-pre-wrap">{item.text}</BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
      )
    case 'assistant':
      return (
        <Message>
          <MessageContent>
            <Bubble variant="ghost">
              <BubbleContent className="whitespace-pre-wrap">{item.text}</BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
      )
    case 'action':
      return (
        <Marker>
          <MarkerIcon>
            <Wrench />
          </MarkerIcon>
          <MarkerContent>{item.target ? `${item.kind} ${item.target}` : item.kind}</MarkerContent>
        </Marker>
      )
    case 'interrupted':
      return (
        <Marker variant="separator">
          <MarkerContent>Interrupted</MarkerContent>
        </Marker>
      )
    case 'error':
      return (
        <Message>
          <MessageContent>
            <Bubble variant="destructive">
              <BubbleContent role="alert" className="whitespace-pre-wrap">
                {item.message}
              </BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
      )
  }
}

export function ActiveChat(props: ActiveChatProps) {
  const { chat, onSend, onStop } = props
  const [draft, setDraft] = useState('')
  const textarea = useRef<HTMLTextAreaElement>(null)
  const answering = chat?.status === 'answering'
  const canSend = chat !== null && draft.trim() !== ''

  const send = (): void => {
    if (!canSend || answering) return
    onSend(draft.trim())
    setDraft('')
    textarea.current?.focus()
  }

  const onTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    send()
  }

  return (
    <section
      aria-label="Active chat"
      className="flex h-full flex-col gap-2 rounded-xl border bg-card p-2"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && answering) onStop()
      }}
    >
      {chat === null || chat.items.length === 0 ? (
        <Empty>
          <EmptyTitle>{emptyTitle(props)}</EmptyTitle>
        </Empty>
      ) : (
        <MessageScrollerProvider autoScroll>
          <MessageScroller>
            <MessageScrollerViewport>
              <MessageScrollerContent aria-busy={answering}>
                {chat.items.map((item, index) => (
                  <MessageScrollerItem key={index} scrollAnchor={item.type === 'user'}>
                    <ConversationItem item={item} />
                  </MessageScrollerItem>
                ))}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>
      )}
      <InputGroup>
        <InputGroupTextarea
          ref={textarea}
          aria-label="Message"
          disabled={chat === null}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onTextareaKeyDown}
        />
        <InputGroupAddon align="block-end">
          {answering ? (
            <InputGroupButton variant="default" size="icon-sm" aria-label="Stop" className="ml-auto" onClick={onStop}>
              <Square />
            </InputGroupButton>
          ) : (
            <InputGroupButton
              variant="default"
              size="icon-sm"
              aria-label="Send"
              className="ml-auto"
              disabled={!canSend}
              onClick={send}
            >
              <ArrowUp />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </section>
  )
}
