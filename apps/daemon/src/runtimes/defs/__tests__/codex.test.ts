import { describe, it, expect } from 'vitest'
import { codexDef } from '../codex'

describe('codexDef', () => {
  it('def 元信息：codex prompt 走 stdin text；turnBoundary=event（Part A 改 app-server 常驻，一进程多 turn）', () => {
    expect(codexDef.engine).toBe('codex')
    expect(codexDef.bin).toBe('codex')
    expect(codexDef.promptInputFormat).toBe('text')
    expect(codexDef.closeStdinAfterPrompt).toBe(true)   // [vestigial] 旧 CLI exec 路径残留，app-server 不读
    expect(codexDef.turnBoundary).toBe('event')          // [Part A] 常驻保活：turn/completed 不退、等 pushUser（对齐 claude）
    expect(codexDef.authStrategy).toEqual({ apiKeyEnv: 'OPENAI_API_KEY', baseUrlEnv: 'OPENAI_BASE_URL' })
  })

  it('buildArgs：exec --json --skip-git-repo-check -m -s -，sandbox 缺省 workspace-write', () => {
    expect(codexDef.buildArgs({ model: 'gpt-5' })).toEqual([
      'exec', '--json', '--skip-git-repo-check', '-m', 'gpt-5', '-s', 'workspace-write', '-',
    ])
  })

  it('buildArgs：给了 sandbox → 用传入值', () => {
    expect(codexDef.buildArgs({ model: 'gpt-5', sandbox: 'read-only' })).toEqual([
      'exec', '--json', '--skip-git-repo-check', '-m', 'gpt-5', '-s', 'read-only', '-',
    ])
  })

  it('formatPrompt：原样文本（codex 读 stdin 到 EOF）', () => {
    expect(codexDef.formatPrompt('build me a thing')).toBe('build me a thing')
  })

  it('parseLine 装配 M2 入口：agent_message → message 事件', () => {
    const line = JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'done' } })
    expect(codexDef.parseLine(line)).toEqual([{ type: 'message', text: 'done' }])
  })

  it('extractResumableId：仅 thread.started 的 thread_id', () => {
    expect(codexDef.extractResumableId(JSON.stringify({ type: 'thread.started', thread_id: 't-9' }))).toBe('t-9')
    expect(codexDef.extractResumableId(JSON.stringify({ type: 'turn.completed' }))).toBeUndefined()
    expect(codexDef.extractResumableId('xx')).toBeUndefined()
  })

  it('buildArgs：有 resumableId → exec ... resume <id> -（实测形状）', () => {
    const args = codexDef.buildArgs({ model: 'gpt-5', sandbox: 'workspace-write', resumableId: 't-1' })
    expect(args).toEqual(['exec', '--json', '--skip-git-repo-check', '-m', 'gpt-5', '-s', 'workspace-write', 'resume', 't-1', '-'])
  })

  it('buildArgs：无 resumableId → 首轮 exec ... -（不含 resume）', () => {
    const args = codexDef.buildArgs({ model: 'gpt-5', sandbox: 'workspace-write' })
    expect(args).toEqual(['exec', '--json', '--skip-git-repo-check', '-m', 'gpt-5', '-s', 'workspace-write', '-'])
    expect(args).not.toContain('resume')
  })

  it('buildArgs：addDirs 非空 → 加 -c sandbox_permissions 放行项目外读取（V1 兜底 disk-full-read-access）', () => {
    const args = codexDef.buildArgs({ model: 'gpt-5', sandbox: 'workspace-write', addDirs: ['/ext/a'] })
    expect(args).toEqual([
      'exec', '--json', '--skip-git-repo-check', '-m', 'gpt-5', '-s', 'workspace-write',
      '-c', 'sandbox_permissions=["disk-full-read-access"]', '-',
    ])
  })

  it('buildArgs：addDirs 空 → 不加 sandbox_permissions', () => {
    const args = codexDef.buildArgs({ model: 'gpt-5', addDirs: [] })
    expect(args).not.toContain('-c')
  })
})
