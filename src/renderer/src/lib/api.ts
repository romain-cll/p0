import type { Project } from '../../../shared/chat'

const API_BASE = 'p0://api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init)
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${response.status}`)
  return (await response.json()) as T
}

export function listProjects(): Promise<Project[]> {
  return request('/projects')
}

/** Opens the folder picker in the main process; `selected` is null when the user cancels. */
export function addProject(): Promise<{ projects: Project[]; selected: string | null }> {
  return request('/projects', { method: 'POST' })
}
