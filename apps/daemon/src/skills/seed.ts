import type { SkillService } from './service'
import type { SecretStore } from '../secrets/store'
import type { EntityRequirementStore } from './entityRequirements'
import type { ConfigStore } from '../config/store'

const PLACEHOLDERS: { name: string; note: string }[] = [
  { name: 'FoxAPI Key', note: 'foxapi.cc 中转 <a href="https://api.foxapi.cc/console/token">获取密钥</a>' },
  { name: 'DeepSeek Key', note: 'DeepSeek 官方 <a href="https://platform.deepseek.com/api_keys">获取密钥</a>' },
  { name: 'MiniMax Key', note: 'MiniMax 官方 <a href="https://platform.minimaxi.com/user-center/basic-information/interface-key">获取密钥</a>' },
]

export interface SeedDeps {
  skills: SkillService
  secrets: SecretStore
  entityReqs: EntityRequirementStore
  config: ConfigStore
}

/** 首启默认播种（§11）：两类各自标记守门、成功才置位（删除不复活、失败下次重试）。
 *  A=密钥占位（本地瞬时）先于 B=推荐技能分组（含同步阻塞 clone），使 B 能按名找到 FoxAPI 占位预绑。 */
export async function seedDefaults(deps: SeedDeps): Promise<void> {
  const { skills, secrets, entityReqs, config } = deps

  // A. 三个常用密钥占位（空值）
  if (!config.read().seededDefaultSecrets) {
    const existing = new Set(secrets.view().map((s) => s.name))
    for (const p of PLACEHOLDERS) if (!existing.has(p.name)) secrets.createPlaceholder(p.name, p.note)
    config.write({ seededDefaultSecrets: true })
  }

  // B. 「推荐技能」分组：awesome-skills(autolib + 全员 autoInject + banana-2/image-2 预绑 FoxAPI)
  //    + hyperframes / ppt-skill / social-card-skill(autolib 整源入库，但不默认注入、不绑密钥)
  if (!config.read().seededRecommendedGroup) {
    let groupId: string | undefined
    try {
      const g = skills.addGroup({ name: '推荐技能' })
      groupId = g.id
      const src = skills.addSource({ type: 'git', name: 'awesome-skills', loc: 'github.com/cookaihq/awesome-skills', provider: 'github', branch: 'main', groupId: g.id, updateMode: 'autolib' })
      skills.setUpdateMode(src.id, 'autolib')   // 整源自动入库
      const fox = secrets.view().find((s) => s.name === 'FoxAPI Key')
      for (const ls of skills.listLibrary().filter((l) => l.sourceId === src.id)) {
        skills.setAutoInject(ls.effectiveName, true)
        if (fox && (ls.name === 'banana-2' || ls.name === 'image-2')) {
          entityReqs.put('skill:' + ls.effectiveName, {
            needsConfig: true,
            slotsSource: 'manual',
            slots: [{ kind: 'env', name: 'X_API_KEY', bind: fox.id, optional: false }],
          })
        }
      }
      // 追加三个推荐源：整源自动入库（autolib），但成员保持「不默认注入」、不预绑密钥
      const EXTRA_SOURCES = [
        { name: 'hyperframes', loc: 'github.com/heygen-com/hyperframes' },
        { name: 'ppt-skill', loc: 'github.com/cookaihq/ppt-skill' },
        { name: 'social-card-skill', loc: 'github.com/cookaihq/social-card-skill' },
      ]
      for (const es of EXTRA_SOURCES) {
        const s2 = skills.addSource({ type: 'git', name: es.name, loc: es.loc, provider: 'github', branch: 'main', groupId: g.id, updateMode: 'autolib' })
        skills.setUpdateMode(s2.id, 'autolib')   // 整源入库；不调 setAutoInject → 成员默认不注入
      }
      config.write({ seededRecommendedGroup: true })
    } catch (e) {
      if (groupId) { try { skills.removeGroup(groupId) } catch { /* */ } }   // 回滚空分组，不置位→下次重试
      console.error('[seed] 推荐技能分组播种失败（下次启动重试）', e)
    }
  }
}
