import { render, fireEvent } from '@testing-library/react'
import { test, expect, vi, beforeEach } from 'vitest'
import { FileList } from '../FileList'
import type { FileNode } from '../../api/types'

// 列表/网格用 @tanstack/react-virtual 虚拟化，jsdom 无布局（尺寸全 0）会让真实虚拟器渲染 0 项。
// 把它打桩成「不裁剪、渲染全部项」的透传：测试只验证 FileList 的渲染/交互正确性，
// 真正的窗口化裁剪是库的职责，由浏览器实跑验证。lanes 即列数，决定 lane 分配。
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number; lanes?: number }) => {
    const cols = opts.lanes ?? 1
    const items = Array.from({ length: opts.count }, (_, index) => ({
      index, key: index, lane: index % cols, start: Math.floor(index / cols) * 40, size: 40, end: Math.floor(index / cols) * 40 + 40,
    }))
    return { getTotalSize: () => Math.ceil(opts.count / cols) * 40, getVirtualItems: () => items, measureElement: () => {}, measure: () => {} }
  },
}))

// FileList 用 api.rawUrl 给图片缩略拼 URL（画廊大预览的 Preview 在下方被打桩，不会真正调 api）
vi.mock('../../api/client', () => ({
  api: { rawUrl: (projectId: string, p: string) => `/api/pf/${projectId}/${p}` },
}))

// 单元隔离：FileList 测试只验证「画廊把 Preview 以 embedded 模式、传对 projectId/activeFile 挂上」，
// 不重测 Preview 内部渲染（Preview 自有 Preview.test 覆盖）。打桩避免其异步取数引入 act 告警。
vi.mock('../Preview', () => ({
  // FileList 还从 ./Preview 复用 IMAGE_EXT（图片缩略判定）→ 桩里一并提供
  IMAGE_EXT: new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']),
  Preview: ({ projectId, activeFile, embedded }: { projectId: string; activeFile: string | null; embedded?: boolean }) => (
    <div className="preview-wrap" data-embedded={embedded ? '1' : '0'} data-projectid={projectId} data-file={activeFile ?? ''} />
  ),
}))

const VIEW_KEY = 'agent-shell:file-view-mode'
beforeEach(() => { try { localStorage.clear() } catch { /* noop */ } })

const tree: FileNode[] = [
  {
    name: 'src', path: 'src', type: 'dir', children: [
      { name: 'a.ts', path: 'src/a.ts', type: 'file' },
      { name: 'b.ts', path: 'src/b.ts', type: 'file' },
      { name: 'styles', path: 'src/styles', type: 'dir', children: [
        { name: 'main.css', path: 'src/styles/main.css', type: 'file' },
      ] },
    ],
  },
  { name: 'README.md', path: 'README.md', type: 'file' },
]

test('选中根：有子文件夹 → 一级按子文件夹分组（src 文件夹 section）', () => {
  const { container } = render(<FileList nodes={tree} selectedDir="" onOpen={vi.fn()} projectId="p1" />)
  const folderHeads = Array.from(container.querySelectorAll('.fb-folder-h')).map((e) => e.textContent)
  // 根下有 src 子文件夹 + 直接文件 README.md（当前目录组）
  expect(folderHeads.some((t) => t?.includes('src'))).toBe(true)
  expect(folderHeads.some((t) => t?.includes('当前目录'))).toBe(true)
  // src 组里递归收集到 3 个文件（a.ts/b.ts/main.css）
  expect(folderHeads.find((t) => t?.includes('src'))).toContain('3')
})

test('选中 src：仍有子文件夹 styles → 按子文件夹分组；次级按类型', () => {
  const { container } = render(<FileList nodes={tree} selectedDir="src" onOpen={vi.fn()} projectId="p1" />)
  const folderHeads = Array.from(container.querySelectorAll('.fb-folder-h')).map((e) => e.textContent)
  expect(folderHeads.some((t) => t?.includes('styles'))).toBe(true)
  // 次级类型分组存在
  expect(container.querySelector('.fb-group')).toBeTruthy()
})

test('选中无子文件夹的目录 → 平铺按类型（无 folder section）', () => {
  const { container } = render(<FileList nodes={tree} selectedDir="src/styles" onOpen={vi.fn()} projectId="p1" />)
  expect(container.querySelector('.fb-folder-sec')).toBeNull()
  expect(container.querySelector('.fb-group')?.textContent).toContain('样式表')
})

// ── 视图模式（图标 / 列表 / 画廊） ───────────────────────────────────────────

test('默认渲染三个视图按钮，列表模式默认激活', () => {
  const { container } = render(<FileList nodes={tree} selectedDir="" onOpen={vi.fn()} projectId="p1" />)
  const btns = container.querySelectorAll('.fb-viewseg .fb-vbtn')
  expect(btns.length).toBe(3)
  // 无持久化值 → 默认 list
  expect(container.querySelector('.fb-vbtn[data-fbview="list"]')?.classList.contains('is-active')).toBe(true)
  expect(container.querySelector('.fb-body.is-list')).toBeTruthy()
  expect(container.querySelector('.fb-head')).toBeTruthy()
})

test('点「图标」→ 平铺网格(.fb-grid，无分组头、无表头)，出现尺寸滑杆，写入 localStorage', () => {
  const { container } = render(<FileList nodes={tree} selectedDir="" onOpen={vi.fn()} projectId="p1" />)
  fireEvent.click(container.querySelector('.fb-vbtn[data-fbview="icons"]')!)
  expect(container.querySelector('.fb-grid')).toBeTruthy()
  // 网格平铺：无列表表头、无分组头
  expect(container.querySelector('.fb-head')).toBeNull()
  expect(container.querySelector('.fb-folder-h')).toBeNull()
  expect(container.querySelector('.fb-group')).toBeNull()
  // 右下角尺寸滑杆
  expect(container.querySelector('.fb-sizebar input[type="range"]')).toBeTruthy()
  expect(localStorage.getItem(VIEW_KEY)).toBe('icons')
})

test('启动时读取 localStorage 偏好（gallery）→ 渲染画廊 + 嵌入真实 Preview + 缩略条', () => {
  localStorage.setItem(VIEW_KEY, 'gallery')
  const { container } = render(<FileList nodes={tree} selectedDir="src" onOpen={vi.fn()} projectId="p1" />)
  expect(container.querySelector('.fb-gallery')).toBeTruthy()
  expect(container.querySelector('.fb-gal-stage')).toBeTruthy()
  // 大预览区以 embedded 模式挂上 Preview，并把 projectId + 聚焦文件相对路径传进去
  const pv = container.querySelector('.fb-gal-stage .preview-wrap') as HTMLElement | null
  expect(pv?.getAttribute('data-embedded')).toBe('1')
  expect(pv?.getAttribute('data-projectid')).toBe('p1')
  expect(pv?.getAttribute('data-file')).toBe('src/a.ts')
  // src 下递归收集到 3 个文件（a.ts/b.ts/main.css）→ 3 个缩略
  expect(container.querySelectorAll('.fb-gal-thumb').length).toBe(3)
})

test('画廊：点缩略 → 大预览跟随（caption 文件名同步）；点「在标签页打开」→ onOpen', () => {
  localStorage.setItem(VIEW_KEY, 'gallery')
  const onOpen = vi.fn()
  const { container } = render(<FileList nodes={tree} selectedDir="src" onOpen={onOpen} projectId="p1" />)
  const thumbs = container.querySelectorAll('.fb-gal-thumb')
  // 默认聚焦第一个文件 a.ts
  expect(container.querySelector('.fb-gal-caption .fb-gal-name')?.textContent).toBe('a.ts')
  // 点第二个缩略（b.ts）→ 高亮 + caption 跟随 + 大预览聚焦文件跟随
  fireEvent.click(thumbs[1])
  expect(thumbs[1].classList.contains('is-active')).toBe(true)
  expect(container.querySelector('.fb-gal-caption .fb-gal-name')?.textContent).toBe('b.ts')
  expect(container.querySelector('.fb-gal-stage .preview-wrap')?.getAttribute('data-file')).toBe('src/b.ts')
  // 点 caption 的「在标签页打开」→ onOpen(聚焦文件)
  fireEvent.click(container.querySelector('.fb-gal-open')!)
  expect(onOpen).toHaveBeenCalledWith('src/b.ts')
})

test('画廊缩略：图片渲染真实 <img>(指向 rawUrl)，非图片用类型图标', () => {
  localStorage.setItem(VIEW_KEY, 'gallery')
  const imgTree: FileNode[] = [
    { name: 'pics', path: 'pics', type: 'dir', children: [
      { name: 'cover.png', path: 'pics/cover.png', type: 'file' },
      { name: 'note.md', path: 'pics/note.md', type: 'file' },
    ] },
  ]
  const { container } = render(<FileList nodes={imgTree} selectedDir="pics" onOpen={vi.fn()} projectId="p1" />)
  const thumbs = container.querySelectorAll('.fb-gal-thumb')
  expect(thumbs.length).toBe(2)
  // cover.png 缩略是真实 <img>，src 指向 rawUrl
  const img = container.querySelector('.fb-gal-thumb img.fb-thumb-img') as HTMLImageElement | null
  expect(img?.getAttribute('src')).toBe('/api/pf/p1/pics/cover.png')
  // note.md 缩略用图标（非 img）
  const mdThumb = Array.from(thumbs).find((t) => t.textContent?.includes('note.md'))!
  expect(mdThumb.querySelector('img')).toBeNull()
  expect(mdThumb.querySelector('.fb-icon')).toBeTruthy()
})

// ── 图标网格视图：平铺 + 缩略图 + 尺寸滑杆 ──────────────────────────────────

test('图标网格：图片→真实 <img>，HTML→缩略 iframe 容器，其余→图标；尺寸从 localStorage 读到 CSS 变量', () => {
  localStorage.setItem(VIEW_KEY, 'icons')
  localStorage.setItem('agent-shell:file-grid-size', '120')
  const gridTree: FileNode[] = [
    { name: 'a', path: 'a', type: 'dir', children: [
      { name: 'pic.png', path: 'a/pic.png', type: 'file' },
      { name: 'page.html', path: 'a/page.html', type: 'file' },
      { name: 'data.json', path: 'a/data.json', type: 'file' },
    ] },
  ]
  const { container } = render(<FileList nodes={gridTree} selectedDir="a" onOpen={vi.fn()} projectId="p1" />)
  const grid = container.querySelector('.fb-grid') as HTMLElement | null
  expect(grid).toBeTruthy()
  expect(grid?.style.getPropertyValue('--fb-grid-size')).toBe('120px')
  expect(container.querySelectorAll('.fb-cell').length).toBe(3)
  // 图片 → 真实 img
  expect(container.querySelector('.fb-cell img.fb-thumb-img')?.getAttribute('src')).toBe('/api/pf/p1/a/pic.png')
  // HTML（尺寸 120≥72）→ 缩略 iframe 容器
  expect(container.querySelector('.fb-cell .fb-thumb-html')).toBeTruthy()
  // json → 类型图标
  const jsonCell = Array.from(container.querySelectorAll('.fb-cell')).find((c) => c.textContent?.includes('data.json'))!
  expect(jsonCell.querySelector('.fb-icon')).toBeTruthy()
})

test('图标网格：拖滑杆改尺寸 → 写 localStorage 且更新 --fb-grid-size', () => {
  localStorage.setItem(VIEW_KEY, 'icons')
  const { container } = render(<FileList nodes={tree} selectedDir="" onOpen={vi.fn()} projectId="p1" />)
  const range = container.querySelector('.fb-sizebar input[type="range"]') as HTMLInputElement
  fireEvent.change(range, { target: { value: '160' } })
  expect(localStorage.getItem('agent-shell:file-grid-size')).toBe('160')
  expect((container.querySelector('.fb-grid') as HTMLElement).style.getPropertyValue('--fb-grid-size')).toBe('160px')
})

test('列表视图：名称列前对图片渲染真实缩略 <img>，其余用类型图标', () => {
  const listTree: FileNode[] = [
    { name: 'pic.png', path: 'pic.png', type: 'file' },
    { name: 'note.md', path: 'note.md', type: 'file' },
  ]
  const { container } = render(<FileList nodes={listTree} selectedDir="" onOpen={vi.fn()} projectId="p1" />)
  const rows = Array.from(container.querySelectorAll('.fb-row'))
  const picRow = rows.find((r) => r.textContent?.includes('pic.png'))!
  expect(picRow.querySelector('.fb-rowthumb img.fb-thumb-img')?.getAttribute('src')).toBe('/api/pf/p1/pic.png')
  const mdRow = rows.find((r) => r.textContent?.includes('note.md'))!
  expect(mdRow.querySelector('img')).toBeNull()
  expect(mdRow.querySelector('.fb-rowthumb .fb-icon')).toBeTruthy()
})

test('列表视图：修改/创建时间列显示真实时间，表头含两列（Issue 10）', () => {
  const t = new Date(2026, 5, 5, 14, 30).getTime()   // 本地 2026-06-05 14:30
  const listTree: FileNode[] = [
    { name: 'a.ts', path: 'a.ts', type: 'file', mtimeMs: t, birthtimeMs: t },
  ]
  const { container } = render(<FileList nodes={listTree} selectedDir="" onOpen={vi.fn()} projectId="p1" />)
  const head = container.querySelector('.fb-head')!
  expect(head.textContent).toContain('修改时间')
  expect(head.textContent).toContain('创建时间')
  const row = Array.from(container.querySelectorAll('.fb-row')).find((r) => r.textContent?.includes('a.ts'))!
  expect(row.querySelector('.fb-col-time')?.textContent).toBe('2026-06-05 14:30')
  expect(row.querySelector('.fb-col-ctime')?.textContent).toBe('2026-06-05 14:30')
})

// ── 键盘多选 + 右键命中规则（2026-06-05 设计 §5.2/§5.3）─────────────────────────
const flat: FileNode[] = [
  { name: 'a.ts', path: 'a.ts', type: 'file' },
  { name: 'b.ts', path: 'b.ts', type: 'file' },
  { name: 'c.ts', path: 'c.ts', type: 'file' },
]
const rowByName = (container: HTMLElement, name: string) =>
  Array.from(container.querySelectorAll('.fb-row')).find((r) => r.textContent?.includes(name)) as HTMLElement

test('list 表头去复选框（无 .fb-col-check / .fb-check）', () => {
  const { container } = render(<FileList nodes={flat} selectedDir="" onOpen={vi.fn()} projectId="p1" />)
  expect(container.querySelector('.fb-col-check')).toBeNull()
  expect(container.querySelector('.fb-check')).toBeNull()
})

test('list 单击=选中（清空其余）、不触发 onOpen；双击=打开', () => {
  const onOpen = vi.fn()
  const { container } = render(<FileList nodes={flat} selectedDir="" onOpen={onOpen} projectId="p1" />)
  fireEvent.click(rowByName(container, 'a.ts'))
  expect(rowByName(container, 'a.ts').classList.contains('is-selected')).toBe(true)
  expect(onOpen).not.toHaveBeenCalled()
  fireEvent.doubleClick(rowByName(container, 'a.ts'))
  expect(onOpen).toHaveBeenCalledWith('a.ts')
})

test('list Ctrl/Cmd+单击=切换多选', () => {
  const { container } = render(<FileList nodes={flat} selectedDir="" onOpen={vi.fn()} projectId="p1" />)
  fireEvent.click(rowByName(container, 'a.ts'))
  fireEvent.click(rowByName(container, 'c.ts'), { metaKey: true })
  expect(rowByName(container, 'a.ts').classList.contains('is-selected')).toBe(true)
  expect(rowByName(container, 'c.ts').classList.contains('is-selected')).toBe(true)
  expect(rowByName(container, 'b.ts').classList.contains('is-selected')).toBe(false)
  fireEvent.click(rowByName(container, 'a.ts'), { metaKey: true })   // 再点 a → 取消
  expect(rowByName(container, 'a.ts').classList.contains('is-selected')).toBe(false)
})

test('list Shift+单击=锚点到当前的连续区间', () => {
  const { container } = render(<FileList nodes={flat} selectedDir="" onOpen={vi.fn()} projectId="p1" />)
  fireEvent.click(rowByName(container, 'a.ts'))
  fireEvent.click(rowByName(container, 'c.ts'), { shiftKey: true })
  expect(rowByName(container, 'a.ts').classList.contains('is-selected')).toBe(true)
  expect(rowByName(container, 'b.ts').classList.contains('is-selected')).toBe(true)
  expect(rowByName(container, 'c.ts').classList.contains('is-selected')).toBe(true)
})

test('list 点空白 → 清空选中', () => {
  const { container } = render(<FileList nodes={flat} selectedDir="" onOpen={vi.fn()} projectId="p1" />)
  fireEvent.click(rowByName(container, 'a.ts'))
  expect(container.querySelector('.fb-row.is-selected')).toBeTruthy()
  fireEvent.click(container.querySelector('.fb-main')!)
  expect(container.querySelector('.fb-row.is-selected')).toBeNull()
})

test('list 右键未选中项 → 重置为单项，onContext targets=[该项]', () => {
  const onContext = vi.fn()
  const { container } = render(<FileList nodes={flat} selectedDir="" onOpen={vi.fn()} projectId="p1" onContext={onContext} />)
  fireEvent.click(rowByName(container, 'a.ts'))
  fireEvent.contextMenu(rowByName(container, 'b.ts'))
  const lastCall = onContext.mock.calls.at(-1)!
  expect(lastCall[0].path).toBe('b.ts')
  expect(lastCall[1]).toEqual(['b.ts'])
  expect(rowByName(container, 'b.ts').classList.contains('is-selected')).toBe(true)
  expect(rowByName(container, 'a.ts').classList.contains('is-selected')).toBe(false)
})

test('list 右键选中组内 → onContext targets=整组（可见顺序）', () => {
  const onContext = vi.fn()
  const { container } = render(<FileList nodes={flat} selectedDir="" onOpen={vi.fn()} projectId="p1" onContext={onContext} />)
  fireEvent.click(rowByName(container, 'a.ts'))
  fireEvent.click(rowByName(container, 'c.ts'), { shiftKey: true })   // a,b,c
  fireEvent.contextMenu(rowByName(container, 'b.ts'))
  expect(onContext.mock.calls.at(-1)![1]).toEqual(['a.ts', 'b.ts', 'c.ts'])
})

test('list 右键空白 → onContext(null, [])', () => {
  const onContext = vi.fn()
  const { container } = render(<FileList nodes={flat} selectedDir="" onOpen={vi.fn()} projectId="p1" onContext={onContext} />)
  fireEvent.contextMenu(container.querySelector('.fb-main')!)
  const lastCall = onContext.mock.calls.at(-1)!
  expect(lastCall[0]).toBeNull()
  expect(lastCall[1]).toEqual([])
})
