// 文件扩展名 → 短字形标识（对齐原型 workspace.html L129-130）。
// 文件树（FileTree）与输入框当前文件 chip（CtxFile）共用，保持类型标识视觉一致。
// 常见类型给专属字形，其余兜底大写扩展名（png→PNG、pdf→PDF…），故天然按类型区分。
export function fileTag(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'html' || ext === 'htm') return '</>'
  if (ext === 'css') return '#'
  if (ext === 'md' || ext === 'markdown') return 'M↓'
  if (ext === 'json') return '{ }'
  if (ext === 'ts' || ext === 'tsx') return 'TS'
  if (ext === 'js' || ext === 'jsx') return 'JS'
  return ext.toUpperCase() || '·'
}
