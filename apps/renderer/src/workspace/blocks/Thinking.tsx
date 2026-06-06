interface ThinkingProps {
  text: string
  /** 思考耗时（daemon 权威计时，Issue 17）。 */
  elapsedMs?: number
}

/** 思考耗时格式化：<1s 显示「不到 1 秒」，否则「X.Xs」。 */
function fmtThinkMs(ms: number): string {
  if (ms < 1000) return '不到 1 秒'
  return `${(ms / 1000).toFixed(1)}s`
}

export function Thinking({ text, elapsedMs }: ThinkingProps) {
  const summary = elapsedMs !== undefined ? `思考了 ${fmtThinkMs(elapsedMs)}` : '思考过程'
  return (
    <details className="thinking">
      <summary><span className="chev">▸</span>{summary}</summary>
      <div className="tbody">{text}</div>
    </details>
  )
}
