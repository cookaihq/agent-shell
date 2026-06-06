import os from 'node:os'
import type { TestProviderRes } from '@agent-shell/contracts'
import type { ProviderCreds } from '../runtimes/types'
import { runClaudeSdkTurn, type ClaudeQueryFn } from '../runtimes/claudeSdk'

function maskKey(k?: string): string {
  if (!k) return '(空)'
  return k.length <= 4 ? '…' : 'sk-…' + k.slice(-4)
}

/** 用该 Provider 的 creds 真实跑一句 say hi（claude SDK）。queryFn 仅测试注入。 */
export async function testClaudeProvider(
  creds: ProviderCreds,
  opts?: { queryFn?: ClaudeQueryFn; cwd?: string; timeoutMs?: number; model?: string },
): Promise<TestProviderRes> {
  const modelToUse = (typeof opts?.model === 'string' && opts.model !== 'default') ? opts.model : 'haiku'
  const envVar = creds.keyEnv === 'auth_token' ? 'ANTHROPIC_AUTH_TOKEN' : 'ANTHROPIC_API_KEY'
  const requestText =
    `通过 Claude Code 引擎发起真实一轮（注入该 Provider 的 env）\n\n` +
    `ANTHROPIC_BASE_URL=${creds.baseUrl}\n${envVar}=${maskKey(creds.apiKey)}\nmodel=${modelToUse}\n\nprompt: say hi in exactly 3 words`

  // 默认 120s：foxapi 这类硬化中转只放行带 ~55k token system 的真 CC 流量，
  // 首次「冷缓存」建表实测约 75s（warm 后 ~10s）；给足余量容纳冷启，又给坏 key/挂死封顶。
  const timeoutMs = opts?.timeoutMs ?? 120000
  let text = ''
  let actualModel = ''
  return await new Promise<TestProviderRes>((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let handle: ReturnType<typeof runClaudeSdkTurn> | undefined
    const finish = (r: TestProviderRes) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(r)
    }
    // 墙钟硬兜底：上游挂死 / SDK 对坏 key 反复重试时，引擎自身可能不退出 → 这里强制收口，
    // 中断子进程并以失败返回，避免「测试」永远转圈（真机校准实测坏 key 会卡 120s+）。
    timer = setTimeout(() => {
      // 先 finish（让「超时」消息胜出），再 interrupt 收子进程——否则 interrupt 合成的 aborted turn_end
      // 会抢先 finish 成「（失败，stop=aborted）」，丢掉更有信息量的超时提示。
      finish({ ok: false, requestText, responseText: `测试超时（${Math.round(timeoutMs / 1000)}s 内上游无有效响应——key 可能无效、上游不可达或该模型未在上游启用）` })
      try { handle?.interrupt() } catch { /* 中断失败也要收口 */ }
    }, timeoutMs)
    try {
      handle = runClaudeSdkTurn({
        cwd: opts?.cwd ?? os.tmpdir(),
        model: modelToUse,
        prompt: 'say hi in exactly 3 words',
        permissionMode: 'bypassPermissions',
        creds,
        // 不用引擎 idle 看门狗：首次真机调用要建 ~55k token 的 system 缓存，首 token 可能 >25s 静默，
        // idle 会把「慢的有效调用」误判为挂死。改由下方单一墙钟超时兜底（够长容纳冷缓存、又能给坏 key 封顶）。
        queryFn: opts?.queryFn,
        // onRawMessage 拿到原始 SDK 消息（未经流式去重过滤）→ 从 assistant content 中直接提取文本。
        // createClaudeObjectParser 在流式路径下会过滤掉最终 assistant 消息里的 message 事件（认为已由 text_delta 发过），
        // 导致 onEvent('message') 在无流式分片的测试假 query 里收不到文本——故这里直接从原始消息取。
        onRawMessage: (msg: unknown) => {
          const o = msg as any
          if (o?.type === 'assistant' && Array.isArray(o.message?.content)) {
            // 原始最终消息含全部文本块（每块完整、非累计帧）→ 合并所有 text 块整条替换，避免多块丢块
            const joined = o.message.content
              .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
              .map((b: any) => b.text)
              .join('')
            if (joined) text = joined
            // 捕获上游实际使用的模型（assistant message 携带 model 字段）
            if (typeof o.message.model === 'string' && o.message.model) {
              actualModel = o.message.model
            }
          }
        },
        // claudeSdk 的 onTurnEnd 先于 onEvent(turn_end) 触发且只带 stopReason；上游错误真因在 turn_end.detail。
        // 故在 onEvent 收到 turn_end 时一并取 stopReason + detail 定结果。
        onEvent: (ev) => {
          if (ev.type === 'message') text = ev.text   // 流式路径：text 为累计全文 → 取最新
          else if (ev.type === 'turn_end') {
            const ok = ev.stopReason !== 'failed' && ev.stopReason !== 'aborted'
            const body = ok
              ? `（上游实际模型：${actualModel || '未知'}）\n` + (text || `（无文本，stop=${ev.stopReason}）`)
              : (ev.detail || text || `（失败，stop=${ev.stopReason}）`)
            finish({ ok, requestText, responseText: body })
          }
        },
      })
      handle.endInput()
      // done 始终 resolve（不 reject）；若从未发出 turn_end（异常中断）兜底为失败。
      handle.done
        .then(() => finish({ ok: false, requestText, responseText: text || '（无终结事件，连接可能中断）' }))
        .catch((e: unknown) => finish({ ok: false, requestText, responseText: '请求失败：' + String(e) }))
    } catch (e) {
      finish({ ok: false, requestText, responseText: '请求失败：' + String(e) })
    }
  })
}
