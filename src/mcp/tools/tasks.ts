import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb, logActivity } from '../../db.ts';
import { generateId } from '../../utils/crypto.ts';
import { notifyResourceChange } from '../resources.ts';

export function registerTaskTools(server: McpServer) {
  // tasks_create
  server.tool(
    'tasks_create',
    'Create a new task in a project',
    {
      project_id: z.string(),
      title: z.string().min(1).max(500),
      description: z.string().max(5000).optional(),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
      assigned_to: z.string().optional(),
      due_date: z.string().optional(),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async ({ project_id, title, description, priority, assigned_to, due_date }, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();

      // Validate assignee is a confirmed, non-disabled project member
      if (assigned_to) {
        const member = db.query(`
          SELECT pm.user_id FROM project_members pm
          JOIN users u ON pm.user_id = u.id
          WHERE pm.project_id = ? AND pm.user_id = ? AND u.confirmed = 1 AND u.disabled = 0
        `).get(project_id, assigned_to);
        if (!member) throw new Error('Assignee must be a confirmed, active project member');
      }

      const id = generateId();
      const now = new Date().toISOString();
      db.query(`
        INSERT INTO tasks (id, project_id, title, description, status, priority, assigned_to, created_by, due_date, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
      `).run(id, project_id, title, description ?? null, priority, assigned_to ?? null, agentLabel, due_date ?? null, now, now);

      const task = db.query('SELECT * FROM tasks WHERE id = ?').get(id);
      logActivity({ user_id: user?.id ?? null, agent_label: agentLabel, tool_name: 'tasks_create', input_summary: JSON.stringify({ project_id, title }).slice(0, 500), success: true });
      notifyResourceChange();
      const result = { task };
      return { structuredContent: result, content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // tasks_list
  server.tool(
    'tasks_list',
    'List tasks, optionally filtered by project or status',
    {
      project_id: z.string().optional(),
      status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
      assigned_to: z.string().optional(),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async ({ project_id, status, assigned_to }, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();

      const conditions: string[] = [];
      const params: any[] = [];
      if (project_id) { conditions.push('project_id = ?'); params.push(project_id); }
      if (status) { conditions.push('status = ?'); params.push(status); }
      if (assigned_to) { conditions.push('assigned_to = ?'); params.push(assigned_to); }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const tasks = db.query(`SELECT * FROM tasks ${where} ORDER BY created_at DESC`).all(...params);
      logActivity({ user_id: user?.id ?? null, agent_label: agentLabel, tool_name: 'tasks_list', success: true });
      const result = { tasks };
      return { structuredContent: result, content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // tasks_get
  server.tool(
    'tasks_get',
    'Get a task with its comments and dependencies',
    { task_id: z.string() },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async ({ task_id }, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();
      const task = db.query('SELECT * FROM tasks WHERE id = ?').get(task_id);
      if (!task) throw new Error(`Task not found: ${task_id}`);
      const comments = db.query('SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC').all(task_id);
      const blocks = db.query('SELECT blocked_task_id FROM task_dependencies WHERE task_id = ?').all(task_id);
      const blockedBy = db.query('SELECT task_id FROM task_dependencies WHERE blocked_task_id = ?').all(task_id);
      logActivity({ user_id: user?.id ?? null, agent_label: agentLabel, tool_name: 'tasks_get', success: true });
      const result = { task, comments, blocks, blockedBy };
      return { structuredContent: result, content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // tasks_update
  server.tool(
    'tasks_update',
    'Update task title, description, priority, or due date',
    {
      task_id: z.string(),
      title: z.string().min(1).max(500).optional(),
      description: z.string().max(5000).optional(),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
      due_date: z.string().nullable().optional(),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async ({ task_id, title, description, priority, due_date }, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();
      const task = db.query('SELECT * FROM tasks WHERE id = ?').get(task_id) as any;
      if (!task) throw new Error(`Task not found: ${task_id}`);
      const now = new Date().toISOString();
      db.query(`
        UPDATE tasks SET
          title = COALESCE(?, title),
          description = CASE WHEN ? IS NOT NULL THEN ? ELSE description END,
          priority = COALESCE(?, priority),
          due_date = CASE WHEN ? IS NOT NULL THEN ? ELSE due_date END,
          updated_at = ?
        WHERE id = ?
      `).run(
        title ?? null, description !== undefined ? 1 : null, description ?? null,
        priority ?? null, due_date !== undefined ? 1 : null, due_date ?? null,
        now, task_id,
      );
      const updated = db.query('SELECT * FROM tasks WHERE id = ?').get(task_id);
      logActivity({ user_id: user?.id ?? null, agent_label: agentLabel, tool_name: 'tasks_update', success: true });
      notifyResourceChange();
      const result = { task: updated };
      return { structuredContent: result, content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // tasks_set_status
  server.tool(
    'tasks_set_status',
    'Update the status of a task',
    {
      task_id: z.string(),
      status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async ({ task_id, status }, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();
      const now = new Date().toISOString();
      const completedAt = status === 'completed' ? now : null;
      db.query(`
        UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?
      `).run(status, completedAt, now, task_id);
      const task = db.query('SELECT * FROM tasks WHERE id = ?').get(task_id);
      if (!task) throw new Error(`Task not found: ${task_id}`);
      logActivity({ user_id: user?.id ?? null, agent_label: agentLabel, tool_name: 'tasks_set_status', input_summary: JSON.stringify({ task_id, status }), success: true });
      notifyResourceChange();
      const result = { task };
      return { structuredContent: result, content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // tasks_assign
  server.tool(
    'tasks_assign',
    'Assign a task to a project member (or unassign)',
    {
      task_id: z.string(),
      user_id: z.string().nullable(),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async ({ task_id, user_id }, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();
      const task = db.query('SELECT * FROM tasks WHERE id = ?').get(task_id) as any;
      if (!task) throw new Error(`Task not found: ${task_id}`);

      if (user_id) {
        const member = db.query(`
          SELECT pm.user_id FROM project_members pm
          JOIN users u ON pm.user_id = u.id
          WHERE pm.project_id = ? AND pm.user_id = ? AND u.confirmed = 1 AND u.disabled = 0
        `).get(task.project_id, user_id);
        if (!member) throw new Error('Assignee must be a confirmed, active project member');
      }

      const now = new Date().toISOString();
      db.query('UPDATE tasks SET assigned_to = ?, updated_at = ? WHERE id = ?').run(user_id, now, task_id);
      const updated = db.query('SELECT * FROM tasks WHERE id = ?').get(task_id);
      logActivity({ user_id: user?.id ?? null, agent_label: agentLabel, tool_name: 'tasks_assign', success: true });
      notifyResourceChange();
      const result = { task: updated };
      return { structuredContent: result, content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // tasks_delete
  server.tool(
    'tasks_delete',
    'Delete a task',
    { task_id: z.string() },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    async ({ task_id }, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();
      db.query('DELETE FROM tasks WHERE id = ?').run(task_id);
      logActivity({ user_id: user?.id ?? null, agent_label: agentLabel, tool_name: 'tasks_delete', success: true });
      notifyResourceChange();
      const result = { ok: true, deleted: task_id };
      return { structuredContent: result, content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // tasks_add_comment
  server.tool(
    'tasks_add_comment',
    'Add a comment to a task without changing its status',
    {
      task_id: z.string(),
      content: z.string().min(1).max(5000),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async ({ task_id, content }, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();
      const id = generateId();
      const now = new Date().toISOString();
      db.query(`
        INSERT INTO task_comments (id, task_id, content, created_by, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, task_id, content, agentLabel, now);
      const comment = db.query('SELECT * FROM task_comments WHERE id = ?').get(id);
      logActivity({ user_id: user?.id ?? null, agent_label: agentLabel, tool_name: 'tasks_add_comment', success: true });
      notifyResourceChange();
      const result = { comment };
      return { structuredContent: result, content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // tasks_set_dependencies
  server.tool(
    'tasks_set_dependencies',
    'Set which tasks this task blocks (replaces existing dependencies). Pass empty array to clear.',
    {
      task_id: z.string(),
      blocks_task_ids: z.array(z.string()),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async ({ task_id, blocks_task_ids }, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();
      db.query('DELETE FROM task_dependencies WHERE task_id = ?').run(task_id);
      for (const blockedId of blocks_task_ids) {
        db.query('INSERT OR IGNORE INTO task_dependencies (task_id, blocked_task_id) VALUES (?, ?)').run(task_id, blockedId);
      }
      logActivity({ user_id: user?.id ?? null, agent_label: agentLabel, tool_name: 'tasks_set_dependencies', success: true });
      notifyResourceChange();
      const result = { ok: true, task_id, blocks_task_ids };
      return { structuredContent: result, content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
