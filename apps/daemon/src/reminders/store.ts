import fs from 'node:fs'
import path from 'node:path'
import { type RemindersConfig, DEFAULT_REMINDERS_CONFIG, parseReminders } from '@agent-shell/contracts'
import { remindersDefaultPath, projectRemindersPath } from '../paths'

// ── 原子写辅助 ────────────────────────────────────────────────────────
function atomicWrite(file: string, cfg: RemindersConfig): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2))
}

// ── 安全读辅助：文件不存在或损坏均返回默认，不抛 ────────────────────
function safeRead(file: string): RemindersConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    return parseReminders(raw)
  } catch {
    return DEFAULT_REMINDERS_CONFIG
  }
}

// ── 项目提醒 ────────────────────────────────────────────────────────

/** 读取项目提醒配置。文件不存在或损坏 → 返回 DEFAULT_REMINDERS_CONFIG（enabled:false）。 */
export function readProjectReminders(projectPath: string): RemindersConfig {
  return safeRead(projectRemindersPath(projectPath))
}

/** 原子写项目提醒配置。自动建 .agent-shell 目录；写入失败抛错（让调用方处理）。 */
export function writeProjectReminders(projectPath: string, cfg: RemindersConfig): void {
  atomicWrite(projectRemindersPath(projectPath), cfg)
}

// ── 全局默认提醒 ────────────────────────────────────────────────────

/**
 * 读取全局默认提醒配置。
 * @param overridePath 仅供测试注入使用，生产代码不传。
 */
export function readDefaultReminders(overridePath?: string): RemindersConfig {
  return safeRead(overridePath ?? remindersDefaultPath())
}

/**
 * 写全局默认提醒配置。自动建 channelDataDir 目录。
 * @param overridePath 仅供测试注入使用，生产代码不传。
 */
export function writeDefaultReminders(cfg: RemindersConfig, overridePath?: string): void {
  atomicWrite(overridePath ?? remindersDefaultPath(), cfg)
}
