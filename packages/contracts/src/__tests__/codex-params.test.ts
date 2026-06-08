import { describe, it, expect } from 'vitest'
import { CodexSandbox, CodexApproval, CodexEffort, CreateSessionReq, SubmitMessageReq } from '../dto'

describe('codex 两轴权限契约', () => {
  it('CodexSandbox 解析三档、拒绝非法值', () => {
    expect(CodexSandbox.parse('workspace-write')).toBe('workspace-write')
    expect(CodexSandbox.parse('read-only')).toBe('read-only')
    expect(CodexSandbox.parse('danger-full-access')).toBe('danger-full-access')
    expect(() => CodexSandbox.parse('x')).toThrow()
  })

  it('CodexApproval 解析三档', () => {
    expect(CodexApproval.parse('untrusted')).toBe('untrusted')
    expect(CodexApproval.parse('on-request')).toBe('on-request')
    expect(CodexApproval.parse('never')).toBe('never')
  })

  it('CodexEffort 含 minimal / xhigh', () => {
    expect(CodexEffort.parse('minimal')).toBe('minimal')
    expect(CodexEffort.parse('xhigh')).toBe('xhigh')
  })

  it('CreateSessionReq 保留 codex sandbox/approval', () => {
    const r = CreateSessionReq.parse({ projectId: 'p', engine: 'codex', model: 'gpt-5.5', sandbox: 'read-only', approval: 'untrusted' })
    expect(r.sandbox).toBe('read-only')
    expect(r.approval).toBe('untrusted')
  })

  it('SubmitMessageReq 保留 codex sandbox/approval', () => {
    const r = SubmitMessageReq.parse({ text: 'hi', sandbox: 'workspace-write', approval: 'on-request' })
    expect(r.sandbox).toBe('workspace-write')
    expect(r.approval).toBe('on-request')
  })
})
