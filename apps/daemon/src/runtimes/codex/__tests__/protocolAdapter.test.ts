import { describe, it, expect } from 'vitest'
import { CodexProtocolAdapter0137 } from '../protocolAdapter'

const A = (version = '1.2.3') => new CodexProtocolAdapter0137(version)

describe('CodexProtocolAdapter0137', () => {
  describe('buildInitializeParams', () => {
    it('固定 clientInfo + capabilities，version 来自构造参（daemon 版本）', () => {
      expect(A('9.9.9').buildInitializeParams()).toEqual({
        clientInfo: { name: 'agent-shell', title: null, version: '9.9.9' },
        capabilities: { experimentalApi: true, requestAttestation: false },
      })
    })
  })

  describe('buildThreadStartParams', () => {
    it('全字段（identity 映射 approval→approvalPolicy、sandbox 透传）', () => {
      expect(
        A().buildThreadStartParams({
          cwd: '/work',
          model: 'gpt-5.5',
          approval: 'on-request',
          sandbox: 'read-only',
        }),
      ).toEqual({ cwd: '/work', model: 'gpt-5.5', approvalPolicy: 'on-request', sandbox: 'read-only' })
    })

    it('缺省字段省略（只有 cwd）', () => {
      expect(A().buildThreadStartParams({ cwd: '/work' })).toEqual({ cwd: '/work' })
    })

    it('三档 sandbox 字符串原样透传（不归一化）', () => {
      for (const s of ['read-only', 'workspace-write', 'danger-full-access']) {
        expect(A().buildThreadStartParams({ cwd: '/w', sandbox: s }).sandbox).toBe(s)
      }
    })

    it('三档 approval 字符串原样透传到 approvalPolicy', () => {
      for (const a of ['untrusted', 'on-request', 'never']) {
        expect(A().buildThreadStartParams({ cwd: '/w', approval: a }).approvalPolicy).toBe(a)
      }
    })
  })

  describe('buildThreadResumeParams', () => {
    it('按 thread id 续接', () => {
      expect(A().buildThreadResumeParams('t-9')).toEqual({ threadId: 't-9' })
    })
  })

  describe('buildTurnStartParams', () => {
    it('prompt → 固定 text 块（text_elements:[]），effort 透传', () => {
      expect(A().buildTurnStartParams('t1', 'hello', { effort: 'high' })).toEqual({
        threadId: 't1',
        input: [{ type: 'text', text: 'hello', text_elements: [] }],
        effort: 'high',
      })
    })

    it('无 effort → 省略 effort 字段', () => {
      const p = A().buildTurnStartParams('t1', 'hi', {})
      expect(p).toEqual({ threadId: 't1', input: [{ type: 'text', text: 'hi', text_elements: [] }] })
      expect('effort' in p).toBe(false)
    })
  })

  describe('buildInterruptParams', () => {
    it('必带 threadId + turnId（缺 turnId 真机 -32600）', () => {
      expect(A().buildInterruptParams('t1', 'turn-1')).toEqual({ threadId: 't1', turnId: 'turn-1' })
    })
  })

  describe('extractThreadId', () => {
    it('读 result.thread.id', () => {
      expect(A().extractThreadId({ thread: { id: 'thr-1' }, model: 'x' })).toBe('thr-1')
    })
    it('缺 thread.id → 抛错', () => {
      expect(() => A().extractThreadId({ thread: {} })).toThrow()
      expect(() => A().extractThreadId(null)).toThrow()
    })
  })

  describe('extractTurnId', () => {
    it('读 params.turn.id（NOT params.turnId）', () => {
      // 真机 turn/started.params：turnId 在 turn.id，params.turnId 不存在
      expect(A().extractTurnId({ threadId: 't', turn: { id: 'turn-abc', status: 'inProgress' } })).toBe('turn-abc')
    })
    it('缺 turn.id → 抛错', () => {
      expect(() => A().extractTurnId({ threadId: 't' })).toThrow()
    })
  })

  describe('extractVersion', () => {
    it('正则抓 userAgent 第一个 x.y.z', () => {
      const ua = 'agent-shell-probe/0.137.0 (Mac OS 26.3.0; arm64) unknown (agent-shell-probe; 0.0.1)'
      expect(A().extractVersion({ userAgent: ua })).toBe('0.137.0')
    })
    it('无 userAgent / 非字符串 → undefined', () => {
      expect(A().extractVersion({})).toBeUndefined()
      expect(A().extractVersion(null)).toBeUndefined()
      expect(A().extractVersion({ userAgent: 123 })).toBeUndefined()
    })
  })

  describe('mapEvent', () => {
    it('委托 eventMap：turn/completed → turn_end', () => {
      const evs = A().mapEvent('turn/completed', { turn: { status: 'completed' } })
      expect(evs).toEqual([{ type: 'turn_end', stopReason: 'completed' }])
    })
    it('未知通知 → []', () => {
      expect(A().mapEvent('thread/status/changed', {})).toEqual([])
    })
  })
})
