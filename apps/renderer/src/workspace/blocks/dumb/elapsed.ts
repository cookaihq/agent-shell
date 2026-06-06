import { useEffect, useState } from 'react'

/** 运行时长格式化：<1s 显示 ms，否则 s（一位小数）。 */
function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/** 计时：未完成时从 startedAt 实时跳动；完成后定格。无 startedAt → null。SkillRow 复用，故导出。 */
export function useElapsed(startedAt?: number, completedAt?: number): string | null {
  const [now, setNow] = useState(() => Date.now())
  const running = startedAt != null && completedAt == null
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 150)
    return () => clearInterval(t)
  }, [running])
  if (startedAt == null) return null
  const end = completedAt ?? now
  return fmtDuration(end - startedAt)
}
