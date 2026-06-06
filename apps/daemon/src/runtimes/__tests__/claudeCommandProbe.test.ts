import { describe, it, expect } from 'vitest'
import { probeClaudeCommands } from '../claudeCommandProbe'

/** 假 probe query：按 script 顺序吐消息，supportedCommands 返回固定清单；记录被消费的消息（验证零成本=不越过 init）。
 *  supportedCommandsThrows：模拟 init 时拉命令抛错（best-effort 应吞掉返回 []）。 */
function makeFakeQueryFn(opts: { script: any[]; commands: any[]; supportedCommandsThrows?: boolean }) {
  const calls: { prompt: unknown; options: any }[] = []
  const consumed: any[] = []
  let supportedCommandsCalled = 0
  const queryFn = (args: { prompt: unknown; options: any }) => {
    calls.push({ prompt: args.prompt, options: args.options })
    let i = 0
    const q: any = {
      async next() {
        if (i >= opts.script.length) return { done: true, value: undefined }
        const v = opts.script[i++]
        consumed.push(v)
        return { done: false, value: v }
      },
      [Symbol.asyncIterator]() { return q },
      supportedCommands: async () => {
        supportedCommandsCalled++
        if (opts.supportedCommandsThrows) throw new Error('boom')
        return opts.commands
      },
    }
    return q
  }
  return { queryFn, calls, consumed, supportedCommandsCalled: () => supportedCommandsCalled }
}

const INIT = { type: 'system', subtype: 'init', session_id: 'sdk-x' }
const HOOK = { type: 'system', subtype: 'hook_started' }
const ASSISTANT = { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }
const RESULT = { type: 'result', subtype: 'success' }
const CMDS = [
  { name: 'plan', description: '进入计划模式', argumentHint: '' },
  { name: 'review', description: '审查改动', argumentHint: '' },
]

describe('probeClaudeCommands（零成本命令探针）', () => {
  it('收到 system/init → 调 supportedCommands() 抓清单并返回', async () => {
    const fake = makeFakeQueryFn({ script: [HOOK, INIT], commands: CMDS })
    const got = await probeClaudeCommands({ cwd: '/work', queryFn: fake.queryFn })
    expect(got).toEqual(CMDS)
    expect(fake.supportedCommandsCalled()).toBe(1)
  })

  it('零成本：init 后立即 break，绝不消费 assistant/result（不进 LLM 轮次）', async () => {
    const fake = makeFakeQueryFn({ script: [HOOK, INIT, ASSISTANT, RESULT], commands: CMDS })
    await probeClaudeCommands({ cwd: '/work', queryFn: fake.queryFn })
    // 消费应止于 init —— assistant/result 永不被读取
    expect(fake.consumed).toEqual([HOOK, INIT])
    expect(fake.consumed.some((m) => m.type === 'assistant' || m.type === 'result')).toBe(false)
  })

  it('init 到达即 abort（通过注入的 AbortController 观察 signal.aborted）', async () => {
    const fake = makeFakeQueryFn({ script: [INIT], commands: CMDS })
    const ac = new AbortController()
    await probeClaudeCommands({ cwd: '/work', queryFn: fake.queryFn, abortController: ac })
    expect(ac.signal.aborted).toBe(true)
  })

  it('空 prompt（探针不发任何用户内容）', async () => {
    const fake = makeFakeQueryFn({ script: [INIT], commands: CMDS })
    await probeClaudeCommands({ cwd: '/work', queryFn: fake.queryFn })
    expect(fake.calls[0].prompt).toBe('')
  })

  it('cwd / addDirs 透传到 options（cwd + additionalDirectories）', async () => {
    const fake = makeFakeQueryFn({ script: [INIT], commands: CMDS })
    await probeClaudeCommands({ cwd: '/work', addDirs: ['/ext/a', '/ext/b'], queryFn: fake.queryFn })
    expect(fake.calls[0].options.cwd).toBe('/work')
    expect(fake.calls[0].options.additionalDirectories).toEqual(['/ext/a', '/ext/b'])
  })

  it('supportedCommands 抛错 → best-effort 返回 []', async () => {
    const fake = makeFakeQueryFn({ script: [INIT], commands: CMDS, supportedCommandsThrows: true })
    const got = await probeClaudeCommands({ cwd: '/work', queryFn: fake.queryFn })
    expect(got).toEqual([])
  })

  it('queryFn 直接抛错 → best-effort 返回 []（探针失败不抛给调用方）', async () => {
    const queryFn = () => { throw new Error('spawn failed') }
    const got = await probeClaudeCommands({ cwd: '/work', queryFn: queryFn as any })
    expect(got).toEqual([])
  })

  it('流自然结束都没等到 init → 返回 []（不挂起）', async () => {
    const fake = makeFakeQueryFn({ script: [HOOK], commands: CMDS })
    const got = await probeClaudeCommands({ cwd: '/work', queryFn: fake.queryFn })
    expect(got).toEqual([])
  })
})
