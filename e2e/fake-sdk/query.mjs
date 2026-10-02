// Fake of the Claude Agent SDK's `query()` (docs/features/claude-code-chat.md, "Test strategy").
//
// The real Claude Code adapter (src/main/agents/claude-code.ts) runs against this fake in the unit
// tests (imported directly) and in the e2e (loaded through `P0_FAKE_SDK_QUERY`, read only under
// `P0_E2E=1`). It replays the shapes recorded in spike S1 (`./fixtures/*.jsonl`): messages are clones of
// the recorded ones, with the session id, the folder, the mode and the texts replaced.
// It uses no network, starts no process, has no window, and writes only in `$P0_FAKE_CLAUDE_STATE`.
//
// `query({ prompt, options })` returns an async iterator of SDK messages with the only two `Query`
// members the adapter uses: `interrupt()` and `close()`.
//
// - `prompt` is an async iterable of user messages `{ type: 'user', message: { role: 'user', content } }`,
//   `content` being a string or an array of `{ type: 'text', text }` blocks. The fake reads the first one.
// - It throws, at call time, when `options` lacks `cwd`, `pathToClaudeCodeExecutable`, `permissionMode`,
//   `includePartialMessages: true` or `permissionPrompts: 'none'`, or (AC10) when the mode is `plan` and
//   `options.settings.useAutoModeDuringPlan` is not `false`. A wrong call from the adapter fails the tests.
// - Sessions live in `$P0_FAKE_CLAUDE_STATE/<session id>.json`: `{ "prompts": [...] }`, one entry per message
//   that reached the model, interrupted ones included (S1 c2: a resume after a stop remembers the turn).
//   Without `options.resume` a new session id is created. A `resume` with an unknown id yields the S1 (e)
//   error result, then throws the S1 (e) error.
// - The reply of a normal message is four lines, streamed in chunks:
//     You said: <prompt>
//     Mode: <options.permissionMode>
//     Folder: <options.cwd>
//     Earlier in this chat: <earlier prompts joined with " | ", or "nothing">
// - Scenario markers in the prompt:
//     [tools]  "Let me look at the project." Read <cwd>/README.md, "Now the change." Edit <cwd>/src/index.ts,
//              Bash `npm test`, "Done."
//     [slow]   text chunks "tick 1 ", "tick 2 ", ... one every 100 ms for 30 s. `interrupt()` yields the S1 (c)
//              sequence (assistant text so far, "[Request interrupted by user]", error result), then throws the
//              S1 (c) error. `close()` ends the iteration silently.
//     [auth]   the S1 (d) sequence (assistant error, error result), then throws the S1 (d) error. No session.
//     [crash]  throws `Claude Code process exited with code 1. stderr: fake crash` before any message.
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SLOW_TICKS = 300
const SLOW_INTERVAL_MS = 100
const CHUNK_SIZE = 12

// --- Fixtures: the S1 recordings are the templates of every message ---
const fixtures = new Map()

function recording(name) {
  if (!fixtures.has(name)) {
    const text = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
    fixtures.set(name, text.split('\n').filter(Boolean).map((line) => JSON.parse(line)))
  }
  return fixtures.get(name)
}

function thrownBy(name) {
  const { thrown } = JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
  const error = new Error(thrown.message)
  error.name = thrown.name
  return error
}

function template(name, predicate) {
  const message = recording(name).find(predicate)
  if (!message) throw new Error(`fake SDK: no matching message in fixtures/${name}`)
  return message
}

const isStream = (type) => (m) => m.type === 'stream_event' && m.event.type === type
const A = 'a-plan-short-answer.jsonl'
const B = 'b-tools-accept-edits.jsonl'
const C = 'c-interrupt.jsonl'
const D = 'd-not-logged-in.jsonl'
const E = 'e-resume-unknown.jsonl'

const copy = (message, sessionId, patch = {}) => ({ ...structuredClone(message), session_id: sessionId, ...patch })

// --- Message builders ---
const init = (ctx) =>
  copy(template(A, (m) => m.type === 'system' && m.subtype === 'init'), ctx.sessionId, {
    cwd: ctx.cwd,
    permissionMode: ctx.permissionMode
  })

const status = (ctx) => copy(template(A, (m) => m.type === 'system' && m.subtype === 'status'), ctx.sessionId)

function textDelta(ctx, text) {
  const message = copy(template(A, (m) => isStream('content_block_delta')(m) && m.event.delta.type === 'text_delta'), ctx.sessionId)
  message.event.delta.text = text
  return message
}

function assistantText(ctx, text) {
  const message = copy(template(A, (m) => m.type === 'assistant' && m.message.content[0]?.type === 'text'), ctx.sessionId)
  message.message.content = [{ type: 'text', text }]
  return message
}

const streamMark = (ctx, type, extra) =>
  copy(template(A, (m) => isStream(type)(m) && (!extra || extra(m))), ctx.sessionId)

const textBlockStart = (ctx) => streamMark(ctx, 'content_block_start', (m) => m.event.content_block.type === 'text')

function result(ctx, text) {
  const message = copy(template(A, (m) => m.type === 'result'), ctx.sessionId)
  message.result = text
  return message
}

function toolUse(ctx, name, input) {
  const message = copy(template(B, (m) => m.type === 'assistant' && m.message.content[0]?.name === name), ctx.sessionId)
  message.message.content[0].id = `toolu_fake_${randomUUID()}`
  message.message.content[0].input = input
  return message
}

const chunksOf = (text) => {
  const chunks = []
  for (let i = 0; i < text.length; i += CHUNK_SIZE) chunks.push(text.slice(i, i + CHUNK_SIZE))
  return chunks
}

/** One streamed text block: message start, text deltas in chunks, the assistant message, stops. */
function* streamedText(ctx, text) {
  yield streamMark(ctx, 'message_start')
  yield textBlockStart(ctx)
  for (const chunk of chunksOf(text)) yield textDelta(ctx, chunk)
  yield assistantText(ctx, text)
  yield streamMark(ctx, 'content_block_stop')
  yield streamMark(ctx, 'message_stop')
}

// --- State: the sessions of the fake ---
function stateFile(dir, sessionId) {
  return join(dir, `${sessionId}.json`)
}

function readSession(dir, sessionId) {
  const file = stateFile(dir, sessionId)
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}

function writeSession(dir, sessionId, prompts) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(stateFile(dir, sessionId), JSON.stringify({ prompts }))
}

// --- The run ---
function promptText(message) {
  const { content } = message.message
  if (typeof content === 'string') return content
  return content.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
}

async function* run(prompt, options, control) {
  const input = prompt[Symbol.asyncIterator]()
  const first = await input.next()
  if (first.done) throw new Error('fake SDK: the prompt ended before any user message')
  const text = promptText(first.value)

  if (text.includes('[crash]')) {
    throw new Error('Claude Code process exited with code 1. stderr: fake crash')
  }
  const stateDir = process.env.P0_FAKE_CLAUDE_STATE
  if (!stateDir) throw new Error('fake SDK: P0_FAKE_CLAUDE_STATE is not set')

  let earlier = []
  let sessionId = randomUUID()
  if (options.resume) {
    sessionId = options.resume
    const session = readSession(stateDir, sessionId)
    if (!session) {
      const error = copy(template(E, (m) => m.type === 'result'), sessionId)
      error.errors = [`No conversation found with session ID: ${sessionId}`]
      yield error
      throw new Error(`Claude Code returned an error result: ${error.errors[0]}`)
    }
    earlier = session.prompts
  }
  const ctx = { sessionId, cwd: options.cwd, permissionMode: options.permissionMode }

  yield init(ctx)
  yield status(ctx)

  if (text.includes('[auth]')) {
    for (const message of recording(D).slice(2)) yield copy(message, sessionId)
    throw thrownBy('d-not-logged-in.error.json')
  }

  writeSession(stateDir, sessionId, [...earlier, text])

  if (text.includes('[tools]')) {
    yield* streamedText(ctx, 'Let me look at the project.')
    yield toolUse(ctx, 'Read', { file_path: `${ctx.cwd}/README.md` })
    yield* streamedText(ctx, 'Now the change.')
    yield toolUse(ctx, 'Edit', { file_path: `${ctx.cwd}/src/index.ts`, old_string: 'hello', new_string: 'hello world' })
    yield toolUse(ctx, 'Bash', { command: 'npm test', description: 'Run the test suite' })
    yield* streamedText(ctx, 'Done.')
    yield result(ctx, 'Done.')
    return
  }

  if (text.includes('[slow]')) {
    yield streamMark(ctx, 'message_start')
    yield textBlockStart(ctx)
    let streamed = ''
    for (let tick = 1; tick <= SLOW_TICKS && !control.interrupted && !control.closed; tick++) {
      const chunk = `tick ${tick} `
      streamed += chunk
      yield textDelta(ctx, chunk)
      await control.sleep(SLOW_INTERVAL_MS)
    }
    if (control.closed) return
    yield assistantText(ctx, streamed)
    if (control.interrupted) {
      yield copy(template(C, (m) => m.type === 'user'), sessionId)
      yield copy(template(C, (m) => m.type === 'result'), sessionId)
      throw thrownBy('c-interrupt.error.json')
    }
    yield streamMark(ctx, 'content_block_stop')
    yield streamMark(ctx, 'message_stop')
    yield result(ctx, streamed)
    return
  }

  const reply = [
    `You said: ${text}`,
    `Mode: ${ctx.permissionMode}`,
    `Folder: ${ctx.cwd}`,
    `Earlier in this chat: ${earlier.length > 0 ? earlier.join(' | ') : 'nothing'}`
  ].join('\n')
  yield* streamedText(ctx, reply)
  yield result(ctx, reply)
}

function checkOptions(options) {
  const fail = (what) => {
    throw new Error(`fake SDK: the adapter must call query() with ${what}`)
  }
  if (typeof options.cwd !== 'string' || options.cwd === '') fail('options.cwd')
  if (typeof options.pathToClaudeCodeExecutable !== 'string' || options.pathToClaudeCodeExecutable === '') {
    fail('options.pathToClaudeCodeExecutable')
  }
  if (typeof options.permissionMode !== 'string' || options.permissionMode === '') fail('options.permissionMode')
  if (options.includePartialMessages !== true) fail('options.includePartialMessages: true')
  if (options.permissionPrompts !== 'none') fail("options.permissionPrompts: 'none'")
  if (options.permissionMode === 'plan' && options.settings?.useAutoModeDuringPlan !== false) {
    fail('options.settings.useAutoModeDuringPlan: false in Plan mode')
  }
}

export function query({ prompt, options = {} }) {
  checkOptions(options)

  // `sleep` ends early on `interrupt()` and `close()`, like the real iteration reacts to them.
  let wake = null
  const control = {
    interrupted: false,
    closed: false,
    sleep: (ms) =>
      control.interrupted || control.closed
        ? Promise.resolve()
        : new Promise((resolve) => {
            const timer = setTimeout(() => {
              wake = null
              resolve()
            }, ms)
            wake = () => {
              clearTimeout(timer)
              wake = null
              resolve()
            }
          })
  }

  const iterator = run(prompt, options, control)
  iterator.interrupt = async () => {
    control.interrupted = true
    wake?.()
  }
  iterator.close = () => {
    control.closed = true
    wake?.()
  }
  return iterator
}
