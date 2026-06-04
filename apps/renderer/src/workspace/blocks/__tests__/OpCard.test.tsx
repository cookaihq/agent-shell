import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OpCard } from '../OpCard'

describe('OpCard 运行命令（bash）', () => {
  it('渲染 IN（命令）+ OUT（输出），各带标签', () => {
    render(<OpCard name="Bash" input={{ command: 'ls -la' }} result={{ ok: true, content: 'total 0' }} />)
    expect(screen.getByText('运行命令')).toBeInTheDocument()
    expect(screen.getByText('IN')).toBeInTheDocument()
    expect(screen.getByText('OUT')).toBeInTheDocument()
    expect(screen.getByText('ls -la')).toBeInTheDocument()
    expect(screen.getByText('total 0')).toBeInTheDocument()
  })

  it('完成态显示固定时长（completedAt-startedAt）', () => {
    render(<OpCard name="Bash" input={{ command: 'sleep 1' }} result={{ ok: true, content: '' }} startedAt={1000} completedAt={3400} />)
    expect(screen.getByText('2.4s')).toBeInTheDocument()
  })

  it('<1s 用 ms 显示', () => {
    render(<OpCard name="Bash" input={{ command: 'echo' }} result={{ ok: true, content: 'x' }} startedAt={1000} completedAt={1250} />)
    expect(screen.getByText('250ms')).toBeInTheDocument()
  })

  it('提供 onOpen → 卡片可点击，点击触发回调', () => {
    const onOpen = vi.fn()
    const { container } = render(<OpCard name="Bash" input={{ command: 'pwd' }} result={{ ok: true, content: '/x' }} onOpen={onOpen} />)
    const card = container.querySelector('.op-card.op-bash')!
    expect(card.className).toContain('is-clickable')
    fireEvent.click(card)
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('无 onOpen → 不可点击', () => {
    const { container } = render(<OpCard name="Bash" input={{ command: 'pwd' }} result={null} />)
    expect(container.querySelector('.op-card.op-bash')!.className).not.toContain('is-clickable')
  })
})
