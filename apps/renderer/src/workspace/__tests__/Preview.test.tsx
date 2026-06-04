/**
 * Preview.test.tsx — 预览渲染重构（Issue 3/4/22）
 *
 * 验证 Preview 组件按文件类型分流：
 * - 文本/markdown → api.file 拉内容；md 渲染、文本走 pre.code-view
 * - 图片 → <img src=rawUrl>，不拉文本
 * - html → <iframe src=rawUrl>（真实同源 URL，非 srcdoc）
 * - pdf → <iframe src=rawUrl>
 * - truncated=true → 「已截断」提示
 * - 地址栏（Issue 22）始终在工具栏
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Preview } from '../Preview'

vi.mock('../../api/client', () => ({
  api: {
    file: vi.fn(),
    rawUrl: (projectId: string, p: string) => `/api/pf/${projectId}/${p}`,
  },
}))

import { api } from '../../api/client'

describe('Preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('activeFile=null 时渲染空 preview-wrap，不拉文本', () => {
    const { container } = render(<Preview projectId="p1" activeFile={null} />)
    expect(container.querySelector('.preview-wrap')).toBeTruthy()
    expect(api.file).not.toHaveBeenCalled()
  })

  it('文本/markdown 文件变化时调用 api.file', async () => {
    ;(api.file as ReturnType<typeof vi.fn>).mockResolvedValue({ path: 'README.md', content: '# Hello', truncated: false })
    render(<Preview projectId="p1" activeFile="README.md" />)
    await waitFor(() => expect(api.file).toHaveBeenCalledWith('p1', 'README.md'))
  })

  it('图片文件 → <img src=rawUrl>，不拉文本', async () => {
    const { container } = render(<Preview projectId="p1" activeFile="pics/a.png" />)
    await waitFor(() => {
      const img = container.querySelector('img.preview-img') as HTMLImageElement | null
      expect(img).toBeTruthy()
      expect(img?.getAttribute('src')).toBe('/api/pf/p1/pics/a.png')
    })
    expect(api.file).not.toHaveBeenCalled()
  })

  it('.html 文件 → iframe src 指向 rawUrl（非 srcdoc）', async () => {
    const { container } = render(<Preview projectId="p1" activeFile="slide.html" />)
    await waitFor(() => {
      const iframe = container.querySelector('iframe.preview-iframe') as HTMLIFrameElement | null
      expect(iframe).toBeTruthy()
      expect(iframe?.getAttribute('src')).toBe('/api/pf/p1/slide.html')
      expect(iframe?.getAttribute('srcdoc')).toBeNull()
    })
    expect(api.file).not.toHaveBeenCalled()
  })

  it('.pdf 文件 → iframe src 指向 rawUrl', async () => {
    const { container } = render(<Preview projectId="p1" activeFile="doc.pdf" />)
    await waitFor(() => {
      const iframe = container.querySelector('iframe.preview-iframe') as HTMLIFrameElement | null
      expect(iframe?.getAttribute('src')).toBe('/api/pf/p1/doc.pdf')
    })
  })

  it('.ts 文件 → 代码视图 pre.code-view', async () => {
    ;(api.file as ReturnType<typeof vi.fn>).mockResolvedValue({ path: 'index.ts', content: 'const x = 1', truncated: false })
    const { container } = render(<Preview projectId="p1" activeFile="index.ts" />)
    await waitFor(() => {
      const pre = container.querySelector('pre.code-view')
      expect(pre).toBeTruthy()
      expect(pre?.textContent).toContain('const x = 1')
    })
  })

  it('truncated=true → 显示「已截断」提示', async () => {
    ;(api.file as ReturnType<typeof vi.fn>).mockResolvedValue({ path: 'big.ts', content: 'a'.repeat(100), truncated: true })
    render(<Preview projectId="p1" activeFile="big.ts" />)
    await waitFor(() => expect(screen.getByText(/已截断/)).toBeInTheDocument())
  })

  it('工具栏含地址栏（Issue 22）：输 URL 回车进浏览器模式', async () => {
    const { container } = render(<Preview projectId="p1" activeFile="index.ts" />)
    const input = container.querySelector('.preview-addr-input') as HTMLInputElement
    expect(input).toBeTruthy()
    fireEvent.change(input, { target: { value: 'http://127.0.0.1:8753' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => {
      const iframe = container.querySelector('iframe.preview-iframe') as HTMLIFrameElement | null
      expect(iframe?.getAttribute('src')).toBe('http://127.0.0.1:8753')
    })
  })

  it('渲染 .preview-toolbar 与 .preview-stage', async () => {
    const { container } = render(<Preview projectId="p1" activeFile="pics/a.png" />)
    await waitFor(() => {
      expect(container.querySelector('.preview-toolbar')).toBeTruthy()
      expect(container.querySelector('.preview-stage')).toBeTruthy()
    })
  })
})
