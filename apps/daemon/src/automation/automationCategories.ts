import fs from 'node:fs'; import path from 'node:path'
import { AutomationCategoriesResp, type CatNode } from '@agent-shell/contracts'

/** 读自动任务分类树（缺文件 / 损坏 JSON / 非法树 → {tree:[]}，不抛）。 */
export function readCategories(file: string): { tree: CatNode[] } {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
    const parsed = AutomationCategoriesResp.safeParse(raw)
    return parsed.success ? parsed.data : { tree: [] }
  } catch { return { tree: [] } }
}

/** 写分类树（先 zod 规范化校验）。返回规范化后的 {tree}。 */
export function writeCategories(file: string, tree: CatNode[]): { tree: CatNode[] } {
  const norm = AutomationCategoriesResp.parse({ tree })
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(norm, null, 2))
  return norm
}
