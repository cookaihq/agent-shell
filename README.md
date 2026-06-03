# Agent Shell

基于 [Claude Code](https://claude.com/claude-code) / Codex CLI（headless 调用）的本地优先开源编码 agent 桌面客户端。Electron 壳 + 本地 daemon（Express，同源 serve 前端 UI），所有数据留在本机。

> **本仓库是发布镜像**：由上游私有开发仓按发布清单快照生成（不含设计/计划文档）。日常开发在上游进行。

## 技术栈

- **桌面壳**：Electron 41 主进程 spawn 本地 daemon 子进程（`ELECTRON_RUN_AS_NODE`），sidecar 发现 daemon URL，同源加载前端。
- **daemon**：Express + better-sqlite3（唯一原生模块），HMAC 风格 per-process token gate 防本地越权访问。
- **前端**：React 18 + Vite，由 daemon 同源 serve。
- **打包**：electron-builder（mac dmg/zip、win nsis），`asar:false`。
- pnpm monorepo + TypeScript（ESM）+ vitest。Node 24。

## 从源码构建

```bash
pnpm install
pnpm -C apps/renderer run build      # 前端产物 → apps/renderer/web-dist
pnpm run typecheck
pnpm run test

# 出包（产物在 apps/desktop/release/）
pnpm -C apps/desktop run pack:mac    # macOS：dmg + zip
pnpm -C apps/desktop run pack:win    # Windows：nsis
```

> macOS 包未签名（ad-hoc）：首次打开需右键 →「打开」绕过 Gatekeeper。
> Windows 上 better-sqlite3 无预编译二进制，`pnpm install` 会经 node-gyp 从源码编译（需 Visual Studio Build Tools 2022+）。

## 发布

推送 `v*` tag 触发 GitHub Actions（mac/win runner 构建 → Releases）。详见 `.github/workflows/release.yml`。

## 许可证

[GNU Affero General Public License v3.0](./LICENSE)（AGPL-3.0）。
