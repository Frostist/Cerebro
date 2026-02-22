# 🧠 Cerebro

```
  ██████╗███████╗██████╗ ███████╗██████╗ ██████╗  ██████╗
 ██╔════╝██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██╔═══██╗
 ██║     █████╗  ██████╔╝█████╗  ██████╔╝██████╔╝██║   ██║
 ██║     ██╔══╝  ██╔══██╗██╔══╝  ██╔══██╗██╔══██╗██║   ██║
 ╚██████╗███████╗██║  ██║███████╗██████╔╝██║  ██║╚██████╔╝
  ╚═════╝╚══════╝╚═╝  ╚═╝╚══════╝╚═════╝ ╚═╝  ╚═╝ ╚═════╝

         MCP Task Manager — Connect your team's AI's
```

> Team-based task management with MCP integration — connect your Claude AI to track and manage tasks across your organization.

Cerebro is a production-ready task management server that exposes a standardized [Model Context Protocol (MCP)](https://modelcontextprotocol.io) interface. Teams can connect their Claude AI instances to track tasks across projects, with support for multiple users and role-based access. Includes a modern admin dashboard for oversight.

**Use cases:** Track tasks across a company or project team, give each team member's AI assistant access to shared task data, manage cross-user workflows.

![Admin Dashboard](Readme_Assets/admin_dashboard.png)

## What is Cerebro?

Cerebro is a task management server that exposes a standardized MCP interface, allowing AI agents to create, track, and manage tasks through a clean REST API. It includes a modern admin dashboard for manual oversight.

## Deployment

Cerebro is very easy to deploy to [Railway](https://railway.app) and will cost less than **$5/month** to run. Simply connect this repo and Railway will handle the rest.

> **Note:** You need a dedicated public URL for the MCP OAuth flow to work. You cannot test it locally with Claude without running Claude in [developer/MCP dev mode](https://modelcontextprotocol.io/docs/tools/inspector).

You can also easily deploy with Railway templates with this button below:

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/w-L8xJ?referralCode=WbXk0b&utm_medium=integration&utm_source=template&utm_campaign=generic)

## Quick Setup
1. Fork this Repo
2. Make it Private
3. Connect your Github to Railway and deploy
4. Copy the .env.example to Railway vars and edit as need be.
5. YOU need to pick either a Database Path or Databaase URL, the URL is setup in the .env.example file for Railway by default.
6. Create the Postgress db in Railway and it should connect automatically.

## Quick Setup for Dev

```bash
# Install dependencies
bun install

# Set up environment
cp .env.example .env
# Edit .env with your database credentials

# Start the server
bun start
# or
bun run dev
```

The server runs on `http://localhost:3000` by default.

## MCP Tools & AI Usage

Cerebro exposes a full set of [MCP](https://modelcontextprotocol.io) tools that any connected AI agent (e.g. Claude) can call. Below is a reference of every tool, prompt, and resource available.

### Workflow

The recommended order of operations for an AI agent:

1. Call `users_list` to discover available team members.
2. Call `projects_list` (or `projects_create`) to find or create a project.
3. Add team members with `projects_assign_member`.
4. Create tasks with `tasks_create` — assign immediately or later with `tasks_assign`.
5. Progress tasks: **pending** → **in_progress** → **completed** (or **cancelled**) via `tasks_set_status`.
6. Use `tasks_add_comment` to log notes without changing status.
7. Use `tasks_set_dependencies` to declare blocking relationships.
8. Call `dashboard_get` for a high-level health check at any time.

### Tools

#### General

| Tool | Description |
|------|-------------|
| `info` | Returns server metadata and caller identity. Call this first to orient the agent. |
| `dashboard_get` | Summary counts — tasks by status, projects, users, overdue, and due-soon items. |

#### Projects

| Tool | Description |
|------|-------------|
| `projects_create` | Create a new project. Params: `name`, `description?`. |
| `projects_list` | List all projects the caller belongs to, with member counts. |
| `projects_get` | Get a single project with its full member list and all tasks. Params: `project_id`. |
| `projects_assign_member` | Add a confirmed user to a project. Params: `project_id`, `user_id`, `role?` (owner \| member). |
| `projects_remove_member` | Remove a user from a project. Params: `project_id`, `user_id`. |
| `projects_delete` | Permanently delete a project and all its tasks. **Destructive.** Params: `project_id`. |

#### Tasks

| Tool | Description |
|------|-------------|
| `tasks_create` | Create a task. Params: `project_id`, `title`, `description?`, `priority?` (low \| medium \| high \| urgent), `assigned_to?`, `due_date?` (ISO 8601). |
| `tasks_list` | List tasks with optional filters: `project_id?`, `status?`, `assigned_to?`. |
| `tasks_get` | Get a single task with its comments, `blocks[]`, and `blockedBy[]`. Params: `task_id`. |
| `tasks_update` | Update a task's `title`, `description`, `priority`, or `due_date`. Params: `task_id`. |
| `tasks_set_status` | Change task status: pending \| in_progress \| completed \| cancelled. Params: `task_id`, `status`. |
| `tasks_assign` | Bulk-assign tasks to a project member (or `null` to unassign). Params: `task_ids[]`, `user_id`. |
| `tasks_delete` | Permanently delete a task. **Destructive.** Params: `task_id`. |
| `tasks_add_comment` | Append a timestamped comment to a task without changing its status. Params: `task_id`, `content`. |
| `tasks_set_dependencies` | Declare which tasks this task blocks. Full replace — pass the complete list each time, or `[]` to clear. Params: `task_id`, `blocks_task_ids[]`. |

#### Users

| Tool | Description |
|------|-------------|
| `users_list` | List all confirmed, active users (id, name, username, role). Always call before assigning tasks. |
| `users_get` | Get a single user profile. Params: `user_id`. |

> **Note:** AI agents cannot create or modify users. User management is handled by humans through the Admin UI.

### Prompts

Prompts are pre-built templates the AI can invoke for common workflows:

| Prompt | Description | Params |
|--------|-------------|--------|
| `daily_standup` | Generates a standup summary — in-progress tasks, overdue items, and upcoming deadlines. | `user_id?` |
| `project_brief` | Structured brief for a project: goals, team, status breakdown, blockers, and next actions. | `project_id` |
| `assign_unassigned_tasks` | Suggests assignees for unassigned tasks based on team members and offers to execute the assignments. | `project_id` |

### Key Rules

- Only confirmed, non-disabled users can be assigned to tasks or projects.
- `tasks_assign` accepts an array of `task_ids` — you can bulk-assign in one call.
- `tasks_set_dependencies` is a full replace — pass the complete desired list each time.
- All mutations trigger resource-change notifications to subscribed clients.
- Every tool call is logged in the activity log (visible to admins).
- All data is scoped — agents only see projects they are a member of.

## Tech Stack

- **Runtime**: Bun
- **Framework**: Hono
- **Database**: SQLite (For Dev) | PostgreSQL (For Prod)
- **MCP SDK**: @modelcontextprotocol/sdk

## License

MIT
