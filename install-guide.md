# Agent Shell 推荐安装说明（给 Agent）

你将收到一段引导提示词，要求你按本说明 + 推荐清单（recommendations.md）把清单里**尚未安装**的推荐装好并注册进 Agent Shell。原则：装到能用、幂等、双引擎可用、装不动明确告知。

## 步骤

1. **先读清单**：拉取 recommendations.md，逐条看要装什么、各属于 skill / mcp / cli / GitHub 项目里的哪种。
2. **幂等自查（先查再装，装过跳过）**：
   - 技能：用技能库相关工具/已注册源判断该源是否已在库；已在则跳过。
   - MCP：已注册的 server 跳过（按名）。
   - CLI：调 `as_cli_list` 看目录与本机已装、各自 id；已装跳过。
3. **按类型安装并注册**：
   - **技能源（git，长期使用）** → `as_add_source`（整源注册进库）；一次性技能可用 `as_install_skill`。装完读 SKILL.md 判断是否需要密钥；需要则 `as_request_secret`（弹安全框让用户填，不回明文）。
   - **MCP** → `as_register_mcp`（stdio 传 command/args/env；http 传 url/bearerToken；自定义 headers 的 http 仅 Claude 生效，如实说明）。MCP 不展开 `${VAR}`，凭证要实际值——缺就在对话里问用户要。
   - **命令行工具** → 命中目录且未装：`as_cli_install(id)`；本机已装/给了绝对路径：`as_cli_add(binPath, name, description)`；目录外且没装：自己用合适包管理器（brew/npm/pipx，走 Bash）装好再 `as_cli_add`。
   - **GitHub 项目（异构，如 hyperframes）** → 先把它装好（npx/全局装），再把它内含的 skill / mcp / cli 分别按上面三条注册；附带系统依赖（如 FFmpeg）尽力 `brew install`。
4. **系统依赖兜底**：尽力装；装不动（无 brew / 要 sudo / 跨平台差异）就在对话里**明确告知缺什么、怎么补**，不静默失败。
5. **双引擎**：凡注册成 skill/mcp/cli 的，确保 Claude 与 Codex 都能用。
6. **完事汇报**：装了哪些、跳过哪些（已装）、哪些没装成及原因。不要打印明文密钥。
