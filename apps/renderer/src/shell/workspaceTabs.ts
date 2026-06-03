// 顶部页签（chrome tabs）的纯逻辑层 —— 对齐 open-design apps/web/src/components/WorkspaceTabsBar.tsx：
//   · 页签是一份独立持久的状态（{tabs, activeTabId}），与"当前显示哪个视图"解耦，存 localStorage 跨重启恢复
//   · 视图（phase）是"路由"，每次视图变就把页签列表与之对账（syncTabsToView）；导航到首页只激活首页页签、
//     不动其它页签；打开项目则在首页页签旁【追加】项目页签，不替换——所以"返回"永不关页签，× 才关
//   · 项目页签只存 projectId，标题由调用方按 id 查 live projects（改名自动同步，无快照）
// agent-shell 裁剪：只有 home（singleton）+ project 两类；砍掉 open-design 的 marketplace/搜索/悬停预览。
import type { AgentShellBridge } from '@agent-shell/contracts'

export type ChromeTab =
  | { id: string; kind: 'home'; createdAt: number; lastActiveAt: number }
  | { id: string; kind: 'project'; projectId: string; createdAt: number; lastActiveAt: number }

export interface TabsState {
  tabs: ChromeTab[]
  activeTabId: string
}

/** 当前视图（= phase 的精简投影）：首页/项目列表都归到 home 页签；workspace 是某项目页签。 */
export type TabView = { kind: 'home' } | { kind: 'project'; projectId: string }

const STORAGE_KEY = 'agent-shell:workspace-tabs:v1'

let seq = 0
// 不依赖 Date.now()/Math.random()（测试可注入 now）；id 唯一即可。
function newId(prefix: string, now: number): string {
  return `${prefix}:${now.toString(36)}-${(seq++).toString(36)}`
}

export function homeTab(now: number): ChromeTab {
  return { id: newId('home', now), kind: 'home', createdAt: now, lastActiveAt: now }
}
export function projectTab(projectId: string, now: number): ChromeTab {
  return { id: newId(`project:${projectId}`, now), kind: 'project', projectId, createdAt: now, lastActiveAt: now }
}

function tabForView(view: TabView, now: number): ChromeTab {
  return view.kind === 'project' ? projectTab(view.projectId, now) : homeTab(now)
}

/** 保证：至少一个页签、home 唯一（singleton，多余的合并）、activeTabId 有效。 */
export function normalizeTabs(state: TabsState): TabsState {
  let tabs = state.tabs.length > 0 ? state.tabs : [homeTab(0)]
  // home 去重：保留 active 的那个，否则 lastActiveAt 最大的
  const homes = tabs.filter((t) => t.kind === 'home')
  if (homes.length > 1) {
    const keep =
      homes.find((t) => t.id === state.activeTabId) ??
      homes.reduce((a, b) => (b.lastActiveAt > a.lastActiveAt ? b : a), homes[0])
    tabs = tabs.filter((t) => t.kind !== 'home' || t.id === keep.id)
  }
  const activeTabId = tabs.some((t) => t.id === state.activeTabId) ? state.activeTabId : tabs[0].id
  return { tabs, activeTabId }
}

/**
 * 把页签状态与当前视图对账（对齐 open-design syncStateToRoute）：
 *  - home 视图：激活已有 home 页签（没有则追加），其它页签原样
 *  - project 视图：该项目页签已存在 → 激活；否则当前激活的是 home → 【追加】项目页签（不替换 home）；
 *    否则替换当前激活页签（在某项目里直接打开另一个项目 → 复用当前页签位）
 */
export function syncTabsToView(state: TabsState, view: TabView, now: number): TabsState {
  const cur = normalizeTabs(state)
  const active = cur.tabs.find((t) => t.id === cur.activeTabId) ?? null

  if (view.kind === 'home') {
    const home = cur.tabs.find((t) => t.kind === 'home')
    if (home) {
      return normalizeTabs({
        tabs: cur.tabs.map((t) => (t.id === home.id ? { ...t, lastActiveAt: now } : t)),
        activeTabId: home.id,
      })
    }
    const t = homeTab(now)
    return normalizeTabs({ tabs: [...cur.tabs, t], activeTabId: t.id })
  }

  // project 视图
  const existing = cur.tabs.find((t) => t.kind === 'project' && t.projectId === view.projectId)
  if (existing) {
    return normalizeTabs({
      tabs: cur.tabs.map((t) => (t.id === existing.id ? { ...t, lastActiveAt: now } : t)),
      activeTabId: existing.id,
    })
  }
  if (active && active.kind === 'home') {
    const t = projectTab(view.projectId, now)
    return normalizeTabs({ tabs: [...cur.tabs, t], activeTabId: t.id })
  }
  if (!active) {
    const t = projectTab(view.projectId, now)
    return normalizeTabs({ tabs: [...cur.tabs, t], activeTabId: t.id })
  }
  // 在某项目里打开另一个项目：替换当前页签位
  const replacement = { ...tabForView(view, active.createdAt), id: active.id, lastActiveAt: now }
  return normalizeTabs({ tabs: cur.tabs.map((t) => (t.id === active.id ? replacement : t)), activeTabId: replacement.id })
}

/** 视图归属：某 tab 对应哪个视图（点页签时导航到它）。 */
export function viewForTab(tab: ChromeTab): TabView {
  return tab.kind === 'project' ? { kind: 'project', projectId: tab.projectId } : { kind: 'home' }
}

/**
 * 关闭页签（× 唯一入口，对齐 open-design closeTab）：移除后挑邻居为新 active。
 * 返回 nextView：若关掉的是当前 active（需要导航到新 active），否则 null（只是从条上移除，不导航）。
 */
export function closeTab(state: TabsState, id: string, now: number): { state: TabsState; nextView: TabView | null } {
  const cur = normalizeTabs(state)
  const idx = cur.tabs.findIndex((t) => t.id === id)
  if (idx < 0) return { state: cur, nextView: null }
  const rest = cur.tabs.filter((t) => t.id !== id)
  if (rest.length === 0) {
    const h = homeTab(now)
    return { state: { tabs: [h], activeTabId: h.id }, nextView: viewForTab(h) }
  }
  if (cur.activeTabId !== id) {
    return { state: { tabs: rest, activeTabId: cur.activeTabId }, nextView: null }
  }
  const next = rest[Math.min(idx, rest.length - 1)] ?? rest[0]
  return { state: { tabs: rest, activeTabId: next.id }, nextView: viewForTab(next) }
}

/** 丢弃指向已不存在项目的项目页签（重启后项目可能已删）；home 始终保留。 */
export function pruneProjects(state: TabsState, existingProjectIds: ReadonlySet<string>): TabsState {
  const tabs = state.tabs.filter((t) => t.kind !== 'project' || existingProjectIds.has(t.projectId))
  return normalizeTabs({ tabs: tabs.length ? tabs : [], activeTabId: state.activeTabId })
}

// ——— 持久（best-effort；导航本身仍由 phase 驱动，存储坏了不影响功能） ———
// 桌面壳：走主进程文件（preload bridge，origin 无关、跨重启可恢复）。
// 浏览器/dev/测试：退回 localStorage（按 origin 隔离，仅会话内有效）。

function bridge(): AgentShellBridge | undefined {
  return (globalThis as { agentShell?: AgentShellBridge }).agentShell
}
function readRaw(): string | null {
  const b = bridge()
  if (b && typeof b.tabsGet === 'function') { try { return b.tabsGet() } catch { return null } }
  try { return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null } catch { return null }
}
function writeRaw(s: string): void {
  const b = bridge()
  if (b && typeof b.tabsSet === 'function') { try { b.tabsSet(s); return } catch { /* fall through */ } }
  try { globalThis.localStorage?.setItem(STORAGE_KEY, s) } catch { /* best-effort */ }
}

function reviveTab(v: unknown): ChromeTab | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id : ''
  if (!id) return null
  const createdAt = typeof r.createdAt === 'number' ? r.createdAt : 0
  const lastActiveAt = typeof r.lastActiveAt === 'number' ? r.lastActiveAt : createdAt
  if (r.kind === 'home') return { id, kind: 'home', createdAt, lastActiveAt }
  if (r.kind === 'project' && typeof r.projectId === 'string') {
    return { id, kind: 'project', projectId: r.projectId, createdAt, lastActiveAt }
  }
  return null
}

export function loadTabs(now: number): TabsState {
  const fallback = (): TabsState => { const h = homeTab(now); return { tabs: [h], activeTabId: h.id } }
  try {
    const raw = readRaw()
    if (!raw) return fallback()
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return fallback()
    const rec = parsed as Record<string, unknown>
    const tabs = Array.isArray(rec.tabs) ? rec.tabs.map(reviveTab).filter((t): t is ChromeTab => t !== null) : []
    if (tabs.length === 0) return fallback()
    const activeTabId = typeof rec.activeTabId === 'string' ? rec.activeTabId : tabs[0].id
    return normalizeTabs({ tabs, activeTabId })
  } catch {
    return fallback()
  }
}

export function saveTabs(state: TabsState): void {
  writeRaw(JSON.stringify(state))
}
