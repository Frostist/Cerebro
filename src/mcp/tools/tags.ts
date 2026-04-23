import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb, logActivity } from '../../db.ts';
import { generateId } from '../../utils/crypto.ts';
import { notifyResourceChange } from '../resources.ts';

export function registerTagTools(server: McpServer) {
  // tags_create - Create a new global tag
  server.tool(
    'tags_create',
    'Create a new global tag that can be applied to any task.',
    {
      name: z.string().min(1).max(50).describe('The name of the tag (e.g., "bug", "feature", "urgent").'),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async ({ name }, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();
      const id = generateId();
      const now = new Date().toISOString();

      try {
        await db.run(
          'INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)',
          id,
          name.trim().toLowerCase(),
          now
        );

        const tag = await db.get('SELECT * FROM tags WHERE id = ?', id);
        logActivity({
          user_id: user?.id ?? null,
          agent_label: agentLabel,
          tool_name: 'tags_create',
          input_summary: `name=${name}`,
          success: true,
        });
        const result = { tag };
        return {
          structuredContent: result,
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (e: any) {
        logActivity({
          user_id: user?.id ?? null,
          agent_label: agentLabel,
          tool_name: 'tags_create',
          success: false,
          error_msg: e.message,
        });
        throw e;
      }
    }
  );

  // tags_list - List all available tags
  server.tool(
    'tags_list',
    'List all available global tags.',
    {},
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async (_, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();

      const tags = await db.all('SELECT * FROM tags ORDER BY name ASC');

      logActivity({
        user_id: user?.id ?? null,
        agent_label: agentLabel,
        tool_name: 'tags_list',
        success: true,
      });

      const result = { tags, count: tags.length };
      return {
        structuredContent: result,
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // tags_delete - Delete a global tag
  server.tool(
    'tags_delete',
    'Permanently delete a global tag. This removes it from all tasks.',
    {
      tag_id: z.string().describe('The ID of the tag to delete.'),
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    async ({ tag_id }, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();

      const existing = await db.get('SELECT * FROM tags WHERE id = ?', tag_id);
      if (!existing) throw new Error(`Tag not found: ${tag_id}`);

      try {
        await db.run('DELETE FROM tags WHERE id = ?', tag_id);

        logActivity({
          user_id: user?.id ?? null,
          agent_label: agentLabel,
          tool_name: 'tags_delete',
          input_summary: `tag_id=${tag_id}, name=${existing.name}`,
          success: true,
        });
        notifyResourceChange();

        const result = { deleted: true, tag_id, name: existing.name };
        return {
          structuredContent: result,
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (e: any) {
        logActivity({
          user_id: user?.id ?? null,
          agent_label: agentLabel,
          tool_name: 'tags_delete',
          success: false,
          error_msg: e.message,
        });
        throw e;
      }
    }
  );

  // tasks_add_tag - Add a tag to a task
  server.tool(
    'tasks_add_tag',
    'Add an existing tag to a task.',
    {
      task_id: z.string().describe('The ID of the task.'),
      tag_id: z.string().describe('The ID of the tag to add.'),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async ({ task_id, tag_id }, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();

      // Check task and user access
      const task = await db.get('SELECT project_id FROM tasks WHERE id = ?', task_id);
      if (!task) throw new Error(`Task not found: ${task_id}`);

      const membership = await db.get(
        'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?',
        task.project_id,
        user?.id ?? ''
      );
      if (!membership) throw new Error('Access denied: You are not a member of this project.');

      // Check tag exists
      const tag = await db.get('SELECT * FROM tags WHERE id = ?', tag_id);
      if (!tag) throw new Error(`Tag not found: ${tag_id}`);

      try {
        await db.run(
          'INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
          task_id,
          tag_id
        );

        logActivity({
          user_id: user?.id ?? null,
          agent_label: agentLabel,
          tool_name: 'tasks_add_tag',
          input_summary: `task_id=${task_id}, tag_id=${tag_id}`,
          success: true,
        });
        notifyResourceChange();

        const result = { success: true, task_id, tag };
        return {
          structuredContent: result,
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (e: any) {
        logActivity({
          user_id: user?.id ?? null,
          agent_label: agentLabel,
          tool_name: 'tasks_add_tag',
          success: false,
          error_msg: e.message,
        });
        throw e;
      }
    }
  );

  // tasks_remove_tag - Remove a tag from a task
  server.tool(
    'tasks_remove_tag',
    'Remove a tag from a task.',
    {
      task_id: z.string().describe('The ID of the task.'),
      tag_id: z.string().describe('The ID of the tag to remove.'),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async ({ task_id, tag_id }, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();

      // Check task and user access
      const task = await db.get('SELECT project_id FROM tasks WHERE id = ?', task_id);
      if (!task) throw new Error(`Task not found: ${task_id}`);

      const membership = await db.get(
        'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?',
        task.project_id,
        user?.id ?? ''
      );
      if (!membership) throw new Error('Access denied: You are not a member of this project.');

      try {
        await db.run('DELETE FROM task_tags WHERE task_id = ? AND tag_id = ?', task_id, tag_id);

        logActivity({
          user_id: user?.id ?? null,
          agent_label: agentLabel,
          tool_name: 'tasks_remove_tag',
          input_summary: `task_id=${task_id}, tag_id=${tag_id}`,
          success: true,
        });
        notifyResourceChange();

        const result = { success: true, task_id, tag_id };
        return {
          structuredContent: result,
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (e: any) {
        logActivity({
          user_id: user?.id ?? null,
          agent_label: agentLabel,
          tool_name: 'tasks_remove_tag',
          success: false,
          error_msg: e.message,
        });
        throw e;
      }
    }
  );
}
