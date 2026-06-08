import fs from 'node:fs'; import path from 'node:path'

/** 运行任务前把任务文件夹只读软链进 <project>/automation-assets/<folder>。
 *  让 agent 能读/跑任务自带的脚本/reference；产物写项目工作目录、勿写回（分离原则）。
 *  跨平台：posix 用 'dir'，win32 用 'junction'。幂等：已存在跳过。 */
export function injectAutomationAssets(projectPath: string, automationDir: string, folderName: string): void {
  if (!fs.existsSync(automationDir)) return
  const dest = path.join(projectPath, 'automation-assets')
  fs.mkdirSync(dest, { recursive: true })
  const link = path.join(dest, folderName)
  if (fs.existsSync(link)) return
  const linkType = process.platform === 'win32' ? 'junction' : 'dir'
  fs.symlinkSync(automationDir, link, linkType)
}
