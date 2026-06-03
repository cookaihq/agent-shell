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

  it('目录节点默认展开，children 可见', () => {
    const { container } = render(<FileTree nodes={tree} onOpen={vi.fn()} />)
    expect(screen.getByText('slide-01.html')).toBeInTheDocument()
  })

  it('点文件夹折叠子节点（.fb-tchildren 隐藏）', () => {
    const { container } = render(<FileTree nodes={tree} onOpen={vi.fn()} />)
    const folder = container.querySelector('.fb-tnode.is-folder') as HTMLElement
    fireEvent.click(folder)
    // 点击后 folder 应加 collapsed，children 应隐藏
    expect(folder.classList.contains('collapsed')).toBe(true)
    const children = folder.nextElementSibling
    expect(children).toBeTruthy()
    expect((children as HTMLElement).hidden).toBe(true)
  })

  it('再次点击文件夹展开子节点', () => {
    const { container } = render(<FileTree nodes={tree} onOpen={vi.fn()} />)
    const folder = container.querySelector('.fb-tnode.is-folder') as HTMLElement
    fireEvent.click(folder) // 折叠
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
    // 展开 decks 文件夹（默认展开，直接点子文件）
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
