interface ThinkingProps {
  text: string
}

export function Thinking({ text }: ThinkingProps) {
  return (
    <details className="thinking">
      <summary>
        <span className="chev">▸</span>思考过程
      </summary>
      <div className="tbody">{text}</div>
    </details>
  )
}
