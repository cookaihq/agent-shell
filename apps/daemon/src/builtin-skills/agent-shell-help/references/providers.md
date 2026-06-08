# 执行模式、Provider、引擎与模型切换

本文说明：**设置页怎么管引擎和 Provider**、**Provider 切换的语义（env 注入、作用域隔离）**、以及**工作区里临时切换引擎和模型**的入口。工作区布局（proj-bar 的位置、composer 的外观）详见「工作区」一节，本文只讲这些控件背后的体系本身。

---

## 一、设置 › 执行模式

从任意页面打开「设置」（齿轮图标），选「执行模式」子页。

### 引擎列表

页面顶部显示「自带引擎（N）」，列出 AgentShell 检测到的两个引擎：

- **Claude Code**（`claude` CLI）
- **Codex CLI**（`codex` CLI）

每张引擎卡显示引擎名称、版本号，以及一个「测试」按钮。点击某张引擎卡即切换到该引擎视图——下方的模型列表和 Provider 配置随之切换为对应引擎的内容。

> 若某引擎未检测到（`bin` 为 null），该卡灰显不可点击。

### 测试连通

点引擎卡上的「测试」按钮，AgentShell 向该引擎发起探测，返回「✓」或「✗ + 错误信息」显示在版本号右侧。注意：这里测试的是**引擎 CLI 本身是否可用**，与 Provider 测试是两件事（Provider 测试在下方 Provider 卡里）。

### 引擎官方模型列表（默认 Provider 下可见）

选中某引擎后，若当前 Provider 是「默认（CLI 登录态）」，会显示该引擎的官方模型 chips：

- **Claude Code**：`default`（推荐）、`sonnet`、`haiku`、`opus`、`opus[1m]`
- **Codex CLI**：`gpt-5.5`、`gpt-5.4`、`gpt-5.3-codex`、`gpt-5.4-mini`

点击某个模型 chip 即将其设为「新建会话的默认模型」（chip 上出现 ✓）。对 Claude Code，每个 chip 还有铅笔图标（✎），点击可为该模型设置自定义别名，别名会在整个 app 的模型展示名中优先使用。

官方模型列表标注「只读」——不可增删，只能点选或设别名。

---

## 二、Provider（上游预设）体系

### Provider 是什么

**Provider = 一组带名字的上游凭证预设**，记录「上游地址（Base URL）+ 密钥 + 凭证类型」。每个引擎各自维护一份 Provider 列表，并有一个「当前激活的 Provider」。

AgentShell 起 CLI 时，会把当前激活 Provider 的配置注入给该引擎的子进程：

- **Claude Code**：以**环境变量**形式注入（Base URL → `ANTHROPIC_BASE_URL`、密钥 → `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`）。
- **Codex**：密钥仍走环境变量（`OPENAI_API_KEY`），但上游地址 + 协议经 codex 的 **`-c` 启动覆盖**注入（进程级临时覆盖 `model_provider` / `model_providers.<名>`，**不写你的 `~/.codex/config.toml`**）——codex 的 Provider 注入比 Claude 多了「provider 名 + wire_api」两项，故用 `-c` 而非纯 env。

选「默认（使用本机 CLI 登录状态）」则什么都不注入，引擎走它自己的登录态（Claude 走 `~/.claude`、Codex 走 `~/.codex`，= 你在终端登录的那个账号）。

### 官方组：三种官方登录方式

「执行模式」设置页选中引擎后，Provider 卡顶部有一个「官方」分组，提供三种走官方端点 + 官方模型的登录方式（点 radio 切换，立即生效）：

1. **使用本机 CLI 登录状态**（默认）：不注入任何凭证，引擎走本机 CLI 自带的登录态（= 你在终端 `claude` 登录的那个账号），只读复用、不改全局配置。这是出厂默认。选中后会显示本机 CLI 的登录状态（已登录会显示账号/方式，未登录给提示）。
2. **授权登录**：在 AgentShell 内做一次 OAuth 授权登录。两个引擎流程不同：
   - **Claude Code**：app 内 3 步粘码、**仅本应用内生效、不动全局 CLI**。① 点「生成授权 URL」→「在浏览器打开」登录授权；② 浏览器完成授权；③ 把页面给出的授权码粘进输入框、点「确认登录」。成功后显示已登录账号（email）和「登出」（只清本应用内这次 OAuth，不影响全局 Claude Code）。
   - **Codex**：走 codex（app-server）**自管的 ChatGPT 授权**——点「用 ChatGPT 授权登录」自动开浏览器，授权后无需回填授权码、本页自动更新。⚠️ 与 Claude 不同：codex 授权登录写入**本机 `~/.codex`**，与「使用本机 CLI 登录状态」共享同一登录态（不是仅本应用内）。
3. **官网 API Key**：填 Anthropic / OpenAI 官方 key（从密钥管理选已有，或现场新建一条存入密钥管理），仅本应用内生效。**Codex 此选项暂禁用**（codex 官方 key 的注入语义需覆盖 `model_provider`，尚未验证）——codex 要用官方账号请走上面的「授权登录」。

> 这三种都属于「官方」，模型用引擎官方列表；要接第三方中转站请用下方「自定义 Provider」。

### 切换当前 Provider

在「执行模式」设置页、选中某引擎后，Provider 卡的列表里点击某一项（radio 选中），即将该 Provider 设为该引擎的当前激活项。切换立即生效，下一次起新会话时就走这个 Provider。

### 添加自定义 Provider

点列表末尾的「＋ 添加 Provider」，弹出内联编辑表单，填写：

| 字段 | 说明 |
|---|---|
| 名称 | 展示用，如「我的中转站」「公司网关」 |
| Base URL | 上游地址，如 `https://api.example.com` |
| API Key | 从**密钥管理**下拉选一条已有密钥，或选「＋ 手动输入新密钥」当场填名称/值（保存时一并存入密钥管理）。Provider 只记 secretId 引用、不各存裸密钥 |
| 凭证类型（仅 Claude Code） | **API Key** 或 **Auth Token** 二选一（见下方说明） |
| wire_api（仅 Codex，收在「高级」折叠） | `responses`（默认）或 `chat`（OpenAI 兼容上游可选） |

填完点「保存」。新建的 Provider 同时被设为该引擎的当前激活项。

**凭证类型（Claude Code 专属）**：Anthropic 官方及部分中转用 `ANTHROPIC_API_KEY`（`x-api-key` 请求头），选「API Key」；大量第三方中转站要求 `ANTHROPIC_AUTH_TOKEN`（`Authorization: Bearer` 请求头），选「Auth Token」。具体看你的中转站文档，选错会连不上。Codex 只有 `OPENAI_API_KEY` 一种，无此选项。

### 编辑 / 删除 Provider

每个自定义 Provider 行右侧有「编辑」「删除」按钮（默认项无这两个按钮）。点「编辑」展开同样的表单，API Key 处可改选另一条已有密钥或新建一条（不动则沿用原 secretId 引用）。点「删除」直接移除（无二次确认）。

### 测试 Provider 连通性

每个自定义 Provider 右侧有「测试」按钮。点击后 AgentShell 用**真实引擎路径**（注入该 Provider 的环境变量，让 CLI 真实跑一句对话）来验证连通性。测试结果面板贴在被测项正下方：

- **✓ 连通成功**：显示请求信息（密钥已掩码）和模型回复内容
- **✗ 测试失败**：显示 HTTP 状态码和上游原始错误

> **注意**：测试走真实引擎路径，会产生实际 API 调用费用（约 $0.07/次，后续走缓存会更便宜）。

### 自定义 Provider 的模型列表

添加 Provider 时，可在表单里管理「该 Provider 支持的模型」：点「＋ 添加模型」输入模型 ID 和可选别名，点选某模型 chip 设为该 Provider 的默认模型。Provider 激活后，工作区里的模型选择范围就变成这个列表（不再是引擎官方列表）。

### 给某个上游来源绑定代理

每个「官方」登录来源（**授权登录**、**官网 API Key**）以及每个**自定义 Provider** 行上，都带一个「代理」下拉，可把该来源的登录 / 请求流量走指定代理：

- 下拉默认「直连」（不走代理）；选某个代理后，该来源的流量经此代理出网。改动立即生效。
- 下拉里的可选代理来自「设置 › 代理」子页的代理池——先去那建好代理，这里才能选到。
- **「使用本机 CLI 登录状态」（cli-login）永远没有代理下拉**：它复用本机 CLI 自己的登录与网络，AgentShell 不为它代理。
- 绑定是「按来源」记的：换不同来源各自记各自的代理；删除某个代理后，原来绑它的来源自动回落到「直连」。

> Codex 的「授权登录」已启用（走 codex 自管 ChatGPT 授权），可绑代理；「官网 API Key」当前禁用、不显示代理下拉。Codex 的自定义 Provider 仍可绑代理。

### 代理池（设置 › 代理子页）

「设置」第 4 个子页「代理」集中管理代理池：

- 列表每行显示代理名、`协议://[用户名:****@]主机:端口`、连通状态点和最近一次测试的延迟。
- **添加 / 编辑代理**：填名称、协议（http / https / socks5 / socks5h）、主机、端口，以及可选的用户名 / 密码。编辑时密码留空表示保留原密码。
- **测试**：点某代理的「测试」按钮，AgentShell 实测连通并回填延迟（成功显示 `xxx ms`，失败显示「失败」）。
- **删除**：直接移除（绑定了它的来源会自动回落直连）。

---

## 三、核心语义：作用域隔离

**在 AgentShell 里切换 Provider，效果严格限制在 AgentShell 内部，绝对不会影响你在其他地方（VS Code、终端）用的 Claude Code 或 Codex。**

典型场景举例：你在 AgentShell 里把 Claude Code 的当前 Provider 设成某个中转站，同时在 VS Code 里开着 Claude Code 走官方账号——两边各用各的上游，同时运行，互不干扰。

**隔离机制（双向）**：

- **AgentShell → 外部：不外泄**。AgentShell 只在它自己派生的引擎子进程上注入环境变量，**从不改写 `~/.claude/settings.json` 或任何全局共享配置文件**。你在 VS Code / 终端里的 Claude Code 读的还是它自己那套，完全不受影响。
- **外部 → AgentShell：不渗入**。AgentShell 默认会剥除从系统 shell 继承来的凭证环境变量（Claude：`ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN`；Codex：`OPENAI_API_KEY` / `OPENAI_BASE_URL`），防止你 shell 里已设的 env 悄悄渗进 AgentShell 的运行。只有当你在 AgentShell 里显式选了某个自定义 Provider，才会注入那套凭证（Codex 的上游地址走 `-c` 覆盖、不改你的 `~/.codex`）。

这与「CC Switch 改写全局配置、全局生效」是本质不同的两条路。

---

## 四、密钥安全

- **密钥不进渲染进程**：设置页只显示掩码；用户新填/改密钥时才把明文传给后台写盘。
- **存储路径**：凭证存在独立的 `~/.agent-shell/providers.json`（dev 渠道为 `~/.agent-shell-dev/providers.json`），权限 0600，与主数据库分离。
- **Codex Provider**：Codex 的自定义 Provider 注入已落地——上游地址 + `wire_api` 经 codex `-c model_provider` / `-c model_providers.<名>` 启动覆盖注入（进程级、不写 `~/.codex/config.toml`），密钥经 `OPENAI_API_KEY` 环境变量注入。「默认」则复用本机 `~/.codex`（含你已配的 model_provider / 登录）。

---

## 五、工作区里临时切换

工作区内有两个快捷入口，不用进设置页就能调整当前会话的引擎和模型。详细布局见「工作区」一节，这里只说体系含义：

- **proj-bar 的 runtime chip（RuntimeSwitcher）**：点击弹出代理选择网格，可在 Claude Code / Codex 之间切换当前会话的引擎；下方下拉列表选该引擎当前可用的模型。
- **composer 的 ModelPill（模型胶囊）**：点击弹出配置面板，内含：
  - **权限档**（Claude Code）：5 个档位——「改动前都问」「自动编辑」「计划模式」「自动模式」「绕过权限」
  - **审批策略 + 沙箱级别**（Codex）：审批策略（仅受信命令 / 按需询问 / 从不询问）+ 沙箱级别（只读 / 工作区可写 / 完全访问）
  - **Effort（思考强度）**：Claude Code 有 5 档（低 / 中 / 高 / 极高 / 最大）；Codex 有 5 档（最小 / 低 / 中 / 高 / 极高）
  - **模型**：Claude Code 模型折叠显示当前项，点右箭头展开 flyout；Codex 模型平铺列全部
  - 面板顶部有过滤框，直接打字可实时过滤所有选项

以上切换只改当前会话的前端状态，不影响其他会话，也不影响设置页里的全局默认值。
