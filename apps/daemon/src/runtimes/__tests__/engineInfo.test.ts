import { describe, it, expect } from 'vitest'
import { detectEngineVersion, engineLabel } from '../engineInfo'

describe('detectEngineVersion', () => {
  it('claude：首 token 为版本', () => {
    expect(detectEngineVersion('/x/claude', () => '2.1.156 (Claude Code)\n')).toBe('2.1.156')
  })
  it('codex：取版本号 token（含点的数字段）', () => {
    expect(detectEngineVersion('/x/codex', () => 'codex-cli 0.132.0\n')).toBe('0.132.0')
  })
  it('run 抛错 → null', () => {
    expect(detectEngineVersion('/x/claude', () => { throw new Error('ENOENT') })).toBeNull()
  })
})
describe('engineLabel', () => {
  it('映射', () => { expect(engineLabel('claude')).toBe('Claude Code'); expect(engineLabel('codex')).toBe('Codex CLI') })
})
