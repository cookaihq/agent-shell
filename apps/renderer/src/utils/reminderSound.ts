import type { SoundCfg } from '@agent-shell/contracts'
import { api } from '../api/client'

/**
 * 系统预设音效 id → 频率（Hz）映射。
 *
 * 取舍说明（与 spec §4 的偏差）：
 *   spec §4 原话是「系统预设打包 WAV」，但项目当前无现成 WAV 二进制素材，
 *   也不应伪造/下载音频文件。改用 WebAudio API 运行时合成短促正弦波，
 *   效果可辨识、跨平台、无需二进制资源，且可逆——日后若要换成真 WAV，
 *   只需替换 playSystemSound 中的实现，外部调用方不感知。
 *
 * 频率参考原型 app.js（FREQ 映射，中文 key 对应英文 id）：
 *   '默认提示音' → default ≈ 523 Hz（C5）
 *   '清脆 Ping'  → crisp  ≈ 784 Hz（G5）
 *   '低沉 Alert' → alert  ≈ 330 Hz（E4）
 *   '柔和 Chime' → chime  ≈ 659 Hz（E5）
 *
 * 供 T9（配置模态试听）复用，避免重复定义。
 */
export const SYSTEM_SOUND_FREQS: Record<string, number> = {
  default: 523,
  crisp: 784,
  alert: 330,
  chime: 659,
}

/** 默认频率（id 不在映射表时的回退） */
const FALLBACK_FREQ = 523

/** 复用 AudioContext 实例（避免每次创建新的） */
let _actx: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  try {
    if (!_actx || _actx.state === 'closed') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return null
      _actx = new AC()
    }
    return _actx
  } catch {
    return null
  }
}

/**
 * 用 WebAudio 合成短促提示音（参考原型 app.js beep 实现，TS 重写）。
 * Attack 0.01s → 峰值 0.18 → decay 到 ~0.28s 结束。
 * 异常（浏览器策略/解码失败）静默忽略。
 */
function playSystemSound(id: string): void {
  try {
    const actx = getAudioContext()
    if (!actx) return
    const freq = SYSTEM_SOUND_FREQS[id] ?? FALLBACK_FREQ
    const o = actx.createOscillator()
    const g = actx.createGain()
    const t = actx.currentTime
    o.frequency.value = freq
    o.connect(g)
    g.connect(actx.destination)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28)
    o.start(t)
    o.stop(t + 0.29)
  } catch {
    // 浏览器策略/解码失败：忽略
  }
}

/**
 * 播放上传音频。
 * - 需要 projectId 拼出 API URL（GET /projects/:id/reminders/sounds/:name）
 * - 若 projectId 缺失或文件名为空：降级到系统 default 合成音（可辨识 > 静默）
 *   取舍：降级到 default 音而非静默，是为了让用户知道「有提醒」，避免无声漏掉。
 *   若业务要求严格静默，只需将 fallback 行改为 return 即可。
 * - 播放失败（浏览器策略/解码失败）静默忽略
 */
function playUploadedSound(sound: Extract<SoundCfg, { kind: 'uploaded' }>, projectId?: string): void {
  if (!projectId || !sound.file) {
    // 降级：系统 default 合成音
    playSystemSound('default')
    return
  }
  // 取文件名（去掉目录前缀）
  const name = sound.file.split('/').pop() ?? sound.file
  if (!name) {
    playSystemSound('default')
    return
  }
  const url = api.reminderSoundUrl(projectId, name)
  const audio = new Audio(url)
  audio.play().catch(() => {
    // 播放失败（浏览器自动播放策略/解码错误）：忽略
  })
}

/**
 * 播放提醒音效。
 *
 * @param sound  SoundCfg（来自 RemindersConfig.events.*.sound）
 * @param projectId  当前项目 ID（上传音效回放时需要；系统预设可省略）
 */
export function playSound(sound: SoundCfg, projectId?: string): void {
  if (sound.kind === 'system') {
    playSystemSound(sound.id)
  } else {
    playUploadedSound(sound, projectId)
  }
}
