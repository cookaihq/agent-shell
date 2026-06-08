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

  // Task 6.6.2：斜杠命令面板顶部吸附搜索框
  describe('sticky 搜索框（is-cmd）', () => {
    it('命令候选（is-cmd）+ query 时渲染 mention-search', () => {
      render(
        <MentionPop open={true} items={cmdItems} activeIndex={0} onChoose={vi.fn()} query="cl" />
      )
      const input = document.querySelector<HTMLInputElement>('.mention-search')
      expect(input).toBeTruthy()
      expect(input?.value).toBe('cl')
      expect(input?.readOnly).toBe(true)
    })

    it('query 为空字符串时搜索框仍渲染（value=""）', () => {
      render(
        <MentionPop open={true} items={cmdItems} activeIndex={0} onChoose={vi.fn()} query="" />
      )
      const input = document.querySelector<HTMLInputElement>('.mention-search')
      expect(input).toBeTruthy()
      expect(input?.value).toBe('')
    })

    it('query 未传时搜索框 value 为空字符串（fallback）', () => {
      render(
        <MentionPop open={true} items={cmdItems} activeIndex={0} onChoose={vi.fn()} />
      )
      const input = document.querySelector<HTMLInputElement>('.mention-search')
      expect(input).toBeTruthy()
      expect(input?.value).toBe('')
    })

    it('@ 提及态（非 is-cmd）不渲染搜索框', () => {
      render(
        <MentionPop open={true} items={fileItems} activeIndex={0} onChoose={vi.fn()} query="read" />
      )
      expect(document.querySelector('.mention-search')).toBeNull()
    })

    it('搜索框 mouseDown 调用 onFocusComposer', () => {
      const onFocusComposer = vi.fn()
      render(
        <MentionPop
          open={true} items={cmdItems} activeIndex={0} onChoose={vi.fn()}
          query="cl" onFocusComposer={onFocusComposer}
        />
      )
      const input = document.querySelector<HTMLInputElement>('.mention-search')!
      fireEvent.mouseDown(input)
      expect(onFocusComposer).toHaveBeenCalledTimes(1)
    })

    it('搜索框 tabIndex=-1（不参与 Tab 键盘流）', () => {
      render(
        <MentionPop open={true} items={cmdItems} activeIndex={0} onChoose={vi.fn()} query="" />
      )
      const input = document.querySelector<HTMLInputElement>('.mention-search')
      expect(input?.tabIndex).toBe(-1)
    })
  })
})
