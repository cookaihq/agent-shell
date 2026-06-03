// Projects.tsx — 项目列表屏，对照 projects.html L19-31
import type { ProjectDTO } from '../api/types'
import { ProjectCard } from './ProjectCard'

interface ProjectsProps { projects: ProjectDTO[]; onOpenProject: (id: string) => void }

export function Projects({ projects, onOpenProject }: ProjectsProps) {
  return (
    <section className="section">
      <div className="section-head">
        <h1 className="section-title">项目</h1>
      </div>
      <div className="proj-row">
        {projects.map((p) => <ProjectCard key={p.id} project={p} onOpen={onOpenProject} />)}
      </div>
    </section>
  )
}
