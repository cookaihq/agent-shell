import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// mock api 模块（reminderSoundUrl）
vi.mock('../../api/client', () => ({
  api: {
    reminderSoundUrl: vi.fn((projectId: string, name: string) => `/api/projects/${projectId}/reminders/sounds/${name}`),
  },
}))

import { playSound, SYSTEM_SOUND_FREQS } from '../reminderSound'
import { api } from '../../api/client'

const mockReminderSoundUrl = api.reminderSoundUrl as ReturnType<typeof vi.fn>

// ── WebAudio mock ──────────────────────────────────────────────────────────
// jsdom 没有 WebAudio，需要 mock AudioContext
const mockStop = vi.fn()
const mockStart = vi.fn()
const mockConnect = vi.fn()
const mockSetValueAtTime = vi.fn()
const mockExponentialRampToValueAtTime = vi.fn()

const mockGainNode = {
  connect: mockConnect,
  gain: {
    setValueAtTime: mockSetValueAtTime,
    exponentialRampToValueAtTime: mockExponentialRampToValueAtTime,
  },
}

const mockOscillator = {
  frequency: { value: 0 },
  connect: mockConnect,
  start: mockStart,
  stop: mockStop,
}

let capturedFreq = 0
const mockCreateOscillator = vi.fn(() => {
  capturedFreq = 0 // reset
  return {
    ...mockOscillator,
    get frequency() { return { get value() { return capturedFreq }, set value(v: number) { capturedFreq = v } } },
    connect: mockConnect,
    start: mockStart,
    stop: mockStop,
  }
})
const mockCreateGain = vi.fn(() => mockGainNode)

const mockAudioContext = vi.fn(() => ({
  createOscillator: mockCreateOscillator,
  createGain: mockCreateGain,
  destination: {},
  currentTime: 0,
  state: 'running',
}))

// ── Audio（HTMLMediaElement）mock ──────────────────────────────────────────
let mockAudioInstances: { src: string; play: ReturnType<typeof vi.fn> }[] = []
class MockAudio {
  src: string
  play: ReturnType<typeof vi.fn>
  constructor(src: string) {
    this.src = src
    this.play = vi.fn().mockResolvedValue(undefined)
    mockAudioInstances.push(this)
  }
}

beforeEach(() => {
  capturedFreq = 0
  mockAudioInstances = []
  mockCreateOscillator.mockClear()
  mockCreateGain.mockClear()
  mockStart.mockClear()
  mockStop.mockClear()
  mockConnect.mockClear()
  mockSetValueAtTime.mockClear()
  mockExponentialRampToValueAtTime.mockClear()
  mockReminderSoundUrl.mockClear()

  // 每次 test 重新注入 AudioContext（避免 module 级 _actx 缓存干扰）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).AudioContext = mockAudioContext
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).Audio = MockAudio
})

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).AudioContext
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).Audio
  vi.restoreAllMocks()
})

describe('SYSTEM_SOUND_FREQS', () => {
  it('包含四个推荐预设 id', () => {
    expect(SYSTEM_SOUND_FREQS).toMatchObject({
      default: expect.any(Number),
      crisp: expect.any(Number),
      alert: expect.any(Number),
      chime: expect.any(Number),
    })
  })

  it('不同 id 对应不同频率', () => {
    const freqs = Object.values(SYSTEM_SOUND_FREQS)
    const unique = new Set(freqs)
    expect(unique.size).toBe(freqs.length)
  })

  it('频率在合理范围（100-2000 Hz）', () => {
    for (const freq of Object.values(SYSTEM_SOUND_FREQS)) {
      expect(freq).toBeGreaterThanOrEqual(100)
      expect(freq).toBeLessThanOrEqual(2000)
    }
  })
})

describe('playSound — 系统预设（kind: system）', () => {
  it('调用 AudioContext 并设置对应频率', () => {
    playSound({ kind: 'system', id: 'default' })
    expect(mockAudioContext).toHaveBeenCalled()
    expect(mockCreateOscillator).toHaveBeenCalled()
    expect(capturedFreq).toBe(SYSTEM_SOUND_FREQS['default'])
  })

  it('crisp id 使用 crisp 频率', () => {
    playSound({ kind: 'system', id: 'crisp' })
    expect(capturedFreq).toBe(SYSTEM_SOUND_FREQS['crisp'])
  })

  it('alert id 使用 alert 频率', () => {
    playSound({ kind: 'system', id: 'alert' })
    expect(capturedFreq).toBe(SYSTEM_SOUND_FREQS['alert'])
  })

  it('chime id 使用 chime 频率', () => {
    playSound({ kind: 'system', id: 'chime' })
    expect(capturedFreq).toBe(SYSTEM_SOUND_FREQS['chime'])
  })

  it('未知 id 回退到 default 频率（523 Hz）', () => {
    playSound({ kind: 'system', id: 'unknown-xyz' })
    // 未知 id 用 FALLBACK_FREQ 523
    expect(capturedFreq).toBe(523)
  })

  it('调用 oscillator.start 和 stop', () => {
    playSound({ kind: 'system', id: 'default' })
    expect(mockStart).toHaveBeenCalled()
    expect(mockStop).toHaveBeenCalled()
  })

  it('设置 gain 包络（attack + decay）', () => {
    playSound({ kind: 'system', id: 'default' })
    expect(mockSetValueAtTime).toHaveBeenCalled()
    expect(mockExponentialRampToValueAtTime).toHaveBeenCalledTimes(2)
  })

  it('AudioContext 抛错时不向上传播（静默忽略）', () => {
    mockAudioContext.mockImplementationOnce(() => { throw new Error('policy blocked') })
    expect(() => playSound({ kind: 'system', id: 'default' })).not.toThrow()
  })

  it('AudioContext 不存在时不抛错', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).AudioContext
    expect(() => playSound({ kind: 'system', id: 'default' })).not.toThrow()
  })
})

describe('playSound — 上传音频（kind: uploaded）', () => {
  it('有 projectId + file 时创建 Audio 并调用 play', async () => {
    mockReminderSoundUrl.mockReturnValueOnce('/api/projects/proj-1/reminders/sounds/beep.m4a')
    playSound({ kind: 'uploaded', file: '.agent-shell/sounds/beep.m4a' }, 'proj-1')
    expect(mockAudioInstances).toHaveLength(1)
    expect(mockAudioInstances[0].src).toBe('/api/projects/proj-1/reminders/sounds/beep.m4a')
    expect(mockAudioInstances[0].play).toHaveBeenCalled()
  })

  it('URL 中取文件名（basename），通过 reminderSoundUrl 拼接', () => {
    mockReminderSoundUrl.mockReturnValueOnce('/api/projects/p/reminders/sounds/foo.wav')
    playSound({ kind: 'uploaded', file: '.agent-shell/sounds/foo.wav' }, 'proj-x')
    expect(mockReminderSoundUrl).toHaveBeenCalledWith('proj-x', 'foo.wav')
  })

  it('无 projectId 时降级到系统 default 合成音（不创建 Audio）', () => {
    playSound({ kind: 'uploaded', file: '.agent-shell/sounds/beep.m4a' })
    expect(mockAudioInstances).toHaveLength(0)
    // 降级走系统音 → AudioContext 被调用
    expect(mockCreateOscillator).toHaveBeenCalled()
  })

  it('file 为空时降级到系统 default', () => {
    playSound({ kind: 'uploaded', file: '' }, 'proj-1')
    expect(mockAudioInstances).toHaveLength(0)
    expect(mockCreateOscillator).toHaveBeenCalled()
  })

  it('play() 失败（被浏览器策略拦截）时不抛错', async () => {
    mockReminderSoundUrl.mockReturnValueOnce('/api/projects/p/reminders/sounds/x.m4a')
    const { playSound: ps } = await import('../reminderSound')
    // 让 Audio.play() reject
    ;(MockAudio.prototype.play as unknown as ReturnType<typeof vi.fn>)
    const inst = { src: '', play: vi.fn().mockRejectedValueOnce(new Error('autoplay')) }
    // 简化：直接 mock
    const OrigAudio = (globalThis as unknown as { Audio: typeof MockAudio }).Audio
    ;(globalThis as unknown as { Audio: unknown }).Audio = class {
      src: string; play: ReturnType<typeof vi.fn>
      constructor(src: string) { this.src = src; this.play = vi.fn().mockRejectedValueOnce(new Error('autoplay')) }
    }
    expect(() => ps({ kind: 'uploaded', file: 'x.m4a' }, 'proj-1')).not.toThrow()
    ;(globalThis as unknown as { Audio: unknown }).Audio = OrigAudio
    // 给 rejected promise 一个 microtask 完成，避免 unhandledRejection
    await Promise.resolve()
  })
})
