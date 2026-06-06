import { describe, it, expect } from 'vitest'
import { claudeDef } from '../claude'

describe('claudeDef', () => {
  it('def 元信息：claude 常驻、stdin 不关、turn 靠事件', () => {
    expect(claudeDef.engine).toBe('claude')
    expect(claudeDef.bin).toBe('claude')
    expect(claudeDef.promptInputFormat).toBe('stream-json')
    expect(claudeDef.closeStdinAfterPrompt).toBe(false)
    expect(claudeDef.turnBoundary).toBe('event')
    expect(claudeDef.authStrategy).toEqual({ apiKeyEnv: 'ANTHROPIC_API_KEY', baseUrlEnv: 'ANTHROPIC_BASE_URL', altKeyEnv: 'ANTHROPIC_AUTH_TOKEN' })
  })

  it('buildArgs：stream-json 进出 + verbose + model + 写死 bypassPermissions', () => {
    expect(claudeDef.buildArgs({ model: 'opus' })).toEqual([
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--include-partial-messages',
      '--model', 'opus', '--permission-mode', 'bypassPermissions',
    ])
  })

  it('buildArgs：无条件写死 --permission-mode bypassPermissions（忽略 opts.permissionMode）', () => {
    // headless 下没授权通道，default 会自动拒写操作；对齐 open-design 一律 bypass
    expect(claudeDef.buildArgs({ model: 'opus', permissionMode: 'plan' })).toEqual([
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--include-partial-messages',
      '--model', 'opus', '--permission-mode', 'bypassPermissions',
    ])
  })

  it('buildArgs：addDirs → 逐个追加 --add-dir（授权读项目外目录）', () => {
    expect(claudeDef.buildArgs({ model: 'opus', addDirs: ['/ext/a', '/ext/b'] })).toEqual([
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--include-partial-messages',
      '--model', 'opus', '--permission-mode', 'bypassPermissions', '--add-dir', '/ext/a', '--add-dir', '/ext/b',
    ])
  })

  it('formatPrompt：编码为一行 stream-json user 消息，末尾带换行', () => {
    const s = claudeDef.formatPrompt('hi')
    expect(s.endsWith('\n')).toBe(true)
    expect(JSON.parse(s.trim())).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    })
  })

  it('parseLine 装配 M2 入口：assistant text → message 事件', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'yo' }] } })
    expect(claudeDef.parseLine(line)).toEqual([{ type: 'message', text: 'yo' }])
  })

  it('extractResumableId：任意带 session_id 的行 → 该 id；无则 undefined', () => {
    expect(claudeDef.extractResumableId(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abc-1' }))).toBe('abc-1')
    expect(claudeDef.extractResumableId(JSON.stringify({ type: 'result', session_id: 'abc-1' }))).toBe('abc-1')
    expect(claudeDef.extractResumableId(JSON.stringify({ type: 'assistant', message: {} }))).toBeUndefined()
    expect(claudeDef.extractResumableId('not json')).toBeUndefined()
  })

  it('buildArgs：有 resumableId → 末尾追加 --resume <id>', () => {
    const args = claudeDef.buildArgs({ model: 'opus', resumableId: 'sess-1' })
    expect(args).toContain('--resume')
    expect(args[args.indexOf('--resume') + 1]).toBe('sess-1')
  })

  it('buildArgs：无 resumableId → 不含 --resume', () => {
    expect(claudeDef.buildArgs({ model: 'opus' })).not.toContain('--resume')
  })

  it('buildArgs 带 --include-partial-messages（开启流式 delta，progress 的数据来源）', () => {
    const args = claudeDef.buildArgs({ model: 'claude-x' })
    expect(args).toContain('--include-partial-messages')
  })
})
