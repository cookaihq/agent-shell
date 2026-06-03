import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { ProjectCard } from '../ProjectCard'
import type { ProjectDTO } from '../../api/types'
const base: ProjectDTO = { id: 'p1', name: 'seed-pitch-deck', path: '/x', createdAt: Date.now() - 5 * 60_000, status: 'running', engine: 'claude' }

test('渲染 glyph/名称/状态点 + 点击回调', async () => {
  const onOpen = vi.fn()
  const { container } = render(<ProjectCard project={base} onOpen={onOpen} />)
  expect(screen.getByText('SP')).toBeInTheDocument()
  expect(screen.getByText('seed-pitch-deck')).toBeInTheDocument()
  expect(screen.getByText('运行中')).toBeInTheDocument()
  expect(container.querySelector('.proj-status.st-running')).toBeTruthy()
  await userEvent.click(container.querySelector('.proj-card')!)
  expect(onOpen).toHaveBeenCalledWith('p1')
})
test('engine=codex → thumb 加 codex 类', () => {
  const { container } = render(<ProjectCard project={{ ...base, engine: 'codex' }} onOpen={() => {}} />)
  expect(container.querySelector('.proj-thumb.codex')).toBeTruthy()
})
