import os from 'node:os'
import path from 'node:path'

/** 渠道数据目录绝对路径：~/{AGENT_SHELL_DATA_DIR|.agent-shell}。
 *  渠道（dev/stable）由 main.ts 经 env 注入；daemon 侧只认 env、不认 channel。
 *  db / config.json / skills 全部挂此目录下，使一个渠道的本地状态集中隔离。
 *  注意：项目文件目录（defaultProjectsDir）走独立 env AGENT_SHELL_PROJECTS_DIR，同样随渠道隔离。 */
export function channelDataDir(): string {
  return path.join(os.homedir(), process.env.AGENT_SHELL_DATA_DIR || '.agent-shell')
}

/** 项目父级目录默认值（系统设置可改父级目录留 M7）。随渠道隔离：
 *  dev → ~/AgentShell-dev/projects，stable → ~/AgentShell/projects。
 *  父目录名由 main.ts 按渠道经 AGENT_SHELL_PROJECTS_DIR 注入；daemon 只认 env、不认 channel。 */
export function defaultProjectsDir(): string {
  return path.join(os.homedir(), process.env.AGENT_SHELL_PROJECTS_DIR || 'AgentShell', 'projects')
}

/** 技能库目录默认值（系统设置可改）。随渠道隔离。 */
export function defaultSkillsDir(): string {
  return path.join(channelDataDir(), 'skills')
}

/** 配置文件路径。随渠道隔离。 */
export function configPath(): string {
  return path.join(channelDataDir(), 'config.json')
}

/** 源清单文件（0600）。随渠道隔离。 */
export function skillSourcesPath(): string { return path.join(channelDataDir(), 'skill-sources.json') }
/** Git 源 clone 缓存根目录。随渠道隔离。 */
export function skillSrcCacheDir(): string { return path.join(channelDataDir(), 'skill-src-cache') }
/** 库清单（溯源 + 重名映射）。挂库目录下。 */
export function libraryManifestPath(skillsDir: string): string { return path.join(skillsDir, '.library.json') }
/** 命令行工具清单（已加入的推荐 + 自定义，0600）。随渠道隔离。 */
export function cliToolsPath(): string { return path.join(channelDataDir(), 'cli-tools.json') }
