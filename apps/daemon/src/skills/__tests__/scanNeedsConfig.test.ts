import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scanNeedsConfig } from '../scanNeedsConfig'

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-')) })
const writeSkill = (md: string) => fs.writeFileSync(path.join(dir, 'SKILL.md'), md)

describe('scanNeedsConfig', () => {
  it('无 SKILL.md → false', () => {
    expect(scanNeedsConfig(dir)).toBe(false)
  })
  it('纯说明、无凭证特征 → false', () => {
    writeSkill('# Hello\n这个技能把文本转大写，不需要任何密钥。')
    expect(scanNeedsConfig(dir)).toBe(false)
  })
  it('SKILL.md 含 Authorization: Bearer → true', () => {
    writeSkill('调用时带 `Authorization: Bearer <your-key>`')
    expect(scanNeedsConfig(dir)).toBe(true)
  })
  it('SKILL.md 含 *_API_KEY → true', () => {
    writeSkill('设置环境变量 GAODE_API_KEY 后运行。')
    expect(scanNeedsConfig(dir)).toBe(true)
  })
  it('第一层脚本含 process.env / os.environ → true', () => {
    writeSkill('# skill')
    fs.writeFileSync(path.join(dir, 'run.py'), 'import os\nk = os.environ["FOO_TOKEN"]\n')
    expect(scanNeedsConfig(dir)).toBe(true)
  })
  it('外部凭证文件路径（~/.aws/credentials）→ true', () => {
    writeSkill('读取 ~/.aws/credentials 获取凭证。')
    expect(scanNeedsConfig(dir)).toBe(true)
  })
  it('只扫第一层，不递归深目录（深处的特征不计）', () => {
    writeSkill('# skill')
    const deep = path.join(dir, 'sub')
    fs.mkdirSync(deep)
    fs.writeFileSync(path.join(deep, 'x.py'), 'os.environ["DEEP_KEY"]')
    expect(scanNeedsConfig(dir)).toBe(false)
  })
})
