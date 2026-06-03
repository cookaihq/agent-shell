import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { Projects } from '../Projects'
import type { ProjectDTO } from '../../api/types'

const projs: ProjectDTO[] = [
  { id: 'p1', name: 'seed-pitch-deck', path: '/x', createdAt: Date.now(), status: 'completed', engine: 'claude' },
  { id: 'p2', name: 'api-gateway', path: '/y', createdAt: Date.now(), status: 'idle', engine: 'codex' },
]

test('渲染全部项目卡 + 点击 onOpen', async () => {
  const onOpenProject = vi.fn()
  render(<Projects projects={projs} onOpenProject={onOpenProject} />)
  expect(screen.getByRole('heading', { name: '项目' })).toBeInTheDocument()
  expect(screen.getByText('seed-pitch-deck')).toBeInTheDocument()
  expect(screen.getByText('api-gateway')).toBeInTheDocument()
  await userEvent.click(screen.getByText('api-gateway').closest('.proj-card')!)
  expect(onOpenProject).toHaveBeenCalledWith('p2')
})
