#!/usr/bin/env node
// 全局 skill 处理（mock 占位）——后续实现：扫全局 skill 目录、算每个 skill 内容 hash、
// 与上次记录比对、把变更写进 daemon 的全局 skill 注册表（见 2026-06-08 设计 §10）。
// 当前仅打印一行并 exit 0，证明 executor:script 管道贯通（stdout/exit code 记进 automation_runs）。
console.log('[global-skill-processing] mock run: scan skipped (stub), exit 0')
process.exit(0)
