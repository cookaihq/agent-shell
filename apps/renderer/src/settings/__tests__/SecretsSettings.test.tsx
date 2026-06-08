import { describe, it, expect, vi, beforeEach } from 'vitest'
import { noteHtml } from '../SecretsSettings'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SecretsSettings } from '../SecretsSettings'

const api = { listSecrets: vi.fn(), createSecret: vi.fn(), updateSecret: vi.fn(), deleteSecret: vi.fn() }
vi.mock('../../api/client', () => ({ api: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (api as Record<string, (...x: unknown[]) => unknown>)[k](...a) }) }))

beforeEach(() => {
  vi.clearAllMocks()
  api.listSecrets.mockResolvedValue({ secrets: [{ id: 'k_1', name: '高德 Key', note: '', hasValue: true, maskedValue: '…3d4e', createdAt: 1 }], usage: { k_1: { skills: ['skill:gaode'], providers: ['我的中转'] } } })
  api.createSecret.mockResolvedValue({ secret: { id: 'k_2', name: '新', note: '', hasValue: true, maskedValue: '…xxxx', createdAt: 2 } })
  api.deleteSecret.mockResolvedValue({ ok: true })
})

describe('SecretsSettings', () => {
  it('加载并展示密钥 + 脱敏值 + 谁在用', async () => {
    render(<SecretsSettings />)
    expect(await screen.findByText('高德 Key')).toBeInTheDocument()
    expect(screen.getByText(/…3d4e/)).toBeInTheDocument()
    // 技能 + Provider 两侧使用者合并展示；技能引用清洗掉 skill: 前缀（对齐原型）
    expect(screen.getByText(/个技能引用/)).toBeInTheDocument()
    expect(screen.getByText(/gaode、我的中转/)).toBeInTheDocument()
  })
  it('新建密钥：填表单 → 调 createSecret', async () => {
    render(<SecretsSettings />)
    await screen.findByText('高德 Key')
    await userEvent.click(screen.getByText(/新建密钥/))
    await userEvent.type(screen.getByPlaceholderText(/高德地图 Key/), 'X')
    await userEvent.type(screen.getByPlaceholderText(/粘贴密钥|Token/), 'sk-1')
    await userEvent.click(screen.getByText(/创建|保存/))
    await waitFor(() => expect(api.createSecret).toHaveBeenCalledWith(expect.objectContaining({ name: 'X', value: 'sk-1' })))
  })
  it('删除密钥 → 调 deleteSecret', async () => {
    render(<SecretsSettings />)
    await screen.findByText('高德 Key')
    await userEvent.click(screen.getByText(/删除|🗑/))
    await waitFor(() => expect(api.deleteSecret).toHaveBeenCalledWith('k_1'))
  })
})

describe('noteHtml 白名单', () => {
  it('http(s) <a> 还原成锚点（target=_blank rel=noreferrer）', () => {
    const out = noteHtml('foxapi.cc 中转 <a href="https://api.foxapi.cc/console/token">获取密钥</a>')
    expect(out).toContain('<a href="https://api.foxapi.cc/console/token" target="_blank" rel="noreferrer">获取密钥</a>')
  })
  it('javascript: 协议被转义、不生成链接', () => {
    const out = noteHtml('x <a href="javascript:alert(1)">点我</a>')
    expect(out).not.toContain('<a href="javascript')
    expect(out).toContain('&lt;a')
  })
  it('纯文本尖括号被转义', () => {
    expect(noteHtml('<script>')).toBe('&lt;script&gt;')
  })
  it('拼错的 htrp= 当文本转义', () => {
    const out = noteHtml('<a htrp="https://x">y</a>')
    expect(out).not.toContain('<a ')
  })
})
