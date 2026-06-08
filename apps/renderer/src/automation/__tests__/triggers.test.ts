import { triggerSummary, defToForm, formToDef, type TimeTriggerForm } from '../triggers'

test('startup 触发器摘要', () => {
  expect(triggerSummary({ kind: 'startup' })).toBe('启动时')
})
test('daily 触发器摘要含时间+时区中文', () => {
  expect(triggerSummary({ kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' })).toBe('每天 09:00 · 上海')
})
test('weekly 触发器摘要含星期', () => {
  expect(triggerSummary({ kind: 'weekly', time: '10:00', timezone: 'Asia/Shanghai', weekday: 1 })).toBe('每周一 10:00 · 上海')
})
test('hourly 摘要取分钟', () => {
  expect(triggerSummary({ kind: 'hourly', minute: 30 })).toBe('每小时 · 第 30 分')
})
test('formToDef daily：表单 → TriggerDef', () => {
  const form: TimeTriggerForm = { freq: '每天', time: '08:00', tz: 'UTC', weekday: 1 }
  expect(formToDef(form)).toEqual({ kind: 'daily', time: '08:00', timezone: 'UTC' })
})
test('formToDef weekly 带 weekday；hourly 取分钟', () => {
  expect(formToDef({ freq: '每周', time: '10:00', tz: 'Asia/Shanghai', weekday: 3 }))
    .toEqual({ kind: 'weekly', time: '10:00', timezone: 'Asia/Shanghai', weekday: 3 })
  expect(formToDef({ freq: '每小时', time: '00:45', tz: 'UTC', weekday: 1 }))
    .toEqual({ kind: 'hourly', minute: 45 })
})
test('defToForm 反向：daily/weekly/hourly 各还原', () => {
  expect(defToForm({ kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' }))
    .toEqual({ freq: '每天', time: '09:00', tz: 'Asia/Shanghai', weekday: 1 })
})
