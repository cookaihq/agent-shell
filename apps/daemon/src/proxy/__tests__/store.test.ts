import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeProxyStore } from '../store'

let file: string
beforeEach(() => {
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-')), 'proxies.json')
})

describe('proxyStore', () => {
  it('空文件 → 空列表', () => {
    expect(makeProxyStore(file).list()).toEqual([])
  })
  it('create 生成 id + 落盘 0600，list/get 能取到', () => {
    const s = makeProxyStore(file)
    const p = s.create({ name: '香港', protocol: 'http', host: 'p.local', port: 8080, username: 'u', password: 'pw' })
    expect(p.id).toMatch(/^px_/)
    expect(s.list()).toHaveLength(1)
    const got = s.get(p.id)
    expect(got?.name).toBe('香港')
    expect(got?.password).toBe('pw')
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
  })
  it('get 未命中 → undefined', () => {
    expect(makeProxyStore(file).get('nope')).toBeUndefined()
  })
  it('update 改字段；password 真值才覆盖（省略/空 = 保留原值）', () => {
    const s = makeProxyStore(file)
    const p = s.create({ name: 'a', protocol: 'http', host: 'h', port: 80, password: 'orig' })
    s.update(p.id, { name: 'b', port: 9090 })
    let got = s.get(p.id)
    expect(got?.name).toBe('b')
    expect(got?.port).toBe(9090)
    expect(got?.password).toBe('orig') // 未传 password → 保留
    s.update(p.id, { password: 'new' })
    expect(s.get(p.id)?.password).toBe('new')
  })
  it('update username 可清空（!== undefined）', () => {
    const s = makeProxyStore(file)
    const p = s.create({ name: 'a', protocol: 'http', host: 'h', port: 80, username: 'u' })
    s.update(p.id, { username: '' })
    expect(s.get(p.id)?.username).toBe('')
  })
  it('update 未命中 → null', () => {
    expect(makeProxyStore(file).update('nope', { name: 'x' })).toBeNull()
  })
  it('remove 删除', () => {
    const s = makeProxyStore(file)
    const p = s.create({ name: 'a', protocol: 'http', host: 'h', port: 80 })
    s.remove(p.id)
    expect(s.list()).toEqual([])
  })
  it('持久化：新实例能读到旧数据', () => {
    const a = makeProxyStore(file)
    const p = a.create({ name: 'a', protocol: 'socks5', host: 'h', port: 1080 })
    const b = makeProxyStore(file)
    expect(b.get(p.id)?.host).toBe('h')
  })
})
