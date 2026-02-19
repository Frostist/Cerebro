/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout.tsx';
import type { User } from '../../../types.ts';

interface ProjectsListProps {
  user: User;
  isSuperadmin: boolean;
  flash?: { type: 'success' | 'error'; message: string } | null;
  projects: any[];
  csrfToken: string;
}

export const ProjectsListPage: FC<ProjectsListProps> = ({ user, isSuperadmin, flash, projects, csrfToken }) => {
  return (
    <Layout title="Projects" user={user} isSuperadmin={isSuperadmin} flash={flash}>
      <div class="page-header">
        <h1>Projects</h1>
        <span class="hint">Read-only — agents manage projects via MCP tools</span>
      </div>
      {projects.length === 0 ? (
        <p class="empty">No projects yet. Ask an agent to create one.</p>
      ) : (
        <table class="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Description</th>
              <th>Created By</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td><a href={`/admin/projects/${p.id}`}>{p.name}</a></td>
                <td class="truncate">{p.description ?? '—'}</td>
                <td class="mono">{p.created_by}</td>
                <td class="mono nowrap">{new Date(p.created_at).toLocaleDateString()}</td>
                <td>
                  <form method="post" action={`/admin/projects/${p.id}/delete`}
                    onsubmit={`return confirm('Delete project "${p.name}" and all its tasks?')`}>
                    <input type="hidden" name="_csrf" value={csrfToken} />
                    <button type="submit" class="btn btn-sm btn-danger">Delete</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Layout>
  );
};
