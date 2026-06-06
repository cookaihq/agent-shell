import { describe, test, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ChatLog } from '../ChatLog'
import type { MessageDTO, Block } from '../../api/types'
import { SettingsProvider } from '../../settings/SettingsContext'

vi.mock('../../api/client', () => ({
  api: {
    getConfig: vi.fn().mockResolvedValue({ projectsDir: '/p', skillsDir: '/s' }),
    rawUrl: vi.fn((projectId: string, p: string) => `/api/pf/${projectId}/${p}`),
    rawRecord: vi.fn().mockResolvedValue({ record: {} }),
  },
}))

function Wrap({ children }: { children: ReactNode }) {
  return <SettingsProvider>{children}</SettingsProvider>
}

test('用户消息：白底框（无蓝气泡/无角色头/无时间戳）', () => {
  const messages: MessageDTO[] = [
    { id: '1', sessionId: 's', role: 'user', blocks: [{ type: 'text', text: '帮我改文件' }], createdAt: 0 },
  ]
  const { container } = render(<Wrap><ChatLog messages={messages} liveBlocks={null} runStatus="completed" onResume={() => {}} /></Wrap>)
  expect(container.querySelector('.msg.user .user-text')?.textContent).toBe('帮我改文件')
  expect(container.querySelector('.msg.user .role')).toBeNull()
})

test('assistant：无「Claude Code · 时间」角色头；内容走时间线', () => {
  const messages: MessageDTO[] = [
    { id: '2', sessionId: 's', role: 'assistant', blocks: [{ type: 'text', text: '好的' }], createdAt: 0 },
  ]
  const { container } = render(<Wrap><ChatLog messages={messages} liveBlocks={null} runStatus="completed" onResume={() => {}} /></Wrap>)
  expect(container.querySelector('.msg.assistant .role')).toBeNull()
  expect(screen.getByText('好的')).toBeInTheDocument()
  expect(container.querySelector('.chat-timeline')).not.toBeNull()
})

test('工具行清爽 + 圆点按状态着色（ok→green, err→red, running→run）', () => {
  const messages: MessageDTO[] = [
    {
      id: '2', sessionId: 's', role: 'assistant', createdAt: 0,
      blocks: [
        { type: 'tool_use', id: 'r', name: 'Read', input: { file_path: 'a.ts' } },
        { type: 'tool_result', toolUseId: 'r', ok: true, content: '' },
        { type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'ls' } },
        { type: 'tool_result', toolUseId: 'b', ok: false, content: 'err' },
        { type: 'tool_use', id: 'p', name: 'Read', input: { file_path: 'pending.ts' } },
      ],
    },
  ]
  const { container } = render(<Wrap><ChatLog messages={messages} liveBlocks={null} runStatus="completed" onResume={() => {}} /></Wrap>)
  expect(container.querySelector('.op-icon')).toBeNull()
  expect(container.querySelector('.op-status')).toBeNull()
  expect(container.querySelector('.tl-dot.green')).not.toBeNull()
  expect(container.querySelector('.tl-dot.red')).not.toBeNull()
  expect(container.querySelector('.tl-dot.run')).not.toBeNull()
})

test('Skill 工具 → 紫点 + SkillRow（名/「技能」/描述）', () => {
  const SKILL_MD = '---\nname: guizang-ppt\ndescription: 生成杂志风格演示 deck\n---'
  const messages: MessageDTO[] = [
    {
      id: '2', sessionId: 's', role: 'assistant', createdAt: 0,
      blocks: [
        { type: 'tool_use', id: 'sk', name: 'Skill', input: { skill: 'guizang-ppt', args: '主题=x' } },
        { type: 'tool_result', toolUseId: 'sk', ok: true, content: SKILL_MD },
      ],
    },
  ]
  const { container } = render(<Wrap><ChatLog messages={messages} liveBlocks={null} runStatus="completed" onResume={() => {}} /></Wrap>)
  expect(container.querySelector('.tl-dot.skill')).not.toBeNull()
  expect(container.querySelector('.sk-line .sk-name')?.textContent).toBe('guizang-ppt')
  expect(screen.getByText('生成杂志风格演示 deck')).toBeInTheDocument()
})

test('Write 工具 → 写入行 + N 行 + op-file', () => {
  const messages: MessageDTO[] = [
    {
      id: '2', sessionId: 's', role: 'assistant', createdAt: 0,
      blocks: [
        { type: 'tool_use', id: 'w', name: 'Write', input: { file_path: 'x.css', content: 'a\nb' } },
        { type: 'tool_result', toolUseId: 'w', ok: true, content: '' },
      ],
    },
  ]
  const { container } = render(<Wrap><ChatLog messages={messages} liveBlocks={null} runStatus="completed" onResume={() => {}} /></Wrap>)
  expect(container.querySelector('.op-line .opl-name')?.textContent).toBe('写入')
  expect(container.querySelector('.op-file pre')?.textContent).toBe('a\nb')
})

test('编辑 diff 浅色双行号（.op-diff.vscode .dl.add/.del）', () => {
  const messages: MessageDTO[] = [
    {
      id: '2', sessionId: 's', role: 'assistant', createdAt: 0,
      blocks: [
        { type: 'tool_use', id: 'e', name: 'Edit', input: { file_path: 'a.ts', old_string: 'x', new_string: 'y' } },
        { type: 'tool_result', toolUseId: 'e', ok: true, content: '' },
      ],
    },
  ]
  const { container } = render(<Wrap><ChatLog messages={messages} liveBlocks={null} runStatus="completed" onResume={() => {}} /></Wrap>)
  expect(container.querySelector('.op-diff.vscode .dl.add .dl-text')?.textContent).toBe('y')
  expect(container.querySelector('.op-diff.vscode .dl.del .dl-text')?.textContent).toBe('x')
})

test('用户附件 chip 在块内顶部，点击触发 onOpenFile(path)', () => {
  const onOpenFile = vi.fn()
  const messages: MessageDTO[] = [{
    id: 'u', sessionId: 's', role: 'user', createdAt: 0,
    blocks: [
      { type: 'text', text: '看下这些' },
      { type: 'attachments', files: [{ name: 'a.png', path: 'attachments/a.png' }, { name: 'b.pdf', path: 'docs/b.pdf' }] },
    ],
  }]
  const { container } = render(<Wrap><ChatLog messages={messages} liveBlocks={null} runStatus="completed" onResume={() => {}} projectId="p1" onOpenFile={onOpenFile} /></Wrap>)
  const chips = container.querySelectorAll('.msg.user .user-attach .ua-chip')
  expect(chips.length).toBe(2)
  expect(container.querySelector('.ua-chip .ua-thumb')).not.toBeNull()
  expect(container.querySelector('.ua-chip .ua-ic')?.textContent).toBe('PDF')
  fireEvent.click(chips[1])
  expect(onOpenFile).toHaveBeenCalledWith('docs/b.pdf')
})

test('running 且无 liveBlocks/无 liveProgress → 起步态「处理中…」', () => {
  render(<Wrap><ChatLog messages={[]} liveBlocks={[]} runStatus="running" onResume={() => {}} /></Wrap>)
  expect(screen.getByText('处理中…')).toBeInTheDocument()
})

const aMsg = (id: string, blocks: Block[]): MessageDTO => ({ id, sessionId: 's', role: 'assistant', blocks, createdAt: 0 })

test('末尾 run_note 块（失败/中止终态）→ 继续按钮触发 onResume', () => {
  const onResume = vi.fn()
  const m = aMsg('a1', [{ type: 'run_note', stopReason: 'aborted' }])
  render(<Wrap><ChatLog messages={[m]} liveBlocks={null} runStatus="aborted" onResume={onResume} /></Wrap>)
  screen.getByRole('button', { name: /继续/ }).click()
  expect(onResume).toHaveBeenCalled()
})

test('run_note 块（failed + detail）→ 内联显示真实原因', () => {
  const m = aMsg('a1', [{ type: 'run_note', stopReason: 'failed', detail: 'Credit balance is too low' }])
  render(<Wrap><ChatLog messages={[m]} liveBlocks={null} runStatus="failed" onResume={() => {}} /></Wrap>)
  expect(screen.getByText(/任务失败 · Credit balance is too low/)).toBeTruthy()
})

test('历史中间的 run_note 块只留痕、不挂继续按钮（仅最新终态可继续）', () => {
  // 轮1 失败留痕，随后又成功了一轮 → 旧失败原因仍显示，但「继续」按钮不应挂在旧失败块上
  const failed = aMsg('a1', [{ type: 'run_note', stopReason: 'failed', detail: '旧失败' }])
  const ok = aMsg('a2', [{ type: 'text', text: '后来好了' }])
  render(<Wrap><ChatLog messages={[failed, ok]} liveBlocks={null} runStatus="completed" onResume={() => {}} /></Wrap>)
  expect(screen.getByText(/任务失败 · 旧失败/)).toBeTruthy()      // 留痕仍在
  expect(screen.queryByRole('button', { name: /继续/ })).toBeNull()  // 但不可继续
})

test('形态 A：Task 工具 → 蓝点 Subagent 头行 + 缩进内部时间线（spec §4A/§9.1）', () => {
  const messages: MessageDTO[] = [{
    id: 'a', sessionId: 's', role: 'assistant', createdAt: 0,
    blocks: [
      { type: 'tool_use', id: 'task1', name: 'Task', input: { subagent_type: 'general-purpose', description: '读 README' } },
      { type: 'text', text: '子代理的输出', parentToolUseId: 'task1' },
      { type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: 'README.md' }, parentToolUseId: 'task1' },
      { type: 'tool_result', toolUseId: 'r1', ok: true, content: '', parentToolUseId: 'task1' },
    ],
  }]
  const subagents = { task1: { taskId: 'tk1', toolUseId: 'task1', subagentType: 'general-purpose', description: '读 README', status: 'running' as const, usage: { totalTokens: 1200, toolUses: 2, durationMs: 3000 } } }
  const { container } = render(<Wrap><ChatLog messages={messages} liveBlocks={null} sliceState={subagents} runStatus="running" onResume={() => {}} /></Wrap>)
  expect(container.querySelector('.tl-dot.agent.run')).not.toBeNull()                       // 蓝点·运行中脉冲
  expect(container.querySelector('.subagent .sa-name')?.textContent).toBe('general-purpose') // 类型名
  expect(container.querySelector('.subagent .sa-tag')?.textContent).toBe('Subagent')         // 标签
  expect(container.querySelector('.subagent .sa-stat.run')?.textContent).toBe('运行中')      // 状态徽章
  expect(container.querySelector('.subagent .sa-desc')?.textContent).toBe('读 README')       // 描述
  // 内部时间线（蓝导轨缩进容器）含子代理自己的文本块（证明就地嵌套归属生效）
  expect(container.querySelector('.subagent .sa-inner .chat-timeline')).not.toBeNull()
  expect(screen.getByText('子代理的输出')).toBeInTheDocument()
})

test('形态 A 多层：孙代理在子代理 sa-inner 内递归嵌套（spec D16/§9.7）', () => {
  const messages: MessageDTO[] = [{
    id: 'a', sessionId: 's', role: 'assistant', createdAt: 0,
    blocks: [
      { type: 'tool_use', id: 'parent', name: 'Task', input: { subagent_type: 'general-purpose', description: '父任务' } },
      { type: 'tool_use', id: 'child', name: 'Task', input: { subagent_type: 'web-research', description: '孙任务' }, parentToolUseId: 'parent' },
      { type: 'text', text: '孙代理输出', parentToolUseId: 'child' },
    ],
  }]
  const subagents = {
    parent: { taskId: 'p', toolUseId: 'parent', subagentType: 'general-purpose', status: 'completed' as const },
    child: { taskId: 'c', toolUseId: 'child', subagentType: 'web-research', status: 'completed' as const },
  }
  const { container } = render(<Wrap><ChatLog messages={messages} liveBlocks={null} sliceState={subagents} runStatus="completed" onResume={() => {}} /></Wrap>)
  // 父 subagent 内嵌一个孙 subagent（两层 .subagent 嵌套）
  expect(container.querySelectorAll('.subagent').length).toBe(2)
  expect(container.querySelector('.subagent .sa-inner .subagent .sa-name')?.textContent).toBe('web-research')
  expect(screen.getByText('孙代理输出')).toBeInTheDocument()
})

test('§9.5/D14：skip_transcript 子代理不进时间线（形态 A），其内部块也不平铺到主线', () => {
  const messages: MessageDTO[] = [{
    id: 'a', sessionId: 's', role: 'assistant', createdAt: 0,
    blocks: [
      { type: 'tool_use', id: 'normal', name: 'Task', input: { subagent_type: 'general-purpose', description: '正常' } },
      { type: 'text', text: '正常子代理输出', parentToolUseId: 'normal' },
      { type: 'tool_use', id: 'skip', name: 'Task', input: { subagent_type: 'web-research', description: '杂务' } },
      { type: 'text', text: '不该出现在时间线', parentToolUseId: 'skip' },
    ],
  }]
  const subagents = {
    normal: { taskId: 'n', toolUseId: 'normal', subagentType: 'general-purpose', status: 'running' as const },
    skip: { taskId: 'k', toolUseId: 'skip', subagentType: 'web-research', status: 'completed' as const, skipTranscript: true },
  }
  const { container } = render(<Wrap><ChatLog messages={messages} liveBlocks={null} sliceState={subagents} runStatus="running" onResume={() => {}} /></Wrap>)
  // 只渲染 1 个 .subagent（normal）；skip_transcript 的不进时间线
  expect(container.querySelectorAll('.subagent').length).toBe(1)
  expect(container.querySelector('.subagent .sa-name')?.textContent).toBe('general-purpose')
  // skip_transcript 子代理的内部块不出现在主线
  expect(screen.queryByText('不该出现在时间线')).toBeNull()
  expect(screen.getByText('正常子代理输出')).toBeInTheDocument()
})

test('§9.5 重载态：Task 块持久化 skipTranscript（无 live meta）→ 仍从时间线排除', () => {
  const messages: MessageDTO[] = [{
    id: 'a', sessionId: 's', role: 'assistant', createdAt: 0,
    blocks: [
      { type: 'tool_use', id: 'skip', name: 'Task', input: { subagent_type: 'web-research', description: '杂务' }, skipTranscript: true },
      { type: 'text', text: '重载也不该出现', parentToolUseId: 'skip' },
      { type: 'tool_use', id: 'normal', name: 'Task', input: { subagent_type: 'general-purpose', description: '正常' } },
    ],
  }]
  // subagents 为空 = 模拟重载后 live map 清空：仅靠持久化在块上的 skipTranscript 排除
  const { container } = render(<Wrap><ChatLog messages={messages} liveBlocks={null} sliceState={{}} runStatus="completed" onResume={() => {}} /></Wrap>)
  expect(container.querySelectorAll('.subagent').length).toBe(1)   // 只剩 normal
  expect(screen.queryByText('重载也不该出现')).toBeNull()
})

test('todo 卡状态映射保留', () => {
  const messages: MessageDTO[] = [{
    id: '1', sessionId: 's', role: 'assistant', createdAt: 0,
    blocks: [{ type: 'tool_use', id: 't', name: 'TodoWrite', input: { todos: [
      { content: '已完成', status: 'completed' }, { content: '进行中', status: 'in_progress' }, { content: '待办', status: 'pending' },
    ] } }],
  }]
  const { container } = render(<Wrap><ChatLog messages={messages} liveBlocks={null} runStatus="completed" onResume={() => {}} /></Wrap>)
  expect(container.querySelector('.todo-item.todo-done')).not.toBeNull()
  expect(container.querySelector('.todo-item.todo-doing')).not.toBeNull()
  expect(container.querySelector('.todo-item.todo-pending')).not.toBeNull()
})
