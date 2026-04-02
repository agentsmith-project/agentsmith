import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';

export function createFileLibrary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lib_1',
    workspace_id: 'ws_default',
    project_id: 'proj_001',
    name: 'Shared Docs',
    description: '',
    visibility: 'shared',
    provider: 's3',
    bucket: 'bucket-1',
    status: 'ready',
    filesystem_name: 'flib-ws-default-proj-001-shared-docs',
    created_by_user_id: 'user_001',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

export function createPrefixItem(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'prefix' as const,
    prefix: 'docs/',
    name: 'docs',
    ...overrides,
  };
}

export function createObjectItem(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'object' as const,
    key: 'README.txt',
    name: 'README.txt',
    size_bytes: 10,
    content_type: 'text/plain',
    etag: '"etag"',
    last_modified: new Date().toISOString(),
    ...overrides,
  };
}

export function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}
