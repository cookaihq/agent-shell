/**
 * authBanner.ts — 会话区「未登录」引导 banner 的判定逻辑（纯函数，与渲染解耦便于单测）
 *
 * 动机（spec §1）：当某引擎的活动凭证来源是「本机 CLI 登录」但本机其实没登录时，
 * 引擎拿不到可用凭证，用户发消息会静默失败。此时在会话区顶部显示引导 banner。
 * 若活动来源是 oauth / 官方 key / 某自定义 provider，说明用户已配了替代来源 → 不打扰。
 *
 * 零字面 agent 分支（spec §14.5）：是否显示由切片能力位 `showsUnloggedBanner` 决定
 * （claude=true 有本机登录态实测；codex 缺省 false，登录后置 Part A）——外壳不按引擎字面名硬分支。
 */

import type { Engine, AuthStatusResp } from '../api/types'
import { getSlice } from './agents/registry'

export function shouldShowAuthBanner(
  engine: Engine,
  status: AuthStatusResp | null,
  dismissed: boolean,
): boolean {
  if (!getSlice(engine).showsUnloggedBanner) return false   // 切片不声明该能力（如 codex）→ 不显示
  if (!status) return false                                  // 尚未取到状态 → 先不显示
  if (dismissed) return false                                // 本会话已忽略
  const c = status.engines[engine]
  // 活动来源是本机 CLI 登录、且本机确为未登录 → 引擎无可用凭证，引导去登录
  return c.activeSource === 'cli-login' && c.cliLogin.status === 'signed-out'
}
