import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { startDaemon, type DaemonServer } from '../../server'
import { openDatabase } from '../../db/database'
import { parseAutomationMd } from '../automationFile'
import type { AutomationScheduler } from '../scheduler'

// 真实内置任务目录（从 worktree 根解析；pnpm test 自根运行）
const REAL_BUILTIN = path.join(process.cwd(), 'apps/daemon/src/builtin-automations')

let server: DaemonServer | null = null
let tmp: string, autoDir: string
afterEach(async () => {
  if (server) await server.close(); server = null
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
  if (autoDir) fs.rmSync(autoDir, { recursive: true, force: true })
})

class FakeScheduler {
  setRunHandler() {}; armAll() {}; reschedule() {}; cancel() {}
  runNow() { return Promise.resolve() }; stop() {}
}

describe('builtin automation 真实任务 + server 接线', () => {
  it('真实内置任务「全局 skill 处理」AUTOMATION.md 可解析、形态正确', () => {
    const md = fs.readFileSync(path.join(REAL_BUILTIN, 'global-skill-processing', 'AUTOMATION.md'), 'utf8')
    const { frontmatter } = parseAutomationMd(md)
    expect(frontmatter.name).toBe('全局 skill 处理')
    expect(frontmatter.executor).toBe('script')
    expect(frontmatter.script).toBe('scan.mjs')
    expect(frontmatter.triggers).toEqual([
      { kind: 'startup' },
      { kind: 'daily', time: '10:00', timezone: 'Asia/Shanghai' },
    ])
  })

  it('startDaemon 经 builtinAutomationsDir 启动 materialize → GET /automations 含内置任务', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-bta-proj-'))
    autoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-bta-lib-'))
    const scheduler = new FakeScheduler()
    server = await startDaemon({
      detect: () => ({ claude: '/x/claude', codex: '/x/codex' }),
      db: openDatabase(':memory:'), projectsDir: tmp, automationsDir: autoDir,
      builtinAutomationsDir: REAL_BUILTIN,
      scheduler: scheduler as unknown as AutomationScheduler,
    })
    // materialize 把内置任务定义重拷进 autoDir
    expect(fs.existsSync(path.join(autoDir, 'global-skill-processing', 'AUTOMATION.md'))).toBe(true)
    const j = await (await fetch(server.url + '/automations')).json() as { automations: Array<{ name: string; executor: string }> }
    const gsp = j.automations.find((a) => a.name === '全局 skill 处理')!
    expect(gsp).toBeTruthy()
    expect(gsp.executor).toBe('script')
  })
})
