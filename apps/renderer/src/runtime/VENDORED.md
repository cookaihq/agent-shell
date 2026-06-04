# Vendored from open-design（verbatim，请勿手改）

本目录的 `markdown.tsx` 是从参考实现 [nexu-io/open-design](https://github.com/nexu-io/open-design) **整文件逐字节复用**的聊天 Markdown 渲染器，配合若干 shim / 同步移植文件一起工作。

## 同步基准

| 项 | 值 |
|---|---|
| 上游文件 | `apps/web/src/runtime/markdown.tsx` |
| 同步基准 commit | `d599699787d9a0dcc2bfa832672b58ef2cc193c5` |
| 同步日期 | 2026-06-03 |

## 文件清单

| 本仓文件 | 来源 / 角色 |
|---|---|
| `apps/renderer/src/runtime/markdown.tsx` | **verbatim** 复用上游同名文件（一字不改） |
| `apps/renderer/src/lib/copy-to-clipboard.ts` | **verbatim** 复用上游 `apps/web/src/lib/copy-to-clipboard.ts` |
| `apps/renderer/src/i18n.ts` | **shim**（非上游文件）：给 markdown.tsx 的 `useT` 提供最小实现 |
| `apps/renderer/src/styles/markdown.css` | 上游 `apps/web/src/styles/viewer/code.css` 的 `.prose-block` / `.md-*` 段移植 |

## 为什么这样放

markdown.tsx 用相对路径 `import { useT } from '../i18n'` 和 `import { copyToClipboard } from '../lib/copy-to-clipboard'`。把它放在 `runtime/` 下、并在 `../i18n`、`../lib/copy-to-clipboard` 提供同名模块，就能让上游文件**一字不改**地解析通过——这样将来再同步只需「覆盖 markdown.tsx 一个文件」。

## 更新规则

- **禁止直接编辑 `markdown.tsx`**（编辑会让它偏离上游，再同步时产生伪冲突）。
- 每周由 `.claude/settings.json` 的 SessionStart hook 跑 `scripts/check-open-design-markdown.mjs`，对比上游与本仓 vendored 文件；若有差异**只通知**，不自动覆盖。
- 收到「上游有更新」通知后的同步步骤：
  1. `cp tmp/open-design/apps/web/src/runtime/markdown.tsx apps/renderer/src/runtime/markdown.tsx`
  2. 跑 `pnpm -C apps/renderer build`（typecheck）——若报缺某个文案 key，去 `apps/renderer/src/i18n.ts` 的 `LABELS` 补中文；若报缺别的依赖，按需补 shim。
  3. 顺手把上游 `code.css` 的 `.prose-block`/`.md-*` 段重新提取覆盖 `styles/markdown.css`。
  4. 更新本文件的「同步基准 commit / 日期」。
