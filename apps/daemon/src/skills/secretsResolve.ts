import type { EntityRequirementStore } from './entityRequirements'
import type { SecretStore } from '../secrets/store'

export interface SkillEnvResolution {
  env: Record<string, string>
  conflicts: { env: string; entityRefs: string[]; secretIds: string[] }[]
  missing: { entityRef: string; slot: string }[]
}

/** 纯函数：把「本次 run 激活的实体」的 env 槽位解析成 env map + 冲突 + 必填缺配。
 *  仅处理 kind==='env' 槽位（主通道，spec §2）；file 槽位的物化留后续计划。
 *  只读 reqs/secrets，不落盘。activeRefs 形如 ['skill:guizang-ppt', …]。 */
export function resolveSkillEnv(
  reqs: Pick<EntityRequirementStore, 'get'>,
  secrets: Pick<SecretStore, 'getValue'>,
  activeRefs: string[],
): SkillEnvResolution {
  const env: Record<string, string> = {}
  const owner = new Map<string, { ref: string; secretId: string }>()   // envName → 首个写入者
  const conflicts: SkillEnvResolution['conflicts'] = []
  const conflictByEnv = new Map<string, { env: string; entityRefs: string[]; secretIds: string[] }>()
  const missing: SkillEnvResolution['missing'] = []

  for (const ref of activeRefs) {
    const req = reqs.get(ref)
    if (!req || !req.slots) continue   // 未精确探测：交 UI 据 needsConfig 处理，解析器不臆造
    for (const slot of req.slots) {
      if (slot.kind !== 'env') continue
      if (!slot.bind) { if (!slot.optional) missing.push({ entityRef: ref, slot: slot.name }); continue }
      const value = secrets.getValue(slot.bind)
      if (!value) { missing.push({ entityRef: ref, slot: slot.name }); continue }   // undefined（已删）或 ''（空值占位）= 缺配
      const prev = owner.get(slot.name)
      if (!prev) { owner.set(slot.name, { ref, secretId: slot.bind }); env[slot.name] = value; continue }
      if (prev.secretId === slot.bind) continue   // 同名同 secret = 共用
      // 同名不同 secret = 冲突：不写 env（保持首写者已写的值也撤掉，避免歧义注入）
      delete env[slot.name]
      let c = conflictByEnv.get(slot.name)
      if (!c) { c = { env: slot.name, entityRefs: [prev.ref], secretIds: [prev.secretId] }; conflictByEnv.set(slot.name, c); conflicts.push(c) }
      if (!c.entityRefs.includes(ref)) c.entityRefs.push(ref)
      if (!c.secretIds.includes(slot.bind)) c.secretIds.push(slot.bind)
    }
  }
  return { env, conflicts, missing }
}
