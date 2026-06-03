import { z } from 'zod'

export const Engine = z.enum(['claude', 'codex'])
export type Engine = z.infer<typeof Engine>

/** 建项目：只需显示名，存储路径由 daemon 用「父级目录 + 32位 uuid」算（系统设置改父级目录留 M7）。
 *  skills：建项目时选中的技能名列表，daemon 将对应技能软链进 <project>/.claude/skills（D6）。 */
export const CreateProjectReq = z.object({ name: z.string(), skills: z.array(z.string()).default([]) })
export type CreateProjectReq = z.infer<typeof CreateProjectReq>
export const CreateProjectRes = z.object({ projectId: z.string(), path: z.string() })

/** 创建会话：挂 projectId；engine 挂会话（同项目可混 claude/codex）；cwd 由 project.path 推导，不在此传。 */
export const CreateSessionReq = z.object({
  projectId: z.string(), engine: Engine, model: z.string(), title: z.string().optional(),
})
export const CreateSessionRes = z.object({ sessionId: z.string() })

/** 发消息：文本 + 上下文文件路径（M6 仅透传保存，真实组装注入留 M7）。 */
export const SubmitMessageReq = z.object({
  text: z.string(),
  contextFiles: z.array(z.string()).default([]),
})

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
export const ImportSkillReq = z.object({
  source: SkillSource,
  url: z.string().optional(),    // source=git
  path: z.string().optional(),   // source=folder（本地绝对路径）
})
export type ImportSkillReq = z.infer<typeof ImportSkillReq>
