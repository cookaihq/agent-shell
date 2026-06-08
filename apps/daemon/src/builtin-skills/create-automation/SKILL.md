---
name: create-automation
description: 当用户想让你帮他创建一个 Agent Shell 定时自动任务（按触发器自动跑提示词或脚本）时使用。教你怎么和用户确认意图、组织参数、调用 as_create_automation 工具把任务落库。
---

# 帮用户创建 Agent Shell 自动任务

当用户希望「以后自动跑某件事」（每天 / 每周 / 开机时…）时，你的工作是**用 `as_create_automation` 工具帮他把任务建出来**（工具名在列表里可能带前缀，如 `mcp__agent-shell__as_create_automation`）。**绝不自己往文件系统写文件**——一律通过该工具，它会校验后写进用户的自动任务库。

## 你的工作流

1. **先和用户确认意图**：要自动做什么、什么时候触发、是否要在开机时也跑一次、需不需要密钥才能跑。问清楚再动手——运行时没人盯着，prompt 必须自包含。
2. **组织参数**（见下）→ 调 `as_create_automation` 工具。
3. **若任务需要密钥**：在 `requires` 里**声明**需要的环境变量（如 `COMPETITOR_API_KEY`）。**你只声明、不绑定**——告诉用户「建好后请去『任务自动化 › 该任务 › 设置』里把这些环境变量绑到本机密钥」。绑密钥永远是用户的动作，工具不替他做。

## 参数怎么填

1. **name**：任务名（如「每日竞品监控」）。
2. **prompt**：`executor: agent` 时每次运行发给 agent 的完整指令（自包含，遇不确定就挑合理默认值做完，不能反问）。
3. **engine**：`claude` 或 `codex`（默认 `claude`）。
4. **model**：模型（claude 默认 `opus`；codex 用 `gpt-5.5`）。
5. **permission**：claude 取 `default|acceptEdits|plan|auto|bypassPermissions`（无人值守通常 `bypassPermissions`）；codex 取 `read-only|workspace-write|danger-full-access`。
6. **triggers**：触发器**列表**（一个任务可挂多个），每项任选——
   - `{ "kind": "startup" }`（daemon 启动时触发一次）
   - `{ "kind": "hourly", "minute": 0-59 }`
   - `{ "kind": "daily", "time": "HH:MM", "timezone": "Asia/Shanghai" }`
   - `{ "kind": "weekdays", "time": "HH:MM", "timezone": "Asia/Shanghai" }`（周一至周五）
   - `{ "kind": "weekly", "time": "HH:MM", "timezone": "Asia/Shanghai", "weekday": 0-6 }`（0=周日…6=周六）
   - 例：「开机 + 每天 10 点」= `[{ "kind": "startup" }, { "kind": "daily", "time": "10:00", "timezone": "Asia/Shanghai" }]`
7. **executor**：`agent`（默认，喂引擎跑 prompt，需推理时用）或 `script`（直跑脚本、不经 LLM，适合确定性任务如扫描 / 比对，省钱省时）。
   - `executor: script` 时再填 **`script`**（任务文件夹内脚本入口，如 `scan.mjs`）+ 可选 **`interpreter`**（`node`/`bash`…，缺省按扩展名推断）；此时 `prompt` 可留占位说明。
8. **category**（可选）：**层级分类路径**（单归属，主组织维度），如 `["运营", "监控"]`（运营 ▸ 监控）。
9. **tags**（可选）：**扁平标签**（多选、横切筛选），如 `["紧急", "实验性"]`。
10. **requires**（可选）：任务运行要的环境变量声明，如 `[{ "kind": "env", "name": "COMPETITOR_API_KEY" }]`。**只声明、不绑值**（见上「你的工作流」第 3 条）。
11. **target**：`{ "mode": "create_each_run" }`（每次新建项目，常用）或 `{ "mode": "reuse", "projectId": "<已有项目 id>" }`（需要跨次记忆状态时用）。

## 调用示例（agent 任务，开机 + 每天，声明 env）

```json
{
  "name": "每日竞品监控",
  "prompt": "抓取竞品官网与社媒的最新动态，生成一份中文简报。没有人盯着，遇到不确定就挑合理默认值做完。",
  "engine": "claude",
  "model": "opus",
  "permission": "bypassPermissions",
  "category": ["运营", "监控"],
  "tags": ["竞品"],
  "requires": [{ "kind": "env", "name": "COMPETITOR_API_KEY" }],
  "triggers": [
    { "kind": "startup" },
    { "kind": "daily", "time": "09:00", "timezone": "Asia/Shanghai" }
  ],
  "executor": "agent",
  "target": { "mode": "create_each_run" }
}
```

## 调用示例（脚本任务，开机即跑、不经 LLM）

```json
{
  "name": "全局技能扫描",
  "prompt": "（脚本任务，prompt 仅作说明）开机扫描技能目录并比对 hash。",
  "engine": "claude",
  "model": "opus",
  "permission": "bypassPermissions",
  "triggers": [{ "kind": "startup" }],
  "executor": "script",
  "script": "scan.mjs",
  "interpreter": "node",
  "target": { "mode": "create_each_run" }
}
```

## 任务自带脚本 / 参考资料

若任务需要跑脚本或读参考资料，告诉用户：创建后可在该任务的文件夹里放脚本 / reference，运行时它们会被只读软链到工作目录的 `automation-assets/<任务文件夹名>/`，在 prompt 里用该相对路径引用即可（产物写工作目录，勿写回只读目录）。`executor: script` 的脚本入口（`script` 字段）也指向该文件夹内的脚本。
