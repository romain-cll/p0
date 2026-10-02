import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addProject, listProjects } from './api'

// `chat AC<n>` refers to the acceptance criteria of docs/features/claude-code-chat.md.
//
// Contracts these tests rely on (src/renderer/src/lib/api.ts), story 1 only:
// - the module talks to the main process with the global `fetch` on `p0://api` (API_BASE);
// - `listProjects(): Promise<Project[]>` does `GET p0://api/projects` and returns the parsed JSON;
// - `addProject(): Promise<{ projects: Project[]; selected: string | null }>` does
//   `POST p0://api/projects` and returns the parsed JSON (`selected` is null when the user cancels);
// - both reject when the response is not ok;
// - `Project` is `{ path: string; name: string }` (src/shared/chat.ts).
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
