import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Project } from '../../../shared/chat'

interface ProjectRailProps {
  projects: Project[]
  selectedPath: string | null
  onSelect: (path: string) => void
  onAdd: () => void
}

export function ProjectRail({ projects, selectedPath, onSelect, onAdd }: ProjectRailProps) {
  return (
    <section
      aria-label="Projects"
      className="flex w-14 shrink-0 flex-col items-center gap-2 rounded-xl border bg-card p-2"
    >
      {projects.map((project) => (
        <Button
          key={project.path}
          variant="secondary"
          size="icon-lg"
          aria-label={project.name}
          aria-current={project.path === selectedPath ? 'true' : undefined}
          className="size-9 rounded-lg text-sm aria-[current=true]:bg-blue-500 aria-[current=true]:text-white"
          onClick={() => onSelect(project.path)}
        >
          {project.name.charAt(0).toUpperCase()}
        </Button>
      ))}
      <Button variant="ghost" size="icon-lg" aria-label="Add project" className="size-9" onClick={onAdd}>
        <Plus />
      </Button>
    </section>
  )
}
