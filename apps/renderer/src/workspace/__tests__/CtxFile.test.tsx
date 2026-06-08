import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CtxFile } from '../CtxFile'

describe('CtxFile — 受控当前文件 chip', () => {
  it('activeFile=null → 隐藏（hidden 按钮）', () => {
    const { container } = render(<CtxFile activeFile={null} excluded={false} onToggleExclude={() => {}} />)
    const btn = container.querySelector('button.ctx-file') as HTMLButtonElement
    expect(btn.hidden).toBe(true)
  })
  it('长文件名 → 尾段含后缀（末 8 字）', () => {
    // baseName='abcdefghij.png'(14) → 尾段 slice(-8)='ghij.png'，头段='abcdef'
    render(<CtxFile activeFile={'src/abcdefghij.png'} excluded={false} onToggleExclude={() => {}} />)
    expect(screen.getByText('ghij.png')).toBeTruthy()
    expect(screen.getByText('abcdef')).toBeTruthy()
  })
  it('excluded=true → is-off 类', () => {
    const { container } = render(<CtxFile activeFile={'a.ts'} excluded={true} onToggleExclude={() => {}} />)
    expect(container.querySelector('button.ctx-file.is-off')).toBeTruthy()
  })
  it('点击 → onToggleExclude(activeFile)', () => {
    const cb = vi.fn()
    const { container } = render(<CtxFile activeFile={'a.ts'} excluded={false} onToggleExclude={cb} />)
    fireEvent.click(container.querySelector('button.ctx-file') as HTMLButtonElement)
    expect(cb).toHaveBeenCalledWith('a.ts')
  })
})
