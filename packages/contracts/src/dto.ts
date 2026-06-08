import { z } from 'zod'

export const Engine = z.enum(['claude', 'codex'])
export type Engine = z.infer<typeof Engine>

/** 建项目：只需显示名，存储路径由 daemon 用「父级目录 + 32位 uuid」算（系统设置改父级目录留 M7）。
 *  skills：建项目时选中的技能名列表，daemon 将对应技能软链进 <project>/.claude/skills（D6）。 */
// skills 用 .optional()（非 .default([])）：建项目时「省略 skills」(undefined) 与「显式空数组 []」语义不同——
// undefined=注入 autoInject 默认集，[]=显式不注入（见 autoInject.test.ts / injectClaudeSkills）。默认化会抹掉这个区分。
export const CreateProjectReq = z.object({ name: z.string(), skills: z.array(z.string()).optional() })
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

/** codex 沙箱档（两轴权限之一·文件写入范围；对齐 codex app-server sandbox_mode）。 */
export const CodexSandbox = z.enum(['read-only', 'workspace-write', 'danger-full-access'])
export type CodexSandbox = z.infer<typeof CodexSandbox>
/** codex 审批策略（两轴权限之一·何时弹授权；对齐 codex app-server approval_policy）。 */
export const CodexApproval = z.enum(['untrusted', 'on-request', 'never'])
export type CodexApproval = z.infer<typeof CodexApproval>
/** codex 思考强度（含 minimal、xhigh，无 max；对齐 codex reasoning effort）。 */
export const CodexEffort = z.enum(['minimal', 'low', 'medium', 'high', 'xhigh'])
export type CodexEffort = z.infer<typeof CodexEffort>

/** 创建会话：挂 projectId；engine 挂会话（同项目可混 claude/codex）；cwd 由 project.path 推导，不在此传。
 *  permissionMode/effort 可选：新建会话时带上当前运行时档位（Issue 13 复用上次配置）。 */
export const CreateSessionReq = z.object({
  projectId: z.string(), engine: Engine, model: z.string(), title: z.string().optional(),
  permissionMode: ClaudePermissionMode.optional(),
  effort: ClaudeEffort.optional(),
  // codex 两轴权限（claude 侧不传；daemon 按 engine 取用）
  sandbox: CodexSandbox.optional(),
  approval: CodexApproval.optional(),
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
  // codex 两轴权限（随消息生效或运行中热切换）
  sandbox: CodexSandbox.optional(),
  approval: CodexApproval.optional(),
  // 模型（claude SDK 别名/变体，如 opus、opus[1m]）：随消息带 → 未运行下轮 query 生效，运行中 setModel 热切换。
  model: z.string().optional(),
  outputFormat: OutputFormat.optional(),
  // 当前预览的活动文件（项目相对路径）；null/缺省=不注入。必须 nullish（禁 .default(null)，否则破 dto.test.ts 的 toEqual）。
  activeFile: z.string().nullish(),
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
  // codex 两轴权限热切换
  sandbox: CodexSandbox.optional(),
  approval: CodexApproval.optional(),
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

/** 修改会话属性（PATCH /sessions/:id）：pinned/title 同旧行为；engine 仅限空会话（未发送过消息）可改（Part B T2）；
 *  model 随 engine 一起传，变身时重置会话引擎专属档案（Part B T5a）。
 *  refine 强制「带 engine 必带 model」：变身要重置引擎专属档案，缺 model 会留下跨引擎脏态
 *  （engine=新引擎 + model=旧引擎模型），故在契约层就挡下，让这种非法组合不可表达（Part B T5a）。 */
export const PatchSessionReq = z.object({
  pinned: z.boolean().optional(),
  title: z.string().optional(),
  engine: Engine.optional(),
  /** 变身时随 engine 传新引擎的 model，用于重置会话引擎专属档案（Part B T5a） */
  model: z.string().optional(),
}).refine((d) => d.engine === undefined || d.model !== undefined, { message: '变身必须带 model（引擎专属档案需重置）' })
export type PatchSessionReq = z.infer<typeof PatchSessionReq>

/** 修改项目属性（PATCH /projects/:id）：selectedAgent 为项目级「下个新会话用哪个引擎」持久化选中值（Part B T3）。
 *  注意：selectedAgent 是用户在项目中主动选择的持久化值（null=未选过），与派生展示值 engine（聚合会话态）是两回事。 */
export const PatchProjectReq = z.object({ selectedAgent: Engine.optional() })
export type PatchProjectReq = z.infer<typeof PatchProjectReq>

/** 统一错误契约（MVP §6）：daemon 所有 API 错误返回此形状。 */
export const ApiError = z.object({ error: z.object({ code: z.string(), message: z.string() }) })
export type ApiError = z.infer<typeof ApiError>

/** 项目派生状态（V1 无「等待确认」态，A1 决策）。 */
export const ProjectStatus = z.enum(['running', 'completed', 'failed', 'aborted', 'idle'])
export type ProjectStatus = z.infer<typeof ProjectStatus>

/** GET /projects 列表项：基础字段 + 派生 status/engine（聚合会话，含内存运行时态）。
 *  selectedAgent：项目级「下个新会话用哪个引擎」持久化选中值（Part B T3），null=用户未选过；
 *  与派生展示值 engine（聚合当前会话状态）是两回事，两者语义不同。 */
export const ProjectListItem = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  createdAt: z.number(),
  status: ProjectStatus,
  engine: Engine,
  selectedAgent: Engine.nullable(),
})
export type ProjectListItem = z.infer<typeof ProjectListItem>

/** 应用配置（存于 ~/.agent-shell/config.json，系统设置可改）。 */
export const AppConfig = z.object({
  projectsDir: z.string(),
  skillsDir: z.string(),
  automationsDir: z.string(),
  /** 调试模式开关（默认关，由消费侧 ?? false 兜底）。 */
  debugMode: z.boolean().optional(),
  /** 每引擎默认模型（key = Engine 值，value = 模型标识串）；新会话 + 连通测试使用。 */
  engineModels: z.record(Engine, z.string()).optional(),
  /** 模型别名：engine → modelValue → 用户别名（官方只读模型的别名层；自定义模型别名走 ProviderModel.label）。 */
  modelAliases: z.record(Engine, z.record(z.string(), z.string())).optional(),
  /** 首启播种守门标记（§11.4）：成功才置位，删除不复活、失败下次重试。 */
  seededRecommendedGroup: z.boolean().optional(),
  seededDefaultSecrets: z.boolean().optional(),
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
export const SourceType = z.enum(['folder', 'git', 'market', 'builtin'])
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
  groupId: z.string().optional(),          // 所属分组；旧数据无→迁移回填（迁移后恒有值）
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

// ===== 技能分组模型（2026-06-07-skill-source-to-group-refactor-design §12.B）=====
/** 技能分组（顶层容器，存于 skill-groups.json，0600）。成员通过 SkillSourceDef.groupId 归属。 */
export const SkillGroupDef = z.object({
  id: z.string(),
  name: z.string(),
  sortIndex: z.number().default(0),
})
export type SkillGroupDef = z.infer<typeof SkillGroupDef>

/** 新建分组：daemon 生成 id/sortIndex。 */
export const AddGroupReq = SkillGroupDef.omit({ id: true, sortIndex: true })
export type AddGroupReq = z.infer<typeof AddGroupReq>

/** 编辑分组：目前仅可改名。 */
export const PatchGroupReq = z.object({ name: z.string().min(1).optional() })
export type PatchGroupReq = z.infer<typeof PatchGroupReq>

/** 重排分组：按 id 顺序。 */
export const ReorderGroupsReq = z.object({ order: z.array(z.string()) })
export type ReorderGroupsReq = z.infer<typeof ReorderGroupsReq>

/** GET /skill-groups 响应。 */
export const GroupsResp = z.object({ groups: z.array(SkillGroupDef) })
export type GroupsResp = z.infer<typeof GroupsResp>

/** 探测到的技能（probe 结果项，含派生态）。 */
export const ProbedSkill = z.object({
  sourceId: z.string(),
  name: z.string(),                  // SKILL.md frontmatter name（缺则目录名兜底）
  relPath: z.string(),               // 源内相对路径（含 SKILL.md 的目录，末尾带 /）
  desc: z.string(),
  inLib: z.boolean(),                // 是否已入库（materialized in skillsDir）
  effectiveName: z.string().optional(), // 入库后的库内名（重名消歧后；未入库为空）
  globalIn: z.array(Engine).default([]), // 全局引擎同名覆盖预警
  needsConfig: z.boolean().default(false), // 静态扫描快信号：要不要配置（spec §8.2）
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
  needsConfig: z.boolean().default(false), // 静态扫描快信号：要不要配置（spec §8.2）
  autoInject: z.boolean().default(false),   // 默认注入开关（特性 A）
})
export type LibrarySkill = z.infer<typeof LibrarySkill>

// ── CLI 工具（CodePilot 化：检测即可见 + agent 装）──
export const CliToolPlatform = z.enum(['darwin', 'linux', 'win32'])
export type CliToolPlatform = z.infer<typeof CliToolPlatform>

export const CliToolMethod = z.enum(['brew', 'npm', 'pipx', 'pip', 'cargo', 'apt'])
export type CliToolMethod = z.infer<typeof CliToolMethod>

/** 一种安装方式（如 brew install x），platforms 标明该方式支持哪些系统。 */
export const CliToolInstallMethod = z.object({
  method: CliToolMethod,
  command: z.string(),
  platforms: z.array(CliToolPlatform).nonempty(),
})
export type CliToolInstallMethod = z.infer<typeof CliToolInstallMethod>

/** 一个 CLI 工具的目录定义（内置在 daemon catalog；含静态 zh 描述）。 */
export const CliToolDef = z.object({
  id: z.string(),
  name: z.string(),
  binNames: z.array(z.string()).nonempty(),          // which/where 检测用（如 ['ffmpeg','ffprobe']）
  summary: z.string().default(''),                    // 一句话（zh）
  categories: z.array(z.string()).default([]),
  installMethods: z.array(CliToolInstallMethod).default([]),
  detailIntro: z.string().default(''),               // zh 段落
  useCases: z.array(z.string()).default([]),          // zh
  guideSteps: z.array(z.string()).default([]),        // zh
  examplePrompts: z.array(z.object({ label: z.string(), prompt: z.string() })).default([]),
  friendliness: z.number().int().min(0).max(5).default(0),
  home: z.string().optional(),
  repoUrl: z.string().optional(),
  docsUrl: z.string().optional(),
  custom: z.boolean().default(false),
})
export type CliToolDef = z.infer<typeof CliToolDef>

/** 自定义工具 + 安装元数据（持久化于 ~/.agent-shell/cli-tools.json）。
 *  双重身份：既存「用户按路径登记的工具」，也存「目录工具被 as_cli_install 装后的安装账本」。 */
export const CustomCliTool = z.object({
  id: z.string(),
  name: z.string(),
  binName: z.string(),
  binPath: z.string(),
  version: z.string().nullable().default(null),
  installMethod: z.string().optional(),              // brew/npm/... 或 'unknown'
  installPackage: z.string().optional(),             // 供 update 推导
  description: z.string().optional(),                // agent 顺手写的用途（→ context/详情）
  createdAt: z.number(),
})
export type CustomCliTool = z.infer<typeof CustomCliTool>

/** 持久化结构（~/.agent-shell/cli-tools.json）。旧 {added} 读到即视为空 {custom:[]}（迁移）。 */
export const CliToolsState = z.object({ custom: z.array(CustomCliTool).default([]) })
export type CliToolsState = z.infer<typeof CliToolsState>

export const CliToolStatus = z.enum(['installed', 'not_installed'])
export type CliToolStatus = z.infer<typeof CliToolStatus>

/** 单个工具的本机检测结果。 */
export const CliToolRuntimeInfo = z.object({
  id: z.string(),
  status: CliToolStatus,
  version: z.string().nullable(),
  binPath: z.string().nullable(),
})
export type CliToolRuntimeInfo = z.infer<typeof CliToolRuntimeInfo>

/** GET /cli-tools/catalog 响应。 */
export const CatalogResp = z.object({ tools: z.array(CliToolDef) })
export type CatalogResp = z.infer<typeof CatalogResp>

/** GET /cli-tools/installed 响应。platform = daemon 的 process.platform（桌面应用必为三者之一）。 */
export const InstalledResp = z.object({
  detected: z.array(CliToolRuntimeInfo),
  custom: z.array(CustomCliTool),
  platform: CliToolPlatform,
})
export type InstalledResp = z.infer<typeof InstalledResp>

/** POST /cli-tools/custom 请求：按绝对路径登记已装自定义工具。 */
export const AddCustomCliToolReq = z.object({
  binPath: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
})
export type AddCustomCliToolReq = z.infer<typeof AddCustomCliToolReq>

// ── CLI Provider 切换（设计见 specs/2026-06-05-cli-provider-switch-design.md）──
export const ProviderKeyEnv = z.enum(['api_key', 'auth_token'])
export type ProviderKeyEnv = z.infer<typeof ProviderKeyEnv>

/** codex 上游协议：responses（OpenAI 原生）/ chat（OpenAI 兼容 chat completions）。 */
export const ProviderWireApi = z.enum(['chat', 'responses']).default('responses')
export type ProviderWireApi = z.infer<typeof ProviderWireApi>

/** 一个 Provider 支持的模型项（value=模型标识，label=展示名）。 */
export const ProviderModel = z.object({ value: z.string().min(1), label: z.string().min(1) })
export type ProviderModel = z.infer<typeof ProviderModel>

// 渲染层可见的 Provider 视图：永不含完整 apiKey，只回掩码 + hasKey
export const ProviderView = z.object({
  id: z.string(),
  engine: Engine,
  name: z.string(),
  baseUrl: z.string(),
  keyEnv: ProviderKeyEnv,
  /** 引用统一密钥库的密钥 id（可空 → 用裸 maskedKey/hasKey 兜旧值）。 */
  apiKeySecretId: z.string().optional(),
  hasKey: z.boolean(),
  maskedKey: z.string(),       // 如 'sk-…1a2b' 或 ''
  sortIndex: z.number(),
  createdAt: z.number(),
  /** 该 Provider 的模型；默认 Provider（id='default'）由前端回落引擎官方、此处为空。 */
  models: z.array(ProviderModel).default([]),
  /** 该 Provider 新建会话用的默认模型 value（可空 → 前端回落 models[0]）。 */
  defaultModel: z.string().optional(),
  /** codex 上游协议（claude 侧恒 'responses' 占位）。 */
  wireApi: ProviderWireApi,
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
  /** 裸 apiKey（兼容旧）；迁移期与 apiKeySecretId 二选一，均可省略。 */
  apiKey: z.string().min(1).optional(),
  /** 引用统一密钥库的密钥 id（新方式，替代裸 apiKey）。 */
  apiKeySecretId: z.string().optional(),
  keyEnv: ProviderKeyEnv.default('api_key'),
  models: z.array(ProviderModel).default([]),
  defaultModel: z.string().optional(),
  wireApi: ProviderWireApi,
})
export type CreateProviderReq = z.infer<typeof CreateProviderReq>

// 编辑：apiKey 省略 / 空串 = 不改原 key
export const UpdateProviderReq = z.object({
  name: z.string().min(1).optional(),
  baseUrl: z.string().min(1).optional(),
  apiKey: z.string().optional(),
  /** 引用统一密钥库的密钥 id（省略=不改）。 */
  apiKeySecretId: z.string().optional(),
  keyEnv: ProviderKeyEnv.optional(),
  models: z.array(ProviderModel).optional(),
  defaultModel: z.string().optional(),
  wireApi: z.enum(['chat', 'responses']).optional(),
})
export type UpdateProviderReq = z.infer<typeof UpdateProviderReq>

export const SetActiveProviderReq = z.object({ engine: Engine, providerId: z.string() })
export type SetActiveProviderReq = z.infer<typeof SetActiveProviderReq>

// ── 凭证来源（spec 2026-06-07 登录/凭证来源）──────────────────────
/** 凭证来源：官方组三选项之一，或某自定义 providerId（开放字符串）。 */
export const AUTH_SOURCE_OFFICIAL = ['cli-login', 'oauth', 'official-key'] as const
export const SetAuthSourceReq = z.object({ engine: Engine, source: z.string().min(1) })
export type SetAuthSourceReq = z.infer<typeof SetAuthSourceReq>
export const SetOfficialKeyReq = z.object({ engine: Engine, secretId: z.string().min(1) })
export type SetOfficialKeyReq = z.infer<typeof SetOfficialKeyReq>

// ── 代理池（spec 2026-06-07 登录/凭证来源 §代理）──────────────────
/** 代理协议（对照 sub2api ent/schema/proxy.go）。 */
export const ProxyProtocol = z.enum(['http', 'https', 'socks5', 'socks5h'])
export type ProxyProtocol = z.infer<typeof ProxyProtocol>
/** 渲染层代理视图：永不含明文 password，只回 hasPassword。 */
export const ProxyView = z.object({
  id: z.string(), name: z.string(), protocol: ProxyProtocol, host: z.string(), port: z.number(),
  username: z.string().optional(), hasPassword: z.boolean(), status: z.string().optional(), createdAt: z.number(),
})
export type ProxyView = z.infer<typeof ProxyView>
export const CreateProxyReq = z.object({
  name: z.string().min(1), protocol: ProxyProtocol, host: z.string().min(1), port: z.number().int().min(1).max(65535),
  username: z.string().optional(), password: z.string().optional(),
})
export type CreateProxyReq = z.infer<typeof CreateProxyReq>
// 编辑：password 省略/空串=保留原值（对齐 UpdateSecretReq）。
export const UpdateProxyReq = z.object({
  name: z.string().min(1).optional(), protocol: ProxyProtocol.optional(), host: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(), username: z.string().optional(), password: z.string().optional(),
})
export type UpdateProxyReq = z.infer<typeof UpdateProxyReq>
export const ProxyTestResult = z.object({ ok: z.boolean(), latencyMs: z.number().optional(), error: z.string().optional() })
export type ProxyTestResult = z.infer<typeof ProxyTestResult>
/** 把某来源绑定到某代理（proxyId 空串=解绑=直连）。 */
export const SetSourceProxyReq = z.object({ engine: Engine, source: z.string().min(1), proxyId: z.string() })
export type SetSourceProxyReq = z.infer<typeof SetSourceProxyReq>
/** 本机 CLI 登录态（claude 实测；codex 固定 unknown，登录后置 Part A）。 */
export const CliLoginStatus = z.object({
  status: z.enum(['signed-in', 'signed-out', 'unknown']),
  method: z.enum(['oauth', 'api_key']).optional(),
  email: z.string().optional(),
})
export type CliLoginStatus = z.infer<typeof CliLoginStatus>
/** 单引擎凭证来源状态。cliLogin 反映本机 CLI 登录态（Phase 3 Task 3.1 合入）。 */
export const EngineAuthStatus = z.object({
  activeSource: z.string(),                       // 'cli-login'|'oauth'|'official-key'|<providerId>
  officialKey: z.object({ secretId: z.string().optional() }),
  custom: z.array(z.string()),                    // 该引擎下自定义 providerId 列表
  cliLogin: CliLoginStatus,                        // 本机 CLI 登录态（claude 实测 / codex unknown）
  // app 内 OAuth 授权登录态（来自 oauthTokenStore；token 持久化在 auth.json，故重开设置/切引擎仍保留）
  oauth: z.object({ signedIn: z.boolean(), email: z.string().optional() }),
  // 每来源绑定的代理 id（source 字符串 → proxyId）；空对象=全部直连。
  proxyBindings: z.record(z.string(), z.string()),
})
export type EngineAuthStatus = z.infer<typeof EngineAuthStatus>
export const AuthStatusResp = z.object({
  engines: z.object({ claude: EngineAuthStatus, codex: EngineAuthStatus }),
})
export type AuthStatusResp = z.infer<typeof AuthStatusResp>

// ── app 内 OAuth 授权登录（Task 4.3：3 步粘码流）──
/** 发起授权：仅指定引擎；daemon 生成 PKCE/state 并回授权 URL。 */
export const StartOAuthReq = z.object({ engine: Engine })
export type StartOAuthReq = z.infer<typeof StartOAuthReq>
export const StartOAuthResp = z.object({ authorizeUrl: z.string(), state: z.string() })
export type StartOAuthResp = z.infer<typeof StartOAuthResp>
/** 完成授权：回填授权码 + 发起时拿到的 state，daemon 据 state 找回 verifier 换 token。 */
export const FinishOAuthReq = z.object({ engine: Engine, code: z.string().min(1), state: z.string().min(1) })
export type FinishOAuthReq = z.infer<typeof FinishOAuthReq>
export const FinishOAuthResp = z.object({ email: z.string().optional() })
export type FinishOAuthResp = z.infer<typeof FinishOAuthResp>
/** 登出：清 app 内 OAuth token，并把来源重置回 cli-login。 */
export const LogoutReq = z.object({ engine: Engine })
export type LogoutReq = z.infer<typeof LogoutReq>

// ── codex app 内登录引导（Part A P7.4：app-server 自管，写本机 ~/.codex）──
/** 发起 codex 登录：apiKey（同步成功）/ chatgpt（app-server OAuth，返回 authUrl 引导浏览器）。
 *  ⚠️ 与「官网 API Key」(official-key·env 注入·不碰 ~/.codex)不同：本通路改本机全局 codex 登录态。 */
export const CodexLoginReq = z.discriminatedUnion('type', [
  z.object({ type: z.literal('apiKey'), apiKey: z.string().min(1) }),
  z.object({ type: z.literal('chatgpt') }),
])
export type CodexLoginReq = z.infer<typeof CodexLoginReq>
/** apiKey → {done:true}（同步成功）；chatgpt → {authUrl, loginSessionId}（待浏览器授权 + 轮询完成）。 */
export const CodexLoginResp = z.object({
  done: z.boolean(),                       // true=已完成（apiKey 同步成功）；false=待浏览器授权（chatgpt）
  authUrl: z.string().optional(),          // chatgpt：浏览器授权地址
  loginSessionId: z.string().optional(),   // chatgpt：轮询完成态的会话 id
})
export type CodexLoginResp = z.infer<typeof CodexLoginResp>
/** 轮询 codex chatgpt 登录完成态。 */
export const CodexLoginStatusResp = z.object({
  status: z.enum(['pending', 'done', 'error']),
  error: z.string().optional(),
})
export type CodexLoginStatusResp = z.infer<typeof CodexLoginStatusResp>

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

/** 触发器定义：时间四档（复用 AutomationSchedule 成员）+ startup（daemon 启动触发一次）。
 *  一个任务可挂多个（spec §16.1）。与 AutomationRunTrigger（运行来源 enum）是两回事。 */
export const AutomationTriggerDef = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('hourly'), minute: z.number().int().min(0).max(59) }),
  z.object({ kind: z.literal('daily'), time: z.string().regex(/^\d{2}:\d{2}$/), timezone: z.string().min(1) }),
  z.object({ kind: z.literal('weekdays'), time: z.string().regex(/^\d{2}:\d{2}$/), timezone: z.string().min(1) }),
  z.object({ kind: z.literal('weekly'), time: z.string().regex(/^\d{2}:\d{2}$/), timezone: z.string().min(1), weekday: z.number().int().min(0).max(6) }),
  z.object({ kind: z.literal('startup') }),
])
export type AutomationTriggerDef = z.infer<typeof AutomationTriggerDef>

/** 时间触发器（AutomationTriggerDef 去掉 startup）——调度器算 next_run_at 时复用 nextRun.ts，仅接受这几档。 */
export type TimeTriggerDef = Exclude<AutomationTriggerDef, { kind: 'startup' }>

/** 目标项目：每次新建会话（在新项目下）/ 复用某已有项目。 */
export const AutomationTarget = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('create_each_run') }),
  z.object({ mode: z.literal('reuse'), projectId: z.string().min(1) }),
])
export type AutomationTarget = z.infer<typeof AutomationTarget>

/** AUTOMATION.md 的 frontmatter（可分享的「定义」；enabled/next_run_at/历史是运行态、不在此）。 */
export const AutomationFrontmatter = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  engine: Engine,
  model: z.string().min(1),
  permission: z.string().min(1),
  // 分类：层级树·单归属（路径数组，spec §3）；标签：扁平多选·横切
  category: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  // 需要的环境变量声明（spec §3）；绑哪个本机密钥不在此（本机态，见 entity-config §11，本计划不实现绑定）
  requires: z.array(z.object({ kind: z.literal('env'), name: z.string().min(1) })).default([]),
  // 触发器列表（spec §16.1）：一个任务可挂多个；至少一个（无触发器的任务无意义）
  triggers: z.array(AutomationTriggerDef).min(1),
  // 执行方式（spec §16.2）：agent（默认，喂引擎）| script（spawn 直跑，不经 LLM）
  executor: z.enum(['agent', 'script']).default('agent'),
  script: z.string().optional(),        // executor=script 时的脚本入口（任务文件夹内相对路径）
  interpreter: z.string().optional(),   // node | bash …；缺省按 script 扩展名推断
  target: AutomationTarget,
})
export type AutomationFrontmatter = z.infer<typeof AutomationFrontmatter>

export const AutomationRunStatus = z.enum(['queued', 'running', 'succeeded', 'failed', 'needs-review', 'canceled'])
export type AutomationRunStatus = z.infer<typeof AutomationRunStatus>

// 运行来源（一次 run 是定时触发还是手动跑）——非「触发器定义」，勿混。
export const AutomationRunTrigger = z.enum(['scheduled', 'manual'])
export type AutomationRunTrigger = z.infer<typeof AutomationRunTrigger>

/** 新建自动化：permission 是引擎相关字符串（claude=ClaudePermissionMode / codex=沙箱档），daemon 按 engine 二次校验。
 *  字段与 AutomationFrontmatter 平行（定义部分），但带运行态 enabled。 */
export const CreateAutomationReq = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  prompt: z.string().min(1),
  engine: Engine,
  model: z.string().min(1),
  permission: z.string().min(1),
  category: z.array(z.string()).default([]),       // 层级路径·单归属
  tags: z.array(z.string()).default([]),           // 扁平多选
  requires: z.array(z.object({ kind: z.literal('env'), name: z.string().min(1) })).default([]),
  triggers: z.array(AutomationTriggerDef).min(1),  // 触发器列表（四档时间 + startup），至少一个
  executor: z.enum(['agent', 'script']).default('agent'),
  script: z.string().optional(),
  interpreter: z.string().optional(),
  target: AutomationTarget,
  enabled: z.boolean().default(true),
})
export type CreateAutomationReq = z.infer<typeof CreateAutomationReq>

/** 编辑：全可选；改 enabled / triggers → 调度器重排该条。 */
export const PatchAutomationReq = CreateAutomationReq.partial()
export type PatchAutomationReq = z.infer<typeof PatchAutomationReq>

/** 运行历史项（lastRun 摘要：列表卡「上次」状态用）。 */
export const AutomationLastRun = z.object({ status: AutomationRunStatus, completedAt: z.number().nullable() })
export type AutomationLastRun = z.infer<typeof AutomationLastRun>

export const AutomationDTO = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  prompt: z.string(),
  engine: Engine,
  model: z.string(),
  permission: z.string(),
  category: z.array(z.string()),
  tags: z.array(z.string()),
  requires: z.array(z.object({ kind: z.literal('env'), name: z.string() })),
  triggers: z.array(AutomationTriggerDef),
  executor: z.enum(['agent', 'script']),
  script: z.string().optional(),
  interpreter: z.string().optional(),
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
  trigger: AutomationRunTrigger,
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

/** 自动任务分类树节点（层级，单归属）：管理分类模态维护，存 automation-categories.json（Plan D D6）。 */
export interface CatNode { name: string; children?: CatNode[] }
export const CatNode: z.ZodType<CatNode> = z.lazy(() =>
  z.object({ name: z.string().min(1), children: z.array(CatNode).optional() }))
export const AutomationCategoriesResp = z.object({ tree: z.array(CatNode) })
export type AutomationCategoriesResp = z.infer<typeof AutomationCategoriesResp>
export const PutAutomationCategoriesReq = z.object({ tree: z.array(CatNode) })
export type PutAutomationCategoriesReq = z.infer<typeof PutAutomationCategoriesReq>

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

/** 多触发器摘要（spec §16.1）：startup→「启动时」，时间档复用 scheduleSummary，多个用「 · 」拼。
 *  会话来源副行 / 卡片触发器 chip 都用（单个时间触发器时输出 == scheduleSummary，兼容旧文案）。 */
export function triggersSummary(triggers: AutomationTriggerDef[]): string {
  return triggers.map((t) => (t.kind === 'startup' ? '启动时' : scheduleSummary(t))).join(' · ')
}

// ── 实体密钥/配置（spec 2026-06-06-skill-secrets-management-design）──────────────
// 命名密钥：渲染层永不见明文，只回掩码 + hasValue（对齐 ProviderView）。
export const SecretView = z.object({
  id: z.string(),
  name: z.string(),
  note: z.string(),
  hasValue: z.boolean(),
  maskedValue: z.string(),   // 如 '…1a2b' 或 ''
  createdAt: z.number(),
})
export type SecretView = z.infer<typeof SecretView>

// GET /secrets：单个密钥的「谁在用」——技能侧（entityRef）与 Provider 侧（Provider 名）分列。
export const SecretUsage = z.object({ skills: z.array(z.string()), providers: z.array(z.string()) })
export type SecretUsage = z.infer<typeof SecretUsage>

// GET /secrets：密钥列表 + 用量倒排（secretId → {skills, providers}，供「谁在用」）。
export const SecretsResp = z.object({
  secrets: z.array(SecretView),
  usage: z.record(z.string(), SecretUsage),
})
export type SecretsResp = z.infer<typeof SecretsResp>

export const CreateSecretReq = z.object({
  name: z.string().min(1),
  value: z.string().min(1),
  note: z.string().default(''),
})
export type CreateSecretReq = z.infer<typeof CreateSecretReq>

// 编辑：value 省略/空串 = 保留原值（对齐 UpdateProviderReq）。
export const UpdateSecretReq = z.object({
  name: z.string().min(1).optional(),
  value: z.string().optional(),
  note: z.string().optional(),
})
export type UpdateSecretReq = z.infer<typeof UpdateSecretReq>

// 实体需求清单：一个槽位 = 一项要配置的东西（env 变量 / 配置文件）。
export const ReqSlot = z.object({
  kind: z.enum(['env', 'file']),
  name: z.string().min(1),                                   // env 变量名 / 文件目标路径
  fileMode: z.enum(['in-folder', 'external-path']).optional(),
  bind: z.string().nullable().default(null),                // 绑定的 secretId；null=未绑
  default: z.string().optional(),                           // 探测到的默认值（预填）
  optional: z.boolean().default(false),                    // true=非必填，缺失不报警
})
export type ReqSlot = z.infer<typeof ReqSlot>

// needsConfig=静态扫描快信号（slots 未精确时也可为真）；slots 缺省=未精确探测、[]=已确认无需配置。
export const EntityRequirement = z.object({
  needsConfig: z.boolean().default(false),
  slotsSource: z.enum(['declared', 'agent', 'manual']).nullable().default(null),
  slots: z.array(ReqSlot).optional(),
})
export type EntityRequirement = z.infer<typeof EntityRequirement>

// PUT /entity-requirements/:ref 整体覆盖某实体的需求记录。
export const PutEntityRequirementReq = EntityRequirement
export type PutEntityRequirementReq = z.infer<typeof PutEntityRequirementReq>

export const EntityRequirementsResp = z.object({
  requirements: z.record(z.string(), EntityRequirement),    // key = entityRef，如 'skill:guizang-ppt'
})
export type EntityRequirementsResp = z.infer<typeof EntityRequirementsResp>

// GET /projects/:id/skill-config-check：注入该项目的技能里，env 冲突 + 必填缺配（不回明文）。
export const SkillConfigCheckResp = z.object({
  conflicts: z.array(z.object({
    env: z.string(),
    entityRefs: z.array(z.string()),
    secretIds: z.array(z.string()),
  })),
  missing: z.array(z.object({ entityRef: z.string(), slot: z.string() })),
})
export type SkillConfigCheckResp = z.infer<typeof SkillConfigCheckResp>

// POST /skill-config-check：按技能 effectiveName 列表查冲突/缺配（不需 projectId，建项目前预检用）。
export const SkillConfigCheckReq = z.object({
  skills: z.array(z.string()).default([]),   // effectiveName 列表
})
export type SkillConfigCheckReq = z.infer<typeof SkillConfigCheckReq>

// POST /skills/probe-config：对某探测到的技能跑一次 Agent 精确探测，回提议 slots（不落盘）。
export const ProbeConfigReq = z.object({
  sourceId: z.string().min(1),
  relPath: z.string(),                 // 源内相对路径（'' = 源根）
})
export type ProbeConfigReq = z.infer<typeof ProbeConfigReq>

export const ProbeConfigResp = z.object({
  slots: z.array(ReqSlot),             // Agent 提议的精确槽位（slotsSource 由 UI 保存时记 'agent'）
})
export type ProbeConfigResp = z.infer<typeof ProbeConfigResp>

// POST /skill-library/auto-inject：设某技能默认注入开关。
export const SetAutoInjectReq = z.object({ effectiveName: z.string().min(1), on: z.boolean() })
export type SetAutoInjectReq = z.infer<typeof SetAutoInjectReq>

// install_skill 工具入参（镜像 AddSourceReq 的来源字段子集）。
export const InstallSkillReq = z.object({
  type: z.enum(['git', 'folder']),
  loc: z.string().min(1),
  name: z.string().optional(),
  branch: z.string().optional(),
})
export type InstallSkillReq = z.infer<typeof InstallSkillReq>

export const InstallSkillResult = z.object({
  installed: z.array(z.object({ name: z.string(), effectiveName: z.string(), sourceId: z.string() })),
  already: z.array(z.object({ name: z.string(), effectiveName: z.string() })),
  conflicts: z.array(z.object({ name: z.string(), existingEffectiveName: z.string() })),
})
export type InstallSkillResult = z.infer<typeof InstallSkillResult>

// as_create_skill：从零创建新 skill（写 created-skills 目录 + 入库）。
export const CreateSkillReq = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, 'name 只能含字母数字-_'),
  description: z.string().min(1),
  body: z.string().min(1),
})
export type CreateSkillReq = z.infer<typeof CreateSkillReq>

export const CreateSkillResult = z.object({
  status: z.enum(['created', 'conflict']),
  name: z.string(),
  effectiveName: z.string().optional(),
  existingEffectiveName: z.string().optional(),
})
export type CreateSkillResult = z.infer<typeof CreateSkillResult>
