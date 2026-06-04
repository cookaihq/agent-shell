import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { runTurn } from '../scheduler'
import type { AgentEvent } from '@agent-shell/contracts'

/** 假子进程：可注入 stdout 分块、记录写入 stdin 的内容与是否 end()。 */
function fakeChild() {
  const cp: any = new EventEmitter()
  cp.stdout = new EventEmitter()
  cp.stderr = new EventEmitter()
  cp.stdinWrites = [] as string[]
  cp.stdinEnded = false
  cp.killed = false
  cp.stdin = {
    write: (s: string) => { cp.stdinWrites.push(s); return true },
    end: () => { cp.stdinEnded = true },
  }
  cp.killSignals = [] as string[]
  cp.kill = (sig?: string) => { cp.killed = true; cp.killSignals.push(sig || 'SIGTERM'); return true }
  return cp
}

describe('runTurn', () => {
  it('claude：喂 prompt（写 stream-json 行、不关 stdin）→ 分块 stdout 行缓冲归一为内部事件', async () => {
    const cp = fakeChild()
    const events: AgentEvent[] = []
    let captured: any
    const spawnFn = ((bin: string, args: string[], opts: any) => {
      captured = { bin, args, opts }
      return cp
    }) as any

    const { done } = runTurn({
      engine: 'claude', binPath: '/abs/claude', cwd: '/work', model: 'opus',
      prompt: 'hi', baseEnv: { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-x' },
      onEvent: (e) => events.push(e), spawnFn,
    })

    // spawn 入参：绝对路径 + claude argv + cwd + 净化后的 env（剥了 key）
    expect(captured.bin).toBe('/abs/claude')
    expect(captured.args).toContain('--input-format')
    expect(captured.opts.cwd).toBe('/work')
    expect(captured.opts.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(captured.opts.env.PATH).toBe('/usr/bin')

    // prompt 写成一行 stream-json，且【未】关 stdin（claude 常驻）
    expect(JSON.parse(cp.stdinWrites.join('').trim())).toMatchObject({ type: 'user' })
    expect(cp.stdinEnded).toBe(false)

    // stdout 分块到达：assistant 行被切成两块，result 行无末尾换行。
    // 用 tool_use 块验证行缓冲（正文 text 已改为走 text_delta 流式 + 对最终 assistant 的 text 去重过滤）。
    const assistant = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a' } }] } })
    const result = JSON.stringify({ type: 'result', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 2 } })
    cp.stdout.emit('data', assistant.slice(0, 10))
    cp.stdout.emit('data', assistant.slice(10) + '\n' + result)   // result 无末尾 \n
    // 'exit' 不应触发收尾——Node 里 'exit' 时 stdout 可能还没排干；调度器只在 'close' flush
    cp.emit('exit', 0, null)
    expect(events.map((e) => e.type)).toEqual(['tool_use'])   // 仅完整行的 tool_use，终结行还压在 buffer
    cp.emit('close', 0, null)   // 'close' 保证 stdio 排干后触发 → flush 残留的 result 行

    await done
    expect(events.map((e) => e.type)).toEqual(['tool_use', 'usage', 'turn_end'])
    expect(events[0]).toMatchObject({ type: 'tool_use', name: 'Read' })
  })

  it('claude：stream_event 行经 per-run createParser 流出 progress（接线验证——不再被无状态 parseLine 丢弃）', async () => {
    const cp = fakeChild()
    const events: AgentEvent[] = []
    const { done } = runTurn({
      engine: 'claude', binPath: '/abs/claude', cwd: '/work', model: 'opus',
      prompt: 'hi', baseEnv: { PATH: '/usr/bin' }, onEvent: (e) => events.push(e), spawnFn: (() => cp) as any,
    })
    // 流式：thinking 块开始 + thinking_delta（estimated_tokens=40）
    cp.stdout.emit('data',
      JSON.stringify({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } } }) + '\n' +
      JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'x', estimated_tokens: 40 } } }) + '\n')
    cp.emit('close', 0, null)
    await done
    const prog = events.filter((e) => e.type === 'progress') as Extract<AgentEvent, { type: 'progress' }>[]
    expect(prog.length).toBeGreaterThan(0)
    expect(prog.at(-1)).toMatchObject({ type: 'progress', tokens: 40, activity: { kind: 'thinking' } })
  })

  it('codex：prompt 写成 text 并关 stdin（单次）→ 收事件', async () => {
    const cp = fakeChild()
    const events: AgentEvent[] = []
    const { done } = runTurn({
      engine: 'codex', binPath: '/abs/codex', cwd: '/work', model: 'gpt-5',
      prompt: 'build', baseEnv: {}, onEvent: (e) => events.push(e),
      spawnFn: (() => cp) as any,
    })

    expect(cp.stdinWrites.join('')).toBe('build')
    expect(cp.stdinEnded).toBe(true)   // codex 写完即关

    const msg = JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'ok' } })
    const turn = JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 3, output_tokens: 4 } })
    cp.stdout.emit('data', msg + '\n' + turn)   // 末行无换行
    cp.emit('close', 0, null)   // 'close'（stdio 排干）触发收尾 flush

    await done
    expect(events.map((e) => e.type)).toEqual(['message', 'usage', 'turn_end'])
  })

  it('done 解析出 exitCode', async () => {
    const cp = fakeChild()
    const { done } = runTurn({
      engine: 'codex', binPath: '/c', cwd: '/w', model: 'm', prompt: 'p',
      baseEnv: {}, onEvent: () => {}, spawnFn: (() => cp) as any,
    })
    cp.emit('close', 7, null)
    await expect(done).resolves.toEqual({ exitCode: 7 })
  })

  it('进程 close 但全程无 turn_end（崩溃/SIGKILL）→ 合成 turn_end(failed)', async () => {
    const cp = fakeChild()
    const events: AgentEvent[] = []
    const { done } = runTurn({
      engine: 'codex', binPath: '/c', cwd: '/w', model: 'm', prompt: 'p',
      baseEnv: {}, onEvent: (e) => events.push(e), spawnFn: (() => cp) as any,
    })
    cp.stdout.emit('data', JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'partial' } }) + '\n')
    cp.emit('close', 1, null)
    await done
    expect(events.map((e) => e.type)).toEqual(['message', 'turn_end'])
    expect(events[events.length - 1]).toMatchObject({ type: 'turn_end', stopReason: 'failed' })
  })

  it('合成 failed 带 detail：stderr 尾部 + 非零退出码（让失败可诊断，不再静默吞掉）', async () => {
    const cp = fakeChild()
    const events: AgentEvent[] = []
    const { done } = runTurn({
      engine: 'codex', binPath: '/c', cwd: '/w', model: 'm', prompt: 'p',
      baseEnv: {}, onEvent: (e) => events.push(e), spawnFn: (() => cp) as any,
    })
    cp.stderr.emit('data', Buffer.from('Error: ANTHROPIC_API_KEY invalid\n'))
    cp.emit('close', 1, null)
    await done
    const end = events[events.length - 1] as any
    expect(end).toMatchObject({ type: 'turn_end', stopReason: 'failed' })
    expect(end.detail).toContain('exit 1')
    expect(end.detail).toContain('ANTHROPIC_API_KEY invalid')
  })

  it("spawn 'error'（坏 binPath ENOENT）→ 合成 failed，detail 含错误 message", async () => {
    const cp = fakeChild()
    const events: AgentEvent[] = []
    const { done } = runTurn({
      engine: 'codex', binPath: '/no/such/bin', cwd: '/w', model: 'm', prompt: 'p',
      baseEnv: {}, onEvent: (e) => events.push(e), spawnFn: (() => cp) as any,
    })
    cp.emit('error', new Error('spawn /no/such/bin ENOENT'))
    await done
    const end = events[events.length - 1] as any
    expect(end).toMatchObject({ type: 'turn_end', stopReason: 'failed' })
    expect(end.detail).toContain('ENOENT')
  })

  it('aborted（用户中止）不带 detail：中止是主动行为，无需诊断', async () => {
    vi.useFakeTimers()
    const cp = fakeChild()
    const events: AgentEvent[] = []
    const { interrupt, done } = runTurn({
      engine: 'codex', binPath: '/c', cwd: '/w', model: 'm', prompt: 'p',
      baseEnv: {}, onEvent: (e) => events.push(e), spawnFn: (() => cp) as any,
    })
    cp.stderr.emit('data', Buffer.from('some noise\n'))
    interrupt()
    cp.emit('close', null, 'SIGTERM')
    await done
    const end = events[events.length - 1] as any
    expect(end).toMatchObject({ type: 'turn_end', stopReason: 'aborted' })
    expect(end.detail).toBeUndefined()
    vi.useRealTimers()
  })

  it('流里已有真实 turn_end → close 不再合成（不重复终结）', async () => {
    const cp = fakeChild()
    const events: AgentEvent[] = []
    const { done } = runTurn({
      engine: 'codex', binPath: '/c', cwd: '/w', model: 'm', prompt: 'p',
      baseEnv: {}, onEvent: (e) => events.push(e), spawnFn: (() => cp) as any,
    })
    cp.stdout.emit('data', JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 2 } }) + '\n')
    cp.emit('close', 0, null)
    await done
    expect(events.map((e) => e.type)).toEqual(['usage', 'turn_end'])
    expect(events.filter((e) => e.type === 'turn_end')).toHaveLength(1)
  })

  it('interrupt：先 SIGTERM；宽限内未退 → SIGKILL；置 aborted → 合成 turn_end(aborted)', async () => {
    vi.useFakeTimers()
    const cp = fakeChild()
    const events: AgentEvent[] = []
    const { interrupt, done } = runTurn({
      engine: 'claude', binPath: '/c', cwd: '/w', model: 'opus', prompt: 'hi',
      baseEnv: {}, onEvent: (e) => events.push(e), spawnFn: (() => cp) as any,
    })
    interrupt(5000)
    expect(cp.killSignals).toEqual(['SIGTERM'])
    vi.advanceTimersByTime(5000)
    expect(cp.killSignals).toEqual(['SIGTERM', 'SIGKILL'])
    cp.emit('close', null, 'SIGKILL')
    await done
    expect(events[events.length - 1]).toMatchObject({ type: 'turn_end', stopReason: 'aborted' })
    vi.useRealTimers()
  })

  it('interrupt：进程在宽限内自行退出 → 不再 SIGKILL', async () => {
    vi.useFakeTimers()
    const cp = fakeChild()
    const { interrupt, done } = runTurn({
      engine: 'codex', binPath: '/c', cwd: '/w', model: 'm', prompt: 'p',
      baseEnv: {}, onEvent: () => {}, spawnFn: (() => cp) as any,
    })
    interrupt(5000)
    cp.emit('close', 0, 'SIGTERM')
    await done
    vi.advanceTimersByTime(5000)
    expect(cp.killSignals).toEqual(['SIGTERM'])
    vi.useRealTimers()
  })

  it('interrupt 后流里已有真实 turn_end → 不合成、保留真实 stopReason（aborted 不强造终结）', async () => {
    const cp = fakeChild()
    const events: AgentEvent[] = []
    const { interrupt, done } = runTurn({
      engine: 'codex', binPath: '/c', cwd: '/w', model: 'm', prompt: 'p',
      baseEnv: {}, onEvent: (e) => events.push(e), spawnFn: (() => cp) as any,
    })
    // 真实 turn_end 已到达，随后才中断
    cp.stdout.emit('data', JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 2 } }) + '\n')
    interrupt(5000)
    cp.emit('close', 0, null)
    await done
    // 仅一个 turn_end，且是真实的 'completed'，不是合成的 'aborted'
    expect(events.filter((e) => e.type === 'turn_end')).toHaveLength(1)
    expect(events[events.length - 1]).toMatchObject({ type: 'turn_end', stopReason: 'completed' })
  })

  it("spawn 'error'（坏 binPath，无 close）→ 合成 turn_end(failed) 且 done resolve（不挂起）", async () => {
    const cp = fakeChild()
    const events: AgentEvent[] = []
    const { done } = runTurn({
      engine: 'codex', binPath: '/nonexistent/codex', cwd: '/w', model: 'm', prompt: 'p',
      baseEnv: {}, onEvent: (e) => events.push(e), spawnFn: (() => cp) as any,
    })
    cp.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }))
    // 只发 error、不发 close
    await expect(done).resolves.toEqual({ exitCode: null })
    expect(events[events.length - 1]).toMatchObject({ type: 'turn_end', stopReason: 'failed' })
  })

  it("spawn 'error' 后又来 close → 不重复合成 turn_end", async () => {
    const cp = fakeChild()
    const events: AgentEvent[] = []
    const { done } = runTurn({
      engine: 'codex', binPath: '/bad', cwd: '/w', model: 'm', prompt: 'p',
      baseEnv: {}, onEvent: (e) => events.push(e), spawnFn: (() => cp) as any,
    })
    cp.emit('error', new Error('ENOENT'))
    cp.emit('close', null, null)   // 某些平台 error 后仍补一个 close
    await done
    expect(events.filter((e) => e.type === 'turn_end')).toHaveLength(1)
  })

  it('claude pushUser：turn_end 后续写第二条 user 到同进程 stdin，不关 stdin', () => {
    const cp = fakeChild()
    const events: AgentEvent[] = []
    const turnEnds: string[] = []
    const { pushUser } = runTurn({
      engine: 'claude', binPath: '/c', cwd: '/w', model: 'opus', prompt: 'q1',
      baseEnv: {}, onEvent: (e) => events.push(e), onTurnEnd: (r) => turnEnds.push(r),
      spawnFn: (() => cp) as any,
    })
    // 第一轮 result（claude 进程不退）
    cp.stdout.emit('data', JSON.stringify({ type: 'result', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }) + '\n')
    expect(turnEnds).toEqual(['end_turn'])
    const writesBefore = cp.stdinWrites.length
    pushUser('q2')
    expect(cp.stdinWrites.length).toBe(writesBefore + 1)
    expect(JSON.parse(cp.stdinWrites.at(-1)!.trim())).toMatchObject({ type: 'user' })
    expect(cp.stdinEnded).toBe(false)
    // 第二轮 result 也触发 onTurnEnd
    cp.stdout.emit('data', JSON.stringify({ type: 'result', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }) + '\n')
    expect(turnEnds).toEqual(['end_turn', 'end_turn'])
  })

  it('endInput：关 stdin', () => {
    const cp = fakeChild()
    const { endInput } = runTurn({
      engine: 'claude', binPath: '/c', cwd: '/w', model: 'opus', prompt: 'q1',
      baseEnv: {}, onEvent: () => {}, spawnFn: (() => cp) as any,
    })
    endInput()
    expect(cp.stdinEnded).toBe(true)
  })

  it('多轮：第一轮有 turn_end、最后一轮进程异常 close 无 turn_end → 仍合成终结', async () => {
    const cp = fakeChild()
    const events: AgentEvent[] = []
    const { pushUser, done } = runTurn({
      engine: 'claude', binPath: '/c', cwd: '/w', model: 'opus', prompt: 'q1',
      baseEnv: {}, onEvent: (e) => events.push(e), spawnFn: (() => cp) as any,
    })
    cp.stdout.emit('data', JSON.stringify({ type: 'result', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }) + '\n')
    pushUser('q2')                       // 进入第二轮，sawTurnEnd 应被重置
    cp.emit('close', 1, null)            // 第二轮没产出 turn_end 就崩
    await done
    expect(events.filter((e) => e.type === 'turn_end')).toHaveLength(2)  // 真实1 + 合成1
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', stopReason: 'failed' })
  })

  it('合成 turn_end（进程崩溃无 turn_end）也触发 onTurnEnd——下游状态落库依赖', () => {
    const cp = fakeChild()
    const turnEnds: string[] = []
    runTurn({
      engine: 'codex', binPath: '/c', cwd: '/w', model: 'm', prompt: 'p',
      baseEnv: {}, onEvent: () => {}, onTurnEnd: (r) => turnEnds.push(r), spawnFn: (() => cp) as any,
    })
    cp.emit('close', 1, null)   // 无真实 turn_end → 合成 failed
    expect(turnEnds).toEqual(['failed'])
  })

  it('中断后合成 turn_end(aborted) 也触发 onTurnEnd', () => {
    const cp = fakeChild()
    const turnEnds: string[] = []
    const { interrupt } = runTurn({
      engine: 'codex', binPath: '/c', cwd: '/w', model: 'm', prompt: 'p',
      baseEnv: {}, onEvent: () => {}, onTurnEnd: (r) => turnEnds.push(r), spawnFn: (() => cp) as any,
    })
    interrupt(5000)
    cp.emit('close', null, 'SIGTERM')   // 无真实 turn_end → 合成 aborted
    expect(turnEnds).toEqual(['aborted'])
  })

  it('onResumableId：嗅探到首个 session_id/thread_id 只回调一次', () => {
    const cp = fakeChild()
    const ids: string[] = []
    runTurn({
      engine: 'claude', binPath: '/c', cwd: '/w', model: 'opus', prompt: 'hi',
      baseEnv: {}, onEvent: () => {}, onResumableId: (id) => ids.push(id), spawnFn: (() => cp) as any,
    })
    cp.stdout.emit('data', JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-A' }) + '\n')
    cp.stdout.emit('data', JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'x' }] }, session_id: 'sess-A' }) + '\n')
    expect(ids).toEqual(['sess-A'])   // 同一 id 不重复回调
  })

  it('resumableId 透传给 buildArgs：codex argv 含 resume <id>，claude argv 含 --resume <id>', () => {
    // codex
    let codexArgs: string[] = []
    runTurn({
      engine: 'codex', binPath: '/c', cwd: '/w', model: 'gpt-5', prompt: 'p',
      resumableId: 'th-X', baseEnv: {}, onEvent: () => {},
      spawnFn: ((_b: string, args: string[]) => { codexArgs = args; return fakeChild() }) as any,
    })
    expect(codexArgs).toContain('resume')
    expect(codexArgs).toContain('th-X')

    // claude
    let claudeArgs: string[] = []
    runTurn({
      engine: 'claude', binPath: '/c', cwd: '/w', model: 'opus', prompt: 'p',
      resumableId: 'sess-X', baseEnv: {}, onEvent: () => {},
      spawnFn: ((_b: string, args: string[]) => { claudeArgs = args; return fakeChild() }) as any,
    })
    expect(claudeArgs).toContain('--resume')
    expect(claudeArgs).toContain('sess-X')
  })
})
