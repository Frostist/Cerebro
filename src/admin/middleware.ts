import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { getDb } from '../db.ts';

export async function adminAuth(c: Context<any>, next: Next) {
  const sessionId = getCookie(c, 'session');
  if (!sessionId) return c.redirect('/admin/login');

  const db = getDb();
  const session = await db.get(`
    SELECT s.*, u.id as u_id, u.name, u.email, u.username, u.password_hash, u.role,
           u.confirmed, u.disabled, u.created_by, u.created_at, u.updated_at
    FROM admin_sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ? AND s.expires_at > ?
  `, sessionId, new Date().toISOString()) as any;

  if (!session || session.disabled) return c.redirect('/admin/login');

  const user = {
    id: session.u_id,
    name: session.name,
    email: session.email,
    username: session.username,
    password_hash: session.password_hash,
    role: session.role,
    confirmed: session.confirmed,
    disabled: session.disabled,
    created_by: session.created_by,
    created_at: session.created_at,
    updated_at: session.updated_at,
  };

  c.set('user', user);
  c.set('isSuperadmin', user.email === process.env.SUPERADMIN_EMAIL);

  await next();
}
