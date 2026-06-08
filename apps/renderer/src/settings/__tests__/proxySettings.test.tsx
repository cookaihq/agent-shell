import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProxySettings } from '../ProxySettings'

const api = {
  listProxies: vi.fn(),
  createProxy: vi.fn(),
  updateProxy: vi.fn(),
  deleteProxy: vi.fn(),
  testProxy: vi.fn(),
}
vi.mock('../../api/client', () => ({ api: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (api as Record<string, (...x: unknown[]) => unknown>)[k](...a) }) }))

beforeEach(() => {
  vi.clearAllMocks()
  api.listProxies.mockResolvedValue({ proxies: [
    { id: 'prx1', name: '主力梯子', protocol: 'socks5', host: '127.0.0.1', port: 7890, hasPassword: false, status: 'active', createdAt: 1 },
    { id: 'prx2', name: '公司代理', protocol: 'http', host: 'proxy.corp', port: 8080, username: 'alice', hasPassword: true, createdAt: 2 },
  ] })
  api.createProxy.mockResolvedValue({ proxy: { id: 'prx3', name: '新代理', protocol: 'socks5', host: 'h', port: 1080, hasPassword: false, createdAt: 3 } })
  api.updateProxy.mockResolvedValue({ proxy: { id: 'prx1', name: '主力梯子', protocol: 'socks5', host: '127.0.0.1', port: 7890, hasPassword: false, createdAt: 1 } })
  api.deleteProxy.mockResolvedValue({ ok: true })
  api.testProxy.mockResolvedValue({ ok: true, latencyMs: 123 })
})

describe('ProxySettings', () => {
  it('加载并展示代理池', async () => {
    render(<ProxySettings />)
    expect(await screen.findByText('主力梯子')).toBeInTheDocument()
    expect(screen.getByText('公司代理')).toBeInTheDocument()
    // 地址展示协议://host:port
    expect(screen.getByText(/socks5:\/\/127\.0\.0\.1:7890/)).toBeInTheDocument()
  })

  it('添加代理：填表单 → 调 createProxy', async () => {
    render(<ProxySettings />)
    await screen.findByText('主力梯子')
    await userEvent.click(screen.getAllByText(/添加代理/)[0])
    await userEvent.type(screen.getByPlaceholderText(/主力梯子/), '测试梯子')
    await userEvent.type(screen.getByPlaceholderText(/proxy\.example\.com/), '1.2.3.4')
    await userEvent.type(screen.getByPlaceholderText(/7890/), '1080')
    await userEvent.click(screen.getByText(/保存/))
    await waitFor(() => expect(api.createProxy).toHaveBeenCalledWith(expect.objectContaining({ name: '测试梯子', host: '1.2.3.4', port: 1080 })))
  })

  it('测试代理 → 调 testProxy 并显示延迟', async () => {
    render(<ProxySettings />)
    await screen.findByText('主力梯子')
    await userEvent.click(screen.getAllByText('测试')[0])
    await waitFor(() => expect(api.testProxy).toHaveBeenCalledWith('prx1'))
    expect(await screen.findByText(/123\s*ms/)).toBeInTheDocument()
  })

  it('删除代理 → 调 deleteProxy', async () => {
    render(<ProxySettings />)
    await screen.findByText('主力梯子')
    await userEvent.click(screen.getAllByText('删除')[0])
    await waitFor(() => expect(api.deleteProxy).toHaveBeenCalledWith('prx1'))
  })
})
