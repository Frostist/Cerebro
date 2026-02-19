/** @jsxImportSource hono/jsx */
import type { FC, PropsWithChildren } from 'hono/jsx';
import type { User } from '../../types.ts';

interface LayoutProps {
  title?: string;
  user: User;
  isSuperadmin: boolean;
  flash?: { type: 'success' | 'error'; message: string } | null;
}

export const Layout: FC<PropsWithChildren<LayoutProps>> = ({ title, user, isSuperadmin, flash, children }) => {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title ? `${title} — Cerebro` : 'Cerebro'}</title>
        <link rel="stylesheet" href="/static/admin.css" />
      </head>
      <body>
        <nav class="nav">
          <a href="/admin" class="nav-brand">Cerebro</a>
          <div class="nav-links">
            <a href="/admin">Dashboard</a>
            <a href="/admin/users">Users</a>
            <a href="/admin/projects">Projects</a>
            <a href="/admin/activity">Activity</a>
            {isSuperadmin && <a href="/admin/settings">Settings</a>}
          </div>
          <div class="nav-user">
            <span class="nav-username">{user.username}</span>
            <form method="post" action="/admin/logout" style="display:inline">
              <button type="submit" class="btn-link">Logout</button>
            </form>
          </div>
        </nav>
        <main class="main">
          {flash && (
            <div class={`alert alert-${flash.type}`}>{flash.message}</div>
          )}
          {children}
        </main>
      </body>
    </html>
  );
};
