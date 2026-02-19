# MCP Task Manager — Agent Brief v3

**Project:** `mcp-taskmanager`
**Version:** 3.0
**Stack:** TypeScript + Bun + Hono + SQLite
**MCP Spec:** 2025-06-18

---

# PART 1 — SUMMARY (Quick Reference)

## What We're Building
A Bun server that does two things in one process:
1. An **MCP server** that Claude agents connect to as a Claude.ai Connector
2. An **Admin UI** that humans use to manage users

---

## The Golden Rule
| Who | Controls What |
|-----|--------------|
| Humans (via Admin UI) | Users — create, confirm, disable, promote |
| AI Agents (via MCP) | Projects and Tasks only |

AI agents have **zero** user management tools. Full stop.

---

## User Roles
- **Superadmin** — one, set via env var, promotes/demotes admins, cannot be disabled
- **Admin** — created by superadmin, manages users and can view everything
- **Member** — a confirmed user who exists as an assignable entity for agents

---

## Credentials & OAuth
- Admin creates a user → system auto-generates a **human-readable username** (`blue-falcon-429` format) and a **random strong password**
- These are shown **once only** on a one-time credential display page after creation
- Superadmin can regenerate credentials at any time → triggers the same one-time display page
- User takes their username + password, goes to **claude.ai → Settings → Connectors → Add custom connector**, pastes the MCP URL, hits connect, types credentials into the OAuth popup → done forever
- OAuth Client ID / Secret supported on the server but optional — not required for this use case
- One credential set per user, no exceptions

---

## Admin UI Pages (Embedded in Hono, server-rendered, no JS framework)
- `/admin` — Dashboard (stats, recent activity)
- `/admin/users` — User list with filter, per-row actions
- `/admin/users/new` — Create user (generates credentials on submit)
- `/admin/users/:id` — User detail + credential regeneration (superadmin only)
- `/admin/users/:id/credentials` — One-time credential display page
- `/admin/projects` — Read-only project overview
- `/admin/projects/:id` — Project detail, member list, task list (read-only)
- `/admin/activity` — Global agent activity log (last 500 entries, filterable by user)
- `/admin/settings` — Superadmin only: revoke all tokens, DB export
- `/admin/login` + `/admin/logout`

---

## MCP Tools (What Agents Can Do)
**Projects:** create, list, get, assign member, remove member, delete

**Tasks:** create, list, get, update, set status, assign, delete, add comment, set dependencies (blocks)

**Users (read-only):** list available users, get user profile

**Dashboard:** get summary stats

---

## MCP Protocol Features Used
- Structured content + output schemas on every tool
- Tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) on every tool
- Resources with annotations (projects, tasks, users, dashboard)
- Resource change notifications (push on any data mutation)
- Prompts (daily standup, project brief, assign unassigned tasks)
- SSE transport (primary) + Streamable HTTP (secondary)
- Full OAuth 2.0 + PKCE auth server built in

---

## Activity Log
- Global feed, last 500 entries
- Captures: timestamp, agent name/label, username, tool called, success/error, input summary
- Filterable by user
- Visible to admins and superadmin only

---

## Named Agent Identity
- Optional `agent_label` field passed at OAuth time (e.g. "Jane's Work Claude")
- Stored on the token record, shown in activity log
- If not provided, defaults to the username

---

## Task Features
- Status: `pending` → `in_progress` → `completed` / `cancelled`
- Priority: `low`, `medium`, `high`, `urgent`
- Comments: agents can append notes without changing status
- Dependencies: "this task blocks [task IDs]" — simple one-directional
- Due dates: dashboard widget shows overdue + due within 24hrs

---

## Token Visibility (Admin UI)
Per-user on the User Detail page:
- Whether a token exists (connected or never connected)
- Last used timestamp
- Individual revoke button

---

## Hosting
- Single Bun process, one deploy
- Needs public HTTPS URL (Railway or Render recommended)
- SSE deprecation coming — Streamable HTTP implemented as fallback

---

---

# PART 2 — TECHNICAL SPECIFICATION

## Data Model

### users
```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT,                              -- admin reference only, not used for auth
  username      TEXT UNIQUE NOT NULL,              -- generated: "blue-falcon-429" format
  password_hash TEXT NOT NULL,                     -- Argon2id via Bun.password
  role          TEXT NOT NULL DEFAULT 'member',    -- 'member' | 'admin'
  confirmed     INTEGER NOT NULL DEFAULT 1,        -- auto-confirmed on creation
  disabled      INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
```

### projects
```sql
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  created_by  TEXT NOT NULL,                       -- agent identifier string
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
```

### project_members
```sql
CREATE TABLE project_members (
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id),
  role        TEXT NOT NULL DEFAULT 'member',      -- 'owner' | 'member'
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
```

### tasks
```sql
CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  priority     TEXT NOT NULL DEFAULT 'medium',
  assigned_to  TEXT REFERENCES users(id),
  created_by   TEXT NOT NULL,                      -- agent identifier string
  due_date     TEXT,
  completed_at TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
```

### task_comments
```sql
CREATE TABLE task_comments (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_by TEXT NOT NULL,                        -- agent identifier string
  created_at TEXT NOT NULL
);
```

### task_dependencies
```sql
CREATE TABLE task_dependencies (
  task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  blocked_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, blocked_task_id)
);
```

### oauth_tokens
```sql
CREATE TABLE oauth_tokens (
  access_token  TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  refresh_token TEXT NOT NULL UNIQUE,
  agent_label   TEXT,                              -- optional: "Jane's Work Claude"
  last_used_at  TEXT,
  expires_at    TEXT NOT NULL,
  scope         TEXT NOT NULL DEFAULT 'read write'
);
```

### auth_codes
```sql
CREATE TABLE auth_codes (
  code           TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  code_challenge TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  used           INTEGER NOT NULL DEFAULT 0
);
```

### admin_sessions
```sql
CREATE TABLE admin_sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

### activity_log
```sql
CREATE TABLE activity_log (
  id           TEXT PRIMARY KEY,
  user_id      TEXT REFERENCES users(id),
  agent_label  TEXT,
  tool_name    TEXT NOT NULL,
  input_summary TEXT,                              -- truncated JSON of tool inputs
  success      INTEGER NOT NULL DEFAULT 1,
  error_msg    TEXT,
  created_at   TEXT NOT NULL
);
```
> Enforce the 500-entry cap with a `AFTER INSERT` trigger that deletes the oldest row when count exceeds 500.

---

## Username Generation

Generate usernames in the format `word-word-NNN` using two lists of common short adjectives and nouns, plus a random 3-digit number. Examples: `blue-falcon-429`, `fast-river-817`, `cold-pine-203`.

Keep two hardcoded arrays in a `src/utils/username.ts` file:
- ~100 adjectives: `blue`, `fast`, `cold`, `bright`, `dark`, `sharp`, `soft`, `wild`, etc.
- ~100 nouns: `falcon`, `river`, `pine`, `stone`, `wolf`, `ember`, `coast`, `drift`, etc.

On generation: pick one from each array at random + random 3-digit number. Check for uniqueness in DB — regenerate on collision (extremely rare).

Password generation: 16 characters, random mix of uppercase, lowercase, numbers, and symbols from a safe set (`!@#$%^&*`). Use `crypto.getRandomValues()`.

---

## File Structure

```
mcp-taskmanager/
├── src/
│   ├── index.ts
│   ├── db.ts
│   ├── types.ts
│   ├── utils/
│   │   ├── username.ts          # Username + password generation
│   │   └── crypto.ts            # Token generation helpers
│   ├── admin/
│   │   ├── middleware.ts        # Session auth guard
│   │   ├── routes.ts
│   │   └── views/
│   │       ├── layout.tsx
│   │       ├── login.tsx
│   │       ├── dashboard.tsx
│   │       ├── activity.tsx
│   │       ├── settings.tsx
│   │       └── users/
│   │           ├── list.tsx
│   │           ├── new.tsx
│   │           ├── detail.tsx
│   │           └── credentials.tsx
│   │       └── projects/
│   │           ├── list.tsx
│   │           └── detail.tsx
│   ├── oauth/
│   │   ├── server.ts
│   │   ├── middleware.ts
│   │   └── pkce.ts
│   ├── mcp/
│   │   ├── server.ts
│   │   ├── tools/
│   │   │   ├── projects.ts
│   │   │   ├── tasks.ts
│   │   │   ├── users.ts
│   │   │   └── dashboard.ts
│   │   ├── resources.ts
│   │   └── prompts.ts
│   └── static/
│       └── admin.css
├── package.json
├── tsconfig.json
└── bunfig.toml
```

---

## Route Map

```
# Admin UI
GET  /admin/login
POST /admin/login
POST /admin/logout
GET  /admin
GET  /admin/users
GET  /admin/users/new
POST /admin/users
GET  /admin/users/:id
GET  /admin/users/:id/credentials?token=
POST /admin/users/:id/confirm
POST /admin/users/:id/disable
POST /admin/users/:id/enable
POST /admin/users/:id/promote          # superadmin only
POST /admin/users/:id/demote           # superadmin only
POST /admin/users/:id/regenerate-creds # superadmin only → one-time display
POST /admin/users/:id/revoke-token     # revoke individual OAuth token
GET  /admin/projects
GET  /admin/projects/:id
POST /admin/projects/:id/delete
GET  /admin/activity                   # global log, ?user_id= filter
GET  /admin/settings                   # superadmin only
POST /admin/settings/revoke-all-tokens
POST /admin/settings/export-db

# Static
GET  /static/admin.css

# OAuth
GET  /.well-known/oauth-authorization-server
GET  /.well-known/oauth-protected-resource
GET  /oauth/authorize
POST /oauth/authorize
POST /oauth/token

# MCP
GET  /mcp/sse                          # SSE transport, Bearer auth
POST /mcp                              # Streamable HTTP, Bearer auth

# Health
GET  /health
```

---

## MCP Tool Specifications

### Tool: `tasks_create`
```typescript
inputs: {
  project_id:   z.string(),
  title:        z.string(),
  description:  z.string().optional(),
  priority:     z.enum(['low','medium','high','urgent']).default('medium'),
  assigned_to:  z.string().optional(),   // must be confirmed, non-disabled project member
  due_date:     z.string().optional(),   // ISO 8601
}
annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
```

### Tool: `tasks_add_comment`
```typescript
inputs: {
  task_id: z.string(),
  content: z.string(),
}
annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
// Does NOT change task status or any other field
```

### Tool: `tasks_set_dependencies`
```typescript
inputs: {
  task_id:          z.string(),
  blocks_task_ids:  z.array(z.string()),  // replaces existing dependencies
}
annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true }
// "This task blocks these tasks"
// Pass empty array to clear all dependencies
```

### All other tools
Follow the same pattern as v2. Every tool returns:
```typescript
{
  structuredContent: resultObject,
  content: [{ type: "text", text: JSON.stringify(resultObject, null, 2) }]
}
```

---

## OAuth Server Details

### Credential Display Flow
1. `POST /admin/users` creates user, generates username + password
2. Password is hashed and stored — plaintext exists only in memory during this request
3. Plaintext password is placed in an encrypted flash cookie (expires 5 min)
4. A `credential_view_token` (UUID) is stored on the user row with a 5-minute expiry
5. Redirect to `/admin/users/:id/credentials?token=<credential_view_token>`
6. Page validates token — if expired or already used, show error
7. If valid: mark token used, clear from DB, render credentials pulled from flash cookie
8. Page displays: MCP URL, username, password — each with a `[Copy]` button
9. Includes step-by-step Claude connector instructions
10. Single "I've saved these — continue" button

### Credential Regeneration (Superadmin only)
- `POST /admin/users/:id/regenerate-creds`
- Generates new username + password
- Revokes any existing OAuth token for this user (forces re-auth)
- Redirects to the same one-time credential display page flow

### OAuth Authorize Page
- Simple HTML form: username + password fields
- Optional `agent_label` field ("Give this connection a name, e.g. Work Claude") 
- On valid login: store `agent_label` on the issued token record
- Claude's OAuth callback URL is `https://claude.ai/api/mcp/auth_callback` — ensure this is allowed in CORS and redirect URI validation

### Token Lifecycle
- Access token: 1-hour expiry
- Refresh token: 30-day expiry
- `last_used_at` updated on every authenticated MCP request
- On revoke: delete both token records from DB

---

## Admin UI Design Rules

- `hono/jsx` for all server-rendered pages
- Single layout component wrapping everything
- One `/static/admin.css` file — clean, minimal, monochrome + `#2563EB` blue accent
- **No purple, no gradients**
- Destructive actions always via POST form, never bare GET links
- Flash messages via short-lived cookie (read once, deleted)
- The only JavaScript on the entire UI: `navigator.clipboard.writeText()` on the credential display page for the `[Copy]` buttons
- Responsive — mobile-friendly

---

## Environment Variables

```bash
PORT=3000
DATABASE_PATH=./taskmanager.db
BASE_URL=https://your-domain.com
SUPERADMIN_EMAIL=superadmin@example.com
SUPERADMIN_INITIAL_PASSWORD=changeme123   # first run only
SESSION_SECRET=<random-64-char-hex>
FLASH_SECRET=<random-64-char-hex>         # for encrypted flash cookie
```

---

## Startup Sequence

1. Create all DB tables if not exists
2. Apply `AFTER INSERT` trigger on `activity_log` for 500-entry cap
3. Seed superadmin from env if no user with `SUPERADMIN_EMAIL` exists
4. Log to stdout:
```
✅  MCP SSE:        https://<BASE_URL>/mcp/sse
✅  Admin UI:       https://<BASE_URL>/admin
✅  OAuth discovery: https://<BASE_URL>/.well-known/oauth-authorization-server
⚠️  Superadmin created — change your password immediately.  (first run only)
```

---

## Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "latest",
    "hono": "latest",
    "zod": "latest",
    "uuid": "latest"
  },
  "devDependencies": {
    "typescript": "latest",
    "@types/bun": "latest"
  }
}
```

No external auth or password library — `Bun.password` provides Argon2id natively. No frontend build step.

---

## Security Checklist

- Passwords hashed with `Bun.password.hash()` (Argon2id)
- Plaintext password never written to DB — memory only during creation request
- Session cookies: `HttpOnly`, `Secure`, `SameSite=Strict`, 8hr expiry
- Flash cookie: encrypted, `HttpOnly`, 5min expiry, read-once
- Superadmin identity resolved at runtime from `SUPERADMIN_EMAIL` env var only
- MCP bearer tokens and admin sessions are entirely separate auth systems
- Agents receive only `{ id, name, username, role }` from user lookups — no hashes, no disabled status, no internal fields
- Rate limit `/oauth/authorize` POST + `/oauth/token` to 10 req/min per IP
- PKCE `code_verifier` validated against stored `code_challenge` on every token exchange
- All destructive admin actions via POST — no destructive GET routes

---

*Brief v3 — February 2026 — Build target: Claude Code agent*
