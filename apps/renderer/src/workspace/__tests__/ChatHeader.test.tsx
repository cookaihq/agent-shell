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
  const active = container.querySelector('.sess-tabs .sess-tab.is-active')
  expect(active?.querySelector('.st-title')?.textContent).toBe('当前会话标题')
  expect(active?.querySelector('.st-meta')).toBeNull()   // 不再显示 · N 消息数
})

test('多个已打开会话各一个 tab；单 tab 时不显示关闭按钮', () => {
  const one = render(<Wrap><ChatHeader {...base} sessions={[sess('1', 'completed')]} /></Wrap>)
  expect(one.container.querySelectorAll('.sess-tab').length).toBe(1)
  expect(one.container.querySelector('.sess-tab .st-x')).toBeNull()   // 仅一个 tab → 不可关
  one.unmount()
  const two = render(<Wrap><ChatHeader {...base} openSessionIds={['1', '2']} sessions={[sess('1', 'completed'), sess('2', 'idle')]} /></Wrap>)
  expect(two.container.querySelectorAll('.sess-tab').length).toBe(2)
  expect(two.container.querySelectorAll('.sess-tab .st-x').length).toBe(2)
})

test('点非当前 tab → onSelect；× → onCloseTab（不删会话）', async () => {
  const onSelect = vi.fn(); const onCloseTab = vi.fn()
  const { container } = render(
    <Wrap><ChatHeader {...base} openSessionIds={['1', '2']} onSelect={onSelect} onCloseTab={onCloseTab}
      sessions={[sess('1', 'completed'), sess('2', 'idle', '会话二')]} /></Wrap>
  )
  const tabs = container.querySelectorAll('.sess-tab')
  await userEvent.click(tabs[1])   // 点会话二
  expect(onSelect).toHaveBeenCalledWith('2')
  await userEvent.click(tabs[1].querySelector('.st-x')!)
  expect(onCloseTab).toHaveBeenCalledWith('2')
})

test('hist-count 显示已完成会话数（排除当前会话）', () => {
  const { container } = render(
    <Wrap>
      <ChatHeader
        {...base}
        sessions={[sess('1', 'completed'), sess('2', 'completed'), sess('3', 'aborted')]}
      />
    </Wrap>
  )
  // 当前会话 id=1 被排除；s2 completed 计入；s3 aborted 不计入 → 1
  expect(container.querySelector('#histCount')?.textContent).toBe('1')
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
