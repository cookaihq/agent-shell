# `~/.claude` 凭证格式探测固化（claude 登录检测依据）

> 探测时间：2026-06-07，本机 macOS（darwin-arm64）。**只读探测，未改任何全局文件。**
> 用途：`claudeLoginDetect.ts` 据此判断本机 claude 是否登录 + 登录方式（OAuth 订阅 / API Key）。

## 关键结论（代码可用形状）

claude 在 **macOS 上不写 `~/.claude/.credentials.json`**，而是把凭证存进 **macOS 钥匙串（Keychain）**。非 macOS（Linux/Windows）才落地为 `~/.claude/.credentials.json`（同 JSON 形状）。两者的 JSON 结构一致，差别只在「从哪读」。

### 凭证存储位置

| 平台 | 位置 | 读法 |
|------|------|------|
| macOS（本机已验证） | Keychain，service=`Claude Code-credentials`，account=OS 用户名（`os.userInfo().username`） | `security find-generic-password -s "Claude Code-credentials" -w` → 输出即凭证 JSON 字符串 |
| Linux / Windows（未在本机验证，按 claude 既有约定） | `~/.claude/.credentials.json` | 直接读文件 |

### 凭证 JSON 结构（本机 Keychain 实测，已脱敏）

```jsonc
{
  "claudeAiOauth": {
    "accessToken": "sk-ant-oat...",   // str，~108 字符
    "refreshToken": "sk-ant-ort...",  // str，~108 字符
    "expiresAt": 1780851325787,        // number，毫秒时间戳
    "scopes": ["user:file_upload", "user:inference", "user:mcp_servers", "user:profile", "user:sessions:claude_code"],
    "subscriptionType": "max",         // str：订阅类型（max/pro/...）
    "rateLimitTier": "default..."      // str
  },
  "organizationUuid": "a561bc..."      // str，UUID
}
```

## 判据（写死成代码用的形状）

输入：凭证 JSON（macOS 来自 keychain blob，其他平台来自 `.credentials.json` 内容），解析为对象后：

1. **OAuth 订阅登录** → `parsed.claudeAiOauth.accessToken` 存在（truthy）
   → `{ status: 'signed-in', method: 'oauth', email: <见下> }`
2. **API Key 登录** → 无 `claudeAiOauth.accessToken`，但存在顶层 `parsed.apiKey`（字符串）
   → `{ status: 'signed-in', method: 'api_key' }`
   - ⚠️ **本机未观测到 api_key 形态**（本机是 OAuth）。`apiKey` 顶层字段是按 claude `.credentials.json` 既有约定推断的防御分支，**非本机实测**。若后续在真机遇到 api_key 凭证发现字段名不同，按实测改判据。
3. **未登录** → 无凭证（keychain 查不到 / 文件不存在 / JSON 解析失败 / 既无 oauth 又无 apiKey）
   → `{ status: 'signed-out' }`

## email 字段

- 本机 Keychain 的 `claudeAiOauth` **没有 email 字段**（只有 token/scopes/subscriptionType/organizationUuid）。
- 因此 OAuth 登录态的 `email` **本地无法取得，固定为 `undefined`**（UI 显示「已登录 · 订阅」而非具体邮箱）。
- 真正的 email 只能在 OAuth 换 token 时从 `account.email_address` 拿到（见 Phase 4 OAuth 流程），那是另一条路径，不走本检测。

## 对实现的影响（给 claudeLoginDetect.ts）

- **纯函数 `detectClaudeLoginFromFiles(files)`** 形状不变：接受 `{ '.credentials.json': <JSON字符串> }` map，按上面判据判定。keychain 内容塞进同一个 key 即可复用（同 JSON 形状）。
- **薄封装 `detectClaudeLogin(home?)`** 必须分平台：
  - macOS：先尝试 `security find-generic-password -s "Claude Code-credentials" -w`（同步 `execFileSync`，失败/为空则视为未登录），把输出当作 `.credentials.json` 内容喂给纯函数。
  - 其他平台：读 `~/.claude/.credentials.json`。
  - 任一读取异常都吞掉 → `signed-out`（检测绝不能抛）。
