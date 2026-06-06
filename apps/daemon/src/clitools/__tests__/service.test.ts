import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { makeCliToolService } from '../service'
import { libraryManifestPath } from '../../paths'

let dir: string, skillsDir: string, toolsFile: string
let svc: ReturnType<typeof makeCliToolService>

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clit-'))
  skillsDir = path.join(dir, 'skills')
  toolsFile = path.join(dir, 'cli-tools.json')
  svc = makeCliToolService(() => skillsDir, toolsFile)
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const DEF = { name: 'yt-dlp', cmd: 'yt-dlp', tags: ['下载'], desc: 'd', install: 'brew install yt-dlp', home: 'https://x', usage: '下载视频：yt-dlp <url>', friendliness: 4, custom: false }

describe('cli tool service', () => {
  it('add 持久化 + 生成 SKILL.md 入库（manifest 登记，文件 0600）', () => {
    const saved = svc.add({ ...DEF, id: 'yt-dlp' })
    expect(saved.id).toBe('yt-dlp')
    // 持久化文件 + 权限
    expect((fs.statSync(toolsFile).mode & 0o777)).toBe(0o600)
    expect(svc.list().map(t => t.id)).toEqual(['yt-dlp'])
    // 生成的 SKILL.md（effectiveName = cli-<id>）
    const md = fs.readFileSync(path.join(skillsDir, 'cli-yt-dlp', 'SKILL.md'), 'utf8')
    expect(md).toContain('name: yt-dlp')
    expect(md).toContain('yt-dlp')          // cmd 出现在用法/安装
    // manifest 登记 → 可被注入选择器列出 / injectClaudeSkills 找到
    const m = JSON.parse(fs.readFileSync(libraryManifestPath(skillsDir), 'utf8')) as Record<string, { sourceId: string }>
    expect(m['cli-yt-dlp']).toBeTruthy()
    expect(m['cli-yt-dlp'].sourceId).toBe('cli-tools')
  })

  it('add 同 id 幂等', () => {
    svc.add({ ...DEF, id: 'yt-dlp' })
    svc.add({ ...DEF, id: 'yt-dlp' })
    expect(svc.list()).toHaveLength(1)
  })

  it('add 自定义无 id → daemon 生成 id', () => {
    const saved = svc.add({ ...DEF, name: 'Pandoc', cmd: 'pandoc', custom: true })
    expect(saved.id).toBeTruthy()
    expect(fs.existsSync(path.join(skillsDir, `cli-${saved.id}`, 'SKILL.md'))).toBe(true)
  })

  it('remove 出库 + 删 SKILL.md 目录 + manifest 条目', () => {
    svc.add({ ...DEF, id: 'yt-dlp' })
    svc.remove('yt-dlp')
    expect(svc.list()).toEqual([])
    expect(fs.existsSync(path.join(skillsDir, 'cli-yt-dlp'))).toBe(false)
    const m = JSON.parse(fs.readFileSync(libraryManifestPath(skillsDir), 'utf8')) as Record<string, unknown>
    expect(m['cli-yt-dlp']).toBeUndefined()
  })

  it('detect 对每个名字返回路径或 null（不存在的命令为 null）', () => {
    const out = svc.detect(['definitely-not-a-real-cmd-xyz'])
    expect(out).toHaveProperty('definitely-not-a-real-cmd-xyz')
    expect(out['definitely-not-a-real-cmd-xyz']).toBeNull()
  })
})
