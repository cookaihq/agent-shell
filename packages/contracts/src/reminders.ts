import { z } from 'zod'

// ── 渠道枚举 ──────────────────────────────────────────────────────
/** 提醒渠道（多选）。parseReminders 会过滤掉枚举之外的值，而非整体失败。 */
export const ReminderChannel = z.enum(['audio', 'inapp', 'system'])
export type ReminderChannel = z.infer<typeof ReminderChannel>

// ── 音效配置（discriminatedUnion）────────────────────────────────
/** 系统预置音效：id 宽松（不枚举固定值，方便未来扩展）。推荐值：default|crisp|alert|chime。 */
const SystemSound = z.object({ kind: z.literal('system'), id: z.string() })
/** 用户上传音效：file = 相对项目的路径，如 .agent-shell/sounds/xxx.wav。 */
const UploadedSound = z.object({ kind: z.literal('uploaded'), file: z.string() })

export const SoundCfg = z.discriminatedUnion('kind', [SystemSound, UploadedSound])
export type SoundCfg = z.infer<typeof SoundCfg>

// ── 事件配置 ──────────────────────────────────────────────────────
/**
 * 单事件提醒配置。
 * channels 元素：非法值在 parseReminders 阶段过滤掉（schema 层不过滤，避免整条 EventCfg 失败）。
 */
export const EventCfg = z.object({
  channels: z.array(ReminderChannel),
  sound: SoundCfg,
})
export type EventCfg = z.infer<typeof EventCfg>

// ── 外部渠道（全局开关 / webhook / 飞书）────────────────────────────
const ExternalChannelCfg = z.object({
  enabled: z.boolean(),
  secretRef: z.string().nullable(),
})

// ── 顶层 RemindersConfig（version 1）────────────────────────────────
/**
 * 项目提醒配置（<project>/.agent-shell/reminders.json）。
 * version 固定为 1，为未来格式迁移预留。
 */
export const RemindersConfig = z.object({
  version: z.literal(1),
  enabled: z.boolean(),
  events: z.object({
    attention: EventCfg,
    complete: EventCfg,
    failed: EventCfg,
  }),
  external: z.object({
    webhook: ExternalChannelCfg,
    feishu: ExternalChannelCfg,
  }),
})
export type RemindersConfig = z.infer<typeof RemindersConfig>

// ── 内置默认配置 ──────────────────────────────────────────────────
/** 项目无 reminders.json / 文件损坏时的兜底（决策 C：enabled:false）。 */
export const DEFAULT_REMINDERS_CONFIG: RemindersConfig = {
  version: 1,
  enabled: false,
  events: {
    attention: { channels: [], sound: { kind: 'system', id: 'default' } },
    complete: { channels: [], sound: { kind: 'system', id: 'default' } },
    failed: { channels: [], sound: { kind: 'system', id: 'default' } },
  },
  external: {
    webhook: { enabled: false, secretRef: null },
    feishu: { enabled: false, secretRef: null },
  },
}

// ── 辅助：宽松解析单个 EventCfg（含 channels 非法值过滤）────────────
/**
 * 从 raw 中尽量解析 EventCfg：
 * - channels：过滤掉非 ReminderChannel 的值（而非整体失败）
 * - sound：坏值用默认 {kind:'system', id:'default'} 补
 *
 * 取舍说明：channels 非法元素过滤是强制要求；EventCfg 其余字段（只有 sound）
 * 若坏则用默认补，避免整条事件回退。这属于「部分兜底」实现。
 */
function parseEventCfg(raw: unknown, defaults: EventCfg): EventCfg {
  if (typeof raw !== 'object' || raw === null) return defaults

  const obj = raw as Record<string, unknown>

  // 解析 channels：过滤掉非法值
  let channels: ReminderChannel[] = defaults.channels
  if (Array.isArray(obj.channels)) {
    channels = obj.channels.flatMap((c) => {
      const r = ReminderChannel.safeParse(c)
      return r.success ? [r.data] : []
    })
  }

  // 解析 sound：坏值用默认补
  const soundResult = SoundCfg.safeParse(obj.sound)
  const sound: SoundCfg = soundResult.success ? soundResult.data : defaults.sound

  return { channels, sound }
}

/**
 * 解析项目 reminders.json 原始内容，返回 RemindersConfig。
 *
 * 策略：
 * 1. 整体用 safeParse 尝试。成功则直接返回。
 * 2. 失败时做「部分兜底」：能解析的字段保留，坏/缺字段用默认值补。
 *    - channels 内的非法元素必须过滤（而非整体回退），这是强制需求。
 *    - 顶层非对象（null/undefined/string/number/array）→ 整体返回默认。
 * 3. 任何路径都不抛错。
 */
export function parseReminders(raw: unknown): RemindersConfig {
  // 先尝试整体解析（快路径）
  const fast = RemindersConfig.safeParse(raw)
  if (fast.success) return fast.data

  // 顶层非对象 → 整体回退
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return DEFAULT_REMINDERS_CONFIG
  }

  const obj = raw as Record<string, unknown>

  // 解析 enabled（默认 false，决策 C）
  const enabledResult = z.boolean().safeParse(obj.enabled)
  const enabled = enabledResult.success ? enabledResult.data : false

  // 解析三个事件配置
  const eventsRaw = (typeof obj.events === 'object' && obj.events !== null)
    ? obj.events as Record<string, unknown>
    : {}

  const defaultEvt = DEFAULT_REMINDERS_CONFIG.events
  const events = {
    attention: parseEventCfg(eventsRaw.attention, defaultEvt.attention),
    complete: parseEventCfg(eventsRaw.complete, defaultEvt.complete),
    failed: parseEventCfg(eventsRaw.failed, defaultEvt.failed),
  }

  // 解析 external（整体或逐项兜底）
  const defaultExt = DEFAULT_REMINDERS_CONFIG.external
  const externalRaw = (typeof obj.external === 'object' && obj.external !== null)
    ? obj.external as Record<string, unknown>
    : {}

  function parseExternalChannel(raw: unknown, def: { enabled: boolean; secretRef: string | null }) {
    if (typeof raw !== 'object' || raw === null) return def
    const r = raw as Record<string, unknown>
    const enabledRes = z.boolean().safeParse(r.enabled)
    const secretRefRes = z.string().nullable().safeParse(r.secretRef)
    return {
      enabled: enabledRes.success ? enabledRes.data : def.enabled,
      secretRef: secretRefRes.success ? secretRefRes.data : def.secretRef,
    }
  }

  const external = {
    webhook: parseExternalChannel(externalRaw.webhook, defaultExt.webhook),
    feishu: parseExternalChannel(externalRaw.feishu, defaultExt.feishu),
  }

  return { version: 1, enabled, events, external }
}
