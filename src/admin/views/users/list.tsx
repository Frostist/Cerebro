/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout.tsx';
import type { User } from '../../../types.ts';

interface UsersListProps {
  user: User;
  isSuperadmin: boolean;
  flash?: { type: 'success' | 'error'; message: string } | null;
  users: any[];
  filter?: string;
}

export const UsersListPage: FC<UsersListProps> = ({ user, isSuperadmin, flash, users, filter }) => {
  return (
    <Layout title="Users" user={user} isSuperadmin={isSuperadmin} flash={flash}>
      <div class="page-header">
        <h1>Users</h1>
        <div class="header-actions">
          <form method="get" action="/admin/users" class="filter-form">
            <input name="q" type="search" placeholder="Filter..." value={filter ?? ''} />
          </form>
          <a href="/admin/users/new" class="btn btn-primary">+ New User</a>
        </div>
      </div>
      {users.length === 0 ? (
        <p class="empty">No users found.</p>
      ) : (
        <table class="table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} class={u.disabled ? 'row-disabled' : ''}>
                <td class="mono"><a href={`/admin/users/${u.id}`}>{u.username}</a></td>
                <td>{u.name}</td>
                <td>{u.email ?? '—'}</td>
                <td><span class={`badge ${u.role === 'admin' ? 'badge-blue' : 'badge-gray'}`}>{u.role}</span></td>
                <td>
                  {u.disabled ? <span class="badge badge-error">disabled</span> : <span class="badge badge-success">active</span>}
                </td>
                <td class="mono nowrap">{new Date(u.created_at).toLocaleDateString()}</td>
                <td class="actions-cell">
                  {!u.disabled ? (
                    <form method="post" action={`/admin/users/${u.id}/disable`} style="display:inline">
                      <button type="submit" class="btn btn-sm btn-danger">Disable</button>
                    </form>
                  ) : (
                    <form method="post" action={`/admin/users/${u.id}/enable`} style="display:inline">
                      <button type="submit" class="btn btn-sm btn-secondary">Enable</button>
                    </form>
                  )}
                  {isSuperadmin && u.role === 'member' && (
                    <form method="post" action={`/admin/users/${u.id}/promote`} style="display:inline">
                      <button type="submit" class="btn btn-sm btn-secondary">→ Admin</button>
                    </form>
                  )}
                  {isSuperadmin && u.role === 'admin' && u.email !== process.env.SUPERADMIN_EMAIL && (
                    <form method="post" action={`/admin/users/${u.id}/demote`} style="display:inline">
                      <button type="submit" class="btn btn-sm btn-secondary">→ Member</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Layout>
  );
};
