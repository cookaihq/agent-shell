import { describe, it, expect } from 'vitest'
import { openDatabase } from '../database'
import { getRuntime, upsertRuntime, setEnabled, setNextRunAt, deleteRuntime, listRuntime } from '../automationRuntime'

describe('automationRuntime', () => {
  it('upsert + get：默认 enabled，next_run_at 可空', () => {
    const db = openDatabase(':memory:')
    upsertRuntime(db, 'mon', { enabled: true })
    const r = getRuntime(db, 'mon')!
    expect(r).toMatchObject({ id: 'mon', enabled: true, nextRunAt: null })
    db.close()
  })

  it('setEnabled / setNextRunAt 落地', () => {
    const db = openDatabase(':memory:')
    upsertRuntime(db, 'mon', { enabled: true })
    setNextRunAt(db, 'mon', 12345)
    setEnabled(db, 'mon', false)
    const r = getRuntime(db, 'mon')!
    expect(r.nextRunAt).toBe(12345)
    expect(r.enabled).toBe(false)
    db.close()
  })

  it('get 缺失 → undefined；delete 后消失；list 返回全部', () => {
    const db = openDatabase(':memory:')
    expect(getRuntime(db, 'none')).toBeUndefined()
    upsertRuntime(db, 'a', { enabled: true })
    upsertRuntime(db, 'b', { enabled: false })
    expect(listRuntime(db).map((r) => r.id).sort()).toEqual(['a', 'b'])
    deleteRuntime(db, 'a')
    expect(getRuntime(db, 'a')).toBeUndefined()
    db.close()
  })
})
