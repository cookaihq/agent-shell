// 右下角极小版本号角标 —— 构建探测用，见 ../version.ts
// 固定定位、低透明、pointer-events:none，永不遮挡下方 UI 的点击。
import { APP_VERSION } from '../version'

export function VersionBadge() {
  return <div className="version-badge">{APP_VERSION}</div>
}
