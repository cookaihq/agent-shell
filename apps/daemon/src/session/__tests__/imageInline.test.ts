import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { inlineImages } from '../imageInline'

let cwd: string
beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'as-img-'))
})
afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true })
})

function writeImg(rel: string, bytes = 10): string {
  const abs = path.join(cwd, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, Buffer.alloc(bytes, 1))
  return rel
}

describe('inlineImages', () => {
  it('图片 → base64 image 块；非图片留 nonImageListed', () => {
    const png = writeImg('attachments/a.png')
    const md = writeImg('attachments/n.md')
    const { imageBlocks, nonImageListed } = inlineImages(cwd, [
      { name: 'a.png', path: png },
      { name: 'n.md', path: md },
    ])
    expect(imageBlocks).toHaveLength(1)
    expect(imageBlocks[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png' } })
    expect(typeof (imageBlocks[0] as any).source.data).toBe('string')
    expect(nonImageListed.map((l) => l.path)).toEqual([md])
  })

  it('.jpg / .jpeg 都映 image/jpeg', () => {
    const j1 = writeImg('attachments/a.jpg')
    const j2 = writeImg('attachments/b.jpeg')
    const { imageBlocks } = inlineImages(cwd, [
      { name: 'a.jpg', path: j1 },
      { name: 'b.jpeg', path: j2 },
    ])
    expect(imageBlocks.map((b) => (b as any).source.media_type)).toEqual(['image/jpeg', 'image/jpeg'])
  })

  it('图片 >5MB 降级回 nonImageListed（不内联，留盘走 preamble）', () => {
    const big = writeImg('attachments/big.png', 5 * 1024 * 1024 + 1)
    const { imageBlocks, nonImageListed } = inlineImages(cwd, [{ name: 'big.png', path: big }])
    expect(imageBlocks).toHaveLength(0)
    expect(nonImageListed.map((l) => l.path)).toEqual([big])
  })

  it('读盘失败 / 路径不存在的图片 → 降级回 nonImageListed', () => {
    const { imageBlocks, nonImageListed } = inlineImages(cwd, [{ name: 'gone.png', path: 'attachments/gone.png' }])
    expect(imageBlocks).toHaveLength(0)
    expect(nonImageListed.map((l) => l.path)).toEqual(['attachments/gone.png'])
  })

  it('绝对路径图片也能解析内联', () => {
    const rel = writeImg('x.webp')
    const abs = path.join(cwd, rel)
    const { imageBlocks } = inlineImages(cwd, [{ name: 'x.webp', path: abs }])
    expect(imageBlocks[0]).toMatchObject({ source: { media_type: 'image/webp' } })
  })
})
