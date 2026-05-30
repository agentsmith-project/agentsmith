import type { ApiClient } from '../client';
import type { ContextEntry, ContextQuery, PutContextEntryRequest } from '../types';

function buildSearch(query: ContextQuery): string {
  const params = new URLSearchParams();
  params.set('scope', query.scope);
  if (query.key) params.set('key', query.key);
  if (query.workspace_id) params.set('workspace_id', query.workspace_id);
  if (query.project_id) params.set('project_id', query.project_id);
  if (query.task_id) params.set('task_id', query.task_id);
  return params.toString();
}

export class ContextAPI {
  constructor(private client: ApiClient) {}

  async get(query: ContextQuery & { key: string }): Promise<ContextEntry> {
    return this.client.get<ContextEntry>(`/context?${buildSearch(query)}`);
  }

  async list(query: Omit<ContextQuery, 'key'>): Promise<ContextEntry[]> {
    const response = await this.client.get<{ items: ContextEntry[]; total: number }>(`/context/list?${buildSearch(query)}`);
    return response.items;
  }

  async put(request: PutContextEntryRequest): Promise<ContextEntry> {
    return this.client.put<ContextEntry>('/context', request);
  }

  async remove(query: ContextQuery & { key: string }): Promise<void> {
    return this.client.delete<void>(`/context?${buildSearch(query)}`);
  }
}
