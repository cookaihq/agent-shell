import { describe, it, expect } from 'vitest'
import { shouldShowAuthBanner } from '../authBanner'
import type { AuthStatusResp } from '../../api/types'

// 构造一份 AuthStatusResp：claude 引擎用传入参数，codex 固定占位（不影响 claude 判定）。
function mkStatus(claude: { activeSource: string; cliStatus: 'signed-in' | 'signed-out' | 'unknown' }): AuthStatusResp {
  const engine = (activeSource: string, cliStatus: 'signed-in' | 'signed-out' | 'unknown') => ({
    activeSource,
    officialKey: {},
    custom: [],
    cliLogin: { status: cliStatus },
    oauth: { signedIn: false },
    proxyBindings: {},
  })
  return {
    engines: {
      claude: engine(claude.activeSource, claude.cliStatus),
      codex: engine('cli-login', 'signed-out'),
    },
  }
}

describe('shouldShowAuthBanner', () => {
  it('claude + cli-login + signed-out → 显示 banner', () => {
    const status = mkStatus({ activeSource: 'cli-login', cliStatus: 'signed-out' })
    expect(shouldShowAuthBanner('claude', status, false)).toBe(true)
  })

  it('claude + cli-login + signed-in → 不显示（已登录）', () => {
    const status = mkStatus({ activeSource: 'cli-login', cliStatus: 'signed-in' })
    expect(shouldShowAuthBanner('claude', status, false)).toBe(false)
  })

  it('claude + activeSource oauth（即便 cli signed-out）→ 不显示（已配置替代来源）', () => {
    const status = mkStatus({ activeSource: 'oauth', cliStatus: 'signed-out' })
    expect(shouldShowAuthBanner('claude', status, false)).toBe(false)
  })

  it('codex（任意状态）→ 永不显示', () => {
    const status = mkStatus({ activeSource: 'cli-login', cliStatus: 'signed-out' })
    expect(shouldShowAuthBanner('codex', status, false)).toBe(false)
  })

  it('dismissed=true → 不显示（本会话已忽略）', () => {
    const status = mkStatus({ activeSource: 'cli-login', cliStatus: 'signed-out' })
    expect(shouldShowAuthBanner('claude', status, true)).toBe(false)
  })

  it('status 为 null（尚未取到）→ 不显示', () => {
    expect(shouldShowAuthBanner('claude', null, false)).toBe(false)
  })
})
