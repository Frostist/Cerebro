/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from './layout.tsx';
import type { User } from '../../types.ts';

interface SettingsProps {
  user: User;
  isSuperadmin: boolean;
  flash?: { type: 'success' | 'error'; message: string } | null;
  tokenCount: number;
  csrfToken?: string;
}

export const SettingsPage: FC<SettingsProps> = ({ user, isSuperadmin, flash, tokenCount, csrfToken }) => {
  return (
    <Layout title="Settings" user={user} isSuperadmin={isSuperadmin} flash={flash} csrfToken={csrfToken}>
      <div class="page-header">
        <h1>Settings</h1>
        <span class="badge badge-warn">Superadmin only</span>
      </div>

      <div class="section">
        <h2>OAuth Tokens</h2>
        <p>{tokenCount} active token{tokenCount !== 1 ? 's' : ''} across all users.</p>
        <form method="post" action="/admin/settings/revoke-all-tokens"
          onsubmit="return confirm('Revoke ALL tokens? All agents will need to re-authenticate.')">
          <input type="hidden" name="_csrf" value={csrfToken ?? ''} />
          <button type="submit" class="btn btn-danger">Revoke All Tokens</button>
        </form>
      </div>

      <div class="section">
        <h2>Database Export</h2>
        <p>Download a copy of the SQLite database file.</p>
        <form method="post" action="/admin/settings/export-db">
          <input type="hidden" name="_csrf" value={csrfToken ?? ''} />
          <button type="submit" class="btn btn-secondary">Export Database</button>
        </form>
      </div>
    </Layout>
  );
};
