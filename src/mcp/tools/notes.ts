import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb, logActivity } from '../../db.ts';
import { generateId } from '../../utils/crypto.ts';
import { notifyResourceChange } from '../resources.ts';

export function registerNoteTools(server: McpServer) {
  // notes_create - Create a new note (personal, project-linked, or task-linked)
  server.tool(
    'notes_create',
    'Create a new note. Can be personal (no project/task), linked to a project, or linked to a task.',
    {
      title: z.string().min(1).max(200),
      content: z.string().min(1).max(50000),
      project_id: z.string().optional(),
      task_id: z.string().optional(),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async ({ title, content, project_id, task_id }, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();
      const id = generateId();
      const now = new Date().toISOString();

      // Validate project/task ownership if linking
      if (project_id) {
        const membership = await db.get(
          'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?',
          project_id,
          user?.id ?? ''
        );
        if (!membership) throw new Error(`Project not found or not a member: ${project_id}`);
      }

      if (task_id) {
        const task = await db.get(
          `SELECT t.project_id FROM tasks t
           JOIN project_members pm ON t.project_id = pm.project_id
           WHERE t.id = ? AND pm.user_id = ?`,
          task_id,
          user?.id ?? ''
        );
        if (!task) throw new Error(`Task not found or not a project member: ${task_id}`);
      }

      // Cannot link to both project and task simultaneously
      if (project_id && task_id) {
        throw new Error('Cannot link a note to both a project and a task. Choose one or neither.');
      }

      try {
        await db.run(
          `INSERT INTO notes (id, title, content, created_by, project_id, task_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          title,
          content,
          user?.id ?? agentLabel,
          project_id ?? null,
          task_id ?? null,
          now,
          now
        );

        const note = await db.get('SELECT * FROM notes WHERE id = ?', id);
        logActivity({
          user_id: user?.id ?? null,
          agent_label: agentLabel,
          tool_name: 'notes_create',
          input_summary: JSON.stringify({ title, project_id, task_id }).slice(0, 500),
          success: true,
        });
        notifyResourceChange();
        const result = { note };
        return {
          structuredContent: result,
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (e: any) {
        logActivity({
          user_id: user?.id ?? null,
          agent_label: agentLabel,
          tool_name: 'notes_create',
          success: false,
          error_msg: e.message,
        });
        throw e;
      }
    }
  );

  // notes_list - List notes accessible to the user
  server.tool(
    'notes_list',
    'List notes accessible to the user: personal notes, shared notes, and project/task-linked notes.',
    {
      project_id: z.string().optional(),
      task_id: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async ({ project_id, task_id, limit }, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();

      let sql = `
        SELECT n.*,
               u.name as creator_name,
               CASE WHEN n.project_id IS NOT NULL THEN p.name
                    WHEN n.task_id IS NOT NULL THEN t.title
                    ELSE NULL END as linked_item_name,
               CASE WHEN n.project_id IS NOT NULL THEN 'project'
                    WHEN n.task_id IS NOT NULL THEN 'task'
                    ELSE 'personal' END as note_type
        FROM notes n
        JOIN users u ON n.created_by = u.id
        LEFT JOIN projects p ON n.project_id = p.id
        LEFT JOIN tasks t ON n.task_id = t.id
        WHERE (
          -- User's own notes (any type)
          n.created_by = ?
          -- Notes shared with user
          OR n.id IN (SELECT note_id FROM note_members WHERE user_id = ?)
          -- Project-linked notes where user is a member
          OR n.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)
          -- Task-linked notes where user is a project member
          OR n.task_id IN (
            SELECT t2.id FROM tasks t2
            JOIN project_members pm ON t2.project_id = pm.project_id
            WHERE pm.user_id = ?
          )
        )
      `;
      const params: any[] = [user?.id, user?.id, user?.id, user?.id];

      if (project_id) {
        sql += ' AND n.project_id = ?';
        params.push(project_id);
      }

      if (task_id) {
        sql += ' AND n.task_id = ?';
        params.push(task_id);
      }

      sql += ' ORDER BY n.updated_at DESC LIMIT ?';
      params.push(limit);

      const notes = await db.all(sql, ...params);

      logActivity({
        user_id: user?.id ?? null,
        agent_label: agentLabel,
        tool_name: 'notes_list',
        success: true,
      });

      const result = { notes, count: notes.length };
      return {
        structuredContent: result,
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // notes_get - Get a single note by ID
  server.tool(
    'notes_get',
    'Get a single note by ID, including share information if applicable.',
    { note_id: z.string() },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async ({ note_id }, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();

      const note = await db.get(
        `
        SELECT n.*,
               u.name as creator_name,
               CASE WHEN n.project_id IS NOT NULL THEN p.name
                    WHEN n.task_id IS NOT NULL THEN t.title
                    ELSE NULL END as linked_item_name,
               CASE WHEN n.project_id IS NOT NULL THEN 'project'
                    WHEN n.task_id IS NOT NULL THEN 'task'
                    ELSE 'personal' END as note_type
        FROM notes n
        JOIN users u ON n.created_by = u.id
        LEFT JOIN projects p ON n.project_id = p.id
        LEFT JOIN tasks t ON n.task_id = t.id
        WHERE n.id = ?
        AND (
          n.created_by = ?
          OR n.id IN (SELECT note_id FROM note_members WHERE user_id = ?)
          OR n.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)
          OR n.task_id IN (
            SELECT t2.id FROM tasks t2
            JOIN project_members pm ON t2.project_id = pm.project_id
            WHERE pm.user_id = ?
          )
        )
      `,
        note_id,
        user?.id,
        user?.id,
        user?.id,
        user?.id
      );

      if (!note) throw new Error(`Note not found or access denied: ${note_id}`);

      // Get shares if personal note and user has access
      let shares: any[] = [];
      if (note.note_type === 'personal') {
        shares = await db.all(
          `
          SELECT nm.*, u.name, u.username
          FROM note_members nm
          JOIN users u ON nm.user_id = u.id
          WHERE nm.note_id = ?
        `,
          note_id
        );
      }

      logActivity({
        user_id: user?.id ?? null,
        agent_label: agentLabel,
        tool_name: 'notes_get',
        success: true,
      });

      const result = { note, shares: shares.length > 0 ? shares : undefined };
      return {
        structuredContent: result,
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // notes_update - Update note title/content
  server.tool(
    'notes_update',
    'Update a note title or content. Only the creator or users with edit permission can update.',
    {
      note_id: z.string(),
      title: z.string().min(1).max(200).optional(),
      content: z.string().min(1).max(50000).optional(),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async ({ note_id, title, content }, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();

      // Check access and edit permission
      const existing = await db.get('SELECT * FROM notes WHERE id = ?', note_id);
      if (!existing) throw new Error(`Note not found: ${note_id}`);

      const isCreator = existing.created_by === user?.id;
      const hasEditShare = await db.get(
        'SELECT 1 FROM note_members WHERE note_id = ? AND user_id = ? AND can_edit = 1',
        note_id,
        user?.id
      );

      // For project/task notes, only creator can edit
      // For personal notes, creator or edit-share holders can edit
      if (existing.project_id || existing.task_id) {
        if (!isCreator) throw new Error('Only the note creator can edit project/task-linked notes');
      } else {
        if (!isCreator && !hasEditShare) {
          throw new Error('Only the creator or users with edit permission can update this note');
        }
      }

      const updates: string[] = [];
      const params: any[] = [];

      if (title !== undefined) {
        updates.push('title = ?');
        params.push(title);
      }
      if (content !== undefined) {
        updates.push('content = ?');
        params.push(content);
      }

      if (updates.length === 0) throw new Error('No fields to update');

      updates.push('updated_at = ?');
      params.push(new Date().toISOString());
      params.push(note_id);

      try {
        await db.run(`UPDATE notes SET ${updates.join(', ')} WHERE id = ?`, ...params);

        const note = await db.get('SELECT * FROM notes WHERE id = ?', note_id);
        logActivity({
          user_id: user?.id ?? null,
          agent_label: agentLabel,
          tool_name: 'notes_update',
          input_summary: JSON.stringify({ note_id, title, content }).slice(0, 500),
          success: true,
        });
        notifyResourceChange();

        const result = { note };
        return {
          structuredContent: result,
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (e: any) {
        logActivity({
          user_id: user?.id ?? null,
          agent_label: agentLabel,
          tool_name: 'notes_update',
          success: false,
          error_msg: e.message,
        });
        throw e;
      }
    }
  );

  // notes_append - Add content to end of existing note
  server.tool(
    'notes_append',
    'Append content to the end of an existing note. Useful for adding updates without replacing existing content.',
    {
      note_id: z.string(),
      content: z.string().min(1).max(50000),
      separator: z.string().optional().default('\n\n'), // Separator between existing and new content
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async ({ note_id, content, separator }, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();

      // Check access and edit permission (same as update)
      const existing = await db.get('SELECT * FROM notes WHERE id = ?', note_id);
      if (!existing) throw new Error(`Note not found: ${note_id}`);

      const isCreator = existing.created_by === user?.id;
      const hasEditShare = await db.get(
        'SELECT 1 FROM note_members WHERE note_id = ? AND user_id = ? AND can_edit = 1',
        note_id,
        user?.id
      );

      if (existing.project_id || existing.task_id) {
        if (!isCreator) throw new Error('Only the note creator can append to project/task-linked notes');
      } else {
        if (!isCreator && !hasEditShare) {
          throw new Error('Only the creator or users with edit permission can append to this note');
        }
      }

      const newContent = existing.content + separator + content;
      const now = new Date().toISOString();

      try {
        await db.run('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?', newContent, now, note_id);

        const note = await db.get('SELECT * FROM notes WHERE id = ?', note_id);
        logActivity({
          user_id: user?.id ?? null,
          agent_label: agentLabel,
          tool_name: 'notes_append',
          input_summary: JSON.stringify({ note_id, content_preview: content.slice(0, 100) }).slice(0, 500),
          success: true,
        });
        notifyResourceChange();

        const result = { note, appended_chars: content.length };
        return {
          structuredContent: result,
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (e: any) {
        logActivity({
          user_id: user?.id ?? null,
          agent_label: agentLabel,
          tool_name: 'notes_append',
          success: false,
          error_msg: e.message,
        });
        throw e;
      }
    }
  );

  // notes_delete - Delete a note (creator only)
  server.tool(
    'notes_delete',
    'Delete a note permanently. Only the creator can delete personal notes. Project/task-linked notes can be deleted by creator or project owner.',
    { note_id: z.string() },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    async ({ note_id }, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();

      const existing = await db.get('SELECT * FROM notes WHERE id = ?', note_id);
      if (!existing) throw new Error(`Note not found: ${note_id}`);

      const isCreator = existing.created_by === user?.id;

      // Check if user can delete
      let canDelete = isCreator;

      if (!canDelete && (existing.project_id || existing.task_id)) {
        // Check if user is project owner/admin
        const projectId = existing.project_id || (await db.get('SELECT project_id FROM tasks WHERE id = ?', existing.task_id))?.project_id;
        if (projectId) {
          const role = await db.get(
            'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?',
            projectId,
            user?.id
          );
          if (role?.role === 'owner' || role?.role === 'admin') {
            canDelete = true;
          }
        }
      }

      if (!canDelete) {
        throw new Error('Only the note creator can delete this note');
      }

      try {
        await db.run('DELETE FROM notes WHERE id = ?', note_id);

        logActivity({
          user_id: user?.id ?? null,
          agent_label: agentLabel,
          tool_name: 'notes_delete',
          input_summary: JSON.stringify({ note_id, title: existing.title }).slice(0, 500),
          success: true,
        });
        notifyResourceChange();

        const result = { deleted: true, note_id, title: existing.title };
        return {
          structuredContent: result,
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (e: any) {
        logActivity({
          user_id: user?.id ?? null,
          agent_label: agentLabel,
          tool_name: 'notes_delete',
          success: false,
          error_msg: e.message,
        });
        throw e;
      }
    }
  );

  // notes_share - Share a personal note with another user
  server.tool(
    'notes_share',
    'Share a personal note with another user. Can grant read-only or edit permissions.',
    {
      note_id: z.string(),
      user_id: z.string(),
      can_edit: z.boolean().default(false),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async ({ note_id, user_id, can_edit }, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();

      // Verify note exists and is personal (not linked to project/task)
      const note = await db.get('SELECT * FROM notes WHERE id = ?', note_id);
      if (!note) throw new Error(`Note not found: ${note_id}`);
      if (note.project_id || note.task_id) {
        throw new Error('Only personal notes can be shared. Project/task-linked notes are visible to all project members.');
      }

      // Only creator can share
      if (note.created_by !== user?.id) {
        throw new Error('Only the note creator can share this note');
      }

      // Verify target user exists and is active
      const targetUser = await db.get(
        'SELECT id, name FROM users WHERE id = ? AND confirmed = 1 AND disabled = 0',
        user_id
      );
      if (!targetUser) throw new Error(`User not found or not active: ${user_id}`);

      // Cannot share with self
      if (user_id === user?.id) throw new Error('Cannot share a note with yourself');

      const now = new Date().toISOString();

      try {
        await db.run(
          `INSERT INTO note_members (note_id, user_id, can_edit, added_at, added_by)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (note_id, user_id) DO UPDATE SET can_edit = excluded.can_edit`,
          note_id,
          user_id,
          can_edit ? 1 : 0,
          now,
          user?.id
        );

        logActivity({
          user_id: user?.id ?? null,
          agent_label: agentLabel,
          tool_name: 'notes_share',
          input_summary: JSON.stringify({ note_id, user_id, can_edit }).slice(0, 500),
          success: true,
        });
        notifyResourceChange();

        const result = {
          shared: true,
          note_id,
          with_user: { id: targetUser.id, name: targetUser.name },
          can_edit,
        };
        return {
          structuredContent: result,
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (e: any) {
        logActivity({
          user_id: user?.id ?? null,
          agent_label: agentLabel,
          tool_name: 'notes_share',
          success: false,
          error_msg: e.message,
        });
        throw e;
      }
    }
  );

  // notes_unshare - Remove a user from a shared note
  server.tool(
    'notes_unshare',
    'Remove a user from a shared note. Only the note creator can unshare.',
    {
      note_id: z.string(),
      user_id: z.string(),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async ({ note_id, user_id }, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();

      // Verify note exists
      const note = await db.get('SELECT * FROM notes WHERE id = ?', note_id);
      if (!note) throw new Error(`Note not found: ${note_id}`);

      // Only creator can unshare
      if (note.created_by !== user?.id) {
        throw new Error('Only the note creator can unshare this note');
      }

      const existing = await db.get(
        'SELECT * FROM note_members WHERE note_id = ? AND user_id = ?',
        note_id,
        user_id
      );
      if (!existing) throw new Error('User does not have access to this note');

      try {
        await db.run('DELETE FROM note_members WHERE note_id = ? AND user_id = ?', note_id, user_id);

        logActivity({
          user_id: user?.id ?? null,
          agent_label: agentLabel,
          tool_name: 'notes_unshare',
          input_summary: JSON.stringify({ note_id, user_id }).slice(0, 500),
          success: true,
        });
        notifyResourceChange();

        const result = { unshared: true, note_id, user_id };
        return {
          structuredContent: result,
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (e: any) {
        logActivity({
          user_id: user?.id ?? null,
          agent_label: agentLabel,
          tool_name: 'notes_unshare',
          success: false,
          error_msg: e.message,
        });
        throw e;
      }
    }
  );

  // notes_list_shares - List who has access to a note
  server.tool(
    'notes_list_shares',
    'List all users who have access to a personal note.',
    { note_id: z.string() },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async ({ note_id }, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();

      // Verify note exists and user has access
      const note = await db.get(
        `
        SELECT * FROM notes WHERE id = ? AND (
          created_by = ?
          OR id IN (SELECT note_id FROM note_members WHERE user_id = ?)
        )
      `,
        note_id,
        user?.id,
        user?.id
      );
      if (!note) throw new Error(`Note not found or access denied: ${note_id}`);

      const shares = await db.all(
        `
        SELECT nm.user_id, nm.can_edit, nm.added_at, u.name, u.username
        FROM note_members nm
        JOIN users u ON nm.user_id = u.id
        WHERE nm.note_id = ?
      `,
        note_id
      );

      logActivity({
        user_id: user?.id ?? null,
        agent_label: agentLabel,
        tool_name: 'notes_list_shares',
        success: true,
      });

      const result = { note_id, shares, creator_id: note.created_by };
      return {
        structuredContent: result,
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
