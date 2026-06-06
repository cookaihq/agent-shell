import { z } from 'zod'

export const Engine = z.enum(['claude', 'codex'])
export type Engine = z.infer<typeof Engine>

/** 建项目：只需显示名，存储路径由 daemon 用「父级目录 + 32位 uuid」算（系统设置改父级目录留 M7）。
 *  skills：建项目时选中的技能名列表，daemon 将对应技能软链进 <project>/.claude/skills（D6）。 */
export const CreateProjectReq = z.object({ name: z.string(), skills: z.array(z.string()).default([]) })
export type CreateProjectReq = z.infer<typeof CreateProjectReq>
export const CreateProjectRes = z.object({ projectId: z.string(), path: z.string() })

/** 对已存在项目注入技能（POST /projects/:id/inject-skills）：技能名列表，
 *  daemon 据 :id 查项目 path 后，把对应技能软链进 <project>/.claude/skills（仅 claude，复用 injectClaudeSkills，幂等）。 */
export const InjectSkillsReq = z.object({ skills: z.array(z.string()).default([]) })
export type InjectSkillsReq = z.infer<typeof InjectSkillsReq>

/** claude 原生权限档（5 档；SDK PermissionMode 子集，方案 A 1:1 映射）。 */
export const ClaudePermissionMode = z.enum(['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'])
export type ClaudePermissionMode = z.infer<typeof ClaudePermissionMode>

/** claude 思考强度（对齐 SDK EffortLevel，无 ultra、有 xhigh）。 */
export const ClaudeEffort = z.enum(['low', 'medium', 'high', 'xhigh', 'max'])
export type ClaudeEffort = z.infer<typeof ClaudeEffort>

/** 创建会话：挂 projectId；engine 挂会话（同项目可混 claude/codex）；cwd 由 project.path 推导，不在此传。
 *  permissionMode/effort 可选：新建会话时带上当前运行时档位（Issue 13 复用上次配置）。 */
export const CreateSessionReq = z.object({
  projectId: z.string(), engine: Engine, model: z.string(), title: z.string().optional(),
  permissionMode: ClaudePermissionMode.optional(),
  effort: ClaudeEffort.optional(),
})
export const CreateSessionRes = z.object({ sessionId: z.string() })

/** 结构化输出格式（json_schema）：透传给 SDK query.outputFormat；结果取 SDKResultMessage.structured_output。 */
export const OutputFormat = z.object({
  type: z.literal('json_schema'),
  schema: z.record(z.string(), z.unknown()),
})
export type OutputFormat = z.infer<typeof OutputFormat>

/** 发消息：文本 + 上下文文件路径 + 可选运行时档位（claude 权限/思考强度，随消息生效或运行中热切换）+ 可选结构化输出。 */
export const SubmitMessageReq = z.object({
  text: z.string(),
  contextFiles: z.array(z.string()).default([]),
  permissionMode: ClaudePermissionMode.optional(),
  effort: ClaudeEffort.optional(),
  // 模型（claude SDK 别名/变体，如 opus、opus[1m]）：随消息带 → 未运行下轮 query 生效，运行中 setModel 热切换。
  model: z.string().optional(),
  outputFormat: OutputFormat.optional(),
})

/** 逐工具授权 / AskUserQuestion 回执（renderer → /sessions/:id/decision）。 */
export const DecisionReq = z.object({
  requestId: z.string(),
  behavior: z.enum(['allow', 'deny']),
  message: z.string().optional(),                          // deny 理由
  updatedInput: z.record(z.string(), z.unknown()).optional(),  // allow 改写入参 / AskUserQuestion 回答回填
})
export type DecisionReq = z.infer<typeof DecisionReq>

/** 不发消息、仅热切换运行时档位（claude 权限/思考强度）。 */
export const RuntimeConfigReq = z.object({
  permissionMode: ClaudePermissionMode.optional(),
  effort: ClaudeEffort.optional(),
  // 模型热切换（claude SDK 别名/变体）：运行中 → setModel，两轮间 → 下轮 query 生效。
  model: z.string().optional(),
})
export type RuntimeConfigReq = z.infer<typeof RuntimeConfigReq>

/** 文件检查点回退（claude）。userMessageId 省略 → 回退到最近一次检查点。 */
export const RewindReq = z.object({
  userMessageId: z.string().optional(),
  dryRun: z.boolean().optional(),
})
export type RewindReq = z.infer<typeof RewindReq>

/** 恢复并继续：带一条新 user 文本，daemon 用 sessions.resumable_id 拼引擎 resume 旗标起新进程。 */
export const ResumeReq = z.object({ text: z.string() })

/** 统一错误契约（MVP §6）：daemon 所有 API 错误返回此形状。 */
export const ApiError = z.object({ error: z.object({ code: z.string(), message: z.string() }) })
export type ApiError = z.infer<typeof ApiError>

/** 项目派生状态（V1 无「等待确认」态，A1 决策）。 */
export const ProjectStatus = z.enum(['running', 'completed', 'failed', 'aborted', 'idle'])
export type ProjectStatus = z.infer<typeof ProjectStatus>

/** GET /projects 列表项：基础字段 + 派生 status/engine（聚合会话，含内存运行时态）。 */
export const ProjectListItem = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  createdAt: z.number(),
  status: ProjectStatus,
  engine: Engine,
})
export type ProjectListItem = z.infer<typeof ProjectListItem>

/** 应用配置（存于 ~/.agent-shell/config.json，系统设置可改）。 */
export const AppConfig = z.object({
  projectsDir: z.string(),
  skillsDir: z.string(),
  /** 调试模式开关（默认关，由消费侧 ?? false 兜底）。 */
  debugMode: z.boolean().optional(),
  /** 每引擎默认模型（key = Engine 值，value = 模型标识串）；新会话 + 连通测试使用。 */
  engineModels: z.record(Engine, z.string()).optional(),
})
export type AppConfig = z.infer<typeof AppConfig>

export const EngineDetail = z.object({
  name: Engine,                 // 'claude' | 'codex'
  label: z.string(),            // 'Claude Code' / 'Codex CLI'
  bin: z.string().nullable(),   // 路径，未检测到为 null
  version: z.string().nullable(),
})
export type EngineDetail = z.infer<typeof EngineDetail>

export const EngineTestRes = z.object({ ok: z.boolean(), version: z.string().nullable(), message: z.string().optional() })
export type EngineTestRes = z.infer<typeof EngineTestRes>

/** 引擎 CLI 的可更新信息（GET /engines/updates）：进执行模式页时异步查 npm 最新版。
 *  latestVersion 查询失败/网络错为 null（前端据此静默不显示徽标）；updateUrl 为对应官方 GitHub 页。
 *  「是否有新版」由前端比已装 version 与 latestVersion 得出，不在此判定。 */
export const EngineUpdateInfo = z.object({
  name: Engine,
  latestVersion: z.string().nullable(),
  updateUrl: z.string(),
})
export type EngineUpdateInfo = z.infer<typeof EngineUpdateInfo>

export const SkillSource = z.enum(['git', 'folder'])
export type SkillSource = z.infer<typeof SkillSource>
export const Skill = z.object({
  name: z.string(),
  source: SkillSource,
  origin: z.string(),   // git: 远程 url；folder: 空串
  desc: z.string(),
})
export type Skill = z.infer<typeof Skill>

// ===== 技能源模型（2026-06-05-skill-source-model-design）=====
export const GitProvider = z.enum(['github', 'gitee', 'cnb', 'gitlab', 'other'])
export type GitProvider = z.infer<typeof GitProvider>
export const SourceType = z.enum(['folder', 'git', 'market'])
export type SourceType = z.infer<typeof SourceType>
export const UpdateMode = z.enum(['manual', 'auto', 'autolib'])
export type UpdateMode = z.infer<typeof UpdateMode>

/** 注册的技能源（存于 skill-sources.json，0600）。user/token 仅 git 私有库；token 明文存 0600 文件。 */
export const SkillSourceDef = z.object({
  id: z.string(),
  type: SourceType,
  name: z.string(),
  loc: z.string(),                    // folder: 绝对路径；git: 归一化仓库地址（无协议前缀）
  provider: GitProvider.optional(),
  branch: z.string().optional(),
  private: z.boolean().optional(),
  user: z.string().optional(),
  token: z.string().optional(),
  updateMode: UpdateMode.default('manual'),
  sortIndex: z.number().default(0),
})
export type SkillSourceDef = z.infer<typeof SkillSourceDef>

/** 添加源请求：daemon 生成 id/sortIndex。 */
export const AddSourceReq = SkillSourceDef.omit({ id: true, sortIndex: true })
export type AddSourceReq = z.infer<typeof AddSourceReq>

/** 编辑源：可改字段（不含 id/type）。 */
export const PatchSourceReq = SkillSourceDef.partial().omit({ id: true, type: true })
export type PatchSourceReq = z.infer<typeof PatchSourceReq>

/** 重排源：按 id 顺序。 */
export const ReorderSourcesReq = z.object({ order: z.array(z.string()) })
export type ReorderSourcesReq = z.infer<typeof ReorderSourcesReq>

/** 探测到的技能（probe 结果项，含派生态）。 */
export const ProbedSkill = z.object({
  sourceId: z.string(),
  name: z.string(),                  // SKILL.md frontmatter name（缺则目录名兜底）
  relPath: z.string(),               // 源内相对路径（含 SKILL.md 的目录，末尾带 /）
  desc: z.string(),
  inLib: z.boolean(),                // 是否已入库（materialized in skillsDir）
  effectiveName: z.string().optional(), // 入库后的库内名（重名消歧后；未入库为空）
  globalIn: z.array(Engine).default([]), // 全局引擎同名覆盖预警
})
export type ProbedSkill = z.infer<typeof ProbedSkill>

/** 入库/移出某技能。 */
export const ToggleLibReq = z.object({ sourceId: z.string(), relPath: z.string(), inLib: z.boolean() })
export type ToggleLibReq = z.infer<typeof ToggleLibReq>

/** 库内技能（GET /skill-library 项 + 首页注入列表项）。 */
export const LibrarySkill = z.object({
  effectiveName: z.string(),         // 库内目录名 = 注入用名
  name: z.string(),                  // 原始 SKILL.md name
  desc: z.string(),
  sourceId: z.string(),
  sourceName: z.string(),
  globalIn: z.array(Engine).default([]),
})
export type LibrarySkill = z.infer<typeof LibrarySkill>

// ── 命令行工具市场（Issue 13 · 借鉴 CodePilot）──
/** 一个 CLI 工具的定义。推荐项内置在 renderer JSON；加入后由 daemon 持久化（含自定义）。 */
export const CliToolDef = z.object({
  id: z.string(),
  name: z.string(),
  cmd: z.string(),                                          // which 检测用的可执行名
  tags: z.array(z.string()).default([]),
  desc: z.string().default(''),
  install: z.string().optional(),                          // 安装命令（如 brew install yt-dlp）
  home: z.string().optional(),                             // 官网 / 文档
  usage: z.string().default(''),                          // 注入给 agent 的用法（→ 生成 SKILL.md）
  friendliness: z.number().int().min(0).max(5).default(0), // Agent 友好度（策展元数据）
  custom: z.boolean().default(false),                     // 是否用户自定义
})
export type CliToolDef = z.infer<typeof CliToolDef>

/** 持久化结构（~/.agent-shell/cli-tools.json）：已加入工具（推荐 + 自定义）全量存 def。 */
export const CliToolsState = z.object({ added: z.array(CliToolDef).default([]) })
export type CliToolsState = z.infer<typeof CliToolsState>

/** 加入工具：传完整 def（推荐项来自 renderer 内置 JSON，自定义来自表单）；id 可省，daemon 兜底生成。 */
export const AddCliToolReq = CliToolDef.omit({ id: true }).extend({ id: z.string().optional() })
export type AddCliToolReq = z.infer<typeof AddCliToolReq>

/** 检测一批命令是否安装（复用 detectBinary）。 */
export const CliDetectReq = z.object({ names: z.array(z.string()).default([]) })
export type CliDetectReq = z.infer<typeof CliDetectReq>

// ── CLI Provider 切换（设计见 specs/2026-06-05-cli-provider-switch-design.md）──
export const ProviderKeyEnv = z.enum(['api_key', 'auth_token'])
export type ProviderKeyEnv = z.infer<typeof ProviderKeyEnv>

// 渲染层可见的 Provider 视图：永不含完整 apiKey，只回掩码 + hasKey
export const ProviderView = z.object({
  id: z.string(),
  engine: Engine,
  name: z.string(),
  baseUrl: z.string(),
  keyEnv: ProviderKeyEnv,
  hasKey: z.boolean(),
  maskedKey: z.string(),       // 如 'sk-…1a2b' 或 ''
  sortIndex: z.number(),
  createdAt: z.number(),
})
export type ProviderView = z.infer<typeof ProviderView>

export const EngineProviders = z.object({
  active: z.string(),           // 'default' 或某 provider id
  providers: z.array(ProviderView),
})
export type EngineProviders = z.infer<typeof EngineProviders>
// 显式两引擎键（非 z.record(Engine,...)）：store 永远同时产出 claude+codex，用显式键让
// engines.claude/codex 类型上恒存在，避免 zod record 推断成 Partial 致下游 .active 访问 tsc 报错。
export const ProvidersResp = z.object({
  engines: z.object({ claude: EngineProviders, codex: EngineProviders }),
})
export type ProvidersResp = z.infer<typeof ProvidersResp>

export const CreateProviderReq = z.object({
  engine: Engine,
  name: z.string().min(1),
  baseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  keyEnv: ProviderKeyEnv.default('api_key'),
})
export type CreateProviderReq = z.infer<typeof CreateProviderReq>

// 编辑：apiKey 省略 / 空串 = 不改原 key
export const UpdateProviderReq = z.object({
  name: z.string().min(1).optional(),
  baseUrl: z.string().min(1).optional(),
  apiKey: z.string().optional(),
  keyEnv: ProviderKeyEnv.optional(),
})
export type UpdateProviderReq = z.infer<typeof UpdateProviderReq>

export const SetActiveProviderReq = z.object({ engine: Engine, providerId: z.string() })
export type SetActiveProviderReq = z.infer<typeof SetActiveProviderReq>

export const TestProviderRes = z.object({
  ok: z.boolean(),
  status: z.number().optional(),
  requestText: z.string(),
  responseText: z.string(),
})
export type TestProviderRes = z.infer<typeof TestProviderRes>

// ── 定时自动化（spec 2026-06-05-scheduled-automation-design）─────────────────
/** 调度四档（对齐 open-design）：weekday 0=周日…6=周六；hourly 用 UTC 第 M 分，其余走时区 wall-clock。 */
export const AutomationSchedule = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('hourly'), minute: z.number().int().min(0).max(59) }),
  z.object({ kind: z.literal('daily'), time: z.string().regex(/^\d{2}:\d{2}$/), timezone: z.string().min(1) }),
  z.object({ kind: z.literal('weekdays'), time: z.string().regex(/^\d{2}:\d{2}$/), timezone: z.string().min(1) }),
  z.object({ kind: z.literal('weekly'), time: z.string().regex(/^\d{2}:\d{2}$/), timezone: z.string().min(1), weekday: z.number().int().min(0).max(6) }),
])
export type AutomationSchedule = z.infer<typeof AutomationSchedule>

/** 目标项目：每次新建会话（在新项目下）/ 复用某已有项目。 */
export const AutomationTarget = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('create_each_run') }),
  z.object({ mode: z.literal('reuse'), projectId: z.string().min(1) }),
])
export type AutomationTarget = z.infer<typeof AutomationTarget>

export const AutomationRunStatus = z.enum(['queued', 'running', 'succeeded', 'failed', 'needs-review', 'canceled'])
export type AutomationRunStatus = z.infer<typeof AutomationRunStatus>

export const AutomationTrigger = z.enum(['scheduled', 'manual'])
export type AutomationTrigger = z.infer<typeof AutomationTrigger>

/** 新建自动化：permission 是引擎相关字符串（claude=ClaudePermissionMode / codex=沙箱档），daemon 按 engine 二次校验。 */
export const CreateAutomationReq = z.object({
  name: z.string().min(1),
  prompt: z.string().min(1),
  engine: Engine,
  model: z.string().min(1),
  permission: z.string().min(1),
  categories: z.array(z.string()).default([]),
  schedule: AutomationSchedule,
  target: AutomationTarget,
  enabled: z.boolean().default(true),
})
export type CreateAutomationReq = z.infer<typeof CreateAutomationReq>

/** 编辑：全可选；改 enabled / schedule → 调度器重排该条。 */
export const PatchAutomationReq = CreateAutomationReq.partial()
export type PatchAutomationReq = z.infer<typeof PatchAutomationReq>

/** 运行历史项（lastRun 摘要：列表卡「上次」状态用）。 */
export const AutomationLastRun = z.object({ status: AutomationRunStatus, completedAt: z.number().nullable() })
export type AutomationLastRun = z.infer<typeof AutomationLastRun>

export const AutomationDTO = z.object({
  id: z.string(),
  name: z.string(),
  prompt: z.string(),
  engine: Engine,
  model: z.string(),
  permission: z.string(),
  categories: z.array(z.string()),
  schedule: AutomationSchedule,
  target: AutomationTarget,
  enabled: z.boolean(),
  nextRunAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastRun: AutomationLastRun.nullable(),
})
export type AutomationDTO = z.infer<typeof AutomationDTO>

export const AutomationRunDTO = z.object({
  id: z.string(),
  automationId: z.string(),
  trigger: AutomationTrigger,
  status: AutomationRunStatus,
  projectId: z.string(),
  sessionId: z.string().nullable(),
  startedAt: z.number(),
  completedAt: z.number().nullable(),
  summary: z.string().nullable(),
  error: z.string().nullable(),
})
export type AutomationRunDTO = z.infer<typeof AutomationRunDTO>

/** 会话来源（§5.3 派生）：被某 automation_runs.sessionId 引用 → 'automation'，否则 'manual'。不在 sessions 表另存列。 */
export const SessionOrigin = z.enum(['manual', 'automation'])
export type SessionOrigin = z.infer<typeof SessionOrigin>

/** 时区 IANA → 中文展示名（与原型 tz 下拉一致；未知回落原串）。 */
export const TIMEZONE_LABELS: Record<string, string> = {
  'Asia/Shanghai': '上海',
  UTC: 'UTC',
  'America/New_York': '纽约',
  'Asia/Tokyo': '东京',
}
const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六']

/** 调度摘要文案（rail 卡 ameta / 会话历史自动化项副行 / 通知 都用）。 */
export function scheduleSummary(s: AutomationSchedule): string {
  if (s.kind === 'hourly') return `每小时 · 第 ${String(s.minute).padStart(2, '0')} 分`
  const tz = TIMEZONE_LABELS[s.timezone] ?? s.timezone
  if (s.kind === 'daily') return `每天 ${s.time} · ${tz}`
  if (s.kind === 'weekdays') return `工作日 ${s.time} · ${tz}`
  return `每周${WEEKDAY_ZH[s.weekday]} ${s.time} · ${tz}`
}
