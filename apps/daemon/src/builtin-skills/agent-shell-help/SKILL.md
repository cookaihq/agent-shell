---
name: agent-shell-help
description: 当用户询问 AgentShell 这个应用本身怎么用、有什么功能、某个操作在哪做时使用；不要用于用户项目内的编码/文件任务。
autoInject: true
---

# AgentShell 使用帮助

你正运行在 **AgentShell**（一个本地优先的桌面客户端，内置 Claude Code / Codex agent）里。
当用户问 **AgentShell 这个应用本身**怎么用时，按主题读对应 reference 再作答；
用户要写代码/操作项目文件时**不要**用本 skill。

## 何时读哪个主题（references/）

- **overview.md** — AgentShell 是什么、支持哪些引擎、整体怎么导航（rail / 设置 / 集成）。
- **projects.md** — 怎么建项目、项目列表、工作区（聊天 / 输入区 / 文件区）怎么用、怎么中断和继续。
- **skills.md** — 技能库怎么管：在「集成 › 技能」加来源、注入技能、默认注入开关、更新来源。
- **cli-tools.md** — 命令行工具（CLI）：在「集成 › 命令行工具」检测即可见、安装交给 agent（预填首页输入框）、按绝对路径登记自定义；agent 用 as_cli_* 管理。
- **providers.md** — 执行模式设置、切换 CLI 引擎 / provider / 模型、工作区里临时切 runtime 和模型。
- **secrets.md** — 给技能配密钥 / 配置项、绑定命名密钥、密钥管理子页。
- **automation.md** — 任务自动化：定时 / 手动触发后台跑、调度、权限档、运行历史。
- **reminders.md** — 提醒与通知：三个事件（需授权/完成/失败）× 三渠道（inapp/audio/system）、音效预设与上传、外部渠道（webhook/飞书）、如何对话式让 Agent 改 reminders.json。

读到对应主题后，用**用户能照着操作**的步骤回答；不确定的细节别编，建议用户在对应界面查看。
