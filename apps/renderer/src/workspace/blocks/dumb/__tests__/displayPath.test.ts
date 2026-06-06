import { describe, it, expect } from 'vitest'
import { displayPath } from '../displayPath'

describe('displayPath', () => {
  it('项目内路径 → 相对路径', () => {
    expect(displayPath('/Users/zhao/project/src/app.ts', '/Users/zhao/project')).toBe('src/app.ts')
  })

  it('项目根目录本身 → "."', () => {
    expect(displayPath('/Users/zhao/project', '/Users/zhao/project')).toBe('.')
  })

  it('trailing slash 的 root 也能正确处理', () => {
    expect(displayPath('/Users/zhao/project/src/a.ts', '/Users/zhao/project/')).toBe('src/a.ts')
  })

  it('家目录外但在 home 下 → ~/… 形式', () => {
    expect(displayPath('/Users/zhao/other/file.ts', '/Users/zhao/project')).toBe('~/other/file.ts')
  })

  it('home 路径本身 → ~/…（就是 home 根下）', () => {
    expect(displayPath('/Users/zhao/docs/x.ts', '/Users/zhao/project')).toBe('~/docs/x.ts')
  })

  it('项目外且非 home → 原样返回', () => {
    expect(displayPath('/etc/hosts', '/Users/zhao/project')).toBe('/etc/hosts')
  })

  it('filePath 为空 → 原样返回', () => {
    expect(displayPath('', '/Users/zhao/project')).toBe('')
  })

  it('projectRoot 未传 → 原样返回', () => {
    expect(displayPath('/Users/zhao/project/src/a.ts', undefined)).toBe('/Users/zhao/project/src/a.ts')
  })
})
