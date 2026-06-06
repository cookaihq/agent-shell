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
    absPath: vi.fn().mockResolvedValue({ absPath: '/abs/README.md' }),
    rename: vi.fn().mockResolvedValue({
      ok: true,
      path: 'NEW.md',
      tree: [{ name: 'NEW.md', path: 'NEW.md', type: 'file' }],
    }),
    move: vi.fn().mockResolvedValue({
      moved: [{ from: 'README.md', to: 'decks/README.md' }],
      tree: [{ name: 'decks', path: 'decks', type: 'dir', children: [{ name: 'README.md', path: 'decks/README.md', type: 'file' }] }],
    }),
  },
}))

// 内部拖拽用的伪 DataTransfer（jsdom 无原生实现）：仅需 setData/getData/types/effect 字段
function makeDataTransfer() {
  const store: Record<string, string> = {}
  return {
    setData: (k: string, v: string) => { store[k] = v },
    getData: (k: string) => store[k] ?? '',
    get types() { return Object.keys(store) },
    dropEffect: '',
    effectAllowed: '',
  }
}

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

  it('打开文件后视图 tab 显示「预览」按钮（浏览文件时不显示，与原 display:none 行为一致）', async () => {
    const { container } = render(
      <FileWorkspace projectId="p1" onActiveFile={vi.fn()} />
    )
    // 浏览文件态（无文件打开）：无「预览」tab
    await waitFor(() => expect(screen.getAllByText('README.md').length).toBeGreaterThan(0))
    expect(container.querySelector('.fw-tab[data-fw="preview"]')).toBeNull()
    // 打开 README → 出现「预览」tab
    const readme = Array.from(container.querySelectorAll('.fb-tnode:not(.is-folder)')).find(n => n.textContent?.includes('README.md'))!
    fireEvent.click(readme)
    await waitFor(() => {
      const viewTab = container.querySelector('.fw-tab[data-fw="preview"]')
      expect(viewTab?.textContent).toContain('预览')
    })
  })

  it('形态 B：传入 subagents → 出现「Subagent N」视图 tab；无则不出现（spec §4B/§9.3）', async () => {
    const subagents = {
      a: { taskId: 'a', toolUseId: 'a', subagentType: 'general-purpose', status: 'running' as const, description: '调研 X' },
      b: { taskId: 'b', toolUseId: 'b', subagentType: 'web-research', status: 'completed' as const },
    }
    const none = render(<FileWorkspace projectId="p1" onActiveFile={vi.fn()} />)
    await waitFor(() => expect(none.container.querySelector('.fw')).toBeTruthy())
    expect(none.container.querySelector('.fw-tab[data-fw="agents"]')).toBeNull()   // 无子代理 → 无 tab
    none.unmount()

    const { container } = render(<FileWorkspace projectId="p1" onActiveFile={vi.fn()} sliceState={subagents} blocks={[]} />)
    await waitFor(() => {
      const tab = container.querySelector('.fw-tab[data-fw="agents"]')
      expect(tab?.textContent).toContain('Subagent')
      expect(tab?.querySelector('.cnt')?.textContent).toBe('2')
    })
  })

  it('形态 B：D14——无 subagent_type 的纯杂务不进右侧列表（计数与卡片仅含真子代理）', async () => {
    const subagents = {
      chore: { taskId: 'chore', toolUseId: 'chore', status: 'running' as const },                       // 杂务，无 subagentType
      real: { taskId: 'real', toolUseId: 'real', subagentType: 'general-purpose', status: 'running' as const },
    }
    const { container } = render(<FileWorkspace projectId="p1" onActiveFile={vi.fn()} sliceState={subagents} blocks={[]} />)
    await waitFor(() => {
      const tab = container.querySelector('.fw-tab[data-fw="agents"]')
      expect(tab?.querySelector('.cnt')?.textContent).toBe('1')   // 只数真子代理
    })
    fireEvent.click(container.querySelector('.fw-tab[data-fw="agents"]')!)
    await waitFor(() => {
      const panel = container.querySelector('.fw-panel[data-fw="agents"].is-active')
      expect(panel?.querySelectorAll('.sa-card').length).toBe(1)   // 只 1 张卡（杂务被过滤）
      expect(panel?.querySelector('.sa-pbar')?.textContent).toContain('1 个 Subagent')
    })
  })

  it('形态 B：点 Subagent tab → 渲染 agents 面板（每子代理一卡 + 卡头无 chip + 任务描述 sticky）', async () => {
    const subagents = {
      a: { taskId: 'a', toolUseId: 'a', subagentType: 'general-purpose', status: 'running' as const, description: '调研竞品' },
    }
    // 子代理 a 的内部块（parentToolUseId='a'）→ 迷你时间线
    const blocks = [
      { type: 'tool_use' as const, id: 'a', name: 'Task', input: { subagent_type: 'general-purpose', description: '调研竞品' } },
      { type: 'text' as const, text: '子代理在调研', parentToolUseId: 'a' },
    ]
    const { container } = render(<FileWorkspace projectId="p1" onActiveFile={vi.fn()} sliceState={subagents} blocks={blocks} />)
    await waitFor(() => expect(container.querySelector('.fw-tab[data-fw="agents"]')).toBeTruthy())
    fireEvent.click(container.querySelector('.fw-tab[data-fw="agents"]')!)
    await waitFor(() => {
      const panel = container.querySelector('.fw-panel[data-fw="agents"].is-active')
      expect(panel).toBeTruthy()
      expect(panel?.querySelector('.sa-pbar')?.textContent).toContain('1 个 Subagent')
      const card = panel?.querySelector('.sa-card')
      expect(card?.querySelector('.sa-card-head .sa-name')?.textContent).toBe('general-purpose')
      expect(card?.querySelector('.sa-task')?.textContent).toBe('调研竞品')
      // 卡头无 chip（D11：.sa-tag 不出现在卡头）
      expect(card?.querySelector('.sa-card-head .sa-tag')).toBeNull()
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

  describe('右键菜单：重命名 / 删除（阶段3）', () => {
    afterEach(() => { delete (globalThis as { agentShell?: unknown }).agentShell })

    it('右键文件 → 菜单含重命名/删除；点重命名出现内联输入并提交 api.rename', async () => {
      const { container } = render(<FileWorkspace projectId="p1" onActiveFile={vi.fn()} />)
      await waitFor(() => expect(screen.getAllByText('README.md').length).toBeGreaterThan(0))
      const readme = Array.from(container.querySelectorAll('.fb-tnode:not(.is-folder)')).find(n => n.textContent?.includes('README.md'))!
      fireEvent.contextMenu(readme)
      const menu = await waitFor(() => container.querySelector('.ctx-menu')!)
      expect(menu.textContent).toContain('重命名')
      expect(menu.textContent).toContain('删除')
      fireEvent.click(screen.getByText('重命名'))
      const input = await waitFor(() => container.querySelector('.fb-rename-input') as HTMLInputElement)
      fireEvent.change(input, { target: { value: 'NEW.md' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      await waitFor(() => expect(api.rename).toHaveBeenCalledWith('p1', 'README.md', 'NEW.md'))
    })

    it('右键文件 → 删除：经 abs-path 解析后调 bridge.trashItem', async () => {
      const trashItem = vi.fn().mockResolvedValue({ ok: true, failed: [] })
      ;(globalThis as { agentShell?: unknown }).agentShell = { trashItem, showItemInFolder: vi.fn() }
      const { container } = render(<FileWorkspace projectId="p1" onActiveFile={vi.fn()} />)
      await waitFor(() => expect(screen.getAllByText('README.md').length).toBeGreaterThan(0))
      const readme = Array.from(container.querySelectorAll('.fb-tnode:not(.is-folder)')).find(n => n.textContent?.includes('README.md'))!
      fireEvent.contextMenu(readme)
      await waitFor(() => container.querySelector('.ctx-menu'))
      fireEvent.click(screen.getByText('删除（移废纸篓）'))
      await waitFor(() => {
        expect(api.absPath).toHaveBeenCalledWith('p1', 'README.md')
        expect(trashItem).toHaveBeenCalledWith(['/abs/README.md'])
      })
    })

    it('无桥时删除项禁用（不调 trashItem）', async () => {
      const { container } = render(<FileWorkspace projectId="p1" onActiveFile={vi.fn()} />)
      await waitFor(() => expect(screen.getAllByText('README.md').length).toBeGreaterThan(0))
      const readme = Array.from(container.querySelectorAll('.fb-tnode:not(.is-folder)')).find(n => n.textContent?.includes('README.md'))!
      fireEvent.contextMenu(readme)
      await waitFor(() => container.querySelector('.ctx-menu'))
      const del = screen.getByText('删除（移废纸篓）') as HTMLButtonElement
      expect(del.disabled).toBe(true)
    })
  })

  describe('内部拖拽移动（阶段5）', () => {
    it('拖文件节点到文件夹节点 → api.move(paths, destDir) 并刷新树', async () => {
      const dt = makeDataTransfer()
      const { container } = render(<FileWorkspace projectId="p1" onActiveFile={vi.fn()} />)
      await waitFor(() => expect(screen.getAllByText('README.md').length).toBeGreaterThan(0))
      const fileNode = Array.from(container.querySelectorAll('.fb-tnode:not(.is-folder)')).find(n => n.textContent?.includes('README.md'))!
      const folderNode = container.querySelector('.fb-tnode.is-folder')!   // decks
      fireEvent.dragStart(fileNode, { dataTransfer: dt })
      fireEvent.drop(folderNode, { dataTransfer: dt })
      await waitFor(() => expect(api.move).toHaveBeenCalledWith('p1', ['README.md'], 'decks'))
    })

    it('文件夹拖到自身 → 不调 api.move（防自吞）', async () => {
      const dt = makeDataTransfer()
      const { container } = render(<FileWorkspace projectId="p1" onActiveFile={vi.fn()} />)
      await waitFor(() => expect(screen.getAllByText('README.md').length).toBeGreaterThan(0))
      const folderNode = container.querySelector('.fb-tnode.is-folder')!   // decks
      fireEvent.dragStart(folderNode, { dataTransfer: dt })
      fireEvent.drop(folderNode, { dataTransfer: dt })
      await Promise.resolve()
      expect(api.move).not.toHaveBeenCalled()
    })
  })
})
