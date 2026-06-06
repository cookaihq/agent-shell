import { Notification } from 'electron'
import { AUTH_HEADER } from '@agent-shell/contracts'

/** daemon /automations/events 推来的 run 结束载荷（与 runHandler.AutomationRunDone 对齐）。 */
interface RunDone {
  runId: string
  automationId: string
  automationName: string
  projectId: string
  sessionId: string
  status: string
  summary: string | null
  error: string | null
}

export interface AutomationNotifier {
  url: string
  stop: () => void
}

/**
 * 订阅 daemon 的自动化 run 结束事件（SSE，经 token gate 带 auth header），跑完/失败/needs-review 弹系统通知（§7）。
 * 连接断开自动重连；daemon 换端口由上层 ensureNotifier 用新 url 重起本订阅。
 */
export function startAutomationNotifier(opts: { url: string; authSecret: string; onActivate: () => void }): AutomationNotifier {
  let stopped = false
  let controller: AbortController | null = null

  const handleFrame = (frame: string): void => {
    let event = 'message'
    let data = ''
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data += line.slice(5).trim()
    }
    if (event !== 'run-done' || !data) return
    let d: RunDone
    try { d = JSON.parse(data) as RunDone } catch { return }
    showNotification(d, opts.onActivate)
  }

  const connect = async (): Promise<void> => {
    if (stopped) return
    controller = new AbortController()
    try {
      const res = await fetch(opts.url + '/api/automations/events', {
        headers: { [AUTH_HEADER]: opts.authSecret },
        signal: controller.signal,
      })
      if (!res.ok || !res.body) throw new Error(`SSE 状态 ${res.status}`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let idx: number
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          handleFrame(buf.slice(0, idx))
          buf = buf.slice(idx + 2)
        }
      }
    } catch { /* 断开 → 下面重连 */ }
    if (!stopped) setTimeout(() => { void connect() }, 1500)
  }

  void connect()
  return { url: opts.url, stop: () => { stopped = true; controller?.abort() } }
}

function showNotification(d: RunDone, onActivate: () => void): void {
  const text: Record<string, { title: string; body: string }> = {
    succeeded: { title: '自动化已完成', body: `「${d.automationName}」已跑完` },
    failed: { title: '自动化失败', body: `「${d.automationName}」失败${d.error ? '：' + d.error : ''}` },
    'needs-review': { title: '自动化待复核', body: `「${d.automationName}」需要你确认一下` },
  }
  const m = text[d.status]   // queued/running/canceled 不通知
  if (!m || !Notification.isSupported()) return
  const n = new Notification({ title: m.title, body: m.body })
  n.on('click', () => onActivate())
  n.show()
}
