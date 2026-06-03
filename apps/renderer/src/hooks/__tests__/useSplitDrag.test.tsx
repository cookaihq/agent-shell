import { renderHook, act } from '@testing-library/react'
import { useSplitDrag } from '../useSplitDrag'

test('拖动改列宽且夹下限', () => {
  const { result } = renderHook(() => useSplitDrag())

  const el = document.createElement('div')
  el.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, right: 1000, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => {} } as DOMRect)
  ;(result.current.containerRef as any).current = el

  // mousedown on handle
  act(() => { result.current.handleProps.onMouseDown({ preventDefault() {} } as any) })

  // mousemove to clientX=100 — less than MIN_LEFT(320), should be clamped to 320
  act(() => { document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 })) })
  expect(result.current.cols).toContain('320px')

  // mouseup stops drag
  act(() => { document.dispatchEvent(new MouseEvent('mouseup')) })
})

test('mousemove within valid range updates cols correctly', () => {
  const { result } = renderHook(() => useSplitDrag())

  const el = document.createElement('div')
  el.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, right: 1000, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => {} } as DOMRect)
  ;(result.current.containerRef as any).current = el

  act(() => { result.current.handleProps.onMouseDown({ preventDefault() {} } as any) })

  // clientX=500 → left=500, within [320, 1000-6-360=634]
  act(() => { document.dispatchEvent(new MouseEvent('mousemove', { clientX: 500 })) })
  expect(result.current.cols).toBe('500px 6px 1fr')

  act(() => { document.dispatchEvent(new MouseEvent('mouseup')) })
})

test('no drag without mousedown', () => {
  const { result } = renderHook(() => useSplitDrag())

  const el = document.createElement('div')
  el.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, right: 1000, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => {} } as DOMRect)
  ;(result.current.containerRef as any).current = el

  // No mousedown — cols stays undefined
  act(() => { document.dispatchEvent(new MouseEvent('mousemove', { clientX: 500 })) })
  expect(result.current.cols).toBeUndefined()
})
