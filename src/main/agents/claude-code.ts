import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, isAbsolute, join, relative } from 'node:path'
import {
  query as sdkQuery,
  type Options,
  type PermissionMode,
  type SDKMessage,
  type SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent } from '../../shared/chat'
import type { AgentAdapter } from './agent'

const NOT_FOUND = 'Claude Code CLI not found. Install it, then send again.'
const STOP_GRACE_MS = 5_000

// A fixed list: the SDK has no call that lists the modes. `satisfies` makes an SDK upgrade that drops one fail the typecheck.
const PERMISSION_MODES = [
  { value: 'plan', label: 'Plan' },
  { value: 'acceptEdits', label: 'Accept edits' },
  { value: 'auto', label: 'Auto' },
  { value: 'dontAsk', label: "Don't ask" },
  { value: 'bypassPermissions', label: 'Bypass permissions' }
] satisfies { value: PermissionMode; label: string }[]

/** The first executable file named `claude` in `PATH`, or `undefined`. */
function findClaude(): string | undefined {
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    if (!dir) continue
    const file = join(dir, 'claude')
    try {
      if (!statSync(file).isFile()) continue
      accessSync(file, constants.X_OK)
      return file
    } catch {
      // not there, or not executable: keep looking
    }
  }
  return undefined
}

const nonEmpty = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

/** What an action line shows: the file (relative to the project when inside it), the command, or the search. */
function targetOf(input: Record<string, unknown>, cwd: string): string {
  const file = nonEmpty(input['file_path']) ?? nonEmpty(input['notebook_path'])
  if (file) {
    const path = relative(cwd, file)
    return path === '' || path.startsWith('..') || isAbsolute(path) ? file : path
  }
  const command = nonEmpty(input['command'])
  if (command) return command.split('\n')[0]
  return nonEmpty(input['pattern']) ?? nonEmpty(input['url']) ?? nonEmpty(input['query']) ?? ''
}

/** Translates one SDK message into the text and action events it carries. */
export function toAgentEvents(message: SDKMessage, cwd: string): AgentEvent[] {
  if (message.type === 'stream_event') {
    const { event } = message
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta' && event.delta.text !== '') {
      return [{ type: 'text', text: event.delta.text }]
    }
    return []
  }
  if (message.type === 'assistant') {
    return message.message.content.flatMap((block): AgentEvent[] =>
      block.type === 'tool_use'
        ? [{ type: 'action', kind: block.name, target: targetOf(block.input as Record<string, unknown>, cwd) }]
        : []
    )
  }
  return []
}

/** The text of an error message: Claude Code's own words. */
function errorText(message: SDKMessage): string | undefined {
  if (message.type === 'assistant' && message.error) {
    const text = message.message.content.flatMap((block) => (block.type === 'text' ? [block.text] : []))
    return text.join('\n') || message.error
  }
  if (message.type === 'result' && message.is_error) {
    return 'result' in message ? message.result : message.errors.join('\n')
  }
  return undefined
}

function thrownText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return /^Claude Code (native binary|executable) not found/.test(text) ? NOT_FOUND : text
}

export function createClaudeCodeAdapter({ query = sdkQuery }: { query?: typeof sdkQuery } = {}): AgentAdapter {
  return {
    permissionModes: PERMISSION_MODES,
    defaultPermissionMode: 'plan',
    start({ cwd, prompt, permissionMode, sessionId: resume }, emit) {
      let ended = false
      let stopped = false
      let failed = false
      const send = (event: AgentEvent): void => {
        if (ended) return
        ended = event.type === 'end'
        emit(event)
      }
      // Claude Code often reports one failure several times (assistant message, result, thrown error): once is enough.
      // After a stop, the interruption itself is reported as an error: it is not one.
      const fail = (message: string): void => {
        if (failed || stopped) return
        failed = true
        send({ type: 'error', message })
      }

      const executable = findClaude()
      if (!executable) {
        fail(NOT_FOUND)
        send({ type: 'end', interrupted: false })
        return { stop() {} }
      }

      // Streaming input mode is what makes `interrupt()` available. The input stays open until the turn's
      // `result`, then ends so that the CLI exits.
      let turnDone!: () => void
      const turn = new Promise<void>((resolve) => (turnDone = resolve))
      async function* input(): AsyncGenerator<SDKUserMessage> {
        yield { type: 'user', message: { role: 'user', content: prompt }, parent_tool_use_id: null }
        await turn
      }

      const options: Options = {
        cwd,
        pathToClaudeCodeExecutable: executable,
        ...(resume ? { resume } : {}),
        permissionMode: permissionMode as PermissionMode,
        ...(permissionMode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
        permissionPrompts: 'none',
        includePartialMessages: true,
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        ...(permissionMode === 'plan' ? { settings: { useAutoModeDuringPlan: false } } : {})
      }
      const run = query({ prompt: input(), options })

      let closeTimer: ReturnType<typeof setTimeout> | undefined
      void (async () => {
        let sessionId: string | undefined
        let sessionSent = false
        try {
          for await (const message of run) {
            if (message.type === 'system' && message.subtype === 'init') sessionId = message.session_id
            if (message.type === 'result') turnDone()

            const error = errorText(message)
            if (error !== undefined) fail(error)
            else if (
              sessionId &&
              !sessionSent &&
              (message.type === 'stream_event' || message.type === 'assistant')
            ) {
              sessionSent = true
              send({ type: 'session', sessionId })
            }
            for (const event of toAgentEvents(message, cwd)) send(event)
          }
        } catch (error) {
          fail(thrownText(error))
        } finally {
          clearTimeout(closeTimer)
          turnDone()
          send({ type: 'end', interrupted: stopped })
        }
      })()

      return {
        stop() {
          if (stopped || ended) return
          stopped = true
          closeTimer = setTimeout(() => run.close(), STOP_GRACE_MS)
          run.interrupt().catch(() => run.close())
        }
      }
    }
  }
}
