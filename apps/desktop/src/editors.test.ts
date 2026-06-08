import { describe, it, expect } from 'vitest'
import { listEditors, detectInstalled, resolveOpen, resolveLabel } from './editors'

// 注入式假依赖：不碰真实 fs / PATH
const has = (...present: string[]) => (full: string) => present.some(p => full.includes(p))
const whichHas = (...present: string[]) => (cmd: string) => present.includes(cmd) ? `/usr/local/bin/${cmd}` : null

describe('listEditors 平台过滤', () => {
  it('darwin 含 Xcode、不含纯 win 项；顺序为 catalog 顺序', () => {
    const ids = listEditors('darwin').map(e => e.id)
    expect(ids).toContain('xcode')
    expect(ids[0]).toBe('cursor')
    expect(ids[1]).toBe('vscode')
  })
  it('win32 不含 Xcode', () => {
    expect(listEditors('win32').map(e => e.id)).not.toContain('xcode')
  })
  it('其他平台返回空（无 caret）', () => {
    expect(listEditors('linux')).toEqual([])
  })
})

describe('detectInstalled (mac 方案A：查 .app 路径)', () => {
  const def = listEditors('darwin').find(e => e.id === 'vscode')!
  it('/Applications 下存在 → 已安装', () => {
    expect(detectInstalled(def, 'darwin', { existsSync: has('Visual Studio Code.app'), home: '/Users/x', which: () => null })).toBe(true)
  })
  it('不存在 → 未安装', () => {
    expect(detectInstalled(def, 'darwin', { existsSync: () => false, home: '/Users/x', which: () => null })).toBe(false)
  })
  it('Finder/Terminal 恒为已安装', () => {
    const finder = listEditors('darwin').find(e => e.id === 'finder')!
    expect(detectInstalled(finder, 'darwin', { existsSync: () => false, home: '/Users/x', which: () => null })).toBe(true)
  })
})

describe('resolveOpen (mac)', () => {
  const root = '/Users/x/proj'
  it('编辑器有 launcher → 用 launcher', () => {
    const vscode = listEditors('darwin').find(e => e.id === 'vscode')!
    expect(resolveOpen(vscode, 'darwin', root, { which: whichHas('code') })).toEqual({ type: 'exec', file: 'code', args: [root] })
  })
  it('编辑器无 launcher → 退回 open -a', () => {
    const vscode = listEditors('darwin').find(e => e.id === 'vscode')!
    expect(resolveOpen(vscode, 'darwin', root, { which: () => null })).toEqual({ type: 'exec', file: 'open', args: ['-a', 'Visual Studio Code', root] })
  })
  it('Finder → shellOpenPath', () => {
    const finder = listEditors('darwin').find(e => e.id === 'finder')!
    expect(resolveOpen(finder, 'darwin', root, { which: () => null })).toEqual({ type: 'shellOpenPath' })
  })
  it('Terminal → open -a Terminal', () => {
    const terminal = listEditors('darwin').find(e => e.id === 'terminal')!
    expect(resolveOpen(terminal, 'darwin', root, { which: () => null })).toEqual({ type: 'exec', file: 'open', args: ['-a', 'Terminal', root] })
  })
})

describe('resolveLabel', () => {
  it('mac Finder 用 Finder、win Finder 用 文件资源管理器', () => {
    const finder = listEditors('darwin').find(e => e.id === 'finder')!
    expect(resolveLabel(finder, 'darwin')).toBe('Finder')
    const finderWin = listEditors('win32').find(e => e.id === 'finder')!
    expect(resolveLabel(finderWin, 'win32')).toBe('文件资源管理器')
  })
  it('win Terminal 用 终端', () => {
    const terminalWin = listEditors('win32').find(e => e.id === 'terminal')!
    expect(resolveLabel(terminalWin, 'win32')).toBe('终端')
  })
})

describe('detectInstalled / resolveOpen (win)', () => {
  it('launcher 在 PATH → 已安装；否则未安装', () => {
    const code = listEditors('win32').find(e => e.id === 'vscode')!
    expect(detectInstalled(code, 'win32', { existsSync: () => false, home: 'C:/Users/x', which: whichHas('code') })).toBe(true)
    expect(detectInstalled(code, 'win32', { existsSync: () => false, home: 'C:/Users/x', which: () => null })).toBe(false)
  })
  it('editor 打开 → launcher absPath', () => {
    const code = listEditors('win32').find(e => e.id === 'vscode')!
    expect(resolveOpen(code, 'win32', 'C:/p', { which: whichHas('code') })).toEqual({ type: 'exec', file: 'code', args: ['C:/p'] })
  })
  it('Explorer(finder) → shellOpenPath；终端有 wt → wt -d', () => {
    const finder = listEditors('win32').find(e => e.id === 'finder')!
    expect(resolveOpen(finder, 'win32', 'C:/p', { which: () => null })).toEqual({ type: 'shellOpenPath' })
    const terminal = listEditors('win32').find(e => e.id === 'terminal')!
    expect(resolveOpen(terminal, 'win32', 'C:/p', { which: whichHas('wt') })).toEqual({ type: 'exec', file: 'wt', args: ['-d', 'C:/p'] })
  })
})
