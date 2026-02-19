/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';

interface LoginProps {
  error?: string;
}

export const LoginPage: FC<LoginProps> = ({ error }) => {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Login — Cerebro</title>
        <link rel="stylesheet" href="/static/admin.css" />
      </head>
      <body class="login-body">
        <div class="login-card">
          <h1 class="login-title">Cerebro</h1>
          <p class="login-sub">Admin Portal</p>
          {error && <div class="alert alert-error">{error}</div>}
          <form method="post" action="/admin/login">
            <div class="form-group">
              <label for="username">Username</label>
              <input id="username" name="username" type="text" autocomplete="username" required />
            </div>
            <div class="form-group">
              <label for="password">Password</label>
              <input id="password" name="password" type="password" autocomplete="current-password" required />
            </div>
            <button type="submit" class="btn btn-primary btn-full">Sign in</button>
          </form>
        </div>
      </body>
    </html>
  );
};
