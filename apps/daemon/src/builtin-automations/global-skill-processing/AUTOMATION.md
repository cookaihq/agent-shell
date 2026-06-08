---
name: 全局 skill 处理
description: 扫描全局技能目录、算 hash 比对变更、维护全局 skill 注册表（确定性脚本，不经 LLM）。
engine: claude
model: opus
permission: bypassPermissions
executor: script
script: scan.mjs
interpreter: node
triggers:
  - kind: startup
  - kind: daily
    time: "10:00"
    timezone: Asia/Shanghai
target:
  mode: create_each_run
---

（内置自动任务：executor=script，正文不喂引擎，仅作人读说明。实际逻辑在 scan.mjs。）
