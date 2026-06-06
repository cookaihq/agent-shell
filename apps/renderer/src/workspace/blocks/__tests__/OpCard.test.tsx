import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OpCard, kindOf } from '../OpCard'

describe('kindOf', () => {
  it('Skill→skill, Write→write, Edit/MultiEdit→edit, Bash→bash, Read/未知→read, TodoWrite→todo', () => {
    expect(kindOf('Skill')).toBe('skill')
    expect(kindOf('Write')).toBe('write')
    expect(kindOf('Edit')).toBe('edit')
    expect(kindOf('MultiEdit')).toBe('edit')
    expect(kindOf('Bash')).toBe('bash')
    expect(kindOf('Read')).toBe('read')
    expect(kindOf('Grep')).toBe('read')
    expect(kindOf('TodoWrite')).toBe('todo')
  })
})

describe('OpCard 运行命令（bash）清爽行', () => {
  it('行首中文名「运行命令」+ IN/OUT（单 op-io 容器内两行）', () => {
    const { container } = render(<OpCard name="Bash" input={{ command: 'ls -la' }} result={{ ok: true, content: 'total 0' }} />)
    expect(screen.getByText('运行命令')).toBeInTheDocument()
    expect(container.querySelector('.op-io .io-row .io-tag')?.textContent).toBe('IN')
    expect(container.querySelectorAll('.op-io .io-row').length).toBe(2)
    expect(screen.getByText('ls -la')).toBeInTheDocument()
    expect(screen.getByText('total 0')).toBeInTheDocument()
  })

  it('行尾耗时用 .opl-t（完成态固定时长）', () => {
    const { container } = render(<OpCard name="Bash" input={{ command: 'sleep 1' }} result={{ ok: true, content: '' }} startedAt={1000} completedAt={3400} />)
    expect(container.querySelector('.opl-t')?.textContent).toBe('2.4s')
  })

  it('<1s 用 ms', () => {
    const { container } = render(<OpCard name="Bash" input={{ command: 'echo' }} result={{ ok: true, content: 'x' }} startedAt={1000} completedAt={1250} />)
    expect(container.querySelector('.opl-t')?.textContent).toBe('250ms')
  })

  it('提供 onOpen → .op-row 可点击触发回调', () => {
    const onOpen = vi.fn()
    const { container } = render(<OpCard name="Bash" input={{ command: 'pwd' }} result={{ ok: true, content: '/x' }} onOpen={onOpen} />)
    const row = container.querySelector('.op-row')!
    expect(row.className).toContain('is-clickable')
    fireEvent.click(row)
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('无 onOpen → 不可点击', () => {
    const { container } = render(<OpCard name="Bash" input={{ command: 'pwd' }} result={null} />)
    expect(container.querySelector('.op-row')!.className).not.toContain('is-clickable')
  })
})

// ── 中立 tool 字段（§11#1：codex 命令被渲成「读取」bug 修复）──────────────────
describe('OpCard neutral tool prop（§11#1）', () => {
  it('tool="bash" 覆盖 name="shell" → 渲染「运行命令」不渲「读取」', () => {
    const { container } = render(
      <OpCard name="shell" tool="bash" input={{ command: 'echo hi' }} result={{ ok: true, content: 'hi' }} />,
    )
    expect(screen.getByText('运行命令')).toBeInTheDocument()
    expect(container.querySelector('.opl-name')?.textContent).toBe('运行命令')
    expect(screen.queryByText('读取')).not.toBeInTheDocument()
    expect(screen.getByText('echo hi')).toBeInTheDocument()
  })

  it('不带 tool prop，name="shell" 降级到「读取」（claude 兼容路径保持不变）', () => {
    const { container } = render(
      <OpCard name="shell" input={{ command: 'echo hi' }} result={{ ok: true, content: 'hi' }} />,
    )
    expect(container.querySelector('.opl-name')?.textContent).toBe('读取')
    expect(screen.queryByText('运行命令')).not.toBeInTheDocument()
  })
})

describe('OpCard 读取/编辑/写入清爽行', () => {
  it('读取：op-line 名「读取」+ opl-path 路径', () => {
    const { container } = render(<OpCard name="Read" input={{ file_path: 'a.ts' }} result={{ ok: true, content: '' }} />)
    expect(container.querySelector('.op-line .opl-name')?.textContent).toBe('读取')
    expect(screen.getByText('a.ts')).toBeInTheDocument()
  })

  it('编辑：op-meta「+N −M 行」+ 浅色 diff（.op-diff.vscode 双行号）', () => {
    const { container } = render(<OpCard name="Edit" input={{ file_path: 'a.ts', old_string: 'x', new_string: 'y' }} result={{ ok: true, content: '' }} />)
    expect(container.querySelector('.op-line .opl-name')?.textContent).toBe('编辑')
    expect(container.querySelector('.op-meta')?.textContent).toContain('行')
    expect(container.querySelector('.op-diff.vscode .dl.add .dl-text')?.textContent).toBe('y')
    expect(container.querySelector('.op-diff.vscode .dl.del .dl-text')?.textContent).toBe('x')
  })

  it('写入：op-meta「N 行」+ op-file 内容块', () => {
    const { container } = render(<OpCard name="Write" input={{ file_path: 'b.css', content: 'a\nb\nc' }} result={{ ok: true, content: '' }} />)
    expect(container.querySelector('.op-line .opl-name')?.textContent).toBe('写入')
    expect(container.querySelector('.op-meta')?.textContent).toBe('3 行')
    expect(container.querySelector('.op-file pre')?.textContent).toBe('a\nb\nc')
  })
})
