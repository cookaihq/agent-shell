import type { CatNode } from '../api/types'
export type { CatNode }

export function findNode(tree: CatNode[], path: string[]): CatNode | null {
  let nodes: CatNode[] | undefined = tree, node: CatNode | null = null
  for (const seg of path) { node = (nodes ?? []).find(n => n.name === seg) ?? null; if (!node) return null; nodes = node.children }
  return node
}
export function parentList(tree: CatNode[], path: string[]): CatNode[] {
  return path.length <= 1 ? tree : (findNode(tree, path.slice(0, -1))?.children ?? [])
}
export function addChild(tree: CatNode[], parentPath: string[], name: string): void {
  if (parentPath.length === 0) { tree.push({ name }); return }
  const p = findNode(tree, parentPath); if (!p) return
  ;(p.children ??= []).push({ name })
}
export function renameNode(tree: CatNode[], path: string[], name: string): void {
  const n = findNode(tree, path); if (n) n.name = name
}
export function removeNode(tree: CatNode[], path: string[]): void {
  const list = parentList(tree, path); const i = list.findIndex(x => x.name === path[path.length - 1]); if (i >= 0) list.splice(i, 1)
}
export function walk(tree: CatNode[], fn: (node: CatNode, path: string[], depth: number) => void): void {
  const rec = (nodes: CatNode[], prefix: string[]) => nodes.forEach(n => { const path = [...prefix, n.name]; fn(n, path, prefix.length); rec(n.children ?? [], path) })
  rec(tree, [])
}
