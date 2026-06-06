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
import { Integrations } from '../entry/Integrations'
import { TaskAutomation } from '../automation/TaskAutomation'
import { SkillModal } from '../entry/SkillModal'
import { NewProjectModal } from '../shell/NewProjectModal'
import { Workspace } from '../workspace/Workspace'
import { applySessionRuntime, type SessionRuntimeCfg } from '../workspace/sessionRuntimeSync'
import { RuntimeContext, useRuntimeReducer, CLI_MODELS } from '../workspace/runtimeState'
import type { ProjectDTO, SessionDTO, Engine } from '../api/types'

const DEFAULT_MODEL: Record<Engine, string> = { claude: 'opus', codex: 'gpt-5.5' }

// 从持久化 config 中取引擎默认模型，回落到 DEFAULT_MODEL
function seedModel(engine: Engine, engineModels: Record<string, string>): string {
  return engineModels[engine] ?? DEFAULT_MODEL[engine]
}

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
  | { tag: 'integrations' }
  | { tag: 'automations' }
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
  // 持久化的每引擎默认模型（来自 config.json engineModels）；新建会话用它作 model，回落 DEFAULT_MODEL
  const [engineModels, setEngineModels] = useState<Record<string, string>>({})

  // 顶部页签：独立持久状态（localStorage），与 phase 解耦——phase 当"路由"，每次变就把页签列表与之对账。
  const [tabs, setTabs] = useState<TabsState>(() => loadTabs(Date.now()))
  useEffect(() => { saveTabs(tabs) }, [tabs])
  // 首渲染（tabs=持久值）捕获"上次激活的项目"，供引擎门通过后自动重进；只设一次。
  const bootProjectId = useRef<string | null>(null)
  if (bootProjectId.current === null) {
    const a = tabs.tabs.find((t) => t.id === tabs.activeTabId)
    bootProjectId.current = a && a.kind === 'project' ? a.projectId : ''
  }
  // phase → tabs 对账：四个 entry phase 各归自己的单例页签，workspace 归该项目页签（返回只激活、不关；× 才关）。
  useEffect(() => {
    const v: TabView | null =
      phase.tag === 'home' ? { kind: 'home' }
        : phase.tag === 'projects' ? { kind: 'projects' }
          : phase.tag === 'automations' ? { kind: 'automations' }
            : phase.tag === 'integrations' ? { kind: 'integrations' }
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
    // 加载持久化的每引擎默认模型（失败不阻塞启动，回落 DEFAULT_MODEL）
    try {
      const cfg = await api.getConfig()
      if (cfg.engineModels) setEngineModels(cfg.engineModels)
    } catch { /* 静默，回落 DEFAULT_MODEL */ }
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
      const { sessionId } = await api.createSession({ projectId: project.id, engine: runtime.engine, model: seedModel(runtime.engine, engineModels) })
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
  }, [runtime.engine, engineModels])

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
    const { sessionId } = await api.createSession({ projectId, engine: runtime.engine, model: seedModel(runtime.engine, engineModels) })
    const sessions = (await api.listSessions(projectId)).sessions
    const session = sessions.find((s) => s.id === sessionId) ?? sessions[0]
    const project: ProjectDTO = { id: projectId, name: '未命名项目', path, createdAt: Date.now(), status: 'idle', engine: runtime.engine }
    projectsMutSeq.current++   // 标记乐观改动：防在途旧 reload 把新建项目覆盖掉
    setProjects((prev) => prev.some((x) => x.id === projectId) ? prev : [project, ...prev])   // 乐观入列：页签标题/改名按 id 查得到
    setPhase({ tag: 'workspace', project, session, sessions, initialMessage: text, initialContextFiles: contextFiles })
  }, [runtime.engine, skills, engineModels])

  // 先切视图（本地状态，必定生效）再后台刷新——导航不被网络刷新挟持，刷新失败也不会把人卡在 workspace。
  const goHome = useCallback(() => { setPhase({ tag: 'home' }); void reloadProjects().catch(() => {}) }, [reloadProjects])
  const goProjects = useCallback(() => { setPhase({ tag: 'projects' }); void reloadProjects().catch(() => {}) }, [reloadProjects])
  const goIntegrations = useCallback(() => { setPhase({ tag: 'integrations' }); void reloadProjects().catch(() => {}) }, [reloadProjects])
  const goAutomations = useCallback(() => { setPhase({ tag: 'automations' }); void reloadProjects().catch(() => {}) }, [reloadProjects])

  // 从运行历史/通知打开某次自动化产出的会话：项目可能是本次新建（不在列表）→ 先 reload 再定位，落到 workspace。
  const onOpenAutomationSession = useCallback(async (projectId: string, sessionId: string) => {
    let p = projects.find((x) => x.id === projectId)
    if (!p) { const ps = await reloadProjects().catch(() => projects); p = ps.find((x) => x.id === projectId) }
    if (!p) return
    const sessions = (await api.listSessions(projectId)).sessions
    const session = sessions.find((s) => s.id === sessionId) ?? sessions[0]
    if (!session) return
    rememberLastSession(projectId, session.id)
    setOpenSessionIds([session.id])
    setPhase({ tag: 'workspace', project: p, session, sessions, initialMessage: undefined })
  }, [projects, reloadProjects])

  // —— 页签交互 ——
  // 把某个 TabView 导航生效：entry 单例各切对应 phase，project 进项目。
  const navigateToView = useCallback((view: TabView) => {
    switch (view.kind) {
      case 'home': goHome(); break
      case 'projects': goProjects(); break
      case 'automations': goAutomations(); break
      case 'integrations': goIntegrations(); break
      case 'project': void openProjectById(view.projectId); break
    }
  }, [goHome, goProjects, goAutomations, goIntegrations, openProjectById])

  const onSelectTab = useCallback((tab: ChromeTab) => {
    navigateToView(tab.kind === 'project' ? { kind: 'project', projectId: tab.projectId } : { kind: tab.kind })
  }, [navigateToView])

  const onCloseTab = useCallback((id: string) => {
    const { state, nextView } = closeTabPure(tabs, id, Date.now())
    setTabs(state)
    if (nextView) navigateToView(nextView)
  }, [tabs, navigateToView])

  // 改名回传：乐观更新 projects（页签标题/项目标题都按 id 现查 projects → 立即同步、单一数据源）+ 同步 phase 快照
  const onRenameActiveProject = useCallback((projectId: string, name: string) => {
    projectsMutSeq.current++   // 标记乐观改动：防在途旧 reload 把改名覆盖回退（页签退回旧名的根因）
    setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, name } : p)))
    setPhase((prev) => (prev.tag === 'workspace' && prev.project.id === projectId
      ? { ...prev, project: { ...prev.project, name } } : prev))
  }, [])

  // 运行时档位变化回传：把 model/permissionMode/effort 同步进 phase 的 session 快照（含 sessions 列表 + 当前 session）。
  // 根因见 sessionRuntimeSync：快照不刷新 → 切回会话时 Workspace 从陈旧档位重初始化、回退用户改动。让快照随变化同步。
  const onRuntimeChange = useCallback((sessionId: string, cfg: SessionRuntimeCfg) => {
    setPhase((prev) => {
      if (prev.tag !== 'workspace') return prev
      const sessions = applySessionRuntime(prev.sessions, sessionId, cfg)
      if (sessions === prev.sessions) return prev   // 无变化 → 同引用，不重渲染
      const session = sessions.find((s) => s.id === prev.session.id) ?? prev.session
      return { ...prev, sessions, session }
    })
  }, [])

  // 项目列表改名：乐观更新（复用 onRenameActiveProject）+ 落库 PUT（对齐 ProjBar 的「先回传乐观、再调 api」）。
  const onRenameProject = useCallback((id: string, name: string) => {
    onRenameActiveProject(id, name)
    void api.renameProject(id, name).catch(() => {})
  }, [onRenameActiveProject])

  // 项目列表删除（单个/批量）：乐观移除卡片 + 关掉指向已删项目的页签 + 后台 DELETE（删库级联 + 删盘）。
  const onDeleteProjects = useCallback((ids: string[]) => {
    const del = new Set(ids)
    projectsMutSeq.current++   // 标记乐观改动：防在途旧 reload 把删除覆盖回退
    setProjects((prev) => prev.filter((p) => !del.has(p.id)))
    setTabs((s) => pruneProjects(s, new Set(projects.filter((p) => !del.has(p.id)).map((p) => p.id))))
    for (const id of ids) void api.deleteProject(id).catch(() => {})
  }, [projects])

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
      const { sessionId } = await api.createSession({ projectId: project.id, engine: runtime.engine, model: seedModel(runtime.engine, engineModels) })
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
        const { sessionId } = await api.createSession({ projectId: project.id, engine: runtime.engine, model: seedModel(runtime.engine, engineModels) })
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
          onRuntimeChange={onRuntimeChange}
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

  // entry 视图（home / projects / automations / integrations）
  const active = phase.tag === 'projects' ? 'projects' : phase.tag === 'integrations' ? 'integrations' : phase.tag === 'automations' ? 'automations' : 'home'
  return (
    <RuntimeContext.Provider value={{ runtime, dispatch: rtDispatch }}>
      <EntryShell
        chrome={chromeEl}
        rail={<Rail active={active} onNewProject={() => setShowNewProject(true)} onHome={() => void goHome()} onProjects={() => void goProjects()} onAutomations={() => void goAutomations()} onIntegrations={() => void goIntegrations()} />}
        topbar={<Topbar />}
      >
        {phase.tag === 'integrations'
          ? <Integrations />
          : phase.tag === 'automations'
            ? <TaskAutomation projects={projects} onOpenSession={(pid, sid) => void onOpenAutomationSession(pid, sid)} />
            : phase.tag === 'projects'
              ? <Projects projects={projects} onOpenProject={(id) => void openProjectById(id)} onRenameProject={onRenameProject} onDeleteProjects={onDeleteProjects} />
              : <Home projects={projects} onSend={(t, staged) => void homeSend(t, staged)} onOpenProject={(id) => void openProjectById(id)} onViewAll={() => void goProjects()} skillCount={skills.length} onOpenSkillModal={() => setShowSkill(true)} />}
      </EntryShell>
      {showNewProject && <NewProjectModal onClose={() => setShowNewProject(false)} onCreated={(id) => void handleProjectCreated(id)} />}
      {showSkill && <SkillModal initialSelected={skills} onClose={() => setShowSkill(false)} onDone={(s) => { setSkills(s); setShowSkill(false) }} />}
    </RuntimeContext.Provider>
  )
}
