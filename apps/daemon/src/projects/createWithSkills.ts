import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { createProject, uuid32 } from '../db/projects'
import type { ProjectRow } from '../db/types'
import { injectClaudeSkills } from '../skills/inject'
import { makeLibrary } from '../skills/library'
import { remindersDefaultPath, projectRemindersPath } from '../paths'
import { readDefaultReminders, writeProjectReminders } from '../reminders/store'

export interface CreateProjectDeps { db: Database.Database; projectsDir: string; skillsDir: string }

/** 默认注入集 = 库 manifest 中 autoInject===true 的 effectiveName。 */
export function defaultInjectSet(skillsDir: string): string[] {
  const m = makeLibrary(skillsDir).manifest()
  return Object.keys(m).filter((eff) => m[eff].autoInject === true)
}

/** 共享建项目：建目录 + 落 DB + 注入技能，捆成一道不可绕过的流程。
 *  explicitSkills 为数组 → 照单注入（含空集 []=不注入）；省略 → 注入默认集。所有建项目入口都过这里。 */
export function createProjectWithSkills(deps: CreateProjectDeps, name: string, explicitSkills?: string[]): ProjectRow {
  const id = uuid32()
  const projectPath = path.join(deps.projectsDir, id)
  fs.mkdirSync(projectPath, { recursive: true })
  const proj = createProject(deps.db, { id, name, path: projectPath })
  const names = explicitSkills ?? defaultInjectSet(deps.skillsDir)
  injectClaudeSkills(projectPath, deps.skillsDir, names)

  // 若全局默认提醒配置存在，拷贝到项目（决策 C：不存在则不建，保持「无文件」= 全关状态）
  if (fs.existsSync(remindersDefaultPath())) {
    const cfg = readDefaultReminders()
    writeProjectReminders(projectPath, cfg)
  }

  return proj
}
