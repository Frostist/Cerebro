import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb, logActivity } from '../../db.ts';

const SERVER_NAME = 'Cerebro';
const SERVER_DESCRIPTION = 'MCP Task Manager — Claude.ai Connector + Admin UI';
const SERVER_VERSION = '1.0.0';

export function registerDashboardTools(server: McpServer) {
  server.tool(
    'info',
    `Cerebro — MCP Task Manager (v1.0.0)

Cerebro is a project and task management system. AI agents use it to create and track work across projects and teams. Humans manage users via the Admin UI; agents manage everything else.

GOLDEN RULE: Agents manage projects and tasks. Humans manage users. Agents have zero user-creation or user-modification tools.

── WORKFLOW ──────────────────────────────────────────
1. Call users_list to discover who is available to assign work to.
2. Call projects_list (or projects_create) to find or create a project.
3. Add team members with projects_assign_member.
4. Create tasks with tasks_create — assign immediately or later with tasks_assign.
5. Progress tasks through: pending → in_progress → completed (or cancelled) using tasks_set_status.
6. Use tasks_add_comment to log notes without touching status.
7. Use tasks_set_dependencies to declare blocking relationships between tasks.
8. Call dashboard_get for a high-level health check at any time.

── TOOLS ─────────────────────────────────────────────
info                  → This document. Call it first to orient yourself.
dashboard_get         → Summary counts: tasks by status, projects, users, overdue, due-soon.

projects_create       → Create a new project. Returns the created project object.
projects_list         → List all projects with member counts.
projects_get          → Get one project with its full member list and all tasks.
projects_assign_member → Add a confirmed user to a project (role: owner | member).
projects_remove_member → Remove a user from a project.
projects_delete       → Permanently delete a project and all its tasks. Destructive.

tasks_create          → Create a task in a project. Params: project_id, title, description?, priority (low|medium|high|urgent), assigned_to? (user_id), due_date? (ISO 8601).
tasks_list            → List tasks. Filter by project_id?, status?, assigned_to?.
tasks_get             → Get a single task with its comments, blocks[], and blockedBy[].
tasks_update          → Update title, description, priority, or due_date.
tasks_set_status      → Advance status: pending | in_progress | completed | cancelled.
tasks_assign          → Assign one or more tasks to a user (or pass null to unassign). User must be a project member.
tasks_delete          → Permanently delete a task. Destructive.
tasks_add_comment     → Append a timestamped comment to a task. Does NOT change status.
tasks_set_dependencies → Declare that task A blocks task B. Pass blocks_task_ids=[]. to clear.

users_list            → List confirmed, active users (id, name, username, role). Always call this before assigning tasks.
users_get             → Get a single user profile by user_id.

── PROMPTS ───────────────────────────────────────────
daily_standup         → Generates a standup summary (in_progress, overdue, due-soon). Optional user_id filter.
project_brief         → Structured brief for a project: goals, team, status, blockers, next actions. Requires project_id.
assign_unassigned_tasks → Suggests assignees for unassigned tasks and offers to call tasks_assign. Requires project_id.

── KEY RULES ─────────────────────────────────────────
• Only confirmed, non-disabled users can be assigned to tasks or projects.
• tasks_assign accepts task_ids (array) — you can bulk-assign in one call.
• tasks_set_dependencies is a full replace — pass the complete desired list each time.
• All mutations trigger resource change notifications to subscribed clients.
• Every tool call is logged in the activity log (visible to admins).`,
    {},
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async (_args, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';

      logActivity({ user_id: user?.id ?? null, agent_label: agentLabel, tool_name: 'info', success: true });

      const result = {
        server: {
          name: SERVER_NAME,
          description: SERVER_DESCRIPTION,
          version: SERVER_VERSION,
        },
        caller: {
          user_id: user?.id ?? null,
          username: user?.username ?? null,
          name: user?.name ?? null,
          email: user?.email ?? null,
          role: user?.role ?? null,
          agent_label: agentLabel,
        },
      };
      return { structuredContent: result, content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'dashboard_get',
    'Get a summary of tasks, projects, and users',
    {},
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async (_args, extra) => {
      const user = (extra.authInfo?.extra as any)?.user;
      const agentLabel = ((extra.authInfo?.extra as any)?.agentLabel as string) ?? user?.username ?? 'unknown';
      const db = getDb();
      const now = new Date().toISOString();
      const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const userId = user?.id ?? '';
      // All counts are scoped to projects the caller is a member of
      const memberFilter = 'EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = t.project_id AND pm.user_id = ?)';

      const totalTasks = ((await db.get(`SELECT COUNT(*) as n FROM tasks t WHERE ${memberFilter}`, userId)) as any).n;
      const pendingTasks = ((await db.get(`SELECT COUNT(*) as n FROM tasks t WHERE t.status = 'pending' AND ${memberFilter}`, userId)) as any).n;
      const inProgressTasks = ((await db.get(`SELECT COUNT(*) as n FROM tasks t WHERE t.status = 'in_progress' AND ${memberFilter}`, userId)) as any).n;
      const completedTasks = ((await db.get(`SELECT COUNT(*) as n FROM tasks t WHERE t.status = 'completed' AND ${memberFilter}`, userId)) as any).n;
      const cancelledTasks = ((await db.get(`SELECT COUNT(*) as n FROM tasks t WHERE t.status = 'cancelled' AND ${memberFilter}`, userId)) as any).n;
      const overdueTasks = ((await db.get(
        `SELECT COUNT(*) as n FROM tasks t WHERE t.due_date < ? AND t.status NOT IN ('completed','cancelled') AND ${memberFilter}`,
        now, userId
      )) as any).n;
      const dueSoonTasks = ((await db.get(
        `SELECT COUNT(*) as n FROM tasks t WHERE t.due_date >= ? AND t.due_date <= ? AND t.status NOT IN ('completed','cancelled') AND ${memberFilter}`,
        now, in24h, userId
      )) as any).n;
      const totalProjects = ((await db.get(
        'SELECT COUNT(*) as n FROM project_members WHERE user_id = ?',
        userId
      )) as any).n;
      const totalUsers = ((await db.get("SELECT COUNT(*) as n FROM users WHERE confirmed = 1 AND disabled = 0")) as any).n;

      logActivity({ user_id: user?.id ?? null, agent_label: agentLabel, tool_name: 'dashboard_get', success: true });

      const result = {
        tasks: { total: totalTasks, pending: pendingTasks, in_progress: inProgressTasks, completed: completedTasks, cancelled: cancelledTasks, overdue: overdueTasks, due_soon: dueSoonTasks },
        projects: { total: totalProjects },
        users: { total: totalUsers },
      };
      return { structuredContent: result, content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
