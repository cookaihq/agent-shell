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
import { Home, type HomeAttachment } from '../entry/Home'
import { Projects } from '../entry/Projects'
import { SkillModal } from '../entry/SkillModal'
import { NewProjectModal } from '../shell/NewProjectModal'
import { Workspace } from '../workspace/Workspace'
import { RuntimeContext, useRuntimeReducer, CLI_MODELS } from '../workspace/runtimeState'
import type { ProjectDTO, SessionDTO, Engine } from '../api/types'

const DEFAULT_MODEL: Record<Engine, string> = { claude: 'opus', codex: 'gpt-5.5' }

// 进项目记住上次打开的会话（Issue 28）：按项目存最近活动会话 id。
const LAST_SESSION_KEY = 'agent-shell:last-session'
function loadLastSession(projectId: string): string | null {
  try { return (JSON.parse(localStorage.getItem(LAST_SESSION_KEY) ?? '{}') as Record<string, string>)[projectId] ?? null } catch { return null }
}
function rememberLastSession(projectId: string, sessionId: string): void {
  try {
    const m = JSON.parse(localStorage.getItem(LAST_SESSION_KEY) ?? '{}') as Record<string, string>
    m[projectId] = sessionId
    localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(m))
  } catch { /* noop */ }
}

type Phase =
  | { tag: 'loading' }
  | { tag: 'no-cli' }
  | { tag: 'home' }
  | { tag: 'projects' }
  | { tag: 'workspace'; project: ProjectDTO; session: SessionDTO; sessions: SessionDTO[]; initialMessage?: string; initialContextFiles?: string[] }

export function AppNav() {
  const [phase, setPhase] = useState<Phase>({ tag: 'loading' })
  const [projects, setProjects] = useState<ProjectDTO[]>([])
  const [showNewProject, setShowNewProject] = useState(false)
  const [showSkill, setShowSkill] = useState(false)
  const [skills, setSkills] = useState<string[]>([])
  // 已打开的会话 tab（Issue 23）：仅这些排成左侧 tab 条，其余留历史下拉；× 仅关 tab 不删会话。
  const [openSessionIds, setOpenSessionIds] = useState<string[]>([])
  // home runtime（Topbar 切换器 + 发送建会话用）
  const [runtime, rtDispatch] = useRuntimeReducer('claude', CLI_MODELS.claude[0].value)

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

  // 项目列表乐观改动序号：每次本地乐观改 projects（改名/新建）就 +1。
  // reloadProjects 是「发了就不管」的后台刷新——若它的 GET 在某次乐观改动【之前】发出、却在【之后】才返回，
  // 它携带的是改动前的旧快照，直接 setProjects 会把乐观更新覆盖回退（改名没同步到页签的根因）。
  // 故：发 GET 前记下序号，回来时若序号已变（期间发生过乐观改动）就丢弃这次旧快照，不覆盖。
  const projectsMutSeq = useRef(0)
  const reloadProjects = useCallback(async () => {
    const seq = projectsMutSeq.current
    const { projects } = await api.listProjects()
    if (projectsMutSeq.current === seq) setProjects(projects)   // 期间无乐观改动才采纳；否则保留更新的本地态
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

  // 进项目：listSessions（空则建默认会话） → workspace。落在「上次打开的会话」（Issue 28），无记录回落最新。
  const openProject = useCallback(async (project: ProjectDTO, initialMessage?: string) => {
    let sessions = (await api.listSessions(project.id)).sessions
    let session = sessions[0]
    if (!session) {
      const { sessionId } = await api.createSession({ projectId: project.id, engine: runtime.agent, model: DEFAULT_MODEL[runtime.agent] })
      sessions = (await api.listSessions(project.id)).sessions
      session = sessions.find((s) => s.id === sessionId) ?? sessions[0]
    } else {
      const lastId = loadLastSession(project.id)
      const last = lastId ? sessions.find((s) => s.id === lastId) : undefined
      if (last) session = last
    }
    rememberLastSession(project.id, session.id)
    setOpenSessionIds([session.id])   // 进项目只把当前会话上 tab，其余留历史下拉（Issue 23）
    setPhase({ tag: 'workspace', project, session, sessions, initialMessage })
  }, [runtime.agent])

  const openProjectById = useCallback(async (id: string) => {
    const p = projects.find((x) => x.id === id)
    if (p) await openProject(p)
  }, [projects, openProject])

  // home 发送 = 建项目 + 落盘暂存附件到 attachments/ + 建会话 + 进 workspace 自动提交首条
  const homeSend = useCallback(async (text: string, staged: HomeAttachment[] = []) => {
    const { projectId, path } = await api.createProject('未命名项目', skills)
    // 暂存附件落盘到 <project>/attachments/：path 项 fs 复制、blob 项上传字节；都收相对路径
    const contextFiles: string[] = []
    const pathItems = staged.filter((s) => s.kind === 'path')
    if (pathItems.length > 0) {
      const { imported } = await api.importFiles(projectId, pathItems.map((s) => s.path), 'attachments')
      contextFiles.push(...imported.map((i) => `attachments/${i.name}`))
    }
    for (const s of staged) {
      if (s.kind !== 'blob') continue
      try { const { file } = await api.uploadPaste(projectId, s.blob, s.name); contextFiles.push(file.path) }
      catch { /* 单个附件上传失败不阻塞发送 */ }
    }
    const { sessionId } = await api.createSession({ projectId, engine: runtime.agent, model: DEFAULT_MODEL[runtime.agent] })
    const sessions = (await api.listSessions(projectId)).sessions
    const session = sessions.find((s) => s.id === sessionId) ?? sessions[0]
    const project: ProjectDTO = { id: projectId, name: '未命名项目', path, createdAt: Date.now(), status: 'idle', engine: runtime.agent }
    projectsMutSeq.current++   // 标记乐观改动：防在途旧 reload 把新建项目覆盖掉
    setProjects((prev) => prev.some((x) => x.id === projectId) ? prev : [project, ...prev])   // 乐观入列：页签标题/改名按 id 查得到
    setPhase({ tag: 'workspace', project, session, sessions, initialMessage: text, initialContextFiles: contextFiles })
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

  // 改名回传：乐观更新 projects（页签标题/项目标题都按 id 现查 projects → 立即同步、单一数据源）+ 同步 phase 快照
  const onRenameActiveProject = useCallback((projectId: string, name: string) => {
    projectsMutSeq.current++   // 标记乐观改动：防在途旧 reload 把改名覆盖回退（页签退回旧名的根因）
    setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, name } : p)))
    setPhase((prev) => (prev.tag === 'workspace' && prev.project.id === projectId
      ? { ...prev, project: { ...prev.project, name } } : prev))
  }, [])

  // 会话属性修改（改名 title / 置顶 pinned）：先乐观更新内存里的会话清单（列表 + 页签即时刷新）再 PATCH 落库。
  // sessions 是标题/置顶的唯一数据源（进项目时 listSessions 一次性缓存），只 PATCH 不回写就会「后台改了界面没变」。
  // 对齐项目改名 onRenameActiveProject 的乐观写法，根治该 stale-snapshot 问题。
  const onPatchSession = useCallback((id: string, patch: { title?: string; pinned?: boolean }) => {
    setPhase((prev) => (prev.tag === 'workspace'
      ? {
          ...prev,
          sessions: prev.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s)),
          session: prev.session.id === id ? { ...prev.session, ...patch } : prev.session,
        }
      : prev))
    void api.patchSession(id, patch)
  }, [])

  const handleProjectCreated = useCallback(async (id: string) => {
    setShowNewProject(false)
    const ps = await reloadProjects()
    const p = ps.find((x) => x.id === id)
    if (p) await openProject(p)
  }, [reloadProjects, openProject])

  // workspace 内切换会话（不重新提交首条）：上 tab + 记住为该项目上次会话
  const onSelectSession = useCallback((id: string) => {
    setOpenSessionIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
    setPhase((prev) => {
      if (prev.tag !== 'workspace') return prev
      const session = prev.sessions.find((s) => s.id === id) ?? prev.session
      rememberLastSession(prev.project.id, session.id)
      return { ...prev, session, initialMessage: undefined }
    })
  }, [])

  // 关闭会话 tab（Issue 23）：仅从 tab 条移除，会话仍在库/历史下拉；若关的是当前 → 切到相邻打开的 tab
  const onCloseSessionTab = useCallback((id: string) => {
    setOpenSessionIds((prev) => {
      const idx = prev.indexOf(id)
      if (idx === -1) return prev
      const next = prev.filter((x) => x !== id)
      if (next.length === 0) return prev   // 不允许关掉最后一个 tab
      setPhase((ph) => {
        if (ph.tag !== 'workspace' || ph.session.id !== id) return ph   // 关的不是当前 → 仅移除 tab
        const fallbackId = next[Math.min(idx, next.length - 1)]
        const session = ph.sessions.find((s) => s.id === fallbackId) ?? ph.session
        rememberLastSession(ph.project.id, session.id)
        return { ...ph, session, initialMessage: undefined }
      })
      return next
    })
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
    const { project, session, sessions, initialMessage, initialContextFiles } = phase
    // 项目标题与顶部页签同源：都按 id 现查 live projects（改名后唯一数据源即时刷新），projects 暂缺时回落 phase 快照。
    const liveProjectName = projects.find((p) => p.id === project.id)?.name ?? project.name
    const newSession = async () => {
      const { sessionId } = await api.createSession({ projectId: project.id, engine: runtime.agent, model: DEFAULT_MODEL[runtime.agent] })
      const ss = (await api.listSessions(project.id)).sessions
      const found = ss.find((s) => s.id === sessionId) ?? ss[0]
      if (found) {
        setOpenSessionIds((prev) => (prev.includes(found.id) ? prev : [...prev, found.id]))
        rememberLastSession(project.id, found.id)
        setPhase({ tag: 'workspace', project, session: found, sessions: ss, initialMessage: undefined })
      }
    }
    // 真删除会话（区别于 onCloseSessionTab 仅关 tab）：后端停 query + 删库（会话行 + 历史消息 + usage），前端移除 tab/列表。
    // 删的是当前会话 → 切到相邻；删的是项目最后一个会话 → 自动新建空会话（项目始终至少一个会话，沿用 openProject 约定）。
    const deleteSession = async (id: string) => {
      void api.deleteSession(id).catch(() => {})
      const remaining = sessions.filter((s) => s.id !== id)
      setOpenSessionIds((prev) => prev.filter((x) => x !== id))
      if (session.id !== id) {
        setPhase((prev) => (prev.tag === 'workspace' ? { ...prev, sessions: remaining } : prev))
        return
      }
      if (remaining.length > 0) {
        const stillOpen = openSessionIds.filter((x) => x !== id && remaining.some((s) => s.id === x))
        const next = (stillOpen.length ? remaining.find((s) => s.id === stillOpen[0]) : remaining[0]) ?? remaining[0]
        setOpenSessionIds((prev) => (prev.includes(next.id) ? prev : [...prev, next.id]))
        rememberLastSession(project.id, next.id)
        setPhase((prev) => (prev.tag === 'workspace' ? { ...prev, session: next, sessions: remaining, initialMessage: undefined } : prev))
      } else {
        const { sessionId } = await api.createSession({ projectId: project.id, engine: runtime.agent, model: DEFAULT_MODEL[runtime.agent] })
        const ss = (await api.listSessions(project.id)).sessions
        const found = ss.find((s) => s.id === sessionId) ?? ss[0]
        if (found) {
          setOpenSessionIds([found.id])
          rememberLastSession(project.id, found.id)
          setPhase({ tag: 'workspace', project, session: found, sessions: ss, initialMessage: undefined })
        }
      }
    }
    return (
      <>
        <Workspace
          key={session.id}
          projectId={project.id}
          projectName={liveProjectName}
          projectPath={project.path}
          sessionId={session.id}
          engine={session.engine}
          model={session.model}
          sessions={sessions}
          openSessionIds={openSessionIds}
          initialMessage={initialMessage}
          initialContextFiles={initialContextFiles}
          chrome={chromeEl}
          onSelectSession={onSelectSession}
          onCloseSessionTab={onCloseSessionTab}
          onNewSession={() => void newSession()}
          onBack={() => void goHome()}
          onNewProject={() => setShowNewProject(true)}
          onRename={(name) => onRenameActiveProject(project.id, name)}
          onPatchSession={onPatchSession}
          onDeleteSession={(id) => void deleteSession(id)}
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
          : <Home projects={projects} onSend={(t, staged) => void homeSend(t, staged)} onOpenProject={(id) => void openProjectById(id)} onViewAll={() => void goProjects()} skillCount={skills.length} onOpenSkillModal={() => setShowSkill(true)} />}
      </EntryShell>
      {showNewProject && <NewProjectModal onClose={() => setShowNewProject(false)} onCreated={(id) => void handleProjectCreated(id)} />}
      {showSkill && <SkillModal initialSelected={skills} onClose={() => setShowSkill(false)} onDone={(s) => { setSkills(s); setShowSkill(false) }} />}
    </RuntimeContext.Provider>
  )
}
