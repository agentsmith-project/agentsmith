import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import UseGuidePage from '../page';

const mockUseEndpointPageCapabilities = vi.fn(() => ({ canUse: true, canManage: false, canRead: true }));

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/hooks/use-permissions', () => ({ useEndpointPageCapabilities: () => mockUseEndpointPageCapabilities() }));
vi.mock('@/lib/public-runtime-config', () => ({ buildPublicApiUrl: (path: string) => `https://api.example.com/api/v1/${path}` }));

describe('UseGuidePage route', () => {
  it('renders guide cards and quick links', async () => {
    render(<UseGuidePage params={Promise.resolve({ workspace: 'ws_1', project: 'proj_1', locale: 'en' })} />);
    await waitFor(() => {
      expect(screen.getByTestId('use-guide__page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('use-guide__gateway-base-url')).toHaveTextContent('https://api.example.com/api/v1/workspaces/ws_1/projects/proj_1/endpoints/<endpoint-id>/proxy');
    expect(screen.getByTestId('use-guide__openai-base-url')).toHaveTextContent('https://api.example.com/api/v1/workspaces/ws_1/projects/proj_1/endpoints/<endpoint-id>/proxy/openai');
    expect(screen.getByTestId('use-guide__anthropic-base-url')).toHaveTextContent('https://api.example.com/api/v1/workspaces/ws_1/projects/proj_1/endpoints/<endpoint-id>/proxy/anthropic');
    expect(screen.getByTestId('use-guide__codex-sample')).toHaveTextContent('model_providers.agentsmith.base_url="https://api.example.com/api/v1/workspaces/ws_1/projects/proj_1/endpoints/<endpoint-id>/proxy/openai"');
    expect(screen.getByTestId('use-guide__claude-sample')).toHaveTextContent('CLAUDE_SETTINGS=$(jq -nc');
  });

  it('shows permission denied when token is missing', async () => {
    mockUseEndpointPageCapabilities.mockReturnValue({ canUse: false, canManage: false, canRead: false });
    render(<UseGuidePage params={Promise.resolve({ workspace: 'ws_1', project: 'proj_1', locale: 'en' })} />);
    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
  });

  it('shows validation_error for invalid parameters', async () => {
    render(<UseGuidePage params={Promise.resolve({ workspace: '../unsafe-workspace', project: 'proj_1', locale: 'en' })} />);
    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
  });
});
