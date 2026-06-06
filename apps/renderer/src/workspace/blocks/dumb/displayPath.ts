/** 路径显示精简（Issue 9）：项目内→相对路径；项目外→~/… 或原样绝对路径。完整路径仍在 title。 */
export function displayPath(filePath: string, projectRoot?: string): string {
  if (!filePath || !projectRoot) return filePath
  const root = projectRoot.replace(/\/+$/, '')
  if (filePath === root) return '.'
  if (filePath.startsWith(root + '/')) return filePath.slice(root.length + 1)
  const home = root.match(/^(\/Users\/[^/]+|\/home\/[^/]+|\/root)(?=\/)/)?.[1]
  if (home && filePath.startsWith(home + '/')) return '~' + filePath.slice(home.length)
  return filePath
}
