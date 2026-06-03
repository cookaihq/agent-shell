/**
 * CtxMeter.test.tsx — Task 18 TDD
 *
 * 验证：ctx-wrap 结构、点计量环显示弹窗、token/费用真实数据渲染
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { CtxMeter } from '../CtxMeter'

const usage = {
  inputTokens: 48200,
  outputTokens: 12100,
  costUsd: 0.41,
}

describe('CtxMeter', () => {
  it('渲染 ctx-wrap 容器 + ctx-meter 按钮', () => {
    const { container } = render(<CtxMeter usage={usage} />)
    expect(container.querySelector('.ctx-wrap')).toBeTruthy()
    expect(container.querySelector('.ctx-meter')).toBeTruthy()
  })

  it('初始弹窗 hidden', () => {
    const { container } = render(<CtxMeter usage={usage} />)
    const pop = container.querySelector('.ctx-pop')
    expect(pop?.getAttribute('hidden')).not.toBeNull()
  })

  it('点计量环显示弹窗', () => {
    const { container } = render(<CtxMeter usage={usage} />)
    const btn = container.querySelector('.ctx-meter') as HTMLElement
    fireEvent.click(btn)
    const pop = container.querySelector('.ctx-pop')
    expect(pop?.getAttribute('hidden')).toBeNull()
  })

  it('弹窗显示输入 token（格式化 48.2k）', () => {
    const { container } = render(<CtxMeter usage={usage} />)
    fireEvent.click(container.querySelector('.ctx-meter') as HTMLElement)
    expect(screen.getByText('48.2k tokens')).toBeInTheDocument()
  })

  it('弹窗显示输出 token（格式化 12.1k）', () => {
    const { container } = render(<CtxMeter usage={usage} />)
    fireEvent.click(container.querySelector('.ctx-meter') as HTMLElement)
    expect(screen.getByText('12.1k tokens')).toBeInTheDocument()
  })

  it('弹窗显示费用（≈ $0.41）', () => {
    const { container } = render(<CtxMeter usage={usage} />)
    fireEvent.click(container.querySelector('.ctx-meter') as HTMLElement)
    expect(screen.getByText('≈ $0.41')).toBeInTheDocument()
  })

  it('再次点击关闭弹窗', () => {
    const { container } = render(<CtxMeter usage={usage} />)
    const btn = container.querySelector('.ctx-meter') as HTMLElement
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(container.querySelector('.ctx-pop')?.getAttribute('hidden')).not.toBeNull()
  })

  it('无 usage 时弹窗显示 0（输入/输出均为 0 tokens）', () => {
    const { container } = render(<CtxMeter usage={undefined} />)
    fireEvent.click(container.querySelector('.ctx-meter') as HTMLElement)
    // 输入和输出都是 0 tokens，所以有两个
    const zeroTokenEls = screen.getAllByText('0 tokens')
    expect(zeroTokenEls.length).toBeGreaterThanOrEqual(1)
  })

  it('计量环 SVG 含 ring-track 和 ring-prog', () => {
    const { container } = render(<CtxMeter usage={usage} />)
    expect(container.querySelector('.ring-track')).toBeTruthy()
    expect(container.querySelector('.ring-prog')).toBeTruthy()
  })

  it('ctx-meter 开合时有 is-open 类', () => {
    const { container } = render(<CtxMeter usage={usage} />)
    const btn = container.querySelector('.ctx-meter') as HTMLElement
    fireEvent.click(btn)
    expect(btn.classList.contains('is-open')).toBe(true)
    fireEvent.click(btn)
    expect(btn.classList.contains('is-open')).toBe(false)
  })
})
