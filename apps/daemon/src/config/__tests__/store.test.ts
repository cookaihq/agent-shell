import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeConfigStore } from '../store'

let dir: string, file: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-cfg-')); file = path.join(dir, 'config.json') })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

const DEFAULTS = { projectsDir: '/d/projects', skillsDir: '/d/skills', automationsDir: '/d/autos' }

describe('config store', () => {
  it('文件不存在 → 返回默认值', () => {
    const store = makeConfigStore(file, { ...DEFAULTS })
    expect(store.read()).toEqual({ ...DEFAULTS })
  })
  it('write 持久化 + read 回读（缺字段用默认补全）', () => {
    const store = makeConfigStore(file, { ...DEFAULTS })
    store.write({ projectsDir: '/custom/p' })
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).projectsDir).toBe('/custom/p')
    const store2 = makeConfigStore(file, { ...DEFAULTS })
    expect(store2.read()).toEqual({ projectsDir: '/custom/p', skillsDir: '/d/skills', automationsDir: '/d/autos' })
  })
  it('损坏 JSON → 回退默认值（不抛）', () => {
    fs.writeFileSync(file, '{bad json')
    const store = makeConfigStore(file, { ...DEFAULTS })
    expect(store.read()).toEqual({ ...DEFAULTS })
  })
  it('debugMode 往返 + 缺省 false', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-cfg-'))
    const store = makeConfigStore(path.join(dir, 'config.json'), { projectsDir: '/p', skillsDir: '/s', automationsDir: '/a', debugMode: false })
    expect(store.read().debugMode).toBe(false)
    store.write({ debugMode: true })
    expect(store.read().debugMode).toBe(true)
  })
  it('engineModels 写入后可回读', () => {
    const store = makeConfigStore(file, { projectsDir: '/p', skillsDir: '/s', automationsDir: '/a' })
    store.write({ engineModels: { claude: 'claude-opus-4-5' } })
    expect(store.read().engineModels).toEqual({ claude: 'claude-opus-4-5' })
  })
  it('seed 标记进 read 白名单：write 后能 read 回来', () => {
    const store = makeConfigStore(file, { projectsDir: '/p', skillsDir: '/s', automationsDir: '/a', debugMode: false })
    store.write({ seededRecommendedGroup: true })
    expect(store.read().seededRecommendedGroup).toBe(true)
    store.write({ seededDefaultSecrets: true })
    expect(store.read().seededRecommendedGroup).toBe(true)   // 不被后续 write 丢失
    expect(store.read().seededDefaultSecrets).toBe(true)
  })
})
