/**
 * useMention.ts — Task 17
 *
 * @ / / 提及菜单 hook。
 * 移植 app.js wireMention (L661-743) → React hook。
 *
 * API：
 *   useMention(filePaths, skillNames)
 *     → { open, trig, query, items, activeIndex, onInput, onKeyDown, choose, hide }
 *
 * 说明：
 *   - @files: 真实项目文件（Composer mount 时由 api.files 拍平后传入）
 *   - @skills: 占位静态集（真实来自 Skills 库=M7c，此处只接收传入的 skillNames）
 *   - /cmds: 静态命令集（clear/compact/plan/review/init）
 *   - choose(ta) 把 @路径 / /命令 文本插入 textarea，返回新的 textarea.value
 *     M7a 不读文件内容、不消费上下文，仅文本插入
 */
import { useState, useCallback } from 'react'
import type { KeyboardEvent } from 'react'

// ── 命令项类型（命令源由 Composer 从 SDK supportedCommands 动态注入，不再写死）──────────
// name=命令名（无前导 /），desc=描述（取自 SlashCommand.description）。
export interface CommandItem { name: string; desc: string }

// ── 图标类型标识（MentionPop 据此渲染对应 SVG）────────────────────────────────
export type IconKind = 'folder' | 'file' | 'skill' | 'cmd'

export interface MentionItem {
  insert: string       // 插入到 textarea 的完整文字（含前缀 @ /）
  label: string        // 显示文字
  icon: IconKind
  group?: string       // 分组标题（文件/技能），/ 命令无分组
  desc?: string        // 命令描述
}

// detect 正则：行首或空格后的 @ / /，后跟非空白字符（含路径分隔符 /）
// 对齐原型 app.js wireMention L689：query 仅排除 \s 和 @，允许含 /，
// 以支持按完整路径前缀继续筛选（如 @decks/seed/ 精确匹配该目录下文件）。
// 不排除 / 不会误触发——(^|\s)([@/]) 要求触发符前是行首或空格，
// 像 http:// 里的 / 前是字母，不会被当触发符。
const DETECT_RE = /(^|\s)([@/])([^\s@]*)$/

interface DetectResult {
  trig: '@' | '/'
  query: string
  start: number   // @ / / 字符在 value 中的绝对位置
}

function detect(ta: HTMLTextAreaElement): DetectResult | null {
  const before = ta.value.slice(0, ta.selectionStart)
  const m = before.match(DETECT_RE)
  if (!m) return null
  return {
    trig: m[2] as '@' | '/',
    query: m[3].toLowerCase(),
    start: ta.selectionStart - m[3].length - 1, // @ / / 字符位置
  }
}

function buildItems(d: DetectResult, filePaths: string[], skillNames: string[], commandList: CommandItem[]): MentionItem[] {
  const out: MentionItem[] = []
  if (d.trig === '@') {
    // 文件候选：拍平路径列表
    filePaths
      .filter(p => p.toLowerCase().includes(d.query))
      .forEach(p => {
        const isFolder = p.endsWith('/')
        out.push({
          insert: '@' + p,
          group: '文件',
          icon: isFolder ? 'folder' : 'file',
          label: p,
        })
      })
    // 技能候选
    skillNames
      .filter(s => s.toLowerCase().includes(d.query))
      .forEach(s => out.push({ insert: '@' + s, group: '技能', icon: 'skill', label: s }))
  } else {
    // 命令候选
    commandList
      .filter(c => c.name.toLowerCase().includes(d.query))
      .forEach(c => out.push({ insert: '/' + c.name, icon: 'cmd', label: '/' + c.name, desc: c.desc }))
  }
  return out
}

// ── Hook ──────────────────────────────────────────────────────────────────────

interface MentionState {
  open: boolean
  trig: '@' | '/' | null
  query: string
  items: MentionItem[]
  activeIndex: number
  // qStart: @ / / 字符在 value 中的绝对位置（用于 choose 拼接）
  qStart: number
}

const CLOSED: MentionState = { open: false, trig: null, query: '', items: [], activeIndex: 0, qStart: 0 }

export function useMention(filePaths: string[], skillNames: string[], commandList: CommandItem[]) {
  const [state, setState] = useState<MentionState>(CLOSED)

  const onInput = useCallback((ta: HTMLTextAreaElement) => {
    const d = detect(ta)
    if (!d) { setState(CLOSED); return }
    const items = buildItems(d, filePaths, skillNames, commandList)
    if (!items.length) { setState(CLOSED); return }
    setState({ open: true, trig: d.trig, query: d.query, items, activeIndex: 0, qStart: d.start })
  }, [filePaths, skillNames, commandList])

  const hide = useCallback(() => setState(CLOSED), [])

  /**
   * choose(ta, idx?)
   *   把选中 item 的 insert 文本替换掉 textarea 中触发段（@ query）。
   *   返回新的 textarea.value（同时直接修改 ta.value + 光标）。
   *   调用方负责用返回值同步 React state。
   */
  const choose = useCallback((ta: HTMLTextAreaElement, idx?: number): string => {
    const { items, activeIndex, qStart } = state
    const target = idx ?? activeIndex
    const item = items[target]
    if (!item) return ta.value

    const v = ta.value
    const pos = ta.selectionStart
    const newVal = v.slice(0, qStart) + item.insert + ' ' + v.slice(pos)
    const caret = qStart + item.insert.length + 1
    ta.value = newVal
    ta.setSelectionRange(caret, caret)
    setState(CLOSED)
    return newVal
  }, [state])

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!state.open) return
    const { items, activeIndex } = state
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setState(s => ({ ...s, activeIndex: (s.activeIndex + 1) % items.length }))
        break
      case 'ArrowUp':
        e.preventDefault()
        setState(s => ({ ...s, activeIndex: (s.activeIndex - 1 + items.length) % items.length }))
        break
      case 'Enter':
      case 'Tab':
        // caller (Composer) 调 choose(ta) 后再同步 state；此处只 preventDefault
        e.preventDefault()
        break
      case 'Escape':
        e.preventDefault()
        hide()
        break
    }
  }, [state, hide])

  return {
    open: state.open,
    trig: state.trig,
    query: state.query,
    items: state.items,
    activeIndex: state.activeIndex,
    onInput,
    onKeyDown,
    choose,
    hide,
  }
}
