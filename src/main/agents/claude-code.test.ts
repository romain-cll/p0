// @vitest-environment node
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { query as fakeSdkQuery } from '../../../e2e/fake-sdk/query.mjs'
import type { AgentEvent } from '../../shared/chat'
import type { AgentRun } from './agent'
import { createClaudeCodeAdapter, toAgentEvents } from './claude-code'

// `chat AC<n>` refers to the acceptance criteria of docs/features/claude-code-chat.md (story 2).
//
// Contracts these tests rely on (src/main/agents/claude-code.ts, technical plan "Files" and the
// S1 results of the Decisions):
// - `createClaudeCodeAdapter({ query })` returns an `AgentAdapter` (./agent.ts). `query` is the SDK's
//   `query`; the tests pass fakes: scripted ones that replay the S1 fixtures of e2e/fake-sdk/fixtures,
//   and the e2e fake e2e/fake-sdk/query.mjs itself.
// - `permissionModes` is [plan, acceptEdits, auto, dontAsk, bypassPermissions] with Claude Code's labels
//   (Plan, Accept edits, Auto, Don't ask, Bypass permissions); `defaultPermissionMode` is 'plan'.
// - `start(run, emit)` returns `{ stop }`. Events reach `emit` synchronously or later. Every run emits
//   `end` exactly once, and last (`end.interrupted` is true after a stop).
// - `start` looks for the first executable file named `claude` in `process.env.PATH`, read at each start.
//   With none, it emits `error` 'Claude Code CLI not found. Install it, then send again.', then `end`, and
//   never calls `query`. Otherwise it calls `query({ prompt, options })` once with `options`:
//     cwd = run.cwd, pathToClaudeCodeExecutable = the file found, resume = run.sessionId (absent without),
//     permissionMode = run.permissionMode, includePartialMessages: true, permissionPrompts: 'none',
//     systemPrompt: { type: 'preset', preset: 'claude_code' }, and for `plan` only
//     settings: { useAutoModeDuringPlan: false } (Spec ambiguity 1 = B: no `disallowedTools` for Bash);
//     allowDangerouslySkipPermissions: true for bypassPermissions only.
// - `prompt` is an async iterable that yields one SDK user message
//   `{ type: 'user', message: { role: 'user', content: <the prompt: a string, or [{ type: 'text', text }]> } }`,
//   stays open until that turn's `result` message, then ends (so that the CLI exits).
// - `toAgentEvents(message, cwd): AgentEvent[]` is exported and pure:
//   - `stream_event` / `content_block_delta` / `text_delta` with a non-empty text gives one `text` event;
//   - an `assistant` message gives one `action { kind: tool name, target }` per `tool_use` block, in order,
//     whoever made the call (subagents included); its text and thinking blocks give nothing;
//   - the target is the first present of `input.file_path`, `notebook_path` (relative to `cwd` when inside
//     it, absolute otherwise), `command` (first line), `pattern`, `url`, `query`; otherwise '';
//   - any other message gives nothing. (`session`, `error` and `end` are decided by the adapter's run.)
// - `session { sessionId }` is emitted once, with the `init` message's `session_id`, at the first model
//   output (a `stream_event`, or an `assistant` message without `error`), before the first text. A run that
//   fails before reaching the model (fixtures d and e) gives none.
// - Errors, each emitted once and followed by `end`:
//   - an `assistant` message with `error`, a `result` with `is_error`: `error` with Claude Code's own text
//     (fixture d: the same text comes three times, with the thrown error: one `error` event);
//   - a thrown 'Claude Code process exited with code N. stderr: …' or 'Failed to spawn Claude Code process: …':
//     `error` with that text as it is;
//   - a thrown 'Claude Code native binary not found at …' (fixture f): the 'CLI not found' text;
//   - a thrown 'Claude Code returned an error result: …' is skipped when that error was already emitted.
// - `stop()` calls the query's `interrupt()`. The `result` error and the thrown error that follow are
//   suppressed (S1 c), so a stopped run gives text, then `end { interrupted: true }`, and no `error`.
//   If no `result` arrives within 5 s, or if `interrupt()` rejects, `stop()` calls `close()`; the run still
//   ends with `end { interrupted: true }`.

const FIXTURES = fileURLToPath(new URL('../../../e2e/fake-sdk/fixtures/', import.meta.url))

type Message = Record<string, any>

const fixture = (name: string): Message[] =>
  readFileSync(join(FIXTURES, name), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Message)

const thrownIn = (name: string): Error => {
  const { thrown } = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as {
    thrown: { name: string; message: string }
  }
  return Object.assign(new Error(thrown.message), { name: thrown.name })
}

const A = 'a-plan-short-answer.jsonl'
const B = 'b-tools-accept-edits.jsonl'
const C = 'c-interrupt.jsonl'
const D = 'd-not-logged-in.jsonl'
const E = 'e-resume-unknown.jsonl'
const G = 'g-plan-no-write.jsonl'
const G2 = 'g2-plan-forced-attempts.jsonl'
const J = 'j-denied-dont-ask.jsonl'

const PROJECT = '/fixture/project'
const NOT_FOUND = 'Claude Code CLI not found. Install it, then send again.'

const isTextDelta = (m: Message): boolean =>
  m.type === 'stream_event' && m.event.type === 'content_block_delta' && m.event.delta.type === 'text_delta'
const textOfDelta = (m: Message): string => m.event.delta.text as string

// --- The sandbox: a PATH with a `claude` that the adapter finds but never runs, and the fake's state dir ---
let dir: string
let binDir: string
const originalPath = process.env.PATH

function writeClaude(into: string, mode = 0o755): string {
  mkdirSync(into, { recursive: true })
  const file = join(into, 'claude')
  writeFileSync(file, '#!/bin/sh\nexit 1\n')
  chmodSync(file, mode)
  return file
}

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'p0-adapter-')))
  binDir = join(dir, 'bin')
  writeClaude(binDir)
  process.env.PATH = binDir
  process.env.P0_FAKE_CLAUDE_STATE = join(dir, 'state')
})

afterEach(() => {
  vi.useRealTimers()
  process.env.PATH = originalPath
  delete process.env.P0_FAKE_CLAUDE_STATE
  rmSync(dir, { recursive: true, force: true })
})

// --- Fakes ---
type Deps = NonNullable<Parameters<typeof createClaudeCodeAdapter>[0]>
type QueryFn = NonNullable<Deps['query']>
const asQuery = (fn: unknown): QueryFn => fn as QueryFn

interface Params {
  prompt: AsyncIterable<unknown>
  options: Record<string, any>
}
interface Control {
  interrupted: Promise<void>
  closed: Promise<void>
}

/** The first user message of the prompt, read the way the SDK reads it; the input stays open. */
async function firstPrompt(params: Params): Promise<{ input: AsyncIterator<unknown>; message: Message }> {
  const input = params.prompt[Symbol.asyncIterator]()
  const first = await input.next()
  return { input, message: first.value as Message }
}

/** A fake `query`: `script` is the iteration, `interrupt()` and `close()` wake it through `control`. */
function scripted(
  script: (params: Params, control: Control) => AsyncGenerator<unknown, void>,
  { interruptRejects = false } = {}
) {
  const calls: Params[] = []
  const handles: { interrupt: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }[] = []
  const query = vi.fn((params: Params) => {
    calls.push(params)
    let interrupted!: () => void
    let closed!: () => void
    const control: Control = {
      interrupted: new Promise<void>((resolve) => (interrupted = resolve)),
      closed: new Promise<void>((resolve) => (closed = resolve))
    }
    const handle = {
      interrupt: vi.fn(async () => {
        if (interruptRejects) throw new Error('interrupt failed')
        interrupted()
      }),
      close: vi.fn(() => closed())
    }
    handles.push(handle)
    return Object.assign(script(params, control), handle)
  })
  return { query, calls, handles }
}

/** Replays a recording, then throws `thrown` if given. */
const replaying = (name: string, thrown?: Error) =>
  scripted(async function* (params) {
    await firstPrompt(params)
    yield* fixture(name)
    if (thrown) throw thrown
  })

/** Throws `thrown` before any message. */
const throwing = (thrown: Error) =>
  scripted(async function* (params) {
    await firstPrompt(params)
    throw thrown
  })

// --- Running the adapter ---
function start(query: unknown, run: Partial<AgentRun> = {}) {
  const adapter = createClaudeCodeAdapter({ query: asQuery(query) })
  return startOn(adapter, run)
}

function startOn(adapter: ReturnType<typeof createClaudeCodeAdapter>, run: Partial<AgentRun> = {}) {
  const events: AgentEvent[] = []
  let finish!: () => void
  const ended = new Promise<void>((resolve) => (finish = resolve))
  const handle = adapter.start({ cwd: PROJECT, prompt: 'hello', permissionMode: 'plan', ...run }, (event) => {
    events.push(event)
    if (event.type === 'end') finish()
  })
  return { events, ended, stop: () => handle.stop() }
}

/** Runs to the end, then leaves the time for a stray late event to show up. */
async function runToEnd(query: unknown, run: Partial<AgentRun> = {}): Promise<AgentEvent[]> {
  const started = start(query, run)
  await started.ended
  await new Promise((resolve) => setTimeout(resolve, 10))
  return started.events
}

const END = { type: 'end', interrupted: false } as const
const ofType = (events: AgentEvent[], type: AgentEvent['type']): AgentEvent[] => events.filter((e) => e.type === type)
const endsOnce = (events: AgentEvent[]): void => {
  expect(ofType(events, 'end')).toHaveLength(1)
  expect(events.at(-1)?.type).toBe('end')
}

/** Consecutive text events collapse into one string: the conversation as the user reads it. */
function timeline(events: AgentEvent[]): string[] {
  const lines: string[] = []
  let inText = false
  for (const event of events) {
    if (event.type === 'text') {
      if (inText) lines[lines.length - 1] += event.text
      else lines.push(event.text)
      inText = true
    } else if (event.type === 'action') {
      lines.push(event.target ? `${event.kind} ${event.target}` : event.kind)
      inText = false
    }
  }
  return lines
}

describe('permission modes', () => {
  it('chat AC8 — lists Plan, Accept edits, Auto, Don\'t ask and Bypass permissions, Plan by default', () => {
    const adapter = createClaudeCodeAdapter({ query: asQuery(vi.fn()) })

    expect(adapter.permissionModes).toEqual([
      { value: 'plan', label: 'Plan' },
      { value: 'acceptEdits', label: 'Accept edits' },
      { value: 'auto', label: 'Auto' },
      { value: 'dontAsk', label: "Don't ask" },
      { value: 'bypassPermissions', label: 'Bypass permissions' }
    ])
    expect(adapter.defaultPermissionMode).toBe('plan')
  })
})

describe('toAgentEvents', () => {
  const cwd = '/work/atlas'
  const delta = (text: string, type = 'text_delta') => ({
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 0, delta: { type, text } },
    session_id: 's',
    parent_tool_use_id: null
  })
  const tool = (name: string, input: Record<string, unknown>, parent: string | null = null) => ({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name, input }] },
    parent_tool_use_id: parent,
    session_id: 's'
  })
  const events = (message: unknown): AgentEvent[] => toAgentEvents(message as never, cwd)

  it('chat AC5 — a text_delta gives one text event', () => {
    expect(events(delta('Hello'))).toEqual([{ type: 'text', text: 'Hello' }])
  })

  it('chat AC5 — an empty text_delta gives nothing, so it cannot start an empty reply', () => {
    expect(events(delta(''))).toEqual([])
  })

  it('chat AC5 — thinking and tool input deltas, assistant text blocks and bookkeeping messages give nothing', () => {
    const thinking = { ...delta(''), event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } } }
    const toolInput = { ...delta(''), event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"a"' } } }
    const text = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Hi' }, { type: 'thinking', thinking: '' }] }, parent_tool_use_id: null }

    expect(events(thinking)).toEqual([])
    expect(events(toolInput)).toEqual([])
    expect(events(text)).toEqual([])
    expect(events({ type: 'rate_limit_event' })).toEqual([])
    expect(events({ type: 'system', subtype: 'status', status: 'requesting' })).toEqual([])
    expect(events({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } })).toEqual([])
  })

  it.each([
    ['Read', { file_path: '/work/atlas/README.md' }, 'README.md'],
    ['Edit', { file_path: '/work/atlas/src/index.ts', old_string: 'a', new_string: 'b' }, 'src/index.ts'],
    ['NotebookEdit', { notebook_path: '/work/atlas/nb/analysis.ipynb' }, 'nb/analysis.ipynb'],
    ['Write', { file_path: '/home/me/.claude/plans/try-both-warm-harp.md', content: 'x' }, '/home/me/.claude/plans/try-both-warm-harp.md'],
    ['Read', { file_path: '/work/atlas-other/file.ts' }, '/work/atlas-other/file.ts'],
    ['Bash', { command: 'npm test', description: 'Run the tests' }, 'npm test'],
    ['Bash', { command: 'echo one\necho two' }, 'echo one'],
    ['Grep', { pattern: 'TODO', path: '/work/atlas' }, 'TODO'],
    ['WebFetch', { url: 'https://example.com/docs', prompt: 'summarize' }, 'https://example.com/docs'],
    ['WebSearch', { query: 'electron protocol handle' }, 'electron protocol handle'],
    ['Read', { file_path: '/work/atlas/a.ts', command: 'ignored' }, 'a.ts'],
    ['Task', { description: 'Explore the code' }, '']
  ])('chat AC7 — a %s call with %j gives one action line whose target is %j', (name, input, target) => {
    expect(events(tool(name, input))).toEqual([{ type: 'action', kind: name, target }])
  })

  it('chat AC7 — several tool_use blocks in one message give one action each, in order, text blocks ignored', () => {
    const message = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Looking.' },
          { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/work/atlas/a.ts' } },
          { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'ls' } }
        ]
      },
      parent_tool_use_id: null
    }

    expect(events(message)).toEqual([
      { type: 'action', kind: 'Read', target: 'a.ts' },
      { type: 'action', kind: 'Bash', target: 'ls' }
    ])
  })

  it('chat AC7 — a tool call made by a subagent is shown like the others', () => {
    expect(events(tool('Read', { file_path: '/work/atlas/a.ts' }, 'toolu_parent'))).toEqual([
      { type: 'action', kind: 'Read', target: 'a.ts' }
    ])
  })
})

describe('events from the recordings (S1 fixtures)', () => {
  it('chat AC5 — fixture a, a short answer: the session, the text as it streams, the end', async () => {
    const fake = replaying(A)

    const events = await runToEnd(fake.query)

    expect(events).toEqual([
      { type: 'session', sessionId: '00000000-0000-4000-8000-000000000001' },
      { type: 'text', text: '2 +' },
      { type: 'text', text: ' 2 = 4.' },
      END
    ])
  })

  it('chat AC5 — the text is emitted as it arrives, not when the answer is complete', async () => {
    const messages = fixture(A)
    const afterFirstText = messages.findIndex(isTextDelta) + 1
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const fake = scripted(async function* (params) {
      await firstPrompt(params)
      yield* messages.slice(0, afterFirstText)
      await gate
      yield* messages.slice(afterFirstText)
    })

    const started = start(fake.query)
    await vi.waitFor(() => expect(started.events).toContainEqual({ type: 'text', text: '2 +' }))
    expect(ofType(started.events, 'end')).toHaveLength(0)
    release()
    await started.ended

    expect(timeline(started.events)).toEqual(['2 + 2 = 4.'])
  })

  it('chat AC6 — the session comes before the first text, once, with the id of the init message', async () => {
    const events = await runToEnd(replaying(B).query)

    expect(ofType(events, 'session')).toEqual([{ type: 'session', sessionId: '00000000-0000-4000-8000-000000000002' }])
    expect(events[0]).toEqual({ type: 'session', sessionId: '00000000-0000-4000-8000-000000000002' })
  })

  it('chat AC7 — fixture b: Read, Edit and Bash give one line each, in order, before the closing text', async () => {
    const events = await runToEnd(replaying(B).query)

    expect(ofType(events, 'action')).toEqual([
      { type: 'action', kind: 'Read', target: 'README.md' },
      { type: 'action', kind: 'Edit', target: 'src/index.ts' },
      { type: 'action', kind: 'Bash', target: 'npm test' }
    ])
    const firstText = events.findIndex((e) => e.type === 'text')
    const lastAction = events.map((e) => e.type).lastIndexOf('action')
    expect(lastAction).toBeLessThan(firstText)
    expect(ofType(events, 'error')).toEqual([])
    endsOnce(events)
  })

  it('chat AC7 — fixture j, a call denied by the mode: it still shows as a line, and raises no error', async () => {
    const events = await runToEnd(replaying(J).query)

    expect(ofType(events, 'action')).toEqual([{ type: 'action', kind: 'Write', target: 'notes.txt' }])
    expect(ofType(events, 'error')).toEqual([])
    endsOnce(events)
  })

  it('chat AC10 — fixture g, Plan mode: the plan file Claude writes outside the project is shown like any action', async () => {
    const events = await runToEnd(replaying(G).query)

    expect(ofType(events, 'action')).toEqual([
      { type: 'action', kind: 'Write', target: '/fixture/home/.claude/plans/try-both-of-these-warm-harp.md' }
    ])
    expect(ofType(events, 'error')).toEqual([])
    expect(events.filter((e) => e.type === 'text').every((e) => e.type === 'text' && e.text !== '')).toBe(true)
  })

  it('chat AC10 — fixture g2, Plan mode: only the read-only command shows as an action', async () => {
    const events = await runToEnd(replaying(G2).query)

    expect(ofType(events, 'action')).toEqual([{ type: 'action', kind: 'Bash', target: 'ls' }])
  })
})

describe('what the adapter asks of the SDK', () => {
  it('chat AC5 — calls query once with the project, the CLI found on PATH, partial messages, no prompts and the claude_code preset', async () => {
    const fake = replaying(A)

    await runToEnd(fake.query, { cwd: '/work/atlas' })

    expect(fake.query).toHaveBeenCalledTimes(1)
    const { options } = fake.calls[0]
    expect(options.cwd).toBe('/work/atlas')
    expect(options.pathToClaudeCodeExecutable).toBe(join(binDir, 'claude'))
    expect(options.includePartialMessages).toBe(true)
    expect(options.permissionPrompts).toBe('none')
    expect(options.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code' })
  })

  it('chat AC5 — the prompt is one user message that holds the text, the input stays open until the result, then ends', async () => {
    let first: Message | undefined
    let settledBeforeResult: boolean | undefined
    let endedAfterResult: boolean | undefined
    const fake = scripted(async function* (params) {
      const { input, message } = await firstPrompt(params)
      first = message
      let settled = false
      let done: boolean | undefined
      const second = input.next().then((step) => {
        settled = true
        done = step.done
      })
      const messages = fixture(A)
      yield* messages.slice(0, -1)
      await new Promise((resolve) => setTimeout(resolve, 20))
      settledBeforeResult = settled
      yield messages[messages.length - 1]
      await Promise.race([second, new Promise((resolve) => setTimeout(resolve, 1000))])
      endedAfterResult = settled && done === true
    })

    await runToEnd(fake.query, { prompt: 'Explain the code\nplease' })

    expect(first?.type).toBe('user')
    expect(first?.message.role).toBe('user')
    const content = first?.message.content as string | { type: string; text: string }[]
    const text = typeof content === 'string' ? content : content.map((block) => block.text).join('')
    expect(text).toBe('Explain the code\nplease')
    expect(settledBeforeResult).toBe(false)
    expect(endedAfterResult).toBe(true)
  })

  it('chat AC6 — resume is passed only when the chat has a session', async () => {
    const first = replaying(A)
    const second = replaying(A)

    await runToEnd(first.query)
    await runToEnd(second.query, { sessionId: '00000000-0000-4000-8000-0000000000aa' })

    expect(first.calls[0].options.resume).toBeUndefined()
    expect(second.calls[0].options.resume).toBe('00000000-0000-4000-8000-0000000000aa')
  })

  it('chat AC10 — a Plan run asks for plan, no prompts, and keeps auto mode out of the planning; Bash stays available', async () => {
    const fake = replaying(A)

    await runToEnd(fake.query, { permissionMode: 'plan' })

    const { options } = fake.calls[0]
    expect(options.permissionMode).toBe('plan')
    expect(options.permissionPrompts).toBe('none')
    expect(options.settings).toEqual({ useAutoModeDuringPlan: false })
    expect(options.disallowedTools ?? []).not.toContain('Bash')
    expect(options.allowDangerouslySkipPermissions).toBeFalsy()
  })

  it.each(['acceptEdits', 'auto', 'dontAsk'])('chat AC9 — a %s run passes its own mode, with no plan setting and no bypass flag', async (mode) => {
    const fake = replaying(A)

    await runToEnd(fake.query, { permissionMode: mode })

    const { options } = fake.calls[0]
    expect(options.permissionMode).toBe(mode)
    expect(options.settings?.useAutoModeDuringPlan).toBeUndefined()
    expect(options.allowDangerouslySkipPermissions).toBeFalsy()
    expect(options.permissionPrompts).toBe('none')
  })

  it('chat AC9 — only Bypass permissions sets allowDangerouslySkipPermissions', async () => {
    const fake = replaying(A)

    await runToEnd(fake.query, { permissionMode: 'bypassPermissions' })

    expect(fake.calls[0].options.permissionMode).toBe('bypassPermissions')
    expect(fake.calls[0].options.allowDangerouslySkipPermissions).toBe(true)
  })

  it('chat AC5 — the CLI is the first executable file named claude on PATH, looked up at each run', async () => {
    const nothing = join(dir, 'nothing')
    mkdirSync(nothing)
    const notExecutable = join(dir, 'not-executable')
    writeClaude(notExecutable, 0o644)
    const first = join(dir, 'first')
    const firstClaude = writeClaude(first)
    process.env.PATH = [nothing, notExecutable, first, binDir].join(delimiter)
    const fake = replaying(A)
    const adapter = createClaudeCodeAdapter({ query: asQuery(fake.query) })

    const one = startOn(adapter)
    await one.ended
    process.env.PATH = [binDir, first].join(delimiter)
    const two = startOn(adapter)
    await two.ended

    expect(fake.calls[0].options.pathToClaudeCodeExecutable).toBe(firstClaude)
    expect(fake.calls[1].options.pathToClaudeCodeExecutable).toBe(join(binDir, 'claude'))
  })
})

describe('errors', () => {
  it('chat AC13 — no claude on PATH: the "not found" error, then the end, and query is never called', async () => {
    const empty = join(dir, 'empty')
    mkdirSync(empty)
    process.env.PATH = empty
    const fake = replaying(A)

    const events = await runToEnd(fake.query)

    expect(events).toEqual([{ type: 'error', message: NOT_FOUND }, END])
    expect(fake.query).not.toHaveBeenCalled()
  })

  it('chat AC13 — a claude file that is not executable, or a folder named claude, is not the CLI', async () => {
    const notExecutable = join(dir, 'not-executable')
    writeClaude(notExecutable, 0o644)
    const folder = join(dir, 'folder')
    mkdirSync(join(folder, 'claude'), { recursive: true })
    process.env.PATH = [notExecutable, folder].join(delimiter)
    const fake = replaying(A)

    const events = await runToEnd(fake.query)

    expect(events).toEqual([{ type: 'error', message: NOT_FOUND }, END])
    expect(fake.query).not.toHaveBeenCalled()
  })

  it('chat AC13 — once the CLI is installed, the next run on the same adapter works', async () => {
    const empty = join(dir, 'empty')
    mkdirSync(empty)
    process.env.PATH = empty
    const adapter = createClaudeCodeAdapter({ query: asQuery(replaying(A).query) })
    const failed = startOn(adapter)
    await failed.ended
    expect(ofType(failed.events, 'error')).toHaveLength(1)

    process.env.PATH = binDir
    const fixed = startOn(adapter)
    await fixed.ended

    expect(ofType(fixed.events, 'error')).toEqual([])
    expect(timeline(fixed.events)).toEqual(['2 + 2 = 4.'])
  })

  it('chat AC13 — a thrown "process exited" error is shown as it is, then the end', async () => {
    const message = 'Claude Code process exited with code 1. stderr: boom'

    const events = await runToEnd(throwing(new Error(message)).query)

    expect(events).toEqual([{ type: 'error', message }, END])
  })

  it('chat AC13 — a thrown "failed to spawn" error is shown as it is', async () => {
    const message = 'Failed to spawn Claude Code process: spawn EACCES'

    const events = await runToEnd(throwing(new Error(message)).query)

    expect(events).toEqual([{ type: 'error', message }, END])
  })

  it('chat AC13 — fixture f, the SDK cannot find the binary: the "not found" text, whatever the path', async () => {
    const events = await runToEnd(throwing(thrownIn('f-missing-executable.error.json')).query)

    expect(events).toEqual([{ type: 'error', message: NOT_FOUND }, END])
  })

  it('chat AC13 — fixture d, not logged in: Claude Code\'s own message, once, and no session', async () => {
    const fake = replaying(D, thrownIn('d-not-logged-in.error.json'))

    const events = await runToEnd(fake.query)

    expect(events).toEqual([{ type: 'error', message: 'Not logged in · Please run /login' }, END])
  })

  it('chat AC13 — fixture e, an unknown session: one error that says so, and no session', async () => {
    const fake = replaying(E, thrownIn('e-resume-unknown.error.json'))

    const events = await runToEnd(fake.query, { sessionId: '00000000-0000-4000-8000-000000000005' })

    expect(ofType(events, 'error')).toHaveLength(1)
    const [error] = ofType(events, 'error')
    expect(error.type === 'error' && error.message).toContain(
      'No conversation found with session ID: 00000000-0000-4000-8000-000000000005'
    )
    expect(ofType(events, 'session')).toEqual([])
    endsOnce(events)
  })

  it('chat AC13 — the text received before an error is kept, and the error comes after it', async () => {
    const messages = fixture(A)
    const afterTexts = messages.findIndex((m) => m.type === 'assistant' && m.message.content[0].type === 'text') + 1
    const fake = scripted(async function* (params) {
      await firstPrompt(params)
      yield* messages.slice(0, afterTexts)
      throw new Error('Claude Code process exited with code 1. stderr: late')
    })

    const events = await runToEnd(fake.query)

    expect(events.map((e) => e.type)).toEqual(['session', 'text', 'text', 'error', 'end'])
  })
})

describe('Stop', () => {
  /** Fixture c: the answer is interrupted after its text; `interrupt()` then yields the recorded sequence. */
  const interruption = fixture(C)
  const cut = interruption.findIndex((m) => m.type === 'user')
  const streamed = interruption.filter(isTextDelta).map(textOfDelta)

  const interruptible = () =>
    scripted(async function* (params, control) {
      await firstPrompt(params)
      yield* interruption.slice(0, cut)
      await control.interrupted
      yield* interruption.slice(cut)
      throw thrownIn('c-interrupt.error.json')
    })

  /** The run is stuck after its text: no `result` ever comes, only `close()` gets out of it. */
  const stuck = (options?: { interruptRejects?: boolean }) =>
    scripted(async function* (params, control) {
      await firstPrompt(params)
      yield* interruption.slice(0, cut)
      await control.closed
    }, options)

  const textCount = (events: AgentEvent[]): number => ofType(events, 'text').length

  it('chat AC11 — stop() calls interrupt(); the text received stays, the end says interrupted, and no error shows', async () => {
    const fake = interruptible()
    const started = start(fake.query)
    await vi.waitFor(() => expect(textCount(started.events)).toBe(streamed.length))

    started.stop()
    await started.ended
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(fake.handles[0].interrupt).toHaveBeenCalledTimes(1)
    expect(fake.handles[0].close).not.toHaveBeenCalled()
    expect(ofType(started.events, 'text')).toEqual(streamed.map((text) => ({ type: 'text', text })))
    expect(ofType(started.events, 'error')).toEqual([])
    expect(started.events.at(-1)).toEqual({ type: 'end', interrupted: true })
    endsOnce(started.events)
    expect(started.events[0]).toEqual({ type: 'session', sessionId: '00000000-0000-4000-8000-000000000003' })
  })

  it('chat AC11 — a run that nobody stops ends with interrupted false', async () => {
    const events = await runToEnd(replaying(A).query)

    expect(events.at(-1)).toEqual(END)
  })

  it('chat AC11 — with no result within 5 s after stop(), close() is called, and the run ends as interrupted', async () => {
    const fake = stuck()
    const started = start(fake.query)
    await vi.waitFor(() => expect(textCount(started.events)).toBe(streamed.length))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    started.stop()
    await vi.advanceTimersByTimeAsync(4_900)
    expect(fake.handles[0].interrupt).toHaveBeenCalledTimes(1)
    expect(fake.handles[0].close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(fake.handles[0].close).toHaveBeenCalledTimes(1)

    await started.ended
    vi.useRealTimers()
    expect(started.events.at(-1)).toEqual({ type: 'end', interrupted: true })
    expect(ofType(started.events, 'error')).toEqual([])
    endsOnce(started.events)
  })

  it('chat AC11 — when interrupt() rejects, close() is called at once', async () => {
    const fake = stuck({ interruptRejects: true })
    const started = start(fake.query)
    await vi.waitFor(() => expect(textCount(started.events)).toBe(streamed.length))

    started.stop()

    await vi.waitFor(() => expect(fake.handles[0].close).toHaveBeenCalledTimes(1))
    await started.ended
    expect(started.events.at(-1)).toEqual({ type: 'end', interrupted: true })
    expect(ofType(started.events, 'error')).toEqual([])
    endsOnce(started.events)
  })

  it('chat AC11 — when the result comes in time, close() is never called', async () => {
    const fake = interruptible()
    const started = start(fake.query)
    await vi.waitFor(() => expect(textCount(started.events)).toBe(streamed.length))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    started.stop()
    await started.ended
    await vi.advanceTimersByTimeAsync(10_000)

    expect(fake.handles[0].close).not.toHaveBeenCalled()
  })
})

describe('parallel runs', () => {
  it('chat AC12 — two runs of one adapter each emit only their own events', async () => {
    const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
    const interleaved = (name: string) =>
      async function* (): AsyncGenerator<unknown, void> {
        for (const message of fixture(name)) {
          yield message
          await tick()
        }
      }
    const query = vi.fn((params: Params) => {
      const script = (async function* () {
        const { message } = await firstPrompt(params)
        const content = message.message.content as string | { text: string }[]
        const prompt = typeof content === 'string' ? content : content.map((block) => block.text).join('')
        yield* interleaved(prompt === 'run A' ? A : B)()
      })()
      return Object.assign(script, { interrupt: async () => {}, close: () => {} })
    })
    const adapter = createClaudeCodeAdapter({ query: asQuery(query) })

    const one = startOn(adapter, { prompt: 'run A' })
    const two = startOn(adapter, { prompt: 'run B' })
    await Promise.all([one.ended, two.ended])

    expect(one.events).toEqual([
      { type: 'session', sessionId: '00000000-0000-4000-8000-000000000001' },
      { type: 'text', text: '2 +' },
      { type: 'text', text: ' 2 = 4.' },
      END
    ])
    expect(ofType(two.events, 'session')).toEqual([{ type: 'session', sessionId: '00000000-0000-4000-8000-000000000002' }])
    expect(ofType(two.events, 'action')).toHaveLength(3)
    expect(timeline(two.events).at(-1)).toContain('npm test')
    endsOnce(one.events)
    endsOnce(two.events)
  })
})

describe('with the fake SDK query of the e2e (e2e/fake-sdk/query.mjs)', () => {
  const run = (prompt: string, extra: Partial<AgentRun> = {}) => runToEnd(fakeSdkQuery, { cwd: '/work/atlas', prompt, ...extra })
  const replyOf = (events: AgentEvent[]): string =>
    ofType(events, 'text')
      .map((e) => (e.type === 'text' ? e.text : ''))
      .join('')
  const sessionOf = (events: AgentEvent[]): string => {
    const [session] = ofType(events, 'session')
    if (session?.type !== 'session') throw new Error('no session event')
    return session.sessionId
  }

  it('chat AC5 — a message gets the reply that echoes the prompt, the mode and the project folder', async () => {
    const events = await run('hello there')

    expect(replyOf(events)).toBe(
      'You said: hello there\nMode: plan\nFolder: /work/atlas\nEarlier in this chat: nothing'
    )
    expect(ofType(events, 'text').length).toBeGreaterThan(1)
    expect(events.at(-1)).toEqual(END)
  })

  it('chat AC6 — a run that resumes the session of the first one has the earlier messages, and only those', async () => {
    const first = await run('first')
    const second = await run('second', { sessionId: sessionOf(first) })
    const other = await run('other')

    expect(replyOf(second)).toContain('Earlier in this chat: first')
    expect(replyOf(other)).toContain('Earlier in this chat: nothing')
    expect(sessionOf(second)).toBe(sessionOf(first))
    expect(sessionOf(other)).not.toBe(sessionOf(first))
  })

  it('chat AC7 — [tools]: the three action lines come between the text segments, in order', async () => {
    const events = await run('[tools] go', { permissionMode: 'acceptEdits' })

    expect(timeline(events)).toEqual([
      'Let me look at the project.',
      'Read README.md',
      'Now the change.',
      'Edit src/index.ts',
      'Bash npm test',
      'Done.'
    ])
  })

  it('chat AC13 — [auth]: Claude Code\'s own message, once, and no session; the next message works', async () => {
    const failed = await run('[auth] hello')
    const next = await run('hello again')

    expect(failed).toEqual([{ type: 'error', message: 'Not logged in · Please run /login' }, END])
    expect(replyOf(next)).toContain('You said: hello again')
  })

  it('chat AC13 — [crash]: the process error text', async () => {
    const events = await run('[crash] hello')

    expect(events).toEqual([
      { type: 'error', message: 'Claude Code process exited with code 1. stderr: fake crash' },
      END
    ])
  })

  it('chat AC11 — [slow] then stop: the text so far stays, the end says interrupted, no error, and the session remembers the turn', async () => {
    const adapter = createClaudeCodeAdapter({ query: asQuery(fakeSdkQuery) })
    const started = startOn(adapter, { cwd: '/work/atlas', prompt: '[slow] count' })
    await vi.waitFor(() => expect(replyOf(started.events)).toContain('tick 2 '))

    started.stop()
    await started.ended

    expect(replyOf(started.events)).toMatch(/^tick 1 tick 2 /)
    expect(ofType(started.events, 'error')).toEqual([])
    expect(started.events.at(-1)).toEqual({ type: 'end', interrupted: true })
    const resumed = startOn(adapter, { cwd: '/work/atlas', prompt: 'next', sessionId: sessionOf(started.events) })
    await resumed.ended
    expect(replyOf(resumed.events)).toContain('Earlier in this chat: [slow] count')
  })
})
