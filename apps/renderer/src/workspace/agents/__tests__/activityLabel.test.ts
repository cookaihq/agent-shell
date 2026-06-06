import { test, expect } from 'vitest'
import { getSlice } from '../registry'

test('claudeSlice.activityLabel: thinking → 思考中', () => {
  expect(getSlice('claude').activityLabel!({ kind: 'thinking' })).toBe('思考中')
})

test('claudeSlice.activityLabel: responding → 撰写回复', () => {
  expect(getSlice('claude').activityLabel!({ kind: 'responding' })).toBe('撰写回复')
})

test('claudeSlice.activityLabel: Edit tool with target → 正在编辑 {file}', () => {
  expect(getSlice('claude').activityLabel!({ kind: 'tool', tool: 'Edit', target: '/a/styles.css' })).toBe('正在编辑 styles.css')
})

test('claudeSlice.activityLabel: Write tool with target → 正在编辑 {file}', () => {
  expect(getSlice('claude').activityLabel!({ kind: 'tool', tool: 'Write', target: '/src/app.ts' })).toBe('正在编辑 app.ts')
})

test('claudeSlice.activityLabel: Read tool with target → 正在读取 {file}', () => {
  expect(getSlice('claude').activityLabel!({ kind: 'tool', tool: 'Read', target: '/some/file.ts' })).toBe('正在读取 file.ts')
})

test('claudeSlice.activityLabel: Bash → 正在运行命令', () => {
  expect(getSlice('claude').activityLabel!({ kind: 'tool', tool: 'Bash' })).toBe('正在运行命令')
})

test('claudeSlice.activityLabel: TodoWrite → 更新任务计划', () => {
  expect(getSlice('claude').activityLabel!({ kind: 'tool', tool: 'TodoWrite' })).toBe('更新任务计划')
})

test('claudeSlice.activityLabel: unknown tool → 正在调用 {tool}', () => {
  expect(getSlice('claude').activityLabel!({ kind: 'tool', tool: 'Grep' })).toBe('正在调用 Grep')
})

test('claudeSlice.activityLabel: tool with no name → 处理中', () => {
  expect(getSlice('claude').activityLabel!({ kind: 'tool', tool: '' })).toBe('处理中')
})

test('codexSlice.activityLabel is undefined', () => {
  expect(getSlice('codex').activityLabel).toBeUndefined()
})
