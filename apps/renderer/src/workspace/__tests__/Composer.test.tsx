/**
 * Composer.test.tsx — Task 15 测试
 *
 * 验证：Enter 发送/清空、Shift+Enter 不发、运行中变停止键→onInterrupt
 *
 * 注意：Composer 内含 ModelPill，ModelPill 需要 RuntimeContext.Provider。
 * Workspace 已在 Task 14 包裹 Provider，但单元测试需要自己提供 Provider。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

// Composer 内含 ModelPill/SkillModal，会调 api 拉文件/技能/命令/模型，并在「注入技能」完成时调 injectSkills。
// mock 整个 client：覆盖渲染/交互路径触达的全部方法，断言 injectSkills 收到当前 projectId。
vi.mock('../../api/client', () => ({
  ApiError: class extends Error {},
  api: {
    files: vi.fn().mockResolvedValue({ tree: [] }),
    listSkills: vi.fn().mockResolvedValue({ skills: [] }),
    commands: vi.fn().mockResolvedValue({ commands: [] }),
    projectCommands: vi.fn().mockResolvedValue({ commands: [] }),
    models: vi.fn().mockResolvedValue({ models: null }),
    injectSkills: vi.fn().mockResolvedValue({ ok: true }),
    listSkillLibrary: vi.fn().mockResolvedValue({
      skills: [{ effectiveName: 'pdf', name: 'pdf', desc: 'PDF 工具', sourceId: 'a', sourceName: 'anthropics', globalIn: [] }],
    }),
    uploadPaste: vi.fn(),
    importFiles: vi.fn(),
    rawUrl: vi.fn(() => ''),
  },
}))

import { Composer } from '../Composer'
import { RuntimeContext, initialRuntime, runtimeReducer } from '../runtimeState'
import { useReducer } from 'react'
import type { ReactNode } from 'react'
import { api } from '../../api/client'

function Wrapper({ children }: { children: ReactNode }) {
  const [runtime, dispatch] = useReducer(runtimeReducer, undefined, () => initialRuntime('claude', 'Claude Opus 4.8'))
  return (
    <RuntimeContext.Provider value={{ runtime, dispatch }}>
      {children}
    </RuntimeContext.Provider>
  )
}

const p = {
  running: false,
  onSubmit: vi.fn(),
  onInterrupt: vi.fn(),
  engine: 'claude' as const,
  model: 'Claude Opus 4.8',
  projectId: 'x',
}

test('Enter 发送并清空', async () => {
  const onSubmit = vi.fn()
  render(
    <Wrapper>
      <Composer {...p} onSubmit={onSubmit} />
    </Wrapper>
  )
  const ta = screen.getByRole('textbox')
  await userEvent.type(ta, '你好{Enter}')
  expect(onSubmit).toHaveBeenCalledWith('你好', [])
  expect((ta as HTMLTextAreaElement).value).toBe('')
})

test('Shift+Enter 不发送', async () => {
  const onSubmit = vi.fn()
  render(
    <Wrapper>
      <Composer {...p} onSubmit={onSubmit} />
    </Wrapper>
  )
  await userEvent.type(screen.getByRole('textbox'), 'a{Shift>}{Enter}{/Shift}')
  expect(onSubmit).not.toHaveBeenCalled()
})

test('运行中显示停止键 → onInterrupt', async () => {
  const onInterrupt = vi.fn()
  render(
    <Wrapper>
      <Composer {...p} running onInterrupt={onInterrupt} />
    </Wrapper>
  )
  await userEvent.click(screen.getByTitle('中断当前任务'))
  expect(onInterrupt).toHaveBeenCalled()
})

test('空闲时显示发送键', () => {
  render(
    <Wrapper>
      <Composer {...p} />
    </Wrapper>
  )
  expect(screen.getByTitle('发送')).toBeInTheDocument()
})

test('运行中发送键带 is-running 类', () => {
  render(
    <Wrapper>
      <Composer {...p} running />
    </Wrapper>
  )
  const btn = screen.getByTitle('中断当前任务')
  expect(btn.classList.contains('is-running')).toBe(true)
})

test('回形针选图片 → 复制进 attachments/（拿相对路径）；非图片仍引用绝对路径', async () => {
  const onSubmit = vi.fn()
  const pickPaths = vi.fn().mockResolvedValue(['/abs/photo.png', '/abs/notes.txt'])
  ;(globalThis as unknown as { agentShell: unknown }).agentShell = { pickPaths }
  vi.mocked(api.importFiles).mockResolvedValue({ imported: [{ name: 'photo.png', from: '/abs/photo.png' }], tree: [] })
  render(
    <Wrapper>
      <Composer {...p} projectId="pj-1" onSubmit={onSubmit} />
    </Wrapper>
  )
  await userEvent.click(screen.getByTitle('添加附件'))
  // chip 出现（图片复制完成 + 非图片引用）
  expect(await screen.findByText('photo.png')).toBeInTheDocument()
  expect(await screen.findByText('notes.txt')).toBeInTheDocument()
  // 图片走 importFiles 复制进 attachments/
  expect(api.importFiles).toHaveBeenCalledWith('pj-1', ['/abs/photo.png'], 'attachments')
  // 发送：图片为相对路径 attachments/photo.png，非图片仍绝对路径
  await userEvent.type(screen.getByRole('textbox'), '看图{Enter}')
  expect(onSubmit).toHaveBeenCalledWith('看图', ['attachments/photo.png', '/abs/notes.txt'])
})

test('取数时机：mount 不取命令，打开 ModelPill 才取（按需）', async () => {
  vi.mocked(api.commands).mockClear(); vi.mocked(api.projectCommands).mockClear()
  render(
    <Wrapper>
      <Composer {...p} projectId="pj-1" sessionId="s-1" />
    </Wrapper>
  )
  // mount 不取
  expect(api.commands).not.toHaveBeenCalled()
  expect(api.projectCommands).not.toHaveBeenCalled()
  // 打开 ModelPill → 取
  await userEvent.click(screen.getByRole('button', { name: /default/i }))
  expect(api.commands).toHaveBeenCalledWith('s-1')
})

test('双入口：有 sessionId 走会话命令', async () => {
  vi.mocked(api.commands).mockClear(); vi.mocked(api.projectCommands).mockClear()
  render(
    <Wrapper>
      <Composer {...p} projectId="pj-1" sessionId="s-1" />
    </Wrapper>
  )
  await userEvent.click(screen.getByRole('button', { name: /default/i }))
  expect(api.commands).toHaveBeenCalledWith('s-1')
  expect(api.projectCommands).not.toHaveBeenCalled()
})

test('双入口：无 sessionId 走项目命令（无会话取数）', async () => {
  vi.mocked(api.commands).mockClear(); vi.mocked(api.projectCommands).mockClear()
  render(
    <Wrapper>
      <Composer {...p} projectId="pj-2" />
    </Wrapper>
  )
  await userEvent.click(screen.getByRole('button', { name: /default/i }))
  expect(api.projectCommands).toHaveBeenCalledWith('pj-2')
  expect(api.commands).not.toHaveBeenCalled()
})

test('liveCommands 推送 → 正开着的命令区当场刷新（P1 commands_changed SSE）', async () => {
  const { rerender } = render(
    <Wrapper>
      <Composer {...p} projectId="pj-1" sessionId="s-1" />
    </Wrapper>
  )
  // 打开 ModelPill（loadCommands 拉到空）→ 命令区暂无 /review
  await userEvent.click(screen.getByRole('button', { name: /default/i }))
  expect(screen.queryByText('/review')).toBeNull()
  // 模拟 commands_changed 经 SSE 推下来：liveCommands 更新 → 开着的面板当场出现 /review
  rerender(
    <Wrapper>
      <Composer {...p} projectId="pj-1" sessionId="s-1" liveCommands={[{ name: 'review', description: '审查改动', argumentHint: '' }]} />
    </Wrapper>
  )
  expect(await screen.findByText('/review')).toBeInTheDocument()
})

test('注入技能入口带当前 projectId 调用 api.injectSkills', async () => {
  vi.mocked(api.injectSkills).mockClear()
  render(
    <Wrapper>
      <Composer {...p} projectId="pj-9" />
    </Wrapper>
  )
  // 开模型弹窗 → Slash Commands 区「注入技能」→ SkillModal 选 pdf → 完成
  await userEvent.click(screen.getByRole('button', { name: /default/i }))
  await userEvent.click(screen.getByRole('button', { name: '注入技能' }))
  expect(await screen.findByText('PDF 工具')).toBeInTheDocument()
  await userEvent.click(screen.getByText('pdf'))
  await userEvent.click(screen.getByText('完成'))
  expect(api.injectSkills).toHaveBeenCalledWith('pj-9', ['pdf'])
})
