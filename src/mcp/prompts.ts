import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb } from '../db.ts';

export function registerPrompts(server: McpServer) {
  // Daily standup prompt
  server.prompt(
    'daily_standup',
    'Generate a daily standup summary of tasks and projects',
    { user_id: z.string().optional() },
    async ({ user_id }, extra) => {
      const caller = (extra.authInfo?.extra as any)?.user;
      const callerId = caller?.id ?? '';
      const db = getDb();
      const now = new Date().toISOString();
      const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      // Scope tasks to projects the caller is a member of
      const memberFilter = 'EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = t.project_id AND pm.user_id = ?)';
      const conditions = user_id ? `AND t.assigned_to = ?` : '';

      const inProgressParams = user_id ? [callerId, user_id] : [callerId];
      const overdueParams = user_id ? [now, callerId, user_id] : [now, callerId];
      const dueSoonParams = user_id ? [now, in24h, callerId, user_id] : [now, in24h, callerId];

      const inProgress = await db.all(
        `SELECT t.*, u.name as assignee_name FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id WHERE t.status = 'in_progress' AND ${memberFilter} ${conditions} ORDER BY t.priority DESC, t.due_date ASC`,
        ...inProgressParams
      );
      const overdue = await db.all(
        `SELECT t.*, u.name as assignee_name FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id WHERE t.due_date < ? AND t.status NOT IN ('completed','cancelled') AND ${memberFilter} ${conditions} ORDER BY t.due_date ASC`,
        ...overdueParams
      );
      const dueSoon = await db.all(
        `SELECT t.*, u.name as assignee_name FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id WHERE t.due_date >= ? AND t.due_date <= ? AND t.status NOT IN ('completed','cancelled') AND ${memberFilter} ${conditions}`,
        ...dueSoonParams
      );

      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Generate a concise daily standup summary based on this task data:

IN PROGRESS (${inProgress.length}):
${JSON.stringify(inProgress, null, 2)}

OVERDUE (${overdue.length}):
${JSON.stringify(overdue, null, 2)}

DUE IN NEXT 24H (${dueSoon.length}):
${JSON.stringify(dueSoon, null, 2)}

Please produce a standup in the format: what's in progress, what's blocked/overdue, what's coming up today.`,
          },
        }],
      };
    },
  );

  // Project brief prompt
  server.prompt(
    'project_brief',
    'Generate a structured project brief for a given project',
    { project_id: z.string() },
    async ({ project_id }, extra) => {
      const caller = (extra.authInfo?.extra as any)?.user;
      const callerId = caller?.id ?? '';
      const db = getDb();

      // Verify caller is a member of this project
      const membership = await db.get('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?', project_id, callerId);
      if (!membership) throw new Error('Project not found');

      const project = await db.get('SELECT * FROM projects WHERE id = ?', project_id) as any;
      if (!project) throw new Error('Project not found');
      const members = await db.all(`SELECT pm.role, u.name, u.username FROM project_members pm JOIN users u ON pm.user_id = u.id WHERE pm.project_id = ?`, project_id);
      const tasks = await db.all('SELECT * FROM tasks WHERE project_id = ? ORDER BY priority DESC, status ASC', project_id);

      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Generate a concise project brief for:

PROJECT: ${JSON.stringify(project, null, 2)}
MEMBERS: ${JSON.stringify(members, null, 2)}
TASKS: ${JSON.stringify(tasks, null, 2)}

Include: project goal, team, task status breakdown, key blockers, and next recommended actions.`,
          },
        }],
      };
    },
  );

  // Assign unassigned tasks prompt
  server.prompt(
    'assign_unassigned_tasks',
    'Suggest assignments for unassigned tasks based on team members',
    { project_id: z.string() },
    async ({ project_id }, extra) => {
      const caller = (extra.authInfo?.extra as any)?.user;
      const callerId = caller?.id ?? '';
      const db = getDb();

      // Verify caller is a member of this project
      const membership = await db.get('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?', project_id, callerId);
      if (!membership) throw new Error('Project not found');

      const unassigned = await db.all(`SELECT * FROM tasks WHERE project_id = ? AND assigned_to IS NULL AND status NOT IN ('completed','cancelled')`, project_id);
      const members = await db.all(`SELECT pm.role, u.id, u.name, u.username FROM project_members pm JOIN users u ON pm.user_id = u.id WHERE pm.project_id = ? AND u.confirmed = 1 AND u.disabled = 0`, project_id);

      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Suggest task assignments for these unassigned tasks based on available team members.

UNASSIGNED TASKS:
${JSON.stringify(unassigned, null, 2)}

AVAILABLE MEMBERS:
${JSON.stringify(members, null, 2)}

For each task, suggest the most suitable assignee (by user_id) with brief reasoning. Then offer to call tasks_assign for each suggestion.`,
          },
        }],
      };
    },
  );
}
