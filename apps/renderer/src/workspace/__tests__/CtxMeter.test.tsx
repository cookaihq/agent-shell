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

  it('弹窗显示输入 token（格式化 48.2K）', () => {
    const { container } = render(<CtxMeter usage={usage} />)
    fireEvent.click(container.querySelector('.ctx-meter') as HTMLElement)
    expect(screen.getByText('48.2K tokens')).toBeInTheDocument()
  })

  it('弹窗显示输出 token（格式化 12.1K）', () => {
    const { container } = render(<CtxMeter usage={usage} />)
    fireEvent.click(container.querySelector('.ctx-meter') as HTMLElement)
    expect(screen.getByText('12.1K tokens')).toBeInTheDocument()
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

  it('Issue 10：运行中 liveTokens 实时近似——新会话(usage=0)也显示实时输出 + 「实时」标记，不再停在 0', () => {
    // 新会话：还没有 result，usage 全 0；运行中 progress 估算 4100 tokens
    const { container } = render(<CtxMeter usage={{ inputTokens: 0, outputTokens: 0, costUsd: 0 }} liveTokens={4100} />)
    fireEvent.click(container.querySelector('.ctx-meter') as HTMLElement)
    // 「本次会话」标题带「实时」标记
    expect(container.querySelector('.ctx-pop-h .ctx-live')).toBeTruthy()
    // 输出反映实时估算（4.1K），而非 0
    expect(screen.getByText('4.1K tokens')).toBeInTheDocument()
    // 上下文「已用」也随实时动（不再是「已用 0」）
    expect(container.querySelector('.ctx-bar span')?.getAttribute('style')).not.toContain('width: 0%')
  })

  it('非运行中（无 liveTokens）：不显示「实时」标记，按 usage 落库值', () => {
    const { container } = render(<CtxMeter usage={usage} />)
    fireEvent.click(container.querySelector('.ctx-meter') as HTMLElement)
    expect(container.querySelector('.ctx-pop-h .ctx-live')).toBeNull()
  })
})
