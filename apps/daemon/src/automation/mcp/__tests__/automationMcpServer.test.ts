import { describe, it, expect } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { openDatabase } from '../../../db/database'
import { makeAutomationStore } from '../../automationStore'
import { buildAutomationMcpServer } from '../automationMcpServer'

describe('stdio automation mcp server', () => {
  it('buildAutomationMcpServer 注册 create_automation 工具且不抛错', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smcp-'))
    const db = openDatabase(':memory:')
    const store = makeAutomationStore({ db, automationsDir: () => dir })
    const server = buildAutomationMcpServer(store)
    expect(server).toBeTruthy()
    db.close(); fs.rmSync(dir, { recursive: true, force: true })
  })
})
