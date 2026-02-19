# MCP Server with OAuth for Claude Connectors — Tasks API

## Overview

This document outlines the best approach for building an MCP (Model Context Protocol) server with OAuth authentication that connects to Claude's connector ecosystem, allowing an agent to insert, retrieve, delete, and mark tasks as complete.

---

## Recommended Stack

**Language:** TypeScript  
**Runtime:** Bun  
**Framework:** Hono (HTTP layer) + `@modelcontextprotocol/sdk`  
**Auth:** OAuth 2.0 with PKCE  
**Storage:** SQLite via `bun:sqlite` (or swap to Postgres)

### Why TypeScript over Laravel here

- The official Anthropic MCP SDK is TypeScript-first (`@modelcontextprotocol/sdk`)
- Claude's connector ecosystem expects MCP servers that follow the standard SSE/HTTP transport spec, which Node.js/Bun handles cleanly
- Fastest path to getting the OAuth flow working with Claude.ai's connector UI

---

## Architecture

```
Claude.ai Connector (OAuth flow)
        ↓
Your MCP Server (TypeScript/Bun)
        ↓
Task Storage (SQLite locally, or Postgres)
```

---

## Project Structure

```
mcp-tasks/
├── src/
│   ├── index.ts          # Hono app, routes
│   ├── oauth.ts          # Authorization server logic
│   ├── mcp.ts            # MCP server + tool definitions
│   ├── db.ts             # SQLite/Postgres setup
│   └── middleware/
│       └── auth.ts       # Bearer token validation
├── package.json
└── bunfig.toml
```

---

## OAuth Flow

Claude's connector OAuth beta requires your MCP server to expose the following endpoints:

| Endpoint | Purpose |
|----------|---------|
| `GET /.well-known/oauth-authorization-server` | Metadata endpoint |
| `GET /authorize` | Shows login UI (username/password form) |
| `POST /token` | Exchanges code for access token |
| `POST /token` (refresh) | Token refresh |

Your MCP tools then sit behind bearer token auth on the SSE endpoint.

> **Important:** Claude's connector OAuth currently expects the authorization server and the MCP server to be on the **same origin** or properly CORS-configured. Keep them in the same Hono app to avoid headaches.

---

## The Four MCP Tools

```
tasks/insert    → Create a task
tasks/retrieve  → List/get tasks (filterable)
tasks/delete    → Delete by ID
tasks/complete  → Mark as completed
```

---

## Core Code — `mcp.ts`

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const server = new McpServer({ name: "tasks", version: "1.0.0" });

server.tool("tasks_insert", {
  title: z.string(),
  description: z.string().optional(),
  due_date: z.string().optional(),
}, async ({ title, description, due_date }, { userId }) => {
  const task = await db.createTask({ title, description, due_date, userId });
  return { content: [{ type: "text", text: JSON.stringify(task) }] };
});

server.tool("tasks_retrieve", {
  filter: z.enum(["all", "pending", "completed"]).default("all"),
}, async ({ filter }, { userId }) => {
  const tasks = await db.getTasks(userId, filter);
  return { content: [{ type: "text", text: JSON.stringify(tasks) }] };
});

server.tool("tasks_delete", {
  task_id: z.string(),
}, async ({ task_id }, { userId }) => {
  await db.deleteTask(task_id, userId);
  return { content: [{ type: "text", text: "Task deleted." }] };
});

server.tool("tasks_complete", {
  task_id: z.string(),
}, async ({ task_id }, { userId }) => {
  const task = await db.markComplete(task_id, userId);
  return { content: [{ type: "text", text: JSON.stringify(task) }] };
});
```

---

## Hosting Requirements

Claude.ai requires a **public HTTPS URL** to reach the OAuth endpoints. Recommended hosting options:

- **Railway** — easy deploys, free tier, HTTPS out of the box
- **Render** — similar to Railway, good for small servers
- **Hetzner VPS** — more control, cheap, good from SA

---

## Next Steps

1. Scaffold the Hono app with Bun (`bun init`)
2. Install dependencies: `bun add hono @modelcontextprotocol/sdk zod`
3. Build `oauth.ts` with the authorization server logic
4. Build `db.ts` with SQLite task schema
5. Wire up `mcp.ts` tools
6. Deploy to Railway/Render and register the connector URL in Claude.ai

---

*Generated February 2026 — Claude Sonnet 4.6*
