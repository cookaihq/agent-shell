/**
 * Composer.tsx — Task 17 + 18 (含 Task 15 基础)
 *
 * 高保真对照 workspace.html L64-90（composer 结构）
 * + app.js L850-937（发送/停止状态机）
 * + app.js L661-743（@ / / 提及菜单）  ← Task 17
 * + app.js L631-658（附件预览）        ← Task 18
 * + app.js L587-600（上下文计量环）    ← Task 18
 *
 * 结构：
 *   .composer > .composer-shell
 *     > MentionPop              (Task 17)
 *     > AttachBar               (Task 18)
 *     > textarea
 *     > .composer-row
 *         > .left
 *             > .cbtn.cbtn-icon + input[file hidden] (附件按钮, Task 18)
 *             > .model-wrap > ModelPill
 *             > CtxFile         (Task 18 建组件，activeFile 联动 Task 20)
 *         > CtxMeter            (Task 18)
 *         > .csend              (发送键 / 停止键双态)
 */

import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from 'react'
import { IconSend, IconStop, IconPaperclip } from '../ui/icons'
import { ModelPill } from './ModelPill'
import { MentionPop } from './MentionPop'
import { useMention } from './useMention'
import { AttachBar } from './AttachBar'
import { CtxMeter } from './CtxMeter'
import { CtxFile } from './CtxFile'
import { api } from '../api/client'
import type { UsageDTO } from '../api/types'

export interface AttachedFile {
  file: File
  objectUrl: string // 仅图片用，文件图标态为空串
  isImage: boolean
}

interface ComposerProps {
  running: boolean
  onSubmit: (text: string) => void
  onInterrupt: () => void
  engine: 'claude' | 'codex'
  model: string
  projectId: string
  /** usage 由 Workspace 传入（Task 18）：api.usage 初值 + SSE liveUsage 叠加 */
  usage?: UsageDTO
  /** 当前打开文件路径（Task 20）：Workspace → Composer → CtxFile 联动 */
  activeFile?: string | null
}

export function Composer({ running, onSubmit, onInterrupt, projectId, usage, activeFile }: ComposerProps) {
  const [text, setText] = useState('')
  // IME 输入法组合态，组合中 Enter 不发送
  const composingRef = useRef(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── 附件列表（前端态，不上传；submit 不带附件；上传/组装=后续子里程碑）────────────
  const [attachments, setAttachments] = useState<AttachedFile[]>([])

  // ── 真实项目文件（Composer mount 时拍平，传给 useMention）────────────────────────
  const [filePaths, setFilePaths] = useState<string[]>([])
  useEffect(() => {
    if (!projectId) return
    api.files(projectId)
      .then(({ tree }) => {
        // 递归拍平 FileNode 树 → 路径列表
        // 目录节点补尾斜杠，使 useMention buildItems 的 endsWith('/') 判断正确
        // 这样 @decks/ 能筛出该目录下文件，且 @ 菜单文件夹图标显示正确
        const flat: string[] = []
        function walk(nodes: typeof tree) {
          for (const n of nodes) {
            flat.push(n.type === 'dir' ? n.path + '/' : n.path)
            if (n.children) walk(n.children)
          }
        }
        walk(tree)
        setFilePaths(flat)
      })
      .catch(() => { /* 加载失败静默，不影响 Composer 功能 */ })
  }, [projectId])

  // ── 提及菜单（Task 17）───────────────────────────────────────────────────────
  // 技能占位静态集（真实来自 Skills 库=M7c）
  const skillNames: string[] = []
  const mention = useMention(filePaths, skillNames)

  // ── 附件帮助函数 ──────────────────────────────────────────────────────────────
  const addFile = useCallback((file: File) => {
    const isImage = file.type.startsWith('image/')
    const objectUrl = isImage ? URL.createObjectURL(file) : ''
    setAttachments(prev => [...prev, { file, objectUrl, isImage }])
  }, [])

  const removeAttachment = useCallback((idx: number) => {
    setAttachments(prev => {
      const item = prev[idx]
      if (item?.objectUrl) URL.revokeObjectURL(item.objectUrl)
      return prev.filter((_, i) => i !== idx)
    })
  }, [])

  // ── 粘贴图片/文件检测 ─────────────────────────────────────────────────────────
  const onPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items) return
    Array.from(items).forEach(it => {
      if (it.kind === 'file') {
        const f = it.getAsFile()
        if (f) addFile(f)
      }
    })
  }, [addFile])

  // ── 发送 ──────────────────────────────────────────────────────────────────────
  const send = () => {
    const t = text.trim()
    if (!t) return
    onSubmit(t)
    setText('')
  }

  // ── 键盘处理 ──────────────────────────────────────────────────────────────────
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // mention-pop 打开时：方向键/Enter/Tab/Esc 让给菜单（Task 17）
    if (mention.open) {
      mention.onKeyDown(e)
      // Enter/Tab 选中 → 执行 choose 并同步 React text state
      if ((e.key === 'Enter' || e.key === 'Tab') && taRef.current) {
        const newVal = mention.choose(taRef.current)
        setText(newVal)
      }
      return
    }
    // mention 关闭时 Enter 发送
    if (e.key === 'Enter' && !e.shiftKey && !composingRef.current) {
      e.preventDefault()
      send()
    }
  }

  // ── textarea input 同步 text state + 触发 mention detect ─────────────────────
  const onInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget
    setText(ta.value)
    mention.onInput(ta)
  }

  return (
    <div className="composer">
      <div className="composer-shell">
        {/* mention-pop — Task 17 */}
        <MentionPop
          open={mention.open}
          items={mention.items}
          activeIndex={mention.activeIndex}
          onChoose={(idx) => {
            if (taRef.current) {
              const newVal = mention.choose(taRef.current, idx)
              setText(newVal)
            }
          }}
        />

        {/* attach-bar — Task 18 */}
        <AttachBar attachments={attachments} onRemove={removeAttachment} />

        <textarea
          ref={taRef}
          value={text}
          placeholder="回复…，或 @ 引用文件 / 技能"
          onChange={() => { /* 由 onInput 处理，避免双重 */ }}
          onInput={onInput}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => { composingRef.current = false }}
        />

        <div className="composer-row">
          <div className="left">
            {/* 附件按钮 + 隐藏 file input — Task 18 */}
            <button
              className="cbtn cbtn-icon"
              title="添加附件"
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              <IconPaperclip size={15} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                Array.from(e.target.files ?? []).forEach(addFile)
                e.target.value = ''
              }}
            />

            {/* 模型胶囊 */}
            <div className="model-wrap">
              <ModelPill />
            </div>

            {/* ctx-file — Task 20：activeFile 由 Workspace 经 FileWorkspace 联动传入 */}
            <CtxFile activeFile={activeFile ?? null} />
          </div>

          {/* ctx-wrap / CtxMeter — Task 18 */}
          <CtxMeter usage={usage} />

          {/* csend：运行中 → 停止键；空闲 → 发送键 (app.js L862-866) */}
          {running ? (
            <button
              className="csend is-running"
              title="中断当前任务"
              type="button"
              onClick={onInterrupt}
            >
              <IconStop size={13} />
            </button>
          ) : (
            <button
              className="csend"
              title="发送"
              type="button"
              onClick={send}
            >
              <IconSend size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
