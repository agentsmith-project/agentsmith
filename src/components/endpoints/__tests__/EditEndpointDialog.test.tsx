import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

const mockUpdate = vi.fn().mockResolvedValue({});

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  EndpointAPI: vi.fn().mockImplementation(function () {
    return {
      update: mockUpdate,
    };
  }),
}));

vi.mock('@/lib/hooks/use-api-error', () => ({
  useApiError: vi.fn(() => ({
    handleError: vi.fn(),
    error: null,
    clearError: vi.fn(),
    retry: vi.fn(),
    setError: vi.fn(),
    isVisible: false,
  })),
}));

vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { EditEndpointDialog } from '../EditEndpointDialog';

describe('EditEndpointDialog', () => {
  it('submits updates', async () => {
    const user = userEvent.setup();
    render(
      <EditEndpointDialog
        open
        onOpenChange={vi.fn()}
        workspaceId="ws_1"
        projectId="prj_1"
        endpoint={{
          id: 'ep_1',
          project_id: 'prj_1',
          name: 'OpenAI Main',
          description: 'Primary endpoint',
          openai_model: 'gpt-4o',
          type: 'openai',
          base_url: 'https://api.openai.com/v1',
          status: 'active',
          created_at: '2026-02-01T00:00:00Z',
          updated_at: '2026-02-01T00:00:00Z',
        }}
      />
    );

    const nameInput = screen.getByLabelText(/create_dialog\.name/);
    await user.clear(nameInput);
    await user.type(nameInput, 'OpenAI Updated');

    await user.click(screen.getByRole('button', { name: 'edit_dialog.save' }));

    expect(mockUpdate).toHaveBeenCalledWith('ws_1', 'prj_1', 'ep_1', expect.objectContaining({
      name: 'OpenAI Updated',
    }));
  });
});
