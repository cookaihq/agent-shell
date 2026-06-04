/**
 * i18n shim —— 仅为 vendored 的 runtime/markdown.tsx 提供它依赖的 `useT`。
 *
 * markdown.tsx 是从 open-design 整文件 verbatim 复用的（见 runtime/VENDORED.md），
 * 那边的 `useT()` 返回一个 `t(key)` 文案翻译函数。agent-shell 目前没有 i18n 体系，
 * 这里用最小实现把 markdown.tsx 实际用到的两个 key 翻成中文即可。
 *
 * ⚠️ 如果将来同步上游 markdown.tsx 后 typecheck 报「缺某个文案 key」，
 *    说明上游新增了 t('...') 调用——在 LABELS 里补上对应中文即可。
 */
const LABELS: Record<string, string> = {
  'fileViewer.copied': '已复制',
  'fileViewer.copy': '复制',
}

export function useT(): (key: string) => string {
  return (key: string) => LABELS[key] ?? key
}
