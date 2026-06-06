/**
 * CtxMeter.test.tsx — Task 18 TDD + Task 1.5 TDD
 *
 * 验证：ctx-wrap 结构、点计量环显示弹窗、token/费用真实数据渲染
 * Task 1.5 新增：contextTokens 百分比基准、costUsd undefined 隐藏费用行、engine prop
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
    const { container } = render(<CtxMeter usage={usage} engine="claude" />)
    expect(container.querySelector('.ctx-wrap')).toBeTruthy()
    expect(container.querySelector('.ctx-meter')).toBeTruthy()
  })

  it('初始弹窗 hidden', () => {
    const { container } = render(<CtxMeter usage={usage} engine="claude" />)
    const pop = container.querySelector('.ctx-pop')
    expect(pop?.getAttribute('hidden')).not.toBeNull()
  })

  it('点计量环显示弹窗', () => {
    const { container } = render(<CtxMeter usage={usage} engine="claude" />)
    const btn = container.querySelector('.ctx-meter') as HTMLElement
    fireEvent.click(btn)
    const pop = container.querySelector('.ctx-pop')
    expect(pop?.getAttribute('hidden')).toBeNull()
  })

  it('弹窗显示输入 token（格式化 48.2K）', () => {
    const { container } = render(<CtxMeter usage={usage} engine="claude" />)
    fireEvent.click(container.querySelector('.ctx-meter') as HTMLElement)
    expect(screen.getByText('48.2K tokens')).toBeInTheDocument()
  })

  it('弹窗显示输出 token（格式化 12.1K）', () => {
    const { container } = render(<CtxMeter usage={usage} engine="claude" />)
    fireEvent.click(container.querySelector('.ctx-meter') as HTMLElement)
    expect(screen.getByText('12.1K tokens')).toBeInTheDocument()
  })

  it('弹窗显示费用（≈ $0.41）', () => {
    const { container } = render(<CtxMeter usage={usage} engine="claude" />)
    fireEvent.click(container.querySelector('.ctx-meter') as HTMLElement)
    expect(screen.getByText('≈ $0.41')).toBeInTheDocument()
  })

  it('再次点击关闭弹窗', () => {
    const { container } = render(<CtxMeter usage={usage} engine="claude" />)
    const btn = container.querySelector('.ctx-meter') as HTMLElement
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(container.querySelector('.ctx-pop')?.getAttribute('hidden')).not.toBeNull()
  })

  it('无 usage 时弹窗显示 0（输入/输出均为 0 tokens）', () => {
    const { container } = render(<CtxMeter usage={undefined} engine="claude" />)
    fireEvent.click(container.querySelector('.ctx-meter') as HTMLElement)
    // 输入和输出都是 0 tokens，所以有两个
    const zeroTokenEls = screen.getAllByText('0 tokens')
    expect(zeroTokenEls.length).toBeGreaterThanOrEqual(1)
  })

  it('计量环 SVG 含 ring-track 和 ring-prog', () => {
    const { container } = render(<CtxMeter usage={usage} engine="claude" />)
    expect(container.querySelector('.ring-track')).toBeTruthy()
    expect(container.querySelector('.ring-prog')).toBeTruthy()
  })

  it('ctx-meter 开合时有 is-open 类', () => {
    const { container } = render(<CtxMeter usage={usage} engine="claude" />)
    const btn = container.querySelector('.ctx-meter') as HTMLElement
    fireEvent.click(btn)
    expect(btn.classList.contains('is-open')).toBe(true)
    fireEvent.click(btn)
    expect(btn.classList.contains('is-open')).toBe(false)
  })

  it('Issue 10：运行中 liveTokens 实时近似——新会话(usage=0)也显示实时输出 + 「实时」标记，不再停在 0', () => {
    // 新会话：还没有 result，usage 全 0；运行中 progress 估算 4100 tokens
    const { container } = render(<CtxMeter usage={{ inputTokens: 0, outputTokens: 0, costUsd: 0 }} liveTokens={4100} engine="claude" />)
    fireEvent.click(container.querySelector('.ctx-meter') as HTMLElement)
    // 「本次会话」标题带「实时」标记
    expect(container.querySelector('.ctx-pop-h .ctx-live')).toBeTruthy()
    // 输出反映实时估算（4.1K），而非 0
    expect(screen.getByText('4.1K tokens')).toBeInTheDocument()
    // 上下文「已用」也随实时动（不再是「已用 0」）
    expect(container.querySelector('.ctx-bar span')?.getAttribute('style')).not.toContain('width: 0%')
  })

  it('非运行中（无 liveTokens）：不显示「实时」标记，按 usage 落库值', () => {
    const { container } = render(<CtxMeter usage={usage} engine="claude" />)
    fireEvent.click(container.querySelector('.ctx-meter') as HTMLElement)
    expect(container.querySelector('.ctx-pop-h .ctx-live')).toBeNull()
  })
})

// ── Task 1.5 新增测试 ──────────────────────────────────────────────────────────

describe('CtxMeter – Task 1.5', () => {
  it('contextTokens 存在时，百分比基准用 contextTokens 而非 inputTokens', () => {
    // contextTokens(含 cache) = 80000，远大于 inputTokens = 20000
    // 以 200k 窗口算：contextTokens → 40%，inputTokens → 10%
    const usageWithCtx = {
      inputTokens: 20_000,
      outputTokens: 5_000,
      costUsd: 0.10,
      contextTokens: 80_000,
    }
    const { container } = render(<CtxMeter usage={usageWithCtx} engine="claude" />)
    fireEvent.click(container.querySelector('.ctx-meter') as HTMLElement)
    // 百分比应反映 contextTokens=80k / 200k = 40%
    expect(screen.getByText('40%')).toBeInTheDocument()
    // 而非 inputTokens=20k / 200k = 10%
    expect(screen.queryByText('10%')).toBeNull()
  })

  it('costUsd === undefined 时不渲染「费用」行', () => {
    const usageNoCost = { inputTokens: 100, outputTokens: 50 }
    const { container } = render(<CtxMeter usage={usageNoCost} engine="codex" />)
    fireEvent.click(container.querySelector('.ctx-meter') as HTMLElement)
    expect(screen.queryByText('费用')).toBeNull()
  })

  it('costUsd 为数字时渲染「费用」行', () => {
    const usageWithCost = { inputTokens: 48200, outputTokens: 12100, costUsd: 0.41 }
    const { container } = render(<CtxMeter usage={usageWithCost} engine="claude" />)
    fireEvent.click(container.querySelector('.ctx-meter') as HTMLElement)
    expect(screen.getByText('费用')).toBeInTheDocument()
    expect(screen.getByText('≈ $0.41')).toBeInTheDocument()
  })

  it('engine prop 传 claude 时用切片 getContextWindowSize 回落（无 contextWindow + model 无缓存）', () => {
    // model 随机串 → localStorage 没缓存；usage 无 contextWindow；engine=claude → 切片给 200k
    const usageNoWin = { inputTokens: 100_000, outputTokens: 5_000 }
    const { container } = render(<CtxMeter usage={usageNoWin} engine="claude" model="claude-opus-4-8" />)
    fireEvent.click(container.querySelector('.ctx-meter') as HTMLElement)
    // 100k / 200k = 50%
    expect(screen.getByText('50%')).toBeInTheDocument()
  })

  it('model id 含 [1m] 时 engine=claude 切片给 1M 窗口', () => {
    const usageNoWin = { inputTokens: 100_000, outputTokens: 5_000 }
    const { container } = render(
      <CtxMeter usage={usageNoWin} engine="claude" model="claude-opus-4-8[1m]" />
    )
    fireEvent.click(container.querySelector('.ctx-meter') as HTMLElement)
    // 100k / 1M = 10%
    expect(screen.getByText('10%')).toBeInTheDocument()
  })
})
