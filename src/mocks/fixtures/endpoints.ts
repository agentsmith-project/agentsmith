/**
 * Endpoint Fixtures
 *
 * Mock endpoint data for development and testing.
 */

import type { Endpoint } from '@/lib/api/types';

export const endpointFixtures: Endpoint[] = [
  {
    id: 'endpoint_001',
    project_id: 'proj_001',
    name: 'GPT-4o',
    description: 'OpenAI GPT-4o endpoint for general tasks',
    openai_model: 'gpt-4o',
    type: 'openai',
    base_url: 'https://api.openai.com/v1',
    status: 'active',
    credential_ref: 'cred_001',
    limits: {
      max_requests_per_minute: 100,
      max_requests_per_day: 1000,
      max_tokens_per_day: 100000,
      timeout_seconds: 120,
    },
    created_at: '2026-01-10T09:00:00Z',
    updated_at: '2026-01-25T14:20:00Z',
  },
  {
    id: 'endpoint_002',
    project_id: 'proj_001',
    name: 'Claude 3.5 Sonnet',
    description: 'Anthropic Claude for complex reasoning',
    openai_model: 'claude-3.5-sonnet',
    type: 'anthropic',
    base_url: 'https://api.anthropic.com/v1',
    status: 'active',
    credential_ref: 'cred_002',
    limits: {
      max_requests_per_minute: 50,
      max_requests_per_day: 500,
      max_tokens_per_day: 200000,
      timeout_seconds: 180,
    },
    created_at: '2026-01-12T10:00:00Z',
    updated_at: '2026-01-26T11:30:00Z',
  },
  {
    id: 'endpoint_003',
    project_id: 'proj_001',
    name: 'Custom LLaMA',
    description: 'Self-hosted LLaMA model',
    openai_model: 'llama-3.1-70b',
    type: 'custom',
    base_url: 'https://llama.internal/v1',
    status: 'active',
    limits: {
      max_requests_per_minute: 200,
      max_requests_per_day: 5000,
      timeout_seconds: 300,
    },
    created_at: '2026-01-15T08:00:00Z',
    updated_at: '2026-01-27T16:45:00Z',
  },
  {
    id: 'endpoint_004',
    project_id: 'proj_002',
    name: 'GPT-4 Turbo',
    description: 'OpenAI GPT-4 Turbo for research',
    openai_model: 'gpt-4-turbo',
    type: 'openai',
    base_url: 'https://api.openai.com/v1',
    status: 'active',
    limits: {
      max_requests_per_minute: 80,
      max_requests_per_day: 800,
      max_tokens_per_day: 150000,
    },
    created_at: '2026-01-11T14:00:00Z',
    updated_at: '2026-01-24T09:20:00Z',
  },
  {
    id: 'endpoint_005',
    project_id: 'proj_001',
    name: 'Legacy Endpoint',
    description: 'Old endpoint to be deprecated',
    openai_model: 'gpt-3.5-turbo',
    type: 'openai',
    base_url: 'https://api.openai.com/v1',
    status: 'disabled',
    limits: {
      max_requests_per_minute: 60,
      max_requests_per_day: 600,
    },
    created_at: '2026-01-05T10:00:00Z',
    updated_at: '2026-01-20T12:00:00Z',
  },
];
