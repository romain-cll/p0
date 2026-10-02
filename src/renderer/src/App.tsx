import { useEffect, useReducer, useState } from 'react'
import { ActiveChat } from '@/components/ActiveChat'
import { ArtifactsPanel } from '@/components/ArtifactsPanel'
import { ChatHistory } from '@/components/ChatHistory'
import { ProjectRail } from '@/components/ProjectRail'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { addProject, listProjects } from '@/lib/api'
import { chatsReducer } from '@/lib/chats'
import type { Project } from '../../shared/chat'

// Story 1 has no `GET /agent` yet: the default mode is fixed here, until `AgentInfo.defaultPermissionMode` replaces it.
const DEFAULT_PERMISSION_MODE = 'plan'

export default function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [chatId, setChatId] = useState<string | null>(null)
  const [chats, dispatch] = useReducer(chatsReducer, {})

  useEffect(() => {
    void listProjects().then((loaded) => {
      setProjects(loaded)
      setProjectPath(loaded[0]?.path ?? null)
    })
  }, [])

  const selectProject = (path: string): void => {
    setProjectPath(path)
    setChatId(null)
  }

  const add = async (): Promise<void> => {
    const { projects: updated, selected } = await addProject()
    setProjects(updated)
    if (selected !== null) selectProject(selected)
  }

  const createChat = (): void => {
    if (projectPath === null) return
    const id = crypto.randomUUID()
    dispatch({ type: 'create', projectPath, chatId: id, permissionMode: DEFAULT_PERMISSION_MODE })
    setChatId(id)
  }

  const projectChats = projectPath === null ? null : (chats[projectPath] ?? [])
  const chat = projectChats?.find((candidate) => candidate.id === chatId) ?? null

  return (
    <div className="flex h-full flex-col">
      <div aria-hidden="true" data-testid="title-bar" className="h-10 shrink-0 [app-region:drag]" />
      <div className="flex min-h-0 flex-1 gap-2 px-2 pb-2">
        <ProjectRail
          projects={projects}
          selectedPath={projectPath}
          onSelect={selectProject}
          onAdd={() => void add()}
        />
        <ChatHistory
          chats={projectChats}
          selectedId={chatId}
          onSelect={setChatId}
          onCreate={createChat}
        />
        <ResizablePanelGroup orientation="horizontal" className="min-w-0 flex-1">
          <ResizablePanel minSize={360}>
            <ActiveChat hasProject={projectPath !== null} chat={chat} />
          </ResizablePanel>
          <ResizableHandle className="w-2 bg-transparent after:hidden" />
          <ResizablePanel minSize={320} defaultSize={400} groupResizeBehavior="preserve-pixel-size">
            <ArtifactsPanel />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  )
}
