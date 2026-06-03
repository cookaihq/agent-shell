import type { AgentEvent, Engine } from '@agent-shell/contracts'

/** 起一轮所需的可变参数（影响命令行）。cwd 不在此——由 spawn 的 cwd 选项绑定。 */
export interface BuildArgsOpts {
  model: string
  /** claude：默认/acceptEdits/plan/bypassPermissions 等，透传为 --permission-mode */
  permissionMode?: string
  /** codex：read-only/workspace-write/danger-full-access，透传为 -s */
  sandbox?: string
  /** 引擎侧 resume 指针（claude session_id / codex thread_id）。有则起进程时拼 resume 旗标。 */
  resumableId?: string
}

/** 该引擎的凭证环境变量名（env 净化用）。 */
export interface AuthStrategy {
  apiKeyEnv: string
  baseUrlEnv: string
}

/** BYOK / Provider 凭证（V1 不接 UI，但函数前向就绪）。 */
export interface ProviderCreds {
  baseUrl?: string
  apiKey?: string
}

/** 声明式引擎适配（MVP §2.2）。加引擎 = 加一个实现本接口的 def。 */
export interface RuntimeAgentDef {
  engine: Engine
  /** 二进制名（detection.ts 解析为绝对路径后传给调度器）。 */
  bin: 'claude' | 'codex'
  promptInputFormat: 'stream-json' | 'text'
  /** 写完 prompt 是否立即关 stdin。claude=false（常驻，留给 M4 回填）；codex=true（单次，EOF 触发执行）。 */
  closeStdinAfterPrompt: boolean
  /** turn 边界信号来源。claude='event'（result/turn_end）；codex='exit'（进程退出）。M6 消费。 */
  turnBoundary: 'event' | 'exit'
  authStrategy: AuthStrategy
  /** 拼命令行参数（不含 cwd）。 */
  buildArgs(opts: BuildArgsOpts): string[]
  /** 把 prompt 文本编码成要写入 stdin 的确切字节。 */
  formatPrompt(text: string): string
  /** M2 逐行入口：一行原始 JSONL → 0..n 个内部事件。 */
  parseLine(line: string): AgentEvent[]
  /** 从一行原始 JSONL 嗅探引擎侧 resume 指针（claude session_id / codex thread_id）。无则 undefined。 */
  extractResumableId(line: string): string | undefined
}
