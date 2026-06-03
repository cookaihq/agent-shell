import { describe, it, expect } from 'vitest'
import { resolveLoginShellPath, augmentedPath, type ShellPathDeps } from '../shellPath'

function deps(opts: Partial<ShellPathDeps> & { nvmNodes?: string[]; shellOut?: string; shellThrows?: boolean }): ShellPathDeps {
  const nvmNodes = opts.nvmNodes ?? []
  return {
    platform: opts.platform ?? 'darwin',
    shell: 'shell' in opts ? opts.shell : '/bin/zsh',
    home: opts.home ?? '/Users/me',
    runShell: opts.runShell ?? (() => {
      if (opts.shellThrows) throw new Error('boom')
      return opts.shellOut ?? ''
    }),
    listDir: opts.listDir ?? ((p) => (p.endsWith('/.nvm/versions/node') ? nvmNodes : [])),
  }
}

describe('resolveLoginShellPath', () => {
  it('从登录 shell 输出里夹标记取出 PATH', () => {
    const out = '一些 rc 噪声\n__AGENT_SHELL_PATH__/Users/me/.nvm/versions/node/v24.13.0/bin:/usr/bin__AGENT_SHELL_PATH__'
    expect(resolveLoginShellPath(deps({ shellOut: out }))).toBe('/Users/me/.nvm/versions/node/v24.13.0/bin:/usr/bin')
  })

  it('win32 → null（GUI 正常继承用户 PATH）', () => {
    expect(resolveLoginShellPath(deps({ platform: 'win32', shellOut: 'x' }))).toBeNull()
  })

  it('shell 抛错/超时 → null（fail-soft）', () => {
    expect(resolveLoginShellPath(deps({ shellThrows: true }))).toBeNull()
  })

  it('取不到标记 → null', () => {
    expect(resolveLoginShellPath(deps({ shellOut: 'no marker here' }))).toBeNull()
  })
})

describe('augmentedPath', () => {
  it('登录 PATH 在前、node 安装目录兜底、原 PATH 在后，去重保序', () => {
    const out = '__AGENT_SHELL_PATH__/login/bin:/usr/bin__AGENT_SHELL_PATH__'
    const res = augmentedPath('/usr/bin:/bin', deps({ shellOut: out, nvmNodes: ['v24.13.0'] }))
    expect(res).toBe('/login/bin:/usr/bin:/Users/me/.nvm/versions/node/v24.13.0/bin:/opt/homebrew/bin:/usr/local/bin:/Users/me/.local/bin:/bin')
  })

  it('登录 shell 失败时仍补上 nvm/homebrew 兜底（保证 node 在 PATH）', () => {
    const res = augmentedPath('/usr/bin:/bin', deps({ shellThrows: true, nvmNodes: ['v22.20.0'] }))
    expect(res.split(':')).toContain('/Users/me/.nvm/versions/node/v22.20.0/bin')
    expect(res.split(':')).toContain('/opt/homebrew/bin')
    expect(res.split(':')).toContain('/usr/bin')
  })

  it('win32 原样返回 currentPath', () => {
    expect(augmentedPath('C:\\foo;C:\\bar', deps({ platform: 'win32' }))).toBe('C:\\foo;C:\\bar')
  })
})
