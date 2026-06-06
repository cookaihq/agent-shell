/**
 * ContextMenu.test.tsx — 受控浮层菜单（2026-06-05 设计 §5.1 / §10）
 *
 * 验证：渲染 items + 分隔符；点项先关后触发 onClick；点外部 / Esc 关闭；disabled 项不触发。
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ContextMenu, type MenuItem } from '../ContextMenu'

describe('ContextMenu', () => {
  it('渲染所有 items（按钮）与分隔符', () => {
    const items: MenuItem[] = [
      { label: '打开', onClick: vi.fn() },
      { separator: true },
      { label: '删除', danger: true, onClick: vi.fn() },
    ]
    const { container } = render(<ContextMenu x={10} y={10} items={items} onClose={vi.fn()} />)
    expect(screen.getByText('打开')).toBeInTheDocument()
    expect(screen.getByText('删除')).toBeInTheDocument()
    expect(container.querySelector('.ctx-menu-sep')).toBeTruthy()
    expect(container.querySelector('.ctx-menu-item.danger')?.textContent).toBe('删除')
  })

  it('点某项：先 onClose 再执行该项 onClick', () => {
    const order: string[] = []
    const onClose = vi.fn(() => order.push('close'))
    const onClick = vi.fn(() => order.push('click'))
    render(<ContextMenu x={0} y={0} items={[{ label: '打开', onClick }]} onClose={onClose} />)
    fireEvent.click(screen.getByText('打开'))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['close', 'click'])
  })

  it('disabled 项点击不触发 onClick', () => {
    const onClick = vi.fn()
    render(<ContextMenu x={0} y={0} items={[{ label: '删除', disabled: true, onClick }]} onClose={vi.fn()} />)
    const btn = screen.getByText('删除') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('点菜单外部关闭（mousedown 捕获）', () => {
    const onClose = vi.fn()
    render(<ContextMenu x={0} y={0} items={[{ label: '打开', onClick: vi.fn() }]} onClose={onClose} />)
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('点菜单内部不关闭', () => {
    const onClose = vi.fn()
    const { container } = render(<ContextMenu x={0} y={0} items={[{ label: '打开', onClick: vi.fn() }]} onClose={onClose} />)
    fireEvent.mouseDown(container.querySelector('.ctx-menu')!)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Esc 关闭', () => {
    const onClose = vi.fn()
    render(<ContextMenu x={0} y={0} items={[{ label: '打开', onClick: vi.fn() }]} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
