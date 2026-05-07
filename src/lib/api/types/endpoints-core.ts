export interface Credential {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  type: 'api_key';
  fingerprint: string;
  created_at: string;
  last_rotated_at?: string;
}

export interface CreateCredentialRequest {
  name: string;
  type: 'api_key';
  value: string;
}

export interface Endpoint {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  model: string;
  type: 'catalog' | 'custom';
  base_url: string;
  status: 'active' | 'disabled';
  credential_ref?: string;
  provider_family?: EndpointProviderFamily;
  upstream_protocol: EndpointUpstreamProtocol;
  capabilities?: EndpointCapability[];
  models?: EndpointModelBinding[];
  defaults?: EndpointDefaults;
  health?: EndpointHealth;
  meta?: Record<string, string>;
  model_profile?: EndpointModelProfile;
  limits?: EndpointLimits;
  agent_task_model_selected?: boolean;
  actions?: EndpointActions;
  created_at: string;
  updated_at: string;
}

export type EndpointProviderFamily =
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'minimax'
  | 'kimi'
  | 'google'
  | 'glm'
  | 'alibaba'
  | 'custom';
export type EndpointUpstreamProtocol =
  | 'openai_chat_completions'
  | 'openai_responses'
  | 'anthropic_messages';
export type EndpointCapabilityType =
  | 'chat_completion'
  | 'multimodal_completion'
  | 'embedding'
  | 'rerank'
  | 'image_generation'
  | 'video_generation';

export interface EndpointCapability {
  type: EndpointCapabilityType;
  enabled: boolean;
  default_model_id?: string;
}

export interface EndpointModelBinding {
  capability: EndpointCapabilityType;
  model_id: string;
  display_name?: string;
  context_window?: number;
  pricing?: {
    input_per_million?: number;
    output_per_million?: number;
    unit?: string;
    currency?: string;
  };
}

export interface EndpointDefaults {
  chat_model_id?: string;
  multimodal_model_id?: string;
  embedding_model_id?: string;
  rerank_model_id?: string;
  image_model_id?: string;
  video_model_id?: string;
}

export interface EndpointHealth {
  status: 'unknown' | 'healthy' | 'degraded' | 'failed';
  last_checked_at?: string;
  last_error?: string;
}

export interface EndpointLimits {
  max_requests_per_minute?: number;
  max_requests_per_day?: number;
  max_tokens_per_day?: number;
  timeout_seconds?: number;
}

export type EndpointActionOperation = 'use_for_agent_tasks';

export type EndpointActionDangerLevel = 'none' | 'medium' | 'high';

export interface EndpointActionAffordance {
  operation: EndpointActionOperation;
  visible: boolean;
  allowed: boolean;
  reason_code?: string;
  required_permissions: string[];
  danger_level: EndpointActionDangerLevel;
}

export interface EndpointActions {
  use_for_agent_tasks: EndpointActionAffordance;
}

export interface EndpointModelProfile {
  max_context_tokens: number;
  max_output_tokens: number;
  supports_file: boolean;
  supports_tool_call: boolean;
  supports_reasoning: boolean;
  price_input_per_1m: number;
  price_output_per_1m: number;
  cache_read_discount_ratio: number;
  cache_write_discount_ratio?: number;
}
