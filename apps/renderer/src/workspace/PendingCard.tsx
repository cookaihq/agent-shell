/**
 * PendingCard.tsx — SDK 交互回路的聊天内卡片
 *
 * 两类（来自 daemon 的 permission_request / ask_user_question 事件，挂在 chat.pendingRequests）：
 *  - 授权卡：toolName + input 摘要 + 同意/拒绝 → POST /sessions/:id/decision
 *  - AskUserQuestion 选择卡：多问题 × 多选项 chips，选完回填 → decision(allow, updatedInput)
 * 用户操作后 daemon 发 permission_resolved 移除卡片；中断/超时也会移除（防悬挂）。
 */

import { useState } from 'react'
import type { PendingRequest } from './chatReducer'

interface PendingCardProps {
  reqs: PendingRequest[]
  onDecision: (body: { requestId: string; behavior: 'allow' | 'deny'; message?: string; updatedInput?: Record<string, unknown> }) => void
}

/** 从工具 input 里挑一个最有信息量的摘要（文件路径 / 命令）。 */
function inputSummary(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const o = input as Record<string, unknown>
  const v = o.file_path ?? o.path ?? o.command ?? o.pattern ?? o.url
  return typeof v === 'string' ? v : ''
}

export function PendingCard({ reqs, onDecision }: PendingCardProps) {
  if (reqs.length === 0) return null
  return (
    <div className="pending-cards">
      {reqs.map((r) =>
        r.kind === 'permission'
          ? <PermissionCard key={r.requestId} req={r} onDecision={onDecision} />
          : <QuestionCard key={r.requestId} req={r} onDecision={onDecision} />,
      )}
    </div>
  )
}

function PermissionCard({ req, onDecision }: { req: Extract<PendingRequest, { kind: 'permission' }>; onDecision: PendingCardProps['onDecision'] }) {
  const summary = inputSummary(req.input)
  const title = req.title ?? `Claude 想使用 ${req.displayName ?? req.toolName}`
  return (
    <div className="perm-card">
      <div className="perm-card-h">
        <span className="perm-card-icon" aria-hidden>🔐</span>
        <span className="perm-card-title">{title}</span>
      </div>
      {summary && <div className="perm-card-target" title={summary}>{summary}</div>}
      {req.description && <div className="perm-card-desc">{req.description}</div>}
      <div className="perm-card-actions">
        <button type="button" className="btn btn-ghost" onClick={() => onDecision({ requestId: req.requestId, behavior: 'deny', message: '用户拒绝' })}>拒绝</button>
        <button type="button" className="btn btn-primary" onClick={() => onDecision({ requestId: req.requestId, behavior: 'allow' })}>同意</button>
      </div>
    </div>
  )
}

function QuestionCard({ req, onDecision }: { req: Extract<PendingRequest, { kind: 'question' }>; onDecision: PendingCardProps['onDecision'] }) {
  // 每个问题选中的 label 集合（multiSelect 多选，否则单选）
  const [picked, setPicked] = useState<Record<number, string[]>>({})

  const toggle = (qi: number, label: string, multi: boolean) => {
    setPicked((prev) => {
      const cur = prev[qi] ?? []
      if (multi) {
        return { ...prev, [qi]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label] }
      }
      return { ...prev, [qi]: [label] }
    })
  }

  const allAnswered = req.questions.every((_, qi) => (picked[qi]?.length ?? 0) > 0)

  const submit = () => {
    // 回填工具入参：answers 为「问题文本 → 选中标签串（多选逗号分隔）」的 map（对齐 SDK AskUserQuestionOutput.answers）；
    // daemon 会把它合并进原 input（保留 questions），工具据此产出结果。
    const answers: Record<string, string> = {}
    req.questions.forEach((q, qi) => { answers[q.question] = (picked[qi] ?? []).join(', ') })
    onDecision({ requestId: req.requestId, behavior: 'allow', updatedInput: { answers } })
  }

  // 关闭（Issue 7）：当作用户拒绝/跳过本次提问回执给 daemon（deny + 提示语），让模型自行决定后续而非悬挂。
  const close = () => onDecision({ requestId: req.requestId, behavior: 'deny', message: '用户关闭了选择（跳过本次提问）' })

  return (
    <div className="ask-card">
      {/* 头部：关闭图标（Issue 7） */}
      <div className="ask-card-head">
        <button type="button" className="ask-close" title="关闭并跳过此提问" onClick={close}>✕</button>
      </div>
      {/* 中间问题区限高、内部滚动（Issue 8）：提交按钮留在滚动容器外固定可见 */}
      <div className="ask-q-scroll">
        {req.questions.map((q, qi) => (
          <div key={qi} className="ask-q">
            {q.header && <div className="ask-q-header">{q.header}</div>}
            <div className="ask-q-text">{q.question}</div>
            <div className="ask-q-opts">
              {q.options.map((opt) => {
                const sel = (picked[qi] ?? []).includes(opt.label)
                return (
                  <button
                    key={opt.label}
                    type="button"
                    className={`ask-chip${sel ? ' is-active' : ''}`}
                    title={opt.description}
                    onClick={() => toggle(qi, opt.label, !!q.multiSelect)}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="perm-card-actions">
        <button type="button" className="btn btn-primary" disabled={!allAnswered} onClick={submit}>提交</button>
      </div>
    </div>
  )
}
