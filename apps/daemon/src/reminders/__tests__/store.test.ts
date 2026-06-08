import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_REMINDERS_CONFIG } from '@agent-shell/contracts'
import {
  readProjectReminders,
  writeProjectReminders,
  readDefaultReminders,
  writeDefaultReminders,
} from '../store'

// 临时目录管理（仿 config/store.test.ts 惯例）
let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-rem-'))
})
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ── 项目提醒 ────────────────────────────────────────────────────────

describe('readProjectReminders', () => {
  it('项目无 reminders.json → 返回 enabled:false 默认', () => {
    const result = readProjectReminders(tmpDir)
    expect(result).toEqual(DEFAULT_REMINDERS_CONFIG)
    expect(result.enabled).toBe(false)
  })

  it('write 后 read 往返一致', () => {
    const cfg = { ...DEFAULT_REMINDERS_CONFIG, enabled: true }
    writeProjectReminders(tmpDir, cfg)
    const result = readProjectReminders(tmpDir)
    expect(result).toEqual(cfg)
  })

  it('文件内容为坏 JSON → 兜底返回默认（不抛）', () => {
    const agentShellDir = path.join(tmpDir, '.agent-shell')
    fs.mkdirSync(agentShellDir, { recursive: true })
    fs.writeFileSync(path.join(agentShellDir, 'reminders.json'), '{bad json')
    expect(() => readProjectReminders(tmpDir)).not.toThrow()
    expect(readProjectReminders(tmpDir)).toEqual(DEFAULT_REMINDERS_CONFIG)
  })

  it('文件存在但字段部分损坏 → parseReminders 兜底（不抛，enabled 尽量保留）', () => {
    const agentShellDir = path.join(tmpDir, '.agent-shell')
    fs.mkdirSync(agentShellDir, { recursive: true })
    // events/external 写 null → parseReminders 逐字段兜底；enabled:true 应保留
    fs.writeFileSync(
      path.join(agentShellDir, 'reminders.json'),
      JSON.stringify({ version: 1, enabled: true, events: null, external: null }),
    )
    expect(() => readProjectReminders(tmpDir)).not.toThrow()
    const result = readProjectReminders(tmpDir)
    expect(result.enabled).toBe(true)
  })
})

describe('writeProjectReminders', () => {
  it('write 自动建 .agent-shell 目录（项目目录存在但无 .agent-shell）', () => {
    const agentShellDir = path.join(tmpDir, '.agent-shell')
    expect(fs.existsSync(agentShellDir)).toBe(false)
    writeProjectReminders(tmpDir, DEFAULT_REMINDERS_CONFIG)
    expect(fs.existsSync(agentShellDir)).toBe(true)
    expect(fs.existsSync(path.join(agentShellDir, 'reminders.json'))).toBe(true)
  })

  it('write 写入格式化 JSON（2 空格缩进）', () => {
    writeProjectReminders(tmpDir, DEFAULT_REMINDERS_CONFIG)
    const raw = fs.readFileSync(path.join(tmpDir, '.agent-shell', 'reminders.json'), 'utf8')
    // 2 空格缩进的特征：有以两个空格开头的行
    expect(raw).toMatch(/^  /m)
  })
})

// ── 全局默认提醒 ────────────────────────────────────────────────────
// 使用 overridePath 注入临时文件路径，不依赖 AGENT_SHELL_DATA_DIR env

describe('readDefaultReminders / writeDefaultReminders', () => {
  it('无全局默认文件 → 返回 enabled:false 默认（不抛）', () => {
    const nonexistentFile = path.join(tmpDir, 'reminders.default.json')
    expect(() => readDefaultReminders(nonexistentFile)).not.toThrow()
    expect(readDefaultReminders(nonexistentFile)).toEqual(DEFAULT_REMINDERS_CONFIG)
  })

  it('writeDefaultReminders + readDefaultReminders 往返一致', () => {
    const file = path.join(tmpDir, 'reminders.default.json')
    const cfg = { ...DEFAULT_REMINDERS_CONFIG, enabled: true }
    writeDefaultReminders(cfg, file)
    expect(readDefaultReminders(file)).toEqual(cfg)
  })

  it('全局默认文件坏 JSON → 兜底返回默认（不抛）', () => {
    const file = path.join(tmpDir, 'reminders.default.json')
    fs.writeFileSync(file, '{bad json')
    expect(() => readDefaultReminders(file)).not.toThrow()
    expect(readDefaultReminders(file)).toEqual(DEFAULT_REMINDERS_CONFIG)
  })

  it('writeDefaultReminders 自动建父目录', () => {
    const file = path.join(tmpDir, 'nested', 'dir', 'reminders.default.json')
    expect(fs.existsSync(path.dirname(file))).toBe(false)
    writeDefaultReminders(DEFAULT_REMINDERS_CONFIG, file)
    expect(fs.existsSync(file)).toBe(true)
  })
})
