import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase } from '../database'
import { createProject, getProject } from '../projects'
import { createSession, getSession } from '../sessions'
import { recordUsage, getUsage } from '../usage'

/** 盘持久化回归网：其余单测都用 :memory:，这里用真文件验证 close→reopen 数据不丢、
 *  以及 openDatabase 对缺失目录做 mkdir recursive。CI 安全（os.tmpdir 临时文件 + 兜底清理）。 */
describe('真文件库持久化（close → reopen）', () => {
  let dir = ''
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
    dir = ''
  })

  it('openDatabase 对缺失父目录做 mkdir recursive，文件真落盘', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentshell-persist-'))
    const dbPath = path.join(dir, 'nested', 'sub', 'app.sqlite') // 故意带未创建的多层子目录
    const db = openDatabase(dbPath)
    db.close()
    expect(fs.existsSync(dbPath)).toBe(true)
  })

  it('写入后关库、重开同一文件 → 项目/会话/用量全部读回', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentshell-persist-'))
    const dbPath = path.join(dir, 'app.sqlite')

    // 第一次：开库、写数据、关库
    let db = openDatabase(dbPath)
    const proj = createProject(db, { name: '持久化测试', path: '/p' })
    const s = createSession(db, { projectId: proj.id, engine: 'codex', model: 'gpt-5.5', title: '初稿' })
    recordUsage(db, { sessionId: s.id, turn: 1, inputTokens: 10, outputTokens: 3, costUsd: 0.001 })
    db.close()

    // 第二次：重开同一文件 → 数据还在
    db = openDatabase(dbPath)
    try {
      expect(getProject(db, proj.id)).toMatchObject({ id: proj.id, name: '持久化测试', path: '/p' })
      expect(getSession(db, s.id)).toMatchObject({ id: s.id, projectId: proj.id, engine: 'codex', title: '初稿' })
      expect(getUsage(db, s.id)[0]).toMatchObject({ turn: 1, inputTokens: 10, outputTokens: 3, costUsd: 0.001 })
    } finally {
      db.close()
    }
  })
})
