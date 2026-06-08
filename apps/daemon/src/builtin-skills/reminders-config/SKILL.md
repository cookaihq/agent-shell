---
name: reminders-config
description: 当用户想配置「会话需要介入/完成/失败时怎么提醒」（声音/通知渠道/外部 webhook 等）时使用——直接读写项目内 .agent-shell/reminders.json
autoInject: true
---

# 提醒配置

项目级提醒配置存在 **`<项目根>/.agent-shell/reminders.json`**（Agent 的 cwd 就是项目目录，可以直接用文件工具读写）。改完**实时生效**，无需重开会话。

---

## 文件结构（version 1）

```json
{
  "version": 1,
  "enabled": true,
  "events": {
    "attention": {
      "channels": ["inapp"],
      "sound": { "kind": "system", "id": "default" }
    },
    "complete": {
      "channels": ["inapp"],
      "sound": { "kind": "system", "id": "default" }
    },
    "failed": {
      "channels": ["inapp", "audio"],
      "sound": { "kind": "system", "id": "alert" }
    }
  },
  "external": {
    "webhook": { "enabled": false, "secretRef": null },
    "feishu":  { "enabled": false, "secretRef": null }
  }
}
```

### 顶层字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `version` | 整数 | 固定为 `1` |
| `enabled` | 布尔 | 总开关；`false` 时所有提醒静默 |

### 三个事件（`events.*`）

| 事件键 | 触发时机 |
|--------|---------|
| `attention` | agent 需要授权或等待用户回答时 |
| `complete` | 一轮任务成功跑完时 |
| `failed` | agent 报错、超时或崩溃时 |

每个事件下有两个字段：

**`channels`**（数组）：可组合，元素取值：

- `"inapp"` — 应用内通知（弹出通知中心），**不受失焦限制**，窗口在前台也触发
- `"audio"` — 播放声音，**仅在 app 窗口失焦时触发**
- `"system"` — 系统级通知（macOS 通知中心），**仅在 app 窗口失焦时触发**

**`sound`**（对象）：指定音效来源：

- 系统预设：`{ "kind": "system", "id": "<id>" }`，`id` 可选 `default` / `crisp` / `alert` / `chime`
- 用户上传：`{ "kind": "uploaded", "file": ".agent-shell/sounds/<文件名>" }`

### 外部渠道（`external.*`）

webhook 和飞书各有两个字段：`enabled`（布尔）和 `secretRef`（字符串或 null）。

**重要**：webhook URL、飞书签名密钥等**不要写进这个 JSON 文件**——它可能随项目目录被分享或纳入版本控制。连接信息请到 AgentShell「设置 › 密钥管理」里存为命名密钥，`secretRef` 只放密钥名称引用（例如 `"my-webhook-key"`）。

---

## 常见修改示例

**场景 1：任务完成时也播放声音**

把 `events.complete.channels` 加上 `"audio"`：

```json
"complete": {
  "channels": ["inapp", "audio"],
  "sound": { "kind": "system", "id": "crisp" }
}
```

**场景 2：失败时用系统通知 + 响铃声**

```json
"failed": {
  "channels": ["inapp", "system", "audio"],
  "sound": { "kind": "system", "id": "alert" }
}
```

**场景 3：关掉所有提醒**

把顶层 `enabled` 设为 `false`：

```json
{ "version": 1, "enabled": false, ... }
```

---

## 注意事项

- `audio` 和 `system` 渠道**仅在 app 窗口失焦时**才会触发；`inapp` 不受此限，始终可见。
- 如果文件不存在，AgentShell 会以默认配置启动，第一次修改时由 Agent 创建该文件即可。
- 外部渠道（webhook / 飞书）的连接配置须在 AgentShell UI 的「提醒设置」里填写，不要在此 JSON 里存明文 URL 或 token。
