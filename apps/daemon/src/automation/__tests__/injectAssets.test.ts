import { describe, it, expect } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { injectAutomationAssets } from '../injectAssets'

describe('injectAutomationAssets', () => {
  it('把任务文件夹软链进 <project>/automation-assets/<folder>，agent 可读脚本', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inj-'))
    const autoDir = path.join(root, 'lib', 'mon'); fs.mkdirSync(autoDir, { recursive: true })
    fs.writeFileSync(path.join(autoDir, 'AUTOMATION.md'), 'x')
    fs.writeFileSync(path.join(autoDir, 'check.mjs'), 'console.log(1)')
    const proj = path.join(root, 'proj'); fs.mkdirSync(proj, { recursive: true })

    injectAutomationAssets(proj, autoDir, 'mon')

    const linked = path.join(proj, 'automation-assets', 'mon', 'check.mjs')
    expect(fs.existsSync(linked)).toBe(true)
    expect(fs.readFileSync(linked, 'utf8')).toBe('console.log(1)')
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('幂等：重复注入不抛错', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inj2-'))
    const autoDir = path.join(root, 'mon'); fs.mkdirSync(autoDir, { recursive: true })
    fs.writeFileSync(path.join(autoDir, 'AUTOMATION.md'), 'x')
    const proj = path.join(root, 'proj'); fs.mkdirSync(proj, { recursive: true })
    injectAutomationAssets(proj, autoDir, 'mon')
    expect(() => injectAutomationAssets(proj, autoDir, 'mon')).not.toThrow()
    fs.rmSync(root, { recursive: true, force: true })
  })
})
