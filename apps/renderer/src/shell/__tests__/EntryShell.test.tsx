import { render, screen } from '@testing-library/react'
import { EntryShell } from '../EntryShell'

test('渲染 chrome + rail + topbar + main-inner 内容', () => {
  const { container } = render(
    <EntryShell chrome={<div data-testid="ck" />} rail={<div data-testid="rk" />} topbar={<div data-testid="tk" />}>
      <div data-testid="content" />
    </EntryShell>,
  )
  expect(container.querySelector('.entry')).toBeTruthy()
  expect(container.querySelector('.main-inner')).toBeTruthy()
  expect(screen.getByTestId('ck')).toBeInTheDocument()
  expect(screen.getByTestId('rk')).toBeInTheDocument()
  expect(screen.getByTestId('tk')).toBeInTheDocument()
  expect(screen.getByTestId('content')).toBeInTheDocument()
})
