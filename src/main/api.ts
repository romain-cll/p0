import type { AgentEvent, RunRequest } from '../shared/chat'
import type { AgentAdapter } from './agents/agent'
import { addProject, listProjects } from './projects'

export interface ApiDeps {
  projectsFile: string
  pickFolder: () => Promise<string | null>
  adapter: AgentAdapter
}

/** The runs in progress, by run id. */
const runs = new Map<string, { stop(): void }>()

/** Stops every run in progress, for app quit. */
export function stopAll(): void {
  for (const run of runs.values()) run.stop()
}

/** Starts a run and streams its events as NDJSON, one `AgentEvent` per line, until `end`. */
function streamRun(adapter: AgentAdapter, { runId, projectPath, prompt, permissionMode, sessionId }: RunRequest): Response {
  const encoder = new TextEncoder()
  let finished = false

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: AgentEvent): void => {
        if (finished) return
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        if (event.type === 'end') {
          finished = true
          runs.delete(runId)
          controller.close()
        }
      }
      const run = adapter.start({ cwd: projectPath, prompt, permissionMode, sessionId }, emit)
      if (!finished) runs.set(runId, run)
    },
    // A page reload cancels the stream without aborting the request (spike S2): the run must stop here.
    cancel() {
      finished = true
      runs.get(runId)?.stop()
      runs.delete(runId)
    }
  })

  return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } })
}

export async function handleApiRequest(
  request: Request,
  { projectsFile, pickFolder, adapter }: ApiDeps
): Promise<Response> {
  const { pathname } = new URL(request.url)
  const route = `${request.method} ${pathname}`

  if (route === 'GET /projects') {
    return Response.json(await listProjects(projectsFile))
  }

  if (route === 'POST /projects') {
    const folder = await pickFolder()
    if (folder === null) {
      return Response.json({ projects: await listProjects(projectsFile), selected: null })
    }
    return Response.json(await addProject(projectsFile, folder))
  }

  if (route === 'GET /agent') {
    const { permissionModes, defaultPermissionMode } = adapter
    return Response.json({ permissionModes, defaultPermissionMode })
  }

  if (route === 'POST /runs') {
    const run = (await request.json().catch(() => null)) as RunRequest | null
    const projects = await listProjects(projectsFile)
    if (
      !run ||
      !projects.some((project) => project.path === run.projectPath) ||
      !adapter.permissionModes.some((mode) => mode.value === run.permissionMode)
    ) {
      return new Response(null, { status: 400 })
    }
    return streamRun(adapter, run)
  }

  const stop = /^\/runs\/([^/]+)\/stop$/.exec(pathname)
  if (request.method === 'POST' && stop) {
    runs.get(decodeURIComponent(stop[1]))?.stop()
    return new Response(null, { status: 204 })
  }

  return new Response(null, { status: 404 })
}
