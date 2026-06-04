/**
 * CommandPreview.tsx — 右侧预览的「运行命令」tab 内容
 *
 * 点击聊天里的运行命令卡 → FileWorkspace 开一个命令 tab（可×关闭）→ 本组件显示完整命令 + 输出。
 * 与卡片里 3 行截断的 IN/OUT 不同，这里不截断、可滚动看全文。
 */

import type { OpenCommand } from './ChatLog'

export function CommandPreview({ cmd }: { cmd: OpenCommand }) {
  return (
    <div className="cmd-preview">
      <div className="cmd-sec">
        <div className="cmd-sec-h"><span className="op-io-tag in">IN</span> {cmd.inLabel ?? '命令'}</div>
        <pre className="cmd-sec-body">{cmd.command}</pre>
      </div>
      <div className="cmd-sec">
        <div className="cmd-sec-h">
          <span className="op-io-tag out">OUT</span> {cmd.outLabel ?? '输出'}
          <span className={`cmd-exit ${cmd.ok ? 'ok' : 'err'}`}>{cmd.ok ? '成功' : '失败'}</span>
        </div>
        <pre className="cmd-sec-body">{cmd.output || '(无输出)'}</pre>
      </div>
    </div>
  )
}
