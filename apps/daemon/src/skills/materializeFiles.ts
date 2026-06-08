import fs from 'node:fs'
import path from 'node:path'
import type { EntityRequirement } from '@agent-shell/contracts'

export interface MaterializeResult {
  errors: { entityRef: string; target: string; reason: string }[]
}

interface ReqGetter { get(ref: string): EntityRequirement | undefined }
interface SecretGetter { getValue(id: string): string | undefined }

/** run 启动期物化 file 槽位（spec §6 步骤 2/3）。
 *  in-folder：把内容（secret 值或 default）写进库目录 <skillsDir>/<eff>/<目标>，随已有技能软链进项目。
 *  external-path：目标不存在 → 写文件（内容=secret 值/default）；目标已存在真实文件 → 拒绝 + 记 error，绝不覆盖（守 06-01）。
 *  仅处理 kind==='file'；env 槽位 / 未精确探测（无 slots）忽略。activeRefs 形如 ['skill:<eff>']。 */
export function materializeSkillFiles(
  activeRefs: string[],
  reqs: ReqGetter,
  secrets: SecretGetter,
  skillsDir: string,
): MaterializeResult {
  const errors: MaterializeResult['errors'] = []
  for (const ref of activeRefs) {
    const req = reqs.get(ref)
    if (!req || !req.slots) continue
    const eff = ref.startsWith('skill:') ? ref.slice('skill:'.length) : ref
    for (const slot of req.slots) {
      if (slot.kind !== 'file') continue
      const content = (slot.bind ? secrets.getValue(slot.bind) : undefined) ?? slot.default
      if (content === undefined) {
        if (!slot.optional) errors.push({ entityRef: ref, target: slot.name, reason: 'no_content' })
        continue
      }
      try {
        if (slot.fileMode === 'external-path') {
          if (fs.existsSync(slot.name) && fs.statSync(slot.name).isFile()) {
            errors.push({ entityRef: ref, target: slot.name, reason: 'target_exists' })
            continue
          }
          fs.mkdirSync(path.dirname(slot.name), { recursive: true })
          fs.writeFileSync(slot.name, content, { mode: 0o600 })
        } else {
          const skillRoot = path.join(skillsDir, eff)
          const dest = path.resolve(skillRoot, slot.name)
          if (dest !== skillRoot && !dest.startsWith(skillRoot + path.sep)) {   // 防 ../ 穿越写出库目录
            errors.push({ entityRef: ref, target: slot.name, reason: 'path_escape' })
            continue
          }
          fs.mkdirSync(path.dirname(dest), { recursive: true })
          fs.writeFileSync(dest, content, { mode: 0o600 })
        }
      } catch (e) {
        errors.push({ entityRef: ref, target: slot.name, reason: (e as Error).message })
      }
    }
  }
  return { errors }
}
