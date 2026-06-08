import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PreflightModal } from '../PreflightModal'

const base = { missingSkills: ['gaode', 'map'], hasConflict: false, onGoConfig: vi.fn(), onRunAnyway: vi.fn(), onDrop: vi.fn(), onClose: vi.fn() }

describe('PreflightModal', () => {
  it('列出缺配技能 + 三按钮', () => {
    render(<PreflightModal {...base} />)
    expect(screen.getByText('gaode')).toBeInTheDocument()
    expect(screen.getByText('map')).toBeInTheDocument()
    expect(screen.getByText(/去配置/)).toBeInTheDocument()
    expect(screen.getByText(/仍然运行/)).toBeInTheDocument()
    expect(screen.getByText(/本次不注入/)).toBeInTheDocument()
  })
  it('点三按钮分别回调', async () => {
    const p = { ...base, onGoConfig: vi.fn(), onRunAnyway: vi.fn(), onDrop: vi.fn() }
    render(<PreflightModal {...p} />)
    await userEvent.click(screen.getByText(/去配置/)); expect(p.onGoConfig).toHaveBeenCalled()
    await userEvent.click(screen.getByText(/仍然运行/)); expect(p.onRunAnyway).toHaveBeenCalled()
    await userEvent.click(screen.getByText(/本次不注入/)); expect(p.onDrop).toHaveBeenCalled()
  })
  it('有冲突 → 隐藏「仍然运行」（硬拦 §4）', () => {
    render(<PreflightModal {...base} hasConflict />)
    expect(screen.queryByText(/仍然运行/)).toBeNull()
  })
})
