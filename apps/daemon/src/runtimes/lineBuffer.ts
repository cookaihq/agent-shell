/** 每进程一个：把分块到达的 stdout 切成完整行；末尾不完整片段留住，待补齐或收尾 flush。 */
export class LineBuffer {
  private buf = ''

  /** 喂入一块文本，返回其中所有【完整行】（不含换行符）；末尾残片留在内部。 */
  push(chunk: string): string[] {
    this.buf += chunk
    const lines: string[] = []
    let i: number
    while ((i = this.buf.indexOf('\n')) >= 0) {
      lines.push(this.buf.slice(0, i))
      this.buf = this.buf.slice(i + 1)
    }
    return lines
  }

  /** 流结束时调用：吐出残留的最后一行（无末尾换行的那行）；空则返回 []。 */
  flush(): string[] {
    const rest = this.buf
    this.buf = ''
    return rest ? [rest] : []
  }
}
