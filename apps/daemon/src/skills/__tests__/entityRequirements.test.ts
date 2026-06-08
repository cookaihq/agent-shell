import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeEntityRequirementStore } from '../entityRequirements'

let file: string
beforeEach(() => {
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'req-')), 'entity-requirements.json')
})

describe('entityRequirementStore', () => {
  it('空文件 → all 空、get undefined', () => {
    const s = makeEntityRequirementStore(file)
    expect(s.all()).toEqual({})
    expect(s.get('skill:x')).toBeUndefined()
  })
  it('put / get 往返 + 落盘 0600', () => {
    const s = makeEntityRequirementStore(file)
    s.put('skill:gaode-map', { needsConfig: true, slotsSource: 'agent', slots: [{ kind: 'env', name: 'GAODE_API_KEY', bind: 'k_1', optional: false }] })
    expect(s.get('skill:gaode-map')?.slots?.[0].bind).toBe('k_1')
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
  })
  it('usageBySecret：secretId → 引用它的 entityRef 列表', () => {
    const s = makeEntityRequirementStore(file)
    s.put('skill:a', { needsConfig: true, slotsSource: 'manual', slots: [{ kind: 'env', name: 'K', bind: 'k_1', optional: false }] })
    s.put('skill:b', { needsConfig: true, slotsSource: 'manual', slots: [{ kind: 'env', name: 'K', bind: 'k_1', optional: false }] })
    s.put('skill:c', { needsConfig: false, slotsSource: null, slots: [] })
    expect(s.usageBySecret()).toEqual({ k_1: ['skill:a', 'skill:b'] })
  })
  it('setNeedsConfig：无记录时建一条只含 needsConfig', () => {
    const s = makeEntityRequirementStore(file)
    s.setNeedsConfig('skill:a', true)
    expect(s.get('skill:a')).toEqual({ needsConfig: true, slotsSource: null })
  })
  it('setNeedsConfig：已有记录时只改 needsConfig，保留 slots/slotsSource/bind', () => {
    const s = makeEntityRequirementStore(file)
    s.put('skill:a', { needsConfig: false, slotsSource: 'agent', slots: [{ kind: 'env', name: 'K', bind: 'k_1', optional: false }] })
    s.setNeedsConfig('skill:a', true)
    const r = s.get('skill:a')
    expect(r?.needsConfig).toBe(true)
    expect(r?.slotsSource).toBe('agent')
    expect(r?.slots?.[0].bind).toBe('k_1')
  })
})
