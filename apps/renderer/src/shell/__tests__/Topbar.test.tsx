import type React from 'react'
import { render, screen } from '@testing-library/react'
import { Topbar } from '../Topbar'
import { RuntimeContext, initialRuntime } from '../../workspace/runtimeState'
import { SettingsProvider } from '../../settings/SettingsContext'

function wrap(ui: React.ReactNode) {
  return (
    <SettingsProvider>
      <RuntimeContext.Provider value={{ runtime: initialRuntime('claude', 'Claude Opus 4.8'), dispatch: () => {} }}>{ui}</RuntimeContext.Provider>
    </SettingsProvider>
  )
}
test('渲染 runtime 切换器 chip + 设置齿轮', () => {
  const { container } = render(wrap(<Topbar />))
  expect(container.querySelector('.topbar')).toBeTruthy()
  expect(container.querySelector('#iswChip')).toBeTruthy()
  expect(screen.getByTitle('设置')).toBeInTheDocument()
})
