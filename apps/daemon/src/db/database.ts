import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { channelDataDir } from '../paths'
import { initSchema } from './schema'

/** 默认数据库路径：{channelDataDir}/app.sqlite（渠道数据目录见 paths.ts）。 */
export function defaultDbPath(): string {
  return path.join(channelDataDir(), 'app.sqlite')
}

/** 开库 + 建表。path 默认 defaultDbPath()，传 ':memory:' 用于测试。 */
export function openDatabase(dbPath: string = defaultDbPath()): Database.Database {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  }
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')   // 多后台任务读写更稳
  // 暂不开 foreign_keys / 不声明 FK 约束：① 各 repo 需独立单测（插子表不建父行）；
  // ② 删除级联语义（删项目→会话→消息/用量）尚未设计，留到删除流程落地时再加 REFERENCES + ON DELETE。
  initSchema(db)
  return db
}
