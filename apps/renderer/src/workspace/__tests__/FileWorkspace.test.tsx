/**
 * FileWorkspace.test.tsx — Task 19 TDD
 *
 * 验证 FileWorkspace 组件：
 * - api.files 加载树并渲染
 * - 文件标签（fw-tabs）结构
 * - 点文件打开 → 加 tab + 切预览视图
 * - × 关 tab → 关闭后切文件浏览器
 * - 视图 tab（仅「预览」）
 * - CtxFile activeFile 联动（onActiveFile 回调）
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FileWorkspace } from '../FileWorkspace'
import { api } from '../../api/client'

vi.mock('../../api/client', () => ({
  api: {
    files: vi.fn().mockResolvedValue({
      tree: [
        {
          name: 'decks',
          path: 'decks',
          type: 'dir',
          children: [
            { name: 'slide-01.html', path: 'decks/slide-01.html', type: 'file' },
          ],
        },
        { name: 'README.md', path: 'README.md', type: 'file' },
      ],
    }),
    file: vi.fn().mockResolvedValue({
      path: 'README.md',
      content: '# Hello',
      truncated: false,
    }),
    rawUrl: (projectId: string, p: string) => `/api/pf/${projectId}/${p}`,
    importFiles: vi.fn().mockResolvedValue({
      imported: [{ name: 'dropped.png', from: '/abs/dropped.png' }],
      tree: [{ name: 'dropped.png', path: 'dropped.png', type: 'file' }],
    }),
  },
}))

describe('FileWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('渲染 .fw 容器 + .fw-tabs + .fw-body', async () => {
    const { container } = render(
      <FileWorkspace projectId="p1" onActiveFile={vi.fn()} />
    )
    await waitFor(() => {
      expect(container.querySelector('.fw')).toBeTruthy()
      expect(container.querySelector('.fw-tabs')).toBeTruthy()
      expect(container.querySelector('.fw-body')).toBeTruthy()
    })
  })

  it('有固定「文件」tab（.fw-ftab[data-ftab="files"]）', async () => {
    const { container } = render(
      <FileWorkspace projectId="p1" onActiveFile={vi.fn()} />
    )
    await waitFor(() => {
      const filesTab = container.querySelector('[data-ftab="files"]')
      expect(filesTab).toBeTruthy()
      expect(filesTab?.textContent).toContain('文件')
    })
  })

  it('加载后渲染目录树节点', async () => {
    render(<FileWorkspace projectId="p1" onActiveFile={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getAllByText('README.md').length).toBeGreaterThan(0)
    })
  })

  it('文件浏览器面板默认显示（.fw-panel[data-fw="files"].is-active）', async () => {
    const { container } = render(
      <FileWorkspace projectId="p1" onActiveFile={vi.fn()} />
    )
    await waitFor(() => {
      const panel = container.querySelector('.fw-panel[data-fw="files"]')
      expect(panel?.classList.contains('is-active')).toBe(true)
    })
  })

  it('浏览文件时视图 tab 区隐藏（.fw-views style display:none）', async () => {
    const { container } = render(
      <FileWorkspace projectId="p1" onActiveFile={vi.fn()} />
    )
    await waitFor(() => {
      const views = container.querySelector('.fw-views') as HTMLElement
      expect(views?.style.display).toBe('none')
    })
  })

  it('点树中文件 → 打开文件 tab + 切预览视图', async () => {
    const { container } = render(
      <FileWorkspace projectId="p1" onActiveFile={vi.fn()} />
    )
    await waitFor(() => expect(screen.getAllByText('README.md').length).toBeGreaterThan(0))
    const fileNodes = Array.from(container.querySelectorAll('.fb-tnode:not(.is-folder)'))
    const readme = fileNodes.find(n => n.textContent?.includes('README.md'))!
    fireEvent.click(readme)

    // 打开后预览 panel 激活
    await waitFor(() => {
      const previewPanel = container.querySelector('.fw-panel[data-fw="preview"]')
      expect(previewPanel?.classList.contains('is-active')).toBe(true)
    })
  })

  it('点树中文件 → .fw-ftablist 出现对应 tab', async () => {
    const { container } = render(
      <FileWorkspace projectId="p1" onActiveFile={vi.fn()} />
    )
    await waitFor(() => expect(screen.getAllByText('README.md').length).toBeGreaterThan(0))
    const fileNodes = Array.from(container.querySelectorAll('.fb-tnode:not(.is-folder)'))
    const readme = fileNodes.find(n => n.textContent?.includes('README.md'))!
    fireEvent.click(readme)

    await waitFor(() => {
      const tab = container.querySelector('[data-ftab="README.md"]')
      expect(tab).toBeTruthy()
    })
  })

  it('打开文件后视图 tab 区显示', async () => {
    const { container } = render(
      <FileWorkspace projectId="p1" onActiveFile={vi.fn()} />
    )
    await waitFor(() => expect(screen.getAllByText('README.md').length).toBeGreaterThan(0))
    const fileNodes = Array.from(container.querySelectorAll('.fb-tnode:not(.is-folder)'))
    const readme = fileNodes.find(n => n.textContent?.includes('README.md'))!
    fireEvent.click(readme)

    await waitFor(() => {
      const views = container.querySelector('.fw-views') as HTMLElement
      expect(views?.style.display).not.toBe('none')
    })
  })

  it('× 关闭 tab → 回到文件浏览器', async () => {
    const { container } = render(
      <FileWorkspace projectId="p1" onActiveFile={vi.fn()} />
    )
    await waitFor(() => expect(screen.getAllByText('README.md').length).toBeGreaterThan(0))
    const fileNodes = Array.from(container.querySelectorAll('.fb-tnode:not(.is-folder)'))
    const readme = fileNodes.find(n => n.textContent?.includes('README.md'))!
    fireEvent.click(readme)

    await waitFor(() => container.querySelector('[data-ftab="README.md"]'))

    // 点 × 关 tab
    const closeBtn = container.querySelector('.ftab-x') as HTMLElement
    fireEvent.click(closeBtn)

    await waitFor(() => {
      const filesPanel = container.querySelector('.fw-panel[data-fw="files"]')
      expect(filesPanel?.classList.contains('is-active')).toBe(true)
    })
  })

  it('打开文件时调用 onActiveFile(path)', async () => {
    const onActiveFile = vi.fn()
    const { container } = render(
      <FileWorkspace projectId="p1" onActiveFile={onActiveFile} />
    )
    await waitFor(() => expect(screen.getAllByText('README.md').length).toBeGreaterThan(0))
    const fileNodes = Array.from(container.querySelectorAll('.fb-tnode:not(.is-folder)'))
    const readme = fileNodes.find(n => n.textContent?.includes('README.md'))!
    fireEvent.click(readme)

    await waitFor(() => {
      expect(onActiveFile).toHaveBeenCalledWith('README.md')
    })
  })

  it('关闭最后一个 tab 时调用 onActiveFile(null)', async () => {
    const onActiveFile = vi.fn()
    const { container } = render(
      <FileWorkspace projectId="p1" onActiveFile={onActiveFile} />
    )
    await waitFor(() => expect(screen.getAllByText('README.md').length).toBeGreaterThan(0))
    const fileNodes = Array.from(container.querySelectorAll('.fb-tnode:not(.is-folder)'))
    const readme = fileNodes.find(n => n.textContent?.includes('README.md'))!
    fireEvent.click(readme)
    await waitFor(() => container.querySelector('[data-ftab="README.md"]'))

    const closeBtn = container.querySelector('.ftab-x') as HTMLElement
    fireEvent.click(closeBtn)

    await waitFor(() => {
      // 最后一次调用应是 null（关闭后无打开文件）
      const calls = onActiveFile.mock.calls
      expect(calls[calls.length - 1][0]).toBeNull()
    })
  })

  it('视图 tab 有「预览」按钮', async () => {
    const { container } = render(
      <FileWorkspace projectId="p1" onActiveFile={vi.fn()} />
    )
    await waitFor(() => {
      const viewTab = container.querySelector('.fw-tab[data-fw="preview"]')
      expect(viewTab?.textContent).toContain('预览')
    })
  })

  describe('运行命令 tab（openCmd）', () => {
    const cmd = { id: 't1', command: 'ls -la /tmp', output: 'total 0\nfoo', ok: true }

    it('传入 openCmd → 开命令 tab + 命令预览显示完整命令与输出', async () => {
      const { container, rerender } = render(<FileWorkspace projectId="p1" onActiveFile={vi.fn()} openCmd={null} />)
      await waitFor(() => expect(container.querySelector('.fw')).toBeTruthy())
      rerender(<FileWorkspace projectId="p1" onActiveFile={vi.fn()} openCmd={{ cmd, seq: 1 }} />)
      await waitFor(() => {
        // 命令 tab 出现（$ 前缀）
        expect(container.querySelector('.fw-ftab-cmd')).toBeTruthy()
        // 命令预览渲染完整命令 + 输出
        expect(screen.getByText('ls -la /tmp')).toBeInTheDocument()
        expect(screen.getByText(/total 0/)).toBeInTheDocument()
      })
    })

    it('× 关命令 tab → 回文件浏览器', async () => {
      const { container, rerender } = render(<FileWorkspace projectId="p1" onActiveFile={vi.fn()} openCmd={null} />)
      await waitFor(() => expect(container.querySelector('.fw')).toBeTruthy())
      rerender(<FileWorkspace projectId="p1" onActiveFile={vi.fn()} openCmd={{ cmd, seq: 1 }} />)
      await waitFor(() => expect(container.querySelector('.fw-ftab-cmd')).toBeTruthy())
      fireEvent.click(container.querySelector('.fw-ftab-cmd .ftab-x') as HTMLElement)
      await waitFor(() => {
        expect(container.querySelector('.fw-ftab-cmd')).toBeFalsy()
        expect(container.querySelector('.fw-panel[data-fw="files"]')?.classList.contains('is-active')).toBe(true)
      })
    })
  })

  describe('拖入文件 → 复制进项目', () => {
    afterEach(() => { delete (globalThis as { agentShell?: unknown }).agentShell })

    it('dragOver（拖的是文件）→ 文件面板高亮 is-dragover', async () => {
      const { container } = render(<FileWorkspace projectId="p1" onActiveFile={vi.fn()} />)
      const panel = await waitFor(() => container.querySelector('.fw-panel[data-fw="files"]')!)
      fireEvent.dragOver(panel, { dataTransfer: { types: ['Files'], files: [] } })
      expect(panel.classList.contains('is-dragover')).toBe(true)
    })

    it('drop 文件 → 经桥取路径调 api.importFiles 并刷新树', async () => {
      // 模拟桌面壳 preload 暴露的 getPathForFile（Electron 32+ 取真实磁盘路径的唯一途径）
      ;(globalThis as { agentShell?: unknown }).agentShell = {
        getPathForFile: (f: File) => `/abs/${f.name}`,
      }
      const { container } = render(<FileWorkspace projectId="p1" onActiveFile={vi.fn()} />)
      const panel = await waitFor(() => container.querySelector('.fw-panel[data-fw="files"]')!)
      const file = new File(['x'], 'dropped.png', { type: 'image/png' })
      fireEvent.drop(panel, { dataTransfer: { types: ['Files'], files: [file] } })

      await waitFor(() => {
        expect(api.importFiles).toHaveBeenCalledWith('p1', ['/abs/dropped.png'])
      })
      // 树刷新后新文件出现在列表
      await waitFor(() => expect(screen.getAllByText('dropped.png').length).toBeGreaterThan(0))
    })

    it('无 agentShell 桥（浏览器/dev）→ 不调 importFiles', async () => {
      const { container } = render(<FileWorkspace projectId="p1" onActiveFile={vi.fn()} />)
      const panel = await waitFor(() => container.querySelector('.fw-panel[data-fw="files"]')!)
      const file = new File(['x'], 'dropped.png', { type: 'image/png' })
      fireEvent.drop(panel, { dataTransfer: { types: ['Files'], files: [file] } })
      await Promise.resolve()
      expect(api.importFiles).not.toHaveBeenCalled()
    })
  })
})
