import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../db.ts';

// Server instance stored for sending notifications
let _server: McpServer | null = null;

export function initResources(server: McpServer) {
  _server = server;

  server.resource(
    'projects',
    'taskmanager://projects',
    { description: 'All projects', mimeType: 'application/json' },
    async () => {
      const db = getDb();
      const projects = db.query('SELECT * FROM projects ORDER BY created_at DESC').all();
      return { contents: [{ uri: 'taskmanager://projects', mimeType: 'application/json', text: JSON.stringify(projects, null, 2) }] };
    },
  );

  server.resource(
    'tasks',
    'taskmanager://tasks',
    { description: 'All tasks', mimeType: 'application/json' },
    async () => {
      const db = getDb();
      const tasks = db.query('SELECT * FROM tasks ORDER BY created_at DESC').all();
      return { contents: [{ uri: 'taskmanager://tasks', mimeType: 'application/json', text: JSON.stringify(tasks, null, 2) }] };
    },
  );

  server.resource(
    'users',
    'taskmanager://users',
    { description: 'Available users (confirmed, active)', mimeType: 'application/json' },
    async () => {
      const db = getDb();
      const users = db.query('SELECT id, name, username, role FROM users WHERE confirmed = 1 AND disabled = 0 ORDER BY name ASC').all();
      return { contents: [{ uri: 'taskmanager://users', mimeType: 'application/json', text: JSON.stringify(users, null, 2) }] };
    },
  );

  server.resource(
    'dashboard',
    'taskmanager://dashboard',
    { description: 'Dashboard stats', mimeType: 'application/json' },
    async () => {
      const db = getDb();
      const now = new Date().toISOString();
      const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const stats = {
        tasks: {
          total: (db.query('SELECT COUNT(*) as n FROM tasks').get() as any).n,
          pending: (db.query("SELECT COUNT(*) as n FROM tasks WHERE status='pending'").get() as any).n,
          in_progress: (db.query("SELECT COUNT(*) as n FROM tasks WHERE status='in_progress'").get() as any).n,
          completed: (db.query("SELECT COUNT(*) as n FROM tasks WHERE status='completed'").get() as any).n,
          overdue: (db.query("SELECT COUNT(*) as n FROM tasks WHERE due_date < ? AND status NOT IN ('completed','cancelled')").get(now) as any).n,
          due_soon: (db.query("SELECT COUNT(*) as n FROM tasks WHERE due_date >= ? AND due_date <= ? AND status NOT IN ('completed','cancelled')").get(now, in24h) as any).n,
        },
        projects: { total: (db.query('SELECT COUNT(*) as n FROM projects').get() as any).n },
        users: { total: (db.query("SELECT COUNT(*) as n FROM users WHERE confirmed=1 AND disabled=0").get() as any).n },
      };
      return { contents: [{ uri: 'taskmanager://dashboard', mimeType: 'application/json', text: JSON.stringify(stats, null, 2) }] };
    },
  );
}

export function notifyResourceChange() {
  // Emit resource change notifications for all mutable resources
  // The MCP SDK handles delivery to connected clients
  try {
    _server?.server?.sendResourceUpdated?.({ uri: 'taskmanager://projects' });
    _server?.server?.sendResourceUpdated?.({ uri: 'taskmanager://tasks' });
    _server?.server?.sendResourceUpdated?.({ uri: 'taskmanager://users' });
    _server?.server?.sendResourceUpdated?.({ uri: 'taskmanager://dashboard' });
  } catch {
    // Notifications are best-effort
  }
}
