// 两套 Tab（项目 / 会话）圆点的「未读状态」跟踪（feedback-2 Issue 11）。
//
// 圆点表「未确认的状态」：
//   - 完成 / 中止 / 空闲：仅「未读」时显；打开（激活）该 tab 即标已读 → 圆点消失。
//   - 失败：恒显（调用方按 status===failed 直接红，不经本 hook 门控）。
//   - 运行中：常显脉冲（调用方处理，不经本 hook）。
//
// 未读判定靠两条合并（DTO 无状态变更时间戳，只能前端自侦测）：
//   1. 持久「已读指纹」（localStorage Record<id,status>）：当前终态 ≠ 指纹 → 未读。
//      指纹只在「首次见到（建基线）」「打开 tab」时写入 = 最后一次确认时的 status。
//      跨重启靠它——重启后指纹仍指向更早状态 ≠ 当前 completed → 上次未读的完成仍亮。
//   2. 运行期跳变 Set（内存）：completed→看过→running→completed 第二次同值，指纹认不出，靠跳变补亮。
//
// 首次无指纹（全新启动 / 首次升级本版本）→ 建已读基线（指纹=当前 status、不亮），
// 避免「一堆历史 completed 全亮」的一次性噪音。参照 CtxMeter.tsx 的 Record<id,value> localStorage 范式。

import { useCallback, useEffect, useRef, useState } from 'react'

// 终态集合：未读只对这些 status 生效（running 是运行态、failed 恒显，都不入未读门）。
const TERMINAL = new Set(['completed', 'aborted', 'idle'])
const KEY_PREFIX = 'agent-shell:tab-seen:'

function readSeen(scope: string): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(KEY_PREFIX + scope) ?? '{}') as Record<string, string> } catch { return {} }
}
function writeSeen(scope: string, m: Record<string, string>): void {
  try { localStorage.setItem(KEY_PREFIX + scope, JSON.stringify(m)) } catch { /* best-effort */ }
}

export interface UnreadItem { id: string; status: string }

// 状态 → 圆点色类（Issue 11，项目 .dot / 会话 .ct-dot 共用 .st-* 语义）。
// running 优先（amber 脉冲）；failed 红；completed 绿；其余（aborted/idle）中性灰。
export function statusDotClass(status: string, running: boolean): string {
  if (running) return 'st-running'
  if (status === 'failed') return 'st-failed'
  if (status === 'completed') return 'st-done'
  return 'st-neutral'
}

/**
 * @param scope   'project' | 'session'（两套独立 localStorage 槽）
 * @param items   当前渲染成 tab 的条目 [{id, status}]
 * @param activeId 当前激活（打开）的 tab id；其状态视为「已读」
 * @returns isUnread(id, status) → 该 tab 圆点是否因「未读终态」点亮
 */
export function useTabUnread(scope: 'project' | 'session', items: UnreadItem[], activeId: string | null) {
  const [seen, setSeen] = useState<Record<string, string>>(() => readSeen(scope))
  const [jumps, setJumps] = useState<ReadonlySet<string>>(() => new Set())
  const prevRef = useRef<Record<string, string>>({})

  // items 变：① 侦测「跳变进终态」补标未读（运行期同值重亮）；② 为首次见到的 id 建已读基线。
  useEffect(() => {
    const prev = prevRef.current
    const jumped: string[] = []
    for (const it of items) {
      const was = prev[it.id]
      if (was !== undefined && was !== it.status && TERMINAL.has(it.status) && it.id !== activeId) jumped.push(it.id)
      prev[it.id] = it.status
    }
    if (jumped.length) {
      setJumps((s) => {
        let changed = false
        const n = new Set(s)
        for (const id of jumped) if (!n.has(id)) { n.add(id); changed = true }
        return changed ? n : s
      })
    }
    // 首次基线（函数式更新拿最新 seen，避免闭包陈旧 / 依赖循环）
    setSeen((m) => {
      let changed = false
      const n = { ...m }
      for (const it of items) if (!(it.id in n)) { n[it.id] = it.status; changed = true }
      if (changed) writeSeen(scope, n)
      return changed ? n : m
    })
  }, [items, activeId, scope])

  // 打开（激活）→ 标已读：指纹=当前 status、从跳变 Set 移除。
  useEffect(() => {
    if (!activeId) return
    const it = items.find((x) => x.id === activeId)
    if (!it) return
    setSeen((m) => { if (m[activeId] === it.status) return m; const n = { ...m, [activeId]: it.status }; writeSeen(scope, n); return n })
    setJumps((s) => { if (!s.has(activeId)) return s; const n = new Set(s); n.delete(activeId); return n })
  }, [activeId, items, scope])

  const isUnread = useCallback((id: string, status: string): boolean => {
    if (!TERMINAL.has(status) || id === activeId) return false
    const fp = seen[id]
    if (fp === undefined) return false   // 基线未建（首次）→ 不亮，且避免首帧闪烁
    return jumps.has(id) || fp !== status
  }, [seen, jumps, activeId])

  return { isUnread }
}
