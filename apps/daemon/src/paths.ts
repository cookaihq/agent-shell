import os from 'node:os'
import path from 'node:path'

/** 项目父级目录默认值（系统设置可改父级目录留 M7）。 */
export function defaultProjectsDir(): string {
  return path.join(os.homedir(), 'AgentShell', 'projects')
}

/** 技能库目录默认值（系统设置可改）。 */
export function defaultSkillsDir(): string {
  return path.join(os.homedir(), '.agent-shell', 'skills')
}

/** 配置文件路径。 */
export function configPath(): string {
  return path.join(os.homedir(), '.agent-shell', 'config.json')
}
