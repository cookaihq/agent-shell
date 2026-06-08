import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeAuthSourceStore } from '../../auth/sourceStore'
import { makeProxyStore } from '../store'
import { buildProxyUrl } from '../proxyUrl'
import { resolveActiveProxy } from '../resolveProxy'

const dirs: string[] = []
function tmpDir() { const d = mkdtempSync(join(tmpdir(), 'rproxy-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

function setup() {
  const d = tmpDir()
  const sourceStore = makeAuthSourceStore(join(d, 'auth.json'))
  const proxyStore = makeProxyStore(join(d, 'proxies.json'))
  return { sourceStore, proxyStore }
}

describe('resolveActiveProxy（三态）', () => {
  it('activeSource = cli-login → { managed:false }（继承本机 ambient，不增不删）', () => {
    const { sourceStore, proxyStore } = setup()
    // 默认就是 cli-login
    expect(resolveActiveProxy('claude', sourceStore, proxyStore)).toEqual({ managed: false })
  })

  it('激活来源绑定了存在的代理 → { managed:true, url }', () => {
    const { sourceStore, proxyStore } = setup()
    sourceStore.setSource('claude', 'official-key')
    const p = proxyStore.create({ name: '代理A', protocol: 'http', host: '1.2.3.4', port: 8080 })
    sourceStore.setProxy('claude', 'official-key', p.id)
    expect(resolveActiveProxy('claude', sourceStore, proxyStore)).toEqual({ managed: true, url: buildProxyUrl(p) })
  })

  it('激活来源绑定指向不存在的代理 → { managed:true, url:undefined }（受管直连，删继承）', () => {
    const { sourceStore, proxyStore } = setup()
    sourceStore.setSource('claude', 'official-key')
    sourceStore.setProxy('claude', 'official-key', 'px_missing')
    expect(resolveActiveProxy('claude', sourceStore, proxyStore)).toEqual({ managed: true, url: undefined })
  })

  it('激活来源无绑定 → { managed:true, url:undefined }（受管直连，删继承）', () => {
    const { sourceStore, proxyStore } = setup()
    sourceStore.setSource('claude', 'official-key')
    expect(resolveActiveProxy('claude', sourceStore, proxyStore)).toEqual({ managed: true, url: undefined })
  })

  it('绑定按引擎隔离：codex 绑了代理不影响 claude', () => {
    const { sourceStore, proxyStore } = setup()
    const p = proxyStore.create({ name: '代理B', protocol: 'socks5', host: 'h', port: 1080 })
    sourceStore.setSource('codex', 'official-key')
    sourceStore.setProxy('codex', 'official-key', p.id)
    sourceStore.setSource('claude', 'official-key')
    expect(resolveActiveProxy('claude', sourceStore, proxyStore)).toEqual({ managed: true, url: undefined })
    expect(resolveActiveProxy('codex', sourceStore, proxyStore)).toEqual({ managed: true, url: buildProxyUrl(p) })
  })
})
