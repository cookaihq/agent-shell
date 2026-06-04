import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { SessionHistory } from '../SessionHistory'
import type { SessionDTO } from '../../api/types'

const sess = (id: string, status: SessionDTO['status'], engine: SessionDTO['engine'] = 'claude'): SessionDTO => ({
  id,
  projectId: 'p',
  engine,
  model: 'opus',
  title: `会话${id}`,
  pinned: false,
  status,
  resumableId: 'r',
  createdAt: 0,
})

const base = {
  activeId: '1',
  activeRunning: false,
  onSelect: vi.fn(),
  onResume: vi.fn(),
  onPin: vi.fn(),
  onRename: vi.fn(),
  onDelete: vi.fn(),
}

test('状态文案 + 运行中', () => {
  const { rerender } = render(
    <SessionHistory
      {...base}
      sessions={[sess('1', 'completed'), sess('2', 'aborted'), sess('3', 'failed')]}
    />
  )
  expect(screen.getByText('已完成')).toBeInTheDocument()
  expect(screen.getByText('已中止')).toBeInTheDocument()
  expect(screen.getByText('失败')).toBeInTheDocument()
  rerender(
    <SessionHistory {...base} activeRunning sessions={[sess('1', 'idle')]} />
  )
  expect(screen.getByText('运行中')).toBeInTheDocument()
})

test('idle 状态显示未开始', () => {
  render(
    <SessionHistory
      {...base}
      sessions={[sess('1', 'idle')]}
    />
  )
  expect(screen.getByText('未开始')).toBeInTheDocument()
})

test('切换会话 onSelect 被调用', async () => {
  const onSelect = vi.fn()
  render(
    <SessionHistory
      {...base}
      onSelect={onSelect}
      sessions={[sess('1', 'completed'), sess('2', 'aborted')]}
    />
  )
  await userEvent.click(screen.getByText('会话2'))
  expect(onSelect).toHaveBeenCalledWith('2')
})

test('failed/aborted 项显示「继续」按钮，onResume 被调用', async () => {
  const onResume = vi.fn()
  render(
    <SessionHistory
      {...base}
      onResume={onResume}
      sessions={[sess('1', 'completed'), sess('2', 'aborted')]}
    />
  )
  // aborted session (id=2) should show resume button; active session (id=1) should not
  const resumeBtns = screen.getAllByTitle('继续会话')
  expect(resumeBtns).toHaveLength(1)
  await userEvent.click(resumeBtns[0])
  expect(onResume).toHaveBeenCalledWith('2')
})

test('搜索过滤：输入会话1只显示会话1', async () => {
  render(
    <SessionHistory
      {...base}
      sessions={[sess('1', 'completed'), sess('2', 'aborted')]}
    />
  )
  await userEvent.type(screen.getByPlaceholderText(/搜索/), '会话1')
  expect(screen.queryByText('会话2')).not.toBeInTheDocument()
  expect(screen.getByText('会话1')).toBeInTheDocument()
})

test('不渲染新会话按钮（新会话归 ChatHeader）', () => {
  render(
    <SessionHistory
      {...base}
      sessions={[sess('1', 'completed')]}
    />
  )
  expect(screen.queryByRole('button', { name: '新会话' })).not.toBeInTheDocument()
})

test('置顶按钮触发 onPin', async () => {
  const onPin = vi.fn()
  render(
    <SessionHistory
      {...base}
      onPin={onPin}
      sessions={[sess('1', 'completed')]}
    />
  )
  await userEvent.click(screen.getByTitle('固定到顶部'))
  expect(onPin).toHaveBeenCalledWith('1', true)
})

test('重命名：点重命名按钮→出现input→Enter提交→onRename', async () => {
  const onRename = vi.fn()
  render(
    <SessionHistory
      {...base}
      onRename={onRename}
      sessions={[sess('1', 'completed')]}
    />
  )
  await userEvent.click(screen.getByTitle('重命名'))
  const input = screen.getByDisplayValue('会话1')
  await userEvent.clear(input)
  await userEvent.type(input, '新名称')
  await userEvent.keyboard('{Enter}')
  expect(onRename).toHaveBeenCalledWith('1', '新名称')
})

test('引擎 dot 带对应 className (claude/codex)', () => {
  const { container } = render(
    <SessionHistory
      {...base}
      sessions={[sess('1', 'completed', 'claude'), sess('2', 'idle', 'codex')]}
    />
  )
  const dots = container.querySelectorAll('.hi-dot')
  expect(dots[0].classList.contains('claude')).toBe(true)
  expect(dots[1].classList.contains('codex')).toBe(true)
})

test('删除：点垃圾桶→出现二次确认（不直接删）；取消则不删；确认才触发 onDelete', async () => {
  const onDelete = vi.fn()
  render(
    <SessionHistory {...base} onDelete={onDelete} sessions={[sess('1', 'completed')]} />
  )
  // 初始无确认条
  expect(screen.queryByText(/不可恢复/)).not.toBeInTheDocument()
  // 点垃圾桶 → 出现确认条，未直接删
  await userEvent.click(screen.getByTitle('删除会话'))
  expect(screen.getByText(/不可恢复/)).toBeInTheDocument()
  expect(onDelete).not.toHaveBeenCalled()
  // 取消 → 回正常态，不删
  await userEvent.click(screen.getByText('取消'))
  expect(screen.queryByText(/不可恢复/)).not.toBeInTheDocument()
  expect(onDelete).not.toHaveBeenCalled()
  // 再删 → 确认 → onDelete(id)
  await userEvent.click(screen.getByTitle('删除会话'))
  await userEvent.click(screen.getByText('删除'))
  expect(onDelete).toHaveBeenCalledWith('1')
})
