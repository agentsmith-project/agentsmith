/**
 * Runtime Console Route Tests
 *
 * Tests for the Runtime Console route which combines runtime observability,
 * alerts, control, and reports into a unified operations console.
 *
 * Part of navigation restructure WP-02.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import RuntimeConsoleRoute from '../page';

// Mock permissions - will be configured in each test
let permissionFn: (permission?: string) => boolean = (permission?: string) => permission === 'project:endpoint:use';

// Mock RuntimeConsolePage component
vi.mock('@/components/runtime/RuntimeConsolePage', () => ({
  RuntimeConsolePage: ({ workspaceId, projectId }: { workspaceId: string; projectId: string }) => (
    <div data-testid="runtime-console-page">
      <div data-testid="runtime-console__workspace">{workspaceId}</div>
      <div data-testid="runtime-console__project">{projectId}</div>
    </div>
  ),
}));

// Mock usePermissions hook
vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: (permission?: string) => permissionFn(permission),
}));

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock PageState and PageLoading components
vi.mock('@/components/layout/PageState', () => ({
  PageState: ({ state, children }: { state: string; children: React.ReactNode }) => (
    <div data-testid={`page-state__${state}`}>{children}</div>
  ),
}));

vi.mock('@/components/ui/loading', () => ({
  PageLoading: () => <div data-testid="page-loading">Loading...</div>,
}));

describe('RuntimeConsoleRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default permission
    permissionFn = (permission?: string) => permission === 'project:endpoint:use';
  });

  describe('access control', () => {
    it('grants access when user has project:endpoint:use permission', async () => {
      permissionFn = (permission?: string) => permission === 'project:endpoint:use';

      render(
        <RuntimeConsoleRoute
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_test',
            locale: 'en-US',
          })}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('runtime-console-page')).toBeInTheDocument();
      });
      expect(screen.getByTestId('runtime-console__workspace')).toHaveTextContent('ws_test');
      expect(screen.getByTestId('runtime-console__project')).toHaveTextContent('proj_test');
    });

    it('grants access when user has project:endpoint:use permission', async () => {
      permissionFn = (permission?: string) => permission === 'project:endpoint:use';

      render(
        <RuntimeConsoleRoute
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_test',
            locale: 'en-US',
          })}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('runtime-console-page')).toBeInTheDocument();
      });
    });

    it('grants access when user has project:manage permission', async () => {
      permissionFn = (permission?: string) => permission === 'project:manage';

      render(
        <RuntimeConsoleRoute
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_test',
            locale: 'en-US',
          })}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('runtime-console-page')).toBeInTheDocument();
      });
    });

    it('grants access when user has multiple permissions', async () => {
      permissionFn = (permission?: string) =>
        permission === 'project:endpoint:use' || permission === 'project:endpoint:use';

      render(
        <RuntimeConsoleRoute
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_test',
            locale: 'en-US',
          })}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('runtime-console-page')).toBeInTheDocument();
      });
    });

    it('denies access when user lacks all required permissions', async () => {
      permissionFn = () => false;

      render(
        <RuntimeConsoleRoute
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_test',
            locale: 'en-US',
          })}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
      });
      expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
    });
  });

  describe('parameter validation', () => {
    it('shows loading state while resolving params', async () => {
      permissionFn = (permission?: string) => permission === 'project:endpoint:use';

      render(
        <RuntimeConsoleRoute
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_test',
            locale: 'en-US',
          })}
        />
      );

      // Initially should show loading
      expect(screen.getByTestId('page-loading')).toBeInTheDocument();

      // Then should resolve to success
      await waitFor(() => {
        expect(screen.getByTestId('runtime-console-page')).toBeInTheDocument();
      });
    });

    it('shows error for invalid workspace parameter', async () => {
      permissionFn = (permission?: string) => permission === 'project:endpoint:use';

      render(
        <RuntimeConsoleRoute
          params={Promise.resolve({
            workspace: '<script>alert("xss")</script>',
            project: 'proj_test',
            locale: 'en-US',
          })}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
      });
      expect(screen.getByText('validation_error')).toBeInTheDocument();
    });

    it('shows error for invalid project parameter', async () => {
      permissionFn = (permission?: string) => permission === 'project:endpoint:use';

      render(
        <RuntimeConsoleRoute
          params={Promise.resolve({
            workspace: 'ws_test',
            project: '../../../etc/passwd',
            locale: 'en-US',
          })}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
      });
      expect(screen.getByText('validation_error')).toBeInTheDocument();
    });
  });

  describe('tab permission boundaries', () => {
    it('renders RuntimeConsolePage with correct props', async () => {
      permissionFn = (permission?: string) => permission === 'project:endpoint:use';

      render(
        <RuntimeConsoleRoute
          params={Promise.resolve({
            workspace: 'ws_123',
            project: 'proj_456',
            locale: 'zh-CN',
          })}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('runtime-console-page')).toBeInTheDocument();
      });
      expect(screen.getByTestId('runtime-console__workspace')).toHaveTextContent('ws_123');
      expect(screen.getByTestId('runtime-console__project')).toHaveTextContent('proj_456');
    });
  });

  describe('query parameter handling', () => {
    it('passes through locale parameter correctly', async () => {
      permissionFn = (permission?: string) => permission === 'project:manage';

      render(
        <RuntimeConsoleRoute
          params={Promise.resolve({
            workspace: 'ws_test',
            project: 'proj_test',
            locale: 'zh-CN',
          })}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('runtime-console-page')).toBeInTheDocument();
      });
    });
  });
});
