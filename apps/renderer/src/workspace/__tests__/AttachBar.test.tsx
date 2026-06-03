/**
 * AttachBar.test.tsx — Task 18 TDD
 *
 * 验证：attach-chip 结构、图片显示 ac-thumb、文件显示 ac-ic、× 触发 onRemove
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { AttachBar } from '../AttachBar'
import type { AttachedFile } from '../Composer'

// 构造一个图片附件（objectUrl 非空）
const imgAttachment: AttachedFile = {
  file: new File(['img'], 'photo.png', { type: 'image/png' }),
  objectUrl: 'blob:mock-url-1',
  isImage: true,
}

// 构造一个普通文件附件
const docAttachment: AttachedFile = {
  file: new File(['pdf'], 'report.pdf', { type: 'application/pdf' }),
  objectUrl: '',
  isImage: false,
}

describe('AttachBar', () => {
  it('空附件时 attach-bar 存在但无 chip', () => {
    const { container } = render(<AttachBar attachments={[]} onRemove={vi.fn()} />)
    const bar = container.querySelector('.attach-bar')
    expect(bar).toBeTruthy()
    expect(container.querySelectorAll('.attach-chip').length).toBe(0)
  })

  it('图片附件渲染 ac-thumb（img）', () => {
    const { container } = render(
      <AttachBar attachments={[imgAttachment]} onRemove={vi.fn()} />
    )
    expect(container.querySelector('.ac-thumb')).toBeTruthy()
    expect((container.querySelector('.ac-thumb') as HTMLImageElement).src).toContain('blob:mock-url-1')
  })

  it('非图片附件渲染 ac-ic（文件图标）', () => {
    const { container } = render(
      <AttachBar attachments={[docAttachment]} onRemove={vi.fn()} />
    )
    expect(container.querySelector('.ac-ic')).toBeTruthy()
  })

  it('附件名称渲染在 ac-name', () => {
    render(<AttachBar attachments={[imgAttachment]} onRemove={vi.fn()} />)
    expect(screen.getByText('photo.png')).toBeInTheDocument()
  })

  it('点击 × 按钮调用 onRemove(index)', () => {
    const onRemove = vi.fn()
    const { container } = render(
      <AttachBar attachments={[imgAttachment, docAttachment]} onRemove={onRemove} />
    )
    const xBtns = container.querySelectorAll('.ac-x')
    expect(xBtns.length).toBe(2)
    fireEvent.click(xBtns[1])
    expect(onRemove).toHaveBeenCalledWith(1)
  })

  it('多个附件渲染多个 chip', () => {
    const { container } = render(
      <AttachBar attachments={[imgAttachment, docAttachment]} onRemove={vi.fn()} />
    )
    expect(container.querySelectorAll('.attach-chip').length).toBe(2)
  })
})
