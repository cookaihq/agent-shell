import { renderHook, act } from '@testing-library/react'
import { test, expect } from 'vitest'
import { useMention } from '../useMention'

/** 造一个最小 textarea：value + selectionStart 即可驱动 detect。 */
function ta(value: string): HTMLTextAreaElement {
  const el = { value, selectionStart: value.length, setSelectionRange() {}, focus() {} } as unknown as HTMLTextAreaElement
  return el
}

test('/ 分支吃外部命令源（不再写死 CMDS）', () => {
  const cmds = [{ name: 'deploy', desc: '部署到生产' }, { name: 'plan', desc: '计划模式' }]
  const { result } = renderHook(() => useMention([], [], cmds))
  act(() => { result.current.onInput(ta('/dep')) })
  expect(result.current.open).toBe(true)
  expect(result.current.trig).toBe('/')
  expect(result.current.items).toEqual([
    { insert: '/deploy', icon: 'cmd', label: '/deploy', desc: '部署到生产' },
  ])
})

test('/ 命令源为空 → 面板不开', () => {
  const { result } = renderHook(() => useMention([], [], []))
  act(() => { result.current.onInput(ta('/x')) })
  expect(result.current.open).toBe(false)
})

test('/ 全量命令（空 query）按顺序全列出', () => {
  const cmds = [{ name: 'clear', desc: '清空' }, { name: 'compact', desc: '压缩' }]
  const { result } = renderHook(() => useMention([], [], cmds))
  act(() => { result.current.onInput(ta('/')) })
  expect(result.current.items.map((i) => i.label)).toEqual(['/clear', '/compact'])
})
