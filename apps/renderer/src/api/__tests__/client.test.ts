import { describe, it, expect, vi, afterEach } from 'vitest'
import { api, ApiError } from '../client'
const okJson = (b: unknown, s = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } }))
afterEach(() => vi.restoreAllMocks())
describe('api client', () => {
  it('listProjects GET /api/projects', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockReturnValue(okJson({ projects: [] }))
    await api.listProjects(); expect(f).toHaveBeenCalledWith('/api/projects', undefined)
  })
  it('submit 202 无 body', async () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(Promise.resolve(new Response(null, { status: 202 })))
    await expect(api.submit('s', 'hi')).resolves.toBeUndefined()
  })
  it('错误 → ApiError(code,httpStatus)', async () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(okJson({ error: { code: 'not_found', message: 'x' } }, 404))
    await expect(api.messages('n')).rejects.toMatchObject({ code: 'not_found', httpStatus: 404 })
    vi.spyOn(globalThis, 'fetch').mockReturnValue(okJson({ error: { code: 'not_found', message: 'x' } }, 404))
    await expect(api.messages('n')).rejects.toBeInstanceOf(ApiError)
  })
  it('file 路径编码进 query', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockReturnValue(okJson({ path: 'a b', content: '', truncated: false }))
    await api.file('p', 'a b'); expect(f).toHaveBeenCalledWith('/api/projects/p/file?path=a%20b', undefined)
  })

  it('有 window.agentShell.authToken 时每请求带 x-agent-shell-token 头', async () => {
    ;(globalThis as { agentShell?: unknown }).agentShell = { authToken: 'sek', pickFolder: async () => null }
    const f = vi.spyOn(globalThis, 'fetch').mockReturnValue(okJson({ projects: [] }))
    await api.listProjects()
    expect(f).toHaveBeenCalledWith('/api/projects', { headers: { 'x-agent-shell-token': 'sek' } })
    delete (globalThis as { agentShell?: unknown }).agentShell
  })

  it('带 body 的请求注入 token 头但保留原 headers/method', async () => {
    ;(globalThis as { agentShell?: unknown }).agentShell = { authToken: 'sek', pickFolder: async () => null }
    const f = vi.spyOn(globalThis, 'fetch').mockReturnValue(okJson({}))
    await api.saveConfig({ projectsDir: '/p' })
    const [, init] = f.mock.calls[0]
    expect((init as RequestInit).method).toBe('PUT')
    expect((init as RequestInit).headers).toMatchObject({ 'content-type': 'application/json', 'x-agent-shell-token': 'sek' })
    delete (globalThis as { agentShell?: unknown }).agentShell
  })
})
