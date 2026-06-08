// 管理分类模态（树形增删改）：维护 automation-categories.json（Plan D D7）。
// 容器复用 automation-modal；增删改用 D5 纯函数 + D6 端点落库。视觉对齐原型 tasks.html renderCatMgmt。
import { useEffect, useState } from 'react'
import type { CatNode } from './categoryTree'
import { addChild, renameNode, removeNode, walk } from './categoryTree'
import { api } from '../api/client'

export function CategoryManagerModal({ onClose, onChanged }: { onClose: () => void; onChanged: (tree: CatNode[]) => void }) {
  const [tree, setTree] = useState<CatNode[]>([])
  useEffect(() => { void api.listAutomationCategories().then((r) => setTree(r.tree)).catch(() => {}) }, [])

  // 每次改动：先 structuredClone（D5 函数原地改），落库 + 通知上层刷新树。
  const commit = (next: CatNode[]) => {
    setTree(next)
    onChanged(next)
    void api.putAutomationCategories(next).catch(() => {})
  }
  const addRoot = () => { const n = window.prompt('新顶级分类名称：'); if (!n?.trim()) return; const next = structuredClone(tree); addChild(next, [], n.trim()); commit(next) }
  const addSub = (path: string[]) => { const n = window.prompt('新子分类名称：'); if (!n?.trim()) return; const next = structuredClone(tree); addChild(next, path, n.trim()); commit(next) }
  const rename = (path: string[]) => { const n = window.prompt('重命名为：', path[path.length - 1]); if (!n?.trim()) return; const next = structuredClone(tree); renameNode(next, path, n.trim()); commit(next) }
  const remove = (path: string[]) => { if (!window.confirm(`删除分类「${path[path.length - 1]}」及其子分类？`)) return; const next = structuredClone(tree); removeNode(next, path); commit(next) }

  const rows: { path: string[]; depth: number; name: string }[] = []
  walk(tree, (n, path, depth) => rows.push({ path, depth, name: n.name }))

  return (
    <div className="automation-modal-backdrop open" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="automation-modal" style={{ maxWidth: 460 }}>
        <header className="automation-modal__head">
          <input className="automation-modal__title-input" value="管理分类" readOnly style={{ cursor: 'default' }} />
          <button type="button" className="automation-modal__close" onClick={onClose} aria-label="关闭">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>
        <div className="automation-modal__body cat-mgmt">
          {rows.map((r) => (
            <div key={r.path.join('/')} className="cat-mgmt-row" style={{ paddingLeft: r.depth * 18 + 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="cat-mgmt-name">{r.name}</span>
              <span className="cat-mgmt-acts" style={{ display: 'inline-flex', gap: 4 }}>
                <button type="button" className="cat-mgmt-btn" onClick={() => addSub(r.path)} title="加子分类">＋</button>
                <button type="button" className="cat-mgmt-btn" onClick={() => rename(r.path)} title="重命名">✎</button>
                <button type="button" className="cat-mgmt-btn" onClick={() => remove(r.path)} title="删除">🗑</button>
              </span>
            </div>
          ))}
          {rows.length === 0 && <div className="auto-pop__label" style={{ padding: '8px 2px' }}>还没有分类，点下方「+ 顶级分类」新建。</div>}
        </div>
        <footer className="automation-modal__foot">
          <button type="button" className="cat-mgmt-addroot" onClick={addRoot}>+ 顶级分类</button>
          <div className="automation-modal__actions"><button type="button" className="automation-modal__submit" onClick={onClose}>完成</button></div>
        </footer>
      </div>
    </div>
  )
}
