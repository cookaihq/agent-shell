import { describe, it, expect } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { openDatabase } from '../../db/database'
import { makeAutomationStore, type CreateAutomationInput } from '../automationStore'

function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autos-'))
  const db = openDatabase(':memory:')
  const store = makeAutomationStore({ db, automationsDir: () => dir })
  return { dir, db, store, close: () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}
const input = (over: Partial<CreateAutomationInput> = {}): CreateAutomationInput => ({
  name: '每日监控', prompt: '抓数据', engine: 'claude', model: 'opus', permission: 'bypassPermissions',
  category: ['监控'], tags: [], requires: [],
  triggers: [{ kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' }],
  executor: 'agent', target: { mode: 'create_each_run' }, enabled: true, ...over,
})

describe('automationStore', () => {
  it('create 写出文件夹 + AUTOMATION.md + 运行态行，id=文件夹名', () => {
    const h = harness()
    const a = h.store.create(input())
    expect(fs.existsSync(path.join(h.dir, a.id, 'AUTOMATION.md'))).toBe(true)
    expect(a.name).toBe('每日监控')
    expect(a.enabled).toBe(true)
    expect(a.nextRunAt).toBe(null)
    h.close()
  })

  it('list / get 合并文件定义 + 运行态', () => {
    const h = harness()
    const a = h.store.create(input({ name: '周报' }))
    const got = h.store.get(a.id)!
    expect(got.name).toBe('周报')
    expect(got.triggers[0].kind).toBe('daily')
    expect(h.store.list().map((x) => x.id)).toEqual([a.id])
    h.close()
  })

  it('patch 改定义重写文件、改 enabled 写 DB；改名不改 id', () => {
    const h = harness()
    const a = h.store.create(input({ name: '旧名' }))
    const p = h.store.patch(a.id, { name: '新名', enabled: false })!
    expect(p.id).toBe(a.id)          // 文件夹名（id）不变
    expect(p.name).toBe('新名')      // 文件 frontmatter 改了
    expect(p.enabled).toBe(false)    // 运行态改了
    expect(h.store.get(a.id)!.name).toBe('新名')
    h.close()
  })

  it('listEnabled 只返回 enabled', () => {
    const h = harness()
    h.store.create(input({ name: 'on' }))
    const off = h.store.create(input({ name: 'off' }))
    h.store.patch(off.id, { enabled: false })
    expect(h.store.listEnabled().map((x) => x.name)).toEqual(['on'])
    h.close()
  })

  it('delete 删文件夹 + 运行态 + runs', () => {
    const h = harness()
    const a = h.store.create(input())
    expect(h.store.delete(a.id)).toBe(true)
    expect(fs.existsSync(path.join(h.dir, a.id))).toBe(false)
    expect(h.store.get(a.id)).toBeUndefined()
    h.close()
  })

  it('缺运行态行的文件夹（外部导入）默认 enabled=true', () => {
    const h = harness()
    // 手动放一个 AUTOMATION.md，不建运行态行；含 startup + hourly 双触发器
    const folder = path.join(h.dir, 'imported'); fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, 'AUTOMATION.md'),
      `---\nname: 导入的\nengine: claude\nmodel: opus\npermission: bypassPermissions\ntriggers:\n  - kind: startup\n  - kind: hourly\n    minute: 30\ntarget:\n  mode: create_each_run\n---\n指令\n`)
    const got = h.store.get('imported')!
    expect(got.enabled).toBe(true)
    expect(got.triggers).toEqual([{ kind: 'startup' }, { kind: 'hourly', minute: 30 }])
    h.close()
  })
})
