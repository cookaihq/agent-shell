import type { ButtonHTMLAttributes } from 'react'

/** 主/次操作按钮变体——对应 base.css 的 .btn.btn-primary / .btn.btn-ghost。 */
export type ButtonVariant = 'primary' | 'ghost'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

/**
 * 共享操作按钮（ui/ 组件库种子）。渲染 `<button class="btn btn-{variant}">`，
 * 等价于原先散落各处的 `<button className="btn btn-primary">`——样式仍走 base.css。
 * 收益：默认 type="button"（防误触发表单提交）、变体类型安全、未来改样式单点。
 */
export function Button({ variant = 'primary', type = 'button', className, ...rest }: ButtonProps) {
  const cls = ['btn', `btn-${variant}`, className].filter(Boolean).join(' ')
  return <button type={type} className={cls} {...rest} />
}
