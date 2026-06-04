import { describe, it, expect } from 'vitest'
import { DESKTOP_IPC, AUTH_HEADER, AUTH_PENDING_CODE } from '../desktop'

describe('desktop 桥契约常量', () => {
  it('IPC 通道名稳定（preload 重复字面量的对照基准）', () => {
    expect(DESKTOP_IPC.pickFolder).toBe('agent-shell:pick-folder')
    expect(DESKTOP_IPC.pickPaths).toBe('agent-shell:pick-paths')
    expect(DESKTOP_IPC.authToken).toBe('agent-shell:auth-token')
    expect(DESKTOP_IPC.tabsGet).toBe('agent-shell:tabs-get')
    expect(DESKTOP_IPC.tabsSet).toBe('agent-shell:tabs-set')
    expect(DESKTOP_IPC.openPath).toBe('agent-shell:open-path')
    expect(DESKTOP_IPC.openExternal).toBe('agent-shell:open-external')
  })
  it('鉴权头名小写、错误码稳定', () => {
    expect(AUTH_HEADER).toBe('x-agent-shell-token')
    expect(AUTH_PENDING_CODE).toBe('DESKTOP_AUTH_PENDING')
  })
})
