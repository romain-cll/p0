import type { AgentAdapter } from './agents/agent'
import { addProject, listProjects } from './projects'

export interface ApiDeps {
  projectsFile: string
  pickFolder: () => Promise<string | null>
  // Used by the run routes (story 2).
  adapter?: AgentAdapter
}

export async function handleApiRequest(
  request: Request,
  { projectsFile, pickFolder }: ApiDeps
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

  return new Response(null, { status: 404 })
}
