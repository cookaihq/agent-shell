import { z } from 'zod'

export const Engine = z.enum(['claude', 'codex'])
export type Engine = z.infer<typeof Engine>

/** 建项目：只需显示名，存储路径由 daemon 用「父级目录 + 32位 uuid」算（系统设置改父级目录留 M7）。
 *  skills：建项目时选中的技能名列表，daemon 将对应技能软链进 <project>/.claude/skills（D6）。 */
export const CreateProjectReq = z.object({ name: z.string(), skills: z.array(z.string()).default([]) })
export type CreateProjectReq = z.infer<typeof CreateProjectReq>
export const CreateProjectRes = z.object({ projectId: z.string(), path: z.string() })

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
export const ImportSkillReq = z.object({
  source: SkillSource,
  url: z.string().optional(),    // source=git
  path: z.string().optional(),   // source=folder（本地绝对路径）
})
export type ImportSkillReq = z.infer<typeof ImportSkillReq>
