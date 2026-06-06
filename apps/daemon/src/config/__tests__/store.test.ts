import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeConfigStore } from '../store'

let dir: string, file: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-cfg-')); file = path.join(dir, 'config.json') })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

describe('config store', () => {
  it('文件不存在 → 返回默认值', () => {
    const store = makeConfigStore(file, { projectsDir: '/d/projects', skillsDir: '/d/skills' })
    expect(store.read()).toEqual({ projectsDir: '/d/projects', skillsDir: '/d/skills' })
  })
  it('write 持久化 + read 回读（缺字段用默认补全）', () => {
    const store = makeConfigStore(file, { projectsDir: '/d/projects', skillsDir: '/d/skills' })
    store.write({ projectsDir: '/custom/p' })
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).projectsDir).toBe('/custom/p')
    const store2 = makeConfigStore(file, { projectsDir: '/d/projects', skillsDir: '/d/skills' })
    expect(store2.read()).toEqual({ projectsDir: '/custom/p', skillsDir: '/d/skills' })
  })
  it('损坏 JSON → 回退默认值（不抛）', () => {
    fs.writeFileSync(file, '{bad json')
    const store = makeConfigStore(file, { projectsDir: '/d/projects', skillsDir: '/d/skills' })
    expect(store.read()).toEqual({ projectsDir: '/d/projects', skillsDir: '/d/skills' })
  })
  it('debugMode 往返 + 缺省 false', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-cfg-'))
    const store = makeConfigStore(path.join(dir, 'config.json'), { projectsDir: '/p', skillsDir: '/s', debugMode: false })
    expect(store.read().debugMode).toBe(false)
    store.write({ debugMode: true })
    expect(store.read().debugMode).toBe(true)
  })
  it('engineModels 写入后可回读', () => {
    const store = makeConfigStore(file, { projectsDir: '/p', skillsDir: '/s' })
    store.write({ engineModels: { claude: 'claude-opus-4-5' } })
    expect(store.read().engineModels).toEqual({ claude: 'claude-opus-4-5' })
  })
})
