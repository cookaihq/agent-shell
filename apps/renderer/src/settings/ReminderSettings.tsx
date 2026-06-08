/**
 * ReminderSettings.tsx — 设置页「提醒」子页：编辑全局默认提醒配置
 *
 * 写的是全局默认 ~/.agent-shell/reminders.default.json（建新项目时拷进项目，见 T3）。
 * 通过 T6 的 api.getDefaultReminders / putDefaultReminders 读写。
 *
 * 与项目级 RemindersModal（workspace/RemindersModal.tsx）的差异（spec §6.2）：
 *   - 音频：全局只支持系统预设（default/crisp/alert/chime）+ 试听，
 *     不支持上传（上传是项目相对路径 .agent-shell/sounds/，全局无项目可落盘）。
 *   - 外部渠道：只做 enable 开关（写 external.{webhook|feishu}.enabled），
 *     不收连接信息 / 不接密钥库（全局密钥未定，spec「另议」）。连接信息提示去各项目里配。
 *   - 形态：不是模态，而是设置子页——用 set-kicker/set-h/set-card 布局 +
 *     显式「保存」按钮 + 已保存提示，对齐 SystemSettings 的保存惯例。
 *   - 视觉：复用 RemindersModal 的 .rmd-* chip/音频样式，保持两处一致。
 */

import React, { useEffect, useState } from 'react'
import { api } from '../api/client'
import { playSound } from '../utils/reminderSound'
import { Button } from '../ui/Button'
import { IconPlay } from '../ui/icons'
import {
  DEFAULT_REMINDERS_CONFIG,
  type RemindersConfig,
  type ReminderChannel,
  type SoundCfg,
} from '@agent-shell/contracts'

type EventKey = 'attention' | 'complete' | 'failed'
type ExtKey = 'webhook' | 'feishu'

const EVENT_META: { key: EventKey; label: string; desc: string }[] = [
  { key: 'attention', label: '需要介入', desc: '授权 / 提问等你' },
  { key: 'complete', label: '完成', desc: '一轮成功跑完' },
  { key: 'failed', label: '失败', desc: '报错 / 超时 / 崩溃' },
]

const CHANNELS: { ch: ReminderChannel; label: string }[] = [
  { ch: 'audio', label: '音频播放' },
  { ch: 'inapp', label: 'APP 内通知' },
  { ch: 'system', label: '系统通知' },
]

// 系统预设音效（id 对齐 contracts SystemSound.id 推荐值 + reminderSound.SYSTEM_SOUND_FREQS）
const SYSTEM_SOUNDS: { id: string; name: string }[] = [
  { id: 'default', name: '默认提示音' },
  { id: 'crisp', name: '清脆 Ping' },
  { id: 'alert', name: '低沉 Alert' },
  { id: 'chime', name: '柔和 Chime' },
]

export function ReminderSettings() {
  const [draft, setDraft] = useState<RemindersConfig>(DEFAULT_REMINDERS_CONFIG)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.getDefaultReminders().then(setDraft).catch(() => {})
  }, [])

  const masterOn = draft.enabled

  const toggleMaster = () => { setDraft((d) => ({ ...d, enabled: !d.enabled })); setSaved(false) }

  const toggleChannel = (evt: EventKey, ch: ReminderChannel) => {
    setSaved(false)
    setDraft((d) => {
      const cur = d.events[evt].channels
      const has = cur.includes(ch)
      const channels = has ? cur.filter((c) => c !== ch) : [...cur, ch]
      return { ...d, events: { ...d.events, [evt]: { ...d.events[evt], channels } } }
    })
  }

  const setSystemSound = (evt: EventKey, id: string) => {
    setSaved(false)
    setDraft((d) => ({
      ...d,
      events: { ...d.events, [evt]: { ...d.events[evt], sound: { kind: 'system', id } } },
    }))
  }

  // 全局默认音频只认系统预设；若历史值是 uploaded（理论不该出现），高亮回退到 default
  const selectedSystemId = (evt: EventKey): string => {
    const s = draft.events[evt].sound
    return s.kind === 'system' ? s.id : 'default'
  }

  const toggleExt = (key: ExtKey) => {
    setSaved(false)
    setDraft((d) => ({
      ...d,
      external: { ...d.external, [key]: { ...d.external[key], enabled: !d.external[key].enabled } },
    }))
  }

  async function handleSave() {
    try {
      await api.putDefaultReminders(draft)
      setSaved(true)
    } catch {
      // keep it simple：前端 UI 层不处理后端错误
    }
  }

  const renderEvent = ({ key, label, desc }: { key: EventKey; label: string; desc: string }) => {
    const ev = draft.events[key]
    const audioOn = ev.channels.includes('audio')
    const selId = selectedSystemId(key)
    return (
      <div className="rmd-evt" data-evt={key} key={key}>
        <div className="rmd-evt-h"><b>{label}</b><i>{desc}</i></div>
        <div className="rmd-chs">
          {CHANNELS.map(({ ch, label: chLabel }) => (
            <button
              key={ch}
              className={`rmd-ch${ev.channels.includes(ch) ? ' on' : ''}`}
              data-ch={ch}
              type="button"
              onClick={() => toggleChannel(key, ch)}
            >{chLabel}</button>
          ))}
        </div>
        <div className={`rmd-audio${audioOn ? ' show' : ''}`}>
          <div className="rmd-audio-cat">系统音频</div>
          <div className="rmd-sys expanded">
            {SYSTEM_SOUNDS.map((s) => {
              const sound: SoundCfg = { kind: 'system', id: s.id }
              return (
                <div
                  key={s.id}
                  className={`rmd-arow${selId === s.id ? ' is-sel' : ''}`}
                  data-aud={s.name}
                  onClick={() => setSystemSound(key, s.id)}
                >
                  <span className="rmd-aname">{s.name}</span>
                  <button
                    className="rmd-aplay"
                    type="button"
                    title="试听"
                    onClick={(e) => { e.stopPropagation(); playSound(sound) }}
                  ><IconPlay size={12} /></button>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  const renderExtItem = (key: ExtKey) => {
    const cfg = draft.external[key]
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
      </div>
    )
  }

  return (
    <>
      <p className="set-kicker">设置</p>
      <h2 className="set-h">提醒</h2>
      <p className="set-sub">新建项目时套用的默认提醒配置。每个项目可在工作区里单独覆盖。</p>

      <div className="set-card">
        <div className="rmd-set-master">
          <span className="rmd-master">
            启用提醒
            <button
              className={`toggle${masterOn ? ' on' : ''}`}
              type="button"
              aria-label="启用提醒"
              onClick={toggleMaster}
            />
          </span>
          <span className="field-hint" style={{ marginTop: 0 }}>仅在 App 窗口处于后台时触发。</span>
        </div>

        <div className={`rmd-set-body${masterOn ? '' : ' rmd-disabled'}`}>
          {EVENT_META.map(renderEvent)}

          <div className="rmd-ext" data-evt="ext">
            <div className="rmd-ext-title">外部渠道</div>
            {renderExtItem('webhook')}
            {renderExtItem('feishu')}
            <div className="field-hint" style={{ marginTop: 8 }}>
              连接信息（Webhook 地址 / 飞书签名等）请在各项目的提醒设置里配置——全局默认仅保存开关。
            </div>
          </div>
        </div>
      </div>

      <div className="set-actions" style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
        <Button variant="primary" onClick={handleSave}>保存</Button>
        {saved && <span className="saved-pill">已保存</span>}
      </div>
    </>
  )
}
