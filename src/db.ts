import { generateId } from './utils/crypto.ts';
import { generateUsername } from './utils/username.ts';

// ─── Unified DB Adapter ───────────────────────────────────────────────────────
// Provides a common interface over SQLite (local) and Postgres (production).
// All methods return Promises so callers must await them.

export interface DbAdapter {
  get(sql: string, ...params: any[]): Promise<any>;
  all(sql: string, ...params: any[]): Promise<any[]>;
  run(sql: string, ...params: any[]): Promise<void>;
  exec(sql: string): Promise<void>;
}

let _adapter: DbAdapter | null = null;

export function getDb(): DbAdapter {
  if (!_adapter) throw new Error('DB not initialised — call initDb() first');
  return _adapter;
}

// ─── SQLite adapter ───────────────────────────────────────────────────────────

function makeSqliteAdapter(path: string): DbAdapter {
  const { Database } = require('bun:sqlite') as typeof import('bun:sqlite');
  const db = new Database(path, { create: true });
  db.exec('PRAGMA journal_mode = DELETE;');
  db.exec('PRAGMA foreign_keys = ON;');

  return {
    async get(sql, ...params) { return db.query(sql).get(...params) ?? null; },
    async all(sql, ...params) { return db.query(sql).all(...params); },
    async run(sql, ...params) { db.query(sql).run(...params); },
    async exec(sql) { db.exec(sql); },
  };
}

// ─── Postgres adapter ─────────────────────────────────────────────────────────

async function makePgAdapter(url: string): Promise<DbAdapter> {
  const postgres = (await import('postgres')).default;
  const sql = postgres(url, { max: 10 });

  // Convert ? placeholders to $1, $2, ... (postgres style)
  function toPositional(query: string): string {
    let i = 0;
    return query.replace(/\?/g, () => `$${++i}`);
  }

  return {
    async get(query, ...params) {
      const rows = await sql.unsafe(toPositional(query), params);
      return rows[0] ?? null;
    },
    async all(query, ...params) {
      return await sql.unsafe(toPositional(query), params) as any[];
    },
    async run(query, ...params) {
      await sql.unsafe(toPositional(query), params);
    },
    async exec(query) {
      await sql.unsafe(query);
    },
  };
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function initDb(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl) {
    console.log('🐘  Using Postgres');
    _adapter = await makePgAdapter(databaseUrl);
    await createSchema(_adapter, 'postgres');
  } else {
    const isProd = process.env.NODE_ENV === 'production';
    const defaultPath = isProd ? '/data/taskmanager.db' : './taskmanager.db';
    const path = process.env.DATABASE_PATH ?? defaultPath;
    console.log(`🗄️   Using SQLite: ${path}`);
    _adapter = makeSqliteAdapter(path);
    await createSchema(_adapter, 'sqlite');
  }

  await seedSuperadmin(_adapter);
}

// ─── Schema ───────────────────────────────────────────────────────────────────

async function createSchema(db: DbAdapter, dialect: 'sqlite' | 'postgres'): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id                               TEXT PRIMARY KEY,
      name                             TEXT NOT NULL,
      email                            TEXT,
      username                         TEXT UNIQUE NOT NULL,
      password_hash                    TEXT NOT NULL,
      role                             TEXT NOT NULL DEFAULT 'member',
      confirmed                        INTEGER NOT NULL DEFAULT 1,
      disabled                         INTEGER NOT NULL DEFAULT 0,
      created_by                       TEXT REFERENCES users(id),
      credential_view_token            TEXT,
      credential_view_token_expires_at TEXT,
      created_at                       TEXT NOT NULL,
      updated_at                       TEXT NOT NULL
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      created_by  TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS project_members (
      project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id     TEXT NOT NULL REFERENCES users(id),
      role        TEXT NOT NULL DEFAULT 'member',
      assigned_at TEXT NOT NULL,
      PRIMARY KEY (project_id, user_id)
    )
  `);

  await db.exec(`
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
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS task_comments (
      id         TEXT PRIMARY KEY,
      task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      content    TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS task_dependencies (
      task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      blocked_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, blocked_task_id)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      access_token  TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id),
      refresh_token TEXT NOT NULL UNIQUE,
      agent_label   TEXT,
      last_used_at  TEXT,
      expires_at    TEXT NOT NULL,
      scope         TEXT NOT NULL DEFAULT 'read write'
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS auth_codes (
      code           TEXT PRIMARY KEY,
      user_id        TEXT NOT NULL REFERENCES users(id),
      code_challenge TEXT NOT NULL,
      expires_at     TEXT NOT NULL,
      used           INTEGER NOT NULL DEFAULT 0
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_sessions (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id            TEXT PRIMARY KEY,
      user_id       TEXT REFERENCES users(id),
      agent_label   TEXT,
      tool_name     TEXT NOT NULL,
      input_summary TEXT,
      success       INTEGER NOT NULL DEFAULT 1,
      error_msg     TEXT,
      created_at    TEXT NOT NULL
    )
  `);

  // 500-row cap trigger (dialect-specific syntax)
  if (dialect === 'sqlite') {
    await db.exec(`
      CREATE TRIGGER IF NOT EXISTS activity_log_cap
      AFTER INSERT ON activity_log
      BEGIN
        DELETE FROM activity_log
        WHERE id IN (
          SELECT id FROM activity_log
          ORDER BY created_at ASC
          LIMIT MAX(0, (SELECT COUNT(*) FROM activity_log) - 500)
        );
      END
    `);
  } else {
    await db.exec(`
      CREATE OR REPLACE FUNCTION trim_activity_log() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        DELETE FROM activity_log
        WHERE id IN (
          SELECT id FROM activity_log
          ORDER BY created_at ASC
          OFFSET 500
        );
        RETURN NULL;
      END;
      $$
    `);
    await db.exec(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger WHERE tgname = 'activity_log_cap'
        ) THEN
          CREATE TRIGGER activity_log_cap
          AFTER INSERT ON activity_log
          FOR EACH STATEMENT EXECUTE FUNCTION trim_activity_log();
        END IF;
      END $$
    `);
  }
}

// ─── Superadmin seed ──────────────────────────────────────────────────────────

async function seedSuperadmin(db: DbAdapter): Promise<void> {
  const email = process.env.SUPERADMIN_EMAIL;
  const initialPassword = process.env.SUPERADMIN_INITIAL_PASSWORD;
  if (!email || !initialPassword) return;

  const existing = await db.get('SELECT id FROM users WHERE email = ?', email);
  if (existing) return;

  const username = await uniqueUsername(db);
  const hash = await Bun.password.hash(initialPassword, { algorithm: 'argon2id' });
  const now = new Date().toISOString();
  const id = generateId();

  await db.run(
    `INSERT INTO users (id, name, email, username, password_hash, role, confirmed, disabled, created_at, updated_at)
     VALUES (?, 'Superadmin', ?, ?, ?, 'admin', 1, 0, ?, ?)`,
    id, email, username, hash, now, now,
  );

  console.log('⚠️  Superadmin created — change your password immediately.');
  console.log(`👤  Superadmin username: ${username}`);
  console.log(`🔑  Superadmin password: ${initialPassword}`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export async function uniqueUsername(db: DbAdapter): Promise<string> {
  while (true) {
    const username = generateUsername();
    const existing = await db.get('SELECT id FROM users WHERE username = ?', username);
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
  db.run(
    `INSERT INTO activity_log (id, user_id, agent_label, tool_name, input_summary, success, error_msg, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    generateId(),
    opts.user_id,
    opts.agent_label,
    opts.tool_name,
    opts.input_summary ?? null,
    opts.success ? 1 : 0,
    opts.error_msg ?? null,
    now,
  ).catch(() => {}); // fire and forget
}
