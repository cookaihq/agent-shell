/**
 * MentionPop.test.tsx — Task 17 TDD
 *
 * 验证：mention-pop 结构 className、分组头、is-active 高亮、鼠标点击 onChoose
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MentionPop } from '../MentionPop'
import type { MentionItem } from '../useMention'

const fileItems: MentionItem[] = [
  { insert: '@README.md', group: '文件', label: 'README.md', icon: 'file' },
  { insert: '@src/index.ts', group: '文件', label: 'src/index.ts', icon: 'file' },
]

const cmdItems: MentionItem[] = [
  { insert: '/clear', label: '/clear', icon: 'cmd', desc: '清空当前会话' },
  { insert: '/compact', label: '/compact', icon: 'cmd', desc: '压缩上下文' },
]

describe('MentionPop', () => {
  it('hidden=true 时不渲染内容', () => {
    const { container } = render(
      <MentionPop open={false} items={fileItems} activeIndex={0} onChoose={vi.fn()} />
    )
    const pop = container.querySelector('.mention-pop')
    expect(pop).toBeTruthy()
    expect(pop?.getAttribute('hidden')).not.toBeNull()
  })

  it('open=true 时渲染 mention-item', () => {
    render(
      <MentionPop open={true} items={fileItems} activeIndex={0} onChoose={vi.fn()} />
    )
    const items = document.querySelectorAll('.mention-item')
    expect(items.length).toBe(2)
  })

  it('渲染分组头 mention-group-h', () => {
    render(
      <MentionPop open={true} items={fileItems} activeIndex={0} onChoose={vi.fn()} />
    )
    expect(document.querySelector('.mention-group-h')?.textContent).toBe('文件')
  })

  it('activeIndex 对应的 item 有 is-active 类', () => {
    render(
      <MentionPop open={true} items={fileItems} activeIndex={1} onChoose={vi.fn()} />
    )
    const items = document.querySelectorAll('.mention-item')
    expect(items[0].classList.contains('is-active')).toBe(false)
    expect(items[1].classList.contains('is-active')).toBe(true)
  })

  it('点击 mention-item 调用 onChoose(index)', () => {
    const onChoose = vi.fn()
    render(
      <MentionPop open={true} items={fileItems} activeIndex={0} onChoose={onChoose} />
    )
    const items = document.querySelectorAll('.mention-item')
    fireEvent.mouseDown(items[1])
    expect(onChoose).toHaveBeenCalledWith(1)
  })

  it('命令候选渲染 desc (i 标签)', () => {
    render(
      <MentionPop open={true} items={cmdItems} activeIndex={0} onChoose={vi.fn()} />
    )
    expect(screen.getByText('清空当前会话')).toBeInTheDocument()
  })

  it('无分组时不渲染 mention-group-h', () => {
    render(
      <MentionPop open={true} items={cmdItems} activeIndex={0} onChoose={vi.fn()} />
    )
    expect(document.querySelectorAll('.mention-group-h').length).toBe(0)
  })

  it('渲染 mention-ic 和 mention-main 子结构', () => {
    render(
      <MentionPop open={true} items={fileItems} activeIndex={0} onChoose={vi.fn()} />
    )
    expect(document.querySelector('.mention-ic')).toBeTruthy()
    expect(document.querySelector('.mention-main')).toBeTruthy()
    expect(document.querySelector('.mention-main b')).toBeTruthy()
  })
})
