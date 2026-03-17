export interface AgentThread {
  id: string;
  project_id: string;
  end_user_id: string;
  current_agent_id: string;
  title?: string;
  status: 'active' | 'closed' | 'revoked';
  created_at: string;
  updated_at: string;
}

export interface Turn {
  id: string;
  agent_thread_id: string;
  status: 'queued' | 'started' | 'completed' | 'failed' | 'cancelled';
  input_message?: string;
  output_message?: string;
  error_code?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface TurnEvent {
  id: string;
  turn_id: string;
  event_type: string;
  data: unknown;
  timestamp: string;
}

export interface SSEEvent {
  id: string;
  event: string;
  data: unknown;
  retry?: number;
}
