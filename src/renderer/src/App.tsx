import { useState } from 'react'
import { ActiveChat } from '@/components/ActiveChat'
import { ArtifactsPanel } from '@/components/ArtifactsPanel'
import { ChatHistory } from '@/components/ChatHistory'
import { ProjectRail } from '@/components/ProjectRail'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { projects } from '@/data/projects'

export default function App() {
  const [projectIndex, setProjectIndex] = useState(0)
  const [chatIndex, setChatIndex] = useState<number | null>(null)

  const selectProject = (index: number): void => {
    setProjectIndex(index)
    setChatIndex(null)
  }

  return (
    <div className="flex h-full flex-col">
      <div aria-hidden="true" data-testid="title-bar" className="h-10 shrink-0 [app-region:drag]" />
      <div className="flex min-h-0 flex-1 gap-2 px-2 pb-2">
        <ProjectRail projects={projects} selectedIndex={projectIndex} onSelect={selectProject} />
        <ChatHistory
          chats={projects[projectIndex].chats}
          selectedIndex={chatIndex}
          onSelect={setChatIndex}
        />
        <ResizablePanelGroup orientation="horizontal" className="min-w-0 flex-1">
          <ResizablePanel minSize={360}>
            <ActiveChat />
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
