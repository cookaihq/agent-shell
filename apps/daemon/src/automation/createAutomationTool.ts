import { CreateAutomationReq, ClaudePermissionMode } from '@agent-shell/contracts'
import type { AutomationStore } from './automationStore'

export interface ToolResult { content: { type: 'text'; text: string }[]; isError?: boolean }
export interface CreateAutomationToolDeps { store: AutomationStore }

const CODEX_SANDBOXES = ['read-only', 'workspace-write', 'danger-full-access']
function validPermission(engine: 'claude' | 'codex', permission: string): boolean {
  return engine === 'claude' ? ClaudePermissionMode.safeParse(permission).success : CODEX_SANDBOXES.includes(permission)
}

/** 校验入参（zod + 权限档匹配引擎）后建任务。任何非法 → isError，不落库。
 *  requires 只是声明，create 不做密钥绑定（绑定是后续用户在设置里的动作，secrets §11）。 */
export async function createAutomationToolHandler(input: unknown, deps: CreateAutomationToolDeps): Promise<ToolResult> {
  const parsed = CreateAutomationReq.safeParse(input)
  if (!parsed.success) {
    return { isError: true, content: [{ type: 'text', text: `参数非法：${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` }] }
  }
  const req = parsed.data
  if (!validPermission(req.engine, req.permission)) {
    return { isError: true, content: [{ type: 'text', text: `权限档「${req.permission}」与引擎「${req.engine}」不匹配` }] }
  }
  const a = deps.store.create({
    name: req.name, description: req.description, prompt: req.prompt, engine: req.engine, model: req.model, permission: req.permission,
    category: req.category, tags: req.tags, triggers: req.triggers,
    executor: req.executor, script: req.script, interpreter: req.interpreter,
    requires: req.requires, target: req.target, enabled: req.enabled,
  })
  return { content: [{ type: 'text', text: `已创建自动任务「${a.name}」(id=${a.id})，下次将按触发器运行。` }] }
}
