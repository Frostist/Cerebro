import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb, logActivity } from '../../db.ts';
import { generateId } from '../../utils/crypto.ts';
import { notifyResourceChange } from '../resources.ts';

export function registerProjectTools(server: McpServer) {
  // projects_create
  server.tool(
    'projects_create',
    'Create a new project',
    {
      name: z.string().min(1).max(200),
      description: z.string().max(2000).optional(),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async ({ name, description }, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();
      const id = generateId();
      const now = new Date().toISOString();
      const createdBy = agentLabel;

      try {
        await db.run(`
          INSERT INTO projects (id, name, description, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `, id, name, description ?? null, createdBy, now, now);

        const project = await db.get('SELECT * FROM projects WHERE id = ?', id) as any;
        logActivity({ user_id: user?.id ?? null, agent_label: agentLabel, tool_name: 'projects_create', input_summary: JSON.stringify({ name }).slice(0, 500), success: true });
        notifyResourceChange();
        const result = { project };
        return { structuredContent: result, content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        logActivity({ user_id: user?.id ?? null, agent_label: agentLabel, tool_name: 'projects_create', success: false, error_msg: e.message });
        throw e;
      }
    },
  );

  // projects_list
  server.tool(
    'projects_list',
    'List all projects',
    {},
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async (_args, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();
      const projects = await db.all('SELECT * FROM projects ORDER BY created_at DESC');
      logActivity({ user_id: user?.id ?? null, agent_label: agentLabel, tool_name: 'projects_list', success: true });
      const result = { projects };
      return { structuredContent: result, content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // projects_get
  server.tool(
    'projects_get',
    'Get a project with its members and task summary',
    { project_id: z.string() },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async ({ project_id }, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();
      const project = await db.get('SELECT * FROM projects WHERE id = ?', project_id);
      if (!project) throw new Error(`Project not found: ${project_id}`);
      const members = await db.all(`
        SELECT pm.role, pm.assigned_at, u.id, u.name, u.username
        FROM project_members pm JOIN users u ON pm.user_id = u.id
        WHERE pm.project_id = ?
      `, project_id);
      const tasks = await db.all('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC', project_id);
      logActivity({ user_id: user?.id ?? null, agent_label: agentLabel, tool_name: 'projects_get', success: true });
      const result = { project, members, tasks };
      return { structuredContent: result, content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // projects_assign_member
  server.tool(
    'projects_assign_member',
    'Add a user as a member of a project',
    {
      project_id: z.string(),
      user_id: z.string(),
      role: z.enum(['owner', 'member']).default('member'),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async ({ project_id, user_id, role }, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();
      const member = await db.get('SELECT id, confirmed, disabled FROM users WHERE id = ?', user_id) as any;
      if (!member || !member.confirmed || member.disabled) throw new Error('User not available');
      const now = new Date().toISOString();
      await db.run(`
        INSERT OR REPLACE INTO project_members (project_id, user_id, role, assigned_at)
        VALUES (?, ?, ?, ?)
      `, project_id, user_id, role, now);
      logActivity({ user_id: user?.id ?? null, agent_label: agentLabel, tool_name: 'projects_assign_member', success: true });
      notifyResourceChange();
      const result = { ok: true, project_id, user_id, role };
      return { structuredContent: result, content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // projects_remove_member
  server.tool(
    'projects_remove_member',
    'Remove a user from a project',
    { project_id: z.string(), user_id: z.string() },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    async ({ project_id, user_id }, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();
      await db.run('DELETE FROM project_members WHERE project_id = ? AND user_id = ?', project_id, user_id);
      logActivity({ user_id: user?.id ?? null, agent_label: agentLabel, tool_name: 'projects_remove_member', success: true });
      notifyResourceChange();
      const result = { ok: true };
      return { structuredContent: result, content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // projects_delete
  server.tool(
    'projects_delete',
    'Delete a project and all its tasks',
    { project_id: z.string() },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    async ({ project_id }, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();
      await db.run('DELETE FROM projects WHERE id = ?', project_id);
      logActivity({ user_id: user?.id ?? null, agent_label: agentLabel, tool_name: 'projects_delete', success: true });
      notifyResourceChange();
      const result = { ok: true, deleted: project_id };
      return { structuredContent: result, content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
