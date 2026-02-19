import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb } from '../db.ts';

export function registerPrompts(server: McpServer) {
  // Daily standup prompt
  server.prompt(
    'daily_standup',
    'Generate a daily standup summary of tasks and projects',
    { user_id: z.string().optional() },
    async ({ user_id }) => {
      const db = getDb();
      const now = new Date().toISOString();
      const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const conditions = user_id ? 'AND t.assigned_to = ?' : '';
      const params = user_id ? [user_id] : [];

      const inProgress = db.query(`SELECT t.*, u.name as assignee_name FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id WHERE t.status = 'in_progress' ${conditions} ORDER BY t.priority DESC, t.due_date ASC`).all(...params);
      const overdue = db.query(`SELECT t.*, u.name as assignee_name FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id WHERE t.due_date < ? AND t.status NOT IN ('completed','cancelled') ${conditions} ORDER BY t.due_date ASC`).all(now, ...params);
      const dueSoon = db.query(`SELECT t.*, u.name as assignee_name FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id WHERE t.due_date >= ? AND t.due_date <= ? AND t.status NOT IN ('completed','cancelled') ${conditions}`).all(now, in24h, ...params);

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
    async ({ project_id }) => {
      const db = getDb();
      const project = db.query('SELECT * FROM projects WHERE id = ?').get(project_id) as any;
      if (!project) throw new Error('Project not found');
      const members = db.query(`SELECT pm.role, u.name, u.username FROM project_members pm JOIN users u ON pm.user_id = u.id WHERE pm.project_id = ?`).all(project_id);
      const tasks = db.query('SELECT * FROM tasks WHERE project_id = ? ORDER BY priority DESC, status ASC').all(project_id);

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
    async ({ project_id }) => {
      const db = getDb();
      const unassigned = db.query(`SELECT * FROM tasks WHERE project_id = ? AND assigned_to IS NULL AND status NOT IN ('completed','cancelled')`).all(project_id);
      const members = db.query(`SELECT pm.role, u.id, u.name, u.username FROM project_members pm JOIN users u ON pm.user_id = u.id WHERE pm.project_id = ? AND u.confirmed = 1 AND u.disabled = 0`).all(project_id);

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
