interface Todo {
  content: string
  status: 'completed' | 'in_progress' | 'pending' | string
}

interface TodoCardProps {
  todos: Todo[]
}

const todoClass = (status: string): string => {
  if (status === 'completed') return 'todo-item todo-done'
  if (status === 'in_progress') return 'todo-item todo-doing'
  return 'todo-item todo-pending'
}

const todoCheck = (status: string): string => {
  if (status === 'completed') return '✓'
  if (status === 'in_progress') return '▸'
  return '○'
}

export function TodoCard({ todos }: TodoCardProps) {
  const doneCount = todos.filter((t) => t.status === 'completed').length
  const total = todos.length

  return (
    <div className="op-card">
      <div className="op-head">
        <span className="op-icon todo">✓</span>
        <span className="op-title">任务计划</span>
        <span className="op-status running">进行中 {doneCount}/{total}</span>
      </div>
      <ul className="todo-list">
        {todos.map((todo, i) => (
          <li key={i} className={todoClass(todo.status)}>
            <span className="todo-check">{todoCheck(todo.status)}</span>
            <span className="todo-text">{todo.content}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
