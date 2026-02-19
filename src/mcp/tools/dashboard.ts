import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb, logActivity } from '../../db.ts';

export function registerDashboardTools(server: McpServer) {
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

      const totalTasks = ((await db.get('SELECT COUNT(*) as n FROM tasks')) as any).n;
      const pendingTasks = ((await db.get("SELECT COUNT(*) as n FROM tasks WHERE status = 'pending'")) as any).n;
      const inProgressTasks = ((await db.get("SELECT COUNT(*) as n FROM tasks WHERE status = 'in_progress'")) as any).n;
      const completedTasks = ((await db.get("SELECT COUNT(*) as n FROM tasks WHERE status = 'completed'")) as any).n;
      const cancelledTasks = ((await db.get("SELECT COUNT(*) as n FROM tasks WHERE status = 'cancelled'")) as any).n;
      const overdueTasks = ((await db.get(
        "SELECT COUNT(*) as n FROM tasks WHERE due_date < ? AND status NOT IN ('completed','cancelled')",
        now
      )) as any).n;
      const dueSoonTasks = ((await db.get(
        "SELECT COUNT(*) as n FROM tasks WHERE due_date >= ? AND due_date <= ? AND status NOT IN ('completed','cancelled')",
        now, in24h
      )) as any).n;
      const totalProjects = ((await db.get('SELECT COUNT(*) as n FROM projects')) as any).n;
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
