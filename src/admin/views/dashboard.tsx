/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from './layout.tsx';
import type { User } from '../../types.ts';

interface DashboardProps {
  user: User;
  isSuperadmin: boolean;
  flash?: { type: 'success' | 'error'; message: string } | null;
  stats: {
    totalUsers: number;
    totalProjects: number;
    totalTasks: number;
    pendingTasks: number;
    inProgressTasks: number;
    overdueTasks: number;
    dueSoonTasks: number;
  };
  recentActivity: any[];
}

export const DashboardPage: FC<DashboardProps> = ({ user, isSuperadmin, flash, stats, recentActivity }) => {
  return (
    <Layout title="Dashboard" user={user} isSuperadmin={isSuperadmin} flash={flash}>
      <div class="page-header">
        <h1>Dashboard</h1>
      </div>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">{stats.totalUsers}</div>
          <div class="stat-label">Active Users</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{stats.totalProjects}</div>
          <div class="stat-label">Projects</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{stats.totalTasks}</div>
          <div class="stat-label">Total Tasks</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{stats.pendingTasks}</div>
          <div class="stat-label">Pending</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{stats.inProgressTasks}</div>
          <div class="stat-label">In Progress</div>
        </div>
        <div class={`stat-card ${stats.overdueTasks > 0 ? 'stat-card-warn' : ''}`}>
          <div class="stat-value">{stats.overdueTasks}</div>
          <div class="stat-label">Overdue</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{stats.dueSoonTasks}</div>
          <div class="stat-label">Due in 24h</div>
        </div>
      </div>

      <div class="section">
        <h2>Recent Activity</h2>
        {recentActivity.length === 0 ? (
          <p class="empty">No activity yet.</p>
        ) : (
          <table class="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Tool</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {recentActivity.map((a) => (
                <tr key={a.id}>
                  <td class="mono">{new Date(a.created_at).toLocaleString()}</td>
                  <td>{a.user_name ?? a.agent_label ?? '—'}</td>
                  <td class="mono">{a.tool_name}</td>
                  <td>
                    <span class={`badge ${a.success ? 'badge-success' : 'badge-error'}`}>
                      {a.success ? 'ok' : 'error'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <a href="/admin/activity" class="link-more">View all activity →</a>
      </div>
    </Layout>
  );
};
