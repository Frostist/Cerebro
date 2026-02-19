/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { cors } from 'hono/cors';
import { initDb } from './db.ts';
import { oauthRouter } from './oauth/server.ts';
import { adminRouter } from './admin/routes.tsx';
import { bearerAuth } from './oauth/middleware.ts';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { registerProjectTools } from './mcp/tools/projects.ts';
import { registerTaskTools } from './mcp/tools/tasks.ts';
import { registerUserTools } from './mcp/tools/users.ts';
import { registerDashboardTools } from './mcp/tools/dashboard.ts';
import { initResources } from './mcp/resources.ts';
import { registerPrompts } from './mcp/prompts.ts';
import type { User } from './types.ts';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

// ─── App setup ────────────────────────────────────────────────────────────────

type Vars = { user: User; isSuperadmin: boolean; agentLabel: string };
const app = new Hono<{ Variables: Vars }>();

// Allowed CORS origins: claude.ai (and subdomains) plus localhost for development.
// The admin UI is server-rendered and same-origin, so it does not need a CORS entry.
const ALLOWED_ORIGINS = new Set([
  'https://claude.ai',
]);

app.use('/*', cors({
  origin: (origin) => {
    if (!origin) return null; // non-browser requests (curl, MCP server-side calls)
    if (ALLOWED_ORIGINS.has(origin)) return origin;
    // Allow any claude.ai subdomain (e.g. staging.claude.ai)
    try {
      const url = new URL(origin);
      if (url.protocol === 'https:' && url.hostname.endsWith('.claude.ai')) return origin;
    } catch { /* invalid origin */ }
    // Allow localhost in non-production environments for local testing
    if (process.env.NODE_ENV !== 'production' && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))) {
      return origin;
    }
    return null; // reject
  },
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type', 'Accept', 'Mcp-Session-Id'],
  exposeHeaders: ['Mcp-Session-Id'],
  credentials: true,
}));

// Request logger
app.use('/*', async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  console.log(`[http] ${c.req.method} ${c.req.path} → ${c.res.status} (${ms}ms)`);
});

app.get('/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }));

app.use('/static/*', serveStatic({ root: './src' }));

app.route('/', oauthRouter);
app.route('/', adminRouter);

// ─── MCP — SSE-compatible endpoint (GET + POST /mcp/sse) ─────────────────────
// Claude.ai sends both GET (to open the SSE stream) and POST (to send messages)
// to the same /mcp/sse URL, so we handle both methods here.

app.all('/mcp/sse', bearerAuth, async (c) => {
  const user = c.get('user');
  const agentLabel = c.get('agentLabel') ?? user?.username ?? 'unknown';
  return handleMcpRequest(c.req.raw, user, agentLabel);
});

// ─── MCP — Streamable HTTP (POST + DELETE /mcp) ──────────────────────────────

app.all('/mcp', bearerAuth, async (c) => {
  const user = c.get('user');
  const agentLabel = c.get('agentLabel') ?? user?.username ?? 'unknown';
  return handleMcpRequest(c.req.raw, user, agentLabel);
});

// ─── MCP request handler ──────────────────────────────────────────────────────

async function handleMcpRequest(req: Request, user: User, agentLabel: string): Promise<Response> {
  const server = buildMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);

  // Pass user context via authInfo.extra
  const authInfo: AuthInfo = {
    token: '',
    clientId: user.id,
    scopes: ['read', 'write'],
    extra: { user, agentLabel },
  };

  return transport.handleRequest(req, { authInfo });
}

// ─── MCP server factory ───────────────────────────────────────────────────────

function buildMcpServer(): McpServer {
  const server = new McpServer({ name: 'cerebro-taskmanager', version: '1.0.0' });
  registerProjectTools(server);
  registerTaskTools(server);
  registerUserTools(server);
  registerDashboardTools(server);
  initResources(server);
  registerPrompts(server);
  return server;
}

// ─── Startup ──────────────────────────────────────────────────────────────────

await initDb();

const port = Number(process.env.PORT ?? 3000);
let base = process.env.BASE_URL ?? `http://localhost:${port}`;
// Ensure BASE_URL always has a protocol (Railway sometimes strips it)
if (base && !base.startsWith('http://') && !base.startsWith('https://')) {
  base = `https://${base}`;
}
base = base.replace(/\/$/, '');

console.log(`✅  MCP SSE:         ${base}/mcp/sse`);
console.log(`✅  MCP HTTP:        ${base}/mcp`);
console.log(`✅  Admin UI:        ${base}/admin`);
console.log(`✅  OAuth discovery: ${base}/.well-known/oauth-authorization-server`);

export default { port, fetch: app.fetch };
