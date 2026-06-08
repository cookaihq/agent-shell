import fs from 'node:fs'; import path from 'node:path'
import { libraryManifestPath } from '../paths'

/**
 * 一次性启动清理（spec §7 迁移）：删除旧 clitools/skill.ts 生成的库残留。
 *
 * 旧实现为每个「已加入」的 CLI 工具在技能库里写过 SKILL.md，并在库 manifest 登记
 * 一条 `sourceId === 'cli-tools'` 的条目（key 形如 `cli-<id>`，目录 `skillsDir/cli-<id>/`）。
 * 新模型「检测即可见」不再生成 SKILL.md，这些残留需在 daemon boot 时删一次。
 *
 * 行为：读 `skillsDir/.library.json`，找出所有 sourceId==='cli-tools' 的 key；
 *      若一个都没有则不写盘直接 return（正常用户的常态，避免无谓 IO）；
 *      否则删这些 key、写回 manifest，并 rm 对应目录。全程 try/catch 容错，绝不抛。
 */
export function cleanupLegacyCliToolSkills(skillsDir: string): void {
  try {
    const manifestFile = libraryManifestPath(skillsDir)
    let manifest: Record<string, { sourceId: string; name: string; relPath: string }>
    try {
      manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
    } catch {
      return // manifest 读不到（不存在/坏）→ 无残留可清
    }

    const legacyKeys = Object.keys(manifest).filter((k) => manifest[k]?.sourceId === 'cli-tools')
    if (legacyKeys.length === 0) return // 无残留 → 不写盘

    // 注：非原子——先逐个删目录、最后写回 manifest。若 writeFileSync 失败，目录已删但条目残留；
    // 下次 boot 会再命中这些 key（rmSync force 对已删目录是 no-op）并重试写盘，最终自愈。
    // 这是一次性启动清理、非数据完整性关键路径，可接受。
    for (const key of legacyKeys) {
      delete manifest[key]
      try { fs.rmSync(path.join(skillsDir, key), { recursive: true, force: true }) } catch { /* 目录可能已不在，忽略 */ }
    }
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2))
  } catch (e) {
    console.error('[cli-tools] 旧 SKILL.md 残留清理失败', e)
  }
}
