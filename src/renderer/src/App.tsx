import { useEffect, useReducer, useRef, useState } from 'react'
import { ActiveChat } from '@/components/ActiveChat'
import { ArtifactsPanel } from '@/components/ArtifactsPanel'
import { ChatHistory } from '@/components/ChatHistory'
import { ProjectRail } from '@/components/ProjectRail'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { addProject, getAgent, listProjects, startRun, stopRun } from '@/lib/api'
import { chatsReducer } from '@/lib/chats'
import type { AgentEvent, AgentInfo, Project } from '../../shared/chat'

export default function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [chatId, setChatId] = useState<string | null>(null)
  const [agent, setAgent] = useState<AgentInfo | null>(null)
  const [chats, dispatch] = useReducer(chatsReducer, {})
  // The id of the run in progress of each chat, by chat id: what Stop asks the main process to stop.
  const runIds = useRef(new Map<string, string>())

  useEffect(() => {
    void Promise.all([listProjects(), getAgent()]).then(([loaded, info]) => {
      setAgent(info)
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
    if (projectPath === null || agent === null) return
    const id = crypto.randomUUID()
    dispatch({ type: 'create', projectPath, chatId: id, permissionMode: agent.defaultPermissionMode })
    setChatId(id)
  }

  // A run keeps feeding its own chat, whichever chat is shown.
  const send = (text: string): void => {
    if (projectPath === null || chat === null) return
    const target = { projectPath, chatId: chat.id }
    const runId = crypto.randomUUID()
    let ended = false
    const onEvent = (event: AgentEvent): void => {
      ended ||= event.type === 'end'
      dispatch({ type: 'event', ...target, event })
    }

    runIds.current.set(chat.id, runId)
    dispatch({ type: 'send', ...target, text })
    startRun(
      { runId, projectPath, prompt: text, permissionMode: chat.permissionMode, sessionId: chat.sessionId },
      onEvent
    )
      .catch((error: unknown) => {
        onEvent({ type: 'error', message: error instanceof Error ? error.message : String(error) })
      })
      .then(() => {
        if (!ended) onEvent({ type: 'end', interrupted: false })
      })
  }

  const stop = (): void => {
    const runId = chat === null ? undefined : runIds.current.get(chat.id)
    if (runId !== undefined) void stopRun(runId)
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
            <ActiveChat hasProject={projectPath !== null} chat={chat} onSend={send} onStop={stop} />
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
