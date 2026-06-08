import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { seedDefaults } from '../seed'
import { makeSecretStore } from '../../secrets/store'
import { makeEntityRequirementStore } from '../entityRequirements'
import { makeConfigStore } from '../../config/store'

let dir: string
const mkStores = () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-'))
  return {
    secrets: makeSecretStore(path.join(dir, 'secrets.json')),
    entityReqs: makeEntityRequirementStore(path.join(dir, 'er.json')),
    config: makeConfigStore(path.join(dir, 'config.json'), { projectsDir: '/p', skillsDir: '/s', automationsDir: '/a', debugMode: false }),
  }
}
function fakeSkills(opts: { failClone?: boolean } = {}) {
  const groups: { id: string; name: string; sortIndex: number }[] = []
  let lib: { effectiveName: string; name: string; sourceId: string }[] = []
  return {
    addGroup: (r: { name: string }) => { const g = { id: 'g_x', name: r.name, sortIndex: 0 }; groups.push(g); return g },
    addSource: (r: unknown) => {
      if (opts.failClone) throw new Error('clone failed')
      lib = [
        { effectiveName: 'banana-2', name: 'banana-2', sourceId: 's_x' },
        { effectiveName: 'image-2', name: 'image-2', sourceId: 's_x' },
        { effectiveName: 'preview-share', name: 'preview-share', sourceId: 's_x' },
      ]
      return { id: 's_x', ...(r as object), sortIndex: 0 }
    },
    setUpdateMode: () => ({}),
    listLibrary: () => lib,
    setAutoInject: vi.fn(),
    listGroups: () => groups,
    removeGroup: (id: string) => { const i = groups.findIndex(g => g.id === id); if (i >= 0) groups.splice(i, 1) },
  }
}
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

describe('seedDefaults', () => {
  it('建分组+3占位+banana-2/image-2预绑FoxAPI+autoInject；标记置位', async () => {
    const { secrets, entityReqs, config } = mkStores()
    const skills = fakeSkills()
    await seedDefaults({ skills: skills as any, secrets, entityReqs, config })
    expect(secrets.view().map(v => v.name).sort()).toEqual(['DeepSeek Key', 'FoxAPI Key', 'MiniMax Key'])
    expect(secrets.view().every(v => !v.hasValue)).toBe(true)
    const fox = secrets.view().find(v => v.name === 'FoxAPI Key')!
    expect(entityReqs.get('skill:banana-2')!.slots![0].bind).toBe(fox.id)
    expect(entityReqs.get('skill:banana-2')!.slots![0].name).toBe('X_API_KEY')
    expect(entityReqs.get('skill:image-2')!.slots![0].bind).toBe(fox.id)
    expect(entityReqs.get('skill:preview-share')).toBeUndefined()
    expect(config.read().seededRecommendedGroup).toBe(true)
    expect(config.read().seededDefaultSecrets).toBe(true)
    expect(skills.setAutoInject).toHaveBeenCalledWith('banana-2', true)
    expect(skills.setAutoInject).toHaveBeenCalledWith('preview-share', true)
  })
  it('幂等：标记已置位 → 重跑不重复建', async () => {
    const { secrets, entityReqs, config } = mkStores()
    await seedDefaults({ skills: fakeSkills() as any, secrets, entityReqs, config })
    await seedDefaults({ skills: fakeSkills() as any, secrets, entityReqs, config })
    expect(secrets.view().length).toBe(3)
  })
  it('clone 失败 → 回滚分组、seededRecommendedGroup 不置位、secrets 独立成功', async () => {
    const { secrets, entityReqs, config } = mkStores()
    const skills = fakeSkills({ failClone: true })
    await seedDefaults({ skills: skills as any, secrets, entityReqs, config })
    expect(config.read().seededRecommendedGroup).toBeUndefined()
    expect(config.read().seededDefaultSecrets).toBe(true)
    expect(skills.listGroups().length).toBe(0)
  })
})
