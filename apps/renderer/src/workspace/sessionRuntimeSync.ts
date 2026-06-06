import type { SessionDTO } from '../api/types'

/** 运行时档位的会话级持久字段（与 DB sessions 表 model/permission_mode/effort 对应）。 */
export interface SessionRuntimeCfg { model: string; permissionMode: string; effort: string }

/**
 * 把某会话的 model/permissionMode/effort 同步进会话列表快照（AppNav 在 Workspace 档位变化时调用）。
 *
 * 根因：AppNav 的 sessions 快照是导航时一次性取的，档位变更后不刷新；切回会话时 Workspace 重挂载、
 * 从陈旧快照的 model/permissionMode/effort 重初始化 → 用户改的档位被回退（「没保持」）。让快照随档位变化
 * 同步，切回即读到当前值。无匹配会话 / 档位未变 → 返回同引用（避免无谓重渲染）。
 */
export function applySessionRuntime(sessions: SessionDTO[], sessionId: string, cfg: SessionRuntimeCfg): SessionDTO[] {
  const idx = sessions.findIndex((s) => s.id === sessionId)
  if (idx < 0) return sessions
  const cur = sessions[idx]
  if (cur.model === cfg.model && cur.permissionMode === cfg.permissionMode && cur.effort === cfg.effort) return sessions
  const next = sessions.slice()
  next[idx] = { ...cur, model: cfg.model, permissionMode: cfg.permissionMode, effort: cfg.effort }
  return next
}
