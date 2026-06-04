/**
 * 应用版本号 —— 构建探测机制（对齐 ai-canvas src/canvas/version.js）
 *
 * 右下角显示一个递增的版本号，用来让开发人员判断「自己打开的 app 是不是代码更新后的最新版本」。
 * 重建后对比这个数字即可确认跑的是不是新构建。
 *
 * ⚠️ 规则：每次任务完成必须把 BUILD_NUMBER +1。详见 agent-shell/CLAUDE.md §版本号。
 */
export const BUILD_NUMBER = 56

/** 展示用版本串：固定基底 v0.0.1 + 递增构建号，如 v0.0.1.1。 */
export const APP_VERSION = `v0.0.1.${BUILD_NUMBER}`
