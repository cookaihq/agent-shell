import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 隔离铁律机器守卫（spec §14.5）：对话区外壳层（workspace/，排除 agents/ 切片目录与测试）
 * 禁止出现「按引擎字面名分支」——即 `engine === 'claude'` / `agent === 'codex'` 这类决定行为的硬分支。
 * 一律走 `SLICES[engine].xxx()`（renderer）或判别式 `run.kind`（daemon）。切片实现（agents/{id}/）天然豁免。
 *
 * 注意：只匹配 LHS 为 engine/agent 的字面比较，**不**匹配判别式 `run.kind === 'claude'`（kind 值恰好同名但属合法判别）。
 * 个别必要的「engine→判别式构造工厂」可在该行加注释标记 `agent-literal-ok` 豁免。
 */
const SHELL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const AGENT_LITERAL = /(\b|\.)(engine|agent)\s*(===|!==)\s*['"](claude|codex)['"]/

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'agents' || entry.name === '__tests__') continue // 切片目录 + 测试豁免
      out.push(...walk(full))
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

describe('isolation guard — 对话区外壳层零字面 agent 分支（spec §14.5/§11#2）', () => {
  it('workspace/（排除 agents/ 切片 + 测试）无 engine/agent === 字面分支', () => {
    const offenders: string[] = []
    for (const file of walk(SHELL_DIR)) {
      const lines = fs.readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (line.includes('agent-literal-ok')) return // 显式豁免标记
        if (AGENT_LITERAL.test(line)) offenders.push(`${path.relative(SHELL_DIR, file)}:${i + 1}  ${line.trim()}`)
      })
    }
    expect(offenders, `外壳层出现字面 agent 分支（应走 SLICES[engine] 或 run.kind）：\n${offenders.join('\n')}`).toEqual([])
  })
})
