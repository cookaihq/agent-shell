import fs from 'node:fs'
import path from 'node:path'
import type { ListedAttachment } from './attachments'

/** base64 内联图片块（结构与 @anthropic-ai/sdk ImageBlockParam 兼容；claudeSdk 把它塞进 SDKUserMessage.content）。 */
export type ImageInlineBlock = {
  type: 'image'
  source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string }
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 单图原始文件 ≤5MB（spec §1.3/§9，统一不分 provider）
const EXT_MEDIA: Record<string, ImageInlineBlock['source']['media_type']> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** 把 listed 分两组：图片(≤5MB,可读) → base64 image 块；其余（含超限/读失败降级的图片） → nonImageListed（走 preamble）。 */
export function inlineImages(
  cwd: string,
  listed: ListedAttachment[],
): { imageBlocks: ImageInlineBlock[]; nonImageListed: ListedAttachment[] } {
  const root = path.resolve(cwd)
  const imageBlocks: ImageInlineBlock[] = []
  const nonImageListed: ListedAttachment[] = []
  for (const item of listed) {
    const ext = (item.path.split('.').pop() ?? '').toLowerCase()
    const media = EXT_MEDIA[ext]
    if (!media) {
      nonImageListed.push(item)
      continue
    } // 非图片扩展名
    const abs = path.isAbsolute(item.path) ? item.path : path.resolve(root, item.path)
    try {
      if (fs.statSync(abs).size > MAX_IMAGE_BYTES) {
        nonImageListed.push(item)
        continue
      } // 超限降级
      const data = fs.readFileSync(abs).toString('base64')
      imageBlocks.push({ type: 'image', source: { type: 'base64', media_type: media, data } })
    } catch {
      nonImageListed.push(item)
    } // 读盘失败/不存在 → 降级
  }
  return { imageBlocks, nonImageListed }
}
