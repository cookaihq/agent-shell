import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { makeSkillService } from '../service'

let dir: string
const setup = () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'))
  const sourcesFile = path.join(dir, 'skill-sources.json')
  const groupsFile = path.join(dir, 'skill-groups.json')
  const skillsDir = path.join(dir, 'skills')
  const cacheRoot = path.join(dir, 'cache')
  const srcLoc = path.join(dir, 'src1'); fs.mkdirSync(srcLoc, { recursive: true })
  fs.writeFileSync(sourcesFile, JSON.stringify({ sources: [
    { id: 's_old', type: 'folder', name: '老源', loc: srcLoc, updateMode: 'manual', sortIndex: 0 },
  ] }, null, 2))
  const svc = makeSkillService(() => skillsDir, sourcesFile, cacheRoot, os.homedir(), undefined, path.join(dir, 'created'), groupsFile)
  return { svc }
}
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

describe('源→分组迁移（幂等·无损）', () => {
  it('旧源无 groupId → 自动包成单成员分组，源保留原 id', () => {
    const { svc } = setup()
    const userGroups = svc.listGroups().filter(g => g.id !== 'builtin' && g.id !== 'created')
    expect(userGroups.length).toBe(1)
    expect(userGroups[0].name).toBe('老源')
    const src = svc.listSources().find(s => s.id === 's_old')!
    expect(src.groupId).toBe(userGroups[0].id)
    expect(src.id).toBe('s_old')
  })
  it('重复读取幂等：不重复建分组', () => {
    const { svc } = setup()
    const n1 = svc.listGroups().filter(g => g.id !== 'builtin' && g.id !== 'created').length
    svc.listSources(); svc.listGroups()
    const n2 = svc.listGroups().filter(g => g.id !== 'builtin' && g.id !== 'created').length
    expect(n2).toBe(n1)
  })
  it('addSource 拒绝系统分组落点 + 不存在的分组', () => {
    const { svc } = setup()
    expect(() => svc.addSource({ type: 'folder', name: 'x', loc: dir, groupId: 'builtin', updateMode: 'manual' } as any)).toThrow()
    expect(() => svc.addSource({ type: 'folder', name: 'x', loc: dir, groupId: 'nope', updateMode: 'manual' } as any)).toThrow()
  })
  it('removeGroup 系统单例 403；删用户分组连带移除成员', () => {
    const { svc } = setup()
    expect(() => svc.removeGroup('builtin')).toThrow()
    const g = svc.listGroups().find(x => x.id !== 'builtin' && x.id !== 'created')!
    svc.removeGroup(g.id)
    expect(svc.listGroups().find(x => x.id === g.id)).toBeUndefined()
    expect(svc.listSources().find(s => s.id === 's_old')).toBeUndefined()   // 成员被连带移除
  })
})
