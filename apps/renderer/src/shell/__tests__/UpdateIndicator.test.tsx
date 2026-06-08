import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { UpdateIndicator } from '../UpdateIndicator'

afterEach(() => { delete (globalThis as { agentShell?: unknown }).agentShell })

const UPD = { version: '0.1.0', releasesUrl: 'https://github.com/cookaihq/agent-shell/releases/latest' }

describe('UpdateIndicator', () => {
  it('update=null → 不渲染', () => {
    const { container } = render(<UpdateIndicator update={null} />)
    expect(container.querySelector('.chrome-update')).toBeNull()
  })

  it('有更新 → 图标 + 红点 + title 含版本', () => {
    const { container } = render(<UpdateIndicator update={UPD} />)
    expect(container.querySelector('.chrome-update-dot')).not.toBeNull()
    expect(container.querySelector('.chrome-update-btn')?.getAttribute('title')).toBe('发现新版本 0.1.0')
  })

  it('点图标 toggle 气泡；点「打开下载页」调 openExternal(releasesUrl)', () => {
    const openExternal = vi.fn(() => Promise.resolve({ ok: true }))
    ;(globalThis as Record<string, unknown>).agentShell = { openExternal }
    const { container } = render(<UpdateIndicator update={UPD} />)
    expect(container.querySelector('.chrome-update-pop')).toBeNull()
    fireEvent.click(container.querySelector('.chrome-update-btn')!)
    expect(screen.getByText('发现新版本 0.1.0')).toBeInTheDocument()
    fireEvent.click(screen.getByText('打开下载页'))
    expect(openExternal).toHaveBeenCalledWith(UPD.releasesUrl)
    expect(container.querySelector('.chrome-update-pop')).toBeNull()
  })

  it('点气泡外的背板 → 关闭气泡（含标题栏拖拽区）', () => {
    const { container } = render(<UpdateIndicator update={UPD} />)
    fireEvent.click(container.querySelector('.chrome-update-btn')!)
    expect(container.querySelector('.chrome-update-pop')).not.toBeNull()
    fireEvent.mouseDown(container.querySelector('.chrome-update-backdrop')!)
    expect(container.querySelector('.chrome-update-pop')).toBeNull()
  })
})
