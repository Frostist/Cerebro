import type { Context, Next } from 'hono';
import { getDb } from '../db.ts';

export async function bearerAuth(c: Context<any>, next: Next) {
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const token = auth.slice(7);
  const db = getDb();

  const record = db.query(`
    SELECT t.*, u.id as u_id, u.name, u.email, u.username, u.role, u.confirmed, u.disabled
    FROM oauth_tokens t
    JOIN users u ON t.user_id = u.id
    WHERE t.access_token = ? AND t.expires_at > ?
  `).get(token, new Date().toISOString()) as any;

  if (!record || record.disabled || !record.confirmed) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  // Update last_used_at
  db.query('UPDATE oauth_tokens SET last_used_at = ? WHERE access_token = ?')
    .run(new Date().toISOString(), token);

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

  await next();
}
