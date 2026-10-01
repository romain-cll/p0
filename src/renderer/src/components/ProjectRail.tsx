import { Button } from '@/components/ui/button'
import type { Project } from '@/data/projects'

interface ProjectRailProps {
  projects: Project[]
  selectedIndex: number
  onSelect: (index: number) => void
}

export function ProjectRail({ projects, selectedIndex, onSelect }: ProjectRailProps) {
  return (
    <section
      aria-label="Projects"
      className="flex w-14 shrink-0 flex-col items-center gap-2 rounded-xl border bg-card p-2"
    >
      {projects.map((project, index) => (
        <Button
          key={project.name}
          variant="secondary"
          size="icon-lg"
          aria-label={project.name}
          aria-current={index === selectedIndex ? 'true' : undefined}
          className="size-9 rounded-lg text-sm aria-[current=true]:bg-blue-500 aria-[current=true]:text-white"
          onClick={() => onSelect(index)}
        >
          {project.name.charAt(0).toUpperCase()}
        </Button>
      ))}
    </section>
  )
}
