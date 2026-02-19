/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';

interface CredentialsProps {
  username: string;
  password: string;
  mcpUrl: string;
}

export const CredentialsPage: FC<CredentialsProps> = ({ username, password, mcpUrl }) => {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>User Credentials — Cerebro</title>
        <link rel="stylesheet" href="/static/admin.css" />
      </head>
      <body>
        <div class="creds-page">
          <div class="creds-card">
            <div class="creds-header">
              <h1>Save These Credentials</h1>
              <p class="creds-warn">⚠️ This page will not be shown again. Copy and store these securely now.</p>
            </div>

            <div class="cred-group">
              <label>MCP Server URL</label>
              <div class="cred-row">
                <code id="mcp-url">{mcpUrl}</code>
                <button class="btn btn-sm btn-secondary copy-btn" onclick={`copyText('mcp-url')`}>Copy</button>
              </div>
            </div>

            <div class="cred-group">
              <label>Username</label>
              <div class="cred-row">
                <code id="username">{username}</code>
                <button class="btn btn-sm btn-secondary copy-btn" onclick={`copyText('username')`}>Copy</button>
              </div>
            </div>

            <div class="cred-group">
              <label>Password</label>
              <div class="cred-row">
                <code id="password">{password}</code>
                <button class="btn btn-sm btn-secondary copy-btn" onclick={`copyText('password')`}>Copy</button>
              </div>
            </div>

            <div class="creds-instructions">
              <h2>How to Connect</h2>
              <ol>
                <li>Go to <strong>claude.ai</strong> → <strong>Settings</strong> → <strong>Connectors</strong></li>
                <li>Click <strong>Add custom connector</strong></li>
                <li>Paste the MCP Server URL above</li>
                <li>Click <strong>Connect</strong> — an authorization popup will appear</li>
                <li>Enter the username and password above</li>
                <li>Optionally give the connection a name (e.g. "Work Claude")</li>
                <li>Click <strong>Authorize</strong> — done!</li>
              </ol>
            </div>

            <div class="creds-footer">
              <a href="/admin/users" class="btn btn-primary">I've saved these — continue</a>
            </div>
          </div>
        </div>

        <script
          dangerouslySetInnerHTML={{
            __html: `function copyText(id) {
  var el = document.getElementById(id);
  navigator.clipboard.writeText(el.textContent).then(function() {
    var btn = el.nextElementSibling;
    var prev = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(function() { btn.textContent = prev; }, 1500);
  });
}`,
          }}
        />
      </body>
    </html>
  );
};
