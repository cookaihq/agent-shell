import { describe, it, expect } from 'vitest'
import { getRuntimeDef } from '../registry'

describe('getRuntimeDef', () => {
  it('claude → claudeDef', () => {
    expect(getRuntimeDef('claude').engine).toBe('claude')
    expect(getRuntimeDef('claude').promptInputFormat).toBe('stream-json')
  })

  it('codex → codexDef', () => {
    expect(getRuntimeDef('codex').engine).toBe('codex')
    expect(getRuntimeDef('codex').promptInputFormat).toBe('text')
  })
})
