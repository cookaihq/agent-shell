/**
 * FileTree.test.tsx — Task 19 TDD
 *
 * 验证 FileTree 组件：
 * - 递归渲染目录树（.fb-tree > .fb-tnode[.is-folder]/.fb-tchildren）
 * - 文件夹展开/收起（caret 切换）
 * - 节点 is-active 高亮
 * - 点文件 onOpen(path)
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { FileTree } from '../FileTree'
import type { FileNode } from '../../api/types'

const tree: FileNode[] = [
  {
    name: 'decks',
    path: 'decks',
    type: 'dir',
    children: [
      {
        name: 'slide-01.html',
        path: 'decks/slide-01.html',
        type: 'file',
      },
      {
        name: 'styles.css',
        path: 'decks/styles.css',
        type: 'file',
      },
    ],
  },
  {
    name: 'README.md',
    path: 'README.md',
    type: 'file',
  },
]

describe('FileTree', () => {
  it('渲染目录节点（.fb-tnode.is-folder）', () => {
    const { container } = render(<FileTree nodes={tree} onOpen={vi.fn()} />)
    const folders = container.querySelectorAll('.fb-tnode.is-folder')
    expect(folders.length).toBeGreaterThan(0)
    expect(folders[0].textContent).toContain('decks')
  })

  it('渲染文件节点（.fb-tnode 不含 is-folder）', () => {
    const { container } = render(<FileTree nodes={tree} onOpen={vi.fn()} />)
    // README.md 是顶层文件
    expect(screen.getByText('README.md')).toBeInTheDocument()
  })

  it('目录节点默认折叠，children 隐藏（feedback-2 Issue 7）', () => {
    const { container } = render(<FileTree nodes={tree} onOpen={vi.fn()} />)
    const folder = container.querySelector('.fb-tnode.is-folder') as HTMLElement
    // decks 初始带 collapsed
    expect(folder.classList.contains('collapsed')).toBe(true)
    // 其 .fb-tchildren 容器 hidden=true
    const children = folder.nextElementSibling as HTMLElement
    expect(children.classList.contains('fb-tchildren')).toBe(true)
    expect(children.hidden).toBe(true)
    // slide-01.html 虽在 DOM 中但被 hidden 容器包裹 → 初始不可见
    expect(children.contains(screen.getByText('slide-01.html'))).toBe(true)
  })

  it('点文件夹折叠子节点（.fb-tchildren 隐藏）', () => {
    const { container } = render(<FileTree nodes={tree} onOpen={vi.fn()} />)
    const folder = container.querySelector('.fb-tnode.is-folder') as HTMLElement
    // 默认折叠（feedback-2 Issue 7）：先点开到展开态，再点一次验证折叠
    fireEvent.click(folder) // 展开
    fireEvent.click(folder) // 折叠
    expect(folder.classList.contains('collapsed')).toBe(true)
    const children = folder.nextElementSibling
    expect(children).toBeTruthy()
    expect((children as HTMLElement).hidden).toBe(true)
  })

  it('再次点击文件夹展开子节点', () => {
    const { container } = render(<FileTree nodes={tree} onOpen={vi.fn()} />)
    const folder = container.querySelector('.fb-tnode.is-folder') as HTMLElement
    // 默认折叠（feedback-2 Issue 7）：单击即展开
    fireEvent.click(folder) // 展开
    expect(folder.classList.contains('collapsed')).toBe(false)
    const children = folder.nextElementSibling
    expect((children as HTMLElement).hidden).toBe(false)
  })

  it('点文件节点调用 onOpen(path)', () => {
    const onOpen = vi.fn()
    const { container } = render(<FileTree nodes={tree} onOpen={onOpen} />)
    // 找到 README.md 节点（顶层文件，直接可见）
    const fileNodes = Array.from(container.querySelectorAll('.fb-tnode:not(.is-folder)'))
    const readme = fileNodes.find(n => n.textContent?.includes('README.md'))
    fireEvent.click(readme!)
    expect(onOpen).toHaveBeenCalledWith('README.md')
  })

  it('点文件节点后加 is-active 高亮', () => {
    const { container } = render(<FileTree nodes={tree} onOpen={vi.fn()} />)
    const fileNodes = Array.from(container.querySelectorAll('.fb-tnode:not(.is-folder)'))
    const readme = fileNodes.find(n => n.textContent?.includes('README.md'))!
    fireEvent.click(readme)
    expect(readme.classList.contains('is-active')).toBe(true)
  })

  it('点新节点后旧节点 is-active 移除', () => {
    const { container } = render(<FileTree nodes={tree} onOpen={vi.fn()} />)
    // 默认折叠（feedback-2 Issue 7）：先点开 decks 文件夹再取子文件 slide-01.html
    const folder = container.querySelector('.fb-tnode.is-folder') as HTMLElement
    fireEvent.click(folder)
    const fileNodes = Array.from(container.querySelectorAll('.fb-tnode:not(.is-folder)'))
    const readme = fileNodes.find(n => n.textContent?.includes('README.md'))!
    const slide = fileNodes.find(n => n.textContent?.includes('slide-01.html'))!
    fireEvent.click(readme)
    expect(readme.classList.contains('is-active')).toBe(true)
    fireEvent.click(slide)
    expect(readme.classList.contains('is-active')).toBe(false)
    expect(slide.classList.contains('is-active')).toBe(true)
  })

  it('渲染 .fb-tchildren 包裹子节点', () => {
    const { container } = render(<FileTree nodes={tree} onOpen={vi.fn()} />)
    expect(container.querySelector('.fb-tchildren')).toBeTruthy()
  })
})
