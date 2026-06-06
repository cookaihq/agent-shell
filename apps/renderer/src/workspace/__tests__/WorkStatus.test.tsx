import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WorkStatus } from '../WorkStatus'

describe('WorkStatus', () => {
  it('无 label → 起步态「处理中…」，无 tokens 段', () => {
    const { container } = render(<WorkStatus />)
    expect(screen.getByText('处理中…')).toBeInTheDocument()
    expect(container.querySelector('.ws-tokens')).toBeNull()
  })
  it('有 label + tokens → 动作文案 + tokens 段', () => {
    const { container } = render(<WorkStatus tokens={1500} label="思考中" />)
    expect(screen.getByText('思考中')).toBeInTheDocument()
    expect(container.querySelector('.ws-tokens')?.textContent).toContain('1.5K')
  })
})
