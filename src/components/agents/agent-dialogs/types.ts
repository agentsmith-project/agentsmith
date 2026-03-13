import type { Endpoint } from '@/lib/api/types';

export interface EnvEntry {
  key: string;
  value: string;
}

export type AgentMode = 'external' | 'internal';
export type AgentInteractionMode = 'chat' | 'notebook' | 'both';

export type AgentEndpointOption = Endpoint;
