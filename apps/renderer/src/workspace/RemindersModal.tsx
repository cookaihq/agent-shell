/**
 * RemindersModal.tsx — 项目提醒配置模态
 *
 * DOM / 交互 1:1 对照 prototype/原型开发版/workspace.html #rmdModal（L485-585）
 * 与 app.js wireReminder（L398-517）。接真实读写：
 *   - 初始态来自 useReminders(projectId) 的 config（打开时快照进本地编辑态）
 *   - 用户改动只更新本地态；关闭/完成时一次性 putReminders + reload（避免每次点击打 API）
 *
 * 三事件（attention/complete/failed）× 三渠道（audio/inapp/system）多选矩阵 +
 * 每事件音频选择（系统预设 default/crisp/alert/chime + 已上传）+
 * 外部渠道（webhook/feishu）开关 + 连接信息进密钥库（secretRef）。
 *
 * 试听：复用 utils/reminderSound.playSound（系统预设合成、已上传播 url），
 *       不是原型的占位 beep。
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api/client'
import { playSound } from '../utils/reminderSound'
import { IconClose, IconPlay } from '../ui/icons'
import type {
  RemindersConfig,
  EventCfg,
  ReminderChannel,
  SoundCfg,
} from '@agent-shell/contracts'

type EventKey = 'attention' | 'complete' | 'failed'
type ExtKey = 'webhook' | 'feishu'

const EVENT_META: { key: EventKey; label: string; desc: string }[] = [
  { key: 'attention', label: '需要介入', desc: '授权 / 提问等你' },
  { key: 'complete', label: '完成', desc: '一轮成功跑完' },
  { key: 'failed', label: '失败', desc: '报错 / 超时 / 崩溃' },
]

// 系统预设音效（id 对齐 contracts SystemSound.id 推荐值 + reminderSound.SYSTEM_SOUND_FREQS）
const SYSTEM_SOUNDS: { id: string; name: string }[] = [
  { id: 'default', name: '默认提示音' },
  { id: 'crisp', name: '清脆 Ping' },
  { id: 'alert', name: '低沉 Alert' },
  { id: 'chime', name: '柔和 Chime' },
]

// 上传音频在 UI 里的展示项：file = 服务端返回相对路径（持久化锚点），name = 展示名（仅 UI 态）
interface UploadedItem {
  file: string
  name: string
}

const CHANNELS: { ch: ReminderChannel; label: string }[] = [
  { ch: 'audio', label: '音频播放' },
  { ch: 'inapp', label: 'APP 内通知' },
  { ch: 'system', label: '系统通知' },
]

function IconGear({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

// 把后端返回的 sound 转成 UI 上传项种子（仅在「上传」段补一个当前选中的相对路径展示行）
function uploadedItemFromSound(sound: SoundCfg): UploadedItem | null {
  if (sound.kind !== 'uploaded' || !sound.file) return null
  const base = sound.file.split('/').pop() ?? sound.file
  return { file: sound.file, name: base }
}

interface RemindersModalProps {
  projectId: string
  open: boolean
  onClose: () => void
  /** 当前已落库的 config（ProjBar 持有 useReminders，传入做编辑初值） */
  config: RemindersConfig
  /** 写入后刷新 ProjBar 的 config（红点/编辑初值同源） */
  reload: () => void
}

export function RemindersModal({ projectId, open, onClose, config, reload }: RemindersModalProps) {
  // 本地编辑态：打开时从 config 快照
  const [draft, setDraft] = useState<RemindersConfig>(config)
  // 各事件已上传音频列表（UI 态：展示用；持久化只认 sound.file 相对路径）
  const [uploads, setUploads] = useState<Record<EventKey, UploadedItem[]>>({
    attention: [],
    complete: [],
    failed: [],
  })
  const [activeTab, setActiveTab] = useState<string>('attention')
  // 系统音频「展开/收起」（per-event）
  const [sysExpanded, setSysExpanded] = useState<Record<EventKey, boolean>>({
    attention: false,
    complete: false,
    failed: false,
  })
  // 外部渠道连接信息明文输入（UI 态，不进 config；保存时写密钥库换 secretRef）
  const [extInput, setExtInput] = useState<{
    webhook: { url: string }
    feishu: { url: string; sign: string }
  }>({ webhook: { url: '' }, feishu: { url: '', sign: '' } })
  // 行内改名态：'<event>:<file>' 或 null
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const bodyRef = useRef<HTMLDivElement>(null)
  const evtRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // 打开时把 config 快照进本地态（关闭→再开 重新同步最新 config）
  useEffect(() => {
    if (!open) return
    setDraft(config)
    setActiveTab('attention')
    setRenaming(null)
    // 已上传种子：每事件若当前选中的是 uploaded，则补一行展示
    const seed: Record<EventKey, UploadedItem[]> = { attention: [], complete: [], failed: [] }
    for (const { key } of EVENT_META) {
      const item = uploadedItemFromSound(config.events[key].sound)
      if (item) seed[key] = [item]
    }
    setUploads(seed)
    // 外部渠道：明文不回显（密钥库不返回明文），仅按 secretRef 标「已配置」
    setExtInput({ webhook: { url: '' }, feishu: { url: '', sign: '' } })
  }, [open, config])

  // 保存：写外部渠道密钥 → 拿 secretRef 合并进 draft → putReminders → reload
  const persist = useCallback(async (cfg: RemindersConfig): Promise<void> => {
    const next: RemindersConfig = JSON.parse(JSON.stringify(cfg))
    // Webhook：启用且填了 URL → 写/更新密钥
    try {
      if (next.external.webhook.enabled && extInput.webhook.url.trim()) {
        const ref = await upsertSecret(
          next.external.webhook.secretRef,
          `reminder:${projectId}:webhook`,
          extInput.webhook.url.trim(),
        )
        next.external.webhook.secretRef = ref
      }
      // 飞书：URL + 签名密钥打包成一个 JSON 值（schema 单 secretRef，无法分两条）
      if (next.external.feishu.enabled && extInput.feishu.url.trim()) {
        const blob = JSON.stringify({ url: extInput.feishu.url.trim(), sign: extInput.feishu.sign.trim() })
        const ref = await upsertSecret(
          next.external.feishu.secretRef,
          `reminder:${projectId}:feishu`,
          blob,
        )
        next.external.feishu.secretRef = ref
      }
    } catch {
      // 密钥写入失败：不阻断 enabled 等其余配置落库（连接信息下次再补）
    }
    try {
      await api.putReminders(projectId, next)
    } catch {
      // 落库失败：静默（前端 UI 层不处理后端错误，下次打开仍读旧值）
    }
    reload()
  }, [projectId, extInput, reload])

  const close = useCallback(() => {
    void persist(draft)
    onClose()
  }, [draft, persist, onClose])

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  const masterOn = draft.enabled

  // ── 编辑器操作 ──────────────────────────────────────────────
  const toggleMaster = () => setDraft((d) => ({ ...d, enabled: !d.enabled }))

  const toggleChannel = (evt: EventKey, ch: ReminderChannel) => {
    setDraft((d) => {
      const cur = d.events[evt].channels
      const has = cur.includes(ch)
      const channels = has ? cur.filter((c) => c !== ch) : [...cur, ch]
      return { ...d, events: { ...d.events, [evt]: { ...d.events[evt], channels } } }
    })
  }

  const setSound = (evt: EventKey, sound: SoundCfg) => {
    setDraft((d) => ({ ...d, events: { ...d.events, [evt]: { ...d.events[evt], sound } } }))
  }

  const isSelected = (evt: EventKey, sound: SoundCfg): boolean => {
    const cur = draft.events[evt].sound
    if (cur.kind !== sound.kind) return false
    if (cur.kind === 'system' && sound.kind === 'system') return cur.id === sound.id
    if (cur.kind === 'uploaded' && sound.kind === 'uploaded') return cur.file === sound.file
    return false
  }

  const scrollToTab = (tab: string) => {
    setActiveTab(tab)
    const el = evtRefs.current[tab]
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // 上传音频
  const onUpload = async (evt: EventKey, file: File) => {
    try {
      const { file: relPath } = await api.uploadReminderSound(projectId, file)
      const base = relPath.split('/').pop() ?? relPath
      const item: UploadedItem = { file: relPath, name: base }
      setUploads((u) => ({ ...u, [evt]: [...u[evt], item] }))
      setSound(evt, { kind: 'uploaded', file: relPath })
      // 立即进入行内改名（与原型一致：上传后让用户命名）
      setRenaming(`${evt}:${relPath}`)
      setRenameDraft(base)
    } catch {
      // 上传失败：静默
    }
  }

  const commitRename = (evt: EventKey, file: string) => {
    const v = renameDraft.trim()
    if (v) {
      setUploads((u) => ({
        ...u,
        [evt]: u[evt].map((it) => (it.file === file ? { ...it, name: v } : it)),
      }))
    }
    setRenaming(null)
  }

  const toggleExt = (key: ExtKey) => {
    setDraft((d) => ({
      ...d,
      external: { ...d.external, [key]: { ...d.external[key], enabled: !d.external[key].enabled } },
    }))
  }

  const renderEvent = (evt: EventKey, label: string, desc: string) => {
    const ev: EventCfg = draft.events[evt]
    const audioOn = ev.channels.includes('audio')
    const expanded = sysExpanded[evt]
    return (
      <div className="rmd-evt" data-evt={evt} ref={(el) => { evtRefs.current[evt] = el }} key={evt}>
        <div className="rmd-evt-h"><b>{label}</b><i>{desc}</i></div>
        <div className="rmd-chs">
          {CHANNELS.map(({ ch, label: chLabel }) => (
            <button
              key={ch}
              className={`rmd-ch${ev.channels.includes(ch) ? ' on' : ''}`}
              data-ch={ch}
              type="button"
              onClick={() => toggleChannel(evt, ch)}
            >{chLabel}</button>
          ))}
        </div>
        <div className={`rmd-audio${audioOn ? ' show' : ''}`}>
          <div className="rmd-audio-cat">系统音频</div>
          <div className={`rmd-sys${expanded ? ' expanded' : ''}`}>
            {SYSTEM_SOUNDS.map((s) => {
              const sound: SoundCfg = { kind: 'system', id: s.id }
              return (
                <div
                  key={s.id}
                  className={`rmd-arow${isSelected(evt, sound) ? ' is-sel' : ''}`}
                  data-aud={s.name}
                  onClick={() => setSound(evt, sound)}
                >
                  <span className="rmd-aname">{s.name}</span>
                  <button
                    className="rmd-aplay"
                    type="button"
                    title="试听"
                    onClick={(e) => { e.stopPropagation(); playSound(sound, projectId) }}
                  ><IconPlay size={12} /></button>
                </div>
              )
            })}
          </div>
          <button className="rmd-sys-toggle" type="button" onClick={() => setSysExpanded((s) => ({ ...s, [evt]: !s[evt] }))}>
            <span className="rmd-sys-tglabel">{expanded ? '收起' : '展开'}</span>
            <span className="rmd-sys-ct">共 {SYSTEM_SOUNDS.length} 个</span>
          </button>
          <div className="rmd-audio-cat">已上传</div>
          <div className="rmd-upl">
            {uploads[evt].map((it) => {
              const sound: SoundCfg = { kind: 'uploaded', file: it.file }
              const renameKey = `${evt}:${it.file}`
              const isRenaming = renaming === renameKey
              return (
                <div
                  key={it.file}
                  className={`rmd-arow${isSelected(evt, sound) ? ' is-sel' : ''}`}
                  data-aud={it.name}
                  onClick={() => { if (!isRenaming) setSound(evt, sound) }}
                >
                  {isRenaming ? (
                    <input
                      className="rmd-aedit"
                      value={renameDraft}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); commitRename(evt, it.file) }
                        else if (e.key === 'Escape') { e.preventDefault(); setRenaming(null) }
                      }}
                      onBlur={() => commitRename(evt, it.file)}
                    />
                  ) : (
                    <span
                      className="rmd-aname"
                      onClick={(e) => { e.stopPropagation(); setRenaming(renameKey); setRenameDraft(it.name) }}
                    >{it.name}</span>
                  )}
                  <button
                    className="rmd-aplay"
                    type="button"
                    title="试听"
                    onClick={(e) => { e.stopPropagation(); playSound(sound, projectId) }}
                  ><IconPlay size={12} /></button>
                </div>
              )
            })}
            <label className="rmd-audio-up">
              上传…
              <input
                type="file"
                accept="audio/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void onUpload(evt, f)
                  e.target.value = ''
                }}
              />
            </label>
          </div>
        </div>
      </div>
    )
  }

  const renderExtItem = (key: ExtKey) => {
    const cfg = draft.external[key]
    const configured = !!cfg.secretRef
    const isWebhook = key === 'webhook'
    return (
      <div className="rmd-ext-item" key={key}>
        <div className="rmd-ext-row">
          <span className="rmd-ext-lab">
            <b>{isWebhook ? 'Webhook' : '飞书'}</b>
            <i>{isWebhook ? '把通知 POST 到你的地址' : '发到飞书群机器人'}</i>
          </span>
          <button
            className={`toggle rmd-ext-sw${cfg.enabled ? ' on' : ''}`}
            type="button"
            aria-label={`启用${isWebhook ? ' Webhook' : '飞书'}`}
            onClick={() => toggleExt(key)}
          />
        </div>
        <div className={`rmd-ext-cfg${cfg.enabled ? ' show' : ''}`}>
          {isWebhook ? (
            <input
              className="rmd-ext-input"
              type="text"
              placeholder={configured ? '已配置（重填以覆盖）' : 'Webhook URL，如 https://…'}
              value={extInput.webhook.url}
              onChange={(e) => setExtInput((s) => ({ ...s, webhook: { url: e.target.value } }))}
            />
          ) : (
            <>
              <input
                className="rmd-ext-input"
                type="text"
                placeholder={configured ? '已配置（重填以覆盖）' : '飞书机器人 Webhook 地址'}
                value={extInput.feishu.url}
                onChange={(e) => setExtInput((s) => ({ ...s, feishu: { ...s.feishu, url: e.target.value } }))}
              />
              <input
                className="rmd-ext-input"
                type="text"
                placeholder="签名密钥（可选）"
                value={extInput.feishu.sign}
                onChange={(e) => setExtInput((s) => ({ ...s, feishu: { ...s.feishu, sign: e.target.value } }))}
              />
            </>
          )}
          {configured && <span className="rmd-ext-hint">连接信息已存入密钥库（不回显明文）</span>}
        </div>
      </div>
    )
  }

  return (
    <div
      className="modal-backdrop rmd-modal-bd open"
      id="rmdModal"
      onClick={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div className="rmd-modal" role="dialog" aria-label="提醒设置">
        <div className="rmd-m-head">
          <div className="rmd-m-title">提醒<span className="rmd-m-sub">本项目 · 不同会话状态分别选择通知方式（仅窗口在后台时触发）</span></div>
          <button className="automation-modal__close" type="button" title="关闭" onClick={close}><IconClose size={16} /></button>
        </div>
        <div className="rmd-tabs">
          {EVENT_META.map(({ key, label }) => (
            <button
              key={key}
              className={`rmd-tab${activeTab === key ? ' is-active' : ''}`}
              data-tab={key}
              type="button"
              onClick={() => scrollToTab(key)}
            >{label}</button>
          ))}
          <button
            className={`rmd-tab rmd-tab-ext${activeTab === 'ext' ? ' is-active' : ''}`}
            data-tab="ext"
            type="button"
            onClick={() => scrollToTab('ext')}
          ><IconGear size={13} />外部渠道</button>
        </div>
        <div className={`rmd-m-body${masterOn ? '' : ' rmd-disabled'}`} ref={bodyRef}>
          {EVENT_META.map(({ key, label, desc }) => renderEvent(key, label, desc))}
          <div className="rmd-ext" data-evt="ext" ref={(el) => { evtRefs.current['ext'] = el }}>
            <div className="rmd-ext-title">外部渠道<span className="rmd-ext-note">需先填写连接信息</span></div>
            {renderExtItem('webhook')}
            {renderExtItem('feishu')}
          </div>
        </div>
        <div className="rmd-m-foot">
          <span className="rmd-foot-note">更多渠道持续接入中</span>
          <span className="rmd-master">
            启用提醒
            <button
              className={`toggle${masterOn ? ' on' : ''}`}
              id="rmdMaster"
              type="button"
              aria-label="启用提醒"
              onClick={toggleMaster}
            />
          </span>
          {masterOn && <button className="rmd-done" type="button" onClick={close}>完成</button>}
        </div>
      </div>
    </div>
  )
}

/**
 * 写/更新一条密钥，返回 secretId（= secretRef）。
 * - 已有 secretRef → updateSecret（覆盖 value）
 * - 无 → createSecret（name 用稳定的 `reminder:<project>:<channel>` 便于「谁在用」识别）
 * updateSecret 失败（如旧 secret 已被删）→ 回退新建。
 */
async function upsertSecret(existingRef: string | null, name: string, value: string): Promise<string> {
  if (existingRef) {
    try {
      const { secret } = await api.updateSecret(existingRef, { value })
      return secret.id
    } catch {
      // 旧 secret 不存在等 → 落到新建
    }
  }
  const { secret } = await api.createSecret({ name, value })
  return secret.id
}
