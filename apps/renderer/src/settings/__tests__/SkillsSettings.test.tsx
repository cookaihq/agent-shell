import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { SkillsSettings } from '../SkillsSettings'

// 在左栏 .src-list 里按源名找到源行（"superpowers" 等名字在库视图技能行的 .si-src 里也会出现，
// 直接 findByText 会撞多个，故限定在源列表容器内）
async function findSourceRow(name: string): Promise<HTMLElement> {
  return await waitFor(() => {
    const rows = Array.from(document.querySelectorAll('.src-list .src-row')) as HTMLElement[]
    const row = rows.find(r => r.querySelector('.src-name')?.textContent === name)
    if (!row) throw new Error(`源行未出现: ${name}`)
    return row
  })
}

// 用 vi.hoisted 让 fixtures 在 vi.mock 工厂（被提升到文件顶部）里可用
const { SOURCES, PROBES } = vi.hoisted(() => {
  const SOURCES = [
    { id: 'sp', type: 'folder', name: 'superpowers', loc: '~/code/superpowers', updateMode: 'manual', sortIndex: 0 },
    { id: 'team', type: 'git', provider: 'cnb', name: 'cookaihq/team-skills', loc: 'cnb.cool/cookaihq/team-skills', branch: 'main', private: true, updateMode: 'manual', sortIndex: 1 },
  ]
  const PROBES: Record<string, any[]> = {
    sp: [
      { sourceId: 'sp', name: 'brainstorming', relPath: 'brainstorming/', desc: '把想法逐步打磨成方案与 spec', inLib: true, globalIn: ['claude'] },
      { sourceId: 'sp', name: 'writing-plans', relPath: 'writing-plans/', desc: '把 spec 拆成可执行的实现计划', inLib: false, globalIn: [] },
    ],
    team: [
      { sourceId: 'team', name: 'guizang-ppt', relPath: 'guizang-ppt/', desc: '杂志风 deck 生成', inLib: true, globalIn: [] },
      { sourceId: 'team', name: 'ad-creative', relPath: 'ad-creative/', desc: '广告创意：标题 / 描述 / 主文案', inLib: false, globalIn: [] },
    ],
  }
  return { SOURCES, PROBES }
})

vi.mock('../../api/client', () => ({
  ApiError: class extends Error {},
  api: {
    listSkillSources: vi.fn().mockResolvedValue({ sources: SOURCES }),
    probeSkillSource: vi.fn((id: string) => Promise.resolve({ skills: PROBES[id] ?? [] })),
    reprobeSkillSource: vi.fn((id: string) => Promise.resolve({ skills: PROBES[id] ?? [] })),
    skillSourceMd: vi.fn().mockResolvedValue({ content: '---\nname: x\n---\n# x' }),
    toggleSkillLib: vi.fn().mockResolvedValue({ ok: true }),
    setSourceUpdateMode: vi.fn().mockResolvedValue({ source: SOURCES[0] }),
    patchSkillSource: vi.fn().mockResolvedValue({ source: SOURCES[0] }),
    removeSkillSource: vi.fn().mockResolvedValue({ ok: true }),
    reorderSkillSources: vi.fn().mockResolvedValue({ ok: true }),
    listSkillLibrary: vi.fn().mockResolvedValue({ skills: [] }),
  },
}))

test('1. 渲染技能库总览行 + 两个源行', async () => {
  render(<SkillsSettings />)
  // 等数据加载完（源行出现，限定在左栏源列表）
  expect(await findSourceRow('superpowers')).toBeInTheDocument()
  expect(await findSourceRow('cookaihq/team-skills')).toBeInTheDocument()
  // 技能库总览行（左栏 .src-row--lib 里的 .src-name）
  const libRow = document.querySelector('.src-row--lib') as HTMLElement
  expect(libRow).toBeTruthy()
  expect(libRow.textContent || '').toContain('技能库')
})

test('2. 选中源显示更新策略三档 + 技能行；globalIn 非空显示覆盖预警', async () => {
  render(<SkillsSettings />)
  await userEvent.click(await findSourceRow('superpowers'))
  // 三档分段
  expect(await screen.findByRole('button', { name: '手动' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '自动更新' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '自动更新+入库' })).toBeInTheDocument()
  // 技能行
  expect(screen.getByText('brainstorming')).toBeInTheDocument()
  expect(screen.getByText('writing-plans')).toBeInTheDocument()
  // 覆盖预警：globalIn=['claude'] 的 brainstorming 行有 .si-shadow（title 含「覆盖」）
  const shadow = document.querySelector('.si-shadow') as HTMLElement
  expect(shadow).toBeTruthy()
  expect(shadow.getAttribute('title') || '').toContain('覆盖')
})

test('3. 点技能行打开 SKILL.md 弹窗（调用 skillSourceMd）', async () => {
  render(<SkillsSettings />)
  await userEvent.click(await findSourceRow('superpowers'))
  await userEvent.click(await screen.findByText('brainstorming'))
  expect(await screen.findByText((_t, el) => !!el && el.classList.contains('skill-md-modal'))).toBeTruthy()
  const { api } = await import('../../api/client') as any
  expect(api.skillSourceMd).toHaveBeenCalledWith('sp', 'brainstorming/')
})

test('4. 切换弹窗 Switch（未入库技能）调用 toggleSkillLib { inLib:true }', async () => {
  render(<SkillsSettings />)
  await userEvent.click(await findSourceRow('superpowers'))
  // writing-plans 未入库
  await userEvent.click(await screen.findByText('writing-plans'))
  await screen.findByText((_t, el) => !!el && el.classList.contains('skill-md-modal'))
  const toggle = document.querySelector('.smm-foot .toggle') as HTMLElement
  expect(toggle).toBeTruthy()
  await userEvent.click(toggle)
  const { api } = await import('../../api/client') as any
  expect(api.toggleSkillLib).toHaveBeenCalledWith(
    expect.objectContaining({ sourceId: 'sp', relPath: 'writing-plans/', inLib: true })
  )
})

test('5. 技能库视图点「未入库」筛选 → 列出 inLib:false 的技能', async () => {
  render(<SkillsSettings />)
  // 默认就是技能库视图（selected=__lib__），等加载完（源行出现）
  await findSourceRow('superpowers')
  // 默认筛选 in：只显示已入库（brainstorming / guizang-ppt），不含 writing-plans
  expect(screen.queryByText('writing-plans')).not.toBeInTheDocument()
  // 点「未入库」筛选
  const outBtn = await screen.findByRole('button', { name: /未入库/ })
  await userEvent.click(outBtn)
  // 切到未入库：列出 writing-plans / ad-creative（技能名唯一）
  expect(await screen.findByText('writing-plans')).toBeInTheDocument()
  expect(screen.getByText('ad-creative')).toBeInTheDocument()
})

test('6. 两个源均有同名已入库技能 → 库视图显示 .si-dup 重名标', async () => {
  // 两源都有 name='pdf' inLib:true → dupNames 应把它标记为重复
  const dupSources = [
    { id: 'a', type: 'folder', name: 'src-a', loc: '~/a', updateMode: 'manual', sortIndex: 0 },
    { id: 'b', type: 'folder', name: 'src-b', loc: '~/b', updateMode: 'manual', sortIndex: 1 },
  ]
  const dupProbes: Record<string, any[]> = {
    a: [{ sourceId: 'a', name: 'pdf', relPath: 'pdf/', desc: 'PDF 技能', inLib: true, globalIn: [] }],
    b: [{ sourceId: 'b', name: 'pdf', relPath: 'pdf/', desc: 'PDF 技能', inLib: true, globalIn: [] }],
  }
  const { api } = await import('../../api/client') as any
  api.listSkillSources.mockResolvedValue({ sources: dupSources })
  api.probeSkillSource.mockImplementation((id: string) => Promise.resolve({ skills: dupProbes[id] ?? [] }))
  render(<SkillsSettings />)
  // 等两个源行出现（数据加载完）
  await waitFor(() => {
    const rows = Array.from(document.querySelectorAll('.src-list .src-row')) as HTMLElement[]
    const row = rows.find(r => r.querySelector('.src-name')?.textContent === 'src-a')
    if (!row) throw new Error('src-a 未出现')
  })
  // 默认是技能库视图（selected=__lib__）+ 默认筛选「已入库」，两条 pdf 行都在
  // 至少一个 .si-dup 元素出现
  await waitFor(() => {
    expect(document.querySelectorAll('.si-dup').length).toBeGreaterThanOrEqual(1)
  })
  // 恢复默认 mock，避免影响其它测试
  api.listSkillSources.mockResolvedValue({ sources: SOURCES })
  api.probeSkillSource.mockImplementation((id: string) => Promise.resolve({ skills: PROBES[id] ?? [] }))
})
