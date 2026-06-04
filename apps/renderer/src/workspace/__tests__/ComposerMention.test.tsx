/**
 * ComposerMention.test.tsx — Issue 5
 *
 * 验证 @ 提及能弹出「技能」候选（skillNames 不再写死空，已接 api.listSkills）。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, test, expect, beforeEach } from 'vitest'
import { useReducer } from 'react'
import type { ReactNode } from 'react'

vi.mock('../../api/client', () => ({
  api: {
    files: vi.fn().mockResolvedValue({ tree: [] }),
    listSkills: vi.fn().mockResolvedValue({ skills: [
      { name: 'superpowers', source: 'git', origin: '', desc: '' },
      { name: 'social-card', source: 'folder', origin: '', desc: '' },
    ] }),
    uploadPaste: vi.fn(),
    models: vi.fn().mockResolvedValue({ models: null }),
  },
}))

import { Composer } from '../Composer'
import { RuntimeContext, initialRuntime, runtimeReducer } from '../runtimeState'

function Wrapper({ children }: { children: ReactNode }) {
  const [runtime, dispatch] = useReducer(runtimeReducer, undefined, () => initialRuntime('claude', 'Claude Opus 4.8'))
  return <RuntimeContext.Provider value={{ runtime, dispatch }}>{children}</RuntimeContext.Provider>
}

const p = { running: false, onSubmit: vi.fn(), onInterrupt: vi.fn(), engine: 'claude' as const, model: 'Claude Opus 4.8', projectId: 'x' }

beforeEach(() => vi.clearAllMocks())

test('输入 @ + 技能名 → 弹出「技能」候选（Issue 5：skillNames 接 api.listSkills）', async () => {
  render(<Wrapper><Composer {...p} /></Wrapper>)
  // 等技能库加载（mount 时 api.listSkills）
  await screen.findByPlaceholderText(/引用文件/)
  const ta = screen.getByRole('textbox')
  await userEvent.click(ta)
  await userEvent.type(ta, '@super')
  // 技能候选 superpowers 出现在提及弹窗
  expect(await screen.findByText('superpowers')).toBeInTheDocument()
})
