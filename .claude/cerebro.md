# Cerebro — Agent Usage Guide

Cerebro is your project and task management system. Use it to organize work, track progress, and coordinate across a team.

## Before you do anything
Call `info` once on first connection. It tells you who you are and confirms you're connected. Save the result to memory — you don't need to call it again.

## Working with users
You cannot create or modify users — that's handled by humans. Before assigning anyone to anything, call `users_list` to see who's available. Always use their `id` when assigning.

## Starting a project
1. `projects_list` — check if a project already exists before creating one
2. `projects_create` — only if you need a new one
3. `projects_assign_member` — add relevant users before creating tasks (they must be members to be assigned tasks)

## Creating and managing tasks
- Create tasks with `tasks_create`. Set priority thoughtfully — default to `medium`, use `urgent` sparingly.
- Assign at creation time if you know who owns it. If not, assign later with `tasks_assign`.
- `tasks_assign` is bulk — pass multiple `task_ids` in one call instead of calling it repeatedly.
- Use `tasks_set_status` to move tasks forward. Don't skip statuses — move through `pending → in_progress → completed`.
- Use `tasks_add_comment` to log progress, blockers, or notes. This does NOT change the task status.
- Use `tasks_set_dependencies` when one task must be completed before another can start. Pass the full desired list every time — it's a full replace, not an append.

## Checking on things
- `dashboard_get` for a quick overall health check
- `tasks_list` with filters to find specific tasks (by project, status, or assignee)
- `tasks_get` when you need a task's full detail including comments and dependencies

## General rules
- Always check before creating — list first, create only if needed
- Don't leave tasks unassigned if you know who should own them
- When in doubt about task status, check `tasks_get` before making changes
