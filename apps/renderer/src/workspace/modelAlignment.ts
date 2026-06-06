/**
 * modelAlignment.ts — claude 模型列表「对齐 VS Code」展示层映射
 *
 * 依据 spec 2026-06-05-model-picker-collapse-and-command-palette-design.md：
 *   - SDK supportedModels() 照单全收（这次给了 Sonnet 1M 变体，却只给非 1M Opus）。
 *   - VS Code 列表是整理过的：Default 标 Opus 1M、只留 Opus(1M)、无非 1M Opus、无 Sonnet 1M。
 *   - 该整理放在 renderer 展示层（design §L83），动态/静态两分支共用此函数。
 *
 * 纯函数、无副作用，便于单测。输入输出同形（AlignModel）。
 */

export interface AlignModel {
  value: string
  displayName: string
  description?: string
}

/** 1M 判定：value 带 [1m] 后缀，或 description 含 "1M" 文本（SDK 仅在描述标 1M 的兜底）。 */
export function isOneM(m: AlignModel): boolean {
  if (/\[1m\]/i.test(m.value)) return true
  if (m.description && /\b1M\b/i.test(m.description)) return true
  return false
}

const DESC_FALLBACK: Record<string, string> = {
  default: 'Opus 4.8 · 1M context · Most capable for complex work',
  sonnet: 'Sonnet 4.6 · Best for everyday tasks',
  haiku: 'Haiku 4.5 · Fastest for quick answers',
  'opus[1m]': 'Opus 4.8 · 1M context · Most capable for complex work',
}

function pick(list: AlignModel[], pred: (m: AlignModel) => boolean): AlignModel | undefined {
  return list.find(pred)
}

/**
 * 对齐 VS Code：输出固定顺序 Default → Sonnet → Haiku → Opus 1M，缺项跳过。
 * 丢弃非 1M opus 与 sonnet 的 1M 变体。displayName 优先用 SDK 原名，缺失才补规范名。
 */
export function applyVscodeAlignment(models: AlignModel[]): AlignModel[] {
  if (!models.length) return []

  const out: AlignModel[] = []

  // Default（推荐项）：取 value === 'default'
  const def = pick(models, (m) => m.value === 'default')
  if (def) {
    out.push({
      value: def.value,
      displayName: def.displayName || 'Default (recommended)',
      description: def.description || DESC_FALLBACK.default,
    })
  }

  // Sonnet（非 1M 日常款）：value 以 sonnet 起头且非 1M
  const sonnet = pick(models, (m) => /^sonnet/i.test(m.value) && !isOneM(m))
  if (sonnet) {
    out.push({
      value: sonnet.value,
      displayName: sonnet.displayName || 'Sonnet',
      description: sonnet.description || DESC_FALLBACK.sonnet,
    })
  }

  // Haiku
  const haiku = pick(models, (m) => /^haiku/i.test(m.value))
  if (haiku) {
    out.push({
      value: haiku.value,
      displayName: haiku.displayName || 'Haiku',
      description: haiku.description || DESC_FALLBACK.haiku,
    })
  }

  // Opus 1M：优先取 SDK 直接给的 1M opus；否则用 default（已 1M）兜出一条 opus[1m]
  const opus1m = pick(models, (m) => /^opus/i.test(m.value) && isOneM(m))
  if (opus1m) {
    out.push({
      value: opus1m.value,
      displayName: 'Opus 1M',
      description: opus1m.description || DESC_FALLBACK['opus[1m]'],
    })
  } else if (def) {
    // SDK 只给了非 1M opus（或没给 opus）：用 default 的 1M 能力补出 Opus(1M) 选项
    out.push({
      value: 'opus[1m]',
      displayName: 'Opus 1M',
      description: def.description || DESC_FALLBACK['opus[1m]'],
    })
  }

  return out
}
