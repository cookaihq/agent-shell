import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { RemindersModal } from '../RemindersModal'
import { api } from '../../api/client'
import { playSound } from '../../utils/reminderSound'
import type { RemindersConfig } from '@agent-shell/contracts'

vi.mock('../../api/client', () => ({
  api: {
    putReminders: vi.fn().mockResolvedValue(undefined),
    uploadReminderSound: vi.fn().mockResolvedValue({ file: '.agent-shell/sounds/up.mp3' }),
    reminderSoundUrl: (pid: string, name: string) => `/api/projects/${pid}/reminders/sounds/${name}`,
    createSecret: vi.fn().mockResolvedValue({ secret: { id: 'sec-new', name: 'n', note: '', hasValue: true, maskedValue: '', createdAt: 0 } }),
    updateSecret: vi.fn().mockResolvedValue({ secret: { id: 'sec-1', name: 'n', note: '', hasValue: true, maskedValue: '', createdAt: 0 } }),
  },
}))

vi.mock('../../utils/reminderSound', () => ({ playSound: vi.fn() }))

const baseConfig: RemindersConfig = {
  version: 1,
  enabled: true,
  events: {
    attention: { channels: ['audio'], sound: { kind: 'system', id: 'default' } },
    complete: { channels: [], sound: { kind: 'system', id: 'default' } },
    failed: { channels: [], sound: { kind: 'system', id: 'default' } },
  },
  external: { webhook: { enabled: false, secretRef: null }, feishu: { enabled: false, secretRef: null } },
}

function renderModal(cfg: Partial<RemindersConfig> = {}) {
  const config = { ...baseConfig, ...cfg }
  const onClose = vi.fn()
  const reload = vi.fn()
  const r = render(
    <RemindersModal projectId="proj-1" open config={config} reload={reload} onClose={onClose} />,
  )
  return { ...r, onClose, reload }
}

describe('RemindersModal 结构', () => {
  beforeEach(() => vi.clearAllMocks())

  it('open=false 不渲染', () => {
    const { container } = render(
      <RemindersModal projectId="p" open={false} config={baseConfig} reload={vi.fn()} onClose={vi.fn()} />,
    )
    expect(container.querySelector('.rmd-modal')).toBeFalsy()
  })

  it('渲染三事件段 + 外部渠道段 + 4 个 tab', () => {
    const { container } = renderModal()
    expect(container.querySelectorAll('.rmd-evt').length).toBe(3)
    expect(container.querySelector('.rmd-ext')).toBeTruthy()
    expect(container.querySelectorAll('.rmd-tab').length).toBe(4)
  })
})

describe('RemindersModal 渠道 chip', () => {
  beforeEach(() => vi.clearAllMocks())

  it('attention 的 audio chip 初始 on（config 已含 audio），音频区展开', () => {
    const { container } = renderModal()
    const evt = container.querySelector('.rmd-evt[data-evt="attention"]')!
    const audioChip = evt.querySelector('.rmd-ch[data-ch="audio"]')!
    expect(audioChip.className).toContain('on')
    expect(evt.querySelector('.rmd-audio.show')).toBeTruthy()
  })

  it('点 inapp chip → 翻转为 on（写入 channels）', () => {
    const { container } = renderModal()
    const evt = container.querySelector('.rmd-evt[data-evt="complete"]')!
    const chip = evt.querySelector('.rmd-ch[data-ch="inapp"]')!
    expect(chip.className).not.toContain('on')
    fireEvent.click(chip)
    expect(chip.className).toContain('on')
  })

  it('关掉 audio chip → 音频区收起', () => {
    const { container } = renderModal()
    const evt = container.querySelector('.rmd-evt[data-evt="attention"]')!
    const audioChip = evt.querySelector('.rmd-ch[data-ch="audio"]')!
    fireEvent.click(audioChip)
    expect(evt.querySelector('.rmd-audio.show')).toBeFalsy()
  })
})

describe('RemindersModal 音频选择 + 试听', () => {
  beforeEach(() => vi.clearAllMocks())

  it('点系统音频行 → 标记 is-sel（写入 sound）', () => {
    const { container } = renderModal()
    const evt = container.querySelector('.rmd-evt[data-evt="attention"]')!
    const rows = evt.querySelectorAll('.rmd-sys .rmd-arow')
    // 初始 default 选中
    expect(rows[0].className).toContain('is-sel')
    // 点第 2 个（crisp）
    fireEvent.click(rows[1])
    expect(rows[1].className).toContain('is-sel')
    expect(rows[0].className).not.toContain('is-sel')
  })

  it('点 ▶ 试听 → 调 playSound（真实音频），不改变选中', () => {
    const { container } = renderModal()
    const evt = container.querySelector('.rmd-evt[data-evt="attention"]')!
    const playBtn = evt.querySelector('.rmd-sys .rmd-arow .rmd-aplay')!
    fireEvent.click(playBtn)
    expect(playSound).toHaveBeenCalled()
  })
})

describe('RemindersModal 总开关', () => {
  beforeEach(() => vi.clearAllMocks())

  it('enabled → 显示「完成」按钮；点总开关关 → 藏「完成」+ body 灰显', () => {
    const { container } = renderModal({ enabled: true })
    expect(container.querySelector('.rmd-done')).toBeTruthy()
    expect(container.querySelector('.rmd-m-body.rmd-disabled')).toBeFalsy()
    const master = container.querySelector('#rmdMaster')!
    fireEvent.click(master)
    expect(container.querySelector('.rmd-done')).toBeFalsy()
    expect(container.querySelector('.rmd-m-body.rmd-disabled')).toBeTruthy()
  })
})

describe('RemindersModal 保存', () => {
  beforeEach(() => vi.clearAllMocks())

  it('点「完成」→ putReminders + reload + onClose', async () => {
    const { container, onClose, reload } = renderModal()
    fireEvent.click(container.querySelector('.rmd-done')!)
    await waitFor(() => {
      expect(api.putReminders).toHaveBeenCalledWith('proj-1', expect.objectContaining({ version: 1 }))
      expect(reload).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('改了 chip 再保存 → putReminders 带上新 channels', async () => {
    const { container } = renderModal()
    const evt = container.querySelector('.rmd-evt[data-evt="complete"]')!
    fireEvent.click(evt.querySelector('.rmd-ch[data-ch="inapp"]')!)
    fireEvent.click(container.querySelector('.rmd-done')!)
    await waitFor(() => {
      const arg = vi.mocked(api.putReminders).mock.calls[0][1]
      expect(arg.events.complete.channels).toContain('inapp')
    })
  })
})

describe('RemindersModal 外部渠道', () => {
  beforeEach(() => vi.clearAllMocks())

  it('点 Webhook 开关 → 展开配置输入', () => {
    const { container } = renderModal()
    const items = container.querySelectorAll('.rmd-ext-item')
    const webhook = items[0]
    expect(webhook.querySelector('.rmd-ext-cfg.show')).toBeFalsy()
    fireEvent.click(webhook.querySelector('.rmd-ext-sw')!)
    expect(webhook.querySelector('.rmd-ext-cfg.show')).toBeTruthy()
  })

  it('启用 Webhook + 填 URL + 保存 → 写密钥库 + secretRef 进 config（不写明文）', async () => {
    const { container } = renderModal()
    const webhook = container.querySelectorAll('.rmd-ext-item')[0]
    fireEvent.click(webhook.querySelector('.rmd-ext-sw')!)
    const input = webhook.querySelector('.rmd-ext-input')! as HTMLInputElement
    fireEvent.change(input, { target: { value: 'https://hook.example.com/x' } })
    fireEvent.click(container.querySelector('.rmd-done')!)
    await waitFor(() => {
      expect(api.createSecret).toHaveBeenCalledWith(expect.objectContaining({ value: 'https://hook.example.com/x' }))
      const arg = vi.mocked(api.putReminders).mock.calls[0][1]
      expect(arg.external.webhook.enabled).toBe(true)
      expect(arg.external.webhook.secretRef).toBe('sec-new')
      // config 里不含明文 URL
      expect(JSON.stringify(arg)).not.toContain('hook.example.com')
    })
  })
})
