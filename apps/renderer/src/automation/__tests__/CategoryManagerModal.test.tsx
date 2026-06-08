import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { CategoryManagerModal } from '../CategoryManagerModal'

const put = vi.fn().mockResolvedValue({ ok: true })
vi.mock('../../api/client', () => ({ api: {
  listAutomationCategories: vi.fn().mockResolvedValue({ tree: [{ name: '运营', children: [{ name: '监控' }] }] }),
  putAutomationCategories: (...a: unknown[]) => put(...a),
} }))

test('渲染树形节点', async () => {
  render(<CategoryManagerModal onClose={vi.fn()} onChanged={vi.fn()} />)
  expect(await screen.findByText('运营')).toBeInTheDocument()
  expect(screen.getByText('监控')).toBeInTheDocument()
})

test('加顶级分类 → 落库 PUT', async () => {
  const onChanged = vi.fn()
  vi.spyOn(window, 'prompt').mockReturnValue('工程')
  render(<CategoryManagerModal onClose={vi.fn()} onChanged={onChanged} />)
  await screen.findByText('运营')   // 等树加载完再加（否则 addRoot 拿到空树）
  await userEvent.click(screen.getByRole('button', { name: /顶级分类/ }))
  await waitFor(() => expect(put).toHaveBeenCalledWith(expect.arrayContaining([
    expect.objectContaining({ name: '运营' }), expect.objectContaining({ name: '工程' }),
  ])))
  expect(onChanged).toHaveBeenCalled()
})
