/**
 * Composer.tsx — 工作区输入框（发送/停止 + @// 提及 + 消息附件 + CtxMeter + CtxFile）
 *
 * 消息附件（本设计）：
 *   - 回形针按钮 → 原生选择器 pickPaths 拿绝对路径（不复制，发送时作为 contextFiles 引用；项目外由 daemon 授权读取）
 *   - 粘贴 → 剪贴板字节即时 uploadPaste 写进 <project>/attachments/，引用其相对路径
 *   - 发送 → onSubmit(text, contextFiles)，daemon 拼 preamble 让 agent Read
 * 「拖文件进文件面板→项目根」是另一入口（FileWorkspace，simplty 2504084），不在此处。
 */

import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from 'react'
import { IconSend, IconStop, IconPaperclip } from '../ui/icons'
import { ModelPill } from './ModelPill'
import { MentionPop } from './MentionPop'
import { useMention } from './useMention'
import { AttachBar, type AttachChip } from './AttachBar'
import { CtxMeter } from './CtxMeter'
import { CtxFile } from './CtxFile'
import { api } from '../api/client'
import type { UsageDTO } from '../api/types'
import type { AgentShellBridge } from '@agent-shell/contracts'

/** 一条已就绪的消息附件：path=喂给 daemon 的 contextFiles 路径（按钮→绝对、粘贴→相对）；name/kind 用于 chip 显示。 */
interface Attachment { name: string; path: string; kind: 'file' | 'dir' }

function basename(p: string): string { return p.split(/[\\/]/).filter(Boolean).pop() ?? p }
/** 选择器只给路径不给类型，按「basename 有无扩展名」粗判 chip 图标（仅显示用；daemon 侧按 stat 精确授权）。 */
function guessKind(p: string): 'file' | 'dir' { return /\.[^./\\]+$/.test(basename(p)) ? 'file' : 'dir' }

interface ComposerProps {
  running: boolean
  onSubmit: (text: string, contextFiles: string[]) => void
  onInterrupt: () => void
  engine: 'claude' | 'codex'
  model: string
  projectId: string
  sessionId?: string                 // 传给 ModelPill 拉动态模型列表
  usage?: UsageDTO
  /** 运行中的实时 token 估算（progress 事件）→ CtxMeter 实时同步（Issue 10）。 */
  liveTokens?: number
  activeFile?: string | null
}

export function Composer({ running, onSubmit, onInterrupt, engine, model, projectId, sessionId, usage, liveTokens, activeFile }: ComposerProps) {
  const [text, setText] = useState('')
  const composingRef = useRef(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // ── 消息附件 ────────────────────────────────────────────────────────────────────
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const removeAttachment = useCallback((idx: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx))
  }, [])

  // 回形针按钮：原生选择器拿绝对路径（文件/文件夹/多选），引用不复制
  const pickAttachments = useCallback(async () => {
    const bridge = (globalThis as { agentShell?: AgentShellBridge }).agentShell
    if (!bridge) return
    const paths = await bridge.pickPaths()
    if (paths.length === 0) return
    setAttachments(prev => [...prev, ...paths.map(p => ({ name: basename(p), path: p, kind: guessKind(p) }))])
  }, [])

  // 粘贴：剪贴板字节无源路径 → 即时上传写进 attachments/，引用相对路径
  const onPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items || !projectId) return
    for (const it of Array.from(items)) {
      if (it.kind !== 'file') continue
      const f = it.getAsFile()
      if (!f) continue
      const name = f.name || `pasted-${f.type.split('/')[1] || 'bin'}`
      api.uploadPaste(projectId, f, name)
        .then(({ file }) => setAttachments(prev => [...prev, { name: file.name, path: file.path, kind: 'file' }]))
        .catch(() => { /* 上传失败不阻塞，静默 */ })
    }
  }, [projectId])

  // ── 真实项目文件（@ 提及用）─────────────────────────────────────────────────────
  const [filePaths, setFilePaths] = useState<string[]>([])
  useEffect(() => {
    if (!projectId) return
    api.files(projectId)
      .then(({ tree }) => {
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
      .catch(() => { /* 加载失败静默 */ })
  }, [projectId])

  // 技能候选（@ 提及，Issue 5）：接现成的全局技能库接口（不绑 projectId），不再写死空数组
  const [skillNames, setSkillNames] = useState<string[]>([])
  useEffect(() => {
    api.listSkills()
      .then(({ skills }) => setSkillNames(skills.map((s) => s.name)))
      .catch(() => { /* 技能库加载失败静默：@ 仍可提及文件 */ })
  }, [])
  const mention = useMention(filePaths, skillNames)

  // ── 发送 ──────────────────────────────────────────────────────────────────────
  const send = () => {
    const t = text.trim()
    if (!t && attachments.length === 0) return
    onSubmit(t, attachments.map(a => a.path))
    setText('')
    setAttachments([])
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention.open) {
      mention.onKeyDown(e)
      if ((e.key === 'Enter' || e.key === 'Tab') && taRef.current) {
        const newVal = mention.choose(taRef.current)
        setText(newVal)
      }
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !composingRef.current) {
      e.preventDefault()
      send()
    }
  }

  const onInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget
    setText(ta.value)
    mention.onInput(ta)
  }

  const chips: AttachChip[] = attachments.map(a => ({ name: a.name, kind: a.kind }))

  return (
    <div className="composer">
      <div className="composer-shell">
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

        <AttachBar attachments={chips} onRemove={removeAttachment} />

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
            {/* 回形针：原生选择器拿绝对路径（引用，不复制） */}
            <button
              className="cbtn cbtn-icon"
              title="添加附件"
              type="button"
              onClick={() => void pickAttachments()}
            >
              <IconPaperclip size={15} />
            </button>

            <div className="model-wrap">
              <ModelPill sessionId={sessionId} />
            </div>

            <CtxFile activeFile={activeFile ?? null} />
          </div>

          <CtxMeter usage={usage} model={model} liveTokens={liveTokens} />

          {running ? (
            <button className="csend is-running" title="中断当前任务" type="button" onClick={onInterrupt}>
              <IconStop size={13} />
            </button>
          ) : (
            <button className="csend" title="发送" type="button" onClick={send}>
              <IconSend size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
