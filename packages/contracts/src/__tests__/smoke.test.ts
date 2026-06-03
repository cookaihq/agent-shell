import { describe, it, expect } from 'vitest'
import { CONTRACTS_VERSION } from '../index'

describe('toolchain smoke', () => {
  it('exposes a contracts version constant', () => {
    expect(CONTRACTS_VERSION).toBe('0.0.0')
  })
})
