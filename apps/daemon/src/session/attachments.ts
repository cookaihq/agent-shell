import fs from 'node:fs'
import path from 'node:path'

/** 一条附件在 preamble / 历史回显里的形态：name=显示名，path=喂给 agent 的路径（项目内相对 / 项目外绝对）。 */
export interface ListedAttachment { name: string; path: string }

export interface ResolvedAttachments {
  listed: ListedAttachment[]
  /** 项目外路径需授权读取的目录集（claude --add-dir / codex 可读根）；项目内的不产生授权目录。 */
  externalDirs: string[]
}

/**
 * 把 contextFiles（混合相对/绝对路径）按 cwd 分类：
 * - 项目内 → 相对 posix 路径，无需授权
 * - 项目外 → 绝对路径，收集其授权目录（文件→父目录、文件夹→自身）
 * 不存在的路径静默丢弃（advisory context）。
 */
export function resolveAttachments(cwd: string, contextFiles: string[]): ResolvedAttachments {
  const root = path.resolve(cwd)
  const listed: ListedAttachment[] = []
  const dirs = new Set<string>()
  for (const raw of contextFiles) {
    if (typeof raw !== 'string' || raw.length === 0) continue
    const abs = path.resolve(root, raw)
    let stat: fs.Stats
    try { stat = fs.statSync(abs) } catch { continue }   // 不存在 → 丢弃
    const inside = abs === root || abs.startsWith(root + path.sep)
    if (inside) {
      const rel = path.relative(root, abs).split(path.sep).join('/')
      listed.push({ name: path.basename(abs), path: rel })
    } else {
      listed.push({ name: path.basename(abs), path: abs })
      dirs.add(stat.isDirectory() ? abs : path.dirname(abs))
    }
  }
  return { listed, externalDirs: [...dirs] }
}

/** 把附件路径拼成 preamble 追加到 user 文本末尾，让 agent 自己 Read（对齐 open-design CLI）。无附件则原文不变。 */
export function buildPromptWithAttachments(text: string, listed: ListedAttachment[]): string {
  if (listed.length === 0) return text
  return `${text}\n\nAttached project files: ${listed.map((l) => `\`${l.path}\``).join(', ')}`
}
