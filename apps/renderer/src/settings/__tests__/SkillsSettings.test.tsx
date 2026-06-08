import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { SkillsSettings } from '../SkillsSettings'
import { SettingsProvider } from '../SettingsContext'

// 在左栏 .src-list 里按分组名找到分组行（分组名在右栏不重复出现，但限定容器更稳）
async function findGroupRow(name: string): Promise<HTMLElement> {
  return await waitFor(() => {
    const rows = Array.from(document.querySelectorAll('.src-list .src-row')) as HTMLElement[]
    const row = rows.find(r => r.querySelector('.src-name')?.textContent === name)
    if (!row) throw new Error(`分组行未出现: ${name}`)
    return row
  })
}

// 用 vi.hoisted 让 fixtures 在 vi.mock 工厂（被提升到文件顶部）里可用
const { GROUPS, SOURCES, PROBES } = vi.hoisted(() => {
  const GROUPS = [
    { id: 'grp-mine', name: '我的技能组', sortIndex: 0 },
    { id: 'grp-team', name: '团队源', sortIndex: 1 },
  ]
  const SOURCES = [
    { id: 'sp', type: 'folder', name: 'superpowers', loc: '~/code/superpowers', groupId: 'grp-mine', updateMode: 'manual', sortIndex: 0 },
    { id: 'team', type: 'git', provider: 'cnb', name: 'cookaihq/team-skills', loc: 'cnb.cool/cookaihq/team-skills', branch: 'main', private: true, groupId: 'grp-team', updateMode: 'manual', sortIndex: 1 },
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
  return { GROUPS, SOURCES, PROBES }
})

vi.mock('../../api/client', () => ({
  ApiError: class extends Error {},
  api: {
    listSkillGroups: vi.fn().mockResolvedValue({ groups: GROUPS }),
    listSkillSources: vi.fn().mockResolvedValue({ sources: SOURCES }),
    probeSkillSource: vi.fn((id: string) => Promise.resolve({ skills: PROBES[id] ?? [] })),
    reprobeSkillSource: vi.fn((id: string) => Promise.resolve({ skills: PROBES[id] ?? [] })),
    skillSourceMd: vi.fn().mockResolvedValue({ content: '---\nname: x\n---\n# x' }),
    toggleSkillLib: vi.fn().mockResolvedValue({ ok: true }),
    setSourceUpdateMode: vi.fn().mockResolvedValue({ source: SOURCES[0] }),
    patchSkillSource: vi.fn().mockResolvedValue({ source: SOURCES[0] }),
    removeSkillSource: vi.fn().mockResolvedValue({ ok: true }),
    addSkillGroup: vi.fn().mockResolvedValue({ group: { id: 'grp-new', name: '新分组', sortIndex: 2 } }),
    patchSkillGroup: vi.fn().mockResolvedValue({ group: GROUPS[0] }),
    removeSkillGroup: vi.fn().mockResolvedValue({ ok: true }),
    reorderSkillGroups: vi.fn().mockResolvedValue({ ok: true }),
    listSkillLibrary: vi.fn().mockResolvedValue({ skills: [] }),
    listEntityRequirements: vi.fn().mockResolvedValue({ requirements: {} }),
    listSecrets: vi.fn().mockResolvedValue({ secrets: [], usage: {} }),
    getConfig: vi.fn().mockResolvedValue({ debugMode: false }),
    setAutoInject: vi.fn().mockResolvedValue({ ok: true }),
  },
}))

test('1. 左栏渲染技能库总览行 + 分组行（含「来源·技能」副标题）', async () => {
  render(<SettingsProvider><SkillsSettings /></SettingsProvider>)
  const mineRow = await findGroupRow('我的技能组')
  expect(mineRow).toBeInTheDocument()
  // 副标题含「来源」「技能」
  const sub = mineRow.querySelector('.src-row-sub')?.textContent || ''
  expect(sub).toContain('来源')
  expect(sub).toContain('技能')
  // 技能库总览行
  const libRow = document.querySelector('.src-row--lib') as HTMLElement
  expect(libRow).toBeTruthy()
  expect(libRow.textContent || '').toContain('技能库')
})

test('2. 点分组 → 右栏显示成员条 + 聚合技能；globalIn 非空显示覆盖预警', async () => {
  render(<SettingsProvider><SkillsSettings /></SettingsProvider>)
  await userEvent.click(await findGroupRow('我的技能组'))
  // 成员条：superpowers 成员行
  await waitFor(() => {
    const mem = Array.from(document.querySelectorAll('.mem-row .mem-name')).map(e => e.textContent)
    expect(mem.some(t => t?.includes('superpowers'))).toBe(true)
  })
  // 聚合技能行
  expect(screen.getByText('brainstorming')).toBeInTheDocument()
  // 覆盖预警：globalIn=['claude'] 的 brainstorming 行有 .si-shadow
  const shadow = document.querySelector('.si-shadow') as HTMLElement
  expect(shadow).toBeTruthy()
  expect(shadow.getAttribute('title') || '').toContain('覆盖')
})

test('3. 点技能行打开 SKILL.md 弹窗（调用 skillSourceMd）', async () => {
  render(<SettingsProvider><SkillsSettings /></SettingsProvider>)
  await userEvent.click(await findGroupRow('我的技能组'))
  await userEvent.click(await screen.findByText('brainstorming'))
  expect(await screen.findByText((_t, el) => !!el && el.classList.contains('skill-md-modal'))).toBeTruthy()
  const { api } = await import('../../api/client') as any
  expect(api.skillSourceMd).toHaveBeenCalledWith('sp', 'brainstorming/')
})

test('4. 添加分组按钮调用 addSkillGroup', async () => {
  const { api } = await import('../../api/client') as any
  api.addSkillGroup.mockClear()
  render(<SettingsProvider><SkillsSettings /></SettingsProvider>)
  await findGroupRow('我的技能组')
  await userEvent.click(screen.getByRole('button', { name: /添加分组/ }))
  expect(api.addSkillGroup).toHaveBeenCalledWith({ name: '新分组' })
})

test('5. 技能库视图点「未入库」筛选 → 列出 inLib:false 的技能', async () => {
  render(<SettingsProvider><SkillsSettings /></SettingsProvider>)
  await findGroupRow('我的技能组')
  // 默认技能库视图 + 默认筛选 in：只显示已入库，不含 writing-plans
  expect(screen.queryByText('writing-plans')).not.toBeInTheDocument()
  const outBtn = await screen.findByRole('button', { name: /未入库/ })
  await userEvent.click(outBtn)
  expect(await screen.findByText('writing-plans')).toBeInTheDocument()
  expect(screen.getByText('ad-creative')).toBeInTheDocument()
})

test('6. cfgState：绑定到无值密钥 → 需配置；绑定到有值密钥 → 已配置', async () => {
  const cfgGroups = [{ id: 'g-cfg', name: '配置组', sortIndex: 0 }]
  const cfgSources = [
    { id: 'cfg-src', type: 'folder', name: 'cfg-source', loc: '~/cfg', groupId: 'g-cfg', updateMode: 'manual', sortIndex: 0 },
  ]
  const cfgProbes = {
    'cfg-src': [
      { sourceId: 'cfg-src', name: 'skill-need', relPath: 'skill-need/', desc: '需配置技能', inLib: true, globalIn: [], effectiveName: 'skill-need' },
      { sourceId: 'cfg-src', name: 'skill-done', relPath: 'skill-done/', desc: '已配置技能', inLib: true, globalIn: [], effectiveName: 'skill-done' },
    ],
  }
  // skill-need 绑到空值密钥（hasValue:false）→ need；skill-done 绑到有值密钥 → done
  const cfgReqs = {
    'skill:skill-need': { needsConfig: true, slotsSource: 'agent', slots: [{ name: 'NEED_KEY', kind: 'env', bind: 'sec-empty', default: null }] },
    'skill:skill-done': { needsConfig: true, slotsSource: 'agent', slots: [{ name: 'DONE_KEY', kind: 'env', bind: 'sec-full', default: null }] },
  }
  const cfgSecrets = [
    { id: 'sec-empty', name: '空密钥', hasValue: false, maskedValue: '' },
    { id: 'sec-full', name: '有值密钥', hasValue: true, maskedValue: '…1a2b' },
  ]

  const { api } = await import('../../api/client') as any
  api.listSkillGroups.mockResolvedValue({ groups: cfgGroups })
  api.listSkillSources.mockResolvedValue({ sources: cfgSources })
  api.probeSkillSource.mockImplementation((id: string) => Promise.resolve({ skills: cfgProbes[id as keyof typeof cfgProbes] ?? [] }))
  api.listEntityRequirements.mockResolvedValue({ requirements: cfgReqs })
  api.listSecrets.mockResolvedValue({ secrets: cfgSecrets, usage: {} })

  render(<SettingsProvider><SkillsSettings /></SettingsProvider>)

  await waitFor(() => {
    const rows = Array.from(document.querySelectorAll('.src-list .src-row')) as HTMLElement[]
    if (!rows.find(r => r.querySelector('.src-name')?.textContent === '配置组')) throw new Error('配置组 未出现')
  })

  // 默认技能库视图（已入库），两个技能都在库里
  await waitFor(() => {
    expect(screen.getByText('需配置')).toBeInTheDocument()
  })
  expect(screen.getByText('已配置')).toBeInTheDocument()

  // 恢复默认 mock
  api.listSkillGroups.mockResolvedValue({ groups: GROUPS })
  api.listSkillSources.mockResolvedValue({ sources: SOURCES })
  api.probeSkillSource.mockImplementation((id: string) => Promise.resolve({ skills: PROBES[id] ?? [] }))
  api.listEntityRequirements.mockResolvedValue({ requirements: {} })
  api.listSecrets.mockResolvedValue({ secrets: [], usage: {} })
})

test('7. 默认注入开关 → 调 setAutoInject', async () => {
  const libSkillsWithAutoInject = [
    { effectiveName: 'brainstorming', name: 'brainstorming', desc: '把想法逐步打磨成方案与 spec', sourceId: 'sp', sourceName: 'superpowers', globalIn: [], needsConfig: false, autoInject: false },
  ]
  const { api } = await import('../../api/client') as any
  api.listSkillLibrary.mockResolvedValue({ skills: libSkillsWithAutoInject })
  api.setAutoInject.mockClear()

  render(<SettingsProvider><SkillsSettings /></SettingsProvider>)
  await findGroupRow('我的技能组')
  // 默认技能库视图「已入库」，brainstorming（inLib:true）应出现，带默认注入开关
  const toggle = await waitFor(() => {
    const btn = document.querySelector('[aria-label="默认注入"]') as HTMLElement
    if (!btn) throw new Error('默认注入 toggle 未出现')
    return btn
  })
  await userEvent.click(toggle)
  expect(api.setAutoInject).toHaveBeenCalledWith('brainstorming', true)

  api.listSkillLibrary.mockResolvedValue({ skills: [] })
})
