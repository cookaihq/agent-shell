import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { Settings } from '../Settings'

// vi.hoisted：mock 工厂会被提升到 import 之上，故不能引用顶层 import 的值。
// 把默认配置 + putDefaultReminders spy 放进 hoisted 块，供工厂与测试体共用。
const h = vi.hoisted(() => {
  const DEFAULT_REMINDERS_CONFIG = {
    version: 1 as const,
    enabled: false,
    events: {
      attention: { channels: [] as string[], sound: { kind: 'system' as const, id: 'default' } },
      complete: { channels: [] as string[], sound: { kind: 'system' as const, id: 'default' } },
      failed: { channels: [] as string[], sound: { kind: 'system' as const, id: 'default' } },
    },
    external: {
      webhook: { enabled: false, secretRef: null },
      feishu: { enabled: false, secretRef: null },
    },
  }
  return { DEFAULT_REMINDERS_CONFIG, putDefaultReminders: vi.fn().mockResolvedValue(DEFAULT_REMINDERS_CONFIG) }
})

vi.mock('../../api/client', () => ({
  ApiError: class extends Error {},
  api: {
    enginesDetail: vi.fn().mockResolvedValue({ engines: [] }),
    getConfig: vi.fn().mockResolvedValue({ projectsDir: '/p', skillsDir: '/s' }),
    listSkills: vi.fn().mockResolvedValue({ skills: [] }),
    listSecrets: vi.fn().mockResolvedValue({ secrets: [], usage: {} }),
    getDefaultReminders: vi.fn().mockResolvedValue(h.DEFAULT_REMINDERS_CONFIG),
    putDefaultReminders: h.putDefaultReminders,
  },
}))

const putDefaultReminders = h.putDefaultReminders

test('渲染四导航（执行模式/系统设置/密钥管理/提醒）+ 默认执行模式 + 关闭', async () => {
  const onClose = vi.fn()
  render(<Settings section="exec" onClose={onClose} />)
  expect(screen.getByRole('button', { name: '执行模式' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '系统设置' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '密钥管理' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '提醒' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '技能' })).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '执行模式' })).toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalled()
})

test('提醒子页：加载默认配置、改 channel 写回、音频区无上传入口', async () => {
  putDefaultReminders.mockClear()
  render(<Settings section="reminders" onClose={vi.fn()} />)
  // 进入提醒子页（标题）
  expect(await screen.findByRole('heading', { name: '提醒' })).toBeInTheDocument()
  // 系统音频是唯一音频来源——无「上传…」入口（vs 项目级模态有）
  expect(screen.queryByText('上传…')).not.toBeInTheDocument()
  expect(screen.queryByText('已上传')).not.toBeInTheDocument()
  // 默认 enabled:false → 总开关 off；先打开总开关再选事件渠道
  const masterToggle = screen.getByRole('button', { name: '启用提醒' })
  await userEvent.click(masterToggle)
  // 改一个事件渠道：点「音频播放」chip（三事件各有一个，取第一个）
  const audioChips = screen.getAllByRole('button', { name: '音频播放' })
  await userEvent.click(audioChips[0])
  // 保存 → putDefaultReminders 被调用，且写回的 attention.channels 含 audio + enabled:true
  await userEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(putDefaultReminders).toHaveBeenCalledTimes(1)
  const written = putDefaultReminders.mock.calls[0][0]
  expect(written.enabled).toBe(true)
  expect(written.events.attention.channels).toContain('audio')
})
