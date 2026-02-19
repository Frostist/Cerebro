/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout.tsx';
import type { User } from '../../../types.ts';

interface UserDetailProps {
  user: User;
  isSuperadmin: boolean;
  flash?: { type: 'success' | 'error'; message: string } | null;
  subject: any;
  token: any;
  csrfToken?: string;
}

export const UserDetailPage: FC<UserDetailProps> = ({ user, isSuperadmin, flash, subject, token, csrfToken }) => {
  const isSubjectSuperadmin = subject.email === process.env.SUPERADMIN_EMAIL;

  return (
    <Layout title={`User: ${subject.username}`} user={user} isSuperadmin={isSuperadmin} flash={flash} csrfToken={csrfToken}>
      <div class="page-header">
        <h1>{subject.name}</h1>
        <a href="/admin/users" class="btn btn-secondary">← Users</a>
      </div>

      <div class="detail-grid">
        <div class="detail-card">
          <h2>Profile</h2>
          <dl class="definition-list">
            <dt>Username</dt><dd class="mono">{subject.username}</dd>
            <dt>Name</dt>
            <dd>
              <form method="post" action={`/admin/users/${subject.id}/rename`} style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">
                <input type="hidden" name="_csrf" value={csrfToken ?? ''} />
                <input type="text" name="name" value={subject.name} required style="flex:1;min-width:120px;padding:0.25rem 0.5rem;font-size:inherit;border:1px solid var(--border);border-radius:4px;background:var(--bg-input,#fff);color:inherit" />
                <button type="submit" class="btn btn-sm btn-secondary">Rename</button>
              </form>
            </dd>
            <dt>Email</dt><dd>{subject.email ?? '—'}</dd>
            <dt>Role</dt><dd><span class={`badge ${subject.role === 'admin' ? 'badge-blue' : 'badge-gray'}`}>{subject.role}</span></dd>
            <dt>Status</dt><dd>{subject.disabled ? <span class="badge badge-error">disabled</span> : <span class="badge badge-success">active</span>}</dd>
            <dt>Created</dt><dd class="mono">{new Date(subject.created_at).toLocaleString()}</dd>
          </dl>

          {!isSubjectSuperadmin && (
            <div class="card-actions">
              {!subject.disabled ? (
                <form method="post" action={`/admin/users/${subject.id}/disable`} style="display:inline">
                  <input type="hidden" name="_csrf" value={csrfToken ?? ''} />
                  <button type="submit" class="btn btn-sm btn-danger">Disable</button>
                </form>
              ) : (
                <form method="post" action={`/admin/users/${subject.id}/enable`} style="display:inline">
                  <input type="hidden" name="_csrf" value={csrfToken ?? ''} />
                  <button type="submit" class="btn btn-sm btn-secondary">Enable</button>
                </form>
              )}
              {isSuperadmin && subject.role === 'member' && (
                <form method="post" action={`/admin/users/${subject.id}/promote`} style="display:inline">
                  <input type="hidden" name="_csrf" value={csrfToken ?? ''} />
                  <button type="submit" class="btn btn-sm btn-secondary">Promote to Admin</button>
                </form>
              )}
              {isSuperadmin && subject.role === 'admin' && (
                <form method="post" action={`/admin/users/${subject.id}/demote`} style="display:inline">
                  <input type="hidden" name="_csrf" value={csrfToken ?? ''} />
                  <button type="submit" class="btn btn-sm btn-secondary">Demote to Member</button>
                </form>
              )}
            </div>
          )}
        </div>

        <div class="detail-card">
          <h2>OAuth Connection</h2>
          {token ? (
            <dl class="definition-list">
              <dt>Status</dt><dd><span class="badge badge-success">Connected</span></dd>
              <dt>Agent label</dt><dd>{token.agent_label ?? '—'}</dd>
              <dt>Last used</dt><dd class="mono">{token.last_used_at ? new Date(token.last_used_at).toLocaleString() : 'Never'}</dd>
              <dt>Expires</dt><dd class="mono">{new Date(token.expires_at).toLocaleString()}</dd>
            </dl>
          ) : (
            <p class="empty">Not connected yet.</p>
          )}
          {token && (
            <div class="card-actions">
              <form method="post" action={`/admin/users/${subject.id}/revoke-token`} style="display:inline">
                <input type="hidden" name="_csrf" value={csrfToken ?? ''} />
                <button type="submit" class="btn btn-sm btn-danger"
                  onclick="return confirm('Revoke this token? The agent will need to re-authenticate.')">
                  Revoke Token
                </button>
              </form>
            </div>
          )}
          {isSuperadmin && (
            <div class="card-actions" style="margin-top:1rem">
              <form method="post" action={`/admin/users/${subject.id}/regenerate-creds`}
                onsubmit="return confirm('Regenerate credentials? This will revoke the existing token and generate a new username and password.')">
                <input type="hidden" name="_csrf" value={csrfToken ?? ''} />
                <button type="submit" class="btn btn-sm btn-danger">Regenerate Credentials</button>
              </form>
            </div>
          )}
        </div>
      </div>

      {isSuperadmin && !isSubjectSuperadmin && (
        <div class="danger-zone">
          <h2>Danger Zone</h2>
          <p>Permanently delete this user and all their sessions and tokens. This cannot be undone.</p>
          <form method="post" action={`/admin/users/${subject.id}/delete`}
            onsubmit={`return confirm('Delete user ${subject.username}? This is permanent and cannot be undone.')`}>
            <input type="hidden" name="_csrf" value={csrfToken ?? ''} />
            <button type="submit" class="btn btn-danger">Delete User</button>
          </form>
        </div>
      )}
    </Layout>
  );
};
