export type UserRole = 'member' | 'admin';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface User {
  id: string;
  name: string;
  email: string | null;
  username: string;
  password_hash: string;
  role: UserRole;
  confirmed: number;
  disabled: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  credential_view_token?: string | null;
  credential_view_token_expires_at?: string | null;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectMember {
  project_id: string;
  user_id: string;
  role: 'owner' | 'member';
  assigned_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigned_to: string | null;
  created_by: string;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskComment {
  id: string;
  task_id: string;
  content: string;
  created_by: string;
  created_at: string;
}

export interface OAuthToken {
  access_token: string;
  user_id: string;
  refresh_token: string;
  agent_label: string | null;
  last_used_at: string | null;
  expires_at: string;
  scope: string;
}

export interface AuthCode {
  code: string;
  user_id: string;
  code_challenge: string;
  expires_at: string;
  used: number;
}

export interface AdminSession {
  id: string;
  user_id: string;
  expires_at: string;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  user_id: string | null;
  agent_label: string | null;
  tool_name: string;
  input_summary: string | null;
  success: number;
  error_msg: string | null;
  created_at: string;
}

// Hono context variables
export interface AppVariables {
  user: User;
  agentLabel: string | null;
  isSuperadmin: boolean;
}
