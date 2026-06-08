import { describe, it, expect } from 'vitest'
import {
  RemindersConfig,
  parseReminders,
  DEFAULT_REMINDERS_CONFIG,
  EventCfg,
  SoundCfg,
  ReminderChannel,
} from '../reminders'

// ── 辅助构造合法完整配置 ──────────────────────────────────────────
const validEventCfg = (channels: string[] = ['audio', 'inapp']) => ({
  channels,
  sound: { kind: 'system', id: 'default' },
})

const validFullConfig = (): unknown => ({
  version: 1,
  enabled: true,
  events: {
    attention: validEventCfg(['audio', 'inapp']),
    complete: validEventCfg(['system']),
    failed: validEventCfg([]),
  },
  external: {
    webhook: { enabled: false, secretRef: null },
    feishu: { enabled: true, secretRef: 'sec-123' },
  },
})

// ── RemindersConfig schema 直接解析 ─────────────────────────────
describe('RemindersConfig schema', () => {
  it('合法完整配置 → 原样解析', () => {
    const result = RemindersConfig.safeParse(validFullConfig())
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.version).toBe(1)
    expect(result.data.enabled).toBe(true)
    expect(result.data.events.attention.channels).toContain('audio')
    expect(result.data.external.feishu.secretRef).toBe('sec-123')
  })

  it('version 非 1 → 解析失败', () => {
    const bad = { ...validFullConfig() as object, version: 2 }
    expect(RemindersConfig.safeParse(bad).success).toBe(false)
  })

  it('sound: uploaded 种类正确解析', () => {
    const cfg = {
      ...(validFullConfig() as any),
      events: {
        attention: { channels: ['audio'], sound: { kind: 'uploaded', file: '.agent-shell/sounds/my.wav' } },
        complete: validEventCfg(),
        failed: validEventCfg(),
      },
    }
    const result = RemindersConfig.safeParse(cfg)
    expect(result.success).toBe(true)
    if (!result.success) return
    const s = result.data.events.attention.sound
    expect(s.kind).toBe('uploaded')
    if (s.kind === 'uploaded') expect(s.file).toBe('.agent-shell/sounds/my.wav')
  })
})

// ── EventCfg schema ────────────────────────────────────────────
describe('EventCfg schema', () => {
  it('channels 允许合法值集合', () => {
    const result = EventCfg.safeParse({ channels: ['audio', 'inapp', 'system'], sound: { kind: 'system', id: 'crisp' } })
    expect(result.success).toBe(true)
  })

  it('channels 为空数组也合法', () => {
    expect(EventCfg.safeParse({ channels: [], sound: { kind: 'system', id: 'default' } }).success).toBe(true)
  })
})

// ── SoundCfg schema ────────────────────────────────────────────
describe('SoundCfg schema', () => {
  it('kind=system 各 id 值均合法（schema 宽松接受任意字符串）', () => {
    for (const id of ['default', 'crisp', 'alert', 'chime', 'custom']) {
      expect(SoundCfg.safeParse({ kind: 'system', id }).success).toBe(true)
    }
  })

  it('kind=uploaded 需要 file 字段', () => {
    expect(SoundCfg.safeParse({ kind: 'uploaded', file: '.agent-shell/sounds/x.wav' }).success).toBe(true)
    expect(SoundCfg.safeParse({ kind: 'uploaded' }).success).toBe(false)  // 缺 file
  })

  it('未知 kind → 解析失败', () => {
    expect(SoundCfg.safeParse({ kind: 'bluetooth', id: 'x' }).success).toBe(false)
  })
})

// ── ReminderChannel ────────────────────────────────────────────
describe('ReminderChannel', () => {
  it('仅 audio / inapp / system 合法', () => {
    expect(ReminderChannel.safeParse('audio').success).toBe(true)
    expect(ReminderChannel.safeParse('inapp').success).toBe(true)
    expect(ReminderChannel.safeParse('system').success).toBe(true)
    expect(ReminderChannel.safeParse('sms').success).toBe(false)
    expect(ReminderChannel.safeParse('push').success).toBe(false)
  })
})

// ── parseReminders ─────────────────────────────────────────────
describe('parseReminders', () => {
  it('合法完整配置 → 原样返回', () => {
    const cfg = validFullConfig()
    const parsed = parseReminders(cfg)
    expect(parsed.version).toBe(1)
    expect(parsed.enabled).toBe(true)
    expect(parsed.external.feishu.secretRef).toBe('sec-123')
    expect(parsed.events.complete.channels).toContain('system')
  })

  it('空对象 → 全部回退默认（enabled:false）', () => {
    const parsed = parseReminders({})
    expect(parsed.enabled).toBe(false)
    expect(parsed.events.attention.channels).toEqual([])
    expect(parsed.events.attention.sound).toEqual({ kind: 'system', id: 'default' })
    expect(parsed.external.webhook.enabled).toBe(false)
    expect(parsed.external.webhook.secretRef).toBeNull()
  })

  it('null → 全部回退默认', () => {
    expect(parseReminders(null).enabled).toBe(false)
  })

  it('undefined → 全部回退默认', () => {
    expect(parseReminders(undefined).enabled).toBe(false)
  })

  it('非对象（字符串）→ 全部回退默认', () => {
    expect(parseReminders('hello').enabled).toBe(false)
  })

  it('数字 → 全部回退默认', () => {
    expect(parseReminders(42).enabled).toBe(false)
  })

  it('channels 含未知值 sms → 过滤掉，保留合法项', () => {
    const cfg = {
      ...validFullConfig() as any,
      events: {
        attention: { channels: ['audio', 'sms', 'inapp'], sound: { kind: 'system', id: 'default' } },
        complete: validEventCfg(),
        failed: validEventCfg(),
      },
    }
    const parsed = parseReminders(cfg)
    expect(parsed.events.attention.channels).toEqual(['audio', 'inapp'])
    expect(parsed.events.attention.channels).not.toContain('sms')
  })

  it('channels 全部为未知值 → 过滤后为空数组', () => {
    const cfg = {
      ...validFullConfig() as any,
      events: {
        attention: { channels: ['sms', 'push', 'email'], sound: { kind: 'system', id: 'default' } },
        complete: validEventCfg(),
        failed: validEventCfg(),
      },
    }
    const parsed = parseReminders(cfg)
    expect(parsed.events.attention.channels).toEqual([])
  })

  it('坏 sound → 使用默认 system/default', () => {
    const cfg = {
      ...validFullConfig() as any,
      events: {
        attention: { channels: ['audio'], sound: { kind: 'bluetooth', id: 'x' } },
        complete: validEventCfg(),
        failed: validEventCfg(),
      },
    }
    const parsed = parseReminders(cfg)
    expect(parsed.events.attention.sound).toEqual({ kind: 'system', id: 'default' })
  })

  it('sound: uploaded 合法 → 原样返回', () => {
    const cfg = {
      ...validFullConfig() as any,
      events: {
        attention: { channels: ['audio'], sound: { kind: 'uploaded', file: '.agent-shell/sounds/ding.mp3' } },
        complete: validEventCfg(),
        failed: validEventCfg(),
      },
    }
    const parsed = parseReminders(cfg)
    const s = parsed.events.attention.sound
    expect(s.kind).toBe('uploaded')
    if (s.kind === 'uploaded') expect(s.file).toBe('.agent-shell/sounds/ding.mp3')
  })

  it('DEFAULT_REMINDERS_CONFIG 符合 schema', () => {
    expect(RemindersConfig.safeParse(DEFAULT_REMINDERS_CONFIG).success).toBe(true)
  })

  it('external 整体缺失 → 回退默认（两项均 false/null）', () => {
    const cfg: any = { ...validFullConfig() as any }
    delete cfg.external
    const parsed = parseReminders(cfg)
    expect(parsed.external.webhook).toEqual({ enabled: false, secretRef: null })
    expect(parsed.external.feishu).toEqual({ enabled: false, secretRef: null })
  })

  it('events 整体缺失 → 三事件全回退默认', () => {
    const cfg: any = { ...validFullConfig() as any }
    delete cfg.events
    const parsed = parseReminders(cfg)
    expect(parsed.events.attention.channels).toEqual([])
    expect(parsed.events.complete.sound).toEqual({ kind: 'system', id: 'default' })
    expect(parsed.events.failed.channels).toEqual([])
  })
})
