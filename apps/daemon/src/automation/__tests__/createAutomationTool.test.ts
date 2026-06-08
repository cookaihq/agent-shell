import { describe, it, expect } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { openDatabase } from '../../db/database'
import { makeAutomationStore } from '../automationStore'
import { createAutomationToolHandler } from '../createAutomationTool'

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-'))
  const db = openDatabase(':memory:')
  const store = makeAutomationStore({ db, automationsDir: () => dir })
  return { dir, db, store, cleanup: () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}

describe('createAutomationToolHandler', () => {
  it('合法入参（多触发器含 startup + executor:agent + requires）→ 建任务，返回成功文本 + id', async () => {
    const s = setup()
    const res = await createAutomationToolHandler({
      name: '每日简报', prompt: '抓数据', engine: 'claude', model: 'opus', permission: 'bypassPermissions',
      category: ['运营', '监控'], tags: ['实验性'],
      triggers: [{ kind: 'startup' }, { kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' }],
      executor: 'agent',
      requires: [{ kind: 'env', name: 'COMPETITOR_API_KEY' }],
      target: { mode: 'create_each_run' },
    }, { store: s.store })
    expect(res.isError).toBeFalsy()
    expect(res.content[0].text).toContain('每日简报')
    expect(s.store.list()).toHaveLength(1)
    s.cleanup()
  })

  it('合法入参（executor:script + 脚本入口）→ 建任务', async () => {
    const s = setup()
    const res = await createAutomationToolHandler({
      name: '全局技能扫描', prompt: '扫描', engine: 'claude', model: 'opus', permission: 'bypassPermissions',
      triggers: [{ kind: 'startup' }], executor: 'script', script: 'scan.mjs', interpreter: 'node',
      target: { mode: 'create_each_run' },
    }, { store: s.store })
    expect(res.isError).toBeFalsy()
    expect(s.store.list()).toHaveLength(1)
    s.cleanup()
  })

  it('非法入参（空 triggers）→ isError + 不建任务', async () => {
    const s = setup()
    const res = await createAutomationToolHandler({ name: 'x', prompt: 'y', engine: 'claude', model: 'opus', permission: 'bypassPermissions', triggers: [], target: { mode: 'create_each_run' } } as never, { store: s.store })
    expect(res.isError).toBe(true)
    expect(s.store.list()).toHaveLength(0)
    s.cleanup()
  })

  it('非法权限档（claude 用 codex 沙箱名）→ isError', async () => {
    const s = setup()
    const res = await createAutomationToolHandler({
      name: 'x', prompt: 'y', engine: 'claude', model: 'opus', permission: 'workspace-write',
      triggers: [{ kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' }], target: { mode: 'create_each_run' },
    } as never, { store: s.store })
    expect(res.isError).toBe(true)
    s.cleanup()
  })
})
