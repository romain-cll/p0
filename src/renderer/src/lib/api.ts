import type { AgentEvent, AgentInfo, Project, RunRequest } from '../../../shared/chat'

const API_BASE = 'p0://api'

async function fetchOk(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${API_BASE}${path}`, init)
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${response.status}`)
  return response
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return (await (await fetchOk(path, init)).json()) as T
}

export function listProjects(): Promise<Project[]> {
  return request('/projects')
}

/** Opens the folder picker in the main process; `selected` is null when the user cancels. */
export function addProject(): Promise<{ projects: Project[]; selected: string | null }> {
  return request('/projects', { method: 'POST' })
}

export function getAgent(): Promise<AgentInfo> {
  return request('/agent')
}

/** Starts one run and calls `onEvent` with each event as its line arrives; resolves when the stream ends. */
export async function startRun(runRequest: RunRequest, onEvent: (event: AgentEvent) => void): Promise<void> {
  const response = await fetchOk('/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(runRequest)
  })
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  const emitLine = (line: string): void => {
    if (line.trim() !== '') onEvent(JSON.parse(line) as AgentEvent)
  }

  for (let step = await reader.read(); !step.done; step = await reader.read()) {
    pending += decoder.decode(step.value, { stream: true })
    const lines = pending.split('\n')
    pending = lines.pop()!
    lines.forEach(emitLine)
  }
  emitLine(pending + decoder.decode())
}

export async function stopRun(runId: string): Promise<void> {
  await fetchOk(`/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST' })
}
