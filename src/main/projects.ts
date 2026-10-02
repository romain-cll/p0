import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import type { Project } from '../shared/chat'

const toProjects = (paths: string[]): Project[] => paths.map((path) => ({ path, name: basename(path) }))

async function readPaths(file: string): Promise<string[]> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as string[]
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export async function listProjects(file: string): Promise<Project[]> {
  return toProjects(await readPaths(file))
}

export async function addProject(
  file: string,
  folder: string
): Promise<{ projects: Project[]; selected: string }> {
  const paths = await readPaths(file)
  if (!paths.includes(folder)) {
    paths.push(folder)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(paths))
  }
  return { projects: toProjects(paths), selected: folder }
}
