import { describe, it, expect } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { openDatabase } from '../../db/database'
import { makeAutomationStore } from '../automationStore'
import { materializeBuiltinAutomations } from '../builtinAutomations'

function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'btauto-'))
  const builtinDir = path.join(root, 'builtin')
  const autoDir = path.join(root, 'lib')
  fs.mkdirSync(autoDir, { recursive: true })
  // 内置任务：gsp 文件夹含 AUTOMATION.md + scan.mjs
  const gsp = path.join(builtinDir, 'gsp'); fs.mkdirSync(gsp, { recursive: true })
  fs.writeFileSync(path.join(gsp, 'AUTOMATION.md'),
    '---\nname: 全局 skill 处理\nengine: claude\nmodel: opus\npermission: bypassPermissions\nexecutor: script\nscript: scan.mjs\ntriggers:\n  - kind: startup\ntarget:\n  mode: create_each_run\n---\n正文\n')
  fs.writeFileSync(path.join(gsp, 'scan.mjs'), 'process.exit(0)')
  const db = openDatabase(':memory:')
  const store = makeAutomationStore({ db, automationsDir: () => autoDir })
  return { root, builtinDir, autoDir, db, store, cleanup: () => { db.close(); fs.rmSync(root, { recursive: true, force: true }) } }
}

describe('materializeBuiltinAutomations', () => {
  it('把内置任务文件夹（含 AUTOMATION.md + 脚本）重拷进 automationsDir，store 可见', () => {
    const h = harness()
    materializeBuiltinAutomations(h.builtinDir, h.autoDir)
    expect(fs.existsSync(path.join(h.autoDir, 'gsp', 'AUTOMATION.md'))).toBe(true)
    expect(fs.existsSync(path.join(h.autoDir, 'gsp', 'scan.mjs'))).toBe(true)
    const row = h.store.get('gsp')!
    expect(row.name).toBe('全局 skill 处理')
    expect(row.executor).toBe('script')
    expect(row.enabled).toBe(true)   // 缺运行态行默认启用
    h.cleanup()
  })

  it('每启重拷：覆盖定义文件，但不动 DB 运行态（用户关掉的保持关）', () => {
    const h = harness()
    materializeBuiltinAutomations(h.builtinDir, h.autoDir)
    h.store.patch('gsp', { enabled: false })          // 用户手动关
    // app 更新：内置定义改了名
    fs.writeFileSync(path.join(h.builtinDir, 'gsp', 'AUTOMATION.md'),
      '---\nname: 全局 skill 处理 v2\nengine: claude\nmodel: opus\npermission: bypassPermissions\nexecutor: script\nscript: scan.mjs\ntriggers:\n  - kind: startup\ntarget:\n  mode: create_each_run\n---\n新正文\n')
    materializeBuiltinAutomations(h.builtinDir, h.autoDir)   // 二次启动重拷
    const row = h.store.get('gsp')!
    expect(row.name).toBe('全局 skill 处理 v2')   // 定义被刷新
    expect(row.enabled).toBe(false)                // 运行态仍是用户关掉的状态
    h.cleanup()
  })

  it('缺 builtinDir → no-op（不抛）', () => {
    const h = harness()
    expect(() => materializeBuiltinAutomations(path.join(h.root, 'nope'), h.autoDir)).not.toThrow()
    expect(h.store.list()).toEqual([])
    h.cleanup()
  })
})
