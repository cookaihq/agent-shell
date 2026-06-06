import { describe, it, expect, vi } from 'vitest'
import type { AgentEvent } from '@agent-shell/contracts'
import { runClaudeSdkTurn, type ClaudeSdkTurnOpts } from '../claudeSdk'
import type { ImageInlineBlock } from '../../session/imageInline'

/** 可控假 query()：测试往里 emit SDKMessage、close 结束流；捕获 options（含 canUseTool）；记录控制方法调用。 */
function makePushableQuery() {
  let pushResolve: ((v: IteratorResult<any>) => void) | null = null
  const queue: any[] = []
  let ended = false
  let captured: any = null
  const calls = {
    interrupt: 0,
    setPermissionMode: [] as string[],
    setModel: [] as (string | undefined)[],
    applyFlagSettings: [] as any[],
    supportedModels: 0,
    rewindFiles: [] as any[],
  }

  const iterator = {
    next(): Promise<IteratorResult<any>> {
      if (queue.length > 0) return Promise.resolve({ done: false, value: queue.shift() })
      if (ended) return Promise.resolve({ done: true, value: undefined })
      return new Promise((res) => { pushResolve = res })
    },
    [Symbol.asyncIterator]() { return iterator },
  }

  const q: any = {
    ...iterator,
    interrupt: vi.fn(async () => { calls.interrupt++; ended = true; if (pushResolve) { pushResolve({ done: true, value: undefined }); pushResolve = null } }),
    setPermissionMode: vi.fn(async (m: string) => { calls.setPermissionMode.push(m) }),
    setModel: vi.fn(async (m?: string) => { calls.setModel.push(m) }),
    applyFlagSettings: vi.fn(async (s: any) => { calls.applyFlagSettings.push(s) }),
    supportedModels: vi.fn(async () => { calls.supportedModels++; return [{ value: 'opus', displayName: 'Opus', description: '' }] }),
    rewindFiles: vi.fn(async (id: string, o?: any) => { calls.rewindFiles.push({ id, o }); return { canRewind: true, filesChanged: ['a.ts'] } }),
  }

  const queryFn = (args: any) => { captured = args; return q }

  return {
    queryFn,
    calls,
    getOptions: () => captured?.options,
    getPromptIterable: () => captured?.prompt,
    emit(msg: any) {
      if (pushResolve) { const r = pushResolve; pushResolve = null; r({ done: false, value: msg }) }
      else queue.push(msg)
    },
    close() { ended = true; if (pushResolve) { const r = pushResolve; pushResolve = null; r({ done: true, value: undefined }) } },
  }
}

/** 收集 onEvent 发出的事件，并提供基础 opts。 */
function harness(extra: Partial<ClaudeSdkTurnOpts> = {}) {
  const events: AgentEvent[] = []
  const turnEnds: string[] = []
  const resumables: string[] = []
  const fake = makePushableQuery()
  let idSeq = 0
  const opts: ClaudeSdkTurnOpts = {
    cwd: '/proj', model: 'opus', prompt: 'hi',
    onEvent: (e) => events.push(e),
    onTurnEnd: (s) => turnEnds.push(s),
    onResumableId: (id) => resumables.push(id),
    queryFn: fake.queryFn as any,
    genId: () => `req${++idSeq}`,
    ...extra,
  }
  const handle = runClaudeSdkTurn(opts)
  return { handle, fake, events, turnEnds, resumables }
}

describe('runClaudeSdkTurn — 消费 query() 流并映射', () => {
  it('正文逐字流式（text_delta）→ message；assistant 的 text 去重过滤；result → usage + turn_end', async () => {
    const h = harness()
    // 真实序列：text 走 stream_event 流式，最终 assistant 的 text 被去重过滤
    h.fake.emit({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } })
    h.fake.emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } } })
    h.fake.emit({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } })
    h.fake.emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } })
    h.fake.emit({ type: 'result', subtype: 'success', is_error: false, stop_reason: 'end_turn', total_cost_usd: 0.2, usage: { input_tokens: 5, output_tokens: 2 } })
    h.fake.close()
    await h.handle.done
    // 含若干 message（流式帧 + 定格）+ usage + turn_end；最终 assistant 的 text 不重复
    const finalMsgs = h.events.filter((e) => e.type === 'message')
    expect(finalMsgs.length).toBeGreaterThan(0)
    expect((finalMsgs.at(-1) as any).text).toBe('hello')
    expect(h.events.some((e) => e.type === 'usage')).toBe(true)
    expect(h.turnEnds).toEqual(['end_turn'])
  })

  it('idle 看门狗：超 idleTimeoutMs 无消息 → 合成 turn_end(failed) + 中断 query', async () => {
    const h = harness({ idleTimeoutMs: 40 })
    // 不 emit 任何消息 → 看门狗在 40ms 后触发
    await new Promise((r) => setTimeout(r, 120))
    expect(h.turnEnds).toContain('failed')
    expect(h.events.some((e) => e.type === 'turn_end' && (e as any).stopReason === 'failed' && /idle/.test((e as any).detail ?? ''))).toBe(true)
    expect(h.fake.calls.interrupt).toBe(1)
    await h.handle.done
  })

  it('system.init → onResumableId(session_id)', async () => {
    const h = harness()
    h.fake.emit({ type: 'system', subtype: 'init', session_id: 'sess-123', model: 'opus', tools: [], permissionMode: 'default' })
    h.fake.close()
    await h.handle.done
    expect(h.resumables).toEqual(['sess-123'])
  })

  it('onRawMessage：只抄最终消息、跳过 stream_event 分片', async () => {
    const raws: any[] = []
    const h = harness({ onRawMessage: (m) => raws.push(m) })
    const asst = { type: 'assistant', message: { id: 'msg_1', content: [{ type: 'text', text: 'hi' }] }, uuid: 'u1' }
    h.fake.emit({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } })
    h.fake.emit(asst)
    h.fake.emit({ type: 'result', subtype: 'success', is_error: false, stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
    h.fake.close()
    await h.handle.done
    expect(raws.some((r) => r.type === 'stream_event')).toBe(false)   // 分片被跳过
    expect(raws).toContainEqual(asst)                                  // 最终 assistant 原样
    expect(raws.some((r) => r.type === 'result')).toBe(true)
  })
})

describe('runClaudeSdkTurn — 携带 base64 image 块组装 user content', () => {
  const imgBlock: ImageInlineBlock = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }

  /** 读 InputStream 里下一条 SDKUserMessage（fake query 不消费 prompt，队列原样留存）。 */
  async function nextUserContent(h: ReturnType<typeof harness>): Promise<any> {
    const it = (h.fake.getPromptIterable() as AsyncIterable<any>)[Symbol.asyncIterator]()
    const r = await it.next()
    return r.value.message.content
  }

  it('首轮带 images → content = [image 块, {type:text}]', async () => {
    const h = harness({ images: [imgBlock] })
    expect(await nextUserContent(h)).toEqual([imgBlock, { type: 'text', text: 'hi' }])
    h.fake.close()
    await h.handle.done
  })

  it('无 images → content 仍是 [{type:text}]（现状不变）', async () => {
    const h = harness()
    expect(await nextUserContent(h)).toEqual([{ type: 'text', text: 'hi' }])
    h.fake.close()
    await h.handle.done
  })

  it('纯图无文字（text=空）→ content 仍含 image 块（兜底补空 text）', async () => {
    const h = harness({ prompt: '', images: [imgBlock] })
    expect(await nextUserContent(h)).toEqual([imgBlock, { type: 'text', text: '' }])
    h.fake.close()
    await h.handle.done
  })

  it('续投 pushUser(text, images) → 下一条 content 带 image 块', async () => {
    const h = harness()
    await nextUserContent(h) // 消费首条（无图）
    h.handle.pushUser('next', [imgBlock])
    expect(await nextUserContent(h)).toEqual([imgBlock, { type: 'text', text: 'next' }])
    h.fake.close()
    await h.handle.done
  })
})

describe('runClaudeSdkTurn — canUseTool 交互回路', () => {
  const callTool = (h: ReturnType<typeof harness>, toolName: string, input: any, extra: any = {}) => {
    const ac = new AbortController()
    return h.fake.getOptions().canUseTool(toolName, input, { signal: ac.signal, toolUseID: 'tu1', ...extra })
  }

  it('canUseTool 触发 → 发 permission_request；resolveDecision(allow) 解决 Promise + 发 permission_resolved(allow)', async () => {
    const h = harness()
    const p = callTool(h, 'Write', { file_path: 'a.ts' }, { title: 'Claude wants to write a.ts', displayName: 'Write file' })
    const reqEv = h.events.find((e) => e.type === 'permission_request') as any
    expect(reqEv).toMatchObject({ type: 'permission_request', toolName: 'Write', requestId: 'req1', title: 'Claude wants to write a.ts', displayName: 'Write file' })
    expect(reqEv.input).toEqual({ file_path: 'a.ts' })

    h.handle.resolveDecision('req1', { behavior: 'allow', updatedInput: { file_path: 'b.ts' } })
    const result = await p
    expect(result).toEqual({ behavior: 'allow', updatedInput: { file_path: 'b.ts' } })
    expect(h.events.some((e) => e.type === 'permission_resolved' && (e as any).outcome === 'allow' && (e as any).requestId === 'req1')).toBe(true)
  })

  it('resolveDecision(allow) 未带 updatedInput → 回原始 input 作 updatedInput（SDK 要求 record，否则工具失败）', async () => {
    const h = harness()
    const p = callTool(h, 'Write', { file_path: 'a.ts', content: 'x' })
    h.handle.resolveDecision('req1', { behavior: 'allow' })
    const result = await p
    expect(result).toEqual({ behavior: 'allow', updatedInput: { file_path: 'a.ts', content: 'x' } })
  })

  it('resolveDecision(deny) → {behavior:deny, message} + permission_resolved(deny)', async () => {
    const h = harness()
    const p = callTool(h, 'Bash', { command: 'rm -rf /' })
    h.handle.resolveDecision('req1', { behavior: 'deny', message: '太危险' })
    const result = await p
    expect(result).toEqual({ behavior: 'deny', message: '太危险' })
    expect(h.events.some((e) => e.type === 'permission_resolved' && (e as any).outcome === 'deny')).toBe(true)
  })

  it('AskUserQuestion 工具 → 发 ask_user_question（非 permission_request）；回答合并进原 input（保留 questions，否则工具崩→死循环）', async () => {
    const h = harness()
    const questions = [{ question: '选哪个？', header: '方案', options: [{ label: 'A' }, { label: 'B' }] }]
    const p = callTool(h, 'AskUserQuestion', { questions })
    const askEv = h.events.find((e) => e.type === 'ask_user_question') as any
    expect(askEv).toMatchObject({ type: 'ask_user_question', requestId: 'req1' })
    expect(askEv.questions).toEqual(questions)
    expect(h.events.some((e) => e.type === 'permission_request')).toBe(false)

    // 回答为「问题文本→标签」map；daemon 合并进原 input，保留 questions
    h.handle.resolveDecision('req1', { behavior: 'allow', updatedInput: { answers: { '选哪个？': 'A' } } })
    const result = await p
    expect(result).toEqual({ behavior: 'allow', updatedInput: { questions, answers: { '选哪个？': 'A' } } })
  })

  it('挂起期间 interrupt → canUseTool Promise reject + 发 permission_resolved(cancelled)', async () => {
    const h = harness()
    const p = callTool(h, 'Write', { file_path: 'a.ts' })
    expect(h.events.some((e) => e.type === 'permission_request')).toBe(true)
    h.handle.interrupt()
    await expect(p).rejects.toThrow()
    expect(h.events.some((e) => e.type === 'permission_resolved' && (e as any).outcome === 'cancelled')).toBe(true)
  })

  it('挂起期间 query 流关闭（进程死）→ 挂起的 Promise 全 reject（防 600s stall）', async () => {
    const h = harness()
    const p = callTool(h, 'Write', { file_path: 'a.ts' })
    h.fake.close()
    await h.handle.done
    await expect(p).rejects.toThrow()
    expect(h.events.some((e) => e.type === 'permission_resolved' && (e as any).outcome === 'cancelled')).toBe(true)
  })

  it('未知 requestId 的 resolveDecision 静默忽略（过期回执不抛）', () => {
    const h = harness()
    expect(() => h.handle.resolveDecision('does-not-exist', { behavior: 'allow' })).not.toThrow()
  })
})

describe('runClaudeSdkTurn — 控制方法与传参', () => {
  it('options 据 opts 派生：permissionMode/effort/cwd/model/includePartialMessages', () => {
    const h = harness({ permissionMode: 'acceptEdits', effort: 'high' })
    const o = h.fake.getOptions()
    expect(o).toMatchObject({ cwd: '/proj', model: 'opus', permissionMode: 'acceptEdits', effort: 'high', includePartialMessages: true })
  })

  it('bypassPermissions → 同时设 allowDangerouslySkipPermissions', () => {
    const h = harness({ permissionMode: 'bypassPermissions' })
    expect(h.fake.getOptions()).toMatchObject({ permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true })
  })

  it('setPermissionMode/setModel 委托给 Query；setEffort 走 applyFlagSettings({effortLevel})', async () => {
    const h = harness()
    await h.handle.setPermissionMode('plan')
    await h.handle.setModel('sonnet')
    await h.handle.setEffort('xhigh')
    expect(h.fake.calls.setPermissionMode).toEqual(['plan'])
    expect(h.fake.calls.setModel).toEqual(['sonnet'])
    expect(h.fake.calls.applyFlagSettings).toEqual([{ effortLevel: 'xhigh' }])
  })

  it('宿主为每条 prompt 分配 uuid 作检查点；lastCheckpointId 取最近一条（pushUser 后更新）', async () => {
    let n = 0
    const h = harness({ genCheckpointId: () => `ckpt-${++n}` })
    expect(h.handle.lastCheckpointId()).toBe('ckpt-1')   // 初始 prompt 的检查点
    h.handle.pushUser('next')
    expect(h.handle.lastCheckpointId()).toBe('ckpt-2')   // pushUser → 新检查点
    h.fake.close()
    await h.handle.done
  })

  it('supportedModels/rewindFiles 委托给 Query', async () => {
    const h = harness()
    const models = await h.handle.supportedModels()
    expect(models[0]).toMatchObject({ value: 'opus' })
    const rw = await h.handle.rewindFiles('umsg-1', { dryRun: true })
    expect(rw).toMatchObject({ canRewind: true })
    expect(h.fake.calls.rewindFiles).toEqual([{ id: 'umsg-1', o: { dryRun: true } }])
  })

  it('enableFileCheckpointing / outputFormat / resume / addDirs 透传进 options', () => {
    const h = harness({ enableFileCheckpointing: true, outputFormat: { type: 'json_schema', schema: { type: 'object' } }, resumableId: 'sess-9', addDirs: ['/ext'] })
    expect(h.fake.getOptions()).toMatchObject({
      enableFileCheckpointing: true,
      outputFormat: { type: 'json_schema', schema: { type: 'object' } },
      resume: 'sess-9',
      additionalDirectories: ['/ext'],
    })
  })

  it('回合级 msg_id：最后一条 assistant.message.id/uuid 挂上 turn_end', async () => {
    const h = harness()
    h.fake.emit({ type: 'assistant', message: { id: 'msg_last', content: [{ type: 'text', text: 'x' }] }, uuid: 'uL' })
    h.fake.emit({ type: 'result', subtype: 'success', is_error: false, stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
    h.fake.close()
    await h.handle.done
    const te = h.events.find((e) => e.type === 'turn_end') as any
    expect(te.sdkMessageId).toBe('msg_last')
    expect(te.sdkUuid).toBe('uL')
  })
})
