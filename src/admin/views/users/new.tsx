/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Layout } from '../layout.tsx';
import type { User } from '../../../types.ts';

interface NewUserProps {
  user: User;
  isSuperadmin: boolean;
  flash?: { type: 'success' | 'error'; message: string } | null;
  error?: string;
}

export const NewUserPage: FC<NewUserProps> = ({ user, isSuperadmin, flash, error }) => {
  return (
    <Layout title="New User" user={user} isSuperadmin={isSuperadmin} flash={flash}>
      <div class="page-header">
        <h1>New User</h1>
        <a href="/admin/users" class="btn btn-secondary">← Back</a>
      </div>
      {error && <div class="alert alert-error">{error}</div>}
      <div class="form-card">
        <form method="post" action="/admin/users">
          <div class="form-group">
            <label for="name">Full Name <span class="required">*</span></label>
            <input id="name" name="name" type="text" required maxlength={200} />
          </div>
          <div class="form-group">
            <label for="email">Email <span class="hint">(admin reference only, not used for auth)</span></label>
            <input id="email" name="email" type="email" maxlength={254} />
          </div>
          <p class="hint-block">A username and password will be auto-generated and shown once after creation.</p>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">Create User</button>
            <a href="/admin/users" class="btn btn-secondary">Cancel</a>
          </div>
        </form>
      </div>
    </Layout>
  );
};
