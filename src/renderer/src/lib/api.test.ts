import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, RunRequest } from '../../../shared/chat'
import { addProject, getAgent, listProjects, startRun, stopRun } from './api'

// `chat AC<n>` refers to the acceptance criteria of docs/features/claude-code-chat.md.
//
// Contracts these tests rely on (src/renderer/src/lib/api.ts), stories 1 and 2:
// - the module talks to the main process with the global `fetch` on `p0://api` (API_BASE);
// - `listProjects(): Promise<Project[]>` does `GET p0://api/projects` and returns the parsed JSON;
// - `addProject(): Promise<{ projects: Project[]; selected: string | null }>` does
//   `POST p0://api/projects` and returns the parsed JSON (`selected` is null when the user cancels);
// - both reject when the response is not ok;
// - `Project` is `{ path: string; name: string }` (src/shared/chat.ts).
// Story 2:
// - `getAgent(): Promise<AgentInfo>` does `GET p0://api/agent` and returns the parsed JSON
//   (`{ permissionModes, defaultPermissionMode }`); it rejects when the response is not ok;
// - `startRun(request: RunRequest, onEvent: (event: AgentEvent) => void): Promise<void>` does
//   `POST p0://api/runs` with the JSON of `request` as body (`Content-Type: application/json`), reads the
//   NDJSON response body and calls `onEvent` with each line parsed, in order, as soon as the line is complete
//   (lines are cut anywhere across chunks, even inside a multi-byte character; blank lines are skipped; a
//   last line without a trailing newline counts). The promise resolves when the stream ends, and rejects
//   when the response is not ok (400…) or the transport fails, without calling `onEvent`;
// - `stopRun(runId: string): Promise<void>` does `POST p0://api/runs/<runId>/stop` (answer 204, no body)
//   and resolves with nothing; it rejects when the response is not ok;
// - `RunRequest` is `{ runId; projectPath; prompt; permissionMode; sessionId? }` (src/shared/chat.ts).
// `fetch` is the only thing mocked: the network frontier.

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const ndjson = (chunks: (string | Uint8Array)[], status = 200): Response =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk)
        controller.close()
      }
    }),
    { status, headers: { 'Content-Type': 'application/x-ndjson' } }
  )

const line = (event: AgentEvent): string => `${JSON.stringify(event)}\n`

/** URL and method of the n-th call, whether `fetch` got a string, a URL or a Request. */
const requestOf = (n = 0): { url: string; method: string } => {
  const [input, init] = fetchMock.mock.calls[n] as [string | URL | Request, RequestInit | undefined]
  if (input instanceof Request) return { url: input.url, method: (init?.method ?? input.method).toUpperCase() }
  return { url: String(input), method: (init?.method ?? 'GET').toUpperCase() }
}

describe('lib/api — projects', () => {
  it('chat AC2 — listProjects GETs p0://api/projects and returns the projects in the order received', async () => {
    const projects = [
      { path: '/work/borealis', name: 'borealis' },
      { path: '/work/atlas', name: 'atlas' }
    ]
    fetchMock.mockResolvedValue(json(projects))

    const result = await listProjects()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(requestOf()).toEqual({ url: 'p0://api/projects', method: 'GET' })
    expect(result).toEqual(projects)
  })

  it('chat AC3 — listProjects returns an empty list when no project was added', async () => {
    fetchMock.mockResolvedValue(json([]))

    expect(await listProjects()).toEqual([])
  })

  it('chat AC1 — addProject POSTs p0://api/projects and returns the projects and the selected path', async () => {
    const answer = {
      projects: [{ path: '/work/atlas', name: 'atlas' }],
      selected: '/work/atlas'
    }
    fetchMock.mockResolvedValue(json(answer))

    const result = await addProject()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(requestOf()).toEqual({ url: 'p0://api/projects', method: 'POST' })
    expect(result).toEqual(answer)
  })

  it('chat AC1 — addProject returns selected null when the user cancels the picker', async () => {
    const answer = { projects: [{ path: '/work/atlas', name: 'atlas' }], selected: null }
    fetchMock.mockResolvedValue(json(answer))

    expect(await addProject()).toEqual(answer)
  })

  it('chat AC1 — addProject sends no folder path: the folder comes from the picker in the main process', async () => {
    fetchMock.mockResolvedValue(json({ projects: [], selected: null }))

    await addProject()

    const [, init] = fetchMock.mock.calls[0] as [unknown, RequestInit | undefined]
    expect(init?.body ?? undefined).toBeUndefined()
  })

  it('chat AC1 — listProjects rejects when the response is not ok', async () => {
    fetchMock.mockResolvedValue(json({ error: 'boom' }, 500))

    await expect(listProjects()).rejects.toThrow()
  })

  it('chat AC1 — addProject rejects when the response is not ok', async () => {
    fetchMock.mockResolvedValue(json({ error: 'boom' }, 500))

    await expect(addProject()).rejects.toThrow()
  })
})

describe('lib/api — agent', () => {
  it('chat AC8 — getAgent GETs p0://api/agent and returns the permission modes and the default mode', async () => {
    const info = {
      permissionModes: [
        { value: 'plan', label: 'Plan' },
        { value: 'dontAsk', label: "Don't ask" }
      ],
      defaultPermissionMode: 'plan'
    }
    fetchMock.mockResolvedValue(json(info))

    const result = await getAgent()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(requestOf()).toEqual({ url: 'p0://api/agent', method: 'GET' })
    expect(result).toEqual(info)
  })

  it('chat AC8 — getAgent rejects when the response is not ok', async () => {
    fetchMock.mockResolvedValue(json({ error: 'boom' }, 500))

    await expect(getAgent()).rejects.toThrow()
  })
})

describe('lib/api — startRun', () => {
  const REQUEST: RunRequest = {
    runId: 'run-1',
    projectPath: '/work/atlas',
    prompt: 'hello',
    permissionMode: 'plan'
  }

  it('chat AC5 — POSTs the request as JSON to p0://api/runs', async () => {
    fetchMock.mockResolvedValue(ndjson([line({ type: 'end', interrupted: false })]))

    await startRun({ ...REQUEST, sessionId: 'session-1' }, () => {})

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(requestOf()).toEqual({ url: 'p0://api/runs', method: 'POST' })
    const [, init] = fetchMock.mock.calls[0] as [unknown, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ ...REQUEST, sessionId: 'session-1' })
    expect(new Headers(init.headers).get('content-type')).toContain('application/json')
  })

  it('chat AC5 — calls onEvent with each event, in order, and resolves when the stream ends', async () => {
    const events: AgentEvent[] = [
      { type: 'session', sessionId: 's1' },
      { type: 'text', text: 'Hello' },
      { type: 'action', kind: 'Read', target: 'README.md' },
      { type: 'end', interrupted: false }
    ]
    fetchMock.mockResolvedValue(ndjson(events.map(line)))
    const received: AgentEvent[] = []

    await expect(startRun(REQUEST, (event) => received.push(event))).resolves.toBeUndefined()

    expect(received).toEqual(events)
  })

  it('chat AC5 — a line cut across chunks, anywhere, is rebuilt: one event per line', async () => {
    const events: AgentEvent[] = [
      { type: 'text', text: 'first line\nwith a break' },
      { type: 'text', text: 'second' },
      { type: 'end', interrupted: false }
    ]
    const all = events.map(line).join('')
    // cut in the middle of the first line, right after a newline, and inside the last line
    const cuts = [10, all.indexOf('\n') + 1, all.length - 8]
    const chunks = [all.slice(0, cuts[0]), all.slice(cuts[0], cuts[1]), all.slice(cuts[1], cuts[2]), all.slice(cuts[2])]
    fetchMock.mockResolvedValue(ndjson(chunks))
    const received: AgentEvent[] = []

    await startRun(REQUEST, (event) => received.push(event))

    expect(received).toEqual(events)
  })

  it('chat AC5 — one chunk holding several lines gives one event per line', async () => {
    const events: AgentEvent[] = [
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
      { type: 'end', interrupted: false }
    ]
    fetchMock.mockResolvedValue(ndjson([events.map(line).join('')]))
    const received: AgentEvent[] = []

    await startRun(REQUEST, (event) => received.push(event))

    expect(received).toEqual(events)
  })

  it('chat AC5 — a multi-byte character cut between two chunks arrives whole', async () => {
    const bytes = new TextEncoder().encode(line({ type: 'text', text: 'café — 日本' }))
    const middleOfE = bytes.indexOf(0xc3) + 1 // between the two bytes of "é"
    fetchMock.mockResolvedValue(ndjson([bytes.slice(0, middleOfE), bytes.slice(middleOfE)]))
    const received: AgentEvent[] = []

    await startRun(REQUEST, (event) => received.push(event))

    expect(received).toEqual([{ type: 'text', text: 'café — 日本' }])
  })

  it('chat AC5 — blank lines are skipped, and a last line with no trailing newline counts', async () => {
    const last = JSON.stringify({ type: 'end', interrupted: false })
    fetchMock.mockResolvedValue(ndjson([`${line({ type: 'text', text: 'a' })}\n\n`, last]))
    const received: AgentEvent[] = []

    await startRun(REQUEST, (event) => received.push(event))

    expect(received).toEqual([{ type: 'text', text: 'a' }, { type: 'end', interrupted: false }])
  })

  it('chat AC5 — an event reaches onEvent as soon as its line is complete, before the stream ends', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
      }
    })
    fetchMock.mockResolvedValue(new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } }))
    const received: AgentEvent[] = []
    let settled = false

    const done = startRun(REQUEST, (event) => received.push(event)).then(() => {
      settled = true
    })
    const encoder = new TextEncoder()
    controller.enqueue(encoder.encode(line({ type: 'text', text: 'one' }) + '{"type":"te'))
    await vi.waitFor(() => expect(received).toEqual([{ type: 'text', text: 'one' }]))
    expect(settled).toBe(false)

    controller.enqueue(encoder.encode('xt","text":"two"}\n'))
    await vi.waitFor(() => expect(received).toHaveLength(2))
    expect(received[1]).toEqual({ type: 'text', text: 'two' })
    controller.close()
    await done

    expect(settled).toBe(true)
  })

  it('chat AC13 — rejects when the response is not ok (400), without calling onEvent', async () => {
    fetchMock.mockResolvedValue(json({ error: 'unknown project' }, 400))
    const onEvent = vi.fn()

    await expect(startRun(REQUEST, onEvent)).rejects.toThrow()

    expect(onEvent).not.toHaveBeenCalled()
  })

  it('chat AC13 — rejects when the transport fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(startRun(REQUEST, () => {})).rejects.toThrow()
  })
})

describe('lib/api — stopRun', () => {
  it('chat AC11 — POSTs p0://api/runs/<runId>/stop and resolves with nothing on 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(stopRun('run-1')).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(requestOf()).toEqual({ url: 'p0://api/runs/run-1/stop', method: 'POST' })
  })

  it('chat AC11 — rejects when the response is not ok', async () => {
    fetchMock.mockResolvedValue(json({ error: 'boom' }, 500))

    await expect(stopRun('run-1')).rejects.toThrow()
  })
})
