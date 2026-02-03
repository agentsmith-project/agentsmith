/**
 * Supported token references for Project Settings.
 * Aligned with 文档/决策/2026-02-02-Agent-Edit-Runtime-Preferences-Governance-契约-v1.md
 */

import type { TokenItem } from './SettingsTokenReference';

export const RUNTIME_PREFERENCES_TOKENS: TokenItem[] = [
  { path: 'locale.language', default: 'en-US', description: 'BCP 47 language code' },
  { path: 'locale.timezone', default: 'UTC', description: 'IANA timezone' },
  { path: 'ai_behavior.tone', default: 'professional', description: 'professional | casual | friendly | formal | technical' },
  { path: 'ai_behavior.verbosity', default: 'balanced', description: 'concise | balanced | detailed' },
  { path: 'shared_context.organization_name', description: 'Organization/company name' },
  { path: 'shared_context.ai_identity', description: 'System prompt / AI identity' },
  { path: 'shared_context.custom_prompts', description: 'Key-value extensions' },
  { path: 'extensions', description: 'Arbitrary extensions (no validation)' },
];

export const GOVERNANCE_TOKENS: TokenItem[] = [
  // Capabilities
  { path: 'capabilities.userdata.storage', default: 'true', description: 'Enable UserData storage' },
  { path: 'capabilities.userdata.docdb', default: 'true', description: 'Enable UserData DocDB' },
  { path: 'capabilities.userdata.vectordb', default: 'true', description: 'Enable UserData VectorDB' },
  { path: 'capabilities.endpoint.enabled', default: 'true', description: 'Enable Endpoint' },
  { path: 'capabilities.plugins.enabled', default: '[]', description: 'Enabled plugin IDs (future: resource plugins)' },
  // Quotas - UserData Storage (per end_user, Member overridable)
  { path: 'quotas.userdata.storage.bytes_per_end_user', default: '2147483648 (2GB)', description: 'Per end_user, Member can override' },
  { path: 'quotas.userdata.storage.objects_per_end_user', default: '20000', description: 'Per end_user, Member can override' },
  { path: 'quotas.userdata.storage.max_object_bytes', default: '52428800 (50MB)', description: 'Per-item hard limit, Member cannot override' },
  // Quotas - UserData DocDB
  { path: 'quotas.userdata.docdb.max_collections_per_scope', default: '50', description: 'Member can override' },
  { path: 'quotas.userdata.docdb.max_document_bytes', default: '1048576 (1MB)', description: 'Member can override' },
  { path: 'quotas.userdata.docdb.query_timeout_ms', default: '2000', description: 'Member can override' },
  { path: 'quotas.userdata.docdb.page_size_max', default: '100', description: 'Member can override' },
  // Quotas - UserData VectorDB
  { path: 'quotas.userdata.vectordb.max_indexes_per_scope', default: '50', description: 'Member can override' },
  { path: 'quotas.userdata.vectordb.top_k_max', default: '200', description: 'Member can override' },
  { path: 'quotas.userdata.vectordb.upsert_records_max', default: '500', description: 'Member can override' },
  // Quotas - Endpoint
  { path: 'quotas.endpoint.requests_per_day_per_end_user', default: '10000', description: 'Member can override' },
  { path: 'quotas.endpoint.requests_per_min_per_end_user', default: '120', description: 'Member can override' },
  // Rate limits
  { path: 'rate_limits.default.user_rpm', default: '120', description: 'User requests per minute' },
  { path: 'rate_limits.default.agent_rpm', default: '300', description: 'Agent requests per minute' },
  { path: 'rate_limits.default.agent_rpm_high_risk', default: '120', description: 'Agent RPM for high-risk' },
  // Guardrails
  { path: 'guardrails.agent_invoke.max_depth', default: '3', description: 'Max invoke depth' },
  { path: 'guardrails.agent_invoke.max_concurrent', default: '3', description: 'Max concurrent invokes' },
  { path: 'guardrails.agent_invoke.per_turn_invoke_budget', default: '10', description: 'Per-turn invoke budget' },
  { path: 'guardrails.agent_invoke.per_turn_total_tool_calls_budget', default: '20', description: 'Per-turn tool calls budget' },
  { path: 'guardrails.agent_invoke.per_turn_wall_clock_timeout_s', default: '120', description: 'Per-turn timeout (s)' },
  // Turns
  { path: 'turns.max_in_flight_per_thread', default: '1', description: 'Max in-flight per thread' },
  { path: 'turns.max_queued_per_thread', default: '20', description: 'Max queued per thread' },
  { path: 'turns.max_queue_wait_s', default: '86400 (24h)', description: 'Max queue wait (s)' },
  { path: 'turns.max_active_exec_s', default: '1800 (30min)', description: 'Max active exec (s)' },
  // Internal agents
  { path: 'internal_agents.max_concurrent_sessions_default', default: '3', description: 'Default max concurrent sessions' },
  { path: 'internal_agents.start_backoff_on_failures.threshold', default: '3', description: 'Backoff threshold' },
  { path: 'internal_agents.start_backoff_on_failures.backoff_s', default: '120', description: 'Backoff seconds' },
];

export const LIMITS_TOKENS: TokenItem[] = [
  // UserData totals (project-level)
  { path: 'userdata.storage.max_total_bytes', description: 'Project total storage limit; unset = no limit' },
  { path: 'userdata.docdb.max_total_collections', description: 'Project total DocDB collections; unset = no limit' },
  { path: 'userdata.vectordb.max_total_indexes', description: 'Project total VectorDB indexes; unset = no limit' },
  // Endpoint (per-endpoint defaults)
  { path: 'endpoint.tokens_per_day', description: 'Tokens per day per endpoint; unset = no limit' },
  { path: 'endpoint.tokens_per_min', description: 'Tokens per min per endpoint; unset = no limit' },
  { path: 'endpoint.requests_per_day', description: 'Requests per day per endpoint; unset = no limit' },
  { path: 'endpoint.requests_per_min', description: 'Requests per min per endpoint; unset = no limit' },
  { path: 'endpoint.timeout_ms', default: '60000', description: 'Request timeout (ms)' },
  { path: 'endpoint.max_concurrent', description: 'Max concurrent requests per endpoint; unset = no limit' },
];
