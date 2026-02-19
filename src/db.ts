import { Database } from 'bun:sqlite';
import { generateId } from './utils/crypto.ts';
import { generateUsername, generatePassword } from './utils/username.ts';

let _db: Database;

export function getDb(): Database {
  if (!_db) {
    _db = new Database(process.env.DATABASE_PATH ?? './taskmanager.db', { create: true });
    _db.exec('PRAGMA journal_mode = WAL;');
    _db.exec('PRAGMA foreign_keys = ON;');
  }
  return _db;
}

export async function initDb(): Promise<void> {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id                              TEXT PRIMARY KEY,
      name                            TEXT NOT NULL,
      email                           TEXT,
      username                        TEXT UNIQUE NOT NULL,
      password_hash                   TEXT NOT NULL,
      role                            TEXT NOT NULL DEFAULT 'member',
      confirmed                       INTEGER NOT NULL DEFAULT 1,
      disabled                        INTEGER NOT NULL DEFAULT 0,
      created_by                      TEXT REFERENCES users(id),
      credential_view_token           TEXT,
      credential_view_token_expires_at TEXT,
      created_at                      TEXT NOT NULL,
      updated_at                      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      created_by  TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_members (
      project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id     TEXT NOT NULL REFERENCES users(id),
      role        TEXT NOT NULL DEFAULT 'member',
      assigned_at TEXT NOT NULL,
      PRIMARY KEY (project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id           TEXT PRIMARY KEY,
      project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title        TEXT NOT NULL,
      description  TEXT,
      status       TEXT NOT NULL DEFAULT 'pending',
      priority     TEXT NOT NULL DEFAULT 'medium',
      assigned_to  TEXT REFERENCES users(id),
      created_by   TEXT NOT NULL,
      due_date     TEXT,
      completed_at TEXT,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_comments (
      id         TEXT PRIMARY KEY,
      task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      content    TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_dependencies (
      task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      blocked_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, blocked_task_id)
    );

    CREATE TABLE IF NOT EXISTS oauth_tokens (
      access_token  TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id),
      refresh_token TEXT NOT NULL UNIQUE,
      agent_label   TEXT,
      last_used_at  TEXT,
      expires_at    TEXT NOT NULL,
      scope         TEXT NOT NULL DEFAULT 'read write'
    );

    CREATE TABLE IF NOT EXISTS auth_codes (
      code           TEXT PRIMARY KEY,
      user_id        TEXT NOT NULL REFERENCES users(id),
      code_challenge TEXT NOT NULL,
      expires_at     TEXT NOT NULL,
      used           INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id            TEXT PRIMARY KEY,
      user_id       TEXT REFERENCES users(id),
      agent_label   TEXT,
      tool_name     TEXT NOT NULL,
      input_summary TEXT,
      success       INTEGER NOT NULL DEFAULT 1,
      error_msg     TEXT,
      created_at    TEXT NOT NULL
    );
  `);

  // 500-entry cap trigger
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS activity_log_cap
    AFTER INSERT ON activity_log
    BEGIN
      DELETE FROM activity_log
      WHERE id IN (
        SELECT id FROM activity_log
        ORDER BY created_at ASC
        LIMIT MAX(0, (SELECT COUNT(*) FROM activity_log) - 500)
      );
    END;
  `);

  await seedSuperadmin(db);
}

async function seedSuperadmin(db: Database): Promise<void> {
  const email = process.env.SUPERADMIN_EMAIL;
  const initialPassword = process.env.SUPERADMIN_INITIAL_PASSWORD;

  if (!email || !initialPassword) return;

  const existing = db.query('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return;

  const username = await uniqueUsername(db);
  const hash = await Bun.password.hash(initialPassword, { algorithm: 'argon2id' });
  const now = new Date().toISOString();
  const id = generateId();

  db.query(`
    INSERT INTO users (id, name, email, username, password_hash, role, confirmed, disabled, created_at, updated_at)
    VALUES (?, 'Superadmin', ?, ?, ?, 'admin', 1, 0, ?, ?)
  `).run(id, email, username, hash, now, now);

  console.log('⚠️  Superadmin created — change your password immediately.');
  console.log(`👤  Superadmin username: ${username}`);
  console.log(`🔑  Superadmin password: ${initialPassword}`);
}

export async function uniqueUsername(db: Database): Promise<string> {
  while (true) {
    const username = generateUsername();
    const existing = db.query('SELECT id FROM users WHERE username = ?').get(username);
    if (!existing) return username;
  }
}

export function logActivity(opts: {
  user_id: string | null;
  agent_label: string | null;
  tool_name: string;
  input_summary?: string;
  success: boolean;
  error_msg?: string;
}): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.query(`
    INSERT INTO activity_log (id, user_id, agent_label, tool_name, input_summary, success, error_msg, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    generateId(),
    opts.user_id,
    opts.agent_label,
    opts.tool_name,
    opts.input_summary ?? null,
    opts.success ? 1 : 0,
    opts.error_msg ?? null,
    now,
  );
}
