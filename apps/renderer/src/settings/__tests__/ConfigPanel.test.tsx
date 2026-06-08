import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfigPanel } from '../ConfigPanel'

const api = { listSecrets: vi.fn(), probeSkillConfig: vi.fn(), putEntityRequirements: vi.fn(), createSecret: vi.fn() }
vi.mock('../../api/client', () => ({ api: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (api as Record<string, (...x: unknown[]) => unknown>)[k](...a) }) }))

beforeEach(() => {
  vi.clearAllMocks()
  api.listSecrets.mockResolvedValue({ secrets: [{ id: 'k_1', name: '高德 Key', note: '', hasValue: true, maskedValue: '…1', createdAt: 1 }], usage: {} })
  api.probeSkillConfig.mockResolvedValue({ slots: [{ kind: 'env', name: 'GAODE_API_KEY', bind: null, optional: false }] })
  api.putEntityRequirements.mockResolvedValue({ ok: true })
  api.createSecret.mockResolvedValue({ secret: { id: 'k_2', name: '新', note: '', hasValue: true, maskedValue: '…2', createdAt: 2 } })
})

const skill = { effectiveName: 'gaode', sourceId: 's1', relPath: 'gaode/' }

describe('ConfigPanel', () => {
  it('未探测态：显示「重新探测」', async () => {
    render(<ConfigPanel skill={skill} requirement={undefined} />)
    expect(await screen.findByRole('button', { name: /重新探测/ })).toBeInTheDocument()
  })
  it('点重新探测 → probeSkillConfig → 列槽位 + 保存 slotsSource=agent', async () => {
    render(<ConfigPanel skill={skill} requirement={undefined} />)
    await userEvent.click(await screen.findByRole('button', { name: /重新探测/ }))
    expect(await screen.findByText('GAODE_API_KEY')).toBeInTheDocument()
    await waitFor(() => expect(api.putEntityRequirements).toHaveBeenCalledWith('skill:gaode', expect.objectContaining({ slotsSource: 'agent' })))
  })
  it('无需配置态（slots=[]）：✓ 无需配置', async () => {
    render(<ConfigPanel skill={skill} requirement={{ needsConfig: false, slotsSource: 'agent', slots: [] }} />)
    expect(await screen.findByText(/无需配置/)).toBeInTheDocument()
  })
  it('有槽位：选已有密钥 → putEntityRequirements 写 bind', async () => {
    render(<ConfigPanel skill={skill} requirement={{ needsConfig: true, slotsSource: 'manual', slots: [{ kind: 'env', name: 'GAODE_API_KEY', bind: null, optional: false }] }} />)
    const sel = await screen.findByRole('combobox')
    await userEvent.selectOptions(sel, 'k_1')
    await waitFor(() => expect(api.putEntityRequirements).toHaveBeenCalledWith('skill:gaode', expect.objectContaining({ slots: [expect.objectContaining({ bind: 'k_1' })] })))
  })
})
