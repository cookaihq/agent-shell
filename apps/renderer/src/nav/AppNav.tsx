// AppNav.tsx — 顶层导航状态机（替换 Bootstrap）
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api/client'
import {
  loadTabs, saveTabs, syncTabsToView, closeTab as closeTabPure, pruneProjects,
  type TabsState, type ChromeTab, type TabView,
} from '../shell/workspaceTabs'
import { EntryShell } from '../shell/EntryShell'
import { Chrome } from '../shell/Chrome'
import { Rail } from '../shell/Rail'
import { Topbar } from '../shell/Topbar'
import { Home } from '../entry/Home'
import { Projects } from '../entry/Projects'
import { SkillModal } from '../entry/SkillModal'
import { NewProjectModal } from '../shell/NewProjectModal'
import { Workspace } from '../workspace/Workspace'
import { RuntimeContext, useRuntimeReducer, CLI_MODELS } from '../workspace/runtimeState'
import type { ProjectDTO, SessionDTO, Engine } from '../api/types'

const DEFAULT_MODEL: Record<Engine, string> = { claude: 'opus', codex: 'gpt-5.5' }

type Phase =
  | { tag: 'loading' }
  | { tag: 'no-cli' }
  | { tag: 'home' }
  | { tag: 'projects' }
  | { tag: 'workspace'; project: ProjectDTO; session: SessionDTO; sessions: SessionDTO[]; initialMessage?: string }

export function AppNav() {
  const [phase, setPhase] = useState<Phase>({ tag: 'loading' })
  const [projects, setProjects] = useState<ProjectDTO[]>([])
  const [showNewProject, setShowNewProject] = useState(false)
  const [showSkill, setShowSkill] = useState(false)
  const [skills, setSkills] = useState<string[]>([])
  // home runtime（Topbar 切换器 + 发送建会话用）
  const [runtime, rtDispatch] = useRuntimeReducer('claude', CLI_MODELS.claude[0])

  // 顶部页签：独立持久状态（localStorage），与 phase 解耦——phase 当"路由"，每次变就把页签列表与之对账。
  const [tabs, setTabs] = useState<TabsState>(() => loadTabs(Date.now()))
  useEffect(() => { saveTabs(tabs) }, [tabs])
  // 首渲染（tabs=持久值）捕获"上次激活的项目"，供引擎门通过后自动重进；只设一次。
  const bootProjectId = useRef<string | null>(null)
  if (bootProjectId.current === null) {
    const a = tabs.tabs.find((t) => t.id === tabs.activeTabId)
    bootProjectId.current = a && a.kind === 'project' ? a.projectId : ''
  }
  // phase → tabs 对账：home/projects 归 home 页签，workspace 归该项目页签（返回只激活、不关；× 才关）。
  useEffect(() => {
    const v: TabView | null =
      phase.tag === 'home' || phase.tag === 'projects' ? { kind: 'home' }
        : phase.tag === 'workspace' ? { kind: 'project', projectId: phase.project.id }
          : null
    if (v) setTabs((s) => syncTabsToView(s, v, Date.now()))
  }, [phase])

  const reloadProjects = useCallback(async () => {
    const { projects } = await api.listProjects()
    setProjects(projects)
    return projects
  }, [])

  const boot = useCallback(async () => {
    setPhase({ tag: 'loading' })
    try {
      const { engines } = await api.engines()
      if (!Object.values(engines).some(Boolean)) { setPhase({ tag: 'no-cli' }); return }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'cli_not_found') { setPhase({ tag: 'no-cli' }); return }
      setPhase({ tag: 'no-cli' }); return
    }
    const ps = await reloadProjects()
    setTabs((s) => pruneProjects(s, new Set(ps.map((p) => p.id))))   // 丢掉指向已删项目的页签
    setPhase({ tag: 'home' })
  }, [reloadProjects])
  useEffect(() => { void boot() }, [boot])

  // 重启自动重进：boot 到 home + projects 就绪后，若上次激活的是仍存在的项目页签 → 自动进该项目（只一次）。
  const rebootedRef = useRef(false)
  useEffect(() => {
    if (rebootedRef.current || phase.tag !== 'home') return
    rebootedRef.current = true
    const pid = bootProjectId.current
    if (!pid) return
    const p = projects.find((x) => x.id === pid)
    if (p) void openProject(p)
    // openProject 见下方定义；effect 在 boot 之后才跑，闭包已就绪
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, projects])

  // 进项目：listSessions（空则建默认会话） → workspace
  const openProject = useCallback(async (project: ProjectDTO, initialMessage?: string) => {
    let sessions = (await api.listSessions(project.id)).sessions
    let session = sessions[0]
    if (!session) {
      const { sessionId } = await api.createSession({ projectId: project.id, engine: runtime.agent, model: DEFAULT_MODEL[runtime.agent] })
      sessions = (await api.listSessions(project.id)).sessions
      session = sessions.find((s) => s.id === sessionId) ?? sessions[0]
    }
    setPhase({ tag: 'workspace', project, session, sessions, initialMessage })
  }, [runtime.agent])

  const openProjectById = useCallback(async (id: string) => {
    const p = projects.find((x) => x.id === id)
    if (p) await openProject(p)
  }, [projects, openProject])

  // home 发送 = 建项目 + 建会话 + 进 workspace 自动提交首条
  const homeSend = useCallback(async (text: string) => {
    const { projectId, path } = await api.createProject('未命名项目', skills)
    const { sessionId } = await api.createSession({ projectId, engine: runtime.agent, model: DEFAULT_MODEL[runtime.agent] })
    const sessions = (await api.listSessions(projectId)).sessions
    const session = sessions.find((s) => s.id === sessionId) ?? sessions[0]
    const project: ProjectDTO = { id: projectId, name: '未命名项目', path, createdAt: Date.now(), status: 'idle', engine: runtime.agent }
    setProjects((prev) => prev.some((x) => x.id === projectId) ? prev : [project, ...prev])   // 乐观入列：页签标题/改名按 id 查得到
    setPhase({ tag: 'workspace', project, session, sessions, initialMessage: text })
  }, [runtime.agent, skills])

  // 先切视图（本地状态，必定生效）再后台刷新——导航不被网络刷新挟持，刷新失败也不会把人卡在 workspace。
  const goHome = useCallback(() => { setPhase({ tag: 'home' }); void reloadProjects().catch(() => {}) }, [reloadProjects])
  const goProjects = useCallback(() => { setPhase({ tag: 'projects' }); void reloadProjects().catch(() => {}) }, [reloadProjects])

  // —— 页签交互 ——
  const onSelectTab = useCallback((tab: ChromeTab) => {
    if (tab.kind === 'home') goHome()
    else void openProjectById(tab.projectId)
  }, [goHome, openProjectById])

  const onCloseTab = useCallback((id: string) => {
    const { state, nextView } = closeTabPure(tabs, id, Date.now())
    setTabs(state)
    if (nextView) { if (nextView.kind === 'home') goHome(); else void openProjectById(nextView.projectId) }
  }, [tabs, goHome, openProjectById])

  // 改名回传：乐观更新 projects（页签标题按 id 现查 → 立即同步）+ 同步当前 workspace phase 的快照
  const onRenameActiveProject = useCallback((projectId: string, name: string) => {
    setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, name } : p)))
    setPhase((prev) => (prev.tag === 'workspace' && prev.project.id === projectId
      ? { ...prev, project: { ...prev.project, name } } : prev))
  }, [])

  const handleProjectCreated = useCallback(async (id: string) => {
    setShowNewProject(false)
    const ps = await reloadProjects()
    const p = ps.find((x) => x.id === id)
    if (p) await openProject(p)
  }, [reloadProjects, openProject])

  // workspace 内切换会话（不重新提交首条）
  const onSelectSession = useCallback((id: string) => {
    setPhase((prev) => prev.tag === 'workspace'
      ? { ...prev, session: prev.sessions.find((s) => s.id === id) ?? prev.session, initialMessage: undefined }
      : prev)
  }, [])

  // —— 渲染 ——
  if (phase.tag === 'loading') return <div className="boot-msg">正在初始化…</div>
  if (phase.tag === 'no-cli') return <div className="boot-msg">未检测到 claude / codex CLI，请先安装后重启。</div>

  // 顶部页签条：entry / workspace 两个壳共用同一份（持久状态在 AppNav），保证页签连续不丢。
  const chromeEl = (
    <Chrome
      tabs={tabs.tabs}
      activeTabId={tabs.activeTabId}
      projects={projects}
      onSelectTab={onSelectTab}
      onCloseTab={onCloseTab}
      onNewTab={() => goHome()}
    />
  )

  if (phase.tag === 'workspace') {
    const { project, session, sessions, initialMessage } = phase
    const newSession = async () => {
      const { sessionId } = await api.createSession({ projectId: project.id, engine: runtime.agent, model: DEFAULT_MODEL[runtime.agent] })
      const ss = (await api.listSessions(project.id)).sessions
      const found = ss.find((s) => s.id === sessionId) ?? ss[0]
      if (found) setPhase({ tag: 'workspace', project, session: found, sessions: ss, initialMessage: undefined })
    }
    return (
      <>
        <Workspace
          key={session.id}
          projectId={project.id}
          projectName={project.name}
          sessionId={session.id}
          engine={session.engine}
          model={session.model}
          sessions={sessions}
          initialMessage={initialMessage}
          chrome={chromeEl}
          onSelectSession={onSelectSession}
          onNewSession={() => void newSession()}
          onBack={() => void goHome()}
          onNewProject={() => setShowNewProject(true)}
          onRename={(name) => onRenameActiveProject(project.id, name)}
        />
        {showNewProject && <NewProjectModal onClose={() => setShowNewProject(false)} onCreated={(id) => void handleProjectCreated(id)} />}
      </>
    )
  }

  // entry 视图（home / projects）
  const active = phase.tag === 'projects' ? 'projects' : 'home'
  return (
    <RuntimeContext.Provider value={{ runtime, dispatch: rtDispatch }}>
      <EntryShell
        chrome={chromeEl}
        rail={<Rail active={active} onNewProject={() => setShowNewProject(true)} onHome={() => void goHome()} onProjects={() => void goProjects()} />}
        topbar={<Topbar />}
      >
        {phase.tag === 'projects'
          ? <Projects projects={projects} onOpenProject={(id) => void openProjectById(id)} />
          : <Home projects={projects} onSend={(t) => void homeSend(t)} onOpenProject={(id) => void openProjectById(id)} onViewAll={() => void goProjects()} skillCount={skills.length} onOpenSkillModal={() => setShowSkill(true)} />}
      </EntryShell>
      {showNewProject && <NewProjectModal onClose={() => setShowNewProject(false)} onCreated={(id) => void handleProjectCreated(id)} />}
      {showSkill && <SkillModal initialSelected={skills} onClose={() => setShowSkill(false)} onDone={(s) => { setSkills(s); setShowSkill(false) }} />}
    </RuntimeContext.Provider>
  )
}
