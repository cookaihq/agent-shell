import type Database from 'better-sqlite3'

/** V1 schema（v1-spec §3）：projects → sessions → messages/usage。Provider 延后，无 provider_id/providers。 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  path        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
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
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  role        TEXT NOT NULL,
  blocks      TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
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
  ensureColumn(db, 'sessions', 'claude_code_version', 'claude_code_version TEXT')
  ensureColumn(db, 'sessions', 'sdk_version', 'sdk_version TEXT')
}
