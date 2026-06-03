import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChatLog } from '../ChatLog'
import type { MessageDTO, Block } from '../../api/types'

test('user + prose + 读取卡 + 命令卡 + 编辑diff + todo', () => {
  const messages: MessageDTO[] = [
    {
      id: '1',
      sessionId: 's',
      role: 'user',
      blocks: [{ type: 'text', text: '帮我改文件' }],
      createdAt: 0,
    },
    {
      id: '2',
      sessionId: 's',
      role: 'assistant',
      blocks: [
        { type: 'text', text: '好的' },
        { type: 'tool_use', id: 'r', name: 'Read', input: { file_path: 'a.ts' } },
        { type: 'tool_result', toolUseId: 'r', ok: true, content: '' },
        { type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'ls' } },
        { type: 'tool_result', toolUseId: 'b', ok: true, content: 'a.ts' },
        { type: 'tool_use', id: 'e', name: 'Edit', input: { file_path: 'a.ts', old_string: 'x', new_string: 'y' } },
        { type: 'tool_result', toolUseId: 'e', ok: true, content: '' },
        { type: 'tool_use', id: 't', name: 'TodoWrite', input: { todos: [{ content: '任务一', status: 'completed' }, { content: '任务二', status: 'in_progress' }] } },
      ],
      createdAt: 0,
    },
  ]
  render(<ChatLog messages={messages} liveBlocks={null} runStatus="completed" onResume={() => {}} />)
  expect(screen.getByText('帮我改文件')).toBeInTheDocument()
  expect(screen.getByText('好的')).toBeInTheDocument()
  expect(screen.getAllByText('a.ts', { exact: false }).length).toBeGreaterThan(0)   // Read 路径
  expect(screen.getByText('ls')).toBeInTheDocument()                       // Bash 命令
  expect(screen.getByText((text) => text.includes('y') && text.startsWith('+'))).toBeInTheDocument()  // Edit 新增行
  expect(screen.getByText('任务一')).toBeInTheDocument()                    // todo
})

test('aborted 末尾 run-note 继续按钮', () => {
  const onResume = vi.fn()
  render(<ChatLog messages={[]} liveBlocks={null} runStatus="aborted" onResume={onResume} />)
  screen.getByRole('button', { name: /继续/ }).click()
  expect(onResume).toHaveBeenCalled()
})

test('failed 末尾 run-note 继续按钮', () => {
  const onResume = vi.fn()
  render(<ChatLog messages={[]} liveBlocks={null} runStatus="failed" onResume={onResume} />)
  screen.getByRole('button', { name: /继续/ }).click()
  expect(onResume).toHaveBeenCalled()
})

test('failed 带 failReason → run-note 显示真实原因', () => {
  render(<ChatLog messages={[]} liveBlocks={null} runStatus="failed" failReason="Credit balance is too low" onResume={() => {}} />)
  expect(screen.getByText(/任务失败 · Credit balance is too low/)).toBeTruthy()
})

test('completed 无 run-note', () => {
  render(<ChatLog messages={[]} liveBlocks={null} runStatus="completed" onResume={() => {}} />)
  expect(screen.queryByRole('button', { name: /继续/ })).toBeNull()
})

test('liveBlocks 作为临时 assistant 消息渲染', () => {
  const liveBlocks: Block[] = [{ type: 'text', text: '实时内容' }]
  render(<ChatLog messages={[]} liveBlocks={liveBlocks} runStatus="running" onResume={() => {}} />)
  expect(screen.getByText('实时内容')).toBeInTheDocument()
})

test('thinking 块渲染 details.thinking', () => {
  const messages: MessageDTO[] = [
    {
      id: '1',
      sessionId: 's',
      role: 'assistant',
      blocks: [{ type: 'thinking', text: '我在思考...' }],
      createdAt: 0,
    },
  ]
  render(<ChatLog messages={messages} liveBlocks={null} runStatus="completed" onResume={() => {}} />)
  // details.thinking 应当存在
  const details = document.querySelector('details.thinking')
  expect(details).not.toBeNull()
})

describe('role 行保真', () => {
  test('user/assistant role 行都带 .rt 时间戳（HH:mm）', () => {
    const messages: MessageDTO[] = [
      { id: '1', sessionId: 's', role: 'user', blocks: [{ type: 'text', text: '问题' }], createdAt: 0 },
      { id: '2', sessionId: 's', role: 'assistant', blocks: [{ type: 'text', text: '回答' }], createdAt: 0 },
    ]
    const { container } = render(<ChatLog messages={messages} liveBlocks={null} runStatus="completed" onResume={() => {}} />)
    const rts = container.querySelectorAll('.role .rt')
    expect(rts.length).toBe(2)
    // 不绑定具体时区数值，只断言格式
    rts.forEach((rt) => expect(rt.textContent).toMatch(/^\d{2}:\d{2}$/))
  })

  test('engine="codex" 时 assistant role 显示 Codex CLI', () => {
    const messages: MessageDTO[] = [
      { id: '2', sessionId: 's', role: 'assistant', blocks: [{ type: 'text', text: '回答' }], createdAt: 0 },
    ]
    const { container } = render(<ChatLog messages={messages} liveBlocks={null} runStatus="completed" onResume={() => {}} engine="codex" />)
    const role = container.querySelector('.msg.assistant .role')
    expect(role!.textContent).toContain('Codex CLI')
  })

  test('默认（不传 engine）assistant role 显示 Claude Code', () => {
    const messages: MessageDTO[] = [
      { id: '2', sessionId: 's', role: 'assistant', blocks: [{ type: 'text', text: '回答' }], createdAt: 0 },
    ]
    const { container } = render(<ChatLog messages={messages} liveBlocks={null} runStatus="completed" onResume={() => {}} />)
    const role = container.querySelector('.msg.assistant .role')
    expect(role!.textContent).toContain('Claude Code')
  })
})

describe('op-card className 验证', () => {
  test('Read 卡：op-icon 文本字符「R」+ className read', () => {
    const messages: MessageDTO[] = [
      {
        id: '1',
        sessionId: 's',
        role: 'assistant',
        blocks: [
          { type: 'tool_use', id: 'r', name: 'Read', input: { file_path: 'foo.ts' } },
          { type: 'tool_result', toolUseId: 'r', ok: true, content: '' },
        ],
        createdAt: 0,
      },
    ]
    const { container } = render(<ChatLog messages={messages} liveBlocks={null} runStatus="completed" onResume={() => {}} />)
    const icon = container.querySelector('.op-icon.read')
    expect(icon).not.toBeNull()
    expect(icon!.textContent).toBe('R')
  })

  test('Bash 卡：op-icon 文本字符「$」+ className bash', () => {
    const messages: MessageDTO[] = [
      {
        id: '1',
        sessionId: 's',
        role: 'assistant',
        blocks: [
          { type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'echo hi' } },
          { type: 'tool_result', toolUseId: 'b', ok: false, content: 'err' },
        ],
        createdAt: 0,
      },
    ]
    const { container } = render(<ChatLog messages={messages} liveBlocks={null} runStatus="completed" onResume={() => {}} />)
    const icon = container.querySelector('.op-icon.bash')
    expect(icon).not.toBeNull()
    expect(icon!.textContent).toBe('$')
  })

  test('Edit 卡：op-icon 文本字符「E」+ className edit', () => {
    const messages: MessageDTO[] = [
      {
        id: '1',
        sessionId: 's',
        role: 'assistant',
        blocks: [
          { type: 'tool_use', id: 'e', name: 'Edit', input: { file_path: 'x.ts', old_string: 'a', new_string: 'b' } },
          { type: 'tool_result', toolUseId: 'e', ok: true, content: '' },
        ],
        createdAt: 0,
      },
    ]
    const { container } = render(<ChatLog messages={messages} liveBlocks={null} runStatus="completed" onResume={() => {}} />)
    const icon = container.querySelector('.op-icon.edit')
    expect(icon).not.toBeNull()
    expect(icon!.textContent).toBe('E')
  })

  test('TodoWrite 卡：op-icon 文本字符「✓」+ className todo', () => {
    const messages: MessageDTO[] = [
      {
        id: '1',
        sessionId: 's',
        role: 'assistant',
        blocks: [
          { type: 'tool_use', id: 't', name: 'TodoWrite', input: { todos: [{ content: 'task', status: 'pending' }] } },
        ],
        createdAt: 0,
      },
    ]
    const { container } = render(<ChatLog messages={messages} liveBlocks={null} runStatus="completed" onResume={() => {}} />)
    const icon = container.querySelector('.op-icon.todo')
    expect(icon).not.toBeNull()
    expect(icon!.textContent).toBe('✓')
  })

  test('无 result → op-status running 进行中', () => {
    const messages: MessageDTO[] = [
      {
        id: '1',
        sessionId: 's',
        role: 'assistant',
        blocks: [
          { type: 'tool_use', id: 'r', name: 'Read', input: { file_path: 'a.ts' } },
          // 无对应 tool_result
        ],
        createdAt: 0,
      },
    ]
    const { container } = render(<ChatLog messages={messages} liveBlocks={null} runStatus="completed" onResume={() => {}} />)
    const status = container.querySelector('.op-status.running')
    expect(status).not.toBeNull()
  })

  test('result ok=false → op-status err', () => {
    const messages: MessageDTO[] = [
      {
        id: '1',
        sessionId: 's',
        role: 'assistant',
        blocks: [
          { type: 'tool_use', id: 'r', name: 'Read', input: { file_path: 'a.ts' } },
          { type: 'tool_result', toolUseId: 'r', ok: false, content: '错误' },
        ],
        createdAt: 0,
      },
    ]
    const { container } = render(<ChatLog messages={messages} liveBlocks={null} runStatus="completed" onResume={() => {}} />)
    const status = container.querySelector('.op-status.err')
    expect(status).not.toBeNull()
  })
})

describe('todo 卡状态映射', () => {
  test('completed→todo-done ✓, in_progress→todo-doing ▸, pending→todo-pending ○', () => {
    const messages: MessageDTO[] = [
      {
        id: '1',
        sessionId: 's',
        role: 'assistant',
        blocks: [
          {
            type: 'tool_use',
            id: 't',
            name: 'TodoWrite',
            input: {
              todos: [
                { content: '已完成任务', status: 'completed' },
                { content: '进行中任务', status: 'in_progress' },
                { content: '待办任务', status: 'pending' },
              ],
            },
          },
        ],
        createdAt: 0,
      },
    ]
    const { container } = render(<ChatLog messages={messages} liveBlocks={null} runStatus="completed" onResume={() => {}} />)
    expect(container.querySelector('.todo-item.todo-done')).not.toBeNull()
    expect(container.querySelector('.todo-item.todo-doing')).not.toBeNull()
    expect(container.querySelector('.todo-item.todo-pending')).not.toBeNull()
    const checks = container.querySelectorAll('.todo-check')
    expect(checks[0].textContent).toBe('✓')
    expect(checks[1].textContent).toBe('▸')
    expect(checks[2].textContent).toBe('○')
  })
})
