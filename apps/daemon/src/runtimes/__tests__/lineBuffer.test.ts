import { describe, it, expect } from 'vitest'
import { LineBuffer } from '../lineBuffer'

describe('LineBuffer', () => {
  it('一块含多行 → 全部完整行返回，无残留', () => {
    const lb = new LineBuffer()
    expect(lb.push('a\nb\nc\n')).toEqual(['a', 'b', 'c'])
    expect(lb.flush()).toEqual([])
  })

  it('JSON 对象被切在两块之间 → 第一块只出完整行、残片留住，第二块补齐', () => {
    const lb = new LineBuffer()
    expect(lb.push('{"x":1}\n{"y":')).toEqual(['{"x":1}'])
    expect(lb.push('2}\n')).toEqual(['{"y":2}'])
    expect(lb.flush()).toEqual([])
  })

  it('末行无换行 → push 不吐，flush 时吐出（codex 无末尾换行 / claude result 末行）', () => {
    const lb = new LineBuffer()
    expect(lb.push('done\n{"last":true}')).toEqual(['done'])
    expect(lb.flush()).toEqual(['{"last":true}'])
    expect(lb.flush()).toEqual([])
  })

  it('flush 在 buffer 空时返回空数组', () => {
    const lb = new LineBuffer()
    expect(lb.push('a\n')).toEqual(['a'])
    expect(lb.flush()).toEqual([])
  })

  it('空字符串 push 不产生行', () => {
    const lb = new LineBuffer()
    expect(lb.push('')).toEqual([])
    expect(lb.flush()).toEqual([])
  })
})
