import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { DEFAULT_REMINDERS_CONFIG, type RemindersConfig } from '@agent-shell/contracts'
import { useReminders } from '../useReminders'

// mock api 模块
vi.mock('../../api/client', () => ({
  api: {
    getReminders: vi.fn(),
    reminderSoundUrl: vi.fn((projectId: string, name: string) => `/api/projects/${projectId}/reminders/sounds/${name}`),
  },
}))

// mock useFsWatch 模块，暴露 onChange 供测试主动触发
let capturedOnChange: (() => void) | null = null
vi.mock('../useFsWatch', () => ({
  useFsWatch: vi.fn((_projectId: string | null, onChange: () => void) => {
    capturedOnChange = onChange
  }),
}))

import { api } from '../../api/client'
const mockGetReminders = api.getReminders as ReturnType<typeof vi.fn>

const mockConfig: RemindersConfig = {
  version: 1,
  enabled: true,
  events: {
    attention: { channels: ['audio'], sound: { kind: 'system', id: 'crisp' } },
    complete: { channels: ['inapp'], sound: { kind: 'system', id: 'chime' } },
    failed: { channels: ['audio', 'inapp'], sound: { kind: 'system', id: 'alert' } },
  },
  external: {
    webhook: { enabled: false, secretRef: null },
    feishu: { enabled: false, secretRef: null },
  },
}

beforeEach(() => {
  capturedOnChange = null
  mockGetReminders.mockReset()
})
afterEach(() => { vi.restoreAllMocks() })

describe('useReminders', () => {
  it('projectId 为 null 时返回 DEFAULT_REMINDERS_CONFIG（enabled:false）', () => {
    const { result } = renderHook(() => useReminders(null))
    expect(result.current.config).toEqual(DEFAULT_REMINDERS_CONFIG)
    expect(result.current.config.enabled).toBe(false)
    expect(mockGetReminders).not.toHaveBeenCalled()
  })

  it('挂载时拉取指定 projectId 的配置', async () => {
    mockGetReminders.mockResolvedValueOnce(mockConfig)
    const { result } = renderHook(() => useReminders('proj-1'))
    await waitFor(() => expect(result.current.config).toEqual(mockConfig))
    expect(mockGetReminders).toHaveBeenCalledWith('proj-1')
  })

  it('projectId 变化时重新拉取新配置', async () => {
    const config2: RemindersConfig = { ...mockConfig, enabled: false }
    mockGetReminders.mockResolvedValueOnce(mockConfig).mockResolvedValueOnce(config2)

    const { result, rerender } = renderHook(({ pid }) => useReminders(pid), {
      initialProps: { pid: 'proj-1' as string | null },
    })
    await waitFor(() => expect(result.current.config).toEqual(mockConfig))

    rerender({ pid: 'proj-2' })
    await waitFor(() => expect(result.current.config).toEqual(config2))
    expect(mockGetReminders).toHaveBeenCalledTimes(2)
    expect(mockGetReminders).toHaveBeenNthCalledWith(2, 'proj-2')
  })

  it('projectId 从有值切换到 null 时重置为 DEFAULT_REMINDERS_CONFIG', async () => {
    mockGetReminders.mockResolvedValueOnce(mockConfig)
    const { result, rerender } = renderHook(({ pid }) => useReminders(pid), {
      initialProps: { pid: 'proj-1' as string | null },
    })
    await waitFor(() => expect(result.current.config).toEqual(mockConfig))

    rerender({ pid: null })
    await waitFor(() => expect(result.current.config).toEqual(DEFAULT_REMINDERS_CONFIG))
  })

  it('files-changed 事件触发后 reload() 重拉配置', async () => {
    mockGetReminders.mockResolvedValue(mockConfig)
    const { result } = renderHook(() => useReminders('proj-1'))
    await waitFor(() => expect(result.current.config).toEqual(mockConfig))

    const updatedConfig: RemindersConfig = { ...mockConfig, enabled: false }
    mockGetReminders.mockResolvedValueOnce(updatedConfig)

    // 模拟 useFsWatch 触发 files-changed 回调
    act(() => { capturedOnChange?.() })
    await waitFor(() => expect(result.current.config).toEqual(updatedConfig))
    expect(mockGetReminders).toHaveBeenCalledTimes(2)
  })

  it('reload() 手动调用可重拉', async () => {
    mockGetReminders.mockResolvedValue(mockConfig)
    const { result } = renderHook(() => useReminders('proj-1'))
    await waitFor(() => expect(result.current.config).toEqual(mockConfig))

    const updatedConfig: RemindersConfig = { ...mockConfig, enabled: false }
    mockGetReminders.mockResolvedValueOnce(updatedConfig)

    act(() => { result.current.reload() })
    await waitFor(() => expect(result.current.config).toEqual(updatedConfig))
  })

  it('拉取失败时回退 DEFAULT_REMINDERS_CONFIG，不抛错', async () => {
    mockGetReminders.mockRejectedValueOnce(new Error('network error'))
    const { result } = renderHook(() => useReminders('proj-1'))
    await waitFor(() => expect(result.current.config).toEqual(DEFAULT_REMINDERS_CONFIG))
  })

  it('乱序返回：proj-1 响应晚于 proj-2 返回，不污染 proj-2 的 config（stale-response 竞态）', async () => {
    const config1: RemindersConfig = { ...mockConfig, enabled: true }
    const config2: RemindersConfig = { ...mockConfig, enabled: false }

    // 用可手动 resolve 的 deferred 精确控制返回顺序
    const makeDeferred = <T,>() => {
      let resolve!: (v: T) => void
      const promise = new Promise<T>((r) => { resolve = r })
      return { promise, resolve }
    }
    const d1 = makeDeferred<RemindersConfig>()
    const d2 = makeDeferred<RemindersConfig>()

    // proj-1 → d1.promise；proj-2 → d2.promise
    mockGetReminders.mockImplementation((pid: string) =>
      pid === 'proj-1' ? d1.promise : d2.promise)

    const { result, rerender } = renderHook(({ pid }) => useReminders(pid), {
      initialProps: { pid: 'proj-1' as string | null },
    })
    // 此刻 proj-1 已发起、未 resolve
    expect(mockGetReminders).toHaveBeenNthCalledWith(1, 'proj-1')

    // 切到 proj-2（发起第二次拉取）
    rerender({ pid: 'proj-2' })
    expect(mockGetReminders).toHaveBeenNthCalledWith(2, 'proj-2')

    // 先 resolve proj-2（新请求先返回），再 resolve proj-1（迟到的旧请求）
    // —— 这正是「proj-1 响应晚于 proj-2 返回」的乱序场景
    await act(async () => {
      d2.resolve(config2)
      await Promise.resolve()
      d1.resolve(config1)
      await Promise.resolve()
    })

    // 最终必须是 proj-2 的配置，proj-1 的迟到响应被丢弃
    await waitFor(() => expect(result.current.config).toEqual(config2))
    expect(result.current.config).not.toEqual(config1)
  })
})
