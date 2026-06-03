import { describe, it, expect } from 'vitest'
import { openDatabase } from '../database'
import { initSchema } from '../schema'

describe('openDatabase', () => {
  it(':memory: 开库后四张表已建', () => {
    const db = openDatabase(':memory:')
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r: any) => r.name)
    for (const t of ['projects', 'sessions', 'messages', 'usage']) expect(names).toContain(t)
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
