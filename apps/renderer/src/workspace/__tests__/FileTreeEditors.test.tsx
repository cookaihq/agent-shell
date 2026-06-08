import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FileTree } from '../FileTree'

const editors = [
  { id: 'vscode', label: 'VS Code', installed: true },
  { id: 'zed', label: 'Zed', installed: false },
]

describe('FileTree 在编辑器中打开 caret', () => {
  it('无 editors（undefined，无桥）→ 不渲染 caret 按钮', () => {
    render(<FileTree nodes={[]} onOpen={() => {}} />)
    expect(screen.queryByTitle('在编辑器中打开')).toBeNull()
  })
  it('editors=[]（有桥但尚未检测）→ 仍渲染 caret，点击触发懒检测（防死锁回归）', () => {
    const onRequestEditors = vi.fn()
    render(<FileTree nodes={[]} onOpen={() => {}} editors={[]} onRequestEditors={onRequestEditors} onOpenInEditor={() => {}} />)
    const caret = screen.getByTitle('在编辑器中打开')
    expect(caret).toBeTruthy()           // 关键：空数组也要出 caret，否则永远无法触发检测
    fireEvent.click(caret)
    expect(onRequestEditors).toHaveBeenCalled()
  })
  it('有 editors → 渲染 caret，点开调 onRequestEditors 并出已安装/未安装项', () => {
    const onRequestEditors = vi.fn()
    render(<FileTree nodes={[]} onOpen={() => {}} editors={editors} onRequestEditors={onRequestEditors} onOpenInEditor={() => {}} />)
    fireEvent.click(screen.getByTitle('在编辑器中打开'))
    expect(onRequestEditors).toHaveBeenCalled()
    expect(screen.getByText('VS Code')).toBeTruthy()
    expect(screen.getByText('Zed')).toBeTruthy()
  })
  it('点已安装项 → onOpenInEditor(id) + 关闭；点未安装项无反应', () => {
    const onOpenInEditor = vi.fn()
    render(<FileTree nodes={[]} onOpen={() => {}} editors={editors} onRequestEditors={() => {}} onOpenInEditor={onOpenInEditor} />)
    fireEvent.click(screen.getByTitle('在编辑器中打开'))
    fireEvent.click(screen.getByText('Zed'))           // 未安装项
    expect(onOpenInEditor).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('VS Code'))        // 已安装项
    expect(onOpenInEditor).toHaveBeenCalledWith('vscode')
  })
})
