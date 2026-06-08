# Codex app-server subagent 真实运行态探测笔记（Part A Phase 0 资产）

> 实测：codex **0.137.0** app-server（npx）+ gpt-5.5 / foxapi（`~/.codex`）。脚本 `probe-subagent.mjs`，原始事件流 `subagent.raw.jsonl`（143 行，完整一轮带 2 子代理）。

## 1. 触发条件（关键）

- 实验特性 **`multi_agent` = stable, 默认 enabled**（`experimentalFeature/list` 实测）。子代理（spawn agent / collab agent）工具默认就暴露给模型。
- **并行 fanout**：`enable_fanout` / `multi_agent_v2` = underDevelopment，默认关；**运行时 `experimentalFeature/enablement/set` 不支持设这俩**（只支持 apps/memories/mentions_v2/plugins/remote_control/remote_plugin/tool_suggest/tool_call_mcp_elicitation）；`-c enable_fanout=true` 也没生效（config 键路径未确认）。
- **但即使不开 fanout，子代理也是并发独立 thread**（见下）。fanout 影响的是「一次 spawnAgent 能否带多个 receiver」（本次每次 spawn 一个）。
- **模型必须被明确要求用子代理**：普通 prompt 模型会偷懒自己干、然后**假称**用了并行子代理（幻觉）；prompt 写「你必须用 spawn agent 工具…一定用子代理」才真 spawn。

## 2. 完整编排范式（实测 12 个 collabAgentToolCall 事件）

```
主代理推理 → 识别并行任务（本次模型自己引用了 dispatching-parallel-agents 技能）
spawnAgent  → 子A thread（带父写的 prompt=子任务 + model + reasoningEffort）；agentsStates={子A: pendingInit}
spawnAgent  → 子B thread；agentsStates={子B: pendingInit}
（子A、子B 各自起 turn 并发跑：reasoning + agentMessage + commandExecution，各读 superpowers、apply_patch 写文件）
wait[A,B]   → 阻塞；【wait 是「等到下一个完成就返回」】，A 先完成 → wait completed，states={子A: completed, message:"已完成…AAA.txt"}
wait[B]     → 再等 B → completed，message:"…BBB.txt"
closeAgent A → completed
closeAgent B → completed
主代理 agentMessage 汇总核验 → turn/completed
```

- **spawnAgent**：`prompt`（父给子的任务，**子代理身份靠它标识**）、`model`、`reasoningEffort`、`receiverThreadIds=[新子threadId]`、`agentsStates={子: pendingInit}`。本次 fanout 关 → 每次 spawn 一个 receiver。
- **wait**：`receiverThreadIds=[要等的子们]`；**返回粒度=单个完成**（主代理需循环 wait 直到全完成）；完成时 `agentsStates[子].status=completed` + **`message`（子代理给父的最终汇报文本）**。
- **closeAgent**：每个子代理一个，回收。

## 3. 每个子代理 = 完整 mini-agent（影响 UI 的核心事实）

- 子代理是**独立 thread**，有自己完整的 item 流：`reasoning` + `agentMessage`(streaming delta) + `commandExecution`(读文件/apply_patch 写文件)。**不是一个状态卡，是完整子对话**。
- 子代理事件靠 **`threadId`** 归属（item/started、item/completed、item/agentMessage/delta 都带 `threadId`）。
- 子线程也会 `thread/started`、`turn/started`、`thread/tokenUsage/updated`、`thread/status/changed`（active/idle）。

## 4. ⚠️ 角色名约束（影响 UI 标识方式）

- 本次临时 spawn 的子代理 **`agentRole` / `agentNickname` 实测为 `null`**（thread/started 里）。命名角色（agent_role/nickname/agent_path）**仅在预定义命名 agent 配置时才有**（ExternalAgentConfig 的 SUBAGENTS）。
- 故 UI **不能依赖角色名**；子代理「身份」= **它的任务（spawnAgent.prompt 首行/摘要）** + threadId + 完成时的 message。
- `depth`：本次 1（无孙代理），但协议（SubAgentSource.thread_spawn.depth）支持嵌套。

## 5. 状态机（agentsStates[threadId].status）

`pendingInit → running → completed`（也可能 interrupted/errored/shutdown，本次只见 pendingInit→completed）。完成带 `message`（子代理汇报）。

## 6. 对 UI 的结论

- 重心是「**能看每个子代理的完整流**」（子代理是 mini-agent，流丰富）+ **并发** + **显式 wait 编排** + **每子最终 message 汇报**。
- 子代理靠**任务**标识（非角色名）。
- 并发规模实测 2、典型小（因任务而异）；支持嵌套但常见 depth 1。
