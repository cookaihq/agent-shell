import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULT_REMINDERS_CONFIG, type RemindersConfig } from '@agent-shell/contracts'
import { fireReminder, type ReminderTriggerCtx, type ReminderTriggerDeps } from '../reminderTrigger'
import type { AgentEvent } from '../../api/types'

// ── 构造工具 ──────────────────────────────────────────────────────
/** 造一份 enabled 的配置；可逐事件覆盖 channels / sound。 */
function makeConfig(over?: Partial<RemindersConfig['events']>, enabled = true): RemindersConfig {
  return {
    ...DEFAULT_REMINDERS_CONFIG,
    enabled,
    events: {
      attention: { channels: ['inapp', 'audio', 'system'], sound: { kind: 'system', id: 'crisp' } },
      complete: { channels: ['inapp', 'audio', 'system'], sound: { kind: 'system', id: 'chime' } },
      failed: { channels: ['inapp', 'audio', 'system'], sound: { kind: 'system', id: 'alert' } },
      ...over,
    },
  }
}

function makeDeps() {
  return {
    notify: vi.fn(),
    playSound: vi.fn(),
    showReminder: vi.fn(),
    hasFocus: vi.fn(() => false),   // 默认失焦（audio/system 会响）
  } satisfies ReminderTriggerDeps
}

function makeCtx(config: RemindersConfig): ReminderTriggerCtx {
  return { config, projectId: 'p1', sessionId: 's1', projectName: '我的项目', sessionName: '会话A' }
}

// 事件工厂
const evPermission: AgentEvent = { type: 'permission_request', requestId: 'r1', toolName: 'bash', input: {} }
const evAsk: AgentEvent = { type: 'ask_user_question', requestId: 'r2', questions: [] }
const evComplete: AgentEvent = { type: 'turn_end', stopReason: 'end_turn' }
const evFailed: AgentEvent = { type: 'turn_end', stopReason: 'failed', detail: '上游 500' }
const evAborted: AgentEvent = { type: 'turn_end', stopReason: 'aborted' }

let deps: ReturnType<typeof makeDeps>
beforeEach(() => { deps = makeDeps() })

describe('fireReminder — 前置门控 enabled', () => {
  it('enabled=false → 任何事件都不触发任何渠道', () => {
    const ctx = makeCtx(makeConfig(undefined, false))
    for (const ev of [evPermission, evAsk, evComplete, evFailed]) {
      fireReminder(ev, ctx, deps)
    }
    expect(deps.notify).not.toHaveBeenCalled()
    expect(deps.playSound).not.toHaveBeenCalled()
    expect(deps.showReminder).not.toHaveBeenCalled()
  })
})

describe('fireReminder — 事件→key 映射', () => {
  it('permission_request → attention', () => {
    fireReminder(evPermission, makeCtx(makeConfig()), deps)
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({ event: 'attention' }))
  })
  it('ask_user_question → attention', () => {
    fireReminder(evAsk, makeCtx(makeConfig()), deps)
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({ event: 'attention' }))
  })
  it('turn_end end_turn → complete', () => {
    fireReminder(evComplete, makeCtx(makeConfig()), deps)
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({ event: 'complete' }))
  })
  it('turn_end failed → failed', () => {
    fireReminder(evFailed, makeCtx(makeConfig()), deps)
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({ event: 'failed' }))
  })
  it('turn_end aborted → 不触发（用户自己停的）', () => {
    fireReminder(evAborted, makeCtx(makeConfig()), deps)
    expect(deps.notify).not.toHaveBeenCalled()
    expect(deps.playSound).not.toHaveBeenCalled()
    expect(deps.showReminder).not.toHaveBeenCalled()
  })
  it('非生命周期事件（如 message）→ 不触发', () => {
    fireReminder({ type: 'message', text: 'hi' }, makeCtx(makeConfig()), deps)
    expect(deps.notify).not.toHaveBeenCalled()
  })
})

describe('fireReminder — 失焦门控（决策 A）', () => {
  it('hasFocus=true：audio/system 不响，inapp 照响', () => {
    deps.hasFocus.mockReturnValue(true)
    fireReminder(evComplete, makeCtx(makeConfig()), deps)
    expect(deps.notify).toHaveBeenCalledTimes(1)        // inapp 照响
    expect(deps.playSound).not.toHaveBeenCalled()        // audio 受失焦门控
    expect(deps.showReminder).not.toHaveBeenCalled()     // system 受失焦门控
  })
  it('hasFocus=false：三渠道都按 channels 响', () => {
    deps.hasFocus.mockReturnValue(false)
    fireReminder(evComplete, makeCtx(makeConfig()), deps)
    expect(deps.notify).toHaveBeenCalledTimes(1)
    expect(deps.playSound).toHaveBeenCalledTimes(1)
    expect(deps.showReminder).toHaveBeenCalledTimes(1)
  })
})

describe('fireReminder — channels 子集', () => {
  it('该事件 channels 为空 → 不响', () => {
    const ctx = makeCtx(makeConfig({ complete: { channels: [], sound: { kind: 'system', id: 'default' } } }))
    fireReminder(evComplete, ctx, deps)
    expect(deps.notify).not.toHaveBeenCalled()
    expect(deps.playSound).not.toHaveBeenCalled()
    expect(deps.showReminder).not.toHaveBeenCalled()
  })
  it('只 inapp：notify 响，playSound/showReminder 不响（即便失焦）', () => {
    deps.hasFocus.mockReturnValue(false)
    const ctx = makeCtx(makeConfig({ complete: { channels: ['inapp'], sound: { kind: 'system', id: 'default' } } }))
    fireReminder(evComplete, ctx, deps)
    expect(deps.notify).toHaveBeenCalledTimes(1)
    expect(deps.playSound).not.toHaveBeenCalled()
    expect(deps.showReminder).not.toHaveBeenCalled()
  })
  it('只 audio（失焦）：playSound 响，notify/showReminder 不响', () => {
    deps.hasFocus.mockReturnValue(false)
    const ctx = makeCtx(makeConfig({ complete: { channels: ['audio'], sound: { kind: 'system', id: 'chime' } } }))
    fireReminder(evComplete, ctx, deps)
    expect(deps.playSound).toHaveBeenCalledWith({ kind: 'system', id: 'chime' }, 'p1')
    expect(deps.notify).not.toHaveBeenCalled()
    expect(deps.showReminder).not.toHaveBeenCalled()
  })
  it('audio+system（失焦）：playSound + showReminder 响，notify 不响', () => {
    deps.hasFocus.mockReturnValue(false)
    const ctx = makeCtx(makeConfig({ failed: { channels: ['audio', 'system'], sound: { kind: 'system', id: 'alert' } } }))
    fireReminder(evFailed, ctx, deps)
    expect(deps.playSound).toHaveBeenCalledTimes(1)
    expect(deps.showReminder).toHaveBeenCalledTimes(1)
    expect(deps.notify).not.toHaveBeenCalled()
  })
})

describe('fireReminder — 文案', () => {
  it('title = 项目名 · 会话名；inapp notify 带 projectId/sessionId', () => {
    const ctx = makeCtx(makeConfig({ attention: { channels: ['inapp'], sound: { kind: 'system', id: 'default' } } }))
    fireReminder(evPermission, ctx, deps)
    expect(deps.notify).toHaveBeenCalledWith({
      event: 'attention',
      projectId: 'p1',
      sessionId: 's1',
      title: '我的项目 · 会话A',
      msg: expect.stringContaining('授权'),
    })
  })
  it('failed 的 body 带 detail 真因', () => {
    deps.hasFocus.mockReturnValue(false)
    const ctx = makeCtx(makeConfig({ failed: { channels: ['inapp', 'system'], sound: { kind: 'system', id: 'alert' } } }))
    fireReminder(evFailed, ctx, deps)
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({ msg: expect.stringContaining('上游 500') }))
    expect(deps.showReminder).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining('上游 500') }))
  })
  it('failed 无 detail → 退化为「任务失败」', () => {
    const ctx = makeCtx(makeConfig({ failed: { channels: ['inapp'], sound: { kind: 'system', id: 'alert' } } }))
    fireReminder({ type: 'turn_end', stopReason: 'failed' }, ctx, deps)
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({ msg: '任务失败' }))
  })
  it('system showReminder 载荷含 projectId/sessionId/event/title/body', () => {
    deps.hasFocus.mockReturnValue(false)
    const ctx = makeCtx(makeConfig({ complete: { channels: ['system'], sound: { kind: 'system', id: 'default' } } }))
    fireReminder(evComplete, ctx, deps)
    expect(deps.showReminder).toHaveBeenCalledWith({
      projectId: 'p1',
      sessionId: 's1',
      event: 'complete',
      title: '我的项目 · 会话A',
      body: '会话已完成',
    })
  })
})

describe('fireReminder — 不节流', () => {
  it('多次同事件多次响（无去重/节流）', () => {
    const ctx = makeCtx(makeConfig({ complete: { channels: ['inapp'], sound: { kind: 'system', id: 'default' } } }))
    fireReminder(evComplete, ctx, deps)
    fireReminder(evComplete, ctx, deps)
    fireReminder(evComplete, ctx, deps)
    expect(deps.notify).toHaveBeenCalledTimes(3)
  })
})
