// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from './api'

// `chat AC<n>` refers to the acceptance criteria of docs/features/claude-code-chat.md.
//
// Contracts these tests rely on (src/main/api.ts), story 1 only (the run routes are story 2):
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
