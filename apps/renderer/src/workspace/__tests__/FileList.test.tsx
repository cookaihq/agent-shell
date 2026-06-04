import { render } from '@testing-library/react'
import { test, expect, vi } from 'vitest'
import { FileList } from '../FileList'
import type { FileNode } from '../../api/types'

const tree: FileNode[] = [
  {
    name: 'src', path: 'src', type: 'dir', children: [
      { name: 'a.ts', path: 'src/a.ts', type: 'file' },
      { name: 'b.ts', path: 'src/b.ts', type: 'file' },
      { name: 'styles', path: 'src/styles', type: 'dir', children: [
        { name: 'main.css', path: 'src/styles/main.css', type: 'file' },
      ] },
    ],
  },
  { name: 'README.md', path: 'README.md', type: 'file' },
]

test('选中根：有子文件夹 → 一级按子文件夹分组（src 文件夹 section）', () => {
  const { container } = render(<FileList nodes={tree} selectedDir="" onOpen={vi.fn()} />)
  const folderHeads = Array.from(container.querySelectorAll('.fb-folder-h')).map((e) => e.textContent)
  // 根下有 src 子文件夹 + 直接文件 README.md（当前目录组）
  expect(folderHeads.some((t) => t?.includes('src'))).toBe(true)
  expect(folderHeads.some((t) => t?.includes('当前目录'))).toBe(true)
  // src 组里递归收集到 3 个文件（a.ts/b.ts/main.css）
  expect(folderHeads.find((t) => t?.includes('src'))).toContain('3')
})

test('选中 src：仍有子文件夹 styles → 按子文件夹分组；次级按类型', () => {
  const { container } = render(<FileList nodes={tree} selectedDir="src" onOpen={vi.fn()} />)
  const folderHeads = Array.from(container.querySelectorAll('.fb-folder-h')).map((e) => e.textContent)
  expect(folderHeads.some((t) => t?.includes('styles'))).toBe(true)
  // 次级类型分组存在
  expect(container.querySelector('.fb-group')).toBeTruthy()
})

test('选中无子文件夹的目录 → 平铺按类型（无 folder section）', () => {
  const { container } = render(<FileList nodes={tree} selectedDir="src/styles" onOpen={vi.fn()} />)
  expect(container.querySelector('.fb-folder-sec')).toBeNull()
  expect(container.querySelector('.fb-group')?.textContent).toContain('样式表')
})
