import { findNode, parentList, addChild, renameNode, removeNode, walk, type CatNode } from '../categoryTree'

const tree = (): CatNode[] => [{ name: '工程', children: [{ name: '后端', children: [{ name: 'API' }] }, { name: '前端' }] }, { name: '运营' }]

test('findNode 按路径取节点', () => {
  expect(findNode(tree(), ['工程', '后端', 'API'])?.name).toBe('API')
  expect(findNode(tree(), ['工程', '不存在'])).toBeNull()
})
test('addChild 在路径下加子节点', () => {
  const t = tree(); addChild(t, ['工程', '后端'], '网关')
  expect(findNode(t, ['工程', '后端', '网关'])).toEqual({ name: '网关' })
})
test('renameNode 改名', () => {
  const t = tree(); renameNode(t, ['运营'], '增长')
  expect(t.find(n => n.name === '增长')).toBeTruthy()
})
test('removeNode 删节点（含子树）', () => {
  const t = tree(); removeNode(t, ['工程', '后端'])
  expect(findNode(t, ['工程', '后端'])).toBeNull()
  expect(findNode(t, ['工程', '前端'])).toBeTruthy()
})
test('walk 深度优先带路径与 depth', () => {
  const seen: string[] = []; walk(tree(), (n, path) => seen.push(path.join('/')))
  expect(seen).toEqual(['工程', '工程/后端', '工程/后端/API', '工程/前端', '运营'])
})
test('parentList 取父级列表', () => {
  expect(parentList(tree(), ['工程']).map(n => n.name)).toEqual(['工程', '运营'])
  expect(parentList(tree(), ['工程', '后端']).map(n => n.name)).toEqual(['后端', '前端'])
})
