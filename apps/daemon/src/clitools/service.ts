import { CliToolDef, type AddCliToolReq } from '@agent-shell/contracts'
import { makeCliToolStore, type CliToolStore } from './store'
import { writeCliSkill, removeCliSkill } from './skill'
import { detectBinary } from '../runtimes/detection'
import { cliToolsPath } from '../paths'

export interface CliToolService {
  list: () => CliToolDef[]
  add: (req: AddCliToolReq) => CliToolDef    // 持久化 + 生成 SKILL.md 入技能库（→ 可注入）
  remove: (id: string) => void               // 出库 + 删 SKILL.md
  detect: (names: string[]) => Record<string, string | null>
}

/** getSkillsDir 注入（对齐 makeSkillService）；toolsFile 缺省用 paths.ts，测试可注入隔离。 */
export function makeCliToolService(getSkillsDir: () => string, toolsFile: string = cliToolsPath()): CliToolService {
  const store: CliToolStore = makeCliToolStore(toolsFile)
  const genId = () => 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  return {
    list: store.list,
    add: (req) => {
      const def = CliToolDef.parse({ ...req, id: req.id || genId() })
      const saved = store.add(def)
      writeCliSkill(getSkillsDir(), saved)
      return saved
    },
    remove: (id) => { store.remove(id); removeCliSkill(getSkillsDir(), id) },
    detect: (names) => Object.fromEntries(names.map((n) => [n, detectBinary(n)])),
  }
}
