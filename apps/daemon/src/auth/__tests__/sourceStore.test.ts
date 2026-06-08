import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeAuthSourceStore } from '../sourceStore'

const dirs: string[] = []
function tmpFile() { const d = mkdtempSync(join(tmpdir(), 'auth-')); dirs.push(d); return join(d, 'auth.json') }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

describe('makeAuthSourceStore', () => {
  it('默认值：未存储时两个引擎都返回 { activeSource: cli-login }', () => {
    const store = makeAuthSourceStore(tmpFile())
    expect(store.get('claude')).toEqual({ activeSource: 'cli-login' })
    expect(store.get('codex')).toEqual({ activeSource: 'cli-login' })
  })

  it('setSource 按引擎隔离：改 claude 不影响 codex', () => {
    const store = makeAuthSourceStore(tmpFile())
    store.setSource('claude', 'official-key')
    expect(store.get('claude').activeSource).toBe('official-key')
    expect(store.get('codex')).toEqual({ activeSource: 'cli-login' })
  })

  it('setOfficialKey 只改 secretId，不动 activeSource', () => {
    const store = makeAuthSourceStore(tmpFile())
    store.setOfficialKey('claude', 'k_1')
    expect(store.get('claude').officialKeySecretId).toBe('k_1')
    expect(store.get('claude').activeSource).toBe('cli-login')
  })

  it('持久化：新实例读同一文件能读回已存值', () => {
    const file = tmpFile()
    const a = makeAuthSourceStore(file)
    a.setSource('claude', 'oauth')
    a.setOfficialKey('claude', 'k_9')
    const b = makeAuthSourceStore(file)
    expect(b.get('claude')).toEqual({ activeSource: 'oauth', officialKeySecretId: 'k_9' })
  })

  it('接受 providerId 字符串作为 source 并读回', () => {
    const file = tmpFile()
    const a = makeAuthSourceStore(file)
    a.setSource('codex', 'p_custom123')
    expect(a.get('codex').activeSource).toBe('p_custom123')
    const b = makeAuthSourceStore(file)
    expect(b.get('codex').activeSource).toBe('p_custom123')
  })

  it('setProxy 写入来源绑定并持久化；空 proxyId → 删除绑定（直连）', () => {
    const file = tmpFile()
    const a = makeAuthSourceStore(file)
    a.setProxy('claude', 'official-key', 'px_1')
    expect(a.get('claude').proxyBindings).toEqual({ 'official-key': 'px_1' })
    const b = makeAuthSourceStore(file)
    expect(b.get('claude').proxyBindings?.['official-key']).toBe('px_1')
    // 空串清除该绑定
    b.setProxy('claude', 'official-key', '')
    expect(b.get('claude').proxyBindings?.['official-key']).toBeUndefined()
  })

  it('setProxy 按引擎 + 来源隔离', () => {
    const store = makeAuthSourceStore(tmpFile())
    store.setProxy('claude', 'p_aaa', 'px_a')
    store.setProxy('codex', 'p_bbb', 'px_b')
    expect(store.get('claude').proxyBindings).toEqual({ 'p_aaa': 'px_a' })
    expect(store.get('codex').proxyBindings).toEqual({ 'p_bbb': 'px_b' })
  })

  it('缺失文件 → 回落默认值', () => {
    const store = makeAuthSourceStore(tmpFile())
    expect(store.get('claude')).toEqual({ activeSource: 'cli-login' })
  })

  it('损坏 JSON 文件 → 回落默认值', () => {
    const file = tmpFile()
    writeFileSync(file, 'not json{')
    const store = makeAuthSourceStore(file)
    expect(store.get('claude')).toEqual({ activeSource: 'cli-login' })
  })
})
