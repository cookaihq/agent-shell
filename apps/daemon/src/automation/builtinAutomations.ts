import fs from 'node:fs'; import path from 'node:path'

/** 把内置自动任务目录里每个含 AUTOMATION.md 的文件夹强制重拷进 automationsDir（随 app 更新）。
 *  只重拷「定义文件」——运行态（enabled/next_run_at）在 DB、不在文件，故用户的启停状态不受影响（幂等）。
 *  缺 builtinDir → no-op。 */
export function materializeBuiltinAutomations(builtinDir: string, automationsDir: string): void {
  if (!builtinDir || !fs.existsSync(builtinDir)) return
  fs.mkdirSync(automationsDir, { recursive: true })
  for (const e of fs.readdirSync(builtinDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const src = path.join(builtinDir, e.name)
    if (!fs.existsSync(path.join(src, 'AUTOMATION.md'))) continue   // 只认含定义的文件夹
    const dest = path.join(automationsDir, e.name)
    fs.cpSync(src, dest, { recursive: true, force: true })          // 强制覆盖定义 + 脚本
  }
}
