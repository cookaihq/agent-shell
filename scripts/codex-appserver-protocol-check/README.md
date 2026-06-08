---
name: codex-appserver-protocol-check
description: 检测新版 codex 的 app-server 协议相对 agent-shell baseline 是否变化、是否需要适配。当 codex 发布新版本、或要判断 agent-shell 的 codex 适配是否要跟进协议变更时使用。
---

# Codex app-server 协议漂移检测

agent-shell 的 codex 引擎走 `codex app-server`（experimental JSON-RPC 协议，**无版本号、无兼容承诺**，每个 codex 版本都可能改）。本工具把「检测新版本协议是否变化、是否需要 agent-shell 适配」固化成一个可重复执行的单元。

> 用 skill 的格式组织（frontmatter + 何时用 + 怎么用），但**刻意不叫 `SKILL.md`**——这是开发者运维工具，不进 agent-shell 产品的 skill 系统。

## 何时用

- 有新 codex 版本发布时，判断它的 app-server 协议相对 agent-shell 适配的 baseline 有没有变化、是否需要重新适配。
- 升级 agent-shell 打包的 codex 版本前，先确认协议兼容性。
- 挂 agent-shell 定时任务，新版本发布时自动检查。

## 原理

codex 自带 `codex app-server generate-ts` 能导出**完整协议类型**（当前 526 个）。本工具：

1. 把某个锁定 codex 版本的导出当作 **baseline**（`baseline.txt`，当前锁 codex 0.137.0 / latest stable）。
2. 新版本导出后与 baseline **diff**，机器看出哪个 method / ThreadItem / 字段增删改。
3. 特别标记 agent-shell 客户端依赖的**核心协议类型**（`ClientRequest` / `ThreadItem` / `CollabAgent*` / `SubAgentSource` 等）变化——这些变了务必人工 review。

> ⚠️ 这是**检测**，不是自动适配。协议的破坏性变更仍需人工改 agent-shell 的 codex 适配层代码。它的价值是「让协议变更升级时可机器检测、有据可依」。

## 怎么用

```bash
# 检测：查 npm 最新 stable codex；若与 baseline 版本不同，导出其协议与 baseline diff（会 npx 下载该版本）
node scripts/codex-appserver-protocol-check/check.mjs

# 对指定版本 diff（npx 下载该版本）
node scripts/codex-appserver-protocol-check/check.mjs --against 0.137.0

# 自检（本机 codex vs baseline，不下载）
node scripts/codex-appserver-protocol-check/check.mjs --against local

# 建/更新 baseline（适配了新版本后，把 baseline 更新到该版本）
node scripts/codex-appserver-protocol-check/check.mjs --init                    # 用本机 codex
node scripts/codex-appserver-protocol-check/check.mjs --init --version 0.137.0  # 用指定版本（npx 下载）
```

退出码：`0` = 无需适配（无新版 / 协议无变化）；`1` = 协议有变化、需 review；`2` = 运行错误。

## 挂 agent-shell 定时任务

**任务定义见 [`AUTOMATION.md`](./AUTOMATION.md)**——agent-shell「文件夹化自动任务」格式（frontmatter 调度/引擎设置 + 正文提示词），自包含、可直接作为 agent-shell 定时任务。agent 会用 Bash 跑脚本、读退出码与结论汇报，新 codex 版本发布时自动检查是否需要适配。

## 文件

- `check.mjs` — 检测脚本（Node，无第三方依赖）
- `baseline.txt` — 协议 baseline 快照（当前锁 codex 0.137.0 / 547 类型）
- `AUTOMATION.md` — agent-shell 文件夹化自动任务定义（frontmatter 调度/引擎 + 正文提示词）
- `UPDATE.md` — 引擎更新 SOP（codex / claude 升级 step-by-step）

## 维护

agent-shell 适配了某个新 codex 版本后，跑 `--init --version <该版本>` 把 baseline 更新到它，后续检测以新 baseline 为基准。关联设计：`docs/superpowers/specs/2026-06-06-codex-appserver-integration-and-agent-isolation-design.md` §4.11。
