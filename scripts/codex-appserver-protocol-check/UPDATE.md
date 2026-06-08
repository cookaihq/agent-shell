# 引擎更新 SOP（codex / claude 升级）

agent-shell 两个 Agent 引擎都是 **app 自带**（不依赖用户本机）。升级引擎版本的标准流程如下。设计依据：`docs/superpowers/specs/2026-06-06-codex-appserver-integration-and-agent-isolation-design.md` §10。

---

## claude 更新（简单）

claude 走 `@anthropic-ai/claude-agent-sdk`，SDK 内封装了 claude code bundle + 协议，**agent-shell 不碰 claude 协议**。

1. 升级 `apps/desktop/package.json` 的 `@anthropic-ai/claude-agent-sdk` 版本。
2. `pnpm install` → typecheck → 跑测试。
3. 重新打包发版。

→ **无需协议适配**（协议在 SDK 内，跟 SDK 版本走）。

---

## codex 更新（含协议适配）

codex 走 agent-shell 自写的 **app-server JSON-RPC 客户端**，协议是 experimental、会变，**要自己适配**。

1. **升级依赖**：`@openai/codex` + 平台子包版本（自带二进制）。
2. **协议检测**：
   ```bash
   node scripts/codex-appserver-protocol-check/check.mjs --against <新版本>
   ```
   导出新版协议、与 baseline diff，报告新增/移除/改动 + 标记 agent-shell 依赖的核心协议（`ClientRequest` / `ThreadItem` / `CollabAgent*` / `TurnStartParams` / `SubAgentSource` …）。
3. **按结果处理**：
   - **退出码 0**（协议无变 / 仅外围）→ 防御性解析吸收，无需改码。
   - **退出码 1 且仅外围类型变** → 一般防御性解析能吸收，确认无碍即可。
   - **退出码 1 且核心协议变** → **适配** `apps/daemon/src/runtimes/codexAppServer.ts`：
     - 请求格式（`thread/start` / `turn/start` 参数）
     - 事件映射（`ThreadItem` → 内部 AgentEvent）
     - 鉴权（`account/login` / Provider 注入）
     - subagent（`collabAgentToolCall` 字段）
4. **测试**：codexAppServer 真机端到端（对话 + 审批 + spawn 子代理）+ daemon 既有测试全绿。
5. **更新 baseline**（适配通过后切到新版）：
   ```bash
   node scripts/codex-appserver-protocol-check/check.mjs --init --version <新版本>
   ```
6. **打包发版**：`@openai/codex` 新版纳入 electron-builder，重新打包。

> 未来若需**同时支持新旧不兼容版本** → 加 `CodexProtocolAdapter` 版本适配器（spec D8 接口已预留）。

---

## 自动预警

`AUTOMATION.md`（挂 agent-shell 定时任务，周调度）自动跑检测脚本——codex 新版发布时**主动提示是否需适配**，不用人工盯版本。

## 当前基准

- **codex**：baseline 锁 **0.137.0**（latest stable，547 协议类型）。
- **claude**：`@anthropic-ai/claude-agent-sdk` `0.3.161`。
