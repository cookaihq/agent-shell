/**
 * Preview.test.tsx — Task 20 TDD
 *
 * 验证 Preview 组件：
 * - activeFile 变化 → api.file 拉内容
 * - .html/.htm → <iframe srcDoc> 渲染
 * - 其它 → 代码视图 <pre className="code-view">
 * - truncated=true → 显示「已截断」提示
 * - .preview-toolbar 结构
 * - .preview-stage 结构
 */
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Preview } from '../Preview'

vi.mock('../../api/client', () => ({
  api: {
    file: vi.fn(),
  },
}))

import { api } from '../../api/client'

describe('Preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('activeFile=null 时渲染空 preview-wrap', () => {
    const { container } = render(
      <Preview projectId="p1" activeFile={null} />
    )
    expect(container.querySelector('.preview-wrap')).toBeTruthy()
    expect(api.file).not.toHaveBeenCalled()
  })

  it('activeFile 变化时调用 api.file', async () => {
    ;(api.file as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: 'README.md',
      content: '# Hello',
      truncated: false,
    })
    render(<Preview projectId="p1" activeFile="README.md" />)
    await waitFor(() => {
      expect(api.file).toHaveBeenCalledWith('p1', 'README.md')
    })
  })

  it('.html 文件 → 渲染 iframe（srcdoc）', async () => {
    ;(api.file as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: 'slide.html',
      content: '<h1>Title</h1>',
      truncated: false,
    })
    const { container } = render(
      <Preview projectId="p1" activeFile="slide.html" />
    )
    await waitFor(() => {
      const iframe = container.querySelector('iframe')
      expect(iframe).toBeTruthy()
      expect(iframe?.getAttribute('srcdoc')).toContain('<h1>Title</h1>')
    })
  })

  it('.htm 文件 → 渲染 iframe（srcdoc）', async () => {
    ;(api.file as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: 'page.htm',
      content: '<p>hello</p>',
      truncated: false,
    })
    const { container } = render(
      <Preview projectId="p1" activeFile="page.htm" />
    )
    await waitFor(() => {
      const iframe = container.querySelector('iframe')
      expect(iframe).toBeTruthy()
    })
  })

  it('.ts 文件 → 代码视图 pre.code-view', async () => {
    ;(api.file as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: 'index.ts',
      content: 'const x = 1',
      truncated: false,
    })
    const { container } = render(
      <Preview projectId="p1" activeFile="index.ts" />
    )
    await waitFor(() => {
      const pre = container.querySelector('pre.code-view')
      expect(pre).toBeTruthy()
      expect(pre?.textContent).toContain('const x = 1')
    })
  })

  it('truncated=true → 显示「已截断」提示', async () => {
    ;(api.file as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: 'big.ts',
      content: 'a'.repeat(100),
      truncated: true,
    })
    render(<Preview projectId="p1" activeFile="big.ts" />)
    await waitFor(() => {
      expect(screen.getByText(/已截断/)).toBeInTheDocument()
    })
  })

  it('渲染 .preview-toolbar', async () => {
    ;(api.file as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: 'README.md',
      content: '# hi',
      truncated: false,
    })
    const { container } = render(
      <Preview projectId="p1" activeFile="README.md" />
    )
    await waitFor(() => {
      expect(container.querySelector('.preview-toolbar')).toBeTruthy()
    })
  })

  it('渲染 .preview-stage', async () => {
    ;(api.file as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: 'README.md',
      content: '# hi',
      truncated: false,
    })
    const { container } = render(
      <Preview projectId="p1" activeFile="README.md" />
    )
    await waitFor(() => {
      expect(container.querySelector('.preview-stage')).toBeTruthy()
    })
  })
})
