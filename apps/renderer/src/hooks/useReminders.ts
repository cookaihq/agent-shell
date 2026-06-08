import { useState, useEffect, useCallback, useRef } from 'react'
import { DEFAULT_REMINDERS_CONFIG, type RemindersConfig } from '@agent-shell/contracts'
import { api } from '../api/client'
import { useFsWatch } from './useFsWatch'

/**
 * 拉取并持有某项目的 RemindersConfig 内存态。
 *
 * - 挂载 / projectId 变化 → 调 GET /projects/:id/reminders
 * - useFsWatch 检测到 files-changed（reminders.json 被 Agent 修改）→ reload()
 * - projectId 为空 → 返回 DEFAULT_REMINDERS_CONFIG（enabled:false）
 *
 * 竞态守护（stale-response）：
 *   每次发起拉取前递增 genRef「代号」并捕获，响应回来后比对当前代号——
 *   不一致即丢弃。这样切 projectId 后，旧项目的延迟响应（无论来自
 *   projectId-effect 还是 reload）绝不会覆盖新项目的 config。
 *   对齐项目先例 NewProjectModal 的 alive 守卫，但用 ref 计数让 effect
 *   与 reload 共用同一套失效判定。
 *
 * 消费方：T7（触发逻辑）读 config；T9（配置模态）调 reload() 写入后刷新。
 */
export function useReminders(projectId: string | null): {
  config: RemindersConfig
  reload: () => void
} {
  const [config, setConfig] = useState<RemindersConfig>(DEFAULT_REMINDERS_CONFIG)
  // 「代号」：每次发起新拉取/切换前 +1；响应回来比对，stale 则丢弃
  const genRef = useRef(0)
  // 用 ref 持有当前 projectId，供 reload 闭包读取最新值
  const projectIdRef = useRef(projectId)
  projectIdRef.current = projectId

  const reload = useCallback(() => {
    const pid = projectIdRef.current
    if (!pid) {
      genRef.current++   // 让在途的旧请求失效
      setConfig(DEFAULT_REMINDERS_CONFIG)
      return
    }
    const gen = ++genRef.current
    api.getReminders(pid)
      .then((c) => { if (gen === genRef.current) setConfig(c) })
      .catch(() => { if (gen === genRef.current) setConfig(DEFAULT_REMINDERS_CONFIG) })
  }, [])

  // projectId 变化时重新拉取（reload 内部已做竞态守护 + 空值处理）
  useEffect(() => {
    reload()
  }, [projectId, reload])

  // 监听文件变更（Agent 改 reminders.json）→ 重拉
  useFsWatch(projectId, reload)

  return { config, reload }
}
