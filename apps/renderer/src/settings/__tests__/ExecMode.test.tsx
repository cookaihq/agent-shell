import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { ExecMode } from '../ExecMode'

vi.mock('../../api/client', () => ({ ApiError: class extends Error {}, api: {
  enginesDetail: vi.fn().mockResolvedValue({ engines: [
    { name: 'claude', label: 'Claude Code', bin: '/x/claude', version: '2.1.156' },
    { name: 'codex', label: 'Codex CLI', bin: null, version: null },
  ] }),
  testEngine: vi.fn().mockResolvedValue({ ok: true, version: '2.1.156' }),
} }))

test('渲染 CLI 卡（版本/未检测）+ 测试 + 重新扫描', async () => {
  render(<ExecMode />)
  expect((await screen.findAllByText('Claude Code')).length).toBeGreaterThan(0)
  expect(screen.getByText('2.1.156')).toBeInTheDocument()
  expect(screen.getByText('Codex CLI')).toBeInTheDocument()
  await userEvent.click(screen.getByText('测试'))
  const { api } = await import('../../api/client') as any
  expect(api.testEngine).toHaveBeenCalledWith('claude')
})
