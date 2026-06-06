/**
 * Composer.tsx — 工作区输入框（发送/停止 + @// 提及 + 消息附件 + CtxMeter + CtxFile）
 *
 * 消息附件（本设计）：
 *   - 回形针按钮 → 原生选择器 pickPaths 拿绝对路径：图片复制进 <project>/attachments/ 拿相对路径（→ daemon base64 内联 + chip 缩略图）；
 *     非图片维持引用绝对路径不复制（项目外由 daemon 授权读取）
 *   - 粘贴 → 剪贴板字节即时 uploadPaste 写进 <project>/attachments/，引用其相对路径
 *   - 发送 → onSubmit(text, contextFiles)，daemon 对图片内联、非图片拼 preamble 让 agent Read
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
import type { UsageDTO, SlashCommand } from '../api/types'
import type { AgentShellBridge } from '@agent-shell/contracts'

/** 一条已就绪的消息附件：path=喂给 daemon 的 contextFiles 路径（按钮→绝对、粘贴→相对）；name/kind 用于 chip 显示。 */
interface Attachment { name: string; path: string; kind: 'file' | 'dir' }

function basename(p: string): string { return p.split(/[\\/]/).filter(Boolean).pop() ?? p }
/** 选择器只给路径不给类型，按「basename 有无扩展名」粗判 chip 图标（仅显示用；daemon 侧按 stat 精确授权）。 */
function guessKind(p: string): 'file' | 'dir' { return /\.[^./\\]+$/.test(basename(p)) ? 'file' : 'dir' }
const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'])
const isImagePath = (p: string): boolean => IMG_EXT.has(basename(p).toLowerCase().split('.').pop() ?? '')
/** rawUrl 只服务项目内相对路径；回形针选的是绝对路径（项目外引用），不能取缩略图（否则 404 破图）。 */
const isProjectRelative = (p: string): boolean => !p.startsWith('/') && !p.startsWith('~') && !/^[a-zA-Z]:[\\/]/.test(p)

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
  /** SSE 推送的命令清单（commands_changed，P1）：非空即覆盖当前命令源，让正开着的命令列表当场刷新。 */
  liveCommands?: SlashCommand[] | null
}

export function Composer({ running, onSubmit, onInterrupt, engine, model, projectId, sessionId, usage, liveTokens, activeFile, liveCommands }: ComposerProps) {
  const [text, setText] = useState('')
  const composingRef = useRef(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // ── 消息附件 ────────────────────────────────────────────────────────────────────
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const removeAttachment = useCallback((idx: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx))
  }, [])

  // 回形针按钮：原生选择器拿绝对路径（文件/文件夹/多选）。
  // 图片 → 复制进 <project>/attachments/ 拿相对路径（→ daemon 内联 base64 + chip 缩略图生效）；
  // 非图片 → 维持引用绝对路径不复制（项目外由 daemon 授权读取）。
  const pickAttachments = useCallback(async () => {
    const bridge = (globalThis as { agentShell?: AgentShellBridge }).agentShell
    if (!bridge) return
    const paths = await bridge.pickPaths()
    if (paths.length === 0) return
    const resolved = await Promise.all(paths.map(async (p): Promise<Attachment> => {
      if (projectId && isImagePath(p)) {
        try {
          const { imported } = await api.importFiles(projectId, [p], 'attachments')
          const name = imported[0]?.name ?? basename(p)
          return { name, path: `attachments/${name}`, kind: 'file' }   // 相对路径 → 内联 + 缩略图
        } catch { /* 复制失败 → 回落引用绝对路径，不阻塞 */ }
      }
      return { name: basename(p), path: p, kind: guessKind(p) }
    }))
    setAttachments(prev => [...prev, ...resolved])
  }, [projectId])

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

  // 斜杠命令源（/ 面板 + ModelPill 命令区共用）：取数从「mount 一次性」改为「打开 ModelPill / 打『/』时按需取」
  // （避免每次挂载会话都探针 + 触发 SessionStart hook）。双入口：有 sessionId 走会话（四态：活查询实时/会话桶/
  // cwd 探针兜底），无 sessionId 走项目（项目 cwd 探针）——覆盖「空闲会话」+「无会话新项目」。daemon 侧已做 cwd 缓存
  // 与并发去重（首次约 2–3s 探针、二次即时）；这里只做 in-flight 去重防同次重复请求。契约非 null，直接 setCommands。
  const [commands, setCommands] = useState<SlashCommand[]>([])
  const loadingRef = useRef(false)
  const loadCommands = useCallback(() => {
    if (loadingRef.current) return
    if (!sessionId && !projectId) { setCommands([]); return }
    loadingRef.current = true
    const fetcher = sessionId ? api.commands(sessionId) : api.projectCommands(projectId)
    fetcher
      .then(({ commands }) => setCommands(commands))
      .catch(() => setCommands([]))
      .finally(() => { loadingRef.current = false })
  }, [sessionId, projectId])

  // P1：会话中途 commands_changed 经 SSE 推下来（Workspace 截下 → liveCommands prop）→ 覆盖命令源，
  // 让「正开着的 ModelPill 命令区 / 『/』面板」当场刷新，不必关掉重开。非空才覆盖（空推送不抹掉已有）。
  useEffect(() => {
    if (liveCommands && liveCommands.length) setCommands(liveCommands)
  }, [liveCommands])

  // useMention 的 / 分支吃 {name,desc}：把 SlashCommand.description 映射成 desc
  const commandItems = commands.map((c) => ({ name: c.name, desc: c.description }))

  const mention = useMention(filePaths, skillNames, commandItems)

  // 命令区点行：把 /name 填进 textarea 光标处（不直接执行），并同步 React state（对齐原型 insertCommand）
  const insertCommand = useCallback((name: string) => {
    const ta = taRef.current
    if (!ta) return
    const ins = '/' + name + ' '
    const v = ta.value
    const pos = ta.selectionStart ?? v.length
    const newVal = v.slice(0, pos) + ins + v.slice(pos)
    const caret = pos + ins.length
    ta.value = newVal
    ta.setSelectionRange(caret, caret)
    ta.focus()
    setText(newVal)
  }, [])

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
    // 打『/』命令上下文时按需取命令（镜像 useMention 的 / 触发）：即便此刻命令为空、面板未开，也先触发取数，
    // 待 daemon 探针返回后续输入即出命令。daemon 已做 cwd 缓存 + 并发去重，这里 in-flight 去重防同次重复。
    const before = ta.value.slice(0, ta.selectionStart ?? ta.value.length)
    if (/(^|\s)\/[^\s@]*$/.test(before)) loadCommands()
    mention.onInput(ta)
  }

  // 粘贴的图片已上传到 attachments/（相对路径），用 rawUrl 取缩略图（与 ChatLog 已发送附件同款取图）；
  // 回形针选的绝对路径在项目外，rawUrl 取不到 → 不给缩略图，退回文件图标。
  const chips: AttachChip[] = attachments.map(a => ({
    name: a.name,
    kind: a.kind,
    previewUrl: a.kind === 'file' && projectId && isImagePath(a.path) && isProjectRelative(a.path)
      ? api.rawUrl(projectId, a.path)
      : undefined,
  }))

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
              <ModelPill sessionId={sessionId} projectId={projectId} commands={commands} onInsertCommand={insertCommand} onOpenCommands={loadCommands} />
            </div>

            <CtxFile activeFile={activeFile ?? null} />
          </div>

          <CtxMeter usage={usage} model={model} liveTokens={liveTokens} engine={engine} />

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
