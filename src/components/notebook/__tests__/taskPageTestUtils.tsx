import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { Artifact, Task, TaskMessage } from '@/lib/types/task';

export const mockTask: Task = {
  id: 'task-1',
  workspace_id: 'workspace-1',
  project_id: 'project-1',
  owner_user_id: 'user-1',
  title: 'Test Task',
  agent_id: 'agent-1',
  agent_name: 'Test Agent',
  status: 'active',
  attached_inputs: [
    { id: 'in_1', kind: 'source', source_id: 'source-1' },
    { id: 'in_2', kind: 'source', source_id: 'source-2' },
  ],
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  last_activity_at: '2024-01-02T12:00:00Z',
};

export const mockMessages: TaskMessage[] = [
  {
    id: 'msg-1',
    task_id: 'task-1',
    role: 'user',
    content: 'Hello',
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'msg-2',
    task_id: 'task-1',
    role: 'agent',
    content: 'Hi there!',
    created_at: '2024-01-01T00:01:00Z',
  },
];

export const mockArtifacts: Artifact[] = [
  {
    id: 'artifact-1',
    task_id: 'task-1',
    type: 'text',
    title: 'Text Artifact',
    content: 'Artifact content',
    created_at: '2024-01-01T00:00:00Z',
  },
];

export function renderWithNotebookQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
  };
}
