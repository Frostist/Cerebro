/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout.tsx';
import type { User } from '../../../types.ts';

interface ProjectDetailProps {
  user: User;
  isSuperadmin: boolean;
  flash?: { type: 'success' | 'error'; message: string } | null;
  project: any;
  members: any[];
  tasks: any[];
  notes: any[];
  csrfToken?: string;
}

export const ProjectDetailPage: FC<ProjectDetailProps> = ({ user, isSuperadmin, flash, project, members, tasks, notes, csrfToken }) => {
  const statusColor: Record<string, string> = {
    pending: 'badge-gray',
    in_progress: 'badge-blue',
    completed: 'badge-success',
    cancelled: 'badge-error',
  };
  const priorityColor: Record<string, string> = {
    low: 'badge-gray',
    medium: 'badge-gray',
    high: 'badge-warn',
    urgent: 'badge-error',
  };

  return (
    <Layout title={project.name} user={user} isSuperadmin={isSuperadmin} flash={flash} csrfToken={csrfToken}>
      <div class="page-header">
        <h1>{project.name}</h1>
        <a href="/admin/projects" class="btn btn-secondary">← Projects</a>
      </div>
      {project.description && <p class="project-desc">{project.description}</p>}

      <div class="section">
        <h2>Members ({members.length})</h2>
        {members.length === 0 ? (
          <p class="empty">No members assigned.</p>
        ) : (
          <table class="table">
            <thead>
              <tr><th>Username</th><th>Name</th><th>Role</th><th>Assigned</th></tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td class="mono">{m.username}</td>
                  <td>{m.name}</td>
                  <td><span class={`badge ${m.role === 'owner' ? 'badge-blue' : 'badge-gray'}`}>{m.role}</span></td>
                  <td class="mono nowrap">{new Date(m.assigned_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div class="section">
        <h2>Tasks ({tasks.length})</h2>
        {tasks.length === 0 ? (
          <p class="empty">No tasks yet.</p>
        ) : (
          <table class="table">
            <thead>
              <tr><th>Title</th><th>Status</th><th>Priority</th><th>Tags</th><th>Assigned To</th><th>Due</th></tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td>
                    {t.title}
                  </td>
                  <td><span class={`badge ${statusColor[t.status] ?? 'badge-gray'}`}>{t.status}</span></td>
                  <td><span class={`badge ${priorityColor[t.priority] ?? 'badge-gray'}`}>{t.priority}</span></td>
                  <td>
                    {t.tags?.map((tag: any) => (
                      <span class="badge badge-gray" style="margin-right: 4px;">{tag.name}</span>
                    ))}
                  </td>
                  <td>{t.assignee_name ?? '—'}</td>
                  <td class="mono nowrap">{t.due_date ? new Date(t.due_date).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div class="section">
        <h2>Notes ({notes.length})</h2>
        {notes.length === 0 ? (
          <p class="empty">No notes yet.</p>
        ) : (
          <div class="notes-list">
            {notes.map((n) => (
              <div key={n.id} class="note-card">
                <div class="note-header">
                  <strong>{n.title}</strong>
                  <span class="meta">by {n.creator_name} • {new Date(n.updated_at).toLocaleDateString()}</span>
                </div>
                <div class="note-content">{n.content.slice(0, 200)}{n.content.length > 200 ? '...' : ''}</div>
              </div>
            ))}
          </div>
        )}
      </div>

    </Layout>
  );
};
