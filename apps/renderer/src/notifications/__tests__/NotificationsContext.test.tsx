// NotificationsContext 单测：notify 入列 + 弹 toast；complete/failed 5s 自消、attention 常驻；markAllRead/dismiss。
// 给 T7 对接 notify 的信心：列表与 toast 的生命周期符合契约。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { NotificationsProvider, useNotifications, TOAST_TTL_MS, type NotifyInput } from '../NotificationsContext'

// 暴露 store 到测试句柄，便于在 act 内调用命令式 API。
let store: ReturnType<typeof useNotifications>
function Probe() {
  store = useNotifications()
  return (
    <div>
      <span data-testid="n-count">{store.notifications.length}</span>
      <span data-testid="t-count">{store.toasts.length}</span>
    </div>
  )
}

function setup() {
  render(<NotificationsProvider><Probe /></NotificationsProvider>)
}

const sample = (event: NotifyInput['event'], title = 't'): NotifyInput =>
  ({ event, projectId: 'p1', sessionId: 's1', title, msg: 'm' })

describe('NotificationsContext', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('notify → 列表 +1 且弹一张 toast', () => {
    setup()
    act(() => { store.notify(sample('complete')) })
    expect(screen.getByTestId('n-count').textContent).toBe('1')
    expect(screen.getByTestId('t-count').textContent).toBe('1')
  })

  it('complete toast 约 5s 自消，但列表项保留', () => {
    setup()
    act(() => { store.notify(sample('complete')) })
    expect(screen.getByTestId('t-count').textContent).toBe('1')
    act(() => { vi.advanceTimersByTime(TOAST_TTL_MS) })
    expect(screen.getByTestId('t-count').textContent).toBe('0')   // toast 自消
    expect(screen.getByTestId('n-count').textContent).toBe('1')   // 列表仍在
  })

  it('attention toast 常驻（不自消）', () => {
    setup()
    act(() => { store.notify(sample('attention')) })
    act(() => { vi.advanceTimersByTime(TOAST_TTL_MS * 2) })
    expect(screen.getByTestId('t-count').textContent).toBe('1')
  })

  it('markAllRead 清空列表（灭红点），不强制关已弹 toast', () => {
    setup()
    act(() => { store.notify(sample('attention')); store.notify(sample('complete')) })
    expect(screen.getByTestId('n-count').textContent).toBe('2')
    act(() => { store.markAllRead() })
    expect(screen.getByTestId('n-count').textContent).toBe('0')
  })

  it('dismiss 删列表单条', () => {
    setup()
    let id = ''
    act(() => { id = store.notify(sample('failed')) })
    act(() => { store.dismiss(id) })
    expect(screen.getByTestId('n-count').textContent).toBe('0')
  })
})
