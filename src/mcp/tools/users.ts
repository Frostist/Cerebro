import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb, logActivity } from '../../db.ts';

export function registerUserTools(server: McpServer) {
  // users_list — read-only, returns safe subset only
  server.tool(
    'users_list',
    'List available (confirmed, active) users',
    {},
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async (_args, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();
      const users = db.query(`
        SELECT id, name, username, role FROM users
        WHERE confirmed = 1 AND disabled = 0
        ORDER BY name ASC
      `).all();
      logActivity({ user_id: user?.id ?? null, agent_label: agentLabel, tool_name: 'users_list', success: true });
      const result = { users };
      return { structuredContent: result, content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // users_get — read-only, safe subset
  server.tool(
    'users_get',
    'Get a user profile by ID',
    { user_id: z.string() },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async ({ user_id }, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();
      const found = db.query(`
        SELECT id, name, username, role FROM users
        WHERE id = ? AND confirmed = 1 AND disabled = 0
      `).get(user_id);
      if (!found) throw new Error(`User not found: ${user_id}`);
      logActivity({ user_id: user?.id ?? null, agent_label: agentLabel, tool_name: 'users_get', success: true });
      const result = { user: found };
      return { structuredContent: result, content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
