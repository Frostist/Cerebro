/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { adminAuth } from './middleware.ts';
import { getDb, uniqueUsername, logActivity } from '../db.ts';
import { generateId, generateToken, generateViewToken, encryptFlash, decryptFlash } from '../utils/crypto.ts';
import { generatePassword } from '../utils/username.ts';
import { LoginPage } from './views/login.tsx';
import { DashboardPage } from './views/dashboard.tsx';
import { UsersListPage } from './views/users/list.tsx';
import { NewUserPage } from './views/users/new.tsx';
import { UserDetailPage } from './views/users/detail.tsx';
import { CredentialsPage } from './views/users/credentials.tsx';
import { ProjectsListPage } from './views/projects/list.tsx';
import { ProjectDetailPage } from './views/projects/detail.tsx';
import { ActivityPage } from './views/activity.tsx';
import { SettingsPage } from './views/settings.tsx';
import type { User } from '../types.ts';

type Vars = { user: User; isSuperadmin: boolean; csrfToken: string };
export const adminRouter = new Hono<{ Variables: Vars }>();

// ─── Helpers ────────────────────────────────────────────────────────────────

async function verifyCsrf(c: any): Promise<boolean> {
  const body = await c.req.parseBody();
  const sessionToken = c.get('csrfToken') as string;
  return !!sessionToken && body['_csrf'] === sessionToken;
}

function getFlash(c: any): { type: 'success' | 'error'; message: string } | null {
  const raw = getCookie(c, 'flash');
  if (!raw) return null;
  deleteCookie(c, 'flash');
  try {
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf-8')) as any;
  } catch {
    return null;
  }
}

function setFlash(c: any, type: 'success' | 'error', message: string) {
  const val = Buffer.from(JSON.stringify({ type, message })).toString('base64url');
  setCookie(c, 'flash', val, { httpOnly: true, sameSite: 'Strict', maxAge: 30, path: '/' });
}

function requireFlashSecret(): string {
  const secret = process.env.FLASH_SECRET;
  if (!secret) throw new Error('FLASH_SECRET environment variable is not set');
  return secret;
}

async function getFlashPassword(c: any): Promise<string | null> {
  const raw = getCookie(c, 'flash_pw');
  if (!raw) return null;
  deleteCookie(c, 'flash_pw');
  return decryptFlash(raw, requireFlashSecret());
}

async function setFlashPassword(c: any, password: string) {
  const encrypted = await encryptFlash(password, requireFlashSecret());
  setCookie(c, 'flash_pw', encrypted, { httpOnly: true, sameSite: 'Strict', maxAge: 300, path: '/' });
}

// ─── Login / Logout ─────────────────────────────────────────────────────────

adminRouter.get('/admin/login', async (c) => {
  const isProd = process.env.NODE_ENV === 'production';
  let devHint = null;
  if (!isProd) {
    const db = getDb();
    const superadmin = await db.get(
      'SELECT username FROM users WHERE email = ? AND disabled = 0',
      process.env.SUPERADMIN_EMAIL ?? ''
    ) as any;
    if (superadmin) {
      devHint = { username: superadmin.username, password: process.env.SUPERADMIN_INITIAL_PASSWORD ?? '' };
    }
  }
  return c.html(<LoginPage devHint={devHint} />);
});

adminRouter.post('/admin/login', async (c) => {
  const body = await c.req.parseBody();
  const { username, password } = body as Record<string, string>;
  const db = getDb();
  const user = await db.get('SELECT * FROM users WHERE username = ? AND disabled = 0 AND confirmed = 1', username) as any;

  if (!user || !(await Bun.password.verify(password, user.password_hash))) {
    return c.html(<LoginPage error="Invalid username or password." />, 401);
  }

  const sessionId = generateId();
  const csrfToken = generateToken();
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  await db.run('INSERT INTO admin_sessions (id, user_id, csrf_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)', sessionId, user.id, csrfToken, expiresAt, now);

  const secure = (process.env.BASE_URL ?? '').startsWith('https');
  setCookie(c, 'session', sessionId, { httpOnly: true, secure, sameSite: 'Strict', maxAge: 8 * 3600, path: '/' });
  return c.redirect('/admin');
});

adminRouter.post('/admin/logout', async (c) => {
  // Logout doesn't go through adminAuth so we verify the session directly
  const sessionId = getCookie(c, 'session');
  if (sessionId) {
    const db = getDb();
    const body = await c.req.parseBody();
    const session = await db.get('SELECT csrf_token FROM admin_sessions WHERE id = ?', sessionId) as any;
    if (!session || !session.csrf_token || body['_csrf'] !== session.csrf_token) {
      return c.text('Invalid CSRF token', 403);
    }
    await db.run('DELETE FROM admin_sessions WHERE id = ?', sessionId);
  }
  deleteCookie(c, 'session');
  return c.redirect('/admin/login');
});

// ─── Protected routes ────────────────────────────────────────────────────────

adminRouter.use('/admin/*', adminAuth);

// Dashboard
adminRouter.get('/admin', async (c) => {
  const user = c.get('user') as any;
  const isSuperadmin = c.get('isSuperadmin') as boolean;
  const flash = getFlash(c);
  const db = getDb();
  const now = new Date().toISOString();
  const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const stats = {
    totalUsers: ((await db.get("SELECT COUNT(*) as n FROM users WHERE confirmed=1 AND disabled=0")) as any).n,
    totalProjects: ((await db.get("SELECT COUNT(*) as n FROM projects")) as any).n,
    totalTasks: ((await db.get("SELECT COUNT(*) as n FROM tasks")) as any).n,
    pendingTasks: ((await db.get("SELECT COUNT(*) as n FROM tasks WHERE status='pending'")) as any).n,
    inProgressTasks: ((await db.get("SELECT COUNT(*) as n FROM tasks WHERE status='in_progress'")) as any).n,
    overdueTasks: ((await db.get("SELECT COUNT(*) as n FROM tasks WHERE due_date < ? AND status NOT IN ('completed','cancelled')", now)) as any).n,
    dueSoonTasks: ((await db.get("SELECT COUNT(*) as n FROM tasks WHERE due_date >= ? AND due_date <= ? AND status NOT IN ('completed','cancelled')", now, in24h)) as any).n,
  };
  const recentActivity = await db.all('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 10');

  return c.html(<DashboardPage user={user} isSuperadmin={isSuperadmin} flash={flash} stats={stats} recentActivity={recentActivity} />);
});

// ─── Users ───────────────────────────────────────────────────────────────────

adminRouter.get('/admin/users', async (c) => {
  const user = c.get('user') as any;
  const isSuperadmin = c.get('isSuperadmin') as boolean;
  const flash = getFlash(c);
  const q = c.req.query('q') ?? '';
  const db = getDb();
  const users = q
    ? await db.all("SELECT * FROM users WHERE username LIKE ? OR name LIKE ? ORDER BY created_at DESC", `%${q}%`, `%${q}%`)
    : await db.all("SELECT * FROM users ORDER BY created_at DESC");
  return c.html(<UsersListPage user={user} isSuperadmin={isSuperadmin} flash={flash} users={users} filter={q} />);
});

adminRouter.get('/admin/users/new', (c) => {
  const user = c.get('user') as any;
  const isSuperadmin = c.get('isSuperadmin') as boolean;
  const csrfToken = c.get('csrfToken') as string;
  return c.html(<NewUserPage user={user} isSuperadmin={isSuperadmin} csrfToken={csrfToken} />);
});

adminRouter.post('/admin/users', async (c) => {
  if (!await verifyCsrf(c)) return c.text('Invalid CSRF token', 403);
  const user = c.get('user') as any;
  const isSuperadmin = c.get('isSuperadmin') as boolean;
  const body = await c.req.parseBody();
  const { name, email } = body as Record<string, string>;

  if (!name?.trim()) {
    return c.html(<NewUserPage user={user} isSuperadmin={isSuperadmin} error="Name is required." />, 400);
  }

  const db = getDb();
  const username = await uniqueUsername(db);
  const password = generatePassword();
  const hash = await Bun.password.hash(password, { algorithm: 'argon2id' });
  const id = generateId();
  const now = new Date().toISOString();
  const viewToken = generateViewToken();
  const viewTokenExpiry = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  await db.run(`
    INSERT INTO users (id, name, email, username, password_hash, role, confirmed, disabled, created_by, credential_view_token, credential_view_token_expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'member', 1, 0, ?, ?, ?, ?, ?)
  `, id, name.trim(), email?.trim() || null, username, hash, user.id, viewToken, viewTokenExpiry, now, now);

  await setFlashPassword(c, password);
  logActivity({ user_id: user.id, agent_label: null, tool_name: 'admin:create_user', success: true, input_summary: `name=${name}` });
  return c.redirect(`/admin/users/${id}/credentials?token=${viewToken}`);
});

adminRouter.get('/admin/users/:id', async (c) => {
  const user = c.get('user') as any;
  const isSuperadmin = c.get('isSuperadmin') as boolean;
  const flash = getFlash(c);
  const db = getDb();
  const subject = await db.get('SELECT * FROM users WHERE id = ?', c.req.param('id'));
  if (!subject) return c.text('Not found', 404);
  const token = await db.get('SELECT * FROM oauth_tokens WHERE user_id = ?', (subject as any).id);
  const csrfToken = c.get('csrfToken') as string;
  return c.html(<UserDetailPage user={user} isSuperadmin={isSuperadmin} flash={flash} subject={subject} token={token} csrfToken={csrfToken} />);
});

adminRouter.get('/admin/users/:id/credentials', async (c) => {
  const db = getDb();
  const subject = await db.get('SELECT * FROM users WHERE id = ?', c.req.param('id')) as any;
  if (!subject) return c.text('Not found', 404);

  const token = c.req.query('token');
  const now = new Date().toISOString();
  if (!token || subject.credential_view_token !== token || subject.credential_view_token_expires_at < now) {
    return c.html('<h1>This credential link has expired or is invalid.</h1><p><a href="/admin/users">Back to users</a></p>', 410);
  }

  // Mark token used
  await db.run('UPDATE users SET credential_view_token = NULL, credential_view_token_expires_at = NULL WHERE id = ?', subject.id);

  const password = await getFlashPassword(c);
  if (!password) {
    return c.html('<h1>Credentials unavailable.</h1><p>The password could not be retrieved. Use superadmin → Regenerate Credentials to issue new ones.</p><p><a href="/admin/users">Back</a></p>', 410);
  }

  const base = process.env.BASE_URL ?? '';
  const mcpUrl = `${base}/mcp/sse`;

  return c.html(<CredentialsPage username={subject.username} password={password} mcpUrl={mcpUrl} />);
});

// User action routes
adminRouter.post('/admin/users/:id/confirm', async (c) => {
  if (!await verifyCsrf(c)) return c.text('Invalid CSRF token', 403);
  const db = getDb();
  await db.run('UPDATE users SET confirmed = 1, updated_at = ? WHERE id = ?', new Date().toISOString(), c.req.param('id'));
  setFlash(c, 'success', 'User confirmed.');
  return c.redirect(`/admin/users/${c.req.param('id')}`);
});

adminRouter.post('/admin/users/:id/disable', async (c) => {
  if (!await verifyCsrf(c)) return c.text('Invalid CSRF token', 403);
  const user = c.get('user') as any;
  const isSuperadmin = c.get('isSuperadmin') as boolean;
  const db = getDb();
  const subject = await db.get('SELECT * FROM users WHERE id = ?', c.req.param('id')) as any;
  if (!subject) return c.text('Not found', 404);
  if (subject.email === process.env.SUPERADMIN_EMAIL) {
    setFlash(c, 'error', 'Cannot disable superadmin.');
    return c.redirect(`/admin/users/${c.req.param('id')}`);
  }
  await db.run('UPDATE users SET disabled = 1, updated_at = ? WHERE id = ?', new Date().toISOString(), c.req.param('id'));
  // Revoke token too
  await db.run('DELETE FROM oauth_tokens WHERE user_id = ?', c.req.param('id'));
  setFlash(c, 'success', 'User disabled.');
  return c.redirect(`/admin/users/${c.req.param('id')}`);
});

adminRouter.post('/admin/users/:id/enable', async (c) => {
  if (!await verifyCsrf(c)) return c.text('Invalid CSRF token', 403);
  const db = getDb();
  await db.run('UPDATE users SET disabled = 0, updated_at = ? WHERE id = ?', new Date().toISOString(), c.req.param('id'));
  setFlash(c, 'success', 'User enabled.');
  return c.redirect(`/admin/users/${c.req.param('id')}`);
});

adminRouter.post('/admin/users/:id/promote', async (c) => {
  if (!await verifyCsrf(c)) return c.text('Invalid CSRF token', 403);
  const isSuperadmin = c.get('isSuperadmin') as boolean;
  if (!isSuperadmin) return c.text('Forbidden', 403);
  await getDb().run("UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?", new Date().toISOString(), c.req.param('id'));
  setFlash(c, 'success', 'User promoted to admin.');
  return c.redirect(`/admin/users/${c.req.param('id')}`);
});

adminRouter.post('/admin/users/:id/demote', async (c) => {
  if (!await verifyCsrf(c)) return c.text('Invalid CSRF token', 403);
  const isSuperadmin = c.get('isSuperadmin') as boolean;
  if (!isSuperadmin) return c.text('Forbidden', 403);
  const subject = await getDb().get('SELECT * FROM users WHERE id = ?', c.req.param('id')) as any;
  if (subject?.email === process.env.SUPERADMIN_EMAIL) {
    setFlash(c, 'error', 'Cannot demote superadmin.');
    return c.redirect(`/admin/users/${c.req.param('id')}`);
  }
  await getDb().run("UPDATE users SET role = 'member', updated_at = ? WHERE id = ?", new Date().toISOString(), c.req.param('id'));
  setFlash(c, 'success', 'User demoted to member.');
  return c.redirect(`/admin/users/${c.req.param('id')}`);
});

adminRouter.post('/admin/users/:id/regenerate-creds', async (c) => {
  if (!await verifyCsrf(c)) return c.text('Invalid CSRF token', 403);
  const isSuperadmin = c.get('isSuperadmin') as boolean;
  if (!isSuperadmin) return c.text('Forbidden', 403);

  const db = getDb();
  const subject = await db.get('SELECT * FROM users WHERE id = ?', c.req.param('id')) as any;
  if (!subject) return c.text('Not found', 404);

  const username = await uniqueUsername(db);
  const password = generatePassword();
  const hash = await Bun.password.hash(password, { algorithm: 'argon2id' });
  const viewToken = generateViewToken();
  const viewTokenExpiry = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  await db.run('DELETE FROM oauth_tokens WHERE user_id = ?', subject.id);
  await db.run(`
    UPDATE users SET username = ?, password_hash = ?, credential_view_token = ?, credential_view_token_expires_at = ?, updated_at = ?
    WHERE id = ?
  `, username, hash, viewToken, viewTokenExpiry, now, subject.id);

  await setFlashPassword(c, password);
  return c.redirect(`/admin/users/${subject.id}/credentials?token=${viewToken}`);
});

adminRouter.post('/admin/users/:id/rename', async (c) => {
  if (!await verifyCsrf(c)) return c.text('Invalid CSRF token', 403);
  const body = await c.req.parseBody();
  const name = (body['name'] as string)?.trim();
  if (!name) {
    setFlash(c, 'error', 'Name cannot be empty.');
    return c.redirect(`/admin/users/${c.req.param('id')}`);
  }
  const db = getDb();
  const subject = await db.get('SELECT * FROM users WHERE id = ?', c.req.param('id')) as any;
  if (!subject) return c.text('Not found', 404);
  await db.run('UPDATE users SET name = ?, updated_at = ? WHERE id = ?', name, new Date().toISOString(), subject.id);
  logActivity({ user_id: (c.get('user') as any).id, agent_label: null, tool_name: 'admin:rename_user', success: true, input_summary: `renamed user ${subject.username} to ${name}` });
  setFlash(c, 'success', `User renamed to "${name}".`);
  return c.redirect(`/admin/users/${c.req.param('id')}`);
});

adminRouter.post('/admin/users/:id/revoke-token', async (c) => {
  if (!await verifyCsrf(c)) return c.text('Invalid CSRF token', 403);
  await getDb().run('DELETE FROM oauth_tokens WHERE user_id = ?', c.req.param('id'));
  setFlash(c, 'success', 'Token revoked.');
  return c.redirect(`/admin/users/${c.req.param('id')}`);
});

adminRouter.post('/admin/users/:id/delete', async (c) => {
  if (!await verifyCsrf(c)) return c.text('Invalid CSRF token', 403);
  const isSuperadmin = c.get('isSuperadmin') as boolean;
  if (!isSuperadmin) return c.text('Forbidden', 403);

  const db = getDb();
  const subject = await db.get('SELECT * FROM users WHERE id = ?', c.req.param('id')) as any;
  if (!subject) return c.text('Not found', 404);
  if (subject.email === process.env.SUPERADMIN_EMAIL) {
    setFlash(c, 'error', 'Cannot delete the superadmin account.');
    return c.redirect(`/admin/users/${c.req.param('id')}`);
  }

  // Cascade: tokens, sessions, activity log entries, auth codes
  await db.run('DELETE FROM oauth_tokens WHERE user_id = ?', subject.id);
  await db.run('DELETE FROM admin_sessions WHERE user_id = ?', subject.id);
  await db.run('DELETE FROM auth_codes WHERE user_id = ?', subject.id);
  await db.run('DELETE FROM activity_log WHERE user_id = ?', subject.id);
  await db.run('DELETE FROM users WHERE id = ?', subject.id);

  logActivity({ user_id: (c.get('user') as any).id, agent_label: null, tool_name: 'admin:delete_user', success: true, input_summary: `deleted user ${subject.username}` });
  setFlash(c, 'success', `User ${subject.username} deleted.`);
  return c.redirect('/admin/users');
});

// ─── Projects ────────────────────────────────────────────────────────────────

adminRouter.get('/admin/projects', async (c) => {
  const user = c.get('user') as any;
  const isSuperadmin = c.get('isSuperadmin') as boolean;
  const flash = getFlash(c);
  const projects = await getDb().all('SELECT * FROM projects ORDER BY created_at DESC');
  return c.html(<ProjectsListPage user={user} isSuperadmin={isSuperadmin} flash={flash} projects={projects} />);
});

adminRouter.get('/admin/projects/:id', async (c) => {
  const user = c.get('user') as any;
  const isSuperadmin = c.get('isSuperadmin') as boolean;
  const flash = getFlash(c);
  const db = getDb();
  const project = await db.get('SELECT * FROM projects WHERE id = ?', c.req.param('id'));
  if (!project) return c.text('Not found', 404);
  const members = await db.all(`
    SELECT pm.role, pm.assigned_at, u.id, u.name, u.username
    FROM project_members pm JOIN users u ON pm.user_id = u.id
    WHERE pm.project_id = ?
  `, c.req.param('id'));
  const tasks = await db.all(`
    SELECT t.*, u.name as assignee_name FROM tasks t
    LEFT JOIN users u ON t.assigned_to = u.id
    WHERE t.project_id = ? ORDER BY t.created_at DESC
  `, c.req.param('id'));
  const csrfToken = c.get('csrfToken') as string;
  return c.html(<ProjectDetailPage user={user} isSuperadmin={isSuperadmin} flash={flash} project={project} members={members} tasks={tasks} csrfToken={csrfToken} />);
});

adminRouter.post('/admin/projects/:id/delete', async (c) => {
  if (!await verifyCsrf(c)) return c.text('Invalid CSRF token', 403);
  await getDb().run('DELETE FROM projects WHERE id = ?', c.req.param('id'));
  setFlash(c, 'success', 'Project deleted.');
  return c.redirect('/admin/projects');
});

// ─── Activity ────────────────────────────────────────────────────────────────

adminRouter.get('/admin/activity', async (c) => {
  const user = c.get('user') as any;
  const isSuperadmin = c.get('isSuperadmin') as boolean;
  const flash = getFlash(c);
  const filterUserId = c.req.query('user_id');
  const db = getDb();
  const logs = filterUserId
    ? await db.all('SELECT * FROM activity_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 500', filterUserId)
    : await db.all('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 500');
  const users = await db.all('SELECT id, username, name FROM users ORDER BY username ASC');
  return c.html(<ActivityPage user={user} isSuperadmin={isSuperadmin} flash={flash} logs={logs} users={users} filterUserId={filterUserId} />);
});

// ─── Settings (superadmin only) ──────────────────────────────────────────────

adminRouter.get('/admin/settings', async (c) => {
  const isSuperadmin = c.get('isSuperadmin') as boolean;
  if (!isSuperadmin) return c.text('Forbidden', 403);
  const user = c.get('user') as any;
  const flash = getFlash(c);
  const db = getDb();
  const tokenCount = ((await db.get('SELECT COUNT(*) as n FROM oauth_tokens')) as any).n;
  const csrfToken = c.get('csrfToken') as string;
  return c.html(<SettingsPage user={user} isSuperadmin={isSuperadmin} flash={flash} tokenCount={tokenCount} csrfToken={csrfToken} />);
});

adminRouter.post('/admin/settings/revoke-all-tokens', async (c) => {
  if (!await verifyCsrf(c)) return c.text('Invalid CSRF token', 403);
  const isSuperadmin = c.get('isSuperadmin') as boolean;
  if (!isSuperadmin) return c.text('Forbidden', 403);
  await getDb().run('DELETE FROM oauth_tokens');
  setFlash(c, 'success', 'All tokens revoked.');
  return c.redirect('/admin/settings');
});

adminRouter.post('/admin/settings/export-db', async (c) => {
  if (!await verifyCsrf(c)) return c.text('Invalid CSRF token', 403);
  const isSuperadmin = c.get('isSuperadmin') as boolean;
  if (!isSuperadmin) return c.text('Forbidden', 403);
  const dbPath = process.env.DATABASE_PATH ?? './taskmanager.db';
  try {
    const file = Bun.file(dbPath);
    const buffer = await file.arrayBuffer();
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="cerebro-backup-${new Date().toISOString().slice(0, 10)}.db"`,
      },
    });
  } catch {
    setFlash(c, 'error', 'Failed to export database.');
    return c.redirect('/admin/settings');
  }
});
