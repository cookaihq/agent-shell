/**
 * Workspace.tsx — 项目工作区容器（集成核心）
 *
 * 组合：AppShell + Chrome + ProjBar + ChatHeader + ChatLog + Composer + FileWorkspace
 * 接 daemon API：刷新恢复(Promise.all messages+status) + SSE(useAgentStream) + submit/interrupt/resume
 * 状态：chatReducer(useReducer) + runtimeReducer(useRuntimeReducer) + useSplitDrag
 *
 * Task 15 替换 Composer 占位 → <Composer />
 * Task 18 usage 接线：api.usage 取初值 + chat.liveUsage 实时叠加 → 传 <Composer usage={...} />
 * Task 19/20 替换 FileWorkspace 占位 → <FileWorkspace />，持有 activeFile 状态联动 Composer→CtxFile
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { api } from '../api/client'
import { useAgentStream } from '../hooks/useAgentStream'
import { useSplitDrag } from '../hooks/useSplitDrag'
import { chatReducer, initialChat } from './chatReducer'
import { RuntimeContext, useRuntimeReducer, saveLastRuntime } from './runtimeState'
import type { SessionRuntimeCfg } from './sessionRuntimeSync'
import type { ReactNode } from 'react'
import { AppShell } from '../shell/AppShell'
import { ProjBar } from './ProjBar'
import { ChatHeader } from './ChatHeader'
import { ChatLog, type OpenCommand } from './ChatLog'
import { getSlice } from './agents/registry'
import { Composer } from './Composer'
import { PendingCard } from './PendingCard'
import { FileWorkspace } from './FileWorkspace'
import type { SessionDTO, UsageDTO, Engine, SlashCommand } from '../api/types'

interface WorkspaceProps {
  projectId: string
  projectName: string
  projectPath: string                        // 项目根绝对路径（读取/编辑卡路径精简用，Issue 9）
  sessionId: string
  engine: Engine
  model: string
  sessions: SessionDTO[]
  openSessionIds: string[]                   // 已打开会话 tab 列表（Issue 23）
  initialMessage?: string
  initialContextFiles?: string[]             // 首页带附件发送：随 initialMessage 一起透传（自动提交时带上）
  chrome: ReactNode                          // 顶部页签条（由 AppNav 统一构建，跨 entry/workspace 共用同一份持久状态）
  onSelectSession: (id: string) => void
  onCloseSessionTab: (id: string) => void    // 关闭会话 tab（仅关 tab 不删会话，Issue 23）
  onNewSession: () => void
  onBack: () => void
  onNewProject: () => void
  onRename: (name: string) => void           // 改名回传 → AppNav 乐观更新 projects → 页签标题同步
  onPatchSession: (id: string, patch: { title?: string; pinned?: boolean }) => void  // 会话改名/置顶 → AppNav 乐观回写 sessions → 列表/页签同步
  onRuntimeChange?: (id: string, cfg: SessionRuntimeCfg) => void  // 运行时档位变化 → AppNav 同步 session 快照（切回会话保持档位，不回退）
  onDeleteSession: (id: string) => void      // 真删除会话（连同对话历史，不可恢复）→ AppNav 删库 + 移除 tab/列表 + 处理 active/最后一个边界
}

export function Workspace(p: WorkspaceProps) {
  const [chat, dispatch] = useReducer(chatReducer, undefined, initialChat)
  // 当前会话引擎的切片私有 reducer + 初值（spec §5.4）：外壳透传给 dispatch，自身不解释 sliceState（subagent map 即此）。
  const slice = getSlice(p.engine)
  const [attached, setAttached] = useState(false)
  // Issue 29：打开会话时用该会话存的权限/思考强度回填 runtime（Workspace 按 session.id 重挂，初值即生效）；
  // 无存档（新会话）则由 initialRuntime 回落 localStorage 上次配置（Issue 13）。
  const sess0 = p.sessions.find((s) => s.id === p.sessionId)
  const [runtime, rtDispatch] = useRuntimeReducer(p.engine, p.model, { permissionMode: sess0?.permissionMode, effort: sess0?.effort })
  const { containerRef, handleProps, cols } = useSplitDrag()

  // Task 18：usage 初值（api.usage 加载）+ liveUsage 实时叠加
  // costUsd 初始 undefined：api.usage 的 COALESCE(SUM,0) 对 codex 会话返回 0（无成本数据），
  // 0 与「真正无成本」在 DB 层无法区分；因此 0 视为「无成本数据」→ undefined，
  // 费用行仅当 live usage 事件真实携带 costUsd（claude 会话）时才出现。
  const [baseUsage, setBaseUsage] = useState<UsageDTO>({ inputTokens: 0, outputTokens: 0 })

  // P1：会话中途 SSE 推来的 commands_changed → 实时命令清单（传 Composer 覆盖命令源，正开着的命令区当场刷新）。
  const [liveCommands, setLiveCommands] = useState<SlashCommand[] | null>(null)

  // Task 19/20：文件工作区当前打开文件（FileWorkspace → Composer → CtxFile 联动）
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const handleActiveFile = useCallback((path: string | null) => setActiveFile(path), [])

  // 点击运行命令卡 → 在右侧预览开命令 tab。seq 保证同一命令重复点也触发（FileWorkspace 据 seq 变化响应）。
  const [openCmd, setOpenCmd] = useState<{ cmd: OpenCommand; seq: number } | null>(null)
  const onOpenCommand = useCallback((cmd: OpenCommand) => setOpenCmd((prev) => ({ cmd, seq: (prev?.seq ?? 0) + 1 })), [])

  // 点击用户消息附件 chip → 在右侧预览打开该文件。seq 保证重复点同一文件也触发（仿 openCmd 模式）。
  const [openFileReq, setOpenFileReq] = useState<{ path: string; seq: number } | null>(null)
  const onOpenFile = useCallback((path: string) => setOpenFileReq((prev) => ({ path, seq: (prev?.seq ?? 0) + 1 })), [])

  // 点击 header 头像入口（形态 C）→ 右侧切 agents 视图（形态 B）。seq 保证重复点也触发（仿 openCmd 模式）。
  const [showAgentsReq, setShowAgentsReq] = useState<{ seq: number } | null>(null)
  const onShowAgents = useCallback(() => setShowAgentsReq((prev) => ({ seq: (prev?.seq ?? 0) + 1 })), [])

  // 刷新恢复：进会话时 GET messages + status + usage，loadHistory，然后 attached=true 开 SSE
  useEffect(() => {
    let off = false
    setAttached(false)
    setLiveCommands(null)   // 换会话：清上一会话的实时命令推送（新会话由各自取数 + 后续 commands_changed 填）
    Promise.all([
      api.messages(p.sessionId),
      api.status(p.sessionId),
      api.usage(p.sessionId),
    ]).then(([m, st, u]) => {
      if (off) return
      // §8：daemon 回吐原始 records，由当前会话 engine 的切片 historyService 重建成 MessageDTO[]
      // （历史与实时走同一套切片解析；claude 切片含 msg_id 提取，codex 切片仅共享骨架）。
      const rebuilt = getSlice(p.engine).historyService.rebuildBlocks(m.records)
      dispatch({ type: 'loadHistory', messages: rebuilt, running: st.running, status: st.status, slice: { reduce: slice.reduce, initSliceState: slice.initSliceState } })
      // costUsd=0 来自 COALESCE(SUM,0)，对 codex 会话（无成本数据）与「真正 0 成本」无法区分；
      // 保守处理：0 视为「无成本数据」→ undefined，避免 codex 会话错误显示「≈ $0.00」费用行。
      setBaseUsage({ ...u, costUsd: u.costUsd ? u.costUsd : undefined })
      setAttached(true)
    })
    return () => { off = true }
  }, [p.sessionId, p.engine])

  // SSE 实时增量（attached=true 后才开连接）。slice 透传切片私有 reducer（subagent 等事件累计进 sliceState）。
  // P1：commands_changed 不是聊天内容事件 → 单独截下更新 liveCommands（→ Composer 覆盖命令源），不进 chatReducer。
  useAgentStream(p.sessionId, (ev) => {
    if (ev.type === 'commands_changed') { setLiveCommands(ev.commands); return }
    dispatch({ type: 'event', ev, slice: { reduce: slice.reduce, initSliceState: slice.initSliceState } })
  }, attached, p.engine)

  const running = chat.runStatus === 'running'

  // Task 18：合成 usage = baseUsage + liveUsage（实时叠加，SSE usage 事件更新 liveUsage）
  // Task 1.5：
  //   costUsd：两者皆 undefined → undefined（不渲染费用行）；否则累加有值的那方
  //   contextTokens：取最新 live 值快照（不累加；latest live wins；重载无 live 则 undefined）
  //   contextWindowIsAuthoritative：同 contextTokens，取 live 快照
  const liveCost = chat.liveUsage?.costUsd
  const baseCost = baseUsage.costUsd
  const combinedCostUsd: number | undefined =
    baseCost === undefined && liveCost === undefined
      ? undefined
      : (baseCost ?? 0) + (liveCost ?? 0)
  const usage: UsageDTO = {
    inputTokens:  baseUsage.inputTokens  + (chat.liveUsage?.inputTokens  ?? 0),
    outputTokens: baseUsage.outputTokens + (chat.liveUsage?.outputTokens ?? 0),
    costUsd: combinedCostUsd,
    // 上下文窗口非累计——取最近一轮的权威值（SDKResultMessage.contextWindow）
    contextWindow: chat.liveUsage?.contextWindow,
    // 上下文真实占用快照（含 cache）——取 live 值，不跨轮累加
    contextTokens: chat.liveUsage?.contextTokens,
    contextWindowIsAuthoritative: chat.liveUsage?.contextWindowIsAuthoritative,
  }

  // 中立运行时档位 → daemon：无脑 POST 中立槽，daemon 按 run.kind 自取舍（claude 热切、codex no-op）。
  // 命名映射：renderer 槽 reasoning → daemon 字段 effort（daemon 读 runtime.effort）。
  const runtimePayload = () => ({ permissionMode: runtime.permissionMode, effort: runtime.reasoning, model: runtime.model })

  const submit = (text: string, contextFiles: string[] = []) => {
    // 乐观渲染：带上附件 → 立刻显示 📎 N 个附件（name 取 basename 作预览，权威以落库为准）
    const attachments = contextFiles.map((path) => ({ name: path.split(/[\\/]/).filter(Boolean).pop() ?? path, path }))
    dispatch({ type: 'optimisticUser', text, attachments })
    void api.submit(p.sessionId, text, contextFiles, runtimePayload())
  }

  // 运行中 active 档位变化 → 立即 POST /runtime 中立槽。daemon applyRuntimeConfig 按 run.kind 取舍：
  // claude 活 query 热切（setPermissionMode/applyFlagSettings/setModel）、codex 自然 no-op。外壳不分支引擎。
  useEffect(() => {
    if (!running) return
    void api.setRuntime(p.sessionId, runtimePayload())
  }, [runtime.permissionMode, runtime.reasoning, runtime.model])

  // Issue 13：运行时档位每次变化都缓存到 localStorage，供下个新会话/新项目复用（与 DB 会话级存档互补）
  useEffect(() => { saveLastRuntime(runtime) }, [runtime])

  // 运行时档位变化 → 同步进 AppNav 的 session 快照（model/permissionMode/effort），使切回本会话时
  // Workspace 重挂载从「当前档位」而非「陈旧快照」重初始化（修「切回没保持」）。running/非 running 都覆盖。
  useEffect(() => {
    p.onRuntimeChange?.(p.sessionId, { model: runtime.model, permissionMode: runtime.permissionMode, effort: runtime.reasoning })
  }, [runtime.model, runtime.permissionMode, runtime.reasoning, p.sessionId])

  // 授权/提问回执 → daemon resolve 挂起的 canUseTool；daemon 随后发 permission_resolved 移除卡片
  const onDecision = (body: { requestId: string; behavior: 'allow' | 'deny'; message?: string; updatedInput?: Record<string, unknown> }) => {
    void api.decision(p.sessionId, body)
  }

  const initialSentRef = useRef(false)
  useEffect(() => {
    if (attached && p.initialMessage && !initialSentRef.current) {
      initialSentRef.current = true
      submit(p.initialMessage, p.initialContextFiles)
    }
  }, [attached, p.initialMessage])

  // 继续：和正常发消息走同一套乐观更新——立刻显示「继续」气泡 + 切 running + 清失败提示，按钮不再像死的。
  // POST 失败（404/503/网络）时合成一条 failed turn_end，把真因显示出来并退出「运行中」，不让它空转。
  const resume = () => {
    dispatch({ type: 'optimisticUser', text: '继续' })
    api.resume(p.sessionId, '继续').catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e)
      dispatch({ type: 'event', ev: { type: 'turn_end', stopReason: 'failed', detail: `继续请求失败：${msg}` }, slice: { reduce: slice.reduce, initSliceState: slice.initSliceState } })
    })
  }

  return (
    <RuntimeContext.Provider value={{ runtime, dispatch: rtDispatch }}>
      <AppShell chrome={p.chrome}>
        <ProjBar
          projectId={p.projectId}
          projectName={p.projectName}
          engine={p.engine}
          sessionId={p.sessionId}
          onBack={p.onBack}
          onRename={p.onRename}
        />
        <div
          className="split"
          ref={containerRef}
          style={cols ? { gridTemplateColumns: cols } : undefined}
        >
          {/* chat 区 */}
          <div className="chat">
            <ChatHeader
              sessions={p.sessions}
              openSessionIds={p.openSessionIds}
              activeId={p.sessionId}
              activeRunning={running}
              onSelect={p.onSelectSession}
              onCloseTab={p.onCloseSessionTab}
              onNew={p.onNewSession}
              onResume={(id) => void api.resume(id, '继续')}
              onPin={(id, v) => p.onPatchSession(id, { pinned: v })}
              onRename={(id, t) => p.onPatchSession(id, { title: t })}
              onDelete={(id) => p.onDeleteSession(id)}
              engine={p.engine}
              sliceState={chat.sliceState}
              onShowAgents={onShowAgents}
              projectId={p.projectId}
            />
            <ChatLog
              messages={chat.messages}
              liveBlocks={chat.liveBlocks}
              sliceState={chat.sliceState}
              runStatus={chat.runStatus}
              failReason={chat.failReason}
              liveProgress={chat.liveProgress}
              engine={p.engine}
              onResume={resume}
              onOpenCommand={onOpenCommand}
              onOpenFile={onOpenFile}
              projectRoot={p.projectPath}
              projectId={p.projectId}
              sessionId={p.sessionId}
            />
            {/* SDK 交互回路：聊天内授权卡 / AskUserQuestion 选择卡（挂起时显示，回执后由 daemon 移除） */}
            <PendingCard reqs={chat.pendingRequests} onDecision={onDecision} />
            {/* Task 15/17/18/20: Composer（发送/停止 + @// 菜单 + 附件 + CtxMeter + CtxFile） */}
            <Composer
              running={running}
              onSubmit={submit}
              onInterrupt={() => { void api.interrupt(p.sessionId) }}
              engine={p.engine}
              model={p.model}
              projectId={p.projectId}
              sessionId={p.sessionId}
              usage={usage}
              liveTokens={running ? chat.liveProgress?.tokens : undefined}
              activeFile={activeFile}
              liveCommands={liveCommands}
            />
          </div>

          {/* 分隔条 */}
          <div className="split-handle" {...handleProps} />

          {/* file workspace 区 — Task 19/20: FileWorkspace（目录树+文件标签+预览 + 形态 B subagent 面板） */}
          <FileWorkspace
            projectId={p.projectId}
            onActiveFile={handleActiveFile}
            openCmd={openCmd}
            openFileReq={openFileReq}
            engine={p.engine}
            sliceState={chat.sliceState}
            blocks={[...chat.messages.flatMap((m) => m.blocks), ...(chat.liveBlocks ?? [])]}
            showAgentsReq={showAgentsReq}
            onOpenCommand={onOpenCommand}
            projectRoot={p.projectPath}
          />
        </div>
      </AppShell>
    </RuntimeContext.Provider>
  )
}
