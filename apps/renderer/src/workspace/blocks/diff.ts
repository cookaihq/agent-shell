export function buildDiff(oldStr: string, newStr: string): { del: string[]; add: string[] } {
  return {
    del: oldStr ? oldStr.split('\n') : [],
    add: newStr ? newStr.split('\n') : [],
  }
}
