import { Hono } from 'hono';
import { getDb } from '../db.ts';
import { generateToken, generateId } from '../utils/crypto.ts';
import { verifyCodeChallenge } from './pkce.ts';

// In-memory rate limiter: 10 req/min per IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count++;
  return true;
}

export const oauthRouter = new Hono();

// Validate that a redirect_uri is allowed: must be HTTPS and on claude.ai (or a subdomain).
function isAllowedRedirectUri(uri: string): boolean {
  try {
    const url = new URL(uri);
    return url.protocol === 'https:' && (url.hostname === 'claude.ai' || url.hostname.endsWith('.claude.ai'));
  } catch {
    return false;
  }
}

function getBase(): string {
  let base = process.env.BASE_URL ?? '';
  if (base && !base.startsWith('http://') && !base.startsWith('https://')) {
    base = `https://${base}`;
  }
  return base.replace(/\/$/, '');
}

// OAuth Authorization Server Metadata
oauthRouter.get('/.well-known/oauth-authorization-server', (c) => {
  const base = getBase();
  return c.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['read', 'write'],
  });
});

// Dynamic Client Registration (RFC 7591)
// Claude requires this endpoint — we accept any client and echo back a client_id
oauthRouter.post('/oauth/register', async (c) => {
  console.log('[oauth] POST /oauth/register — dynamic client registration');
  const body = await c.req.json().catch(() => ({})) as Record<string, any>;

  const requestedUris: string[] = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  const invalidUris = requestedUris.filter((uri) => !isAllowedRedirectUri(uri));
  if (invalidUris.length > 0) {
    console.log(`[oauth] register rejected — invalid redirect_uris: ${invalidUris.join(', ')}`);
    return c.json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris must use HTTPS and be on the claude.ai domain' }, 400);
  }

  const clientId = `claude-${generateId()}`;
  // Spread body first so our explicit fields always win
  return c.json({
    ...body,
    client_id: clientId,
    client_secret_expires_at: 0,
    redirect_uris: requestedUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }, 201);
});

// Protected Resource Metadata (RFC 9728)
// Claude connectors also probe /.well-known/oauth-protected-resource/<resource-path>
// (e.g. /.well-known/oauth-protected-resource/mcp/sse), so handle both forms.
function protectedResourceMetadata(c: any) {
  const base = getBase();
  return c.json({
    resource: base,
    authorization_servers: [base],
    bearer_methods_supported: ['header'],
  });
}
oauthRouter.get('/.well-known/oauth-protected-resource', protectedResourceMetadata);
oauthRouter.get('/.well-known/oauth-protected-resource/*', protectedResourceMetadata);

// GET /oauth/authorize — show login form
oauthRouter.get('/oauth/authorize', (c) => {
  const { client_id, redirect_uri, response_type, code_challenge, code_challenge_method, state } =
    c.req.query();

  if (response_type !== 'code' || !code_challenge) {
    return c.text('Invalid request', 400);
  }

  const resolvedRedirectUri = redirect_uri || 'https://claude.ai/api/mcp/auth_callback';
  if (!isAllowedRedirectUri(resolvedRedirectUri)) {
    console.log(`[oauth] authorize GET rejected — invalid redirect_uri: ${resolvedRedirectUri}`);
    return c.text('Invalid redirect_uri', 400);
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cerebro — Connect</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #f5f5f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 2rem; width: 100%; max-width: 380px; }
    h1 { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.5rem; }
    p { color: #6b7280; font-size: 0.875rem; margin-bottom: 1.5rem; }
    label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: 0.25rem; }
    input { width: 100%; border: 1px solid #d1d5db; border-radius: 6px; padding: 0.5rem 0.75rem; font-size: 0.875rem; margin-bottom: 1rem; }
    input:focus { outline: 2px solid #2563EB; outline-offset: -1px; }
    button { width: 100%; background: #2563EB; color: #fff; border: none; border-radius: 6px; padding: 0.625rem; font-size: 0.875rem; font-weight: 500; cursor: pointer; }
    button:hover { background: #1d4ed8; }
    .error { background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; padding: 0.5rem 0.75rem; border-radius: 6px; font-size: 0.875rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Connect to Cerebro</h1>
    <p>Sign in to authorize your Claude agent.</p>
    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="client_id" value="${escapeHtml(client_id ?? '')}">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirect_uri ?? '')}">
      <input type="hidden" name="response_type" value="code">
      <input type="hidden" name="code_challenge" value="${escapeHtml(code_challenge)}">
      <input type="hidden" name="code_challenge_method" value="${escapeHtml(code_challenge_method ?? 'S256')}">
      <input type="hidden" name="state" value="${escapeHtml(state ?? '')}">
      <label for="username">Username</label>
      <input id="username" name="username" type="text" autocomplete="username" required>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <label for="agent_label">Connection name <span style="color:#6b7280;font-weight:400">(optional)</span></label>
      <input id="agent_label" name="agent_label" type="text" placeholder="e.g. Work Claude">
      <button type="submit">Authorize</button>
    </form>
  </div>
</body>
</html>`;

  return c.html(html);
});

// POST /oauth/authorize — validate and issue code
oauthRouter.post('/oauth/authorize', async (c) => {
  const ip = c.req.header('x-forwarded-for') ?? 'unknown';
  if (!checkRateLimit(ip)) return c.text('Too many requests', 429);

  const body = await c.req.parseBody();
  const { username, password, redirect_uri, code_challenge, code_challenge_method, state, agent_label } = body as Record<string, string>;

  const db = getDb();
  const user = await db.get('SELECT * FROM users WHERE username = ? AND disabled = 0 AND confirmed = 1', username) as any;

  if (!user || !(await Bun.password.verify(password, user.password_hash))) {
    // Re-show form with error
    const qs = new URLSearchParams({
      redirect_uri: redirect_uri ?? '',
      response_type: 'code',
      code_challenge: code_challenge ?? '',
      code_challenge_method: code_challenge_method ?? 'S256',
      state: state ?? '',
    });
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cerebro — Connect</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #f5f5f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 2rem; width: 100%; max-width: 380px; }
    h1 { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.5rem; }
    p { color: #6b7280; font-size: 0.875rem; margin-bottom: 1.5rem; }
    label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: 0.25rem; }
    input { width: 100%; border: 1px solid #d1d5db; border-radius: 6px; padding: 0.5rem 0.75rem; font-size: 0.875rem; margin-bottom: 1rem; }
    input:focus { outline: 2px solid #2563EB; outline-offset: -1px; }
    button { width: 100%; background: #2563EB; color: #fff; border: none; border-radius: 6px; padding: 0.625rem; font-size: 0.875rem; font-weight: 500; cursor: pointer; }
    button:hover { background: #1d4ed8; }
    .error { background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; padding: 0.5rem 0.75rem; border-radius: 6px; font-size: 0.875rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Connect to Cerebro</h1>
    <p>Sign in to authorize your Claude agent.</p>
    <div class="error">Invalid username or password.</div>
    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirect_uri ?? '')}">
      <input type="hidden" name="response_type" value="code">
      <input type="hidden" name="code_challenge" value="${escapeHtml(code_challenge ?? '')}">
      <input type="hidden" name="code_challenge_method" value="${escapeHtml(code_challenge_method ?? 'S256')}">
      <input type="hidden" name="state" value="${escapeHtml(state ?? '')}">
      <label for="username">Username</label>
      <input id="username" name="username" type="text" value="${escapeHtml(username ?? '')}" autocomplete="username" required>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <label for="agent_label">Connection name <span style="color:#6b7280;font-weight:400">(optional)</span></label>
      <input id="agent_label" name="agent_label" type="text" placeholder="e.g. Work Claude" value="${escapeHtml(agent_label ?? '')}">
      <button type="submit">Authorize</button>
    </form>
  </div>
</body>
</html>`;
    return c.html(html, 401);
  }

  // Validate redirect_uri before issuing any code
  const resolvedRedirectUri = redirect_uri || 'https://claude.ai/api/mcp/auth_callback';
  if (!isAllowedRedirectUri(resolvedRedirectUri)) {
    console.log(`[oauth] authorize rejected — invalid redirect_uri: ${resolvedRedirectUri}`);
    return c.text('Invalid redirect_uri', 400);
  }

  // Issue auth code — store redirect_uri and agent_label alongside the code
  const code = generateToken();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  await db.run(`
    INSERT INTO auth_codes (code, user_id, code_challenge, redirect_uri, agent_label, expires_at, used)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `, code, user.id, code_challenge, resolvedRedirectUri, agent_label ?? '', expiresAt);

  const callbackUrl = new URL(resolvedRedirectUri);
  callbackUrl.searchParams.set('code', code);
  if (state) callbackUrl.searchParams.set('state', state);

  console.log(`[oauth] login success for user ${user.username}, redirecting to ${callbackUrl.origin}${callbackUrl.pathname}`);
  return c.redirect(callbackUrl.toString());
});

// POST /oauth/token
oauthRouter.post('/oauth/token', async (c) => {
  const ip = c.req.header('x-forwarded-for') ?? 'unknown';
  if (!checkRateLimit(ip)) return c.text('Too many requests', 429);

  const body = await c.req.parseBody();
  const grantType = body['grant_type'] as string;
  console.log(`[oauth] POST /oauth/token grant_type=${grantType} from ${ip}`);

  if (grantType === 'authorization_code') {
    return handleAuthCode(c, body as Record<string, string>);
  } else if (grantType === 'refresh_token') {
    return handleRefreshToken(c, body as Record<string, string>);
  }

  console.log(`[oauth] unsupported grant_type: ${grantType}`);
  return c.json({ error: 'unsupported_grant_type' }, 400);
});

async function handleAuthCode(c: any, body: Record<string, string>) {
  const { code, code_verifier, redirect_uri } = body;
  const db = getDb();

  const authCode = await db.get(`
    SELECT * FROM auth_codes WHERE code = ? AND used = 0 AND expires_at > ?
  `, code, new Date().toISOString()) as any;

  if (!authCode) {
    const anyCode = await db.get('SELECT used, expires_at FROM auth_codes WHERE code = ?', code) as any;
    if (anyCode?.used) {
      console.log(`[oauth] auth code exchange failed — code already used`);
    } else if (anyCode) {
      console.log(`[oauth] auth code exchange failed — code expired at ${anyCode.expires_at}`);
    } else {
      console.log(`[oauth] auth code exchange failed — code not found`);
    }
    return c.json({ error: 'invalid_grant' }, 400);
  }

  // RFC 6749 §4.1.3: if redirect_uri was present in the authorization request,
  // it MUST be provided here and MUST be an exact match.
  if (authCode.redirect_uri) {
    if (!redirect_uri || redirect_uri !== authCode.redirect_uri) {
      console.log(`[oauth] auth code exchange failed — redirect_uri mismatch`);
      return c.json({ error: 'invalid_grant' }, 400);
    }
  }

  const valid = await verifyCodeChallenge(code_verifier, authCode.code_challenge);
  if (!valid) {
    console.log(`[oauth] auth code exchange failed — PKCE verification failed`);
    return c.json({ error: 'invalid_grant' }, 400);
  }

  // Mark used
  await db.run('UPDATE auth_codes SET used = 1 WHERE code = ?', code);

  const accessToken = generateToken();
  const refreshToken = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString(); // 1 hour
  const agentLabel = authCode.agent_label || null;

  // Revoke any existing token for this user
  await db.run('DELETE FROM oauth_tokens WHERE user_id = ?', authCode.user_id);

  await db.run(`
    INSERT INTO oauth_tokens (access_token, user_id, refresh_token, agent_label, expires_at, scope)
    VALUES (?, ?, ?, ?, ?, 'read write')
  `, accessToken, authCode.user_id, refreshToken, agentLabel, expiresAt);

  console.log(`[oauth] issued token for user_id=${authCode.user_id} agentLabel=${agentLabel} expires=${expiresAt}`);
  return c.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: refreshToken,
    scope: 'read write',
  });
}

async function handleRefreshToken(c: any, body: Record<string, string>) {
  const { refresh_token } = body;
  const db = getDb();

  const token = await db.get('SELECT * FROM oauth_tokens WHERE refresh_token = ?', refresh_token) as any;
  if (!token) {
    console.log(`[oauth] refresh token not found`);
    return c.json({ error: 'invalid_grant' }, 400);
  }
  console.log(`[oauth] refreshing token for user_id=${token.user_id}`);

  const accessToken = generateToken();
  const newRefresh = generateToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  await db.run(`
    DELETE FROM oauth_tokens WHERE refresh_token = ?
  `, refresh_token);

  await db.run(`
    INSERT INTO oauth_tokens (access_token, user_id, refresh_token, agent_label, expires_at, scope)
    VALUES (?, ?, ?, ?, ?, 'read write')
  `, accessToken, token.user_id, newRefresh, token.agent_label, expiresAt);

  return c.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: newRefresh,
    scope: 'read write',
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
