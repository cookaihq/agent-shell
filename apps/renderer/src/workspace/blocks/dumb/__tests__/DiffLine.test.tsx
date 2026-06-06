import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { DiffLine } from '../DiffLine'
import type { DiffRow } from '../../diff'

describe('DiffLine', () => {
  it('add 行：符号 + 且含文本', () => {
    const row: DiffRow = { type: 'add', text: 'hello', newNo: 2 }
    const { container } = render(<DiffLine row={row} />)
    expect(container.querySelector('.dl.add')).toBeTruthy()
    expect(container.querySelector('.dl-sign')?.textContent).toBe('+')
    expect(container.querySelector('.dl-text')?.textContent).toBe('hello')
  })

  it('del 行：符号 − 且含文本', () => {
    const row: DiffRow = { type: 'del', text: 'world', oldNo: 1 }
    const { container } = render(<DiffLine row={row} />)
    expect(container.querySelector('.dl.del')).toBeTruthy()
    expect(container.querySelector('.dl-sign')?.textContent).toBe('−')
    expect(container.querySelector('.dl-text')?.textContent).toBe('world')
  })

  it('ctx 行：符号为空格', () => {
    const row: DiffRow = { type: 'ctx', text: 'unchanged', oldNo: 1, newNo: 1 }
    const { container } = render(<DiffLine row={row} />)
    expect(container.querySelector('.dl.ctx')).toBeTruthy()
    expect(container.querySelector('.dl-sign')?.textContent).toBe(' ')
  })

  it('空文本行渲染为单个空格（保持行高）', () => {
    const row: DiffRow = { type: 'ctx', text: '', oldNo: 1, newNo: 1 }
    const { container } = render(<DiffLine row={row} />)
    expect(container.querySelector('.dl-text')?.textContent).toBe(' ')
  })

  it('行号渲染到 .dl-no（add 行仅有新行号）', () => {
    const row: DiffRow = { type: 'add', text: 'x', newNo: 5 }
    const { container } = render(<DiffLine row={row} />)
    const nos = container.querySelectorAll('.dl-no')
    expect(nos.length).toBe(2)
    // 旧行号 no 为空，新行号为 5
    expect(nos[0].textContent).toBe('')
    expect(nos[1].textContent).toBe('5')
  })
})
