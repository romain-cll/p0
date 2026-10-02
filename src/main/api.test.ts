// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { AgentEvent, RunRequest } from '../shared/chat'
import { handleApiRequest, stopAll } from './api'

// `chat AC<n>` refers to the acceptance criteria of docs/features/claude-code-chat.md.
//
// Contracts these tests rely on (src/main/api.ts), stories 1 and 2:
// - `handleApiRequest(request: Request, deps: { projectsFile: string; pickFolder: () => Promise<string | null>; adapter: AgentAdapter }): Promise<Response>`
//   The function may be synchronous or asynchronous: the tests `await` it.
// - URLs look like `p0://api/projects`: `host === 'api'`, `pathname === '/projects'`.
// - `GET /projects` answers 200, `application/json`, with `Project[]` (`{ path, name }`, in order).
// - `POST /projects` calls `pickFolder()` once, then answers 200, `application/json`, with
//   `{ projects: Project[]; selected: string | null }`.
//   - a picked folder is added through the projects store and `selected` is its path;
//   - `null` from the picker (cancel) changes nothing and gives `selected: null`;
//   - a folder that is already a project gives that path as `selected`, without duplicate.
// - `GET /projects` never calls `pickFolder`.
// - Spike S2 facts: there is no `OPTIONS` route and no CORS header on any response.
// - An unknown path answers 404.
// Story 2 (the run routes). `adapter` is an `AgentAdapter` ({ permissionModes, defaultPermissionMode,
// start(run, emit) => { stop() } }); the tests give it a fake.
// - `GET /agent` answers 200, `application/json`, with `{ permissionModes, defaultPermissionMode }` of the adapter.
// - `POST /runs` takes a JSON `RunRequest { runId, projectPath, prompt, permissionMode, sessionId? }`.
//   - 400 when `projectPath` is not in the projects store, or `permissionMode` is not one of
//     `adapter.permissionModes`; `adapter.start` is not called then;
//   - otherwise it calls `adapter.start({ cwd: projectPath, prompt, permissionMode, sessionId }, emit)` once
//     and answers 200 `application/x-ndjson`: one JSON `AgentEvent` per line, in the order emitted, the stream
//     ending after `end`. Events may be emitted before `start` returns, and later. The response is returned
//     as soon as the run is registered (the body streams); it does not wait for the end of the run;
//   - cancelling the response body (what a page reload does, Spike S2) calls the run's `stop()`; an event
//     emitted after the cancel is ignored without throwing.
// - `POST /runs/:runId/stop` answers 204 and calls the `stop()` of that run; for an unknown or an already
//   finished run it also answers 204 and calls nothing.
// - `stopAll()` (exported next to `handleApiRequest`, for app quit) calls the `stop()` of every running run.
// - Spike S2: no CORS header on the new routes either.

const adapter = {
  permissionModes: [{ value: 'plan', label: 'Plan' }],
  defaultPermissionMode: 'plan',
  start: vi.fn()
}

let dir: string
let projectsFile: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'p0-api-'))
  projectsFile = join(dir, 'projects.json')
  adapter.start.mockClear()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const call = (
  method: string,
  path: string,
  pickFolder: () => Promise<string | null> = () => Promise.reject(new Error('picker must not open'))
): Promise<Response> =>
  Promise.resolve(handleApiRequest(new Request(`p0://api${path}`, { method }), { projectsFile, pickFolder, adapter }))

const seed = (paths: string[]): Promise<void> => writeFile(projectsFile, JSON.stringify(paths))

const onDisk = async (): Promise<unknown> => JSON.parse(await readFile(projectsFile, 'utf8'))

describe('project routes', () => {
  it('chat AC3 — GET /projects answers an empty list when no project was added', async () => {
    const response = await call('GET', '/projects')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual([])
  })

  it('chat AC2 — GET /projects lists the stored projects in the order they were added', async () => {
    await seed(['/work/borealis', '/work/atlas'])

    const response = await call('GET', '/projects')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([
      { path: '/work/borealis', name: 'borealis' },
      { path: '/work/atlas', name: 'atlas' }
    ])
  })

  it('chat AC1 — GET /projects does not open the folder picker', async () => {
    const pickFolder = vi.fn(async () => '/work/atlas')

    await call('GET', '/projects', pickFolder)

    expect(pickFolder).not.toHaveBeenCalled()
  })

  it('chat AC1 — POST /projects opens the picker once and adds the picked folder, selected', async () => {
    const pickFolder = vi.fn(async () => '/work/atlas')

    const response = await call('POST', '/projects', pickFolder)

    expect(pickFolder).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({
      projects: [{ path: '/work/atlas', name: 'atlas' }],
      selected: '/work/atlas'
    })
    expect(await onDisk()).toEqual(['/work/atlas'])
  })

  it('chat AC1 — POST /projects appends the picked folder after the existing projects', async () => {
    await seed(['/work/atlas'])

    const response = await call('POST', '/projects', async () => '/work/borealis')

    expect(await response.json()).toEqual({
      projects: [
        { path: '/work/atlas', name: 'atlas' },
        { path: '/work/borealis', name: 'borealis' }
      ],
      selected: '/work/borealis'
    })
  })

  it('chat AC1 — POST /projects with a cancelled picker changes nothing and selects nothing', async () => {
    await seed(['/work/atlas'])

    const response = await call('POST', '/projects', async () => null)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      projects: [{ path: '/work/atlas', name: 'atlas' }],
      selected: null
    })
    expect(await onDisk()).toEqual(['/work/atlas'])
  })

  it('chat AC1 — POST /projects with a cancelled picker and no project does not create any project', async () => {
    const response = await call('POST', '/projects', async () => null)

    expect(await response.json()).toEqual({ projects: [], selected: null })
    expect(await call('GET', '/projects').then((r) => r.json())).toEqual([])
  })

  it('chat AC1 — POST /projects with a folder that is already a project selects it and adds no duplicate', async () => {
    await seed(['/work/atlas', '/work/borealis'])

    const response = await call('POST', '/projects', async () => '/work/atlas')

    expect(await response.json()).toEqual({
      projects: [
        { path: '/work/atlas', name: 'atlas' },
        { path: '/work/borealis', name: 'borealis' }
      ],
      selected: '/work/atlas'
    })
    expect(await onDisk()).toEqual(['/work/atlas', '/work/borealis'])
  })

  it('chat AC2 — a project added by POST is listed by a later GET (read from the file, no cache)', async () => {
    await call('POST', '/projects', async () => '/work/atlas')
    await call('POST', '/projects', async () => '/work/borealis')

    const response = await call('GET', '/projects')

    expect(await response.json()).toEqual([
      { path: '/work/atlas', name: 'atlas' },
      { path: '/work/borealis', name: 'borealis' }
    ])
  })
})

describe('transport facts (spike S2)', () => {
  it('chat AC1 — no response carries a CORS header', async () => {
    const responses = [
      await call('GET', '/projects'),
      await call('POST', '/projects', async () => '/work/atlas'),
      await call('GET', '/unknown')
    ]

    for (const response of responses) {
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
    }
  })

  it('chat AC1 — there is no OPTIONS route: a preflight is not answered with a success', async () => {
    const response = await call('OPTIONS', '/projects')

    expect(response.ok).toBe(false)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(response.headers.get('access-control-allow-methods')).toBeNull()
  })

  it('chat AC1 — an unknown path answers 404', async () => {
    const response = await call('GET', '/nothing-here')

    expect(response.status).toBe(404)
  })

  it('chat AC1 — the project routes never start the agent', async () => {
    await call('GET', '/projects')
    await call('POST', '/projects', async () => '/work/atlas')

    expect(adapter.start).not.toHaveBeenCalled()
  })
})

// --- Story 2: the run routes ---
type Emit = (event: AgentEvent) => void

interface FakeRun {
  runId: string
  emit: Emit
  stop: Mock<() => void>
}

const MODES = [
  { value: 'plan', label: 'Plan' },
  { value: 'dontAsk', label: "Don't ask" }
]

/** An adapter whose `start` records each run, so the test decides when events are emitted. */
function makeAdapter(onStart?: (emit: Emit) => void) {
  const runs: FakeRun[] = []
  const start = vi.fn((_run: unknown, emit: Emit) => {
    const run: FakeRun = { runId: '', emit, stop: vi.fn<() => void>() }
    runs.push(run)
    onStart?.(emit)
    return { stop: run.stop }
  })
  return { adapter: { permissionModes: MODES, defaultPermissionMode: 'dontAsk', start }, runs, start }
}

const request = (overrides: Partial<RunRequest> = {}): RunRequest => ({
  runId: 'run-1',
  projectPath: '/work/atlas',
  prompt: 'hello',
  permissionMode: 'plan',
  ...overrides
})

const post = (deps: ReturnType<typeof makeAdapter>, path: string, body?: unknown): Promise<Response> =>
  Promise.resolve(
    handleApiRequest(
      new Request(`p0://api${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      }),
      { projectsFile, pickFolder: () => Promise.reject(new Error('picker must not open')), adapter: deps.adapter }
    )
  )

const startRun = (deps: ReturnType<typeof makeAdapter>, overrides: Partial<RunRequest> = {}): Promise<Response> =>
  post(deps, '/runs', request(overrides))

const END: AgentEvent = { type: 'end', interrupted: false }

const linesOf = (text: string): unknown[] =>
  text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line))

describe('GET /agent', () => {
  it("chat AC8 — answers the adapter's permission modes and its default mode", async () => {
    const { adapter } = makeAdapter()

    const response = await Promise.resolve(
      handleApiRequest(new Request('p0://api/agent'), {
        projectsFile,
        pickFolder: () => Promise.reject(new Error('picker must not open')),
        adapter
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({ permissionModes: MODES, defaultPermissionMode: 'dontAsk' })
    expect(adapter.start).not.toHaveBeenCalled()
  })
})

describe('POST /runs', () => {
  afterEach(() => {
    // no run outlives its test
    stopAll()
  })

  it('chat AC5 — a project that is not in the store answers 400, and the agent is not started', async () => {
    await seed(['/work/atlas'])
    const deps = makeAdapter()

    const response = await startRun(deps, { projectPath: '/work/elsewhere' })

    expect(response.status).toBe(400)
    expect(deps.start).not.toHaveBeenCalled()
  })

  it('chat AC5 — with no project at all, the run is refused with 400', async () => {
    const deps = makeAdapter()

    const response = await startRun(deps)

    expect(response.status).toBe(400)
    expect(deps.start).not.toHaveBeenCalled()
  })

  it('chat AC10 — a permission mode the adapter does not offer answers 400, and the agent is not started', async () => {
    await seed(['/work/atlas'])
    const deps = makeAdapter()

    const response = await startRun(deps, { permissionMode: 'acceptEdits' })

    expect(response.status).toBe(400)
    expect(deps.start).not.toHaveBeenCalled()
  })

  it('chat AC5 — starts the agent in the project folder, with the prompt, the mode and the session', async () => {
    await seed(['/work/atlas', '/work/borealis'])
    const deps = makeAdapter((emit) => emit(END))

    const response = await startRun(deps, {
      projectPath: '/work/borealis',
      prompt: 'explain this',
      permissionMode: 'dontAsk',
      sessionId: 'session-9'
    })
    await response.text()

    expect(deps.start).toHaveBeenCalledTimes(1)
    expect(deps.start.mock.calls[0][0]).toEqual({
      cwd: '/work/borealis',
      prompt: 'explain this',
      permissionMode: 'dontAsk',
      sessionId: 'session-9'
    })
  })

  it('chat AC6 — without a session, the agent is started without one', async () => {
    await seed(['/work/atlas'])
    const deps = makeAdapter((emit) => emit(END))

    await (await startRun(deps)).text()

    expect((deps.start.mock.calls[0][0] as { sessionId?: string }).sessionId).toBeUndefined()
  })

  it('chat AC5 — answers 200 application/x-ndjson: the events emitted by the agent, one per line, ending with end', async () => {
    await seed(['/work/atlas'])
    const events: AgentEvent[] = [
      { type: 'session', sessionId: 's1' },
      { type: 'text', text: 'Hel' },
      { type: 'text', text: 'lo\nworld' },
      { type: 'action', kind: 'Read', target: 'README.md' },
      END
    ]
    const deps = makeAdapter((emit) => events.forEach(emit)) // emitted before `start` returns

    const response = await startRun(deps)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/x-ndjson')
    expect(linesOf(await response.text())).toEqual(events)
  })

  it('chat AC5 — events emitted later reach the reader as they come: the response does not wait for the end of the run', async () => {
    await seed(['/work/atlas'])
    const deps = makeAdapter()
    const response = await startRun(deps)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()

    deps.runs[0].emit({ type: 'text', text: 'first' })
    const chunk = await reader.read()
    expect(linesOf(decoder.decode(chunk.value))).toEqual([{ type: 'text', text: 'first' }])

    deps.runs[0].emit({ type: 'text', text: 'second' })
    deps.runs[0].emit(END)
    let rest = ''
    for (let step = await reader.read(); !step.done; step = await reader.read()) rest += decoder.decode(step.value)
    expect(linesOf(rest)).toEqual([{ type: 'text', text: 'second' }, END])
  })

  it('chat AC12 — two runs at once each get only their own events', async () => {
    await seed(['/work/atlas'])
    const deps = makeAdapter()
    const one = await startRun(deps, { runId: 'run-a' })
    const two = await startRun(deps, { runId: 'run-b' })

    deps.runs[1].emit({ type: 'text', text: 'for B' })
    deps.runs[0].emit({ type: 'text', text: 'for A' })
    deps.runs[0].emit(END)
    deps.runs[1].emit(END)

    expect(linesOf(await one.text())).toEqual([{ type: 'text', text: 'for A' }, END])
    expect(linesOf(await two.text())).toEqual([{ type: 'text', text: 'for B' }, END])
  })

  it('chat AC11 — cancelling the response body (a page reload) stops the run', async () => {
    await seed(['/work/atlas'])
    const deps = makeAdapter()
    const response = await startRun(deps)

    await response.body!.cancel()

    expect(deps.runs[0].stop).toHaveBeenCalledTimes(1)
  })

  it('chat AC11 — an event emitted after the stream was cancelled is ignored, without throwing', async () => {
    await seed(['/work/atlas'])
    const deps = makeAdapter()
    const response = await startRun(deps)
    await response.body!.cancel()

    expect(() => {
      deps.runs[0].emit({ type: 'text', text: 'too late' })
      deps.runs[0].emit({ type: 'end', interrupted: true })
    }).not.toThrow()
  })
})

describe('POST /runs/:runId/stop', () => {
  afterEach(() => {
    // no run outlives its test
    stopAll()
  })

  it('chat AC11 — answers 204 and stops that run, and only that run', async () => {
    await seed(['/work/atlas'])
    const deps = makeAdapter()
    await startRun(deps, { runId: 'run-a' })
    await startRun(deps, { runId: 'run-b' })

    const response = await post(deps, '/runs/run-a/stop')

    expect(response.status).toBe(204)
    expect(deps.runs[0].stop).toHaveBeenCalledTimes(1)
    expect(deps.runs[1].stop).not.toHaveBeenCalled()
  })

  it('chat AC11 — an unknown run id answers 204 and stops nothing', async () => {
    await seed(['/work/atlas'])
    const deps = makeAdapter()
    await startRun(deps, { runId: 'run-a' })

    const response = await post(deps, '/runs/nope/stop')

    expect(response.status).toBe(204)
    expect(deps.runs[0].stop).not.toHaveBeenCalled()
  })

  it('chat AC11 — a run that already finished answers 204', async () => {
    await seed(['/work/atlas'])
    const deps = makeAdapter((emit) => emit(END))
    await (await startRun(deps, { runId: 'run-a' })).text()

    const response = await post(deps, '/runs/run-a/stop')

    expect(response.status).toBe(204)
  })
})

describe('stopAll', () => {
  afterEach(() => {
    // no run outlives its test
    stopAll()
  })

  it('chat AC11 — stops every running run (app quit)', async () => {
    await seed(['/work/atlas'])
    const deps = makeAdapter()
    await startRun(deps, { runId: 'run-a' })
    await startRun(deps, { runId: 'run-b' })

    stopAll()

    expect(deps.runs[0].stop).toHaveBeenCalledTimes(1)
    expect(deps.runs[1].stop).toHaveBeenCalledTimes(1)
  })
})

describe('transport facts (spike S2), run routes', () => {
  afterEach(() => {
    // no run outlives its test
    stopAll()
  })

  it('chat AC5 — no response of the new routes carries a CORS header', async () => {
    await seed(['/work/atlas'])
    const deps = makeAdapter((emit) => emit(END))
    const responses = [
      await Promise.resolve(
        handleApiRequest(new Request('p0://api/agent'), {
          projectsFile,
          pickFolder: () => Promise.reject(new Error('picker must not open')),
          adapter: deps.adapter
        })
      ),
      await startRun(deps),
      await startRun(deps, { projectPath: '/work/elsewhere' }),
      await post(deps, '/runs/run-1/stop')
    ]

    expect(responses.map((response) => response.status)).toEqual([200, 200, 400, 204])
    for (const response of responses) {
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
    }
  })
})
