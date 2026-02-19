import type { Context, Next } from 'hono';
import { getDb } from '../db.ts';

export async function bearerAuth(c: Context<any>, next: Next) {
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    const base = (process.env.BASE_URL ?? '').replace(/\/$/, '');
    console.log(`[auth] ${c.req.method} ${c.req.path} — no Bearer token, returning 401`);
    return c.json({ error: 'unauthorized' }, 401, {
      'WWW-Authenticate': `Bearer realm="${base}", resource_metadata="${base}/.well-known/oauth-protected-resource"`,
    });
  }

  const token = auth.slice(7);
  const tokenPrefix = token.slice(0, 8);
  const db = getDb();

  const record = await db.get(`
    SELECT t.*, u.id as u_id, u.name, u.email, u.username, u.role, u.confirmed, u.disabled
    FROM oauth_tokens t
    JOIN users u ON t.user_id = u.id
    WHERE t.access_token = ? AND t.expires_at > ?
  `, token, new Date().toISOString()) as any;

  if (!record) {
    console.log(`[auth] ${c.req.method} ${c.req.path} — invalid or expired token, returning 401`);
    return c.json({ error: 'unauthorized' }, 401);
  }
  if (record.disabled) {
    console.log(`[auth] ${c.req.method} ${c.req.path} — user ${record.username} is disabled, returning 401`);
    return c.json({ error: 'unauthorized' }, 401);
  }
  if (!record.confirmed) {
    console.log(`[auth] ${c.req.method} ${c.req.path} — user ${record.username} not confirmed, returning 401`);
    return c.json({ error: 'unauthorized' }, 401);
  }

  // Update last_used_at
  await db.run('UPDATE oauth_tokens SET last_used_at = ? WHERE access_token = ?',
    new Date().toISOString(), token);

  c.set('user', {
    id: record.u_id,
    name: record.name,
    email: record.email,
    username: record.username,
    password_hash: '',
    role: record.role,
    confirmed: record.confirmed,
    disabled: record.disabled,
    created_by: null,
    created_at: '',
    updated_at: '',
  });
  c.set('agentLabel', record.agent_label ?? record.username);
  c.set('isSuperadmin', record.email === process.env.SUPERADMIN_EMAIL);
  console.log(`[auth] ${c.req.method} ${c.req.path} — authenticated as ${record.username} (token ${tokenPrefix}…)`);

  await next();
}
