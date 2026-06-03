import { describe, it, expect, beforeEach } from 'vitest'
import {
  homeTab, projectTab, normalizeTabs, syncTabsToView, closeTab, pruneProjects,
  loadTabs, saveTabs, type TabsState,
} from '../workspaceTabs'

let t = 1
const now = () => t++

describe('syncTabsToView', () => {
  it('home 视图：激活已有 home 页签、其它页签不动（返回不关页签）', () => {
    let s: TabsState = (() => { const h = homeTab(now()); return { tabs: [h], activeTabId: h.id } })()
    // 从 home 打开项目 P → 追加项目页签
    s = syncTabsToView(s, { kind: 'project', projectId: 'P' }, now())
    expect(s.tabs.map((x) => x.kind)).toEqual(['home', 'project'])
    const projId = s.activeTabId
    // 返回 home → home 激活，项目页签仍在
    s = syncTabsToView(s, { kind: 'home' }, now())
    expect(s.tabs.map((x) => x.kind)).toEqual(['home', 'project'])
    expect(s.tabs.find((x) => x.id === s.activeTabId)!.kind).toBe('home')
    // 再点项目页签回去 → 复用同一页签，不新增
    s = syncTabsToView(s, { kind: 'project', projectId: 'P' }, now())
    expect(s.tabs.filter((x) => x.kind === 'project')).toHaveLength(1)
    expect(s.activeTabId).toBe(projId)
  })

  it('在项目 A 里直接打开项目 B → 替换当前页签位（不堆叠）', () => {
    let s: TabsState = (() => { const h = homeTab(now()); return { tabs: [h], activeTabId: h.id } })()
    s = syncTabsToView(s, { kind: 'project', projectId: 'A' }, now())  // home + A，active A
    s = syncTabsToView(s, { kind: 'project', projectId: 'B' }, now())  // active 是 A（project）→ 替换
    expect(s.tabs.map((x) => x.kind)).toEqual(['home', 'project'])
    expect((s.tabs.find((x) => x.id === s.activeTabId) as any).projectId).toBe('B')
  })

  it('从 home 连开两个项目 → 两个项目页签并存', () => {
    let s: TabsState = (() => { const h = homeTab(now()); return { tabs: [h], activeTabId: h.id } })()
    s = syncTabsToView(s, { kind: 'project', projectId: 'A' }, now())
    s = syncTabsToView(s, { kind: 'home' }, now())
    s = syncTabsToView(s, { kind: 'project', projectId: 'B' }, now())
    expect(s.tabs.filter((x) => x.kind === 'project').map((x: any) => x.projectId).sort()).toEqual(['A', 'B'])
  })
})

describe('closeTab', () => {
  const build = (): TabsState => {
    let s: TabsState = (() => { const h = homeTab(now()); return { tabs: [h], activeTabId: h.id } })()
    s = syncTabsToView(s, { kind: 'project', projectId: 'A' }, now())
    s = syncTabsToView(s, { kind: 'home' }, now())
    s = syncTabsToView(s, { kind: 'project', projectId: 'B' }, now())  // home, A, B；active B
    return s
  }

  it('关非激活页签 → 只移除、不导航', () => {
    const s = build()
    const aId = s.tabs.find((x: any) => x.projectId === 'A')!.id
    const r = closeTab(s, aId, now())
    expect(r.nextView).toBeNull()
    expect(r.state.tabs.map((x) => x.kind)).toEqual(['home', 'project'])
    expect(r.state.activeTabId).toBe(s.activeTabId)
  })

  it('关激活页签 → 选邻居并返回 nextView', () => {
    const s = build()  // active = B（末位）
    const r = closeTab(s, s.activeTabId, now())
    expect(r.nextView).not.toBeNull()
    expect(r.state.tabs.some((x) => x.id === s.activeTabId)).toBe(false)
  })

  it('关掉最后一个 → 兜底回 home', () => {
    let s: TabsState = (() => { const h = homeTab(now()); return { tabs: [h], activeTabId: h.id } })()
    const r = closeTab(s, s.activeTabId, now())
    expect(r.state.tabs.map((x) => x.kind)).toEqual(['home'])
    expect(r.nextView).toEqual({ kind: 'home' })
  })
})

describe('normalizeTabs / pruneProjects', () => {
  it('home 去重为 singleton', () => {
    const a = homeTab(now()); const b = homeTab(now())
    const s = normalizeTabs({ tabs: [a, b, projectTab('P', now())], activeTabId: b.id })
    expect(s.tabs.filter((x) => x.kind === 'home')).toHaveLength(1)
  })

  it('pruneProjects 丢掉已删项目的页签', () => {
    let s: TabsState = (() => { const h = homeTab(now()); return { tabs: [h], activeTabId: h.id } })()
    s = syncTabsToView(s, { kind: 'project', projectId: 'A' }, now())
    s = syncTabsToView(s, { kind: 'home' }, now())
    s = syncTabsToView(s, { kind: 'project', projectId: 'GONE' }, now())  // home+A+GONE 并存
    const pruned = pruneProjects(s, new Set(['A']))
    expect(pruned.tabs.filter((x) => x.kind === 'project').map((x: any) => x.projectId)).toEqual(['A'])
  })
})

describe('localStorage 持久', () => {
  beforeEach(() => { globalThis.localStorage?.clear() })

  it('save → load 往返恢复', () => {
    let s: TabsState = (() => { const h = homeTab(now()); return { tabs: [h], activeTabId: h.id } })()
    s = syncTabsToView(s, { kind: 'project', projectId: 'A' }, now())
    saveTabs(s)
    const loaded = loadTabs(now())
    expect(loaded.tabs.map((x) => x.kind)).toEqual(['home', 'project'])
    expect((loaded.tabs.find((x) => x.kind === 'project') as any).projectId).toBe('A')
    expect(loaded.activeTabId).toBe(s.activeTabId)
  })

  it('无存储 → 兜底单 home', () => {
    const loaded = loadTabs(now())
    expect(loaded.tabs.map((x) => x.kind)).toEqual(['home'])
  })
})
