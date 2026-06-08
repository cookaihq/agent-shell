import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { CliTools } from '../CliTools'

// 用 vi.hoisted 让 fixtures 在 vi.mock 工厂（被提升到文件顶部）里可用
const { JQ_DEF, RIPGREP_DEF, WIN_ONLY_DEF } = vi.hoisted(() => {
  const JQ_DEF = {
    id: 'jq',
    name: 'jq',
    binNames: ['jq'],
    summary: 'JSON 处理利器',
    categories: ['开发'],
    installMethods: [
      { method: 'brew', command: 'brew install jq', platforms: ['darwin', 'linux'] },
    ],
    detailIntro: 'jq 是轻量 JSON 处理器',
    useCases: ['格式化 JSON', '过滤 JSON 字段'],
    guideSteps: [],
    examplePrompts: [],
    friendliness: 5,
    home: 'https://jqlang.github.io/jq/',
    custom: false,
  }
  const RIPGREP_DEF = {
    id: 'ripgrep',
    name: 'ripgrep',
    binNames: ['rg'],
    summary: '极速代码搜索',
    categories: ['开发'],
    installMethods: [
      { method: 'brew', command: 'brew install ripgrep', platforms: ['darwin', 'linux'] },
    ],
    detailIntro: 'ripgrep 是比 grep 快得多的搜索工具',
    useCases: ['代码搜索'],
    guideSteps: [],
    examplePrompts: [],
    friendliness: 4,
    custom: false,
  }
  // 仅 win32 安装方式的工具——在 darwin 平台不应渲染到「可安装」区
  const WIN_ONLY_DEF = {
    id: 'win-tool',
    name: 'WinTool',
    binNames: ['wintool'],
    summary: 'Windows 专属工具',
    categories: ['系统'],
    installMethods: [
      { method: 'choco', command: 'choco install wintool', platforms: ['win32'] },
    ],
    detailIntro: 'Windows 专属',
    useCases: [],
    guideSteps: [],
    examplePrompts: [],
    friendliness: 2,
    custom: false,
  }
  return { JQ_DEF, RIPGREP_DEF, WIN_ONLY_DEF }
})

vi.mock('../../api/client', () => ({
  ApiError: class extends Error {},
  api: {
    // jq 已安装（detected installed v1.7），ripgrep 未装，win-tool 未装
    getCliCatalog: vi.fn().mockResolvedValue({
      tools: [JQ_DEF, RIPGREP_DEF, WIN_ONLY_DEF],
    }),
    getCliInstalled: vi.fn().mockResolvedValue({
      detected: [
        { id: 'jq', status: 'installed', version: '1.7', binPath: '/usr/local/bin/jq' },
        { id: 'ripgrep', status: 'not_installed', version: null, binPath: null },
        { id: 'win-tool', status: 'not_installed', version: null, binPath: null },
      ],
      custom: [],
      platform: 'darwin',
    }),
    addCustomCliTool: vi.fn().mockResolvedValue({ tool: { id: 'custom-1', name: 'mytool', binName: 'mytool', binPath: '/usr/local/bin/mytool', version: null, createdAt: Date.now() } }),
    removeCustomCliTool: vi.fn().mockResolvedValue({ ok: true }),
  },
}))

test('1. jq（已安装）出现在已安装区，显示版本', async () => {
  render(<CliTools />)
  // 等待异步加载
  const jqEl = await screen.findByText('jq')
  expect(jqEl).toBeInTheDocument()
  // 版本号显示
  expect(await screen.findByText(/v1\.7/)).toBeInTheDocument()
  // 在「已安装」区段里
  const installedSection = document.querySelector('.clit-sec')
  expect(installedSection).toBeInTheDocument()
  expect(installedSection?.textContent).toContain('已安装')
})

test('2. ripgrep（未装，支持 darwin）出现在可安装区', async () => {
  render(<CliTools />)
  // 等待渲染
  await screen.findByText('jq')
  expect(await screen.findByText('ripgrep')).toBeInTheDocument()
  // 「安装」按钮出现（ripgrep 未安装）
  const installBtns = await screen.findAllByRole('button', { name: /安装/ })
  expect(installBtns.length).toBeGreaterThan(0)
})

test('3. win-tool（仅 win32 安装方式）在 platform=darwin 时不渲染到可安装区', async () => {
  render(<CliTools />)
  await screen.findByText('jq')
  // WinTool 不应出现
  expect(screen.queryByText('WinTool')).not.toBeInTheDocument()
})

test('4. 点 ripgrep「安装」→ onInstallSeed 被调，入参含 as_cli_install + name + id', async () => {
  const onInstallSeed = vi.fn()
  render(<CliTools onInstallSeed={onInstallSeed} />)
  // 等待 ripgrep 渲染
  await screen.findByText('ripgrep')
  // 找到「安装」按钮（可安装区的 clit-act is-add 按钮）
  const installBtns = document.querySelectorAll('.clit-act.is-add')
  expect(installBtns.length).toBeGreaterThan(0)
  fireEvent.click(installBtns[0])
  // onInstallSeed 被调
  expect(onInstallSeed).toHaveBeenCalledTimes(1)
  const arg = onInstallSeed.mock.calls[0][0] as string
  // 入参必须包含 as_cli_install + 工具名 + id
  expect(arg).toContain('as_cli_install')
  expect(arg).toContain('ripgrep')
  expect(arg).toContain('id: ripgrep')
  // 参考命令（当前平台 darwin 的 installMethod command）被选对并拼入提示词
  expect(arg).toContain('brew install ripgrep')
})

test('5. 无「加入」文案——CliTools 不再使用旧的加入/已加入概念', async () => {
  render(<CliTools />)
  await screen.findByText('jq')
  // 「加入」和「已加入」文字不应出现
  expect(screen.queryByText('加入')).not.toBeInTheDocument()
  expect(screen.queryByText('已加入')).not.toBeInTheDocument()
})

test('6. 自定义工具：addCustomCliTool 调用成功后重载', async () => {
  const { api } = await import('../../api/client')
  render(<CliTools />)
  await screen.findByText('jq')
  // 打开「登记自定义工具」弹窗
  const addBtn = screen.getByRole('button', { name: /登记自定义工具/ })
  fireEvent.click(addBtn)
  // 弹窗出现
  expect(await screen.findByRole('dialog', { name: /登记 CLI 工具/ })).toBeInTheDocument()
  // 填入路径（取可执行文件绝对路径字段的 input）
  const dialog = screen.getByRole('dialog', { name: /登记 CLI 工具/ })
  const pathInput = dialog.querySelector('input.field-input') as HTMLInputElement
  fireEvent.change(pathInput, { target: { value: '/usr/local/bin/mytool' } })
  // 点添加
  const saveBtn = screen.getByRole('button', { name: '添加' })
  fireEvent.click(saveBtn)
  // addCustomCliTool 被调用
  await waitFor(() => expect(api.addCustomCliTool).toHaveBeenCalledWith('/usr/local/bin/mytool', undefined, undefined))
})
