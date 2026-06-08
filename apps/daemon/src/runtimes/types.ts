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
  /** 需授权读取的项目外目录集（消息附件引用项目外路径时）：claude → --add-dir 逐个；codex → 放行读取旗标。 */
  addDirs?: string[]
}

/** 该引擎的凭证环境变量名（env 净化用）。 */
export interface AuthStrategy {
  apiKeyEnv: string
  baseUrlEnv: string
  /** 备用凭证变量（claude=ANTHROPIC_AUTH_TOKEN）。存在则默认一并剥除，并可作为 keyEnv 注入目标。 */
  altKeyEnv?: string
}

/** Provider 直连凭证（claude 走 env-only：baseUrl→baseUrlEnv、apiKey→apiKeyEnv/altKeyEnv）。 */
export interface ProviderCreds {
  baseUrl?: string
  apiKey?: string
  /** key 注入到哪个变量：api_key→apiKeyEnv，auth_token→altKeyEnv。省略=api_key。 */
  keyEnv?: 'api_key' | 'auth_token'
  /** codex 专属扩展：codex 的 Provider 注入比 claude 更富（需 provider 名 + wire_api），走 app-server `-c` 启动覆盖而非纯 env。
   *  存在时 codexAppServer 据此拼 `-c model_provider=<name> -c model_providers.<name>.{base_url,wire_api,env_key}`，
   *  key 仍经 env（apiKeyEnv=OPENAI_API_KEY）注入。claude 路径忽略本字段（env-only 不变）。
   *  ⚠️ 用了 codex 扩展时，baseUrl 由 `-c` 承载、**不再**写 OPENAI_BASE_URL（见 env.ts），避免双重配置冲突。 */
  codex?: CodexProviderInject
}

/** codex 自定义 Provider 的 `-c` 注入所需字段（provider 名 + 上游协议）。 */
export interface CodexProviderInject {
  /** model_provider 名（= config.toml [model_providers.<name>]）。 */
  providerName: string
  /** 上游 base_url（拼进 `-c model_providers.<name>.base_url`）。 */
  baseUrl: string
  /** 上游协议：responses | chat（拼进 `-c model_providers.<name>.wire_api`）。 */
  wireApi: 'chat' | 'responses'
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
  /** M2 逐行入口：一行原始 JSONL → 0..n 个内部事件。无状态，逐行独立。 */
  parseLine(line: string): AgentEvent[]
  /** （可选）建一个持有 per-run 状态的逐行解析器——用于需跨行累计的引擎（如 claude 流式 progress：边收 delta 边估算 token + 算当前动作）。
   *  提供时，调度器每个 turn 起一个实例并优先用它替代无状态 parseLine；不提供（如 codex）则仍走 parseLine。
   *  不改 parseLine 的通用签名，保持调度器引擎无关（按 def 多态，不硬编码引擎名）。 */
  createParser?(): (line: string) => AgentEvent[]
  /** 从一行原始 JSONL 嗅探引擎侧 resume 指针（claude session_id / codex thread_id）。无则 undefined。 */
  extractResumableId(line: string): string | undefined
}
