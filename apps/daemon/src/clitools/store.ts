import fs from 'node:fs'; import path from 'node:path'
import { CliToolsState, type CustomCliTool } from '@agent-shell/contracts'

/**
 * 自定义工具 + 安装账本的持久化（~/.agent-shell/cli-tools.json）。
 * 存 CliToolsState 的 `custom` 列表（CustomCliTool[]）：既是「用户按路径登记的工具」，
 * 也是「目录工具被 as_cli_install 装后的安装账本」。
 * 旧 `{added}` 结构读到即视为空 `{custom:[]}`（CliToolsState 默认 strip 未知键，天然兼容迁移）。
 */
export interface CliToolStore {
  list: () => CustomCliTool[]
  /** 按 id upsert：已存在则覆盖（保留原 createdAt），否则新增。返回最终落盘的那条。 */
  upsert: (tool: CustomCliTool) => CustomCliTool
  remove: (id: string) => void
}

export function makeCliToolStore(file: string): CliToolStore {
  const readRaw = (): CustomCliTool[] => {
    try {
      // CliToolsState 只认 { custom }，旧 { added } 文件解析后 custom 默认为 []
      return CliToolsState.parse(JSON.parse(fs.readFileSync(file, 'utf8'))).custom
    } catch { return [] }
  }
  const writeRaw = (custom: CustomCliTool[]) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ custom }, null, 2), { mode: 0o600 })
    try { fs.chmodSync(file, 0o600) } catch { /* 既存文件兜底 */ }
  }
  return {
    list: readRaw,
    upsert: (tool) => {
      const cur = readRaw()
      const idx = cur.findIndex((t) => t.id === tool.id)
      if (idx >= 0) {
        // 覆盖但保留原 createdAt（账本「首次安装时间」语义不被后续 upsert 冲掉）
        const merged = { ...tool, createdAt: cur[idx].createdAt }
        cur[idx] = merged
        writeRaw(cur)
        return merged
      }
      writeRaw([...cur, tool])
      return tool
    },
    remove: (id) => writeRaw(readRaw().filter((t) => t.id !== id)),
  }
}
