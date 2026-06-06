import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import type { ReactNode } from 'react'
import { ChatHeader } from '../ChatHeader'
import type { SessionDTO } from '../../api/types'
import { SettingsProvider } from '../../settings/SettingsContext'

const mockGetConfig = vi.fn().mockResolvedValue({ projectsDir: '/p', skillsDir: '/s' })
vi.mock('../../api/client', () => ({
  api: {
    getConfig: (...args: unknown[]) => mockGetConfig(...args),
    saveConfig: vi.fn().mockResolvedValue({}),
  },
}))

function Wrap({ children }: { children: ReactNode }) {
  return <SettingsProvider>{children}</SettingsProvider>
}

const sess = (id: string, status: SessionDTO['status'], title = `会话${id}`): SessionDTO => ({
  id,
  projectId: 'p',
  engine: 'claude',
  model: 'opus',
  title,
  pinned: false,
  status,
  resumableId: 'r',
  createdAt: 0,
})

const base = {
  activeId: '1',
  openSessionIds: ['1'],
  activeRunning: false,
  onSelect: vi.fn(),
  onCloseTab: vi.fn(),
  onNew: vi.fn(),
  onResume: vi.fn(),
  onPin: vi.fn(),
  onRename: vi.fn(),
  onDelete: vi.fn(),
}

test('会话 tab 条：当前会话 tab 高亮 + 标题（Issue 23；消息数已移除）', () => {
  const { container } = render(
    <Wrap><ChatHeader {...base} sessions={[sess('1', 'completed', '当前会话标题')]} /></Wrap>
  )
  const active = container.querySelector('.conv-tabs .conv-tab.is-active')
  expect(active?.querySelector('.ct')?.textContent).toBe('当前会话标题')
  expect(active?.querySelector('.ct-meta')).toBeNull()   // 不再显示 · N 消息数
})

test('多个已打开会话各一个 tab；单 tab 时不显示关闭按钮', () => {
  const one = render(<Wrap><ChatHeader {...base} sessions={[sess('1', 'completed')]} /></Wrap>)
  expect(one.container.querySelectorAll('.conv-tab').length).toBe(1)
  expect(one.container.querySelector('.conv-tab .ct-x')).toBeNull()   // 仅一个 tab → 不可关
  one.unmount()
  const two = render(<Wrap><ChatHeader {...base} openSessionIds={['1', '2']} sessions={[sess('1', 'completed'), sess('2', 'idle')]} /></Wrap>)
  expect(two.container.querySelectorAll('.conv-tab').length).toBe(2)
  expect(two.container.querySelectorAll('.conv-tab .ct-x').length).toBe(2)
})

test('点非当前 tab → onSelect；× → onCloseTab（不删会话）', async () => {
  const onSelect = vi.fn(); const onCloseTab = vi.fn()
  const { container } = render(
    <Wrap><ChatHeader {...base} openSessionIds={['1', '2']} onSelect={onSelect} onCloseTab={onCloseTab}
      sessions={[sess('1', 'completed'), sess('2', 'idle', '会话二')]} /></Wrap>
  )
  const tabs = container.querySelectorAll('.conv-tab')
  await userEvent.click(tabs[1])   // 点会话二
  expect(onSelect).toHaveBeenCalledWith('2')
  await userEvent.click(tabs[1].querySelector('.ct-x')!)
  expect(onCloseTab).toHaveBeenCalledWith('2')
})

test('形态 C 入口：无子代理→不渲染；2 个→2 头像无⋯；3 个→2 头像+虚线圈⋯（spec §4C/§9.2）', () => {
  const none = render(<Wrap><ChatHeader {...base} sessions={[sess('1', 'completed')]} /></Wrap>)
  expect(none.container.querySelector('.sa-entry')).toBeNull()   // 无子代理整块隐藏（D7）
  none.unmount()

  const two = render(<Wrap><ChatHeader {...base} sessions={[sess('1', 'completed')]} sliceState={{
    a: { taskId: 'a', subagentType: 'general-purpose', status: 'completed' },
    b: { taskId: 'b', subagentType: 'web-research', status: 'running' },
  }} /></Wrap>)
  expect(two.container.querySelectorAll('.sa-entry .sa-ava').length).toBe(2)
  expect(two.container.querySelector('.sa-ava-more')).toBeNull()
  two.unmount()

  const three = render(<Wrap><ChatHeader {...base} sessions={[sess('1', 'completed')]} sliceState={{
    a: { taskId: 'a', subagentType: 'general-purpose', status: 'completed' },
    b: { taskId: 'b', subagentType: 'web-research', status: 'running' },
    c: { taskId: 'c', subagentType: 'explore', status: 'running' },
  }} /></Wrap>)
  // 前 2 实心头像 + 1 虚线圈（共 3 个 .sa-ava，末尾带 .sa-ava-more）
  expect(three.container.querySelectorAll('.sa-entry .sa-ava').length).toBe(3)
  expect(three.container.querySelector('.sa-entry .sa-ava-more')?.textContent).toBe('⋯')
})

test('形态 C 入口：R2 别名 map（taskId+toolUseId 双键）→ 按 taskId 去重不重复', () => {
  // chatReducer R2 后 map 含两键指同一 meta；入口应按 taskId 去重 → 仍只 1 个头像
  const meta = { taskId: 't', toolUseId: 'tu', subagentType: 'general-purpose', status: 'running' as const }
  const { container } = render(<Wrap><ChatHeader {...base} sessions={[sess('1', 'completed')]} sliceState={{ t: meta, tu: meta }} /></Wrap>)
  expect(container.querySelectorAll('.sa-entry .sa-ava').length).toBe(1)
})

test('形态 C 入口：D14——无 subagent_type 的纯杂务不进头像入口（仅真子代理计入）', () => {
  // 只有杂务（无 subagentType）→ 整块隐藏
  const choreOnly = render(<Wrap><ChatHeader {...base} sessions={[sess('1', 'completed')]} sliceState={{
    chore: { taskId: 'chore', status: 'running' },
  }} /></Wrap>)
  expect(choreOnly.container.querySelector('.sa-entry')).toBeNull()
  choreOnly.unmount()
  // 杂务 + 真子代理混合 → 只 1 个头像（杂务被过滤）
  const { container } = render(<Wrap><ChatHeader {...base} sessions={[sess('1', 'completed')]} sliceState={{
    chore: { taskId: 'chore', status: 'running' },
    real: { taskId: 'real', subagentType: 'general-purpose', status: 'running' },
  }} /></Wrap>)
  expect(container.querySelectorAll('.sa-entry .sa-ava').length).toBe(1)
})

test('形态 C 入口：点击触发 onShowAgents（切右侧 agents 视图）', async () => {
  const onShowAgents = vi.fn()
  const { container } = render(<Wrap><ChatHeader {...base} sessions={[sess('1', 'completed')]} onShowAgents={onShowAgents}
    sliceState={{ a: { taskId: 'a', subagentType: 'general-purpose', status: 'running' } }} /></Wrap>)
  await userEvent.click(container.querySelector('.sa-entry')!)
  expect(onShowAgents).toHaveBeenCalledOnce()
})

test('新会话按钮在 inline-switcher 外，点击触发 onNew', async () => {
  const onNew = vi.fn()
  const { container } = render(
    <Wrap><ChatHeader {...base} onNew={onNew} sessions={[sess('1', 'completed')]} /></Wrap>
  )
  const newBtn = screen.getByTitle('新会话')
  // 新会话按钮不在 .inline-switcher 内
  expect(container.querySelector('.inline-switcher')?.contains(newBtn)).toBe(false)
  await userEvent.click(newBtn)
  expect(onNew).toHaveBeenCalledOnce()
})

test('点历史按钮开合 SessionHistory 弹窗（Issue 14：必须带 open 类才可见，.menu 基类是 display:none）', async () => {
  render(<Wrap><ChatHeader {...base} sessions={[sess('1', 'completed')]} /></Wrap>)
  // 弹窗默认不渲染
  expect(document.querySelector('#chatHistPop')).toBeNull()
  await userEvent.click(screen.getByTitle('历史会话'))
  const pop = document.querySelector('#chatHistPop')
  expect(pop).toBeTruthy()
  // 关键：.menu 基类 display:none，必须带 open 才显示——否则下拉「渲染了但看不见」（Issue 14 的真根因）
  expect(pop?.classList.contains('open')).toBe(true)
})

test('调试模式开启时，dbg-head 显示 activeSession 的 claudeCodeVersion', async () => {
  // 让 getConfig 返回 debugMode: true，触发 SettingsProvider 里的 setDebug(true)
  mockGetConfig.mockResolvedValueOnce({ projectsDir: '/p', skillsDir: '/s', debugMode: true })
  const sessWithVersion: SessionDTO = {
    ...sess('1', 'completed'),
    claudeCodeVersion: '2.1.161',
    sdkVersion: '0.9.5',
  }
  render(
    <Wrap>
      <ChatHeader {...base} sessions={[sessWithVersion]} />
    </Wrap>
  )
  // useEffect 异步加载 config → debugMode 变为 true → dbg-head 渲染
  expect(await screen.findByText(/2\.1\.161/)).toBeTruthy()
  expect(screen.getByText(/sdk 0\.9\.5/)).toBeTruthy()
})
