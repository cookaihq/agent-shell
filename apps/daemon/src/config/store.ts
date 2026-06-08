import fs from 'node:fs'
import path from 'node:path'
import type { AppConfig } from '@agent-shell/contracts'

export interface ConfigStore {
  read: () => AppConfig
  write: (partial: Partial<AppConfig>) => AppConfig
}

/** 基于单个 JSON 文件的配置存储；read 缺字段用 defaults 补全，损坏文件回退 defaults。 */
export function makeConfigStore(file: string, defaults: AppConfig): ConfigStore {
  const read = (): AppConfig => {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<AppConfig>
      return {
        projectsDir: typeof raw.projectsDir === 'string' ? raw.projectsDir : defaults.projectsDir,
        skillsDir: typeof raw.skillsDir === 'string' ? raw.skillsDir : defaults.skillsDir,
        automationsDir: typeof raw.automationsDir === 'string' ? raw.automationsDir : defaults.automationsDir,
        debugMode: typeof raw.debugMode === 'boolean' ? raw.debugMode : defaults.debugMode,
        engineModels: (raw.engineModels && typeof raw.engineModels === 'object')
          ? Object.fromEntries(Object.entries(raw.engineModels).filter(([, v]) => typeof v === 'string')) as Record<string, string>
          : defaults.engineModels,
        modelAliases: (raw.modelAliases && typeof raw.modelAliases === 'object') ? raw.modelAliases : defaults.modelAliases,
        seededRecommendedGroup: typeof raw.seededRecommendedGroup === 'boolean' ? raw.seededRecommendedGroup : defaults.seededRecommendedGroup,
        seededDefaultSecrets: typeof raw.seededDefaultSecrets === 'boolean' ? raw.seededDefaultSecrets : defaults.seededDefaultSecrets,
      }
    } catch { return { ...defaults } }
  }
  const write = (partial: Partial<AppConfig>): AppConfig => {
    const next = { ...read(), ...partial }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(next, null, 2))
    return next
  }
  return { read, write }
}
