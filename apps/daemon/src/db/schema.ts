import type Database from 'better-sqlite3'

/** V1 schema（v1-spec §3）：projects → sessions → usage。对话记录统一写 transcript JSONL，messages 表已移除。Provider 延后，无 provider_id/providers。 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  path           TEXT NOT NULL,
  selected_agent TEXT,
  created_at     INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL,
  engine          TEXT NOT NULL,
  model           TEXT NOT NULL,
  title           TEXT NOT NULL,
  pinned          INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'idle',
  resumable_id    TEXT,
  permission_mode TEXT,
  effort          TEXT,
  codex_sandbox   TEXT,
  codex_approval  TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE TABLE IF NOT EXISTS usage (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id     TEXT NOT NULL,
  turn           INTEGER NOT NULL,
  input_tokens   INTEGER NOT NULL,
  output_tokens  INTEGER NOT NULL,
  cost_usd       REAL,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_session ON usage(session_id);
CREATE TABLE IF NOT EXISTS automation_runtime (
  id          TEXT PRIMARY KEY,      -- = 库内文件夹名（稳定 join key）
  enabled     INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS automation_runs (
  id            TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL,
  trigger       TEXT NOT NULL,
  status        TEXT NOT NULL,
  project_id    TEXT NOT NULL,
  session_id    TEXT,
  started_at    INTEGER NOT NULL,
  completed_at  INTEGER,
  summary       TEXT,
  error         TEXT
);
CREATE INDEX IF NOT EXISTS idx_automation_runs_automation ON automation_runs(automation_id);
CREATE INDEX IF NOT EXISTS idx_automation_runs_session ON automation_runs(session_id);
`

/** 已有库补列（幂等）：CREATE TABLE IF NOT EXISTS 不会给老表加新列，需 ALTER。SQLite 无 ADD COLUMN IF NOT EXISTS，先查 table_info。 */
function ensureColumn(db: Database.Database, table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
}

/** 建表（幂等：全部 IF NOT EXISTS）+ 老库迁移（按需补列）。 */
export function initSchema(db: Database.Database): void {
  db.exec(SCHEMA_SQL)
  // 运行时配置持久化（Issue 13/29）：会话级权限档 / 思考强度。老库无此列时补上。
  ensureColumn(db, 'sessions', 'permission_mode', 'permission_mode TEXT')
  ensureColumn(db, 'sessions', 'effort', 'effort TEXT')
  // codex 两轴权限持久化（Part A P1）：会话级沙箱档 / 审批策略。
  ensureColumn(db, 'sessions', 'codex_sandbox', 'codex_sandbox TEXT')
  ensureColumn(db, 'sessions', 'codex_approval', 'codex_approval TEXT')
  ensureColumn(db, 'sessions', 'claude_code_version', 'claude_code_version TEXT')
  ensureColumn(db, 'sessions', 'sdk_version', 'sdk_version TEXT')
  // 项目级持久化选中 Agent（Part B T1）：新建库已含此列，老库补列。
  ensureColumn(db, 'projects', 'selected_agent', 'selected_agent TEXT')
}
