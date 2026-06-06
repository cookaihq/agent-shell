/**
 * AttachBar.test.tsx — 消息附件预览栏
 *
 * 验证：attach-chip 结构、文件/文件夹图标 ac-ic、名字 ac-name、× 触发 onRemove
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { AttachBar, type AttachChip } from '../AttachBar'

const fileChip: AttachChip = { name: 'report.pdf', kind: 'file' }
const dirChip: AttachChip = { name: 'refs', kind: 'dir' }

describe('AttachBar', () => {
  it('空附件时 attach-bar 存在但无 chip', () => {
    const { container } = render(<AttachBar attachments={[]} onRemove={vi.fn()} />)
    expect(container.querySelector('.attach-bar')).toBeTruthy()
    expect(container.querySelectorAll('.attach-chip').length).toBe(0)
  })

  it('文件/文件夹都渲染 ac-ic 图标 + ac-name 名字', () => {
    const { container } = render(<AttachBar attachments={[fileChip, dirChip]} onRemove={vi.fn()} />)
    expect(container.querySelectorAll('.ac-ic').length).toBe(2)
    expect(screen.getByText('report.pdf')).toBeInTheDocument()
    expect(screen.getByText('refs')).toBeInTheDocument()
  })

  it('点击 × 按钮调用 onRemove(index)', () => {
    const onRemove = vi.fn()
    const { container } = render(<AttachBar attachments={[fileChip, dirChip]} onRemove={onRemove} />)
    const xBtns = container.querySelectorAll('.ac-x')
    expect(xBtns.length).toBe(2)
    fireEvent.click(xBtns[1])
    expect(onRemove).toHaveBeenCalledWith(1)
  })

  it('多个附件渲染多个 chip', () => {
    const { container } = render(<AttachBar attachments={[fileChip, dirChip]} onRemove={vi.fn()} />)
    expect(container.querySelectorAll('.attach-chip').length).toBe(2)
  })

  it('带 previewUrl 的图片渲染缩略图 ac-thumb（而非 ac-ic 图标）', () => {
    const imgChip: AttachChip = { name: 'shot.png', kind: 'file', previewUrl: 'blob:fake-url' }
    const { container } = render(<AttachBar attachments={[imgChip]} onRemove={vi.fn()} />)
    const thumb = container.querySelector('img.ac-thumb') as HTMLImageElement | null
    expect(thumb).toBeTruthy()
    expect(thumb?.getAttribute('src')).toBe('blob:fake-url')
    expect(container.querySelector('.ac-ic')).toBeNull()
  })

  it('点击图片缩略图打开 lightbox 大图，点关闭按钮收起', () => {
    const imgChip: AttachChip = { name: 'shot.png', kind: 'file', previewUrl: 'blob:fake-url' }
    const { container } = render(<AttachBar attachments={[imgChip]} onRemove={vi.fn()} />)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(container.querySelector('.ac-view') as Element)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect((dialog.querySelector('img.acl-img') as HTMLImageElement).getAttribute('src')).toBe('blob:fake-url')

    fireEvent.click(dialog.querySelector('.acl-close') as Element)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('lightbox 按 Esc 关闭', () => {
    const imgChip: AttachChip = { name: 'shot.png', kind: 'file', previewUrl: 'blob:fake-url' }
    const { container } = render(<AttachBar attachments={[imgChip]} onRemove={vi.fn()} />)
    fireEvent.click(container.querySelector('.ac-view') as Element)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
