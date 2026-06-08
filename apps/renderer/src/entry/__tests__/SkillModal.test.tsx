import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SkillModal } from '../SkillModal'

vi.mock('../../api/client', () => ({
  ApiError: class extends Error {},
  api: { listSkillLibrary: vi.fn() },
}))
vi.mock('../../settings/SettingsContext', () => ({
  useSettings: () => ({ openSettings: vi.fn() }),
}))
import { api } from '../../api/client'

const LIB = [
  { effectiveName: 'pdf', name: 'pdf', desc: 'PDF 工具', sourceId: 'a', sourceName: 'anthropics', globalIn: ['claude'] as const },
  { effectiveName: 'brainstorming', name: 'brainstorming', desc: '打磨想法', sourceId: 'b', sourceName: 'superpowers', globalIn: [] as const },
]

describe('SkillModal（注入技能=技能库 + 覆盖预警）', () => {
  beforeEach(() => {
    ;(api.listSkillLibrary as ReturnType<typeof vi.fn>).mockResolvedValue({ skills: LIB })
  })

  it('渲染库内技能；globalIn 非空行有覆盖预警 .si-shadow', async () => {
    render(<SkillModal initialSelected={[]} onClose={() => {}} onDone={() => {}} />)
    expect(await screen.findByText('pdf')).toBeInTheDocument()
    expect(screen.getByText('brainstorming')).toBeInTheDocument()
    const shadow = document.querySelector('.si-shadow') as HTMLElement
    expect(shadow).toBeTruthy()
    expect(shadow.getAttribute('title') || '').toContain('覆盖')
  })

  it('多选 → onDone 回传 effectiveName 数组', async () => {
    const onDone = vi.fn()
    render(<SkillModal initialSelected={[]} onClose={() => {}} onDone={onDone} />)
    fireEvent.click(await screen.findByText('pdf'))
    fireEvent.click(screen.getByText('完成'))
    expect(onDone).toHaveBeenCalledWith(['pdf'])
  })

  it('initialSelected 预填 sel；onDone 包含预选项', async () => {
    const onDone = vi.fn()
    render(<SkillModal initialSelected={['brainstorming']} onClose={() => {}} onDone={onDone} />)
    await screen.findByText('pdf')
    fireEvent.click(screen.getByText('完成'))
    expect(onDone).toHaveBeenCalledWith(['brainstorming'])
  })

  it('globalIn 为空的行没有 .si-shadow 徽章（仅一个 shadow）', async () => {
    render(<SkillModal initialSelected={[]} onClose={() => {}} onDone={() => {}} />)
    await screen.findByText('brainstorming')
    const shadows = document.querySelectorAll('.si-shadow')
    expect(shadows).toHaveLength(1)
  })

  it('内置技能（sourceId=builtin）沉到列表最后 + 显示「内置」标签', async () => {
    const LIB_WITH_BUILTIN = [
      { effectiveName: 'install-skill', name: 'install-skill', desc: '内置安装', sourceId: 'builtin', sourceName: '内置', globalIn: [] as const, autoInject: true },
      { effectiveName: 'pdf', name: 'pdf', desc: 'PDF', sourceId: 'a', sourceName: 'anthropics', globalIn: [] as const },
      { effectiveName: 'brainstorming', name: 'brainstorming', desc: '想法', sourceId: 'b', sourceName: 'superpowers', globalIn: [] as const },
    ]
    ;(api.listSkillLibrary as ReturnType<typeof vi.fn>).mockResolvedValue({ skills: LIB_WITH_BUILTIN })
    render(<SkillModal initialSelected={[]} onClose={() => {}} onDone={() => {}} />)
    await screen.findByText('pdf')
    const names = [...document.querySelectorAll('.si-name')].map((n) => n.textContent || '')
    // 内置排最后；非内置保持原顺序
    expect(names[names.length - 1]).toContain('install-skill')
    expect(names[0]).toContain('pdf')
    expect(screen.getByText('内置')).toBeInTheDocument()
  })

  it('底部「已选」排除内置：仅选内置 → 未选择；选了非内置才计数', async () => {
    const LIB_WITH_BUILTIN = [
      { effectiveName: 'install-skill', name: 'install-skill', desc: '', sourceId: 'builtin', sourceName: '内置', globalIn: [] as const, autoInject: true },
      { effectiveName: 'pdf', name: 'pdf', desc: '', sourceId: 'a', sourceName: 'anthropics', globalIn: [] as const },
    ]
    ;(api.listSkillLibrary as ReturnType<typeof vi.fn>).mockResolvedValue({ skills: LIB_WITH_BUILTIN })
    render(<SkillModal initialSelected={['install-skill']} onClose={() => {}} onDone={() => {}} />)
    await screen.findByText('pdf')
    // 内置已预选，但底部口径不计内置
    expect(screen.getByText('未选择')).toBeInTheDocument()
    fireEvent.click(screen.getByText('pdf'))
    expect(screen.getByText('已选 1 个')).toBeInTheDocument()
  })

  it('needsConfig 技能行显示「需配置」+ 去配置', async () => {
    const LIB_WITH_CONFIG = [
      { effectiveName: 'gaode', name: 'gaode', desc: '', sourceId: 's', sourceName: 's', globalIn: [] as const, needsConfig: true },
      { effectiveName: 'upper', name: 'upper', desc: '', sourceId: 's', sourceName: 's', globalIn: [] as const, needsConfig: false },
    ]
    ;(api.listSkillLibrary as ReturnType<typeof vi.fn>).mockResolvedValue({ skills: LIB_WITH_CONFIG })
    render(<SkillModal initialSelected={[]} onClose={() => {}} onDone={() => {}} />)
    expect(await screen.findByText('需配置')).toBeInTheDocument()
    expect(screen.getByText(/去配置/)).toBeInTheDocument()
  })
})
