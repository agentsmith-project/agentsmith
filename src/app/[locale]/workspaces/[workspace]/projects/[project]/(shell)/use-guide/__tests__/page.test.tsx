import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import UseGuidePage from '../page';

const mockHasPermission = vi.fn((_permission?: string) => true);

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: (permission: string) => mockHasPermission(permission),
}));

vi.mock('@/lib/public-runtime-config', () => ({
  buildPublicApiUrl: (path: string) => `https://api.example.com/api/v1/${path}`,
}));

describe('UseGuidePage route', () => {
  it('renders guide cards and quick links', async () => {
    render(
      <UseGuidePage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('use-guide__page')).toBeInTheDocument();
    });

    expect(screen.getByTestId('use-guide__protocol-openai')).toBeInTheDocument();
    expect(screen.getByTestId('use-guide__protocol-anthropic')).toBeInTheDocument();
    expect(screen.getByTestId('use-guide__codex-sample')).toBeInTheDocument();
    expect(screen.getByTestId('use-guide__claude-sample')).toBeInTheDocument();
    expect(screen.getByTestId('use-guide__gateway-base-url')).toHaveTextContent(
      'https://api.example.com/api/v1/workspaces/ws_1/projects/proj_1/llm-gateway',
    );
    expect(screen.getByTestId('use-guide__openai-chat-curl')).toHaveTextContent(
      'https://api.example.com/api/v1/workspaces/ws_1/projects/proj_1/llm-gateway/chat/completions',
    );
    expect(screen.getByTestId('use-guide__anthropic-curl')).toHaveTextContent(
      'https://api.example.com/api/v1/workspaces/ws_1/projects/proj_1/llm-gateway/messages',
    );
    expect(screen.getByTestId('use-guide__link-api-keys')).toHaveAttribute('href', '/en/user/api-keys');
    expect(screen.getByTestId('use-guide__link-third-party-accounts')).toHaveAttribute('href', '/en/workspaces/ws_1/connections');
  });

  it('shows permission denied when token is missing', async () => {
    mockHasPermission.mockReturnValue(false);

    render(
      <UseGuidePage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });

    expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
    mockHasPermission.mockReturnValue(true);
  });

  it('shows validation_error for invalid parameters', async () => {
    render(
      <UseGuidePage
        params={Promise.resolve({
          workspace: '../unsafe-workspace',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });

    expect(screen.getByText('validation_error')).toBeInTheDocument();
  });
});
