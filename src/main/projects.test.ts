// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addProject, listProjects } from './projects'

// `chat AC<n>` refers to the acceptance criteria of docs/features/claude-code-chat.md.
//
// Contracts these tests rely on (src/main/projects.ts):
// - `listProjects(file: string): Promise<Project[]>`
//   `Project` is `{ path: string; name: string }` (src/shared/chat.ts); `name` is `basename(path)`.
//   A missing file means `[]`. Nothing is cached in memory: each call reads the disk.
// - `addProject(file: string, folder: string): Promise<{ projects: Project[]; selected: string }>`
//   Appends `folder` at the end of the list and writes the file. `selected` is the project's path.
//   A folder that is already in the list changes nothing and is returned as `selected`.
// - `file` is `<userData>/projects.json`: a JSON array of absolute paths, in the order they were
//   added. The parent directory of `file` exists.
// The functions may be synchronous or asynchronous: the tests `await` every call.

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'p0-projects-'))
  file = join(dir, 'projects.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const onDisk = async (): Promise<unknown> => JSON.parse(await readFile(file, 'utf8'))

describe('projects store', () => {
  it('chat AC2 — a missing file means an empty list', async () => {
    expect(await listProjects(file)).toEqual([])
  })

  it('chat AC1 — adding a folder lists it, named after the folder (basename)', async () => {
    const result = await addProject(file, '/Users/someone/work/atlas')

    expect(result.selected).toBe('/Users/someone/work/atlas')
    expect(result.projects).toEqual([{ path: '/Users/someone/work/atlas', name: 'atlas' }])
    expect(await listProjects(file)).toEqual([{ path: '/Users/someone/work/atlas', name: 'atlas' }])
  })

  it('chat AC1 — the file is a JSON array of absolute paths', async () => {
    await addProject(file, '/Users/someone/work/atlas')

    expect(await onDisk()).toEqual(['/Users/someone/work/atlas'])
  })

  it('chat AC1 — adding a folder that is already a project selects it and creates no duplicate', async () => {
    await addProject(file, '/work/atlas')
    await addProject(file, '/work/borealis')

    const again = await addProject(file, '/work/atlas')

    expect(again.selected).toBe('/work/atlas')
    expect(again.projects.map((project) => project.path)).toEqual(['/work/atlas', '/work/borealis'])
    expect(await onDisk()).toEqual(['/work/atlas', '/work/borealis'])
  })

  it('chat AC1 — two folders with the same name but different paths are two projects', async () => {
    await addProject(file, '/work/a/app')
    const result = await addProject(file, '/work/b/app')

    expect(result.selected).toBe('/work/b/app')
    expect(result.projects).toEqual([
      { path: '/work/a/app', name: 'app' },
      { path: '/work/b/app', name: 'app' }
    ])
  })

  it('chat AC2 — projects added one after the other are listed in that order, read again from the same file', async () => {
    await addProject(file, '/work/borealis')
    await addProject(file, '/work/atlas')
    await addProject(file, '/work/cobalt')

    expect(await listProjects(file)).toEqual([
      { path: '/work/borealis', name: 'borealis' },
      { path: '/work/atlas', name: 'atlas' },
      { path: '/work/cobalt', name: 'cobalt' }
    ])
    expect(await onDisk()).toEqual(['/work/borealis', '/work/atlas', '/work/cobalt'])
  })

  it('chat AC2 — there is no in-memory cache: a change made to the file is seen by the next call', async () => {
    await addProject(file, '/work/atlas')
    expect(await listProjects(file)).toHaveLength(1)

    await writeFile(file, JSON.stringify(['/work/cobalt', '/work/atlas']))

    expect(await listProjects(file)).toEqual([
      { path: '/work/cobalt', name: 'cobalt' },
      { path: '/work/atlas', name: 'atlas' }
    ])
  })

  it('chat AC2 — a folder added after a manual edit of the file goes after the existing ones', async () => {
    await writeFile(file, JSON.stringify(['/work/cobalt']))

    const result = await addProject(file, '/work/atlas')

    expect(result.projects.map((project) => project.path)).toEqual(['/work/cobalt', '/work/atlas'])
  })
})
