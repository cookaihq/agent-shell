/**
 * ModelPill.test.tsx — Task 16 测试
 *
 * 用真实 runtimeReducer/initialRuntime/useReducer（不用 inline mock reducer）
 * 在 RuntimeContext.Provider 下渲染，验证：
 *   - 脸显示模型名 + 权限/effort 胶囊
 *   - 弹窗：claude → 权限段 + Effort段 + 模型段
 *   - 弹窗：codex → 审批策略 + 沙箱级别 + Effort段 + 模型段
 *   - 点选选项 dispatch（前端状态，不碰后端）
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useReducer } from 'react'
import type { ReactNode } from 'react'
import { vi } from 'vitest'

// SkillModal（注入选择器）现依赖 useSettings()（去配置链接）；workspace 单测不包 SettingsProvider，
// mock useSettings 返回 no-op openSettings（运行时由 App.tsx 顶层 SettingsProvider 提供，此处镜像之）。
vi.mock('../../settings/SettingsContext', async (orig) => ({ ...(await (orig() as Promise<object>)), useSettings: () => ({ openSettings: vi.fn() }) }))

vi.mock('../../api/client', () => ({
  ApiError: class extends Error {},
  api: {
    models: vi.fn().mockResolvedValue({ models: null }),
    injectSkills: vi.fn().mockResolvedValue({ ok: true }),
    listSkillLibrary: vi.fn().mockResolvedValue({
      skills: [{ effectiveName: 'pdf', name: 'pdf', desc: 'PDF 工具', sourceId: 'a', sourceName: 'anthropics', globalIn: [] }],
    }),
    listProviders: vi.fn().mockResolvedValue({ engines: { claude: { active: 'default', providers: [] }, codex: { active: 'default', providers: [] } } }),
    getConfig: vi.fn().mockResolvedValue({ projectsDir: '', skillsDir: '', modelAliases: {} }),
  },
}))

import { ModelPill } from '../ModelPill'
import { RuntimeContext, initialRuntime, runtimeReducer } from '../runtimeState'
import type { SlashCommand } from '../../api/types'
import { api } from '../../api/client'

function Wrapper({ engine, children }: { engine: 'claude' | 'codex'; children?: ReactNode }) {
  const model = engine === 'claude' ? 'opus' : 'gpt-5.5'
  const [runtime, dispatch] = useReducer(runtimeReducer, undefined, () => initialRuntime(engine, model))
  return (
    <RuntimeContext.Provider value={{ runtime, dispatch }}>
      {children ?? <ModelPill />}
    </RuntimeContext.Provider>
  )
}

test('claude 脸显示模型名（value→displayName，走 VS Code 对齐）', () => {
  // 不用共享 Wrapper（写死 model='opus'，对齐后被丢弃）；改用对齐后仍存在的 value 测脸名。
  function FaceWrapper() {
    const [runtime, dispatch] = useReducer(runtimeReducer, undefined, () => initialRuntime('claude', 'opus[1m]'))
    return (
      <RuntimeContext.Provider value={{ runtime, dispatch }}>
        <ModelPill />
      </RuntimeContext.Provider>
    )
  }
  render(<FaceWrapper />)
  expect(screen.getByText('Opus 1M')).toBeInTheDocument()   // 'opus[1m]' → 对齐后 displayName
})

test('claude 弹窗：权限段 + 思考强度 +「折叠的模型段（当前项 + caret，不平铺全部）」', async () => {
  render(<Wrapper engine="claude" />)
  await userEvent.click(screen.getByRole('button', { name: /opus/i }))
  expect(screen.getByText('权限')).toBeInTheDocument()
  expect(screen.getByText('绕过权限')).toBeInTheDocument()
  expect(screen.getByText('思考强度')).toBeInTheDocument()
  // 折叠态：模型段只渲染折叠行（data-model-toggle）+ caret，不平铺 Haiku/Sonnet
  expect(document.querySelector('[data-model-toggle]')).toBeInTheDocument()
  expect(document.querySelector('.mi-caret')).toBeInTheDocument()
  // 折叠态下 Haiku 不在 popup 里直接出现（要点折叠行才呼出）
  expect(screen.queryByText('Haiku')).not.toBeInTheDocument()
})

test('claude 静态兜底（无活会话）：折叠行展示当前项、过对齐（非 1M Opus 不当当前项露出）', async () => {
  // Wrapper 的 claude model 默认 'opus'；对齐后非 1M opus 被丢、当前项回落对齐列表首个
  render(<Wrapper engine="claude" />)
  await userEvent.click(screen.getByRole('button', { name: /opus/i }))
  const toggle = document.querySelector('[data-model-toggle]') as HTMLElement
  expect(toggle).toBeInTheDocument()
  // 折叠行里出现的 mi-title 必属于对齐后 4 条之一（不会是被丢弃的裸 'Opus'）
  const title = toggle.querySelector('.mi-title')?.textContent ?? ''
  expect(['Default (recommended)', 'Sonnet', 'Haiku', 'Opus 1M']).toContain(title)
})

test('claude 点权限档 → dispatch SET_PERMISSION_MODE（脸胶囊更新）', async () => {
  function ObservableWrapper() {
    const [runtime, dispatch] = useReducer(runtimeReducer, undefined, () => initialRuntime('claude', 'opus'))
    return (
      <RuntimeContext.Provider value={{ runtime, dispatch }}>
        <ModelPill />
        <span data-testid="cmode">{runtime.permissionMode}</span>
      </RuntimeContext.Provider>
    )
  }
  render(<ObservableWrapper />)
  await userEvent.click(screen.getByRole('button', { name: /opus/i }))
  await userEvent.click(screen.getByText('计划模式'))
  expect(screen.getByTestId('cmode').textContent).toBe('plan')
})

test('codex 点审批/沙箱档 → dispatch SET_MODE_SELECTION（写 modeSelections 槽）', async () => {
  function ObservableWrapper() {
    const [runtime, dispatch] = useReducer(runtimeReducer, undefined, () => initialRuntime('codex', 'gpt-5.5'))
    return (
      <RuntimeContext.Provider value={{ runtime, dispatch }}>
        <ModelPill />
        <span data-testid="approval">{runtime.modeSelections?.approval}</span>
        <span data-testid="sandbox">{runtime.modeSelections?.sandbox}</span>
      </RuntimeContext.Provider>
    )
  }
  render(<ObservableWrapper />)
  await userEvent.click(screen.getByRole('button', { name: /GPT 5/ }))
  await userEvent.click(screen.getByText('从不询问'))
  expect(screen.getByTestId('approval').textContent).toBe('never')
  await userEvent.click(screen.getByText('完全访问'))
  expect(screen.getByTestId('sandbox').textContent).toBe('danger-full-access')
})

test('codex 弹窗有审批策略 + 沙箱级别', async () => {
  render(<Wrapper engine="codex" />)
  await userEvent.click(screen.getByRole('button', { name: /GPT 5/ }))
  expect(screen.getByText('审批策略')).toBeInTheDocument()
  expect(screen.getByText('沙箱级别')).toBeInTheDocument()
})

test('点 model-btn 外部关闭弹窗', async () => {
  render(
    <div>
      <Wrapper engine="claude" />
      <div data-testid="outside">outside</div>
    </div>
  )
  await userEvent.click(screen.getByRole('button', { name: /opus/i }))
  expect(screen.getByText('思考强度')).toBeInTheDocument()
  // 点外部
  await userEvent.click(screen.getByTestId('outside'))
  expect(screen.queryByText('思考强度')).not.toBeInTheDocument()
})

test('点折叠行 → 呼出 flyout（含对齐后全部模型）', async () => {
  render(<Wrapper engine="claude" />)
  await userEvent.click(screen.getByRole('button', { name: /opus/i }))
  await userEvent.click(document.querySelector('[data-model-toggle]') as HTMLElement)
  const flyout = document.querySelector('.model-flyout') as HTMLElement
  expect(flyout).toBeInTheDocument()
  // 对齐后 4 条都在 flyout 里（折叠态本体只 1 条，故这些只能来自 flyout）
  expect(within(flyout).getByText('Sonnet')).toBeInTheDocument()
  expect(within(flyout).getByText('Haiku')).toBeInTheDocument()
  expect(within(flyout).getByText('Opus 1M')).toBeInTheDocument()
})

test('flyout 选一条 → dispatch SET_MODEL + 关 flyout + 关 popup', async () => {
  function ObservableWrapper() {
    const [runtime, dispatch] = useReducer(runtimeReducer, undefined, () => initialRuntime('claude', 'opus'))
    return (
      <RuntimeContext.Provider value={{ runtime, dispatch }}>
        <ModelPill />
        <span data-testid="model">{runtime.model}</span>
      </RuntimeContext.Provider>
    )
  }
  render(<ObservableWrapper />)
  await userEvent.click(screen.getByRole('button', { name: /opus/i }))
  await userEvent.click(document.querySelector('[data-model-toggle]') as HTMLElement)
  const flyout = document.querySelector('.model-flyout') as HTMLElement
  await userEvent.click(within(flyout).getByText('Sonnet'))
  expect(screen.getByTestId('model').textContent).toBe('sonnet')   // SET_MODEL 生效
  expect(document.querySelector('.model-flyout')).not.toBeInTheDocument()  // 关 flyout
  expect(screen.queryByText('思考强度')).not.toBeInTheDocument()           // 关 popup
})

test('再点折叠行 → 收起已开的 flyout', async () => {
  render(<Wrapper engine="claude" />)
  await userEvent.click(screen.getByRole('button', { name: /opus/i }))
  const toggle = document.querySelector('[data-model-toggle]') as HTMLElement
  await userEvent.click(toggle)
  expect(document.querySelector('.model-flyout')).toBeInTheDocument()
  await userEvent.click(toggle)
  expect(document.querySelector('.model-flyout')).not.toBeInTheDocument()
})

// ── Slash Commands 命令区（Task 5：命令源接入 SDK supportedCommands）──────────

const SLASH_CMDS: SlashCommand[] = [
  { name: 'plan', description: '生成执行计划', argumentHint: '' },
  { name: 'review', description: '审查改动', argumentHint: '' },
]

// 命令经 prop 注入的 claude 弹窗 wrapper（复用现有 RuntimeContext.Provider + initialRuntime 模式）
function CmdWrapper({ commands, onInsert }: { commands: SlashCommand[]; onInsert?: (name: string) => void }) {
  const [runtime, dispatch] = useReducer(runtimeReducer, undefined, () => initialRuntime('claude', 'opus'))
  return (
    <RuntimeContext.Provider value={{ runtime, dispatch }}>
      <ModelPill commands={commands} onInsertCommand={onInsert} />
    </RuntimeContext.Provider>
  )
}

test('命令区渲染动态命令（claude）', async () => {
  render(<CmdWrapper commands={SLASH_CMDS} />)
  await userEvent.click(screen.getByRole('button', { name: /opus/i }))
  expect(screen.getByText('Slash Commands')).toBeInTheDocument()
  expect(screen.getByText('/plan')).toBeInTheDocument()
  expect(screen.getByText('/review')).toBeInTheDocument()
  expect(screen.getByText('生成执行计划')).toBeInTheDocument()
})

test('点命令行 → onInsertCommand(name)', async () => {
  const onInsert = vi.fn()
  render(<CmdWrapper commands={SLASH_CMDS} onInsert={onInsert} />)
  await userEvent.click(screen.getByRole('button', { name: /opus/i }))
  await userEvent.click(screen.getByText('/plan'))
  expect(onInsert).toHaveBeenCalledWith('plan')
})

test('命令区有「注入技能」入口（P3 新增）', async () => {
  render(<CmdWrapper commands={SLASH_CMDS} />)
  await userEvent.click(screen.getByRole('button', { name: /opus/i }))
  expect(screen.getByRole('button', { name: '注入技能' })).toBeInTheDocument()
})

test('无命令 → 命令区仍在（标题 + 注入入口），但无命令项', async () => {
  render(<CmdWrapper commands={[]} />)
  await userEvent.click(screen.getByRole('button', { name: /opus/i }))
  expect(screen.getByText('Slash Commands')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '注入技能' })).toBeInTheDocument()
  expect(document.querySelector('.cmd-item')).toBeNull()
})

test('claude 弹窗 Slash Commands 区「注入技能」入口 → 开 SkillModal → onDone 调 api.injectSkills(projectId, names)', async () => {
  render(
    <Wrapper engine="claude">
      <ModelPill projectId="proj-1" />
    </Wrapper>,
  )
  await userEvent.click(screen.getByRole('button', { name: /opus/i }))
  expect(screen.getByText('Slash Commands')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '注入技能' }))
  expect(await screen.findByText('PDF 工具')).toBeInTheDocument()
  await userEvent.click(screen.getByText('pdf'))
  await userEvent.click(screen.getByText('完成'))
  expect(api.injectSkills).toHaveBeenCalledWith('proj-1', ['pdf'])
})

test('注入成功 → 显示成功 toast', async () => {
  render(
    <Wrapper engine="claude">
      <ModelPill projectId="proj-1" />
    </Wrapper>,
  )
  await userEvent.click(screen.getByRole('button', { name: /opus/i }))
  await userEvent.click(screen.getByRole('button', { name: '注入技能' }))
  expect(await screen.findByText('PDF 工具')).toBeInTheDocument()
  await userEvent.click(screen.getByText('pdf'))
  await userEvent.click(screen.getByText('完成'))
  expect(await screen.findByText('已注入技能到当前项目')).toBeInTheDocument()
})

test('注入失败 → 显示失败 toast', async () => {
  vi.mocked(api.injectSkills).mockRejectedValueOnce(new Error('boom'))
  render(
    <Wrapper engine="claude">
      <ModelPill projectId="proj-1" />
    </Wrapper>,
  )
  await userEvent.click(screen.getByRole('button', { name: /opus/i }))
  await userEvent.click(screen.getByRole('button', { name: '注入技能' }))
  expect(await screen.findByText('PDF 工具')).toBeInTheDocument()
  await userEvent.click(screen.getByText('pdf'))
  await userEvent.click(screen.getByText('完成'))
  expect(await screen.findByText('注入技能失败')).toBeInTheDocument()
})

// ── 打开弹框时触发命令取数（slash-command-probe：取数从 mount 一次性 → 打开时取）──────────

test('claude 打开弹框 → 触发 onOpenCommands（按需取数，不在 mount 取）', async () => {
  const onOpen = vi.fn()
  function W() {
    const [runtime, dispatch] = useReducer(runtimeReducer, undefined, () => initialRuntime('claude', 'opus'))
    return (
      <RuntimeContext.Provider value={{ runtime, dispatch }}>
        <ModelPill onOpenCommands={onOpen} />
      </RuntimeContext.Provider>
    )
  }
  render(<W />)
  expect(onOpen).not.toHaveBeenCalled()                 // mount 不取
  await userEvent.click(screen.getByRole('button', { name: /opus/i }))
  expect(onOpen).toHaveBeenCalledTimes(1)               // 打开才取
})

test('codex 打开弹框 → 不触发 onOpenCommands（命令是 claude 专属，不为 codex 探针）', async () => {
  const onOpen = vi.fn()
  function W() {
    const [runtime, dispatch] = useReducer(runtimeReducer, undefined, () => initialRuntime('codex', 'gpt-5.5'))
    return (
      <RuntimeContext.Provider value={{ runtime, dispatch }}>
        <ModelPill onOpenCommands={onOpen} />
      </RuntimeContext.Provider>
    )
  }
  render(<W />)
  await userEvent.click(screen.getByRole('button', { name: /GPT 5/ }))
  expect(onOpen).not.toHaveBeenCalled()
})

// ── 顶部过滤框（Filter actions，对齐 VS Code 命令面板）──────────

test('弹窗顶部有过滤输入框，打开自动聚焦', async () => {
  render(<Wrapper engine="claude" />)
  await userEvent.click(screen.getByRole('button', { name: /opus/i }))
  const input = screen.getByPlaceholderText('Filter actions…')
  expect(input).toBeInTheDocument()
  expect(input).toHaveFocus()
})

test('输入关键词 → 权限段只留匹配项（计划模式在、绕过权限/思考强度隐藏）', async () => {
  render(<Wrapper engine="claude" />)
  await userEvent.click(screen.getByRole('button', { name: /opus/i }))
  await userEvent.type(screen.getByPlaceholderText('Filter actions…'), '计划')
  expect(screen.getByText('计划模式')).toBeInTheDocument()
  expect(screen.queryByText('绕过权限')).not.toBeInTheDocument()
  expect(screen.queryByText('思考强度')).not.toBeInTheDocument()
})

test('输入模型名 → 折叠模型段展开并过滤出该模型（popup 内直出，非 flyout）', async () => {
  render(<Wrapper engine="claude" />)
  await userEvent.click(screen.getByRole('button', { name: /opus/i }))
  await userEvent.type(screen.getByPlaceholderText('Filter actions…'), 'Sonnet')
  expect(document.querySelector('.model-flyout')).toBeNull()  // 不靠 flyout
  expect(screen.getByText('Sonnet')).toBeInTheDocument()      // 折叠态被展开过滤后直出
  expect(screen.queryByText('Haiku')).not.toBeInTheDocument()
})

test('输入命令关键词 → 命令区只留匹配命令', async () => {
  render(<CmdWrapper commands={SLASH_CMDS} />)
  await userEvent.click(screen.getByRole('button', { name: /opus/i }))
  await userEvent.type(screen.getByPlaceholderText('Filter actions…'), 'review')
  expect(screen.getByText('/review')).toBeInTheDocument()
  expect(screen.queryByText('/plan')).not.toBeInTheDocument()
})

test('无任何匹配 → 显示「无匹配项」，各段标题隐藏', async () => {
  render(<CmdWrapper commands={SLASH_CMDS} />)
  await userEvent.click(screen.getByRole('button', { name: /opus/i }))
  await userEvent.type(screen.getByPlaceholderText('Filter actions…'), 'zzzznomatch')
  expect(screen.getByText('无匹配项')).toBeInTheDocument()
  expect(screen.queryByText('权限')).not.toBeInTheDocument()
  expect(screen.queryByText('Slash Commands')).not.toBeInTheDocument()
})

test('清空过滤 → 恢复全部项', async () => {
  render(<Wrapper engine="claude" />)
  await userEvent.click(screen.getByRole('button', { name: /opus/i }))
  const input = screen.getByPlaceholderText('Filter actions…')
  await userEvent.type(input, '计划')
  expect(screen.queryByText('绕过权限')).not.toBeInTheDocument()
  await userEvent.clear(input)
  expect(screen.getByText('绕过权限')).toBeInTheDocument()
  expect(screen.getByText('思考强度')).toBeInTheDocument()
})

test('Esc 两段式：有内容先清空（弹窗不关），再按才关弹窗', async () => {
  render(<Wrapper engine="claude" />)
  await userEvent.click(screen.getByRole('button', { name: /opus/i }))
  const input = screen.getByPlaceholderText('Filter actions…') as HTMLInputElement
  await userEvent.type(input, '计划')
  await userEvent.keyboard('{Escape}')
  expect(input.value).toBe('')                                  // 第一下：清空
  expect(screen.getByText('思考强度')).toBeInTheDocument()       // 弹窗仍在
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByText('思考强度')).not.toBeInTheDocument() // 第二下：关弹窗
})

test('Effort 点滑条切换', async () => {
  function ObservableWrapper() {
    const [runtime, dispatch] = useReducer(runtimeReducer, undefined, () => initialRuntime('claude', 'opus'))
    return (
      <RuntimeContext.Provider value={{ runtime, dispatch }}>
        <ModelPill />
        <span data-testid="effort">{runtime.reasoning}</span>
      </RuntimeContext.Provider>
    )
  }
  render(<ObservableWrapper />)
  await userEvent.click(screen.getByRole('button', { name: /opus/i }))
  // 点「低」effort dot
  const dots = document.querySelectorAll('.effort-dot')
  await userEvent.click(dots[0] as HTMLElement)  // 第一个 = 'low'
  expect(screen.getByTestId('effort').textContent).toBe('low')
})
