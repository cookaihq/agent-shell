---
name: codex app-server 协议漂移检测
description: 检测新版 codex 的 app-server 协议相对 agent-shell baseline 是否变化、是否需要适配；新 codex 版本发布时自动检查。
engine: claude
model: opus
permission: bypassPermissions
categories: [运维, codex]
schedule:
  kind: daily
  time: "09:00"
  timezone: Asia/Shanghai
target:
  mode: create_each_run
---
检查 codex 是否发布了 agent-shell 尚未适配的新版本，判断它的 app-server 协议有没有变化、需不需要 agent-shell 跟进适配。

请这样做：

1. 运行命令（用 Bash 工具执行）：
   `node automation-assets/codex-appserver-protocol-check/check.mjs`
2. 读它的标准输出和退出码（exit code）。

然后按退出码回报：

- **退出码 1**（codex 新版本的 app-server 协议相对 baseline 有变化）：把输出里列出的「新增 / 移除 / 改动」的协议类型告诉我，**特别强调标了 🔴 的核心协议**（agent-shell 客户端依赖的，如 ClientRequest / ThreadItem / CollabAgent* / SubAgentSource），并提醒：「agent-shell 的 codex 集成可能需要为新版本做适配，请 review；适配完成后用 `--init --version <新版本>` 更新 baseline。」
- **退出码 0**（无新版本，或协议无变化）：简单回复「codex 协议无变化，无需适配」。
- **退出码 2 或命令报错**：把错误信息原样告诉我（可能是网络问题或 codex 未安装）。

注意：你只负责**跑脚本 + 汇报结果**，不要自己改任何代码，也不要自己更新 baseline。

（`automation-assets/` 是 agent-shell 运行任务时把本任务文件夹只读软链进项目的目录，脚本就在那里；产物请写到工作目录，勿写回该只读目录。）
