# Codex app-server 真机探测笔记（Part A · Phase 0 事实地基）

> 实测环境：**codex 0.137.0**（`codex update` 2026-06-07 拉到的 npm latest stable；npm `latest`=0.137.0，0.138 仅 alpha）app-server + gpt-5.5 / foxapi（`~/.codex` apikey 登录态）。
> 探测脚本：`apps/daemon/tests/codex-probe/probe-scenarios.mjs`（basic/sandbox/interrupt/approval）+ `probe-auth.mjs`（鉴权/Provider）+ `probe-subagent.mjs`（subagent）。
> 原始事件流：`apps/daemon/src/runtimes/codex/__fixtures__/*.jsonl`。
>
> **版本重锁结论**：系统 codex 原 0.132.0 → `codex update` → **0.137.0** = 计划既有锁版 = 仓内 `baseline.txt` 版本。`check.mjs --against local` 与 baseline **逐字节一致**（547 协议类型无变化），**无需重生成 baseline，无版本漂移**。Part A 锁定 **0.137.0**。

---

## 0. 传输层事实（Phase 2 jsonRpc.ts 依据）

- **协议**：newline-delimited JSON over stdio。每行一条 JSON-RPC message。
- **三类消息**：
  - 我方 request：`{method, id, params}`；server 回 `{id, result}` 或 `{id, error:{code,message}}`。
  - server→client request（如审批）：`{method, id, params}`，**我方必须回 `{id, result}`**。
  - notification：`{method, params}`（**无 id**）。
- **`initialize`**（首调）params：`{clientInfo:{name,title,version}, capabilities:{experimentalApi:true, requestAttestation:false}}`。
  - response：`{userAgent, codexHome, platformFamily, platformOs}`。
  - **`userAgent` 内嵌 codex 版本**：`"agent-shell-probe/0.137.0 (Mac OS 26.3.0; arm64) unknown (agent-shell-probe; 0.0.1)"` → **Phase 8 版本校验来源 #1**（正则抓 `/0\.\d+\.\d+/` 第一个）。
- **错误响应**给出全量合法 method 清单（见 `auth-provider.jsonl`）——v2 实验 API 的方法名权威来源。

---

## 1. 会话生命周期方法（Phase 3 codexAppServer.ts 依据）

实测合法方法名（部分关键）：`initialize`、`thread/start`、`thread/resume`、`thread/fork`、`turn/start`、`turn/steer`、`turn/interrupt`、`model/list`、`account/login/start`、`account/login/cancel`、`account/logout`、`account/read`、`account/rateLimits/read`、`getAuthStatus`、`experimentalFeature/list`。

### thread/start
- params：`{cwd, approvalPolicy, sandbox, model?}`（model 缺省走 config.toml）。
- **response（完整 shape）**：
  ```
  {
    thread: { id, sessionId, forkedFromId, parentThreadId, preview, ephemeral,
              modelProvider, createdAt, updatedAt, status:{type:"idle"}, path,
              cwd, cliVersion:"0.137.0", source:"vscode", threadSource,
              agentNickname, agentRole, gitInfo, name, turns:[] },
    model:"gpt-5.5", modelProvider:"foxapi", serviceTier,
    cwd, runtimeWorkspaceRoots:[...], instructionSources:["~/.codex/AGENTS.md"],
    approvalPolicy, approvalsReviewer:"user",
    sandbox:{type:"readOnly", networkAccess:false},   // ← 注意归一化
    activePermissionProfile, reasoningEffort:"xhigh"
  }
  ```
- **threadId = `response.thread.id`**（也是后续所有 notification 的 `params.threadId`）。
- **`thread.cliVersion`** = Phase 8 版本校验来源 #2。
- ⚠️ **sandbox 入参/回参不对称**：请求传字符串 `"read-only"|"workspace-write"|"danger-full-access"`，**response 归一化成对象** `{type:"readOnly"|"workspaceWrite"|"dangerFullAccess", networkAccess}`。Phase 3 参数映射只需发字符串；解析 response 时按对象读。

### turn/start
- params：`{threadId, input:[{type:"text", text, text_elements:[]}]}`。
- **触发 `turn/started` notification**：`params.turn.id` = **turnId**（NOT `params.turnId`）；`params.threadId`。
- 注意：`turn/start` 的 **response** 也含 `turn:{id, items:[], itemsView:"notLoaded", ...}` → turnId 也可从 response 取。

### turn/interrupt（中断）
- **params = `{threadId, turnId}`**。⚠️ **缺 `turnId` 直接报 `-32600 missing field turnId`**（实测踩坑）——必须缓存当前 turnId。
- response：`{}`。随后 `thread/status/changed{status:{type:"idle"}}` → `turn/completed`。

### resume / fork
- `thread/resume`、`thread/fork` 在合法方法列表中（详细 params 待 Phase 3 展开时按 baseline `ThreadResumeParams`/`ThreadForkParams` 对照；resume 用存的 thread.id）。

---

## 2. 事件流 → AgentEvent 映射（Phase 3 eventMap.ts 依据）

通知方法：`thread/started`、`turn/started`、`turn/completed`、`item/started`、`item/completed`、`item/agentMessage/delta`、`thread/tokenUsage/updated`、`account/rateLimits/updated`、`thread/status/changed`、`mcpServer/startupStatus/updated`、`remoteControl/status/changed`、`error`。

### item 类型（`params.item.type`，实测 shape）
| item.type | 关键字段 | 映射目标（spec §4.3）|
|---|---|---|
| `userMessage` | `{id, clientId, content:[{type:"text",text,text_elements}]}` | V1 忽略（是回显自己发的）|
| `reasoning` | `{id, summary:[], content:[]}`（流式经 `item/agentMessage/delta`? 见下）| thinking |
| `agentMessage` | `{id, text, phase:"commentary"\|..., memoryCitation}` | message（streaming）|
| `commandExecution` | `{id, command, cwd, processId, source:"unifiedExecStartup", status, commandActions:[{type:"read"\|"unknown", command, name?, path?}], aggregatedOutput, exitCode}` | tool_use(shell)/tool_result |
| `fileChange`（apply_patch）| 实测 read-only 下被拒，未单独抓到 completed 成功态；写场景 Phase 3 补 | tool_use(edit)/tool_result |
| `collabAgentToolCall` | 见 §4 subagent | subagent 路由（threadId）|

### 流式增量
- **`item/agentMessage/delta`**：`{threadId, turnId, itemId?, delta/text}` —— agentMessage 文本流式。basic 一轮 65 条 delta。
- reasoning 的流式增量键待 Phase 3 用 fixture 精确断言（basic 中 reasoning summary/content 为空数组，未展开）。

### turn 结束 + usage
- **`turn/completed` 的 `usage` 实测为 undefined**！token 用量经独立 **`thread/tokenUsage/updated`** notification 给（`{threadId, turnId, ...usage}`）。**Phase 3 usage 不能从 turn/completed 读，要监听 tokenUsage/updated 累计。**
- `account/rateLimits/updated`：`{rateLimits:{limitId:"codex", limitName, primary, secondary, ...}}` —— 限流信息，V1 可忽略或做提示。
- `thread/status/changed`：`{threadId, status:{type:"active"|"idle"}}` —— 用于「turn 真正空闲」判定（常驻保活的 idle 信号）。

### 防御性解析（§4.11）
未列出/未来新增 item 类型 → V1 降级为 message 文本或忽略，不崩。

---

## 3. sandbox（Phase 1 枚举 + Phase 3 参数映射）

- 三档字符串（thread/start.sandbox 入参）：`"read-only"` | `"workspace-write"` | `"danger-full-access"`。
- **read-only 下写文件**：`approvalPolicy:"never"` 时 apply_patch 被直接拒，错误文案 `writing is blocked by read-only sandbox; rejected by user approval settings`；模型在 agentMessage 如实汇报失败（无单独审批 request）。见 `sandbox-readonly.jsonl`。
- response 归一化枚举：`readOnly` / `workspaceWrite` / `dangerFullAccess`（见 §1）。

---

## 4. 逐工具审批回路（Phase 4 依据 · 解 spec §4.4 待细化）

**触发条件（实测关键）**：
- `approvalPolicy:"untrusted"`（UnlessTrusted）**不会发审批 request** —— 它对需升级的命令直接拒（server 日志：`you cannot ask for escalated permissions if the approval policy is UnlessTrusted`）。**不要用 untrusted 期望弹审批。**
- **`approvalPolicy:"on-request"` + `sandbox:"read-only"`** → 模型写文件必须升级 → **真发 server→client 审批 request**。✅ 这是触发审批的可靠组合。

**审批 request（server→client，见 `approval.jsonl`）**：
- **wire method（确切）= `item/commandExecution/requestApproval`**（注意：baseline 的 TS 类型名是 `CommandExecutionRequestApprovalParams`，但**线上 method 名是 `item/commandExecution/requestApproval`**——以线上为准）。
- **params**：
  ```
  { threadId, turnId, itemId,                       // itemId = call_xxx（对应 commandExecution item）
    startedAtMs,
    reason,                                          // 模型给的人类可读理由（中文）
    command:"/bin/zsh -lc 'echo ... > approved.txt'",
    cwd,
    commandActions:[{type:"unknown"|"read"|..., command}],
    proposedExecpolicyAmendment:["/bin/zsh","-lc","..."],
    availableDecisions:["accept", {acceptWithExecpolicyAmendment:{execpolicy_amendment:[...]}}, "cancel"] }
  ```
- **回执（client→server response）= `{decision: <CommandExecutionApprovalDecision>}`**。
  - **决策枚举（v2，权威）**：`"accept"` | `"acceptForSession"` | `{acceptWithExecpolicyAmendment:{execpolicy_amendment}}` | `{applyNetworkPolicyAmendment:{...}}` | `"decline"` | `"cancel"`。
  - ⚠️ **不是 `approved`/`denied`**（旧 probe 误用）。实测回 `{decision:"accept"}` → 命令执行、`approved.txt` 创建成功。
  - **每个 request 的 `availableDecisions` 列出本次可选项**：本例 = `accept | acceptWithExecpolicyAmendment | cancel`（无 `decline`，"拒绝"映射到 `cancel`）。Phase 4「同意」→`accept`、「拒绝」→ 取 availableDecisions 中的 `decline`，无则 `cancel`。
- **文件改动审批**（apply_patch）对应 method 推测 `item/fileChange/requestApproval`（类型 `FileChangeRequestApprovalParams{threadId,turnId,itemId,startedAtMs,reason?,grantRoot?}`，决策枚举 `accept|acceptForSession|decline|cancel`）——本轮模型走了 shell，未单独抓到；Phase 4 展开时若需可用「on-request+read-only+要求 apply_patch 编辑已存在文件」补抓。

**链路（spec §5）**：`item/commandExecution/requestApproval` → daemon 转 `permission_request` 事件（requestId=itemId 或 approvalId）→ PendingCard → POST decision → `resolveDecision` 按引擎分发 → 回 app-server `{id, result:{decision}}`。

---

## 5. subagent 多 thread（Phase 5 依据 · 见 `subagent.jsonl` + `apps/daemon/tests/codex-probe/probe-notes.md`）

> 详尽笔记见 `apps/daemon/tests/codex-probe/probe-notes.md`（Task 0.4 原始资产，0.137 实测）。要点：
- 实验特性 **`multi_agent` = stable, 默认 enabled**；子代理工具默认暴露。`enable_fanout`/`multi_agent_v2` = underDevelopment，`-c` 未生效（但不影响子代理并发）。
- **子代理 = 独立 thread**，有完整 item 流（reasoning + agentMessage delta + commandExecution）。归属靠 **`threadId`**（每条 item notification 带 threadId）。**不复用 claude 的 parentToolUseId。**
- 编排工具 `collabAgentToolCall`（item.type）：`spawnAgent`（`{prompt, model, reasoningEffort, receiverThreadIds:[子threadId], agentsStates:{子:pendingInit}}`）/ `wait`（返回粒度=单个完成，带子的 `message` 汇报）/ `closeAgent`。
- 子 thread `thread/started` 的 `agentRole`/`agentNickname` 临时 spawn 实测 **null** → UI **不能靠角色名**，靠任务（spawnAgent.prompt）+ threadId + 完成 message 标识。
- 状态机 `agentsStates[threadId].status`：`pendingInit → running → completed`（也可 interrupted/errored/shutdown）。
- `SubAgentSource.thread_spawn.depth` 支持嵌套；实测 depth 1。

---

## 6. 鉴权 + Provider 注入（Phase 7 依据 · 解 spec §4.8 待细化）

### 鉴权读取
- **`getAuthStatus`** params `{includeToken:bool, refreshToken:bool}` → response **`{authMethod:"apikey"|..., authToken, requiresOpenaiAuth:true}`**。当前 ~/.codex 为 apikey 态。
- **v2 账户读取 method = `account/read`**（不是 `account/get`，实测后者报 unknown variant）。
- 登录：**`account/login/start`**（params=`LoginAccountParams`：`{type:"apiKey",apiKey}` | `{type:"chatgpt",codexStreamlinedLogin?}` | `{type:"chatgptDeviceCode"}` | `{type:"chatgptAuthTokens",accessToken,chatgptAccountId,...}`）、`account/login/cancel`、`account/logout`。
  - **codex 授权登录（chatgpt OAuth）走 `account/login/start{type:"chatgpt"}` 由 app-server 自管**（不自实现），完成态经 `account/login/completed` notification（类型 `AccountLoginCompletedNotification`）。
- `Account` shape（account/read 返回的账户）：`{type:"apiKey"} | {type:"chatgpt",email,planType} | {type:"amazonBedrock"}`。

### Provider 注入方式（实测两种均可，Phase 7 选型）
- **当前 ~/.codex/config.toml 范式**（已验证可用）：
  ```toml
  model_provider = "foxapi"
  model = "gpt-5.5"
  [model_providers.foxapi]
  name = "foxapi"
  base_url = "https://api.foxapi.cc/v1"
  wire_api = "responses"        # responses | chat
  requires_openai_auth = true
  ```
- **`-c` 启动覆盖（实测可行 ✅）**：`codex app-server -c model_provider=foxapi -c 'model_providers.foxapi.base_url="https://api.foxapi.cc/v1"'` → `thread/start` response 反映 `modelProvider:"foxapi"`、`model:"gpt-5.5"`。
  - 字符串值要带引号（`-c 'k.base_url="..."'`）。
- **Phase 7 建议**：默认复用 `~/.codex`（不覆盖 CODEX_HOME，用户已配 foxapi 自动生效）；BYOK/自定义 Provider 用 **`-c` 启动覆盖**（无侵入、不写用户 config.toml，进程级隔离更干净）——除非需持久化才写 config.toml。最终方式 Phase 7 展开时定。

---

## 7. Phase 0 出口校验

- [x] `__fixtures__/` 五类真实事件流：`basic-conversation.jsonl`(102)、`sandbox-readonly.jsonl`(125)、`interrupt.jsonl`(16)、`approval.jsonl`(99)、`subagent.jsonl`(712) + `auth-provider.jsonl`(8)。
- [x] 审批 schema 固化（method=`item/commandExecution/requestApproval`、决策=`accept`/`decline`/`cancel`/...）。
- [x] Provider 注入方式（config.toml model_providers / `-c` 覆盖，均实测）。
- [x] login 流程 shape（`account/login/start` 四型 + `getAuthStatus` + `account/read`）。
- [x] 0.137 subagent collabAgentToolCall 运行态确认（threadId 归属、agentRole=null）。
- [x] 版本重锁：0.137.0 = baseline，无漂移。
