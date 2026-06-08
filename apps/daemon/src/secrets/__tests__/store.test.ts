import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeSecretStore } from '../store'

let file: string
beforeEach(() => {
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sec-')), 'secrets.json')
})

describe('secretStore', () => {
  it('空文件 → 空列表', () => {
    expect(makeSecretStore(file).view()).toEqual([])
  })
  it('create 返回脱敏视图（不含明文）+ 落盘 0600', () => {
    const s = makeSecretStore(file)
    const v = s.create({ name: '高德 Key', value: 'a1b2c3d4e5f6g7h8', note: '高德' })
    expect(v.hasValue).toBe(true)
    expect(v.maskedValue).toBe('…g7h8')
    expect((v as Record<string, unknown>).value).toBeUndefined()
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
  })
  it('getValue 取明文（内部用）', () => {
    const s = makeSecretStore(file)
    const v = s.create({ name: 'k', value: 'sk-secret-123', note: '' })
    expect(s.getValue(v.id)).toBe('sk-secret-123')
    expect(s.getValue('nope')).toBeUndefined()
  })
  it('update 省略/空 value = 保留原值', () => {
    const s = makeSecretStore(file)
    const v = s.create({ name: 'k', value: 'orig', note: '' })
    s.update(v.id, { name: 'k2' })
    expect(s.getValue(v.id)).toBe('orig')
    s.update(v.id, { value: 'new' })
    expect(s.getValue(v.id)).toBe('new')
  })
  it('remove 删除', () => {
    const s = makeSecretStore(file)
    const v = s.create({ name: 'k', value: 'x', note: '' })
    s.remove(v.id)
    expect(s.view()).toEqual([])
  })
  it('createPlaceholder 写入空值占位（hasValue=false），不走 min(1) 校验', () => {
    const s = makeSecretStore(file)
    const v = s.createPlaceholder('FoxAPI Key', 'foxapi.cc 中转 <a href="https://api.foxapi.cc/console/token">获取密钥</a>')
    expect(v.hasValue).toBe(false)
    expect(v.name).toBe('FoxAPI Key')
    expect(s.getValue(v.id)).toBe('')
  })
})
