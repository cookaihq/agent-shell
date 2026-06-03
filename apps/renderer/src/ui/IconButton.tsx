import type { ButtonHTMLAttributes } from 'react'

/** 图标按钮变体。modal-close=弹窗右上角关闭。 */
export type IconButtonVariant = 'modal-close'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: IconButtonVariant
}

/**
 * 共享图标按钮（ui/ 组件库种子）。渲染 `<button class="{variant}">`，样式走 base.css。
 * 目前只收口 modal-close（弹窗关闭，4 处重复）。chat-hicon 因混用 <a>/<button> + 作用域 CSS，暂不纳入。
 */
export function IconButton({ variant, type = 'button', className, ...rest }: IconButtonProps) {
  const cls = [variant, className].filter(Boolean).join(' ')
  return <button type={type} className={cls} {...rest} />
}
