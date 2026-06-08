// codex app-server 协议版本治理（Part A）
//
// codex 的 app-server 协议是实验性的、无版本保证。agent-shell 只适配「确切测过」
// 的 codex 版本。当前 Part A 锁定唯一一个：0.137.0
// （= scripts/codex-appserver-protocol-check/baseline.txt 的基线 codex 版本）。
//
// 这里刻意用「确切版本集合」而非宽区间——「我们测过的就是这一个」才是诚实表述。
// 将来新增测过的版本时，只需在 TESTED_CODEX_VERSIONS 里加一行字符串即可。
export const TESTED_CODEX_VERSIONS: readonly string[] = ['0.137.0']

// 判断某个 codex 版本号是否在「已测试集合」内。
// version 为空（未检测到版本）时返回 false——交给调用方决定显不显示徽标。
export function isTestedCodexVersion(version: string | null | undefined): boolean {
  if (version == null) return false
  return TESTED_CODEX_VERSIONS.includes(version.trim())
}
