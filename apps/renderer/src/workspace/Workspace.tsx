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
import { RuntimeContext, useRuntimeReducer } from './runtimeState'
import type { ReactNode } from 'react'
import { AppShell } from '../shell/AppShell'
import { ProjBar } from './ProjBar'
import { ChatHeader } from './ChatHeader'
import { ChatLog } from './ChatLog'
import { Composer } from './Composer'
import { FileWorkspace } from './FileWorkspace'
import type { SessionDTO, UsageDTO } from '../api/types'

interface WorkspaceProps {
  projectId: string
  projectName: string
  sessionId: string
  engine: 'claude' | 'codex'
  model: string
  sessions: SessionDTO[]
  initialMessage?: string
  chrome: ReactNode                          // 顶部页签条（由 AppNav 统一构建，跨 entry/workspace 共用同一份持久状态）
  onSelectSession: (id: string) => void
  onNewSession: () => void
  onBack: () => void
  onNewProject: () => void
  onRename: (name: string) => void           // 改名回传 → AppNav 乐观更新 projects → 页签标题同步
}

export function Workspace(p: WorkspaceProps) {
  const [chat, dispatch] = useReducer(chatReducer, undefined, initialChat)
  const [attached, setAttached] = useState(false)
  const [runtime, rtDispatch] = useRuntimeReducer(p.engine, p.model)
  const { containerRef, handleProps, cols } = useSplitDrag()

  // Task 18：usage 初值（api.usage 加载）+ liveUsage 实时叠加
  const [baseUsage, setBaseUsage] = useState<UsageDTO>({ inputTokens: 0, outputTokens: 0, costUsd: 0 })

  // Task 19/20：文件工作区当前打开文件（FileWorkspace → Composer → CtxFile 联动）
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const handleActiveFile = useCallback((path: string | null) => setActiveFile(path), [])

  // 刷新恢复：进会话时 GET messages + status + usage，loadHistory，然后 attached=true 开 SSE
  useEffect(() => {
    let off = false
    setAttached(false)
    Promise.all([
      api.messages(p.sessionId),
      api.status(p.sessionId),
      api.usage(p.sessionId),
    ]).then(([m, st, u]) => {
      if (off) return
      dispatch({ type: 'loadHistory', messages: m.messages, running: st.running })
      setBaseUsage(u)
      setAttached(true)
    })
    return () => { off = true }
  }, [p.sessionId])

  // SSE 实时增量（attached=true 后才开连接）
  useAgentStream(p.sessionId, (ev) => dispatch({ type: 'event', ev }), attached)

  const running = chat.runStatus === 'running'

  // Task 18：合成 usage = baseUsage + liveUsage（实时叠加，SSE usage 事件更新 liveUsage）
  const usage: UsageDTO = {
    inputTokens:  baseUsage.inputTokens  + (chat.liveUsage?.inputTokens  ?? 0),
    outputTokens: baseUsage.outputTokens + (chat.liveUsage?.outputTokens ?? 0),
    costUsd:      baseUsage.costUsd      + (chat.liveUsage?.costUsd      ?? 0),
  }

  const submit = (text: string) => {
    dispatch({ type: 'optimisticUser', text })
    void api.submit(p.sessionId, text)
  }

  const initialSentRef = useRef(false)
  useEffect(() => {
    if (attached && p.initialMessage && !initialSentRef.current) {
      initialSentRef.current = true
      submit(p.initialMessage)
    }
  }, [attached, p.initialMessage])

  // 继续：和正常发消息走同一套乐观更新——立刻显示「继续」气泡 + 切 running + 清失败提示，按钮不再像死的。
  // POST 失败（404/503/网络）时合成一条 failed turn_end，把真因显示出来并退出「运行中」，不让它空转。
  const resume = () => {
    dispatch({ type: 'optimisticUser', text: '继续' })
    api.resume(p.sessionId, '继续').catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e)
      dispatch({ type: 'event', ev: { type: 'turn_end', stopReason: 'failed', detail: `继续请求失败：${msg}` } })
    })
  }

  return (
    <RuntimeContext.Provider value={{ runtime, dispatch: rtDispatch }}>
      <AppShell chrome={p.chrome}>
        <ProjBar
          projectId={p.projectId}
          projectName={p.projectName}
          engine={p.engine}
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
              activeId={p.sessionId}
              activeRunning={running}
              messageCount={chat.messages.length}
              onSelect={p.onSelectSession}
              onNew={p.onNewSession}
              onResume={(id) => void api.resume(id, '继续')}
              onPin={(id, v) => void api.patchSession(id, { pinned: v })}
              onRename={(id, t) => void api.patchSession(id, { title: t })}
            />
            <ChatLog
              messages={chat.messages}
              liveBlocks={chat.liveBlocks}
              runStatus={chat.runStatus}
              failReason={chat.failReason}
              onResume={resume}
              engine={p.engine}
            />
            {/* Task 15/17/18/20: Composer（发送/停止 + @// 菜单 + 附件 + CtxMeter + CtxFile） */}
            <Composer
              running={running}
              onSubmit={submit}
              onInterrupt={() => { void api.interrupt(p.sessionId) }}
              engine={p.engine}
              model={p.model}
              projectId={p.projectId}
              usage={usage}
              activeFile={activeFile}
            />
          </div>

          {/* 分隔条 */}
          <div className="split-handle" {...handleProps} />

          {/* file workspace 区 — Task 19/20: FileWorkspace（目录树+文件标签+预览） */}
          <FileWorkspace
            projectId={p.projectId}
            onActiveFile={handleActiveFile}
          />
        </div>
      </AppShell>
    </RuntimeContext.Provider>
  )
}
