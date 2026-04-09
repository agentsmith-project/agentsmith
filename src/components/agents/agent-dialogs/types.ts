import type { Endpoint } from '@/lib/api/types';

export interface EnvEntry {
  key: string;
  value: string;
}

export type AgentMode = 'external' | 'internal';
export type AgentInteractionKind = 'chat' | 'notebook';

export type AgentEndpointOption = Endpoint;
