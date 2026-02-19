/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from './layout.tsx';
import type { User } from '../../types.ts';

interface ActivityProps {
  user: User;
  isSuperadmin: boolean;
  flash?: { type: 'success' | 'error'; message: string } | null;
  logs: any[];
  users: any[];
  filterUserId?: string;
}

export const ActivityPage: FC<ActivityProps> = ({ user, isSuperadmin, flash, logs, users, filterUserId }) => {
  return (
    <Layout title="Activity Log" user={user} isSuperadmin={isSuperadmin} flash={flash}>
      <div class="page-header">
        <h1>Activity Log</h1>
        <form method="get" action="/admin/activity" class="filter-form">
          <select name="user_id" onchange="this.form.submit()">
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u.id} value={u.id} selected={u.id === filterUserId}>{u.username} ({u.name})</option>
            ))}
          </select>
        </form>
      </div>
      {logs.length === 0 ? (
        <p class="empty">No activity logged yet.</p>
      ) : (
        <table class="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>User</th>
              <th>Tool</th>
              <th>Summary</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((a) => (
              <tr key={a.id}>
                <td class="mono nowrap">{new Date(a.created_at).toLocaleString()}</td>
                <td>{a.user_name ?? a.agent_label ?? '—'}</td>
                <td class="mono">{a.tool_name}</td>
                <td class="truncate">{a.input_summary ?? ''}</td>
                <td>
                  <span class={`badge ${a.success ? 'badge-success' : 'badge-error'}`}>
                    {a.success ? 'ok' : 'error'}
                  </span>
                  {a.error_msg && <span class="error-msg" title={a.error_msg}> ⚠</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Layout>
  );
};
