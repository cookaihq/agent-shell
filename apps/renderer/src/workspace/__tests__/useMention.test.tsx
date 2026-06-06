/**
 * useMention.test.tsx — Task 17 TDD
 *
 * 测试 useMention hook：detect 正则、候选构建、键盘导航、选中插入
 */
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useMention } from '../useMention'

// 工厂：造一个 textarea 并设定值与光标位置
function makeTA(value: string, cursor?: number): HTMLTextAreaElement {
  const ta = document.createElement('textarea')
  ta.value = value
  const pos = cursor ?? value.length
  ta.setSelectionRange(pos, pos)
  return ta
}

describe('useMention — detect', () => {
  it('行首 @ 触发 trig=@ query=空（有文件候选）', () => {
    // 需要至少一个文件候选才能打开菜单；无候选时正确行为是不显示
    const { result } = renderHook(() => useMention(['README.md', 'src/index.ts'], [], []))
    const ta = makeTA('@')
    act(() => { result.current.onInput(ta) })
    expect(result.current.open).toBe(true)
    expect(result.current.trig).toBe('@')
    expect(result.current.query).toBe('')
  })

  it('@re 过滤文件名含 re', () => {
    const files = ['README.md', 'src/index.ts', 'readme.txt']
    const { result } = renderHook(() => useMention(files, [], []))
    const ta = makeTA('@re')
    act(() => { result.current.onInput(ta) })
    expect(result.current.open).toBe(true)
    const labels = result.current.items.map(i => i.label)
    expect(labels).toContain('README.md')
    expect(labels).toContain('readme.txt')
    expect(labels).not.toContain('src/index.ts')
  })

  it('空格后 @ 也能触发', () => {
    const { result } = renderHook(() => useMention(['foo.ts'], [], []))
    const ta = makeTA('hello @foo')
    act(() => { result.current.onInput(ta) })
    expect(result.current.open).toBe(true)
    expect(result.current.trig).toBe('@')
    expect(result.current.query).toBe('foo')
  })

  it('/ 触发命令候选', () => {
    const cmds = [{ name: 'clear', desc: '清空当前会话' }]
    const { result } = renderHook(() => useMention([], [], cmds))
    const ta = makeTA('/cl')
    act(() => { result.current.onInput(ta) })
    expect(result.current.open).toBe(true)
    expect(result.current.trig).toBe('/')
    const labels = result.current.items.map(i => i.label)
    expect(labels).toContain('/clear')
  })

  it('@decks/ 含斜杠路径前缀仍能筛选该目录下文件（对齐原型，query 允许含 /）', () => {
    const files = ['decks/seed/slide-01.html', 'decks/seed/styles.css', 'src/index.ts']
    const { result } = renderHook(() => useMention(files, [], []))
    const ta = makeTA('@decks/seed/')
    act(() => { result.current.onInput(ta) })
    expect(result.current.open).toBe(true)
    expect(result.current.query).toBe('decks/seed/')
    const labels = result.current.items.map(i => i.label)
    expect(labels).toContain('decks/seed/slide-01.html')
    expect(labels).toContain('decks/seed/styles.css')
    expect(labels).not.toContain('src/index.ts')
  })

  it('http:// 里的 / 前是字母，不被当触发符', () => {
    const { result } = renderHook(() => useMention(['foo.ts'], [], []))
    const ta = makeTA('see http://')
    act(() => { result.current.onInput(ta) })
    expect(result.current.open).toBe(false)
  })

  it('普通文字不触发', () => {
    const { result } = renderHook(() => useMention([], [], []))
    const ta = makeTA('hello world')
    act(() => { result.current.onInput(ta) })
    expect(result.current.open).toBe(false)
  })

  it('无匹配候选时关闭', () => {
    const { result } = renderHook(() => useMention(['foo.ts'], [], []))
    const ta = makeTA('@zzznomatch')
    act(() => { result.current.onInput(ta) })
    expect(result.current.open).toBe(false)
  })
})

describe('useMention — keyboard nav', () => {
  it('ArrowDown 移到下一项，ArrowUp 回上一项', () => {
    const files = ['a.ts', 'b.ts', 'c.ts']
    const { result } = renderHook(() => useMention(files, [], []))
    // open menu
    act(() => { result.current.onInput(makeTA('@')) })
    expect(result.current.activeIndex).toBe(0)
    act(() => {
      const e = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
      result.current.onKeyDown(e as unknown as React.KeyboardEvent<HTMLTextAreaElement>)
    })
    expect(result.current.activeIndex).toBe(1)
    act(() => {
      const e = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })
      result.current.onKeyDown(e as unknown as React.KeyboardEvent<HTMLTextAreaElement>)
    })
    expect(result.current.activeIndex).toBe(0)
  })

  it('ArrowUp 在 index=0 时循环到末尾', () => {
    const { result } = renderHook(() => useMention(['a.ts', 'b.ts'], [], []))
    act(() => { result.current.onInput(makeTA('@')) })
    expect(result.current.activeIndex).toBe(0)
    act(() => {
      const e = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })
      result.current.onKeyDown(e as unknown as React.KeyboardEvent<HTMLTextAreaElement>)
    })
    expect(result.current.activeIndex).toBe(result.current.items.length - 1)
  })

  it('Esc 关闭菜单', () => {
    const { result } = renderHook(() => useMention(['x.ts'], [], []))
    act(() => { result.current.onInput(makeTA('@')) })
    expect(result.current.open).toBe(true)
    act(() => {
      const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      result.current.onKeyDown(e as unknown as React.KeyboardEvent<HTMLTextAreaElement>)
    })
    expect(result.current.open).toBe(false)
  })
})

describe('useMention — choose', () => {
  it('Enter 选中 → 插入文本 + 关闭', () => {
    const { result } = renderHook(() => useMention(['README.md'], [], []))
    const ta = makeTA('@re')
    act(() => { result.current.onInput(ta) })
    expect(result.current.open).toBe(true)

    let newText = ''
    act(() => {
      newText = result.current.choose(ta)
    })
    expect(newText).toContain('@README.md')
    expect(result.current.open).toBe(false)
  })

  it('/ 命令选中 → 插入 /clear', () => {
    const cmds = [{ name: 'clear', desc: '清空当前会话' }]
    const { result } = renderHook(() => useMention([], [], cmds))
    const ta = makeTA('/cl')
    act(() => { result.current.onInput(ta) })

    let newText = ''
    act(() => {
      newText = result.current.choose(ta)
    })
    expect(newText).toContain('/clear')
    expect(result.current.open).toBe(false)
  })
})
