interface ThinkingProps {
  text: string
  /** 思考耗时（daemon 权威计时，Issue 17）。有则在折叠标题显示「· 思考了 Xs」。 */
  elapsedMs?: number
}

/** 思考耗时格式化：<1s 显示「不到 1 秒」，否则「X.Xs」（与 OpCard 计时口径一致的秒制）。 */
function fmtThinkMs(ms: number): string {
  if (ms < 1000) return '不到 1 秒'
  return `${(ms / 1000).toFixed(1)}s`
}

export function Thinking({ text, elapsedMs }: ThinkingProps) {
  return (
    <details className="thinking">
      <summary>
        <span className="chev">▸</span>思考过程
        {elapsedMs !== undefined && <span className="think-elapsed">· 思考了 {fmtThinkMs(elapsedMs)}</span>}
      </summary>
      <div className="tbody">{text}</div>
    </details>
  )
}
