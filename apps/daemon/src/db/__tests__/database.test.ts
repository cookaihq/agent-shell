import { describe, it, expect, afterEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, defaultDbPath } from '../database'
import { initSchema } from '../schema'

describe('openDatabase', () => {
  it(':memory: 开库后三张表已建', () => {
    const db = openDatabase(':memory:')
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r: any) => r.name)
    for (const t of ['projects', 'sessions', 'usage']) expect(names).toContain(t)
    expect(names).not.toContain('messages')
    db.close()
  })

  it('initSchema 幂等：在已建库上再跑一次不抛、表数不变（IF NOT EXISTS）', () => {
    const db = openDatabase(':memory:')   // openDatabase 内已建过一次
    const count = () => db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get() as { n: number }
    const before = count().n
    expect(() => initSchema(db)).not.toThrow()   // 真正再跑一次建表
    expect(count().n).toBe(before)               // 表数不变，无重复建表/报错
    db.close()
  })
})

describe('defaultDbPath（渠道数据目录）', () => {
  afterEach(() => { delete process.env.AGENT_SHELL_DATA_DIR })

  it('未设 AGENT_SHELL_DATA_DIR → 缺省 ~/.agent-shell/app.sqlite', () => {
    delete process.env.AGENT_SHELL_DATA_DIR
    expect(defaultDbPath()).toBe(path.join(os.homedir(), '.agent-shell', 'app.sqlite'))
  })

  it('设 AGENT_SHELL_DATA_DIR=.agent-shell-dev → ~/.agent-shell-dev/app.sqlite', () => {
    process.env.AGENT_SHELL_DATA_DIR = '.agent-shell-dev'
    expect(defaultDbPath()).toBe(path.join(os.homedir(), '.agent-shell-dev', 'app.sqlite'))
  })
})
