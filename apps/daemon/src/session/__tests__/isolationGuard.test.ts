import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 隔离铁律机器守卫（spec §14.5/§11#2）：daemon SessionRuntime 编排层禁止按引擎字面名分支。
 * 一律走判别式 `run.kind`（make illegal states unrepresentable）。唯一例外是「engine→run.kind 构造工厂」，
 * 那一行加注释标记 `agent-literal-ok` 显式豁免。
 *
 * 只匹配 LHS 为 engine 的字面比较（`st.engine === 'claude'` 等），**不**匹配 `run.kind === 'claude'`（合法判别）。
 */
const RUNTIME_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../sessionRuntime.ts')
const AGENT_LITERAL = /(\b|\.)engine\s*(===|!==)\s*['"](claude|codex)['"]/

describe('isolation guard — daemon SessionRuntime 编排零引擎字面分支（spec §14.5/§11#2）', () => {
  it('sessionRuntime.ts 无 engine === 字面分支（构造工厂经 agent-literal-ok 豁免）', () => {
    const offenders: string[] = []
    const lines = fs.readFileSync(RUNTIME_FILE, 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (line.includes('agent-literal-ok')) return
      if (AGENT_LITERAL.test(line)) offenders.push(`sessionRuntime.ts:${i + 1}  ${line.trim()}`)
    })
    expect(offenders, `SessionRuntime 出现引擎字面分支（应走 run.kind）：\n${offenders.join('\n')}`).toEqual([])
  })
})
